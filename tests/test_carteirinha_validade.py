"""v5.7d - o QR da carteirinha NÃO vale por tempo indeterminado (decisão do Presidente, 2026-10-15: "pode ser 10 dias, 20 dias").

A verificação pública devolve nome, foto do cadastro e situação a quem tem o link; antes o link valia 365 dias. O que o servidor garante:
  1. o QR novo vale os dias da regra `DIAS_VALIDADE_CARTEIRINHA` (padrão 15), que a diretoria muda em Configurações > Regras do sistema;
  2. um QR já emitido com validade maior (os de 365 dias) também deixa de valer passados os dias da regra contados da emissão, na verificação pública, no credenciamento de assembleia e na portaria;
  3. o "válido até" que a verificação mostra é o da regra, não o do token."""
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.models.core import ConfiguracaoInstitucional
from app.models.pessoas import Papel
from app.security import JWT_ALGORITHM, JWT_SECRET
from app.services import carteirinha
from tests.test_sessao_assembleia import _criar_assembleia_em_andamento, _criar_associado


def _associado_ativo(db):
    associado = _criar_associado(db, f"Portador do QR {uuid.uuid4().hex[:6]}")
    if not db.query(Papel).filter(Papel.id_pessoa == associado.id_pessoa, Papel.tipo_papel == "associado").first():
        db.add(Papel(id_pessoa=associado.id_pessoa, tipo_papel="associado"))
        db.commit()
    return associado


def _token_emitido_ha(id_pessoa: int, dias_atras: float, validade_dias: int = 365) -> str:
    """Um QR como os antigos: emitido `dias_atras` dias atrás, com a validade longa de antes."""
    emitido = datetime.now(timezone.utc) - timedelta(days=dias_atras)
    return jwt.encode(
        {"id_pessoa": id_pessoa, "iat": emitido, "exp": emitido + timedelta(days=validade_dias), "type": "carteirinha"}, JWT_SECRET, algorithm=JWT_ALGORITHM,
    )


def _regra(db, dias: str | None):
    config = db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == carteirinha.CHAVE_DA_VALIDADE).first()
    assert config is not None, "a regra existe no seed"
    antigo = config.valor_configuracao
    if dias is not None:
        config.valor_configuracao = dias
        db.commit()
    from app.config_cache import invalidar_cache_configuracao

    invalidar_cache_configuracao(carteirinha.CHAVE_DA_VALIDADE)
    return antigo


@pytest.fixture
def regra_padrao(db):
    antigo = _regra(db, "15")
    yield
    _regra(db, antigo)


def test_o_qr_novo_vale_os_dias_da_regra_e_nao_365(client, auth_headers, db, regra_padrao):
    associado = _associado_ativo(db)
    token = client.get(f"/api/associados/{associado.id_associado}/carteirinha", headers=auth_headers).json()["token"]
    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    assert payload["exp"] - payload["iat"] == 15 * 86400
    r = client.get(f"/carteirinha/verificar/{token}")
    assert r.status_code == 200 and r.json()["valido"] is True
    valido_ate = datetime.fromisoformat(r.json()["valido_ate"])
    assert abs((valido_ate - datetime.now(timezone.utc)).total_seconds() - 15 * 86400) < 120


def test_a_regra_muda_o_prazo_do_qr_novo(client, auth_headers, db, regra_padrao):
    associado = _associado_ativo(db)
    _regra(db, "10")
    token = client.get(f"/api/associados/{associado.id_associado}/carteirinha", headers=auth_headers).json()["token"]
    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    assert payload["exp"] - payload["iat"] == 10 * 86400
    # regra inválida ou zerada volta ao padrão em vez de abrir a mão
    for lixo in ("0", "-3", "abc", ""):
        _regra(db, lixo)
        assert carteirinha.dias_de_validade(db) == carteirinha.DIAS_PADRAO


def test_qr_antigo_de_365_dias_deixa_de_valer_passados_os_dias_da_regra(client, auth_headers, db, regra_padrao):
    associado = _associado_ativo(db)
    recente = _token_emitido_ha(associado.id_pessoa, dias_atras=5)
    velho = _token_emitido_ha(associado.id_pessoa, dias_atras=18)

    r = client.get(f"/carteirinha/verificar/{recente}")
    assert r.status_code == 200 and r.json()["valido"] is True
    # o "válido até" é o da regra (emissão + 15 dias), não o do token (emissão + 365)
    esperado = datetime.now(timezone.utc) + timedelta(days=10)
    assert abs((datetime.fromisoformat(r.json()["valido_ate"]) - esperado).total_seconds()) < 120

    r = client.get(f"/carteirinha/verificar/{velho}")
    assert r.status_code == 400 and "inválida ou expirada" in r.json()["detail"]

    # mudar a regra vale na hora, também para o que já foi emitido
    _regra(db, "20")
    assert client.get(f"/carteirinha/verificar/{velho}").status_code == 200
    _regra(db, "15")
    assert client.get(f"/carteirinha/verificar/{velho}").status_code == 400


def test_a_regra_tem_teto_de_20_dias_mesmo_que_alguem_grave_mais(client, auth_headers, db, regra_padrao):
    """O Presidente falou em 10 ou 20 dias: um 365 gravado por engano em Configurações não reabre o QR por um ano."""
    associado = _associado_ativo(db)
    _regra(db, "365")
    assert carteirinha.dias_de_validade(db) == carteirinha.DIAS_MAXIMO == 20
    token = client.get(f"/api/associados/{associado.id_associado}/carteirinha", headers=auth_headers).json()["token"]
    carga = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    assert carga["exp"] - carga["iat"] == 20 * 86400
    # um QR de 25 dias atrás não passa nem com a regra no teto
    assert client.get(f"/carteirinha/verificar/{_token_emitido_ha(associado.id_pessoa, dias_atras=25)}").status_code == 400


