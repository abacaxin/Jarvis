"""Overlay de debug: landmarks + conexoes + gesto/protocolo atuais.

Desenho manual com OpenCV em vez de `mp.solutions.drawing_utils` — essa
API legada nao esta disponivel no wheel do mediapipe usado aqui (ver
detection/hand_detector.py). HAND_CONNECTIONS abaixo e o mesmo esqueleto
de 21 pontos que a API legada usava, so que como constante propria.

So usado com --show (desenvolvimento local com monitor). Numa Pi
headless dentro dos oculos isso nao roda — o resto do pipeline funciona
igual sem essa camada.
"""

import cv2

# pares de indices (0-20) que formam o "esqueleto" da mao
HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),          # polegar
    (0, 5), (5, 6), (6, 7), (7, 8),          # indicador
    (5, 9), (9, 10), (10, 11), (11, 12),     # medio
    (9, 13), (13, 14), (14, 15), (15, 16),   # anelar
    (13, 17), (17, 18), (18, 19), (19, 20),  # mindinho
    (0, 17),                                 # base da palma
]


def draw_overlay(frame_bgr, hands, gesture_name, protocol_name):
    """hands: lista com 0 a N maos (cada uma = lista de 21 landmarks)."""

    height, width = frame_bgr.shape[:2]

    for hand_landmarks in hands or []:
        points = [(int(lm.x * width), int(lm.y * height)) for lm in hand_landmarks]

        for start, end in HAND_CONNECTIONS:
            cv2.line(frame_bgr, points[start], points[end], (0, 200, 0), 2)

        for x, y in points:
            cv2.circle(frame_bgr, (x, y), 4, (0, 0, 255), -1)

    text = f"gesture: {gesture_name or '-'}  protocol: {protocol_name or '-'}"
    cv2.putText(
        frame_bgr, text, (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2
    )

    return frame_bgr
