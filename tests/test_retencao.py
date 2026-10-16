"""v5.7b - a ROTINA DE RETENÇÃO (LGPD, arts. 15 e 16): os prazos da "Tabela de temporalidade" viram configuração e uma rotina aplica o que já venceu.

O que o servidor garante:
  1. cada prazo é uma regra editável; valor abaixo do piso (30 dias) ou ilegível vale o padrão (um número errado nunca vira "apague tudo agora");
  2. só some o que PASSOU do prazo, contado da data certa de cada dado; o recente, o aberto e o aprovado ficam intactos;
  3. o dado financeiro nunca é tocado: do doador identificado só a PESSOA some (valor, data, destino e título ficam); do pedido da fila ficam protocolo, tipo e datas;
  4. a Auditoria guarda só as CONTAGENS (nunca o que foi apagado) e só quando algo foi aplicado;
  5. rodar de novo não faz nada; uma regra que falha não derruba as outras e o roteiro do sistema sai com código 1.
(As linhas de teste usam datas relativas ao agora REAL: o banco de teste é compartilhado, e uma data "no futuro" faria dado recente de outro teste parecer velho.)"""
import importlib.util
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from app.config_cache import invalidar_cache_configuracao
from app.models.associados import Associado
from app.models.atendimento import ENCERRADO, NOVO, RESPONDIDO, Atendimento
from app.models.core import AuditLog, ConfiguracaoInstitucional
from app.models.doacoes import Doacao
from app.models.financeiro import TituloFinanceiro
from app.models.filiacao import APROVADA, PENDENTE, RECUSADA, PropostaDeSocio, PropostaFiliacao
from app.models.intencoes_de_doacao import CONFIRMADA, EXPIRADA, PENDENTE as INTENCAO_PENDENTE, IntencaoDeDoacao
from app.models.notificacoes_painel import NotificacaoPainel
from app.models.protecao_publica import TentativaAcessoPublico
from app.services import retencao
from tests.test_doacoes import _criar_conta
from tests.test_sessao_assembleia import _criar_associado

AGORA = datetime.utcnow()


def _ha(dias: float) -> datetime:
    return AGORA - timedelta(days=dias)


def _config(db, chave: str, valor: str):
    config = db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == chave).first()
    assert config is not None, f"a regra {chave} existe no seed"
    antigo = config.valor_configuracao
    config.valor_configuracao = valor
    db.commit()
    invalidar_cache_configuracao(chave)
    return antigo


def _rodar(db):
    return retencao.aplicar_todas(db, agora=datetime.utcnow())


def _unico() -> str:
    return uuid.uuid4().hex[:10]


# ------------------------------------------------------------------------------------------------ 1. os prazos são regras, com piso
@pytest.mark.parametrize("regra", retencao.REGRAS, ids=lambda r: r.codigo)
def test_cada_prazo_e_uma_regra_editavel_com_piso_de_30_dias(db, regra):
    antigo = _config(db, regra.chave_de_config, str(regra.padrao_em_dias))
    try:
        assert retencao.dias_da_regra(db, regra) == regra.padrao_em_dias
        _config(db, regra.chave_de_config, "400")
        assert retencao.dias_da_regra(db, regra) == 400
        for lixo in ("5", "29", "0", "-3", "abc", ""):
            _config(db, regra.chave_de_config, lixo)
            assert retencao.dias_da_regra(db, regra) == regra.padrao_em_dias, f"{lixo!r} não pode virar prazo"
        _config(db, regra.chave_de_config, "30")
        assert retencao.dias_da_regra(db, regra) == 30, "o piso em si vale"
    finally:
        _config(db, regra.chave_de_config, antigo)


def test_os_padroes_sao_os_da_tabela_de_temporalidade():
    padroes = {r.codigo: r.padrao_em_dias for r in retencao.REGRAS}
    assert padroes == {
        "acessos": 183, "avisos_do_sino": 365, "atendimentos": 1825, "propostas_de_filiacao": 730,
        "intencoes_de_doacao": 730, "doador_identificado": 3650, "associado_desligado": 1825,
    }


