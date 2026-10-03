"""Aplica e confere o modelo editorial no Directus (v5.3) - idempotente, sem nunca imprimir segredo.

    python scripts/directus_configurar.py aplicar      # cria o que falta (pastas, coleções, perfis)
    python scripts/directus_configurar.py verificar    # só leitura; exit 1 se algo estiver fora do modelo
    ... --producao   # cms.asaf.org.br: a senha do administrador vem do Key Vault (az), em memória - não é impressa

O que vem de `scripts/directus_modelo.py`. Conexão por variáveis de ambiente (nunca por argumento):
    DIRECTUS_URL        padrão https://cms.asaf.org.br
    DIRECTUS_TOKEN      token estático de administrador (opção 1), OU
    DIRECTUS_EMAIL + DIRECTUS_PASSWORD (+ DIRECTUS_OTP se o MFA estiver ligado)  (opção 2: faz login)

`aplicar` só ACRESCENTA: cria pasta/coleção/campo/perfil/permissão que falta e corrige permissão cujo
conteúdo difere do modelo. Não apaga coleção, campo nem dado nenhum.
"""
from __future__ import annotations

import os
import sys
from typing import Any

import httpx2

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import directus_modelo as modelo
else:  # importado como pacote (testes)
    from . import directus_modelo as modelo

URL_PADRAO = "https://cms.asaf.org.br"
COFRE_PADRAO = "kv-asaf-arca"
SEGREDO_SENHA_ADMIN = "DIRECTUS-ADMIN-PASSWORD"
EMAIL_ADMIN_PADRAO = "asaf@asaf.org.br"
# O Directus de produção "acorda" em ~35 s depois de escalar a zero.
TEMPO_LIMITE = 90.0


class ErroDirectus(RuntimeError):
    pass


# No Directus 12 a "regra de permissão personalizada" (filtro por linha, validação, predefinição)
# é recurso LICENCIADO. Sem a entitlement, o POST /permissions devolve este texto.
MARCA_LICENCA = "custom_permission_rules_enabled"
AVISO_LICENCA = (
    "LICENÇA: esta instância do Directus não permite regras de permissão personalizadas "
    "(custom_permission_rules_enabled). Os perfis que dependem delas NÃO foram configurados."
)


class Cliente:
    def __init__(self, base: str, token: str, http: httpx2.Client | None = None) -> None:
        self.base = base.rstrip("/")
        self._http = http or httpx2.Client(timeout=TEMPO_LIMITE)
        self._cab = {"Authorization": f"Bearer {token}"}

    def _pedir(self, metodo: str, caminho: str, **kw: Any) -> Any:
        r = self._http.request(metodo, f"{self.base}{caminho}", headers=self._cab, **kw)
        if r.status_code >= 400:
            try:
                msg = "; ".join(e.get("message", "") for e in r.json().get("errors", []))
            except Exception:  # corpo que não é JSON
                msg = r.text[:200]
            raise ErroDirectus(f"{metodo} {caminho} -> HTTP {r.status_code}: {msg}")
        if r.status_code == 204 or not r.content:
            return None
        return r.json().get("data")

    def ler(self, caminho: str, **params: Any) -> Any:
        return self._pedir("GET", caminho, params=params or None)

    def criar(self, caminho: str, corpo: dict) -> Any:
        return self._pedir("POST", caminho, json=corpo)

    def alterar(self, caminho: str, corpo: dict) -> Any:
        return self._pedir("PATCH", caminho, json=corpo)

    def apagar(self, caminho: str) -> None:
        self._pedir("DELETE", caminho)


def entrar(base: str, email: str, senha: str, otp: str | None = None, http: httpx2.Client | None = None) -> str:
    """Login por e-mail/senha -> token de acesso (vale poucos minutos; o script termina antes)."""
    http = http or httpx2.Client(timeout=TEMPO_LIMITE)
    corpo = {"email": email, "password": senha, "mode": "json"}
    if otp:
        corpo["otp"] = otp
    r = http.post(f"{base.rstrip('/')}/auth/login", json=corpo)
    if r.status_code >= 400:
        raise ErroDirectus(f"login recusado (HTTP {r.status_code}); confira e-mail, senha e, se o MFA estiver ligado, DIRECTUS_OTP")
    return r.json()["data"]["access_token"]


