"""Fonte de frames da webcam.

Unica classe que sabe abrir/ler/fechar uma camera. Trocar a webcam USB
pela camera dos oculos no futuro = trocar so este arquivo — nada em
detection/, gestures/, protocols/ ou actions/ depende de como o frame
foi capturado.
"""

import platform

import cv2


class CameraSource:

    def __init__(self, index=0, width=320, height=240, fps=15):
        self._index = index
        self._width = width
        self._height = height
        self._fps = fps
        self._cap = None

    def open(self):
        # No Windows, o backend padrao (Media Foundation) e conhecido por
        # travar/demorar demais pra abrir a camera, especialmente logo
        # depois de um open/close anterior — DirectShow abre na hora.
        # Em Linux/Pi (V4L2) o padrao ja funciona bem, sem essa troca.
        backend = cv2.CAP_DSHOW if platform.system() == "Windows" else cv2.CAP_ANY
        self._cap = cv2.VideoCapture(self._index, backend)
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._width)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._height)
        self._cap.set(cv2.CAP_PROP_FPS, self._fps)

        if not self._cap.isOpened():
            raise RuntimeError(
                f"Nao foi possivel abrir a camera (index={self._index})"
            )

    def read_frame(self):
        if self._cap is None:
            raise RuntimeError("Camera nao foi aberta — chame open() primeiro")

        ok, frame = self._cap.read()
        return frame if ok else None

    def get_info(self):
        return {
            "index": self._index,
            "width": int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            "height": int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            "fps": self._cap.get(cv2.CAP_PROP_FPS),
        }

    def release(self):
        if self._cap is not None:
            self._cap.release()
            self._cap = None