# ------------------------------------------------------------------------------------------------ 2. o que cada regra faz
def test_registro_tecnico_de_acesso_e_avisos_do_sino_velhos_somem_e_os_recentes_ficam(db):
    velha = TentativaAcessoPublico(ip="10.9.9.9", rota=f"retencao-{_unico()}", criado_em=_ha(200))
    recente = TentativaAcessoPublico(ip="10.9.9.9", rota=f"retencao-{_unico()}", criado_em=_ha(10))
    aviso_velho = NotificacaoPainel(id_usuario=1, tipo="teste", titulo="Aviso velho com nome", texto="Fulano de Tal pediu", criado_em=_ha(400))
    aviso_novo = NotificacaoPainel(id_usuario=1, tipo="teste", titulo="Aviso novo", texto="Beltrano", criado_em=_ha(5))
    db.add_all([velha, recente, aviso_velho, aviso_novo])
    db.commit()
    ids = (velha.id_tentativa, recente.id_tentativa, aviso_velho.id_notificacao, aviso_novo.id_notificacao)

    resultado = _rodar(db)
    assert resultado["falhas"] == [] and resultado["aplicadas"]["acessos"] >= 1 and resultado["aplicadas"]["avisos_do_sino"] >= 1
    db.expire_all()
    assert db.get(TentativaAcessoPublico, ids[0]) is None and db.get(TentativaAcessoPublico, ids[1]) is not None
    assert db.get(NotificacaoPainel, ids[2]) is None and db.get(NotificacaoPainel, ids[3]) is not None


def _atendimento(db, status, *, encerrado_ha=None, respondido_ha=None, resposta=None) -> Atendimento:
    a = Atendimento(
        protocolo=f"RET-{_unico()}", tipo="CONTATO", assunto="Assunto com nome", mensagem="Mensagem com dado pessoal de Fulano", nome_completo="Fulano de Tal",
        email_contato="fulano@example.com", telefone_whatsapp="94999990000", cpf="12345678909", data_nascimento=_ha(9000), chave_remetente="cpf:12345678909",
        impressao_do_pedido="a" * 64, status=status, prazo_dias=10, prazo_em=_ha(5), criado_em=_ha(3000),
        encerrado_em=_ha(encerrado_ha) if encerrado_ha is not None else None, respondido_em=_ha(respondido_ha) if respondido_ha is not None else None,
        resposta=resposta, motivo_encerramento="motivo com nome" if encerrado_ha is not None else None,
    )
    db.add(a)
    db.commit()
    return a


def test_pedido_da_fila_vencido_perde_mensagem_e_contato_mas_guarda_protocolo_tipo_e_datas(db):
    encerrado_velho = _atendimento(db, ENCERRADO, encerrado_ha=2000)
    respondido_velho = _atendimento(db, RESPONDIDO, respondido_ha=1900, resposta="Resposta com dado pessoal")
    encerrado_recente = _atendimento(db, ENCERRADO, encerrado_ha=100)
    aberto_velho = _atendimento(db, NOVO)  # ainda sem resposta: o prazo só conta depois de respondido ou encerrado
    protocolos = {a.id_atendimento: a.protocolo for a in (encerrado_velho, respondido_velho, encerrado_recente, aberto_velho)}

    resultado = _rodar(db)
    assert resultado["falhas"] == [] and resultado["aplicadas"]["atendimentos"] >= 2
    db.expire_all()
    for velho in (encerrado_velho, respondido_velho):
        a = db.get(Atendimento, velho.id_atendimento)
        assert a.nome_completo == retencao.NOME_APAGADO and a.mensagem == retencao.MARCADOR_DE_TEXTO
        assert a.email_contato is None and a.telefone_whatsapp is None and a.cpf is None and a.data_nascimento is None
        assert a.chave_remetente is None and a.impressao_do_pedido is None and a.assunto is None and a.id_pessoa is None and a.motivo_encerramento is None
        assert a.protocolo == protocolos[a.id_atendimento] and a.tipo == "CONTATO" and a.status in (ENCERRADO, RESPONDIDO) and a.criado_em is not None
    assert db.get(Atendimento, respondido_velho.id_atendimento).resposta == retencao.MARCADOR_DE_TEXTO
    assert db.get(Atendimento, encerrado_velho.id_atendimento).resposta is None
    for intacto in (encerrado_recente, aberto_velho):
        a = db.get(Atendimento, intacto.id_atendimento)
        assert a.mensagem == "Mensagem com dado pessoal de Fulano" and a.nome_completo == "Fulano de Tal" and a.cpf == "12345678909"


