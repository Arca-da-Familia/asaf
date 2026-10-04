"""Armazenamento persistente de arquivos enviados (achado de 2026-10-01: a API gravava foto, ata e
comprovante no disco EFÊMERO do contêiner e eles sumiam a cada deploy/reinício).

Cobre: o contrato de nome/pasta (sem path traversal), a escolha de backend e a trava de "Azure sem
Blob = não sobe", o backend Blob contra um cliente falso em memória, a rota que serve os arquivos,
os quatro pontos de gravação (foto, ata, comprovante, documento emitido), a trava de inicialização
(lifespan) e o teste de arquitetura que impede alguém de voltar a gravar em disco direto."""
import ast
import re
from pathlib import Path

import pytest
from azure.core.exceptions import HttpResponseError, ResourceNotFoundError
from fastapi.testclient import TestClient

from app.main import app
from app.services import armazenamento
from app.services.armazenamento import (
    ArmazenamentoBlob,
    ArmazenamentoInvalido,
    ArmazenamentoLocal,
    ArmazenamentoMalConfigurado,
)
from tests.test_associado_detalhe import _criar_ficha

_RAIZ_APP = Path(__file__).resolve().parent.parent / "app"
_URL_ALEATORIA = r"/uploads/{pasta}/[0-9a-f]{{32}}\.{ext}"


# ==========================================
# FALSO BLOB (em memória) - mesma superfície que ArmazenamentoBlob usa do SDK
# ==========================================
class _BaixaFalsa:
    def __init__(self, dados: bytes):
        self._dados = dados

    def readall(self) -> bytes:
        return self._dados


class _BlobClientFalso:
    def __init__(self, loja: dict, conteiner: str, nome: str, negar: bool):
        self._loja, self._chave, self._negar = loja, (conteiner, nome), negar

    def upload_blob(self, dados, overwrite=False, content_settings=None):
        if self._negar:
            raise HttpResponseError("This request is not authorized to perform this operation (403)")
        self._loja[self._chave] = (bytes(dados), content_settings.content_type if content_settings else None)

    def download_blob(self):
        if self._chave not in self._loja:
            raise ResourceNotFoundError("BlobNotFound")
        return _BaixaFalsa(self._loja[self._chave][0])

    def delete_blob(self):
        if self._chave not in self._loja:
            raise ResourceNotFoundError("BlobNotFound")
        del self._loja[self._chave]


class _ServicoBlobFalso:
    def __init__(self, negar_escrita: bool = False):
        self.loja: dict[tuple[str, str], tuple[bytes, str | None]] = {}
        self._negar = negar_escrita

    def get_blob_client(self, container: str, blob: str):
        return _BlobClientFalso(self.loja, container, blob, self._negar)


@pytest.fixture()
def restaurar_armazenamento():
    """Devolve o armazenamento ao do conftest (disco temporário) depois de testes que o trocam."""
    anterior = armazenamento._instancia
    yield
    armazenamento.configurar(anterior)


# ==========================================
# CONTRATO DE PASTA/NOME (sem path traversal)
# ==========================================
@pytest.mark.parametrize("pasta", ["fotos", "comprovantes", "documentos"])
def test_pastas_conhecidas_mapeiam_para_um_conteiner(pasta):
    assert armazenamento.validar(pasta, "abc123.pdf") == armazenamento.PASTAS[pasta]


@pytest.mark.parametrize("pasta,nome", [
    ("segredos", "abc.pdf"),            # pasta fora da lista
    ("..", "abc.pdf"),
    ("fotos", "../atas/abc.pdf"),       # path traversal
    ("fotos", "..\\atas\\abc.pdf"),
    ("fotos", "a/b.pdf"),
    ("fotos", ".htaccess.pdf"),         # começa com ponto
    ("fotos", "a..b.pdf"),              # ponto duplo
    ("fotos", "semextensao"),
    ("fotos", "abc.pdf.exe.php5x"),     # extensão longa demais / dupla
    ("fotos", ""),
    ("fotos", "a b.pdf"),               # espaço
    ("fotos", "a%2fb.pdf"),
    ("fotos", "x" * 130 + ".pdf"),      # nome gigante
])
def test_nome_ou_pasta_invalidos_sao_recusados(pasta, nome):
    with pytest.raises(ArmazenamentoInvalido):
        armazenamento.validar(pasta, nome)


