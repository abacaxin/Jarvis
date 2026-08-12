#!/usr/bin/env python3
"""Escuta o microfone continuamente esperando a wake word e, ao
detectar, grava o comando que vem em seguida ate detectar silencio —
sem precisar de Enter (diferente de capture.py, ativacao manual).

Usa openWakeWord — sem conta, sem chave de API (Porcupine foi tentado
primeiro, mas exigia cadastro que travou pro usuario — ver
docs/decisoes.md). Modelo pre-treinado padrao e "hey_jarvis", que ja
vem pronto sem precisar treinar nada (e encaixa no tema do Kevin, ja
que ele e inspirado no Jarvis). Pra usar "Kevin" de verdade como wake
word, treine um modelo customizado em openwakeword.com/train e aponte
`wake_word_model` (em config.json) pro arquivo .onnx baixado.

Processo persistente — um unico InputStream fica aberto o tempo todo,
so troca de "modo" (esperando wake word / gravando) internamente, roda
ate SIGINT/SIGTERM.

Chamado como processo filho de longa duracao pelo VoiceService (Node).
Relata cada etapa como evento JSON em stdout (ver events.py).

Uso:
    python wake_listener.py
"""

import json
import os
import sys
import threading
import time
import types
import wave
from collections import deque

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ponytail: `openwakeword/__init__.py` importa sklearn incondicionalmente
# so pra oferecer treino de "verificador customizado" — feature que este
# modulo nunca usa (so faz deteccao com modelo ja treinado). sklearn
# sozinho custa ~25s pra importar; sem esse stub, cada subida do
# wake_listener.py levava ~45s so em imports. Se algum dia este arquivo
# passar a treinar verificador de verdade, e so remover o stub e deixar
# o sklearn real ser importado.
if "sklearn" not in sys.modules:
    _sklearn_stub = types.ModuleType("sklearn")
    _linear_model_stub = types.ModuleType("sklearn.linear_model")
    _linear_model_stub.LogisticRegression = object
    _pipeline_stub = types.ModuleType("sklearn.pipeline")
    _pipeline_stub.make_pipeline = lambda *a, **k: None
    _preprocessing_stub = types.ModuleType("sklearn.preprocessing")
    _preprocessing_stub.FunctionTransformer = object
    _preprocessing_stub.StandardScaler = object

    sys.modules["sklearn"] = _sklearn_stub
    sys.modules["sklearn.linear_model"] = _linear_model_stub
    sys.modules["sklearn.pipeline"] = _pipeline_stub
    sys.modules["sklearn.preprocessing"] = _preprocessing_stub

import noisereduce as nr
import numpy as np
import openwakeword
import sounddevice as sd
from openwakeword.model import Model

from events import emit, emit_error

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
SAMPLE_RATE = 16000
FRAME_SAMPLES = 1280  # 80ms a 16kHz — tamanho de frame que o openWakeWord espera