def test_proposta_de_filiacao_que_nao_virou_associado_some_com_os_votos_e_a_aprovada_fica(db):
    associado = _criar_associado(db, f"Socio Proponente {_unico()}")

    def proposta(status, atualizada_ha, efetivada=False, voto_ha=None):
        p = PropostaFiliacao(
            nome_completo=f"Candidato {_unico()}", cpf=f"{uuid.uuid4().int % 10**11:011d}", status=status, atualizado_em=_ha(atualizada_ha),
            id_associado_efetivado=associado.id_associado if efetivada else None,
        )
        db.add(p)
        db.flush()
        db.add(
            PropostaDeSocio(
                id_proposta=p.id_proposta, id_associado=associado.id_associado, decisao="Propõe",
                criado_em=_ha(voto_ha if voto_ha is not None else atualizada_ha), atualizado_em=_ha(voto_ha if voto_ha is not None else atualizada_ha),
            )
        )
        db.commit()
        return p.id_proposta

    recusada_velha = proposta(RECUSADA, 800)
    parada_velha = proposta(PENDENTE, 900)
    recusada_recente = proposta(RECUSADA, 100)
    aprovada_velha = proposta(APROVADA, 2000, efetivada=True)
    pendente_com_voto_recente = proposta(PENDENTE, 900, voto_ha=20)  # o pedido não mudou há 2,5 anos, mas um sócio votou há 20 dias: não está parado

    resultado = _rodar(db)
    assert resultado["falhas"] == [] and resultado["aplicadas"]["propostas_de_filiacao"] >= 2
    db.expire_all()
    existe = lambda i: db.get(PropostaFiliacao, i) is not None  # noqa: E731
    votos = lambda i: db.query(PropostaDeSocio).filter(PropostaDeSocio.id_proposta == i).count()  # noqa: E731
    assert not existe(recusada_velha) and votos(recusada_velha) == 0
    assert not existe(parada_velha) and votos(parada_velha) == 0
    assert existe(recusada_recente) and votos(recusada_recente) == 1
    assert existe(aprovada_velha) and votos(aprovada_velha) == 1, "quem virou associado não é 'proposta não aprovada'"
    assert existe(pendente_com_voto_recente) and votos(pendente_com_voto_recente) == 1, "voto recente de sócio conta como mudança"


def _intencao(db, status, expira_ha, id_doacao=None) -> IntencaoDeDoacao:
    i = IntencaoDeDoacao(
        protocolo=f"DOA-RET-{_unico()}", nome_doador="Doadora de Teste", email_doador=f"doadora.{_unico()}@example.com", documento_doador="12345678909", valor_informado=50,
        status=status, consentimento_lgpd_versao="1", consentimento_lgpd_em=_ha(900), criado_em=_ha(expira_ha + 15), expira_em=_ha(expira_ha), id_doacao=id_doacao,
    )
    db.add(i)
    db.commit()
    return i