def test_nome_aleatorio_e_imprevisivel_e_unico():
    nomes = {armazenamento.nome_aleatorio(".JPG") for _ in range(200)}
    assert len(nomes) == 200
    assert all(re.fullmatch(r"[0-9a-f]{32}\.jpg", n) for n in nomes)


def test_separar_url_so_aceita_o_contrato_e_o_resto_vira_none():
    assert armazenamento.separar_url("/uploads/fotos/abc.jpg") == ("fotos", "abc.jpg")
    for ruim in [None, "", "fotos/abc.jpg", "/uploads/fotos", "/uploads/fotos/../atas/a.pdf",
                 "/uploads/segredos/abc.jpg", "https://exemplo.com/uploads/fotos/abc.jpg", "/uploads/fotos/a/b.jpg"]:
        assert armazenamento.separar_url(ruim) is None, ruim


# ==========================================
# ESCOLHA DE BACKEND + TRAVA "AZURE SEM BLOB NÃO SOBE"
# ==========================================
def test_local_quando_nao_esta_no_azure_e_nao_ha_blob():
    assert armazenamento.escolher_backend({}) == "local"


def test_blob_quando_a_url_da_conta_esta_definida():
    assert armazenamento.escolher_backend({"ARMAZENAMENTO_BLOB_URL": "https://x.blob.core.windows.net"}) == "blob"
    assert armazenamento.escolher_backend(
        {"ARMAZENAMENTO_BLOB_URL": "https://x.blob.core.windows.net", "CONTAINER_APP_NAME": "asaf-api"}
    ) == "blob"


@pytest.mark.parametrize("ambiente", [
    {"CONTAINER_APP_NAME": "asaf-api"},
    {"CONTAINER_APP_NAME": "asaf-api", "ARMAZENAMENTO_BLOB_URL": ""},
    {"CONTAINER_APP_NAME": "asaf-api", "ARMAZENAMENTO_BLOB_URL": "   "},
])
def test_no_azure_sem_blob_configurado_a_api_recusa_em_vez_de_cair_no_disco_efemero(ambiente):
    with pytest.raises(ArmazenamentoMalConfigurado, match="ARMAZENAMENTO_BLOB_URL"):
        armazenamento.escolher_backend(ambiente)


def test_lifespan_recusa_subir_no_azure_sem_blob(monkeypatch, restaurar_armazenamento):
    monkeypatch.setenv("CONTAINER_APP_NAME", "asaf-api")
    monkeypatch.delenv("ARMAZENAMENTO_BLOB_URL", raising=False)
    armazenamento.configurar(None)  # força `obter()` a decidir de novo, como num boot de verdade
    with pytest.raises(ArmazenamentoMalConfigurado):
        with TestClient(app):
            pass


def test_lifespan_recusa_subir_quando_a_sonda_do_blob_falha(restaurar_armazenamento):
    """Identidade sem papel (403), rede fora, contêiner inexistente: a revisão nova não sobe."""
    armazenamento.configurar(ArmazenamentoBlob("https://x.blob.core.windows.net", cliente=_ServicoBlobFalso(negar_escrita=True)))
    with pytest.raises(HttpResponseError):
        with TestClient(app):
            pass


def test_lifespan_sobe_quando_a_sonda_passa_e_nao_deixa_lixo(restaurar_armazenamento):
    falso = _ServicoBlobFalso()
    armazenamento.configurar(ArmazenamentoBlob("https://x.blob.core.windows.net", cliente=falso))
    with TestClient(app):
        pass
    assert falso.loja == {}  # a sonda foi apagada


# ==========================================
# BACKEND LOCAL
# ==========================================
def test_local_grava_le_remove_e_verifica(tmp_path):
    local = ArmazenamentoLocal(tmp_path)
    local.salvar("fotos", "abc.jpg", b"conteudo")
    assert local.ler("fotos", "abc.jpg") == b"conteudo"
    assert (tmp_path / "fotos" / "abc.jpg").read_bytes() == b"conteudo"
    local.remover("fotos", "abc.jpg")
    assert local.ler("fotos", "abc.jpg") is None
    local.remover("fotos", "abc.jpg")  # idempotente
    local.verificar()
    assert not list(tmp_path.rglob("sonda-*"))


