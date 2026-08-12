#!/usr/bin/env python3
"""Processo persistente que fala texto sob demanda, via Edge TTS.

Le uma linha de texto por vez do stdin, fala uma de cada vez, ate o
stdin fechar. Fica vivo entre falas — o import (edge_tts+pygame) e o
`pygame.mixer.init()` sao pagos uma vez so, na subida (ver
docs/decisoes.md sobre o motivo).

Edge TTS (voz neural da Microsoft) em vez de ElevenLabs — a Groq nao
tem TTS em portugues (so ingles/arabe). ElevenLabs foi tentado, mas o
plano free deles aparentemente exige cartao/pode cobrar; Edge TTS e
gratis de verdade, sem conta, sem chave de API. Ver docs/decisoes.md
pra o historico completo (foi Edge TTS -> ElevenLabs -> Edge TTS de
novo — o "robotico" original era em boa parte um bug de encoding
separado, ja corrigido, nao a voz em si).

Chamado como processo filho de longa duracao pelo VoiceService (Node).
Relata cada etapa como evento JSON em stdout (ver events.py).

Uso:
    python speak_server.py
    (depois, uma linha de texto por stdin = uma fala)
"""

import asyncio
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# precisa vir ANTES de importar pygame — sem isso ele imprime uma
# mensagem de boas-vindas no stdout, que quebra o protocolo de eventos
# JSON-por-linha (ver events.py).
os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")

import edge_tts
import pygame

from events import emit, emit_error

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CONFIG_PATH = os.path.join(BASE_DIR, "config.json")


def load_config(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


async def synthesize(text, voice, output_path, pitch, rate):
    communicate = edge_tts.Communicate(text, voice, pitch=pitch, rate=rate)
    await communicate.save(output_path)


def speak_one(text, voice, pitch, rate, recordings_dir):
    emit("voice.speaking.started", {})

    path = None

    try:
        # ms desde epoch — unico o suficiente mesmo se duas falas
        # cairem no mesmo segundo (time.strftime nao tem microssegundos).
        ts = int(time.time() * 1000)
        path = os.path.join(recordings_dir, f"speech-{ts}.mp3")

        asyncio.run(synthesize(text, voice, path, pitch, rate))

        pygame.mixer.music.load(path)
        pygame.mixer.music.play()
        while pygame.mixer.music.get_busy():
            time.sleep(0.1)

        # no Windows o pygame mantem o arquivo travado ate un-load-ar ou
        # dar quit() no mixer — como o mixer fica vivo entre falas
        # (nao da quit() a cada uma), sem isso o os.remove() de baixo
        # falha com "arquivo em uso por outro processo".
        pygame.mixer.music.unload()

        emit("voice.speaking.completed", {})

    except Exception as erro:
        emit_error(str(erro))

    finally:
        if path and os.path.exists(path):
            os.remove(path)


def main():
    config = load_config(DEFAULT_CONFIG_PATH)
    voice = config.get("tts_voice", "pt-BR-AntonioNeural")
    pitch = config.get("tts_pitch", "+0Hz")
    rate = config.get("tts_rate", "+0%")
    recordings_dir = os.path.join(BASE_DIR, config.get("recordings_dir", "recordings"))
    os.makedirs(recordings_dir, exist_ok=True)

    pygame.mixer.init()

    emit("voice.speak_server.ready", {})

    try:
        for line in sys.stdin:
            text = line.strip()
            if text:
                speak_one(text, voice, pitch, rate, recordings_dir)

    except KeyboardInterrupt:
        pass

    finally:
        pygame.mixer.quit()
        emit("voice.deactivated", {})

    return 0


if __name__ == "__main__":
    sys.exit(main())
