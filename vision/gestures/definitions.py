"""Geometria dos gestos: quais landmarks definem qual gesto.

Para adicionar um gesto novo:
1. Escreva uma funcao `landmarks -> bool` (use `finger_states()` como base).
2. Registre em GESTURE_SIGNATURES com o nome do gesto (ex: "THUMBS_UP").

Nada em detection/ ou protocols/ precisa mudar.
"""

# indices dos 21 landmarks do MediaPipe Hands
FINGER_TIPS = {"index": 8, "middle": 12, "ring": 16, "pinky": 20}
FINGER_PIPS = {"index": 6, "middle": 10, "ring": 14, "pinky": 18}
THUMB_TIP, THUMB_IP, PINKY_MCP = 4, 3, 17
WRIST, MIDDLE_MCP, INDEX_TIP = 0, 9, 8


def landmark_dist(a, b):
    return ((a.x - b.x) ** 2 + (a.y - b.y) ** 2) ** 0.5


def _finger_extended(landmarks, tip_idx, pip_idx):
    # y cresce pra baixo na imagem: tip acima do pip = dedo esticado
    return landmarks[tip_idx].y < landmarks[pip_idx].y


def _thumb_extended(landmarks):
    # polegar move lateralmente, nao verticalmente — comparar distancia
    # da ponta ate a base do mindinho e mais robusto que x/y cru.
    # ponytail: nao diferencia mao esquerda/direita explicitamente; se
    # isso gerar falso positivo/negativo por lateralidade, usar o
    # handedness que o MediaPipe ja retorna (multi_handedness).
    return landmark_dist(landmarks[THUMB_TIP], landmarks[PINKY_MCP]) > landmark_dist(
        landmarks[THUMB_IP], landmarks[PINKY_MCP]
    )


def finger_states(landmarks):
    """{"thumb": bool, "index": bool, "middle": bool, "ring": bool, "pinky": bool}"""

    states = {
        name: _finger_extended(landmarks, tip, FINGER_PIPS[name])
        for name, tip in FINGER_TIPS.items()
    }
    states["thumb"] = _thumb_extended(landmarks)
    return states


def is_closed_fist(landmarks):
    return not any(finger_states(landmarks).values())


def is_open_palm(landmarks):
    return all(finger_states(landmarks).values())


def is_two_fingers_up(landmarks):
    """Indicador + medio esticados, resto fechado. Pose usada como
    "caneta" pelo gesto de deslizar (SWIPE_RIGHT, ver motion_recognizer.py)
    — nao dispara nada sozinha, so vira gesto em movimento."""

    states = finger_states(landmarks)
    return (
        states["index"]
        and states["middle"]
        and not states["ring"]
        and not states["pinky"]
        and not states["thumb"]
    )


def is_pinch(landmarks):
    """Ponta do polegar tocando ponta do indicador. Distancia
    normalizada pelo tamanho da mao (pulso -> base do dedo medio), pra
    nao depender de quao perto da camera a mao esta. Usada pelo gesto de
    "pinca" (PINCH_EXPAND, ver motion_recognizer.py)."""

    palm_size = landmark_dist(landmarks[WRIST], landmarks[MIDDLE_MCP])
    if palm_size == 0:
        return False

    pinch_dist = landmark_dist(landmarks[THUMB_TIP], landmarks[INDEX_TIP])
    return pinch_dist < 0.4 * palm_size


# gesto -> funcao classificadora. ordem importa: a primeira que bater vence.
GESTURE_SIGNATURES = {
    "CLOSED_FIST": is_closed_fist,
    "OPEN_PALM": is_open_palm,
}


def classify(landmarks):
    for name, check in GESTURE_SIGNATURES.items():
        if check(landmarks):
            return name
    return None