def test_pedido_de_doacao_sem_confirmacao_vencido_ha_2_anos_some_e_os_outros_ficam(db):
    velho = _intencao(db, EXPIRADA, 800)
    pendente_velho = _intencao(db, INTENCAO_PENDENTE, 900)
    recente = _intencao(db, EXPIRADA, 100)
    ids = (velho.id_intencao, pendente_velho.id_intencao, recente.id_intencao)

    resultado = _rodar(db)
    assert resultado["falhas"] == [] and resultado["aplicadas"]["intencoes_de_doacao"] >= 2
    db.expire_all()
    assert db.get(IntencaoDeDoacao, ids[0]) is None and db.get(IntencaoDeDoacao, ids[1]) is None
    assert db.get(IntencaoDeDoacao, ids[2]) is not None


def test_doador_identificado_vira_anonimo_depois_de_10_anos_e_o_dado_financeiro_nao_muda(client, auth_headers, db):
    receita = _criar_conta(client, auth_headers, "Receita")
    associado = _criar_associado(db, f"Doador Associado {_unico()}")

    def doacao(anonima, ha, nome="Doadora Identificada"):
        d = Doacao(
            anonima=anonima, nome_doador=None if anonima else nome, documento_doador=None if anonima else "12345678909", id_associado=None if anonima else associado.id_associado,
            tipo_doacao="Monetaria", valor=321.45, id_conta_contabil=receita, numero_recibo=None, data_doacao=_ha(ha),
        )
        db.add(d)
        db.commit()
        return d

    velha = doacao(False, 3700)
    recente = doacao(False, 1000)
    anonima_velha = doacao(True, 3700)
    pedido_confirmado = _intencao(db, CONFIRMADA, 3700, id_doacao=velha.id_doacao)
    pedido_confirmado.observacao = "observação com nome do doador"
    titulo = TituloFinanceiro(
        tipo_titulo="A Receber", id_conta_contabil=receita, id_associado=associado.id_associado, descricao="Doação #1 — recibo nº 1", valor_original=321.45,
        saldo_devedor=0, data_vencimento=_ha(3700), status="Pago",
    )
    db.add(titulo)
    db.flush()
    velha.id_titulo = titulo.id_titulo
    db.commit()
    antes = {"valor": velha.valor, "data": velha.data_doacao, "conta": velha.id_conta_contabil, "campanha": velha.id_campanha, "destino": velha.id_centro_custo_destinacao}

    resultado = _rodar(db)
    assert resultado["falhas"] == [] and resultado["aplicadas"]["doador_identificado"] >= 1
    db.expire_all()
    d = db.get(Doacao, velha.id_doacao)
    assert d.anonima is True and d.nome_doador is None and d.documento_doador is None and d.id_associado is None
    assert {"valor": d.valor, "data": d.data_doacao, "conta": d.id_conta_contabil, "campanha": d.id_campanha, "destino": d.id_centro_custo_destinacao} == antes, "o dado financeiro não muda"
    assert db.get(TituloFinanceiro, titulo.id_titulo).id_associado is None, "a ligação com o cadastro também sai do título (o valor e a conta ficam)"
    assert float(db.get(TituloFinanceiro, titulo.id_titulo).valor_original) == 321.45
    pedido = db.get(IntencaoDeDoacao, pedido_confirmado.id_intencao)
    assert pedido.impressao_do_pedido is None and pedido.observacao is None, "nem a impressão digital do pedido (que embute nome, e-mail e CPF) nem a observação ficam"
    assert pedido is not None and pedido.status == CONFIRMADA and pedido.id_doacao == velha.id_doacao, "o pedido confirmado fica, só sem a pessoa"
    assert pedido.nome_doador == retencao.DOADOR_ANONIMIZADO and pedido.documento_doador is None and pedido.email_doador.endswith("@exemplo.invalid")
    r = db.get(Doacao, recente.id_doacao)
    assert r.anonima is False and r.nome_doador == "Doadora Identificada" and r.id_associado == associado.id_associado
    assert db.get(Doacao, anonima_velha.id_doacao).anonima is True