def senha_do_cofre(cofre: str = COFRE_PADRAO, segredo: str = SEGREDO_SENHA_ADMIN) -> str:
    """Lê o segredo do Key Vault pelo `az` (login do próprio usuário). Só devolve - nunca imprime."""
    import shutil
    import subprocess

    az = shutil.which("az")
    if az is None:
        raise SystemExit("Azure CLI (az) não encontrado; faça login ou use DIRECTUS_PASSWORD/DIRECTUS_TOKEN")
    r = subprocess.run([az, "keyvault", "secret", "show", "--vault-name", cofre, "--name", segredo,
                        "--query", "value", "-o", "tsv"], capture_output=True, text=True, timeout=120)
    if r.returncode != 0 or not r.stdout.strip():
        raise SystemExit(f"não consegui ler {segredo} no Key Vault {cofre} (az login? permissão?)")
    return r.stdout.strip()


def cliente_do_ambiente(env: dict[str, str] | None = None, producao: bool = False) -> Cliente:
    env = env if env is not None else dict(os.environ)
    base = env.get("DIRECTUS_URL", URL_PADRAO)
    if producao and not env.get("DIRECTUS_TOKEN") and not env.get("DIRECTUS_PASSWORD"):
        env = {**env, "DIRECTUS_EMAIL": env.get("DIRECTUS_EMAIL", EMAIL_ADMIN_PADRAO),
               "DIRECTUS_PASSWORD": senha_do_cofre()}
    if env.get("DIRECTUS_TOKEN"):
        return Cliente(base, env["DIRECTUS_TOKEN"])
    if env.get("DIRECTUS_EMAIL") and env.get("DIRECTUS_PASSWORD"):
        return Cliente(base, entrar(base, env["DIRECTUS_EMAIL"], env["DIRECTUS_PASSWORD"], env.get("DIRECTUS_OTP")))
    raise SystemExit("defina DIRECTUS_TOKEN, ou DIRECTUS_EMAIL + DIRECTUS_PASSWORD (+ DIRECTUS_OTP)")


# ----------------------------------------------------------------------------------------- pastas
def garantir_pastas(c: Cliente, relatorio: list[str]) -> dict[str, str]:
    """Cria as pastas do modelo. Devolve {nome da pasta: id}."""
    existentes = c.ler("/folders", limit=-1, fields="id,name,parent")
    por_chave = {(p["name"], p["parent"]): p["id"] for p in existentes}
    ids: dict[str, str] = {}

    def garantir(nome: str, pai: str | None) -> str:
        chave = (nome, pai)
        if chave not in por_chave:
            criada = c.criar("/folders", {"name": nome, "parent": pai})
            por_chave[chave] = criada["id"]
            relatorio.append(f"pasta criada: {nome}")
        return por_chave[chave]

    for pasta in modelo.PASTAS:
        id_mae = garantir(pasta["nome"], None)
        ids[pasta["nome"]] = id_mae
        for filha in pasta["filhas"]:
            ids[filha] = garantir(filha, id_mae)
    return ids


# --------------------------------------------------------------------------------------- coleções
def _campo_para_api(campo: dict, colecao: str) -> dict:
    meta = {k: v for k, v in campo["meta"].items()}
    return {"field": campo["field"], "type": campo["type"], "meta": meta, "schema": dict(campo["schema"])}


def garantir_colecoes(c: Cliente, relatorio: list[str], pastas: dict[str, str]) -> None:
    existentes = {x["collection"] for x in c.ler("/collections")}
    for definicao in modelo.COLECOES:
        nome = definicao["colecao"]
        campos = [_campo_para_api(f, nome) for f in definicao["campos"]]
        if nome not in existentes:
            c.criar("/collections", {
                "collection": nome,
                "meta": definicao["meta"],
                "schema": {},
                "fields": campos,
            })
            relatorio.append(f"coleção criada: {nome}")
        else:
            atuais = {f["field"] for f in c.ler(f"/fields/{nome}")}
            for campo in campos:
                if campo["field"] not in atuais:
                    c.criar(f"/fields/{nome}", campo)
                    relatorio.append(f"campo criado: {nome}.{campo['field']}")
        _garantir_relacoes(c, definicao, relatorio)


