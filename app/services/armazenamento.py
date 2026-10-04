"""Armazenamento de arquivos enviados (foto de associado, ata assinada, comprovante, documento
emitido) — PERSISTENTE em produção.

POR QUE EXISTE (achado de 2026-10-01): a API gravava tudo em `uploads/` no disco do contêiner, e o
Container App `asaf-api` não tem volume persistente: foto, ata e comprovante SUMIAM a cada deploy,
reinício ou quando a réplica escala a zero. Nenhum documento do projeto mencionava isso, e nenhum
registro real tinha sido perdido só porque o sistema ainda não tinha dado de associado.

COMO FUNCIONA:
  - Produção (Azure): Blob Storage de uma conta PRIVADA só da API, acessada pela identidade
    gerenciada do Container App (nenhuma chave guardada em lugar nenhum). Um contêiner por assunto.
  - Desenvolvimento e testes: disco local em `uploads/`, como sempre foi.
  - A URL gravada no banco continua `/uploads/<pasta>/<nome>` (contrato com o painel e com os
    registros); quem serve o arquivo é a rota de `app/routers/arquivos.py`, que lê daqui.

TRAVAS PARA NÃO VOLTAR A ACONTECER:
  1. Se a API roda no Azure (`CONTAINER_APP_NAME`) sem `ARMAZENAMENTO_BLOB_URL`, ela RECUSA subir —
     nunca cai silenciosamente no disco efêmero (`escolher_backend`).
  2. Na inicialização ela grava, lê e apaga um arquivo de sonda no Blob (`verificar`): se a
     identidade, o papel ou a rede não funcionam, a revisão nova não sobe e a antiga continua
     servindo (o deploy falha de forma visível, não o upload do associado semanas depois).
  3. Teste de arquitetura (`tests/test_armazenamento.py`): nenhum módulo de `app/` grava em
     `uploads/` fora deste arquivo.

PRIVACIDADE: `/uploads/` é servido sem login (o painel abre foto/documento por link direto), então
o nome do arquivo é a única barreira. Por isso TODO nome novo é aleatório (uuid4) — antes a foto era
`fotos/{id}.jpg` e a ata `atas/{id}.pdf`, enumeráveis (qualquer um baixava `fotos/1.jpg`, `2.jpg`…).
Melhoria futura registrada no PLANO: download autenticado / URL assinada de curta duração."""
from __future__ import annotations

import logging
import os
import re
import uuid
from pathlib import Path
from typing import Mapping, Optional, Protocol

LOG = logging.getLogger("asaf.armazenamento")

# pasta (a parte da URL, o contrato com o banco) -> contêiner no Blob (um por assunto).
PASTAS: dict[str, str] = {
    "fotos": "fotos-associados",
    "comprovantes": "comprovantes",
    "documentos": "documentos-emitidos",
}

# Pastas LEGADAS (v5.4a): a ata assinada (RG/CPF de quem assinou) já foi servida em `/uploads/atas/<nome>` sem login. Deixou
# de ser: a ata nova vai para o módulo Documentos (original privado) e as antigas são copiadas para lá na
# inicialização (`documentos_institucionais.migrar_atas_legadas`). A pasta continua LEGÍVEL só para essa cópia; a
# rota pública `/uploads` não a conhece (responde 404, como a de qualquer pasta privada).
PASTAS_LEGADAS: dict[str, str] = {
    "atas": "atas",
}

# Pastas PRIVADAS (v5.4a, módulo Documentos): NUNCA são servidas por `/uploads` (a rota pública só aceita `PASTAS`).
# O original de um documento (ata com RG/CPF, termo de fomento...) e a versão pública ainda não aprovada só saem
# por rotas autenticadas e com permissão (app/routers/documentos.py); a versão pública APROVADA só sai por
# /api/publico/transparencia/documentos/<id>/arquivo, que confere a situação a cada pedido (retirada = some).
PASTAS_PRIVADAS: dict[str, str] = {
    "documentos-originais": "documentos-originais",
    "documentos-publicos": "documentos-publicos",
    # v5.4b: foto de etapa de parceria (com pessoas): só sai pela rota autenticada do painel ou, depois de a parceria ser
    # APROVADA, pela rota pública que confere isso a cada pedido (o site copia a foto no build).
    "fotos-etapas": "fotos-etapas",
    # v5.5: foto de evento (com pessoas): mesma regra da foto de etapa; a rota pública confere que o evento é Público.
    "fotos-eventos": "fotos-eventos",
}

# Só estes tipos são servidos — nada de HTML/SVG/JS vindo de upload (XSS armazenado).
TIPOS_SERVIDOS: dict[str, str] = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}

# Letra/dígito no começo, só [A-Za-z0-9_-] no miolo, uma única extensão. Sem barra, sem ponto duplo.
_NOME_VALIDO = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,119}\.[A-Za-z0-9]{2,5}$")
_PREFIXO_URL = "/uploads/"
_PASTA_SONDA = "comprovantes"  # contêiner usado só para a sonda de inicialização