def test_local_nao_escapa_da_raiz(tmp_path):
    local = ArmazenamentoLocal(tmp_path / "raiz")
    with pytest.raises(ArmazenamentoInvalido):
        local.salvar("fotos", "../fora.pdf", b"x")
    assert not (tmp_path / "fora.pdf").exists()


# ==========================================
# BACKEND BLOB (cliente falso)
# ==========================================
def test_blob_grava_no_conteiner_certo_com_content_type_e_le_de_volta():
    falso = _ServicoBlobFalso()
    blob = ArmazenamentoBlob("https://x.blob.core.windows.net/", cliente=falso)
    assert blob.url_conta == "https://x.blob.core.windows.net"

    blob.salvar("fotos", "abc.jpg", b"imagem")
    blob.salvar("atas", "def.pdf", b"%PDF")
    assert falso.loja[("fotos-associados", "abc.jpg")] == (b"imagem", "image/jpeg")
    assert falso.loja[("atas", "def.pdf")] == (b"%PDF", "application/pdf")
    assert blob.ler("fotos", "abc.jpg") == b"imagem"
    assert blob.ler("fotos", "naoexiste.jpg") is None


def test_blob_remover_e_idempotente():
    falso = _ServicoBlobFalso()
    blob = ArmazenamentoBlob("https://x.blob.core.windows.net", cliente=falso)
    blob.salvar("comprovantes", "abc.pdf", b"x")
    blob.remover("comprovantes", "abc.pdf")
    blob.remover("comprovantes", "abc.pdf")  # já não existe: sem erro
    assert falso.loja == {}


def test_blob_recusa_nome_invalido_antes_de_falar_com_a_nuvem():
    falso = _ServicoBlobFalso()
    blob = ArmazenamentoBlob("https://x.blob.core.windows.net", cliente=falso)
    with pytest.raises(ArmazenamentoInvalido):
        blob.salvar("fotos", "../atas/x.pdf", b"x")
    assert falso.loja == {}


def test_blob_verificar_propaga_a_falha_de_permissao():
    blob = ArmazenamentoBlob("https://x.blob.core.windows.net", cliente=_ServicoBlobFalso(negar_escrita=True))
    with pytest.raises(HttpResponseError):
        blob.verificar()


# ==========================================
# remover_url: melhor esforço
# ==========================================
def test_remover_url_ignora_o_que_nao_e_upload_e_nao_propaga_falha(restaurar_armazenamento):
    class _Quebrado(ArmazenamentoLocal):
        def remover(self, pasta, nome):
            raise OSError("disco cheio")

    armazenamento.configurar(_Quebrado("."))
    armazenamento.remover_url(None)
    armazenamento.remover_url("https://outro.site/imagem.jpg")
    armazenamento.remover_url("/uploads/fotos/abc.jpg")  # a falha vai para o log, não derruba o upload novo


# ==========================================
# ROTA QUE SERVE OS ARQUIVOS
# ==========================================
def test_rota_serve_arquivo_gravado_com_tipo_correto_e_cabecalhos_de_seguranca(client):
    url = armazenamento.salvar_novo("comprovantes", ".pdf", b"%PDF-1.4 teste de rota")
    r = client.get(url)
    assert r.status_code == 200
    assert r.content == b"%PDF-1.4 teste de rota"
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-disposition"].startswith("inline;")
    assert "private" in r.headers["cache-control"]


def test_rota_devolve_404_para_arquivo_inexistente_pasta_ou_nome_invalidos(client):
    assert client.get("/uploads/fotos/" + "0" * 32 + ".jpg").status_code == 404
    assert client.get("/uploads/segredos/abc.jpg").status_code == 404
    assert client.get("/uploads/fotos/a..b.jpg").status_code == 404
    assert client.get("/uploads/fotos/..%2Fatas%2Fabc.pdf").status_code == 404
    assert client.get("/uploads/fotos/%2e%2e/atas/abc.pdf").status_code == 404
    assert client.get("/uploads/fotos").status_code == 404


def test_rota_nunca_serve_html_nem_svg_mesmo_que_estejam_no_armazenamento(client):
    """Defesa em profundidade contra XSS armazenado: só PDF/JPG/PNG/WEBP saem pela rota."""
    for nome in ("pagina.html", "imagem.svg", "script.js"):
        armazenamento.obter().salvar("comprovantes", nome, b"<script>alert(1)</script>")
        assert client.get(f"/uploads/comprovantes/{nome}").status_code == 404, nome


