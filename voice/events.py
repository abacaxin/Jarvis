"""Protocolo de eventos entre o capture.py e o VoiceService (Node).

Mesmo formato do vision/events.py (JSON por linha em stdout) — duplicado
aqui em vez de importado de vision/ pra manter os dois modulos
independentes (voice/ deve poder rodar sem vision/ instalado, e
vice-versa).
"""

import json


def emit(event_type, payload=None):
    print(json.dumps({"type": event_type, "payload": payload or {}}), flush=True)


def emit_error(message, extra=None):
    payload = {"message": message}
    if extra:
        payload.update(extra)
    emit("voice.error", payload)
