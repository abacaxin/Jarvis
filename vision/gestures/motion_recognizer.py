"""Gestos que dependem de MOVIMENTO ao longo do tempo, nao so uma pose
parada — complementa recognizer.py (que so lida com pose estatica +
debounce por contagem de frames).

Mantem uma janela deslizante por TEMPO (nao por numero de frames — FPS
varia bastante, principalmente na Pi) com as maos detectadas em cada
frame, e avalia regras de trajetoria sobre essa janela.
"""

import time
from collections import deque

from gestures.definitions import is_pinch, is_two_fingers_up


def _swipe_x(hand_landmarks):
    # ponto medio entre indicador e medio — a "ponta" do gesto de deslizar
    return (hand_landmarks[8].x + hand_landmarks[12].x) / 2


def _pinch_center(hand_landmarks):
    thumb, index = hand_landmarks[4], hand_landmarks[8]
    return ((thumb.x + index.x) / 2, (thumb.y + index.y) / 2)


def _pinch_centers_distance(hand_a, hand_b):
    ax, ay = _pinch_center(hand_a)
    bx, by = _pinch_center(hand_b)
    return ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5


class MotionGestureRecognizer:

    # ponytail: `pose_ratio` (so usado no SWIPE_RIGHT — a pose precisa
    # bater em >=pose_ratio dos frames, nao 100%) tolera 1-2 frames
    # ruidosos sem precisar de um filtro de suavizacao de verdade. O
    # PINCH_EXPAND ja nao usa isso — so olha inicio (pinca) e fim
    # (distancia), a pose no meio pode variar livremente. Se algum dos
    # dois disparar errado (ou nao disparar) na pratica, esses limiares
    # sao o primeiro ajuste antes de complicar a logica.
    def __init__(
        self,
        window_seconds=1.2,
        min_samples=4,
        pose_ratio=0.7,
        swipe_min_dx=0.35,
        pinch_near=0.12,
        pinch_far=0.35,
    ):
        self._window_seconds = window_seconds
        self._min_samples = min_samples
        self._pose_ratio = pose_ratio
        self._swipe_min_dx = swipe_min_dx
        self._pinch_near = pinch_near
        self._pinch_far = pinch_far
        self._samples = deque()

    def update(self, hands, now=None):
        """hands: lista com 0, 1 ou 2 maos (cada uma = lista de 21 landmarks).
        `now` e injetavel pra teste; em producao usa o relogio real."""

        if now is None:
            now = time.time()

        self._samples.append((now, hands))

        while self._samples and now - self._samples[0][0] > self._window_seconds:
            self._samples.popleft()

        if len(self._samples) < self._min_samples:
            return None

        gesture = self._check_swipe_right() or self._check_pinch_expand()

        if gesture:
            # gesto disparou — limpa a janela pra nao disparar de novo
            # enquanto a mesma trajetoria ainda esta nos samples.
            self._samples.clear()

        return gesture

    def _check_swipe_right(self):
        xs = [
            _swipe_x(hands[0])
            for _, hands in self._samples
            if len(hands) == 1 and is_two_fingers_up(hands[0])
        ]

        if len(xs) < len(self._samples) * self._pose_ratio:
            return None

        if xs[-1] - xs[0] < self._swipe_min_dx:
            return None

        # exige que o movimento seja MAJORITARIAMENTE continuo pra
        # direita, nao so o ponto inicial e final por acaso baterem —
        # sem isso, a mao "balançando" perto do corpo (movimento natural,
        # nao um deslize) as vezes termina mais a direita do que comecou
        # e contava como gesto por engano.
        steps = list(zip(xs, xs[1:]))
        forward_steps = sum(1 for a, b in steps if b >= a)
        if forward_steps < len(steps) * self._pose_ratio:
            return None

        return "SWIPE_RIGHT"

    def _check_pinch_expand(self):
        # exige a pose de "pinca" (junto e perto do centro) nos
        # PRIMEIROS frames da janela, nao so no primeiro — um unico
        # frame com landmark ruidoso nao deveria bastar pra confirmar
        # que o gesto comecou. Durante o movimento de afastar as maos os
        # dedos soltam (a pinca "abre" de proposito), entao dali em
        # diante so a distancia entre as duas maos importa, nao mais a
        # pose.
        start_count = max(2, self._min_samples // 2)
        start_window = list(self._samples)[:start_count]

        for _, hands in start_window:
            if len(hands) != 2 or not (is_pinch(hands[0]) and is_pinch(hands[1])):
                return None
            if _pinch_centers_distance(*hands) > self._pinch_near:
                return None

        last_two_hands = next(
            (hands for _, hands in reversed(self._samples) if len(hands) == 2),
            None,
        )
        if last_two_hands is None:
            return None

        if _pinch_centers_distance(*last_two_hands) >= self._pinch_far:
            return "PINCH_EXPAND"

        return None

    def reset(self):
        self._samples.clear()