def load_config(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def resolve_wakeword_model(name_or_path):
    """Aceita tanto o nome de um modelo pre-treinado (ex: "hey_jarvis",
    baixado sob demanda) quanto o path de um .onnx customizado (treinado
    em openwakeword.com/train). Devolve (path_ou_nome_pra_carregar, chave_do_resultado)."""

    if os.path.exists(name_or_path):
        model_key = os.path.splitext(os.path.basename(name_or_path))[0]
        return name_or_path, model_key

    openwakeword.utils.download_models([name_or_path])
    return name_or_path, name_or_path


def save_wav(path, audio_int16, samplerate):
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(samplerate)
        wf.writeframes(audio_int16.tobytes())


def rms(frame_int16):
    if len(frame_int16) == 0:
        return 0.0
    return float(np.sqrt(np.mean(frame_int16.astype(np.float64) ** 2)))


class WakeListener:
    """Maquina de estado: IDLE (esperando a wake word) <-> RECORDING
    (gravando o comando, ate silencio sustentado ou o teto de
    seguranca `max_recording_seconds`)."""

    # ponytail: deteccao de silencio por limiar de RMS fixo
    # (`silence_threshold`), nao um VAD de verdade — mais barato e
    # simples, mas sensivel a ruido de fundo/ganho do mic. Se cortar a
    # fala cedo demais (ambiente barulhento) ou tarde demais (mic baixo),
    # esse numero em config.json e o primeiro ajuste.
    def __init__(self, model, wakeword_key, config, recordings_dir):
        self.model = model
        self.wakeword_key = wakeword_key
        self.threshold = config.get("wake_word_threshold", 0.5)
        self.silence_threshold = config.get("silence_threshold", 500)
        self.silence_duration = config.get("silence_duration_seconds", 1.0)
        # tolerancia MAIOR de silencio logo apos a wake word, antes do
        # comando comecar — falar "Hey Jarvis" e fazer uma pausa natural
        # antes do comando de verdade e comum, e o silence_duration
        # curto (pensado pra saber quando o comando TERMINOU) cortava a
        # gravacao cedo demais nesse caso, mandando só a wake word como
        # se fosse o comando inteiro.
        self.post_wakeword_grace_seconds = config.get("post_wakeword_grace_seconds", 4.0)
        self.max_recording_seconds = config.get("max_recording_seconds", 30)
        self.recordings_dir = recordings_dir

        # buffer curto do audio mais recente, mantido o tempo todo em
        # modo idle — quando a wake word dispara, esse pre-roll vai
        # junto no inicio da gravacao, entao "Kevin, visao" fica
        # capturado como uma frase so, sem precisar de pausa entre a
        # wake word e o comando.
        pre_roll_seconds = config.get("pre_roll_seconds", 1.5)
        pre_roll_frames = max(1, int(pre_roll_seconds / (FRAME_SAMPLES / SAMPLE_RATE)))
        self.pre_roll_buffer = deque(maxlen=pre_roll_frames)

        self.mode = "idle"
        self.frames = []
        self.has_spoken = False
        self.silence_since = None
        self.recording_started_at = None
        self.max_rms_seen = 0.0
        self._last_level_emit = 0.0

    def on_audio(self, indata, frame_count, time_info, status):
        pcm = indata[:, 0]

        if self.mode == "idle":
            self.pre_roll_buffer.append(pcm.copy())

            predictions = self.model.predict(pcm)
            score = predictions.get(self.wakeword_key, 0.0)

            if score >= self.threshold:
                self._trigger_recording(forced=False, score=round(float(score), 3))
            elif score >= 0.1:
                # diagnostico: mostra tentativas que chegaram perto mas
                # nao bateram o limiar — sem isso, "nao ativa" e caixa
                # preta, nao da pra saber se ta quase la (baixar
                # wake_word_threshold resolve) ou nem registrando nada
                # (mic/modelo com problema de verdade).
                emit(
                    "voice.wake_word.score",
                    {"score": round(float(score), 3), "threshold": self.threshold},
                )
            return

        self.frames.append(pcm.copy())
        self._update_silence(pcm)

        now = time.time()
        timed_out = now - self.recording_started_at >= self.max_recording_seconds

        # antes do comando comecar de verdade (so a wake word foi dita
        # ate agora), tolera um silencio bem mais longo — depois que a
        # fala do comando comeca, volta pro silence_duration curto pra
        # detectar o FIM do comando com responsividade normal.
        effective_silence_duration = (
            self.silence_duration
            if self.command_speech_detected
            else self.post_wakeword_grace_seconds
        )
        went_silent = (
            self.has_spoken
            and self.silence_since is not None
            and now - self.silence_since >= effective_silence_duration
        )

        if went_silent or timed_out:
            self._finish_recording()

    def _trigger_recording(self, forced, score=None):
        payload = {"forced": forced}
        if score is not None:
            payload["score"] = score
        emit("voice.wake_word.detected", payload)
        self._start_recording()

    def force_start_recording(self):
        """Chamado pela thread que le comandos do stdin (ver
        _stdin_command_loop) — deixa o Node pular a wake word quando o
        Kevin acabou de fazer uma pergunta e esta esperando resposta
        direta, sem precisar repetir a wake word.

        ponytail: sem lock entre essa thread e a callback de audio do
        sounddevice — `self.mode` podendo ser lido/escrito dos dois
        lados quase ao mesmo tempo e uma corrida teorica (ex: a wake
        word real dispara no exato instante em que o Node manda
        LISTEN_NOW). Chance baixissima (comando so chega em resposta a
        uma pergunta do Kevin, nao com frequencia de frame de audio) e
        o pior caso e so perder alguns frames iniciais, nao um crash —
        nao vale colocar lock numa callback de audio em tempo real por
        isso.
        """
        if self.mode == "idle":
            self._trigger_recording(forced=True)

    def _start_recording(self):
        self.mode = "recording"
        # semeia com o pre-roll — a wake word em si ja e "fala", entao
        # has_spoken comeca True (se o comando nunca vier, o silencio
        # sozinho ja para a gravacao logo, sem esperar uma fala nova).
        self.frames = list(self.pre_roll_buffer)
        self.pre_roll_buffer.clear()
        self.has_spoken = True
        # False ate a callback de audio ver um frame de fala DEPOIS do
        # gatilho (nao so o pre-roll, que e so a wake word) — controla
        # qual tolerancia de silencio se aplica (ver on_audio).
        self.command_speech_detected = False
        self.silence_since = None
        self.recording_started_at = time.time()
        self.max_rms_seen = 0.0
        self._last_level_emit = 0.0
        # limpa o buffer de predicao do modelo — sem isso, o proprio
        # "eco" da wake word que acabou de disparar fica no buffer e
        # pode confundir a proxima deteccao quando voltar pro modo idle.
        self.model.reset()

    def _update_silence(self, pcm):
        level = rms(pcm)
        now = time.time()

        self.max_rms_seen = max(self.max_rms_seen, level)

        # emite o nivel de audio periodicamente (nao a cada frame — a
        # 80ms por frame isso spamaria o stdout) — sem isso, calibrar
        # `silence_threshold` era só chute; com isso da pra ver o
        # numero real do seu microfone/ambiente e ajustar direito.
        if now - self._last_level_emit >= 0.5:
            self._last_level_emit = now
            emit(
                "voice.recording.level",
                {"rms": round(level, 1), "threshold": self.silence_threshold},
            )

        if level > self.silence_threshold:
            self.has_spoken = True
            self.command_speech_detected = True
            self.silence_since = None
        elif self.has_spoken and self.silence_since is None:
            self.silence_since = now

    def _finish_recording(self):
        self.mode = "idle"
        # has_spoken comeca sempre True agora (a wake word em si, no
        # pre-roll, ja conta como fala) — ao contrario de antes, nao da
        # mais pra distinguir "disparo por ruido, sem comando nenhum"
        # aqui. Na pratica isso so gera uma transcricao vazia/so-o-nome
        # ocasional, que o lado Node ja trata ("nao entendi nada").
        stop_reason = "silence" if self.silence_since is not None else "timeout"

        audio = np.concatenate(self.frames, axis=0)
        duration = len(audio) / SAMPLE_RATE

        # supressao de ruido (spectral gating, ver reduce_noise()) antes
        # de salvar — roda synchronous aqui mesmo, bloqueando a callback
        # de audio por um instante; aceitavel porque o mic acabou de
        # parar de gravar (nao ha wake word pra perder nesse meio tempo).
        # stationary=True: assume ruido de fundo mais ou menos constante
        # (ventilador, ruido eletrico) em vez de exigir uma amostra
        # separada só de ruido — o cenario mais comum de casa/escritorio.
        audio = nr.reduce_noise(y=audio, sr=SAMPLE_RATE, stationary=True).astype(np.int16)

        ts = int(time.time() * 1000)
        path = os.path.join(self.recordings_dir, f"voice-{ts}.wav")
        save_wav(path, audio, SAMPLE_RATE)

        emit(
            "voice.capture.completed",
            {
                "path": path,
                "timestamp": str(ts),
                "duration_seconds": round(duration, 2),
                "sample_rate": SAMPLE_RATE,
                "stop_reason": stop_reason,
                "max_rms_seen": round(self.max_rms_seen, 1),
            },
        )


def _stdin_command_loop(listener):
    """Le comandos de controle do stdin (pipe do Node) numa thread
    separada — sounddevice ja usa a dele propria pro audio. Hoje so
    entende "LISTEN_NOW" (ver force_start_recording)."""

    for line in sys.stdin:
        if line.strip() == "LISTEN_NOW":
            listener.force_start_recording()


def main():
    config = load_config(DEFAULT_CONFIG_PATH)

    wakeword_setting = config.get("wake_word_model", "hey_jarvis")
    recordings_dir = os.path.join(BASE_DIR, config.get("recordings_dir", "recordings"))
    os.makedirs(recordings_dir, exist_ok=True)

    try:
        model_path_or_name, wakeword_key = resolve_wakeword_model(wakeword_setting)
        model = Model(wakeword_models=[model_path_or_name], inference_framework="onnx")
    except Exception as erro:
        emit_error(f"Falha ao carregar o modelo de wake word: {erro}")
        return 1

    listener = WakeListener(model, wakeword_key, config, recordings_dir)

    emit("voice.activated", {})

    # daemon=True: nao precisa de cleanup explicito, morre sozinha
    # quando o processo principal sai (SIGINT/SIGTERM).
    threading.Thread(target=_stdin_command_loop, args=(listener,), daemon=True).start()

    try:
        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="int16",
            blocksize=FRAME_SAMPLES,
            callback=listener.on_audio,
        ):
            emit("voice.wake_word.listening", {})

            while True:
                time.sleep(0.1)

    except KeyboardInterrupt:
        pass

    except Exception as erro:
        emit_error(str(erro))
        return 1

    finally:
        emit("voice.deactivated", {})

    return 0


if __name__ == "__main__":
    sys.exit(main())
