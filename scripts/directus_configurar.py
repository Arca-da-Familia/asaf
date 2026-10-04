"""Aplica e confere o modelo editorial no Directus (v5.3) - idempotente, sem nunca imprimir segredo.

    python scripts/directus_configurar.py aplicar      # cria o que falta (pastas, coleções, perfis)
    python scripts/directus_configurar.py verificar    # só leitura; exit 1 se algo estiver fora do modelo
    python scripts/directus_configurar.py criar-leitor [--rotacionar]
                       # cria a conta de serviço "Leitor do site" (só lê o publicado), gera o token, guarda no
                       # Key Vault (DIRECTUS-SITE-TOKEN) - o valor NUNCA é impresso. --rotacionar troca o token.
    ... --producao   # cms.asaf.org.br; o token vem de .env.directus ou do arquivo de credenciais (ver abaixo)

O que vem de `scripts/directus_modelo.py`. Conexão por variáveis de ambiente (nunca por argumento):
    DIRECTUS_URL        padrão https://cms.asaf.org.br
    Onde o script procura o token do Directus (nesta ordem; só usa o primeiro que achar):
      1. variável DIRECTUS_TOKEN;
      2. linha `DIRECTUS_TOKEN=...` em `.env.directus` (raiz; fora do Git: `.env.*` está no .gitignore);
      3. (só com --producao) linha `DIRECTUS_TOKEN=...` em CREDENCIAIS_AZURE.md. Se o arquivo estiver cifrado
         (SOPS), é decifrado SÓ NA MEMÓRIA: a saída do `sops -d` é capturada, só esse valor é usado, e nada
         vai a disco nem à tela - o arquivo continua cifrado o tempo todo;
      4. (só com --producao --senha-do-cofre) login com a senha do administrador guardada no Key Vault;
      5. DIRECTUS_EMAIL + DIRECTUS_PASSWORD (+ DIRECTUS_OTP se o MFA estiver ligado).

`aplicar` só ACRESCENTA: cria pasta/coleção/campo/perfil/permissão que falta e corrige permissão cujo
conteúdo difere do modelo. Não apaga coleção, campo nem dado nenhum.
"""
from __future__ import annotations

import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
from typing import Any

import httpx2

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import directus_modelo as modelo
else:  # importado como pacote (testes)
    from . import directus_modelo as modelo

URL_PADRAO = "https://cms.asaf.org.br"
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # raiz do repositório, de qualquer pasta
ARQUIVO_TOKEN = os.path.join(RAIZ, ".env.directus")
ARQUIVO_CREDENCIAIS = os.path.join(RAIZ, "CREDENCIAIS_AZURE.md")  # cifrado com SOPS/age (ver .sops.yaml)
MARCAS_SOPS = ('"sops"', "ENC[AES256_GCM")  # as mesmas que o hook pre-commit usa para reconhecer arquivo cifrado
COFRE_PADRAO = "kv-asaf-arca"
SEGREDO_SENHA_ADMIN = "DIRECTUS-ADMIN-PASSWORD"
EMAIL_ADMIN_PADRAO = "asaf@asaf.org.br"
EMAIL_LEITOR = "leitor-do-site@asaf.org.br"  # conta de serviço (só API; sem caixa de e-mail e sem Studio)
PERFIL_LEITOR = "Leitor do site"
SEGREDO_TOKEN_SITE = "DIRECTUS-SITE-TOKEN"
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


def ler_arquivo_env(caminho: str) -> dict[str, str]:
    """Lê linhas CHAVE=valor (ignora vazias e # comentário; tira aspas e espaços). Não imprime nada."""
    valores: dict[str, str] = {}
    try:
        with open(caminho, encoding="utf-8-sig") as f:
            for linha in f:
                linha = linha.strip()
                if not linha or linha.startswith("#") or "=" not in linha:
                    continue
                chave, _, valor = linha.partition("=")
                valores[chave.strip()] = valor.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return valores


