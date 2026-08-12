"""Teste puro (sem microfone) da gravacao em .wav — gera um tom
sintetico, salva, confere que o arquivo abre com os parametros certos.
Roda: python voice/test/test_save_wav.py
"""

import os
import shutil
import sys
import wave

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np

from capture import save_wav

TEST_DIR = os.path.join(os.path.dirname(__file__), "_tmp_recordings")
TEST_PATH = os.path.join(TEST_DIR, "test.wav")


def main():
    os.makedirs(TEST_DIR, exist_ok=True)

    samplerate = 16000
    duration_seconds = 0.5
    t = np.linspace(0, duration_seconds, int(samplerate * duration_seconds), endpoint=False)
    audio = (0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float32).reshape(-1, 1)

    save_wav(TEST_PATH, audio, samplerate)

    with wave.open(TEST_PATH, "rb") as wf:
        assert wf.getnchannels() == 1
        assert wf.getsampwidth() == 2
        assert wf.getframerate() == samplerate
        assert wf.getnframes() == len(audio)

    print("OK - wav salvo com samplerate/canais/bits corretos")

    shutil.rmtree(TEST_DIR)


if __name__ == "__main__":
    main()