# ==========================================
# OS QUATRO PONTOS DE GRAVAÇÃO
# ==========================================
def test_foto_do_associado_tem_nome_aleatorio_e_a_antiga_e_apagada_so_depois(client, auth_headers):
    id_associado = _criar_ficha(client)
    r1 = client.post(f"/api/associados/{id_associado}/foto", headers=auth_headers,
                     files={"foto": ("a.jpg", b"primeira-foto", "image/jpeg")})
    assert r1.status_code == 200, r1.text
    url1 = r1.json()["foto"]
    assert re.fullmatch(_URL_ALEATORIA.format(pasta="fotos", ext="jpg"), url1), url1
    assert str(id_associado) != url1.rsplit("/", 1)[1].split(".")[0]  # não é mais o id do associado
    assert client.get(url1).content == b"primeira-foto"

    r2 = client.post(f"/api/associados/{id_associado}/foto", headers=auth_headers,
                     files={"foto": ("b.png", b"segunda-foto", "image/png")})
    url2 = r2.json()["foto"]
    assert url2 != url1 and url2.endswith(".png")
    assert client.get(url2).content == b"segunda-foto"
    assert client.get(url1).status_code == 404  # a foto antiga saiu do armazenamento

    detalhe = client.get(f"/api/associados/{id_associado}", headers=auth_headers).json()
    assert detalhe["foto"] == url2


def test_foto_de_associado_recusa_formato_invalido_e_arquivo_grande(client, auth_headers):
    id_associado = _criar_ficha(client)
    r = client.post(f"/api/associados/{id_associado}/foto", headers=auth_headers,
                    files={"foto": ("a.gif", b"x", "image/gif")})
    assert r.status_code == 400
    r = client.post(f"/api/associados/{id_associado}/foto", headers=auth_headers,
                    files={"foto": ("a.jpg", b"x" * (5 * 1024 * 1024 + 1), "image/jpeg")})
    assert r.status_code == 400


def test_comprovante_financeiro_vai_para_o_armazenamento_e_e_servido(client, auth_headers):
    r = client.post("/api/comprovantes/", headers=auth_headers,
                    files={"arquivo": ("nota.pdf", b"%PDF-1.4 nota fiscal", "application/pdf")})
    assert r.status_code == 200, r.text
    url = r.json()["comprovante"]
    assert re.fullmatch(_URL_ALEATORIA.format(pasta="comprovantes", ext="pdf"), url), url
    assert client.get(url).content == b"%PDF-1.4 nota fiscal"


def test_nova_ata_assinada_mantem_o_arquivo_anterior_e_registra_na_auditoria(client, auth_headers, db):
    """Ata é documento de valor jurídico: anexar outro NÃO apaga o anterior - o arquivo antigo continua no
    armazenamento (privado) e a troca fica na auditoria. (v5.4a: agora é um original privado da biblioteca.)"""
    from app.models.documentos import DocumentoInstitucional
    from tests.test_ata import _criar_assembleia_em_andamento, _criar_ata

    id_ata = _criar_ata(client, auth_headers, _criar_assembleia_em_andamento(client, auth_headers))
    primeiro = client.post(f"/api/atas/{id_ata}/documento-assinado", headers=auth_headers,
                           files={"documento": ("v1.pdf", b"%PDF-1.4 versao 1", "application/pdf")}).json()
    doc = db.query(DocumentoInstitucional).filter(DocumentoInstitucional.id_documento == primeiro["id_documento_assinado"]).first()
    nome_antigo = doc.original_nome
    segundo = client.post(f"/api/atas/{id_ata}/documento-assinado", headers=auth_headers,
                          files={"documento": ("v2.pdf", b"%PDF-1.4 versao 2", "application/pdf")}).json()
    assert segundo["id_documento_assinado"] == primeiro["id_documento_assinado"], "rascunho: o mesmo documento, arquivo trocado"
    assert client.get(segundo["arquivo_documento_assinado"], headers=auth_headers).content == b"%PDF-1.4 versao 2"
    db.expire_all()
    assert db.query(DocumentoInstitucional).filter(DocumentoInstitucional.id_documento == doc.id_documento).first().original_nome != nome_antigo
    assert armazenamento.obter().ler("documentos-originais", nome_antigo) == b"%PDF-1.4 versao 1", "o arquivo anterior NÃO é apagado"


