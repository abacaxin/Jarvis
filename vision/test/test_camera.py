"""Teste manual da camada de camera (nao depende de mediapipe).

Abre a webcam (config.json por padrao), le um frame, confere que veio
dado valido, fecha.

Roda: python vision/test/test_camera.py
Pra achar o indice de outra camera (ex: webcam USB em vez da nativa do
notebook), sobrescreva e veja a imagem:
    python vision/test/test_camera.py --index 1 --show
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from camera.camera_source import CameraSource

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "config.json")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--index", type=int, default=None,
        help="sobrescreve camera.index do config.json"
    )
    parser.add_argument(
        "--show", action="store_true",
        help="mostra o frame numa janela, pra identificar visualmente qual camera e"
    )
    args = parser.parse_args()

    with open(CONFIG_PATH, encoding="utf-8") as f:
        camera_cfg = json.load(f)["camera"]

    if args.index is not None:
        camera_cfg["index"] = args.index

    camera = CameraSource(**camera_cfg)
    camera.open()

    try:
        frame = camera.read_frame()
        assert frame is not None, "camera nao retornou frame"
        assert frame.shape[2] == 3, "frame deveria ter 3 canais (BGR)"
        print("OK -", camera.get_info(), "frame shape:", frame.shape)

        if args.show:
            import cv2
            cv2.imshow(f"index={camera_cfg['index']} — feche a janela ou ESC", frame)
            cv2.waitKey(0)
            cv2.destroyAllWindows()

    finally:
        camera.release()


if __name__ == "__main__":
    main()
