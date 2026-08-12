"""Acao de captura: salva um frame em disco e devolve metadata.

Unica capacidade visual real desta etapa. Nao faz OCR, deteccao de
objeto nem analise semantica — so grava a imagem e informa onde/quando/
que resolucao, para o Kevin poder encaminhar o arquivo depois.
"""

import os
import time

import cv2


def save_capture(frame_bgr, captures_dir):
    os.makedirs(captures_dir, exist_ok=True)

    ts = time.strftime("%Y%m%d-%H%M%S")
    filename = f"capture-{ts}.jpg"
    path = os.path.join(captures_dir, filename)

    cv2.imwrite(path, frame_bgr)

    height, width = frame_bgr.shape[:2]

    return {
        "path": path,
        "timestamp": ts,
        "resolution": f"{width}x{height}",
        "type": "photo",
    }
