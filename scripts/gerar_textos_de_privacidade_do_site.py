"""v7.1a - grava em site/src/data/textos-de-privacidade.json a versão atual de cada aviso de privacidade (app/textos_de_privacidade.py), que os formulários do site mostram.

O site não escreve o texto do aviso: lê deste arquivo, que sai do catálogo do servidor (tests/test_textos_de_privacidade.py reprova se o arquivo estiver diferente do catálogo).
Rodar depois de mudar um aviso:  .venv/Scripts/python.exe scripts/gerar_textos_de_privacidade_do_site.py"""
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from app import textos_de_privacidade  # noqa: E402

DESTINO = RAIZ / "site" / "src" / "data" / "textos-de-privacidade.json"


def conteudo() -> str:
    return json.dumps(textos_de_privacidade.para_o_site(), ensure_ascii=False, indent=2) + "\n"


if __name__ == "__main__":
    DESTINO.write_text(conteudo(), encoding="utf-8", newline="\n")
    print(f"gravado: {DESTINO.relative_to(RAIZ)}")
