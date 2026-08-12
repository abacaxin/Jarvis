"""Teste puro (sem camera, sem mediapipe rodando) do classificador de
gestos: injeta landmarks sinteticos e confere CLOSED_FIST/OPEN_PALM.
Roda: python vision/test/test_gesture_recognizer.py
"""

import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from gestures.definitions import classify
from gestures.recognizer import GestureRecognizer

PIPS = {"index": 6, "middle": 10, "ring": 14, "pinky": 18}
TIPS = {"index": 8, "middle": 12, "ring": 16, "pinky": 20}


def make_landmarks(finger_y, thumb_far):
    """21 pontos falsos.

    finger_y: y da ponta de cada dedo (index/middle/ring/pinky).
    thumb_far: se True, ponta do polegar fica longe da base do
    mindinho (polegar esticado); se False, fica perto (fechado).
    """

    points = [SimpleNamespace(x=0.5, y=0.5, z=0.0) for _ in range(21)]

    for name in TIPS:
        points[PIPS[name]] = SimpleNamespace(x=0.5, y=0.5, z=0.0)
        points[TIPS[name]] = SimpleNamespace(x=0.5, y=finger_y[name], z=0.0)

    points[17] = SimpleNamespace(x=0.5, y=0.5, z=0.0)  # pinky MCP
    points[3] = SimpleNamespace(x=0.5, y=0.5, z=0.0)  # thumb IP
    points[4] = SimpleNamespace(x=0.9 if thumb_far else 0.5, y=0.5, z=0.0)  # thumb tip

    return points


def test_closed_fist():
    landmarks = make_landmarks(
        finger_y={"index": 0.6, "middle": 0.6, "ring": 0.6, "pinky": 0.6},
        thumb_far=False,
    )
    assert classify(landmarks) == "CLOSED_FIST"


def test_open_palm():
    landmarks = make_landmarks(
        finger_y={"index": 0.2, "middle": 0.2, "ring": 0.2, "pinky": 0.2},
        thumb_far=True,
    )
    assert classify(landmarks) == "OPEN_PALM"


def _fist_landmarks():
    return make_landmarks(
        finger_y={"index": 0.6, "middle": 0.6, "ring": 0.6, "pinky": 0.6},
        thumb_far=False,
    )


def test_clear_recent_does_not_allow_instant_refire():
    """Regressao: clear_recent() (usado apos o cooldown pos-acao em
    engine.py) so deve limpar o buffer de estabilidade — segurando o
    MESMO gesto, ele nao pode disparar de novo so por causa disso; so
    reseta de verdade quando a mao muda de pose ou some (reset())."""

    recognizer = GestureRecognizer(stability_frames=3)
    fist = _fist_landmarks()

    fired = [recognizer.update(fist) for _ in range(3)]
    assert fired == [None, None, "CLOSED_FIST"], fired

    recognizer.clear_recent()

    # segurando o mesmo punho fechado, mesmo depois de limpar o buffer
    # de estabilidade, NAO pode disparar de novo — _confirmed continua
    # "CLOSED_FIST".
    fired_after_clear = [recognizer.update(fist) for _ in range(5)]
    assert all(g is None for g in fired_after_clear), fired_after_clear

    # solta a mao (raw=None) e fecha o punho de novo — ai sim rearma.
    recognizer.update(None)
    fired_again = [recognizer.update(fist) for _ in range(3)]
    assert fired_again == [None, None, "CLOSED_FIST"], fired_again


if __name__ == "__main__":
    test_closed_fist()
    test_open_palm()
    test_clear_recent_does_not_allow_instant_refire()
    print("OK - CLOSED_FIST e OPEN_PALM classificados corretamente, clear_recent() nao permite refire instantaneo")
