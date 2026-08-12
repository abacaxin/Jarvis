"""Protocolo -> Acao.

Adicionar uma acao nova = registrar uma entrada em ACTIONS. O engine
so chama `run_action(protocolo, contexto)` — nao sabe (nem precisa saber)
o que cada protocolo faz por baixo.
"""

from actions.capture_action import save_capture

ACTIONS = {
    "PROTOCOL_CAPTURE": lambda ctx: save_capture(ctx["frame"], ctx["captures_dir"]),
}


def run_action(protocol_name, context):
    action = ACTIONS.get(protocol_name)

    if action is None:
        return None

    return action(context)