def _garantir_relacoes(c: Cliente, definicao: dict, relatorio: list[str]) -> None:
    nome = definicao["colecao"]
    existentes = {(r["collection"], r["field"]) for r in c.ler("/relations", limit=-1)}
    for rel in definicao.get("relacoes", []):
        if (nome, rel["campo"]) not in existentes:
            c.criar("/relations", {"collection": nome, "field": rel["campo"], "related_collection": rel["para"],
                                   "schema": {"on_delete": "SET NULL"}})
            relatorio.append(f"relação criada: {nome}.{rel['campo']} -> {rel['para']}")


# ------------------------------------------------------------------------------- perfis e permissões
def _permissao_para_api(politica: str, p: dict) -> dict:
    return {
        "policy": politica, "collection": p["colecao"], "action": p["acao"],
        "permissions": p["filtro"] or None, "validation": p["validacao"] or None,
        "presets": p["predefinicao"] or None, "fields": p["campos"],
    }


def _normalizar(valor: Any) -> Any:
    return valor if valor not in ({}, [], "") else None


def garantir_perfis(c: Cliente, relatorio: list[str]) -> dict[str, str]:
    """Cria política + papel por perfil e as permissões. Devolve {nome do perfil: id do papel}."""
    politicas = {p["name"]: p["id"] for p in c.ler("/policies", limit=-1, fields="id,name")}
    papeis = {r["name"]: r["id"] for r in c.ler("/roles", limit=-1, fields="id,name")}
    ids_papeis: dict[str, str] = {}
    for perfil in modelo.PERFIS:
        nome = perfil["nome"]
        if nome not in politicas:
            politicas[nome] = c.criar("/policies", {
                "name": nome, "icon": perfil["icone"], "description": perfil["descricao"],
                "admin_access": False, "app_access": perfil["app_access"], "enforce_tfa": perfil["app_access"],
            })["id"]
            relatorio.append(f"política criada: {nome}")
        if nome not in papeis:
            papeis[nome] = c.criar("/roles", {
                "name": nome, "icon": perfil["icone"], "description": perfil["descricao"],
                "policies": [{"policy": politicas[nome]}],
            })["id"]
            relatorio.append(f"papel criado: {nome}")
        ids_papeis[nome] = papeis[nome]
        _garantir_permissoes(c, politicas[nome], perfil, relatorio)
    return ids_papeis


def _garantir_permissoes(c: Cliente, politica: str, perfil: dict, relatorio: list[str]) -> None:
    atuais = c.ler("/permissions", limit=-1, **{"filter[policy][_eq]": politica})
    por_chave = {(p["collection"], p["action"]): p for p in atuais}
    desejadas = {(p["colecao"], p["acao"]): p for p in perfil["permissoes"]}
    for chave, p in desejadas.items():
        alvo = _permissao_para_api(politica, p)
        existente = por_chave.get(chave)
        try:
            if existente is None:
                c.criar("/permissions", alvo)
                relatorio.append(f"permissão criada: {perfil['nome']} / {chave[0]} / {chave[1]}")
            elif any(_normalizar(existente.get(k)) != _normalizar(alvo[k]) for k in ("permissions", "validation", "presets", "fields")):
                c.alterar(f"/permissions/{existente['id']}", {k: alvo[k] for k in ("permissions", "validation", "presets", "fields")})
                relatorio.append(f"permissão corrigida: {perfil['nome']} / {chave[0]} / {chave[1]}")
        except ErroDirectus as erro:
            if MARCA_LICENCA not in str(erro):
                raise
            if AVISO_LICENCA not in relatorio:
                relatorio.append(AVISO_LICENCA)
    for chave, existente in por_chave.items():
        if chave not in desejadas:  # privilégio mínimo: o que não está no modelo não pode existir
            c.apagar(f"/permissions/{existente['id']}")
            relatorio.append(f"permissão removida (fora do modelo): {perfil['nome']} / {chave[0]} / {chave[1]}")