def test_associado_desligado_ha_5_anos_perde_o_dado_sensivel_pela_mesma_rotina(db):
    desligado = _criar_associado(db, f"Desligado Antigo {_unico()}")
    recente = _criar_associado(db, f"Desligado Recente {_unico()}")
    for a, dias in ((desligado, 2000), (recente, 100)):
        a.status_arrolamento = "Desligado"
        a.data_desligamento = _ha(dias)
        a.pessoa.cpf = f"{uuid.uuid4().int % 10**11:011d}"
        a.pessoa.email_contato = f"{_unico()}@example.com"
    db.commit()
    cpf_recente = recente.pessoa.cpf

    resultado = _rodar(db)
    assert resultado["falhas"] == [] and resultado["aplicadas"]["associado_desligado"] >= 1
    db.expire_all()
    antigo = db.query(Associado).filter(Associado.id_associado == desligado.id_associado).one()
    assert antigo.pessoa.cpf is None and antigo.pessoa.email_contato is None and antigo.pessoa.nome_completo.startswith("Desligado Antigo"), "o nome (livro de associados) fica"
    assert db.query(Associado).filter(Associado.id_associado == recente.id_associado).one().pessoa.cpf == cpf_recente


def test_o_piso_vale_tambem_para_o_associado_desligado_e_um_numero_absurdo_nao_estoura(db):
    """Antes, a anonimização do desligado lia a configuração sem piso: com "0" anonimizava no dia do desligamento, e com "10.5" a regra falhava em toda execução (achado da conferência independente)."""
    regra = next(r for r in retencao.REGRAS if r.codigo == "associado_desligado")
    antigo = _config(db, regra.chave_de_config, "0")
    try:
        recem_desligado = _criar_associado(db, f"Desligado Ontem {_unico()}")
        recem_desligado.status_arrolamento = "Desligado"
        recem_desligado.data_desligamento = _ha(1)
        recem_desligado.pessoa.cpf = f"{uuid.uuid4().int % 10**11:011d}"
        db.commit()
        cpf = recem_desligado.pessoa.cpf
        resultado = _rodar(db)
        assert resultado["falhas"] == [] and retencao.dias_da_regra(db, regra) == 1825, '"0" não vira "anonimize agora"'
        db.expire_all()
        assert db.query(Associado).filter(Associado.id_associado == recem_desligado.id_associado).one().pessoa.cpf == cpf

        _config(db, regra.chave_de_config, "10.5")
        assert _rodar(db)["falhas"] == [], 'um "10.5" gravado por engano não derruba a rotina'
        _config(db, regra.chave_de_config, "99999999")
        assert retencao.dias_da_regra(db, regra) == retencao.TETO_EM_DIAS, "um número absurdo vira o teto (a conta de data não estoura)"
        assert _rodar(db)["falhas"] == []
    finally:
        _config(db, regra.chave_de_config, antigo)


def test_desligado_perde_tambem_o_arquivo_da_foto_e_o_endereco_e_so_uma_vez(db):
    from app.models.associados import Endereco
    from app.services import armazenamento

    desligado = _criar_associado(db, f"Desligado Com Foto {_unico()}")
    desligado.status_arrolamento = "Desligado"
    desligado.data_desligamento = _ha(2000)
    desligado.pessoa.cpf = f"{uuid.uuid4().int % 10**11:011d}"
    nome_da_foto = armazenamento.nome_aleatorio(".jpg")
    armazenamento.obter().salvar("fotos", nome_da_foto, b"foto de teste")
    desligado.pessoa.foto = f"/uploads/fotos/{nome_da_foto}"
    db.add(Endereco(id_associado=desligado.id_associado, cep="68515000", logradouro="Rua de Teste", numero="1", bairro="Centro", cidade="Parauapebas", estado="PA"))
    db.commit()
    id_associado = desligado.id_associado

    assert _rodar(db)["aplicadas"]["associado_desligado"] >= 1
    db.expire_all()
    assert db.query(Endereco).filter(Endereco.id_associado == id_associado).count() == 0, "o endereço sai (a Tabela de temporalidade manda)"
    assert db.query(Associado).filter(Associado.id_associado == id_associado).one().pessoa.foto is None
    assert armazenamento.obter().ler("fotos", nome_da_foto) is None, "o ARQUIVO da foto também sai (a rota /uploads abre sem login)"
    from sqlalchemy import func

    entradas = lambda: db.query(func.count(AuditLog.id_log)).filter(AuditLog.acao == "ANONIMIZADO", AuditLog.tabela_afetada == "pessoas").scalar()  # noqa: E731
    antes = entradas()
    assert _rodar(db)["aplicadas"]["associado_desligado"] == 0 and entradas() == antes, "repetir não anonimiza nem grava na Auditoria de novo"


