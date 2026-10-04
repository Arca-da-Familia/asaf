"""v5.4a - pastas PRIVADAS do armazenamento (original e versão pública de documento institucional).

A rota `/uploads/<pasta>/<nome>` é pública (o painel abre foto por link direto) e protegida só pelo nome aleatório.
Original de ata/termo (RG, CPF) NÃO pode sair por ela: pasta privada tem que parecer inexistente para quem pede."""
import pytest
from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError

from app.services import armazenamento
from app.services.armazenamento import PASTAS, PASTAS_PRIVADAS, ArmazenamentoBlob, ArmazenamentoInvalido

NOME = "0123456789abcdef0123456789abcdef.pdf"


def test_pastas_privadas_nao_se_misturam_com_as_publicas():
    assert set(PASTAS_PRIVADAS) == {"documentos-originais", "documentos-publicos", "fotos-etapas", "fotos-eventos"}
    assert set(PASTAS_PRIVADAS).isdisjoint(PASTAS)
    assert set(PASTAS_PRIVADAS.values()).isdisjoint(PASTAS.values())  # nem o contêiner é o mesmo


def test_validar_aceita_privada_mas_validar_publica_a_trata_como_desconhecida():
    for pasta in PASTAS_PRIVADAS:
        assert armazenamento.validar(pasta, NOME) == PASTAS_PRIVADAS[pasta]
        with pytest.raises(ArmazenamentoInvalido, match="desconhecida"):
            armazenamento.validar_publica(pasta, NOME)
    assert armazenamento.validar_publica("fotos", NOME) == "fotos-associados"  # as públicas seguem como antes


def test_pasta_antiga_das_atas_e_legivel_para_a_migracao_mas_nao_e_publica():
    """v5.4a - a ata assinada (RG/CPF) já foi servida em `/uploads/atas`. A pasta continua LEGÍVEL só para copiar as
    antigas para a biblioteca de Documentos; a rota pública não a conhece mais."""
    assert armazenamento.PASTAS_LEGADAS == {"atas": "atas"}
    assert "atas" not in PASTAS
    assert armazenamento.validar("atas", NOME) == "atas"
    with pytest.raises(ArmazenamentoInvalido, match="desconhecida"):
        armazenamento.validar_publica("atas", NOME)
    assert armazenamento.separar_url(f"/uploads/atas/{NOME}") is None


def test_rota_publica_nao_serve_mais_a_pasta_antiga_das_atas(client):
    armazenamento.obter().salvar("atas", NOME, b"%PDF-1.4 ata com RG e CPF")
    try:
        resposta = client.get(f"/uploads/atas/{NOME}")
        assert resposta.status_code == 404 and "RG" not in resposta.text
    finally:
        armazenamento.obter().remover("atas", NOME)


def test_url_de_pasta_privada_nao_e_um_upload_valido():
    for pasta in PASTAS_PRIVADAS:
        assert armazenamento.separar_url(f"/uploads/{pasta}/{NOME}") is None


@pytest.mark.parametrize("pasta", sorted(PASTAS_PRIVADAS))
def test_rota_publica_de_uploads_nunca_serve_pasta_privada_mesmo_com_o_arquivo_la(client, pasta):
    armazenamento.obter().salvar(pasta, NOME, b"%PDF-1.4 conteudo sigiloso")
    try:
        resposta = client.get(f"/uploads/{pasta}/{NOME}")
        assert resposta.status_code == 404
        assert "sigiloso" not in resposta.text
        # e o mesmo nome em pasta pública também não "vaza" o arquivo da pasta privada
        assert client.get(f"/uploads/atas/{NOME}").status_code == 404
    finally:
        armazenamento.obter().remover(pasta, NOME)


# ----------------------------------------------------------------------- contêiner criado sob demanda
class _ServicoSemConteiner:
    """Blob falso: o contêiner só passa a existir depois de `create_container` (como a conta de verdade)."""

    def __init__(self, ja_existe_na_criacao=False, codigo_do_erro="ContainerNotFound"):
        self.conteineres: set[str] = set()
        self.blobs: dict = {}
        self.criacoes = 0
        self._ja_existe = ja_existe_na_criacao
        self._codigo = codigo_do_erro

    def get_blob_client(self, container, blob):
        servico = self

        class _Blob:
            def upload_blob(self, dados, overwrite=False, content_settings=None):
                if container not in servico.conteineres:
                    erro = ResourceNotFoundError("The specified container does not exist.")
                    erro.error_code = servico._codigo
                    raise erro
                servico.blobs[(container, blob)] = bytes(dados)

        return _Blob()

    def get_container_client(self, container):
        servico = self

        class _Conteiner:
            def create_container(self):
                servico.criacoes += 1
                if servico._ja_existe:
                    servico.conteineres.add(container)
                    raise ResourceExistsError("already exists")
                servico.conteineres.add(container)

        return _Conteiner()


def test_blob_cria_o_conteiner_novo_e_repete_o_envio_uma_vez():
    servico = _ServicoSemConteiner()
    ArmazenamentoBlob("https://conta.blob.core.windows.net", cliente=servico).salvar("documentos-originais", NOME, b"x")
    assert servico.criacoes == 1
    assert servico.blobs[("documentos-originais", NOME)] == b"x"


def test_blob_aceita_que_outra_replica_tenha_criado_o_conteiner_no_mesmo_instante():
    servico = _ServicoSemConteiner(ja_existe_na_criacao=True)
    ArmazenamentoBlob("https://conta.blob.core.windows.net", cliente=servico).salvar("documentos-publicos", NOME, b"y")
    assert servico.blobs[("documentos-publicos", NOME)] == b"y"


def test_blob_nao_engole_outro_erro_de_nao_encontrado():
    servico = _ServicoSemConteiner(codigo_do_erro="BlobNotFound")
    with pytest.raises(ResourceNotFoundError):
        ArmazenamentoBlob("https://conta.blob.core.windows.net", cliente=servico).salvar("documentos-originais", NOME, b"x")
    assert servico.criacoes == 0  # só cria contêiner quando o erro é mesmo "contêiner não existe"