def token_das_credenciais(caminho: str | None = None) -> str | None:
    """Lê `DIRECTUS_TOKEN=` do arquivo de credenciais e devolve SÓ esse valor (ou None se não houver).

    Cifrado com SOPS => decifra em memória (`sops -d`, saída capturada). Nunca escreve o texto puro em
    disco, nunca imprime, e descarta o resto do arquivo assim que acha a linha."""
    caminho = caminho or ARQUIVO_CREDENCIAIS
    try:
        with open(caminho, encoding="utf-8") as f:
            texto = f.read()
    except FileNotFoundError:
        return None
    if any(marca in texto for marca in MARCAS_SOPS):
        sops = shutil.which("sops")
        if sops is None:
            raise SystemExit("o arquivo de credenciais está cifrado e o `sops` não foi encontrado no PATH")
        r = subprocess.run([sops, "-d", caminho], capture_output=True, text=True, encoding="utf-8", timeout=60)
        if r.returncode != 0:
            raise SystemExit("não consegui decifrar o arquivo de credenciais (a chave age fica na pasta sops\\age do AppData)")
        texto = r.stdout
    achou = re.search(r"""^[ \t>*`-]*DIRECTUS_TOKEN[ \t]*[=:][ \t]*[`"']?([^\s`"']+)""", texto, re.M)
    return achou.group(1) if achou else None


def cliente_do_ambiente(env: dict[str, str] | None = None, producao: bool = False,
                        arquivo_token: str | None = None, arquivo_credenciais: str | None = None,
                        usar_senha_do_cofre: bool = False) -> Cliente:
    env = env if env is not None else dict(os.environ)
    arquivo_token = arquivo_token or ARQUIVO_TOKEN
    if not env.get("DIRECTUS_TOKEN") and os.path.exists(arquivo_token):
        do_arquivo = ler_arquivo_env(arquivo_token)
        if do_arquivo.get("DIRECTUS_TOKEN"):  # arquivo ainda em branco (modelo não preenchido) = ignora
            env = {**env, **{k: v for k, v in do_arquivo.items() if k in ("DIRECTUS_TOKEN", "DIRECTUS_URL")}}
    if producao and not env.get("DIRECTUS_TOKEN"):
        das_credenciais = token_das_credenciais(arquivo_credenciais)
        if das_credenciais:
            env = {**env, "DIRECTUS_TOKEN": das_credenciais}
    base = env.get("DIRECTUS_URL", URL_PADRAO)
    if producao and usar_senha_do_cofre and not env.get("DIRECTUS_TOKEN") and not env.get("DIRECTUS_PASSWORD"):
        env = {**env, "DIRECTUS_EMAIL": env.get("DIRECTUS_EMAIL", EMAIL_ADMIN_PADRAO),
               "DIRECTUS_PASSWORD": senha_do_cofre()}
    if env.get("DIRECTUS_TOKEN"):
        return Cliente(base, env["DIRECTUS_TOKEN"])
    if env.get("DIRECTUS_EMAIL") and env.get("DIRECTUS_PASSWORD"):
        return Cliente(base, entrar(base, env["DIRECTUS_EMAIL"], env["DIRECTUS_PASSWORD"], env.get("DIRECTUS_OTP")))
    raise SystemExit("nenhuma credencial do Directus encontrada: cole `DIRECTUS_TOKEN=...` em .env.directus ou em "
                     "CREDENCIAIS_AZURE.md (e use --producao), ou defina DIRECTUS_TOKEN / DIRECTUS_EMAIL + DIRECTUS_PASSWORD")


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
    schema = None if campo["type"] == "alias" else dict(campo["schema"])  # seção do formulário não tem coluna
    return {"field": campo["field"], "type": campo["type"], "meta": meta, "schema": schema}


def garantir_colecoes(c: Cliente, relatorio: list[str], pastas: dict[str, str]) -> None:
    atuais_colecoes = {x["collection"]: x for x in c.ler("/collections")}
    existentes = set(atuais_colecoes)
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
            _ajustar_meta_da_colecao(c, definicao, atuais_colecoes[nome], relatorio)
            atuais = {f["field"]: f for f in c.ler(f"/fields/{nome}")}
            for campo in campos:
                if campo["field"] not in atuais:
                    c.criar(f"/fields/{nome}", campo)
                    relatorio.append(f"campo criado: {nome}.{campo['field']}")
                else:
                    _ajustar_meta_do_campo(c, nome, campo, atuais[campo["field"]], relatorio)
        _garantir_relacoes(c, definicao, relatorio)


# O que é só APRESENTAÇÃO do campo (seção, ordem, rótulo, largura, dica...). O modelo manda: se alguém mexeu
# na tela, o próximo `aplicar` devolve. Dado e tipo do campo nunca são tocados aqui.
CHAVES_DE_APRESENTACAO = ("group", "sort", "width", "note", "interface", "options", "display", "display_options",
                          "translations", "conditions", "required", "hidden", "readonly")