def test_se_o_armazenamento_nao_apaga_a_foto_a_pessoa_fica_para_a_proxima_rodada_e_a_regra_fica_vermelha(db, monkeypatch):
    from app.services import armazenamento

    desligado = _criar_associado(db, f"Desligado Foto Presa {_unico()}")
    desligado.status_arrolamento = "Desligado"
    desligado.data_desligamento = _ha(2000)
    desligado.pessoa.cpf = f"{uuid.uuid4().int % 10**11:011d}"
    nome_da_foto = armazenamento.nome_aleatorio(".jpg")
    armazenamento.obter().salvar("fotos", nome_da_foto, b"foto de teste")
    desligado.pessoa.foto = f"/uploads/fotos/{nome_da_foto}"
    db.commit()
    id_associado, cpf = desligado.id_associado, desligado.pessoa.cpf

    original = armazenamento.obter().remover

    def sem_papel(*_a, **_k):
        raise PermissionError("403: sem papel de dados no contêiner")

    monkeypatch.setattr(armazenamento.obter(), "remover", sem_papel)
    resultado = _rodar(db)
    assert "associado_desligado" in resultado["falhas"], "a regra FICA VERMELHA: não é falha silenciosa"
    db.expire_all()
    pessoa = db.query(Associado).filter(Associado.id_associado == id_associado).one().pessoa
    assert pessoa.cpf == cpf and pessoa.foto is not None, "nada foi mexido: a próxima rodada tenta de novo"
    assert armazenamento.obter().ler("fotos", nome_da_foto) is not None

    monkeypatch.setattr(armazenamento.obter(), "remover", original)
    assert "associado_desligado" not in _rodar(db)["falhas"]
    db.expire_all()
    pessoa = db.query(Associado).filter(Associado.id_associado == id_associado).one().pessoa
    assert pessoa.cpf is None and pessoa.foto is None and armazenamento.obter().ler("fotos", nome_da_foto) is None


def test_desligado_que_ainda_e_voluntario_nao_e_tocado_pela_rotina(db):
    from app.models.pessoas import Papel

    desligado = _criar_associado(db, f"Desligado Voluntario {_unico()}")
    desligado.status_arrolamento = "Desligado"
    desligado.data_desligamento = _ha(2000)
    desligado.pessoa.cpf = f"{uuid.uuid4().int % 10**11:011d}"
    db.add(Papel(id_pessoa=desligado.id_pessoa, tipo_papel="voluntario", ativo=True))
    db.commit()
    cpf = desligado.pessoa.cpf
    _rodar(db)
    db.expire_all()
    assert db.query(Associado).filter(Associado.id_associado == desligado.id_associado).one().pessoa.cpf == cpf, "o dado ainda serve ao outro papel ativo"


