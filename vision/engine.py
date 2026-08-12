#!/usr/bin/env python3
"""Vision engine do Kevin.

Orquestra Camera -> Hand Detector -> Gesture Recognizer -> Protocolo ->
Acao. Chamado como processo filho pelo VisionService (Node); nao decide
nada sozinho — so executa o comando recebido e relata cada etapa como
evento JSON em stdout (ver events.py).

Processo PERSISTENTE (mesmo padrao de voice/wake_listener.py e
voice/speak_server.py): fica de pe lendo comandos JSON (um por linha)
do stdin, em vez de ser spawnado uma vez por foto/ativacao. Camera e
HandDetector sao abertos/carregados uma vez so, na primeira vez que sao
necessarios, e ficam vivos entre comandos — o import do mediapipe, o
carregamento do modelo (~7.5MB) e a abertura da camera juntos levavam
vários segundos, e pagar isso a cada foto era o motivo da visao
"demorar seculos" pra responder (ver docs/decisoes.md).

Comandos aceitos (stdin, um JSON por linha):
    {"cmd": "capture", "show": true}          # tira uma foto
    {"cmd": "start_gestures", "show": true}   # comeca a escutar gestos
    {"cmd": "stop_gestures"}                  # para de escutar gestos

Uso: python engine.py
"""

import argparse
import json
import os
import queue
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import cv2

from actions.dispatcher import run_action
from camera.camera_source import CameraSource
from detection.hand_detector import HandDetector
from events import emit, emit_error
from gestures.motion_recognizer import MotionGestureRecognizer
from gestures.recognizer import GestureRecognizer
from protocols.protocol_map import gesture_to_protocol
from visualize import draw_overlay

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CONFIG_PATH = os.path.join(BASE_DIR, "config.json")

camera_opened = False