def test_documento_emitido_interno_agora_tem_nome_aleatorio(client, auth_headers):
    codigo = f"ARM_{re.sub('[^A-Z0-9]', '', __import__('uuid').uuid4().hex.upper())[:8]}"
    assert client.post("/api/templates-documento/", headers=auth_headers, json={
        "codigo": codigo, "nome": "Doc Interno", "corpo_texto": "Texto simples.",
    }).status_code == 200
    r = client.post("/api/documentos-emitidos/", headers=auth_headers, json={"codigo_template": codigo, "variaveis": {}})
    assert r.status_code == 200, r.text
    caminho = r.json()["caminho_arquivo"]
    assert re.fullmatch(_URL_ALEATORIA.format(pasta="documentos", ext="pdf"), caminho), caminho
    assert client.get(caminho).content.startswith(b"%PDF")


# ==========================================
# ARQUITETURA: NADA GRAVA EM DISCO FORA DO SERVIÇO
# ==========================================
def _arquivos_de_app():
    return [p for p in _RAIZ_APP.rglob("*.py") if p.name != "armazenamento.py"]


def _literais_texto(arvore: ast.AST):
    """Strings que o código usa de verdade (docstrings/comentários ficam de fora)."""
    docstrings = set()
    for no in ast.walk(arvore):
        if isinstance(no, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and no.body:
            primeiro = no.body[0]
            if isinstance(primeiro, ast.Expr) and isinstance(primeiro.value, ast.Constant) and isinstance(primeiro.value.value, str):
                docstrings.add(id(primeiro.value))
    for no in ast.walk(arvore):
        if isinstance(no, ast.Constant) and isinstance(no.value, str) and id(no) not in docstrings:
            yield no.value, no.lineno


def test_nenhum_modulo_da_api_grava_em_uploads_nem_monta_diretorio_estatico():
    """Trava contra a regressão do achado de 2026-10-01. Gravar em `uploads/` no disco do contêiner
    perde o arquivo a cada deploy; toda gravação passa por `app.services.armazenamento`."""
    violacoes = []
    for caminho in _arquivos_de_app():
        arvore = ast.parse(caminho.read_text(encoding="utf-8"))
        relativo = caminho.relative_to(_RAIZ_APP.parent).as_posix()
        for texto, linha in _literais_texto(arvore):
            # `arquivos.py` declara a ROTA `/uploads/{pasta}/{nome}`; o resto não pode mencionar o caminho.
            if relativo == "app/routers/arquivos.py" and texto == "/uploads/{pasta}/{nome}":
                continue
            if texto == "uploads" or texto.startswith(("uploads/", "/uploads/")):
                violacoes.append(f"{relativo}:{linha} usa o literal {texto!r}")
        for no in ast.walk(arvore):
            if isinstance(no, ast.JoinedStr):
                partes = "".join(p.value for p in no.values if isinstance(p, ast.Constant) and isinstance(p.value, str))
                if "uploads/" in partes:
                    violacoes.append(f"{relativo}:{no.lineno} monta caminho de upload à mão ({partes!r})")
            if isinstance(no, (ast.Import, ast.ImportFrom)):
                nomes = [a.name for a in no.names] + [getattr(no, "module", "") or ""]
                if any("StaticFiles" in n or n == "fastapi.staticfiles" for n in nomes):
                    violacoes.append(f"{relativo}:{no.lineno} importa StaticFiles")
            if isinstance(no, ast.Call) and isinstance(no.func, ast.Name) and no.func.id == "open":
                modo = no.args[1].value if len(no.args) > 1 and isinstance(no.args[1], ast.Constant) else ""
                if isinstance(modo, str) and any(c in modo for c in "wax+"):
                    violacoes.append(f"{relativo}:{no.lineno} abre arquivo para escrita")
            if isinstance(no, ast.Attribute) and no.attr in ("write_bytes", "write_text", "makedirs", "mkdir"):
                violacoes.append(f"{relativo}:{no.lineno} usa .{no.attr}()")
    assert not violacoes, (
        "Gravação em disco fora de app/services/armazenamento.py (o disco do contêiner é EFÊMERO; use "
        "armazenamento.salvar_novo):\n  " + "\n  ".join(violacoes)
    )
