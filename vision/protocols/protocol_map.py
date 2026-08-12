"""Gesto -> Protocolo.

O reconhecedor de gestos nao sabe (nem deve saber) que acao vai rodar.
O mapeamento vem do config.json (`protocols`) — trocar a acao de um
gesto e so editar o JSON, sem tocar em gestures/ nem em actions/.
"""


def gesture_to_protocol(gesture_name, protocol_map):
    return protocol_map.get(gesture_name)