class ArmazenamentoInvalido(ValueError):
    """Pasta ou nome de arquivo fora do contrato (inclui tentativa de path traversal)."""


class ArmazenamentoMalConfigurado(RuntimeError):
    """API no Azure sem Blob configurado: gravar em disco efêmero perderia os arquivos."""


def nome_aleatorio(extensao: str) -> str:
    """`<uuid4 hex>.ext` — imprevisível (122 bits): a URL é a única barreira de um arquivo público."""
    return f"{uuid.uuid4().hex}{extensao.lower()}"


def validar(pasta: str, nome: str) -> str:
    """Devolve o contêiner da pasta (pública, privada OU legada), ou levanta ArmazenamentoInvalido."""
    conteineres = {**PASTAS, **PASTAS_PRIVADAS, **PASTAS_LEGADAS}
    if pasta not in conteineres:
        raise ArmazenamentoInvalido(f"Pasta desconhecida: {pasta!r}")
    if not _NOME_VALIDO.match(nome) or ".." in nome:
        raise ArmazenamentoInvalido(f"Nome de arquivo inválido: {nome!r}")
    return conteineres[pasta]


def validar_publica(pasta: str, nome: str) -> str:
    """Como `validar`, mas SÓ aceita pasta pública: é o que a rota `/uploads` (sem login) usa. Pasta privada
    parece "desconhecida" - o visitante nem descobre que ela existe."""
    if pasta not in PASTAS:
        raise ArmazenamentoInvalido(f"Pasta desconhecida: {pasta!r}")
    return validar(pasta, nome)


def nome_no_endereco_antigo_da_ata(url: Optional[str]) -> Optional[str]:
    """`/uploads/atas/abc.pdf` -> 'abc.pdf' (o endereço público que a ata assinada tinha antes da v5.4a); outro -> None."""
    prefixo = url_publica("atas", "")
    if not url or not url.startswith(prefixo):
        return None
    nome = url[len(prefixo):]
    try:
        validar("atas", nome)
    except ArmazenamentoInvalido:
        return None
    return nome


def tipo_servido(nome: str) -> Optional[str]:
    return TIPOS_SERVIDOS.get(os.path.splitext(nome)[1].lower())


def url_publica(pasta: str, nome: str) -> str:
    return f"{_PREFIXO_URL}{pasta}/{nome}"


def separar_url(url: Optional[str]) -> Optional[tuple[str, str]]:
    """`/uploads/fotos/abc.jpg` -> ('fotos', 'abc.jpg'); qualquer outra coisa -> None."""
    if not url or not url.startswith(_PREFIXO_URL):
        return None
    partes = url[len(_PREFIXO_URL):].split("/")
    if len(partes) != 2:
        return None
    try:
        validar_publica(partes[0], partes[1])
    except ArmazenamentoInvalido:
        return None
    return partes[0], partes[1]


class Armazenamento(Protocol):
    descricao: str

    def salvar(self, pasta: str, nome: str, conteudo: bytes) -> None: ...
    def ler(self, pasta: str, nome: str) -> Optional[bytes]: ...
    def remover(self, pasta: str, nome: str) -> None: ...
    def verificar(self) -> None: ...


class ArmazenamentoLocal:
    """Disco local (`uploads/<pasta>/<nome>`): desenvolvimento e testes. NUNCA em produção."""

    def __init__(self, raiz: str | Path = "uploads") -> None:
        self.raiz = Path(raiz)
        self.descricao = f"disco local ({self.raiz})"

    def _caminho(self, pasta: str, nome: str) -> Path:
        validar(pasta, nome)
        return self.raiz / pasta / nome

    def salvar(self, pasta: str, nome: str, conteudo: bytes) -> None:
        caminho = self._caminho(pasta, nome)
        caminho.parent.mkdir(parents=True, exist_ok=True)
        caminho.write_bytes(conteudo)

    def ler(self, pasta: str, nome: str) -> Optional[bytes]:
        caminho = self._caminho(pasta, nome)
        return caminho.read_bytes() if caminho.is_file() else None

    def remover(self, pasta: str, nome: str) -> None:
        self._caminho(pasta, nome).unlink(missing_ok=True)

    def verificar(self) -> None:
        sonda = f"sonda-{uuid.uuid4().hex}.pdf"
        self.salvar(_PASTA_SONDA, sonda, b"sonda")
        try:
            if self.ler(_PASTA_SONDA, sonda) != b"sonda":
                raise ArmazenamentoMalConfigurado("A sonda gravada no disco local não voltou igual.")
        finally:
            self.remover(_PASTA_SONDA, sonda)


