"""Protocolo de eventos entre o engine Python e o VisionService (Node).

Um JSON por linha em stdout: {"type": "vision.xxx", "payload": {...}}.
Sem HTTP, sem socket — o VisionService le stdout do processo filho
linha a linha. Ver vision/interface/visionService.js.
"""

import json


def emit(event_type, payload=None):
    print(json.dumps({"type": event_type, "payload": payload or {}}), flush=True)


def emit_error(message, extra=None):
    payload = {"message": message}
    if extra:
        payload.update(extra)
    emit("vision.error", payload)
