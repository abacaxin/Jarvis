"""Baixa o modelo do HandLandmarker (Tasks API) uma vez.

Fonte oficial: bucket publico do Google (mediapipe-models). Arquivo cai
em vision/detection/hand_landmarker.task (~7.5MB, fora do git — ver
.gitignore) e e o mesmo path que HandDetector usa por padrao.

Roda: python vision/detection/download_model.py
"""

import os
import urllib.request

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
)
DEST_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hand_landmarker.task")


def main():
    if os.path.exists(DEST_PATH):
        print(f"Ja existe: {DEST_PATH}")
        return

    print(f"Baixando {MODEL_URL} ...")
    urllib.request.urlretrieve(MODEL_URL, DEST_PATH)
    size_mb = os.path.getsize(DEST_PATH) / (1024 * 1024)
    print(f"OK - salvo em {DEST_PATH} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
