"""Teste da acao de captura: salva um frame falso (array numpy preto) em
disco e confere a metadata devolvida. Nao depende de camera nem mediapipe.
Roda: python vision/test/test_capture.py
"""

import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np

from actions.capture_action import save_capture

TEST_DIR = os.path.join(os.path.dirname(__file__), "_tmp_captures")


def main():
    frame = np.zeros((240, 320, 3), dtype=np.uint8)

    result = save_capture(frame, TEST_DIR)

    assert os.path.exists(result["path"]), "arquivo da captura nao foi criado"
    assert result["resolution"] == "320x240"
    assert result["type"] == "photo"
    print("OK -", result)

    shutil.rmtree(TEST_DIR)


if __name__ == "__main__":
    main()