class ArmazenamentoBlob:
    """Azure Blob Storage, conta privada, autenticação por identidade gerenciada (sem chave).

    `cliente` permite injetar um BlobServiceClient (ou um falso, nos testes). Sem ele, cria o
    cliente real com `DefaultAzureCredential` — no Container App usa a identidade do próprio app."""

    def __init__(self, url_conta: str, cliente=None, credencial=None) -> None:
        self.url_conta = url_conta.rstrip("/")
        self.descricao = f"Azure Blob ({self.url_conta})"
        if cliente is None:
            from azure.identity import DefaultAzureCredential
            from azure.storage.blob import BlobServiceClient

            cliente = BlobServiceClient(
                account_url=self.url_conta,
                credential=credencial or DefaultAzureCredential(),
                connection_timeout=10,
                read_timeout=30,
            )
        self._cliente = cliente

    def _blob(self, pasta: str, nome: str):
        conteiner = validar(pasta, nome)
        return self._cliente.get_blob_client(container=conteiner, blob=nome)

    def salvar(self, pasta: str, nome: str, conteudo: bytes) -> None:
        from azure.storage.blob import ContentSettings

        from azure.core.exceptions import ResourceNotFoundError

        tipo = tipo_servido(nome) or "application/octet-stream"
        blob = self._blob(pasta, nome)
        try:
            blob.upload_blob(conteudo, overwrite=True, content_settings=ContentSettings(content_type=tipo))
        except ResourceNotFoundError as erro:
            # Contêiner novo (ex.: o do módulo Documentos, v5.4a) que o script de infraestrutura ainda não criou:
            # cria, privado (sem acesso público - a conta não permite), e tenta de novo. Outro "não encontrado" sobe.
            if getattr(erro, "error_code", None) != "ContainerNotFound":
                raise
            self._criar_conteiner(validar(pasta, nome))
            blob.upload_blob(conteudo, overwrite=True, content_settings=ContentSettings(content_type=tipo))

    def _criar_conteiner(self, conteiner: str) -> None:
        from azure.core.exceptions import ResourceExistsError

        try:
            self._cliente.get_container_client(conteiner).create_container()
        except ResourceExistsError:  # outra réplica criou no mesmo instante
            pass

    def ler(self, pasta: str, nome: str) -> Optional[bytes]:
        from azure.core.exceptions import ResourceNotFoundError

        try:
            return self._blob(pasta, nome).download_blob().readall()
        except ResourceNotFoundError:
            return None

    def remover(self, pasta: str, nome: str) -> None:
        from azure.core.exceptions import ResourceNotFoundError

        try:
            self._blob(pasta, nome).delete_blob()
        except ResourceNotFoundError:
            pass

    def verificar(self) -> None:
        """Grava, lê e apaga uma sonda: prova que identidade, papel (RBAC), rede e contêiner estão
        funcionando — falha ALTO na inicialização em vez de falhar no upload de um associado."""
        sonda = f"sonda-{uuid.uuid4().hex}.pdf"
        self.salvar(_PASTA_SONDA, sonda, b"sonda")
        try:
            lido = self.ler(_PASTA_SONDA, sonda)
        finally:
            self.remover(_PASTA_SONDA, sonda)
        if lido != b"sonda":
            raise ArmazenamentoMalConfigurado("A sonda gravada no Blob não voltou igual.")


def escolher_backend(ambiente: Mapping[str, str]) -> str:
    """'blob' ou 'local'. No Azure, sem Blob configurado, RECUSA (o disco do contêiner é efêmero)."""
    if ambiente.get("ARMAZENAMENTO_BLOB_URL", "").strip():
        return "blob"
    if ambiente.get("CONTAINER_APP_NAME"):
        raise ArmazenamentoMalConfigurado(
            "A API está rodando no Azure (CONTAINER_APP_NAME) sem ARMAZENAMENTO_BLOB_URL. Gravar em "
            "disco local PERDERIA foto, ata e comprovante a cada deploy/reinício. Defina "
            "ARMAZENAMENTO_BLOB_URL com a URL da conta privada de armazenamento."
        )
    return "local"


_instancia: Optional[Armazenamento] = None


def obter() -> Armazenamento:
    global _instancia
    if _instancia is None:
        ambiente = dict(os.environ)
        if escolher_backend(ambiente) == "blob":
            _instancia = ArmazenamentoBlob(ambiente["ARMAZENAMENTO_BLOB_URL"])
        else:
            _instancia = ArmazenamentoLocal()
        LOG.warning("armazenamento de arquivos: %s", _instancia.descricao)
    return _instancia


def configurar(armazenamento: Optional[Armazenamento]) -> None:
    """Troca (ou zera) a instância — usado por testes."""
    global _instancia
    _instancia = armazenamento


def salvar_novo(pasta: str, extensao: str, conteudo: bytes, nome: Optional[str] = None) -> str:
    """Grava com nome aleatório (ou `nome` dado, se já for opaco) e devolve a URL `/uploads/...`."""
    nome = nome or nome_aleatorio(extensao)
    obter().salvar(pasta, nome, conteudo)
    return url_publica(pasta, nome)


def remover_url(url: Optional[str]) -> None:
    """Apaga o arquivo que uma URL `/uploads/...` aponta (ex.: foto antiga ao trocar). Melhor
    esforço: falha em apagar nunca derruba a operação do usuário, só vai para o log."""
    alvo = separar_url(url)
    if not alvo:
        return
    try:
        obter().remover(*alvo)
    except Exception:  # noqa: BLE001 - limpeza não pode quebrar o upload novo
        LOG.exception("não foi possível apagar o arquivo antigo %s", url)