def test_credenciamento_de_assembleia_recusa_o_qr_vencido(client, auth_headers, db, regra_padrao):
    associado = _criar_associado(db, f"Credenciado QR {uuid.uuid4().hex[:6]}")
    id_assembleia = _criar_assembleia_em_andamento(client, auth_headers)
    velho = _token_emitido_ha(associado.id_pessoa, dias_atras=30)
    r = client.post(f"/api/assembleias/{id_assembleia}/credenciamentos", headers=auth_headers, json={"modalidade": "Presencial", "token_carteirinha": velho})
    assert r.status_code == 400 and "inválida ou expirada" in r.json()["detail"]
    recente = client.get(f"/api/associados/{associado.id_associado}/carteirinha", headers=auth_headers).json()["token"]
    r = client.post(f"/api/assembleias/{id_assembleia}/credenciamentos", headers=auth_headers, json={"modalidade": "Presencial", "token_carteirinha": recente})
    assert r.status_code == 200, r.text


def test_token_sem_data_de_emissao_ou_de_outro_tipo_nao_passa(client, db, regra_padrao):
    associado = _associado_ativo(db)
    agora = datetime.now(timezone.utc)
    sem_iat = jwt.encode({"id_pessoa": associado.id_pessoa, "exp": agora + timedelta(days=5), "type": "carteirinha"}, JWT_SECRET, algorithm=JWT_ALGORITHM)
    assert client.get(f"/carteirinha/verificar/{sem_iat}").status_code == 400
    outro_tipo = jwt.encode({"id_pessoa": associado.id_pessoa, "iat": agora, "exp": agora + timedelta(days=5), "type": "acesso"}, JWT_SECRET, algorithm=JWT_ALGORITHM)
    assert client.get(f"/carteirinha/verificar/{outro_tipo}").status_code == 400
    assert client.get("/carteirinha/verificar/isto-nao-e-um-token").status_code == 400


# ------------------------------------------------------------------------------------------------ a foto da carteirinha só enquanto o QR vale
_JPEG_DE_TESTE = bytes([0xFF, 0xD8, 0xFF, 0xE0]) + b" imagem de teste"


def _com_foto_no_cadastro(db, associado, conteudo: bytes = _JPEG_DE_TESTE, extensao: str = ".jpg") -> str:
    from app.models.pessoas import Pessoa
    from app.services import armazenamento

    nome = armazenamento.nome_aleatorio(extensao)
    armazenamento.obter().salvar("fotos", nome, conteudo)
    db.query(Pessoa).filter(Pessoa.id_pessoa == associado.id_pessoa).update({"foto": f"/uploads/fotos/{nome}"})
    db.commit()
    return nome


def test_a_verificacao_nao_entrega_o_endereco_da_foto_e_a_foto_so_sai_enquanto_o_qr_vale(client, auth_headers, db, regra_padrao):
    associado = _associado_ativo(db)
    nome = _com_foto_no_cadastro(db, associado)
    token = client.get(f"/api/associados/{associado.id_associado}/carteirinha", headers=auth_headers).json()["token"]

    r = client.get(f"/carteirinha/verificar/{token}")
    assert r.status_code == 200
    assert r.json()["foto"] == f"/carteirinha/verificar/{token}/foto", "a foto vem por uma rota que confere o QR"
    assert nome not in r.text and "/uploads/" not in r.text, "o endereço aberto da foto do cadastro nunca sai"

    foto = client.get(r.json()["foto"])  # sem login
    assert foto.status_code == 200 and foto.headers["content-type"] == "image/jpeg" and foto.content == _JPEG_DE_TESTE
    assert foto.headers["cache-control"] == "no-store"

    # o QR venceu: nem a verificação nem a foto respondem
    velho = _token_emitido_ha(associado.id_pessoa, dias_atras=30)
    assert client.get(f"/carteirinha/verificar/{velho}").status_code == 400
    assert client.get(f"/carteirinha/verificar/{velho}/foto").status_code == 400
    assert client.get("/carteirinha/verificar/isto-nao-e-um-token/foto").status_code == 400


def test_sem_foto_utilizavel_a_verificacao_diz_sem_foto(client, auth_headers, db, regra_padrao):
    sem_foto = _associado_ativo(db)
    token = client.get(f"/api/associados/{sem_foto.id_associado}/carteirinha", headers=auth_headers).json()["token"]
    from app.models.pessoas import Pessoa

    db.query(Pessoa).filter(Pessoa.id_pessoa == sem_foto.id_pessoa).update({"foto": None})
    db.commit()
    assert client.get(f"/carteirinha/verificar/{token}").json()["foto"] is None
    assert client.get(f"/carteirinha/verificar/{token}/foto").status_code == 404

    com_pdf = _associado_ativo(db)
    _com_foto_no_cadastro(db, com_pdf, conteudo=b"%PDF-1.4 nao e imagem", extensao=".pdf")
    token_pdf = client.get(f"/api/associados/{com_pdf.id_associado}/carteirinha", headers=auth_headers).json()["token"]
    assert client.get(f"/carteirinha/verificar/{token_pdf}").json()["foto"] is None, "só imagem sai por aqui"
    assert client.get(f"/carteirinha/verificar/{token_pdf}/foto").status_code == 404
