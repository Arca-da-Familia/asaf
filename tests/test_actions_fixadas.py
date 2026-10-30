"""v7.4a (FASE 7) - toda action dos fluxos é fixada no SHA exato, com a versão em comentário (achado da análise automática do código, CodeQL
`actions/unpinned-tag`): o rótulo `@v7` pode ser movido por quem controla a action e passar a rodar outro código com acesso aos segredos e ao Azure; o SHA
não muda. O Dependabot (.github/dependabot.yml) atualiza o SHA e o comentário juntos."""
import re
from pathlib import Path

FLUXOS = Path(__file__).resolve().parent.parent / ".github"
USO = re.compile(r"^\s*-?\s*uses:\s*(\S+)(.*)$")


def test_toda_action_esta_fixada_no_sha_com_a_versao_em_comentario():
    soltas = []
    for p in sorted((FLUXOS / "workflows").glob("*.yml")):
        for n, linha in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            m = USO.match(linha)
            if not m or m.group(1).startswith("./"):
                continue
            if not re.fullmatch(r"[\w.\-]+/[\w.\-/]+@[0-9a-f]{40}", m.group(1)) or not re.match(r"\s+# v\d", m.group(2)):
                soltas.append(f"{p.name}:{n}: {linha.strip()}")
    assert soltas == [], "action sem SHA fixo (ou sem a versão em comentário):\n" + "\n".join(soltas)


def test_o_dependabot_atualiza_as_actions():
    texto = (FLUXOS / "dependabot.yml").read_text(encoding="utf-8")
    assert "package-ecosystem: github-actions" in texto and "interval: weekly" in texto