# ------------------------------------------------------------------------------------------------ 3. Auditoria, idempotência, falha isolada, roteiro
def test_a_auditoria_guarda_so_as_contagens_e_so_quando_algo_foi_aplicado(db):
    def ultimo():
        from sqlalchemy import func

        return db.query(func.coalesce(func.max(AuditLog.id_log), 0)).scalar()

    _rodar(db)  # limpa o que sobrou de outros testes
    antes = ultimo()
    assert _rodar(db)["aplicadas"] == {r.codigo: 0 for r in retencao.REGRAS}, "rodar de novo não faz nada"
    assert db.query(AuditLog).filter(AuditLog.id_log > antes, AuditLog.acao == "RETENCAO_APLICADA").count() == 0, "nada aplicado, nada na Auditoria"

    sigilosa = _atendimento(db, ENCERRADO, encerrado_ha=2500)
    db.query(Atendimento).filter(Atendimento.id_atendimento == sigilosa.id_atendimento).update({"nome_completo": "Pessoa Sigilosa Do Teste", "mensagem": "texto secreto do pedido"})
    db.commit()
    depois = ultimo()
    assert _rodar(db)["aplicadas"]["atendimentos"] >= 1
    entradas = db.query(AuditLog).filter(AuditLog.id_log > depois, AuditLog.acao == "RETENCAO_APLICADA").all()
    assert len(entradas) == 1 and entradas[0].id_usuario is None and entradas[0].tabela_afetada == "retencao"
    texto = str(entradas[0].dados_depois)
    assert "atendimentos" in texto and "Sigilosa" not in texto and "secreto" not in texto and "12345678909" not in texto


def test_uma_regra_que_falha_nao_derruba_as_outras(db, monkeypatch):
    def quebra(*_a, **_k):
        raise RuntimeError("banco indisponível nesta regra")

    velha = TentativaAcessoPublico(ip="10.9.9.8", rota=f"retencao-{_unico()}", criado_em=_ha(300))
    db.add(velha)
    db.commit()
    id_velha = velha.id_tentativa
    regras = tuple(
        retencao.Regra(r.codigo, r.rotulo, r.chave_de_config, r.padrao_em_dias, quebra if r.codigo == "atendimentos" else r.aplicar) for r in retencao.REGRAS
    )
    monkeypatch.setattr(retencao, "REGRAS", regras)
    resultado = _rodar(db)
    assert resultado["falhas"] == ["atendimentos"]
    assert "atendimentos" not in resultado["aplicadas"] and resultado["aplicadas"]["acessos"] >= 1
    db.expire_all()
    assert db.get(TentativaAcessoPublico, id_velha) is None, "as outras regras seguiram"


def _carregar_roteiro(nome):
    caminho = Path(__file__).resolve().parent.parent / "scripts" / "aplicar_retencao_de_dados.py"
    especificacao = importlib.util.spec_from_file_location(nome, caminho)
    roteiro = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(roteiro)
    return roteiro


class _SemFechar:
    """O roteiro fecha a sessão no fim; a do teste continua aberta."""

    def __init__(self, db):
        self._db = db

    def __getattr__(self, nome):
        return getattr(self._db, nome)

    def close(self):
        pass


def test_o_roteiro_do_sistema_roda_a_rotina_e_sai_com_1_se_alguma_regra_falhou(db, monkeypatch, capsys):
    roteiro = _carregar_roteiro("aplicar_retencao_de_dados_ok")
    monkeypatch.setattr(roteiro, "SessaoLocal", lambda: _SemFechar(db))
    assert roteiro.main() == 0

    vermelho = _carregar_roteiro("aplicar_retencao_de_dados_vermelho")
    monkeypatch.setattr(vermelho, "SessaoLocal", lambda: _SemFechar(db))
    monkeypatch.setattr(vermelho.retencao, "aplicar_todas", lambda _db: {"aplicadas": {"acessos": 3}, "falhas": ["atendimentos"]})
    assert vermelho.main() == 1
    saida = capsys.readouterr().out
    assert "[aplicar-retencao] acessos: 3" in saida and "::error::1 regra(s) de retenção falharam: atendimentos" in saida