# ----------------------------------------------------------------------------------------- verificar
def verificar(c: Cliente) -> list[str]:
    """Lê o Directus e devolve a lista de problemas (vazia = tudo conforme o modelo)."""
    problemas: list[str] = []
    colecoes = {x["collection"] for x in c.ler("/collections")}
    for nome in sorted(c_ for c_ in colecoes if not c_.startswith("directus_")):
        if nome not in modelo.COLECOES_PERMITIDAS:
            problemas.append(f"coleção fora do modelo: {nome} (o Directus só guarda conteúdo editorial)")
    for definicao in modelo.COLECOES:
        nome = definicao["colecao"]
        if nome not in colecoes:
            problemas.append(f"coleção ausente: {nome}")
            continue
        atuais = {f["field"] for f in c.ler(f"/fields/{nome}")}
        for campo in definicao["campos"]:
            if campo["field"] not in atuais:
                problemas.append(f"campo ausente: {nome}.{campo['field']}")
    pastas = {(p["name"]) for p in c.ler("/folders", limit=-1, fields="name")}
    for pasta in modelo.PASTAS:
        for nome in (pasta["nome"], *pasta["filhas"]):
            if nome not in pastas:
                problemas.append(f"pasta ausente: {nome}")
    politicas = {p["name"]: p for p in c.ler("/policies", limit=-1, fields="id,name,admin_access,app_access,enforce_tfa")}
    for perfil in modelo.PERFIS:
        pol = politicas.get(perfil["nome"])
        if pol is None:
            problemas.append(f"perfil ausente: {perfil['nome']}")
            continue
        if pol["admin_access"]:
            problemas.append(f"perfil com acesso de administrador (proibido): {perfil['nome']}")
        if bool(pol["app_access"]) != perfil["app_access"]:
            problemas.append(f"perfil com acesso ao Studio diferente do modelo: {perfil['nome']}")
        atuais = c.ler("/permissions", limit=-1, **{"filter[policy][_eq]": pol["id"]})
        existentes = {(p["collection"], p["action"]): p for p in atuais}
        desejadas = {(p["colecao"], p["acao"]): p for p in perfil["permissoes"]}
        for chave in sorted(set(existentes) - set(desejadas)):
            problemas.append(f"permissão a mais: {perfil['nome']} / {chave[0]} / {chave[1]}")
        for chave, p in desejadas.items():
            ex = existentes.get(chave)
            if ex is None:
                problemas.append(f"permissão ausente: {perfil['nome']} / {chave[0]} / {chave[1]}")
                continue
            alvo = _permissao_para_api(pol["id"], p)
            if any(_normalizar(ex.get(k)) != _normalizar(alvo[k]) for k in ("permissions", "validation", "presets", "fields")):
                problemas.append(f"permissão diferente do modelo: {perfil['nome']} / {chave[0]} / {chave[1]}")
    return problemas


def aplicar(c: Cliente) -> list[str]:
    relatorio: list[str] = []
    pastas = garantir_pastas(c, relatorio)
    garantir_colecoes(c, relatorio, pastas)
    garantir_perfis(c, relatorio)
    return relatorio


def main(argv: list[str]) -> int:
    producao = "--producao" in argv
    argv = [a for a in argv if a != "--producao"]
    if len(argv) != 2 or argv[1] not in ("aplicar", "verificar"):
        print(__doc__)
        return 2
    c = cliente_do_ambiente(producao=producao)
    if argv[1] == "aplicar":
        feito = aplicar(c)
        print("\n".join(f"  + {x}" for x in feito) if feito else "nada a fazer: já está conforme o modelo.")
    problemas = verificar(c)
    if problemas:
        print("\nPROBLEMAS:")
        print("\n".join(f"  ! {p}" for p in problemas))
        return 1
    print("\nOK: o Directus está conforme o modelo.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
