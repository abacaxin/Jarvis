"""Teste manual de deteccao de mao (com janela de video).

Mostra a webcam por alguns segundos — coloque a mao na frente e
confirme no terminal que "mao detectada" aparece.
Roda: python vision/test/test_hand_detection.py
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import cv2

from camera.camera_source import CameraSource
from detection.hand_detector import HandDetector

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "config.json")


def main():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        config = json.load(f)

    detection_cfg = config["detection"]
    camera = CameraSource(**config["camera"])
    detector = HandDetector(
        max_num_hands=detection_cfg.get("max_num_hands", 1),
        min_detection_confidence=detection_cfg.get("min_detection_confidence", 0.6),
        min_tracking_confidence=detection_cfg.get("min_tracking_confidence", 0.5),
    )
    camera.open()

    detected_at_least_once = False
    start = time.time()

    try:
        while time.time() - start < 8:

            frame = camera.read_frame()
            if frame is None:
                continue

            hands = detector.process(frame)
            if hands:
                detected_at_least_once = True
                print(f"{len(hands)} mao(s) detectada(s) - {len(hands[0])} landmarks cada")

            cv2.imshow("test_hand_detection", frame)
            if cv2.waitKey(1) & 0xFF == 27:
                break

    finally:
        camera.release()
        detector.close()
        cv2.destroyAllWindows()

    assert detected_at_least_once, (
        "nenhuma mao detectada em 8s — aproxime a mao da camera e rode de novo"
    )
    print("OK - mao detectada pelo menos uma vez")


if __name__ == "__main__":
    main()