CHAVES_DE_APRESENTACAO_DA_COLECAO = ("icon", "note", "display_template", "translations", "archive_field", "archive_value",
                                     "unarchive_value", "sort_field", "versioning")


def _ajustar_meta_da_colecao(c: Cliente, definicao: dict, atual: dict, relatorio: list[str]) -> None:
    meta_atual = atual.get("meta") or {}
    mudancas = {k: v for k, v in definicao["meta"].items()
                if k in CHAVES_DE_APRESENTACAO_DA_COLECAO and _normalizar(meta_atual.get(k)) != _normalizar(v)}
    if mudancas:
        c.alterar(f"/collections/{definicao['colecao']}", {"meta": mudancas})
        relatorio.append(f"coleção ajustada ({', '.join(sorted(mudancas))}): {definicao['colecao']}")


def _ajustar_meta_do_campo(c: Cliente, colecao: str, desejado: dict, atual: dict, relatorio: list[str]) -> None:
    meta_atual = atual.get("meta") or {}
    mudancas = {k: v for k, v in desejado["meta"].items()
                if k in CHAVES_DE_APRESENTACAO and _normalizar(meta_atual.get(k)) != _normalizar(v)}
    if mudancas:
        c.alterar(f"/fields/{colecao}/{desejado['field']}", {"meta": mudancas})
        relatorio.append(f"campo ajustado ({', '.join(sorted(mudancas))}): {colecao}.{desejado['field']}")


def garantir_configuracoes(c: Cliente, relatorio: list[str]) -> None:
    """Nome, cor e idioma do Studio (Configurações do projeto)."""
    atuais = c.ler("/settings") or {}
    mudancas = {k: v for k, v in modelo.AJUSTES_DO_PROJETO.items() if atuais.get(k) != v}
    if mudancas:
        c.alterar("/settings", mudancas)
        relatorio.append(f"configurações do projeto ajustadas: {', '.join(sorted(mudancas))}")


def garantir_marcadores(c: Cliente, relatorio: list[str]) -> None:
    """Atalhos globais da lista (Para revisar, Rascunhos, No ar...)."""
    existentes = c.ler("/presets", limit=-1, fields="id,bookmark,collection,user,role")
    ja = {(p["bookmark"], p["collection"]) for p in existentes if not p.get("user") and not p.get("role")}
    for m in modelo.MARCADORES:
        if (m["nome"], m["colecao"]) in ja:
            continue
        c.criar("/presets", {
            "bookmark": m["nome"], "collection": m["colecao"], "icon": m["icone"], "user": None, "role": None,
            "layout": "tabular", "filter": m["filtro"],
            "layout_query": {"tabular": {"fields": modelo.COLUNAS_DA_LISTA, "sort": ["-publicada_em"]}},
        })
        relatorio.append(f"atalho criado: {m['nome'] or 'lista padrão de ' + m['colecao']}")


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


# ------------------------------------------------------------------------------------- descontinuados
def _contar(c: Cliente, caminho: str, **filtro: Any) -> int:
    r = c.ler(caminho, **{"aggregate[count]": "*", **filtro})
    return int(r[0]["count"]) if r else 0


def remover_descontinuados(c: Cliente, relatorio: list[str]) -> None:
    """Retira do Directus o que saiu do modelo, SÓ se estiver vazio. Conteúdo de gente nunca é apagado."""
    existentes = {x["collection"] for x in c.ler("/collections")}
    for nome in modelo.COLECOES_DESCONTINUADAS:
        if nome not in existentes:
            continue
        itens = _contar(c, f"/items/{nome}")
        if itens == 0:
            c.apagar(f"/collections/{nome}")
            relatorio.append(f"coleção descontinuada removida (estava vazia): {nome}")
        else:
            relatorio.append(f"AVISO: coleção descontinuada '{nome}' tem {itens} item(ns): NÃO removida")
    pastas = c.ler("/folders", limit=-1, fields="id,name,parent")
    for nome in modelo.PASTAS_DESCONTINUADAS:  # filhas antes da mãe (ordem da lista)
        for pasta in [p for p in pastas if p["name"] == nome]:
            arquivos = _contar(c, "/files", **{"filter[folder][_eq]": pasta["id"]})
            filhas = [p for p in c.ler("/folders", limit=-1, fields="id,parent") if p["parent"] == pasta["id"]]
            if arquivos == 0 and not filhas:
                c.apagar(f"/folders/{pasta['id']}")
                relatorio.append(f"pasta descontinuada removida (estava vazia): {nome}")
            else:
                relatorio.append(f"AVISO: pasta descontinuada '{nome}' ainda tem conteúdo: NÃO removida")
    papeis = {r["name"]: r["id"] for r in c.ler("/roles", limit=-1, fields="id,name")}
    politicas = {p["name"]: p["id"] for p in c.ler("/policies", limit=-1, fields="id,name")}
    for nome in modelo.PERFIS_DESCONTINUADOS:
        if nome in papeis and _contar(c, "/users", **{"filter[role][_eq]": papeis[nome]}):
            relatorio.append(f"AVISO: perfil descontinuado '{nome}' tem usuário(s): NÃO removido")
            continue
        if nome in papeis:
            c.apagar(f"/roles/{papeis[nome]}")
            relatorio.append(f"perfil descontinuado removido (sem usuários): papel {nome}")
        if nome in politicas:
            c.apagar(f"/policies/{politicas[nome]}")
            relatorio.append(f"perfil descontinuado removido (sem usuários): política {nome}")


