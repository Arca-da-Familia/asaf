"""Achado pelo TESTE DE CARGA na homologação (2026-10-08, Postgres de verdade): quando a MESMA pessoa se inscreve duas vezes quase ao mesmo tempo (clique duplo, duas abas),
as duas requisições passavam pela checagem "esta pessoa já existe?" antes de qualquer uma gravar, e a segunda estourava a restrição única do CPF (`ix_pessoas_cpf`) com erro
500. E, se passasse dessa, a restrição única da inscrição faria o mesmo, deixando uma vaga reservada à toa. Agora quem perde a corrida usa a pessoa que a outra criou e é
recusada como qualquer repetição ("já está inscrita"), e a vaga volta.

O banco de teste (SQLite) não reproduz a corrida de verdade; por isso aqui a corrida é FORÇADA: a primeira checagem da requisição "não enxerga" a pessoa que já existe, como
quem chegou um instante antes, e o resto segue pelo caminho real, até a restrição única do banco."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from unittest.mock import patch

from fastapi import HTTPException

from app.models.eventos import Evento
from app.models.motores import Inscricao
from app.models.pessoas import Pessoa
from app.services import eventos as servico_eventos
from app.services import vagas as servico_vagas
from tests.test_eventos_vagas import _criar_evento_publico, _ip_de_teste, _payload_inscricao
from tests.test_pessoas import _cpf_unico


class _ConsultaQueNaoVe:
    """Faz de conta que a consulta voltou vazia na PRIMEIRA vez (a outra requisição ainda não tinha gravado quando esta olhou)."""

    def filter(self, *_args, **_kwargs):
        return self

    def first(self):
        return None


def _nao_ve_na_primeira_vez(db, modelo):
    real = db.query
    chamadas = {"n": 0}

    def consulta(*entidades, **kwargs):
        if entidades and entidades[0] is modelo and chamadas["n"] == 0:
            chamadas["n"] += 1
            return _ConsultaQueNaoVe()
        return real(*entidades, **kwargs)

    return patch.object(db, "query", side_effect=consulta)


def test_a_pessoa_criada_um_instante_antes_por_outra_requisicao_e_reaproveitada_sem_erro(db):
    cpf = _cpf_unico()
    existente = Pessoa(nome_completo="Criada Antes", cpf=cpf, email_contato="antes@example.com")
    db.add(existente)
    db.commit()

    with _nao_ve_na_primeira_vez(db, Pessoa):
        pessoa = servico_eventos._dedupicar_pessoa_por_cpf(db, nome_completo="Chegou Depois", cpf=cpf, email="depois@example.com", telefone="91988887777")

    assert pessoa.id_pessoa == existente.id_pessoa
    assert db.query(Pessoa).filter(Pessoa.cpf == cpf).count() == 1, "nenhuma pessoa duplicada"
    assert pessoa.nome_completo == "Criada Antes", "o dado de quem já estava não é sobrescrito"


def test_a_inscricao_criada_um_instante_antes_vira_400_em_portugues_e_a_vaga_reservada_volta(client, auth_headers, db):
    id_evento = _criar_evento_publico(client, auth_headers, vagas=3)
    pessoa = Pessoa(nome_completo="Inscrita Antes", cpf=_cpf_unico(), email_contato="inscrita@example.com")
    db.add(pessoa)
    db.commit()
    db.add(Inscricao(contexto_tipo="Evento", id_contexto=id_evento, id_pessoa=pessoa.id_pessoa, status="Pré-inscrito"))
    evento = db.query(Evento).filter(Evento.id_evento == id_evento).one()
    evento.vagas_ocupadas = 1
    db.commit()

    with _nao_ve_na_primeira_vez(db, Inscricao):
        try:
            servico_vagas.inscrever_com_controle_de_vaga(
                db, contexto_tipo="Evento", id_contexto=id_evento, id_pessoa=pessoa.id_pessoa, respostas_formulario=None,
            )
        except HTTPException as erro:
            assert erro.status_code == 400 and "já está inscrita" in erro.detail
        else:
            raise AssertionError("a segunda inscrição da mesma pessoa deveria ser recusada")

    db.expire_all()
    assert db.query(Evento).filter(Evento.id_evento == id_evento).one().vagas_ocupadas == 1, "a vaga reservada pela tentativa perdedora voltou"
    assert db.query(Inscricao).filter(Inscricao.id_contexto == id_evento, Inscricao.id_pessoa == pessoa.id_pessoa).count() == 1


def test_o_clique_duplo_de_verdade_nunca_da_erro_de_servidor_e_ocupa_uma_vaga_so(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers, vagas=5)
    payload = _payload_inscricao()

    def enviar(_):
        return client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=payload, headers=_ip_de_teste())

    with ThreadPoolExecutor(max_workers=6) as executor:
        respostas = list(executor.map(enviar, range(6)))

    codigos = sorted(r.status_code for r in respostas)
    assert all(c < 500 for c in codigos), [r.text for r in respostas if r.status_code >= 500]
    assert codigos.count(200) == 1, codigos
    assert all("já está inscrita" in r.json()["detail"] for r in respostas if r.status_code == 400)
    publico = client.get(f"/api/publico/eventos/{id_evento}").json()
    assert publico["vagas_livres"] == 4, "uma pessoa, uma vaga, mesmo com seis envios"
