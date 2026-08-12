"""Detector de mao: frame -> landmarks brutos (ou None).

Usa a MediaPipe Tasks API (`HandLandmarker`) em vez da API legada
`mp.solutions.hands`. Motivo: o wheel do mediapipe para Windows com
Python 3.13 nao traz `mediapipe.python.solutions` (so `mediapipe.tasks`)
— a API legada so tem wheel garantido ate Python 3.12. Tasks API tambem
e o caminho que o proprio Google recomenda hoje.

Exige um modelo baixado (.task) — ver download_model.py.

Responsabilidade unica: achar a mao e devolver os pontos. Nao interpreta
gesto nenhum — isso e trabalho do gestures/recognizer.py.
"""

import os
import time

import cv2
import mediapipe as mp
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.core.base_options import BaseOptions

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hand_landmarker.task")


class HandDetector:

    def __init__(
        self,
        max_num_hands=1,
        min_detection_confidence=0.6,
        min_tracking_confidence=0.5,
        model_path=MODEL_PATH,
    ):
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"Modelo do HandLandmarker nao encontrado em {model_path}. "
                "Rode: python vision/detection/download_model.py"
            )

        options = vision.HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model_path),
            running_mode=vision.RunningMode.VIDEO,
            num_hands=max_num_hands,
            min_hand_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
        )
        self._landmarker = vision.HandLandmarker.create_from_options(options)
        self._start = time.time()

    def process(self, frame_bgr):
        """Retorna a lista de maos detectadas (0 a max_num_hands itens);
        cada mao e uma lista de 21 landmarks."""

        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        # running_mode=VIDEO exige timestamps crescentes; usar tempo
        # decorrido desde a criacao do detector e simples e monotonico.
        timestamp_ms = int((time.time() - self._start) * 1000)

        result = self._landmarker.detect_for_video(mp_image, timestamp_ms)

        return result.hand_landmarks

    def close(self):
        self._landmarker.close()