# ---------------------------------------------------------------------------------- leitor do site
def cofre_tem_segredo(nome: str = SEGREDO_TOKEN_SITE, cofre: str = COFRE_PADRAO) -> bool:
    """Pergunta ao Key Vault se o segredo existe SEM ler o valor (só o id)."""
    az = shutil.which("az")
    if az is None:
        raise SystemExit("Azure CLI (az) não encontrado")
    r = subprocess.run([az, "keyvault", "secret", "show", "--vault-name", cofre, "--name", nome,
                        "--query", "id", "-o", "tsv"], capture_output=True, text=True, timeout=120)
    return r.returncode == 0 and bool(r.stdout.strip())


def guardar_no_cofre(nome: str, valor: str, cofre: str = COFRE_PADRAO) -> None:
    """Grava o segredo no Key Vault por ARQUIVO temporário (nunca por argumento: ficaria na lista de
    processos), apagado em seguida. Não imprime o valor."""
    az = shutil.which("az")
    if az is None:
        raise SystemExit("Azure CLI (az) não encontrado")
    caminho = None
    try:
        with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8", newline="", suffix=".segredo") as f:
            caminho = f.name
            f.write(valor)  # sem quebra de linha no fim: o cofre guarda exatamente o que está no arquivo
        r = subprocess.run([az, "keyvault", "secret", "set", "--vault-name", cofre, "--name", nome,
                            "--file", caminho, "--query", "id", "-o", "tsv"], capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            raise SystemExit(f"o Key Vault recusou gravar {nome} (az login? permissão?)")
    finally:
        if caminho and os.path.exists(caminho):
            with open(caminho, "w", encoding="utf-8", newline="") as f:
                f.write("0" * max(len(valor), 64))  # sobrescreve antes de apagar
            os.remove(caminho)


def verificar_token_do_leitor(base: str, token: str) -> list[str]:
    """Prova com o PRÓPRIO token que a conta lê notícias e NÃO consegue escrever (privilégio mínimo)."""
    problemas: list[str] = []
    leitor = Cliente(base, token)
    try:
        leitor.ler("/items/noticias", limit=1)
    except ErroDirectus as erro:
        problemas.append(f"o token do leitor não consegue ler notícias: {erro}")
    try:
        leitor.criar("/items/noticias", {"titulo": "teste de escrita (não deve ser criada)"})
        problemas.append("GRAVE: o token do leitor CONSEGUIU criar uma notícia")
    except ErroDirectus as erro:
        if "HTTP 403" not in str(erro):
            problemas.append(f"escrita do leitor deu resposta inesperada (esperado 403): {erro}")
    try:
        leitor.ler("/users", limit=1, fields="id,email")
        problemas.append("GRAVE: o token do leitor consegue listar usuários")
    except ErroDirectus:
        pass  # esperado: 403
    return problemas


def garantir_leitor_do_site(c: Cliente, *, rotacionar: bool = False, guardar=guardar_no_cofre,
                            tem_segredo=cofre_tem_segredo, verificar_token=verificar_token_do_leitor) -> list[str]:
    """Cria (ou renova) a conta do site e guarda o token no Key Vault. Devolve o relatório (sem segredo)."""
    papeis = {r["name"]: r["id"] for r in c.ler("/roles", limit=-1, fields="id,name")}
    if PERFIL_LEITOR not in papeis:
        raise SystemExit(f"o perfil '{PERFIL_LEITOR}' não existe: rode `aplicar` antes")
    usuarios = c.ler("/users", limit=-1, fields="id,email", **{"filter[email][_eq]": EMAIL_LEITOR})
    if usuarios and tem_segredo() and not rotacionar:
        return [f"a conta {EMAIL_LEITOR} já existe e o token está no Key Vault ({SEGREDO_TOKEN_SITE}): nada a fazer "
                "(use --rotacionar para trocar o token)"]
    token = secrets.token_urlsafe(32)
    relatorio: list[str] = []
    if usuarios:
        c.alterar(f"/users/{usuarios[0]['id']}", {"token": token, "role": papeis[PERFIL_LEITOR], "status": "active"})
        relatorio.append(f"token da conta {EMAIL_LEITOR} renovado")
    else:
        c.criar("/users", {"email": EMAIL_LEITOR, "first_name": "Leitor", "last_name": "do site",
                           "role": papeis[PERFIL_LEITOR], "status": "active", "token": token})
        relatorio.append(f"conta criada: {EMAIL_LEITOR} (perfil {PERFIL_LEITOR})")
    try:
        guardar(SEGREDO_TOKEN_SITE, token)
    except SystemExit:
        relatorio.append(f"ATENÇÃO: o token novo NÃO foi gravado no Key Vault; rode de novo com --rotacionar")
        raise
    relatorio.append(f"token guardado no Key Vault ({SEGREDO_TOKEN_SITE}); o valor não é exibido")
    for problema in verificar_token(c.base, token):
        relatorio.append(f"PROBLEMA: {problema}")
    return relatorio


# ----------------------------------------------------------------------------------------- verificar
def verificar(c: Cliente) -> list[str]:
    """Lê o Directus e devolve a lista de problemas (vazia = tudo conforme o modelo)."""
    problemas: list[str] = []
    colecoes = {x["collection"] for x in c.ler("/collections")}
    for nome in sorted(c_ for c_ in colecoes if not c_.startswith("directus_")):
        if nome not in modelo.COLECOES_PERMITIDAS:
            problemas.append(f"coleção fora do modelo: {nome} (o Directus só guarda conteúdo editorial)")
    for nome in modelo.COLECOES_DESCONTINUADAS:
        if nome in colecoes:
            problemas.append(f"coleção descontinuada ainda existe: {nome}")
    for definicao in modelo.COLECOES:
        nome = definicao["colecao"]
        if nome not in colecoes:
            problemas.append(f"coleção ausente: {nome}")
            continue
        atuais = {f["field"] for f in c.ler(f"/fields/{nome}")}
        for campo in definicao["campos"]:
            if campo["field"] not in atuais:
                problemas.append(f"campo ausente: {nome}.{campo['field']}")
    atuais_config = c.ler("/settings") or {}
    for chave, valor in modelo.AJUSTES_DO_PROJETO.items():
        if atuais_config.get(chave) != valor:
            problemas.append(f"configuração do projeto diferente do modelo: {chave}")
    marcadores = {(p["bookmark"], p["collection"]) for p in c.ler("/presets", limit=-1, fields="bookmark,collection,user,role")
                  if not p.get("user") and not p.get("role")}
    for m in modelo.MARCADORES:
        if (m["nome"], m["colecao"]) not in marcadores:
            problemas.append(f"atalho ausente: {m['nome'] or 'lista padrão de ' + m['colecao']}")
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
    remover_descontinuados(c, relatorio)
    pastas = garantir_pastas(c, relatorio)
    garantir_colecoes(c, relatorio, pastas)
    garantir_configuracoes(c, relatorio)
    garantir_marcadores(c, relatorio)
    garantir_perfis(c, relatorio)
    return relatorio


def main(argv: list[str]) -> int:
    producao = "--producao" in argv
    usar_cofre = "--senha-do-cofre" in argv
    rotacionar = "--rotacionar" in argv
    argv = [a for a in argv if a not in ("--producao", "--senha-do-cofre", "--rotacionar")]
    if len(argv) != 2 or argv[1] not in ("aplicar", "verificar", "criar-leitor"):
        print(__doc__)
        return 2
    c = cliente_do_ambiente(producao=producao, usar_senha_do_cofre=usar_cofre)
    if argv[1] == "criar-leitor":
        feito = garantir_leitor_do_site(c, rotacionar=rotacionar)
        print("\n".join(f"  + {x}" for x in feito))
        return 1 if any(x.startswith(("PROBLEMA", "ATENÇÃO")) for x in feito) else 0
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
