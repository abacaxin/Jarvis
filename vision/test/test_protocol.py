"""Teste puro do mapeamento gesto -> protocolo, direto do config.json.
Roda: python vision/test/test_protocol.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from protocols.protocol_map import gesture_to_protocol

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "config.json")


def main():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        config = json.load(f)

    protocol_map = config["protocols"]

    assert gesture_to_protocol("CLOSED_FIST", protocol_map) == "PROTOCOL_CAPTURE"
    assert gesture_to_protocol("GESTO_INEXISTENTE", protocol_map) is None
    print("OK - mapeamento gesto -> protocolo bate com config.json")


if __name__ == "__main__":
    main()
