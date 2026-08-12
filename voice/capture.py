#!/usr/bin/env python3
"""Grava audio do microfone sob comando.

Aperta Enter pra comecar a gravar, Enter de novo pra parar — ativacao
manual e explicita, igual a primeira etapa da visao (gesto -> captura).
Chamado como processo filho pelo VoiceService (Node), com stdin herdado
do terminal (pra receber o Enter de verdade). Relata cada etapa como
evento JSON em stdout (ver events.py).

Uso:
    python capture.py
"""

import argparse
import json
import os
import sys
import time
import wave

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import sounddevice as sd

from events import emit, emit_error

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CONFIG_PATH = os.path.join(BASE_DIR, "config.json")


def load_config(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def record_until_enter(samplerate, channels):
    """Bloqueia ate o usuario apertar Enter, gravando o tempo todo."""

    frames = []

    def callback(indata, frame_count, time_info, status):
        frames.append(indata.copy())

    with sd.InputStream(
        samplerate=samplerate, channels=channels, dtype="float32", callback=callback
    ):
        input()

    if not frames:
        return None

    return np.concatenate(frames, axis=0)


def save_wav(path, audio, samplerate):
    # clip antes de converter pra int16 — evita "wraparound" se o mic
    # saturar (audio > 1.0), que soaria como estalo/ruido na transcricao
    clipped = np.clip(audio, -1.0, 1.0)
    audio_int16 = (clipped * 32767).astype(np.int16)

    with wave.open(path, "wb") as wf:
        wf.setnchannels(audio_int16.shape[1] if audio_int16.ndim > 1 else 1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(samplerate)
        wf.writeframes(audio_int16.tobytes())


def main():
    parser = argparse.ArgumentParser(description="Kevin Voice Capture")
    parser.add_argument("--config", default=DEFAULT_CONFIG_PATH)
    args = parser.parse_args()

    config = load_config(args.config)
    samplerate = config.get("samplerate", 16000)
    channels = config.get("channels", 1)
    recordings_dir = os.path.join(BASE_DIR, config.get("recordings_dir", "recordings"))

    emit("voice.activated", {})

    try:
        os.makedirs(recordings_dir, exist_ok=True)

        input()  # espera o primeiro Enter — comeca a gravar

        emit("voice.recording.started", {})
        audio = record_until_enter(samplerate, channels)
        emit("voice.recording.stopped", {})

        if audio is None or len(audio) == 0:
            emit_error("Nenhum audio foi gravado")
            return 1

        ts = time.strftime("%Y%m%d-%H%M%S")
        path = os.path.join(recordings_dir, f"voice-{ts}.wav")
        save_wav(path, audio, samplerate)

        duration_seconds = round(len(audio) / samplerate, 2)

        emit(
            "voice.capture.completed",
            {
                "path": path,
                "timestamp": ts,
                "duration_seconds": duration_seconds,
                "sample_rate": samplerate,
            },
        )
        return 0

    except Exception as erro:
        emit_error(str(erro))
        return 1

    finally:
        emit("voice.deactivated", {})


if __name__ == "__main__":
    sys.exit(main())
