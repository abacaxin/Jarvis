"""Teste puro (sem camera, sem mediapipe rodando) dos gestos de
movimento: SWIPE_RIGHT (deslizar com dois dedos) e PINCH_EXPAND (duas
"pincas" comecando juntas no centro e se afastando).

Simula uma sequencia de frames com timestamps controlados (injetados
via `now=`, sem depender do relogio real) e landmarks sinteticos.
Roda: python vision/test/test_motion_recognizer.py
"""

import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from gestures.motion_recognizer import MotionGestureRecognizer


def _swipe_hand(x):
    """Mao com indicador+medio esticados (pose do SWIPE_RIGHT), toda
    centrada horizontalmente em x."""

    points = [SimpleNamespace(x=x, y=0.5, z=0.0) for _ in range(21)]

    points[8] = SimpleNamespace(x=x, y=0.2, z=0.0)   # index tip (esticado)
    points[12] = SimpleNamespace(x=x, y=0.2, z=0.0)  # middle tip (esticado)
    points[16] = SimpleNamespace(x=x, y=0.6, z=0.0)  # ring tip (fechado)
    points[20] = SimpleNamespace(x=x, y=0.6, z=0.0)  # pinky tip (fechado)
    points[0] = SimpleNamespace(x=x, y=0.9, z=0.0)   # pulso

    return points


def _pinch_hand(center_x, center_y=0.5, finger_spread=0.0):
    """Mao com polegar/indicador centrados em (center_x, center_y).
    finger_spread=0 = "pinca" fechada (dedos tocando); valores maiores
    afastam a ponta do polegar da ponta do indicador, simulando a pinca
    "abrindo" (deixa de ser is_pinch acima de ~0.4x o tamanho da mao)."""

    points = [SimpleNamespace(x=center_x, y=center_y, z=0.0) for _ in range(21)]

    points[0] = SimpleNamespace(x=center_x, y=center_y + 0.3, z=0.0)  # pulso (da escala)
    points[4] = SimpleNamespace(x=center_x - finger_spread / 2, y=center_y, z=0.0)  # thumb tip
    points[8] = SimpleNamespace(x=center_x + finger_spread / 2, y=center_y, z=0.0)  # index tip

    return points


def _run(recognizer, frames):
    return [recognizer.update(hands, now=t) for t, hands in frames]


def test_swipe_right():
    recognizer = MotionGestureRecognizer(window_seconds=1.0, min_samples=3, swipe_min_dx=0.3)

    frames = [
        (0.0, [_swipe_hand(0.05)]),
        (0.2, [_swipe_hand(0.20)]),
        (0.4, [_swipe_hand(0.35)]),
        (0.6, [_swipe_hand(0.50)]),
        (0.8, [_swipe_hand(0.65)]),
    ]
    fired = _run(recognizer, frames)

    assert "SWIPE_RIGHT" in fired, fired
    print("OK - SWIPE_RIGHT disparado durante o deslize")


def test_no_swipe_when_still():
    recognizer = MotionGestureRecognizer(window_seconds=1.0, min_samples=3, swipe_min_dx=0.3)

    frames = [(t, [_swipe_hand(0.30)]) for t in (0.0, 0.2, 0.4, 0.6)]
    fired = _run(recognizer, frames)

    assert all(g is None for g in fired), fired
    print("OK - mao parada nao dispara SWIPE_RIGHT")


def test_no_swipe_when_jiggling():
    """Regressao: mao balançando perto do corpo (movimento natural, nao
    um deslize) pode terminar mais a direita do que comecou sem ser um
    gesto de verdade — o movimento precisa ser majoritariamente continuo
    pra direita, nao so bater no ponto inicial/final."""

    recognizer = MotionGestureRecognizer(window_seconds=1.0, min_samples=6, swipe_min_dx=0.3)

    xs = [0.10, 0.30, 0.15, 0.40, 0.20, 0.50]  # zigue-zague, mas termina mais a direita
    frames = [(i * 0.1, [_swipe_hand(x)]) for i, x in enumerate(xs)]
    fired = _run(recognizer, frames)

    assert all(g is None for g in fired), fired
    print("OK - mao balançando nao dispara SWIPE_RIGHT mesmo terminando mais a direita")


def test_pinch_expand():
    recognizer = MotionGestureRecognizer(
        window_seconds=1.0, min_samples=4, pinch_near=0.1, pinch_far=0.3
    )

    def hands_at(distance):
        return [_pinch_hand(0.5 - distance / 2), _pinch_hand(0.5 + distance / 2)]

    frames = [
        (0.0, hands_at(0.05)),   # comeca junto
        (0.15, hands_at(0.05)),  # segura um instante — nao e so 1 frame de sorte
        (0.3, hands_at(0.20)),
        (0.45, hands_at(0.35)),  # afasta
    ]
    fired = _run(recognizer, frames)

    assert "PINCH_EXPAND" in fired, fired
    print("OK - PINCH_EXPAND disparado ao afastar as duas pincas")


def test_pinch_expand_needs_more_than_one_close_frame():
    """Regressao: um UNICO frame perto/pinçando no inicio da janela nao
    deveria bastar pra confirmar o gesto — muito facil de acontecer por
    ruido de landmark, nao por intencao real."""

    recognizer = MotionGestureRecognizer(
        window_seconds=1.0, min_samples=4, pinch_near=0.1, pinch_far=0.3
    )

    def hands_at(distance):
        return [_pinch_hand(0.5 - distance / 2), _pinch_hand(0.5 + distance / 2)]

    frames = [
        (0.0, hands_at(0.05)),   # 1 frame perto, por acaso
        (0.15, hands_at(0.25)),  # ja longe no segundo frame
        (0.3, hands_at(0.35)),
        (0.45, hands_at(0.45)),
    ]
    fired = _run(recognizer, frames)

    assert all(g is None for g in fired), fired
    print("OK - um unico frame de pinca proxima nao dispara PINCH_EXPAND sozinho")


def test_pinch_expand_with_fingers_opening():
    """Regressao: na vida real os dedos soltam (a pinca "abre") enquanto
    as maos se afastam — o gesto tem que disparar mesmo assim, contanto
    que tenha comecado como pinca por mais de 1 frame."""

    recognizer = MotionGestureRecognizer(
        window_seconds=1.0, min_samples=5, pinch_near=0.1, pinch_far=0.3
    )

    def hands_at(distance, finger_spread):
        return [
            _pinch_hand(0.5 - distance / 2, finger_spread=finger_spread),
            _pinch_hand(0.5 + distance / 2, finger_spread=finger_spread),
        ]

    frames = [
        (0.0, hands_at(0.05, finger_spread=0.0)),    # comeca em pinca fechada, junto
        (0.15, hands_at(0.05, finger_spread=0.0)),   # segura um instante
        (0.3, hands_at(0.20, finger_spread=0.20)),   # ja abrindo a pinca
        (0.45, hands_at(0.30, finger_spread=0.25)),
        (0.6, hands_at(0.40, finger_spread=0.30)),   # pinca bem aberta, maos longe
    ]
    fired = _run(recognizer, frames)

    assert "PINCH_EXPAND" in fired, fired
    print("OK - PINCH_EXPAND dispara mesmo com os dedos abrindo durante o movimento")


if __name__ == "__main__":
    test_swipe_right()
    test_no_swipe_when_still()
    test_no_swipe_when_jiggling()
    test_pinch_expand()
    test_pinch_expand_needs_more_than_one_close_frame()
    test_pinch_expand_with_fingers_opening()
    print("OK - gestos de movimento (swipe e pinch-expand) reconhecidos corretamente")
