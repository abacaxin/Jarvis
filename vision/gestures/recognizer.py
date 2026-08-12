"""Landmarks -> nome de gesto estavel.

Camada de interpretacao separada do detector: recebe pontos, devolve
significado. `update()` so retorna um gesto na transicao pra um estado
estavel (debounce) — segurar o mesmo gesto nao dispara de novo a cada
frame, e o reconhecedor reseta sozinho quando a mao some.
"""

from collections import deque

from gestures.definitions import classify


class GestureRecognizer:

    # ponytail: debounce por contagem fixa de frames (`stability_frames`).
    # Se o gesto "piscar" em hardware mais lento (Pi 3B tem FPS baixo),
    # trocar por uma media movel com peso temporal em vez de contagem crua.
    def __init__(self, stability_frames=4):
        self._stability_frames = stability_frames
        self._recent = deque(maxlen=stability_frames)
        self._confirmed = None

    def update(self, landmarks):
        raw = classify(landmarks) if landmarks is not None else None
        self._recent.append(raw)

        if raw is None:
            self._confirmed = None
            return None

        is_stable = (
            len(self._recent) == self._stability_frames
            and all(g == raw for g in self._recent)
        )

        if is_stable and raw != self._confirmed:
            self._confirmed = raw
            return raw

        return None

    def reset(self):
        self._recent.clear()
        self._confirmed = None

    def clear_recent(self):
        """Limpa so o buffer de frames recentes (decide estabilidade),
        sem tocar no gesto ja confirmado (decide se pode repetir). Usado
        depois de um cooldown/gap de tempo sem chamar update() — sem
        isso, frames de ANTES do gap ficariam misturados com frames de
        DEPOIS no mesmo buffer, podendo confirmar "estabilidade" cedo
        demais sem a pose ter sido segurada de verdade apos o gap."""
        self._recent.clear()