def load_config(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def ensure_camera_open(camera):
    # camera fica aberta entre comandos (nao fecha no fim de cada foto/
    # sessao de gestos) — reabrir do zero e a parte mais lenta de tudo
    # isso (handshake com o driver da webcam), so vale pagar esse custo
    # uma vez. Trade-off deliberado: a luz da camera fica acesa depois
    # do primeiro uso, ate o processo do Kevin encerrar.
    # ponytail: sem release automatico por inatividade — se isso incomodar
    # (luz da camera acesa o tempo todo), o proximo passo e um timer que
    # solta a camera apos N segundos sem comando.
    global camera_opened
    if not camera_opened:
        camera.open()
        camera_opened = True


def _open_fullscreen_window(name):
    # ponytail: tela cheia forcada (WND_PROP_FULLSCREEN) as vezes nao
    # aparece — ou nao ganha foco/fica atras de outras janelas — quando
    # o processo e disparado por voz em vez de rodado direto num
    # terminal (ver docs/decisoes.md). Janela normal + "sempre no topo"
    # e mais confiavel: nao depende de troca de modo de exibicao do SO.
    cv2.namedWindow(name, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(name, 960, 720)
    try:
        cv2.setWindowProperty(name, cv2.WND_PROP_TOPMOST, 1)
    except Exception:
        pass


def _delay_then_fresh_frame(camera, delay_seconds, show):
    """Espera `delay_seconds` antes de devolver o frame mais recente da
    camera — da tempo da mao que fez o gesto sair de cena antes da acao
    (ex: PROTOCOL_CAPTURE) rodar em cima de um frame "limpo". Continua
    lendo (e opcionalmente mostrando) frames nesse meio tempo, sem rodar
    deteccao — nao precisa, ninguem vai gesticular de novo em 1-2s."""

    deadline = time.time() + delay_seconds
    frame = None

    while time.time() < deadline:
        frame = camera.read_frame()

        if frame is not None and show:
            remaining = max(0.0, deadline - time.time())
            cv2.putText(
                frame, f"capturando em {remaining:.1f}s...", (10, 50),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 165, 255), 2,
            )
            cv2.imshow("Kevin Vision", frame)
            cv2.waitKey(1)

    return frame if frame is not None else camera.read_frame()


def run_capture(config, show, camera):
    captures_dir = os.path.join(BASE_DIR, config.get("captures_dir", "captures"))

    emit("vision.activated", {"mode": "capture"})

    try:
        ensure_camera_open(camera)
        emit("vision.camera.ready", camera.get_info())

        frame = camera.read_frame()
        if frame is None:
            emit_error("Nao foi possivel capturar frame da camera")
            return

        if show:
            _open_fullscreen_window("Kevin Vision - capture")
            cv2.imshow("Kevin Vision - capture", frame)
            cv2.waitKey(500)
            cv2.destroyAllWindows()

        result = run_action(
            "PROTOCOL_CAPTURE", {"frame": frame, "captures_dir": captures_dir}
        )
        emit("vision.capture.completed", result)

    except Exception as erro:
        emit_error(str(erro))

    finally:
        emit("vision.deactivated", {})


def run_gestures(config, show, camera, detector, stop_event):
    detection_cfg = config["detection"]
    gestures_cfg = config.get("gestures", {})
    protocol_map = config.get("protocols", {})
    captures_dir = os.path.join(BASE_DIR, config.get("captures_dir", "captures"))
    process_every_n = max(1, detection_cfg.get("process_every_n_frames", 1))
    action_delay = config.get("action_delay_seconds", 0)

    emit("vision.activated", {"mode": "gestures"})

    static_recognizer = GestureRecognizer(
        stability_frames=gestures_cfg.get("stability_frames", 4)
    )
    motion_recognizer = MotionGestureRecognizer(
        window_seconds=gestures_cfg.get("motion_window_seconds", 1.2),
        swipe_min_dx=gestures_cfg.get("swipe_min_dx", 0.35),
        pinch_near=gestures_cfg.get("pinch_near", 0.12),
        pinch_far=gestures_cfg.get("pinch_far", 0.35),
    )

    hand_loss_grace = gestures_cfg.get("hand_loss_grace_frames", 5)
    action_cooldown_seconds = gestures_cfg.get("action_cooldown_seconds", 3.0)

    hand_present = False
    last_hands = []
    last_gesture_display = None
    last_protocol_display = None
    frame_count = 0
    missed_detections = 0
    cooldown_until = 0.0

    try:
        ensure_camera_open(camera)
        emit("vision.camera.ready", camera.get_info())

        if show:
            _open_fullscreen_window("Kevin Vision")

        while not stop_event.is_set():
            frame = camera.read_frame()
            if frame is None:
                emit_error("Falha ao ler frame da camera")
                break

            frame_count += 1
            # ponytail: joga fora frames em vez de rastrear entre deteccoes
            # (ex: optical flow). Simples e barato pra Pi 3B; se o overlay
            # ficar "travado" demais entre deteccoes, e o proximo passo.
            if frame_count % process_every_n == 0:
                detected = detector.process(frame)

                if detected:
                    last_hands = detected
                    missed_detections = 0
                else:
                    missed_detections += 1
                    # tolera ate `hand_loss_grace` deteccoes vazias
                    # seguidas (webcam ruim/blur/luz) antes de considerar
                    # a mao realmente perdida — sem isso, qualquer frame
                    # ruim reseta o debounce do gesto e o hand.lost
                    # dispara sem a mao ter saido de cena de verdade.
                    if missed_detections > hand_loss_grace:
                        last_hands = []

            hands = last_hands
            is_hand_now = len(hands) > 0

            if is_hand_now and not hand_present:
                emit("vision.hand.detected", {})
            elif not is_hand_now and hand_present:
                emit("vision.hand.lost", {})
                last_gesture_display = None
                last_protocol_display = None
            hand_present = is_hand_now

            in_cooldown = time.time() < cooldown_until

            if in_cooldown:
                # logo depois de QUALQUER acao disparada, ignora gesto por
                # um tempo — a mao que acabou de disparar o gesto ainda
                # esta em cena/em movimento, e um reconhecimento "fantasma"
                # bem nessa hora e o caso mais comum de falso positivo.
                gesture = None
            else:
                # pose parada (punho fechado, mao aberta) primeiro; se nao
                # bateu, tenta gesto de movimento (deslize, pinca-expande).
                gesture = static_recognizer.update(hands[0] if hands else None)
                if not gesture:
                    gesture = motion_recognizer.update(hands)

            if gesture:
                last_gesture_display = gesture
                emit("vision.gesture.recognized", {"gesture": gesture})

                protocol = gesture_to_protocol(gesture, protocol_map)
                if protocol:
                    last_protocol_display = protocol
                    emit(
                        "vision.protocol.triggered",
                        {"gesture": gesture, "protocol": protocol},
                    )

                    action_frame = frame
                    if action_delay > 0:
                        emit(
                            "vision.action.pending",
                            {"protocol": protocol, "delay_seconds": action_delay},
                        )
                        action_frame = _delay_then_fresh_frame(
                            camera, action_delay, show
                        )

                    result = run_action(
                        protocol, {"frame": action_frame, "captures_dir": captures_dir}
                    )
                    if result is not None:
                        emit("vision.capture.completed", result)

                    cooldown_until = time.time() + action_cooldown_seconds

                    # NAO usa reset() aqui — isso tambem limparia
                    # _confirmed, que e a protecao propria do
                    # static_recognizer contra repetir o mesmo gesto (so
                    # refaz depois que a mao sai da pose/some, ver
                    # gestures/recognizer.py). So limpa o buffer de
                    # frames recentes, pra nao misturar frames de ANTES
                    # do cooldown com frames de DEPOIS quando o
                    # reconhecimento voltar. motion_recognizer nao
                    # precisa disso — a janela dele e por tempo, se
                    # autolimpa sozinha.
                    static_recognizer.clear_recent()

                    # `frame`/`hands` aqui sao de ANTES do delay (o
                    # instante em que o gesto foi reconhecido) — mostrar
                    # isso agora por cima da contagem regressiva parecia
                    # um "flash" de tracking cancelando a contagem. Volta
                    # pro topo do loop pra ler um frame de verdade.
                    continue

            if show:
                draw_overlay(frame, hands, last_gesture_display, last_protocol_display)
                cv2.imshow("Kevin Vision", frame)
                key = cv2.waitKey(1) & 0xFF
                if key in (27, ord("q")):
                    break

    except Exception as erro:
        emit_error(str(erro))

    finally:
        if show:
            cv2.destroyAllWindows()
        emit("vision.deactivated", {})


def _stdin_command_loop(command_queue, stop_gestures_event):
    """Le comandos do stdin (pipe do Node) numa thread separada — o
    loop de gestos (thread principal) fica ocupado lendo frame a frame
    e so checa `stop_gestures_event` a cada iteracao, entao "parar" tem
    que chegar por fora do fluxo normal de comandos (mesmo padrao de
    LISTEN_NOW em voice/wake_listener.py)."""

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd = json.loads(line)
        except ValueError:
            continue

        if cmd.get("cmd") == "stop_gestures":
            stop_gestures_event.set()
        else:
            command_queue.put(cmd)


def main():
    parser = argparse.ArgumentParser(description="Kevin Vision Engine (processo persistente)")
    parser.add_argument("--config", default=DEFAULT_CONFIG_PATH)
    args = parser.parse_args()

    config = load_config(args.config)
    detection_cfg = config["detection"]

    camera = CameraSource(**config["camera"])

    # import do mediapipe + carregamento do modelo (~7.5MB) pagos uma
    # vez so aqui, no boot do processo — nao a cada foto/ativacao.
    detector = HandDetector(
        max_num_hands=detection_cfg.get("max_num_hands", 1),
        min_detection_confidence=detection_cfg.get("min_detection_confidence", 0.6),
        min_tracking_confidence=detection_cfg.get("min_tracking_confidence", 0.5),
    )

    command_queue = queue.Queue()
    stop_gestures_event = threading.Event()

    threading.Thread(
        target=_stdin_command_loop,
        args=(command_queue, stop_gestures_event),
        daemon=True,
    ).start()

    emit("vision.engine.ready", {})

    try:
        while True:
            cmd = command_queue.get()
            action = cmd.get("cmd")
            show = bool(cmd.get("show", False))

            if action == "capture":
                run_capture(config, show, camera)
            elif action == "start_gestures":
                stop_gestures_event.clear()
                run_gestures(config, show, camera, detector, stop_gestures_event)
            # comando desconhecido: ignora

    except KeyboardInterrupt:
        pass

    finally:
        camera.release()
        detector.close()


if __name__ == "__main__":
    main()
