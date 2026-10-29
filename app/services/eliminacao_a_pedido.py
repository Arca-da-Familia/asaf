"""v7.2d (FASE 7) - a ELIMINAÇÃO A PEDIDO do titular (LGPD, art. 18, IV e VI; art. 16): decidida pelo encarregado, vendo antes o que sai e o que fica e por quê.

Decisões do Presidente: de 2026-10-28 (4) sempre decidida pelo encarregado (`privacidade_gerir`; no pedido sobre o próprio Presidente, quem o responde - decisão 10);
(5) sem bloqueio; (6) nunca apagado por lei: financeiro e recibos, atas e votações, livro de associados (nome e matrícula), prova dos consentimentos; (7) associado
ativo: os dados servem ao vínculo; desligado: anonimização na hora. De 2026-10-29 (aprovadas as recomendações A a G):
  A. pedido feito pela Minha conta (identidade provada só pelo código do e-mail): sai só o que foi feito com aquele e-mail, nunca o cadastro;
  B. quem ainda tem vínculo vivo: o cadastro fica enquanto durar, explicando qual, e sai o resto;
  C. eventos que já passaram: a pessoa sai e as contagens ficam; o certificado (e o crachá) de evento que passou perde o arquivo e o nome;
  D. pedidos antigos pelo site: texto e contatos apagados; o próprio pedido de eliminação fica como prova (e os pedidos de titular já atendidos também);
  E. intenção de doação sem recibo: apagada (a confirmada, e a que ainda espera a tesouraria conferir o Pix, ficam);
  F. de quem foi desligado: a conta de acesso ao painel (e-mail, segundo passo, sessões e chaves), a foto da Diretoria e os documentos anexados;
  G. em dois passos: a prévia (o que sai e o que fica, com o fundamento) e, depois de "conferi", a execução, com o protocolo na Auditoria.

Como funciona. A prévia é o relatório da pessoa (relatorio_do_titular, montado pelo pedido como na entrega da v7.2c) e o PLANO: as linhas que saem, escolhidas no
banco entre as do relatório (só as que são dela: a linha de outro cadastro com o mesmo e-mail nunca sai), e o que fica, com o fundamento. A impressão cobre o
relatório E o plano (o tempo que passa muda o plano: um mandato que vence, um evento que acaba) e a execução confere que é a mesma (409). A execução grava a
Auditoria ANTES de mexer, faz cada etapa e a grava (o arquivo é apagado antes da linha, como na rotina); se uma etapa falha, a Auditoria diz qual e a prévia
seguinte mostra o que ainda falta (cada etapa é idempotente). Nenhuma linha de pessoa é apagada: tudo é anonimizado campo a campo e as contagens ficam."""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.models.atendimento import EM_ATENDIMENTO, ENCERRADO, NOVO, RESPONDIDO, TITULAR_LGPD, Atendimento
from app.services import armazenamento, entrega_ao_titular, relatorio_do_titular
from app.services import atendimento as atendimentos

LOG = logging.getLogger("asaf.eliminacao")

SUBTIPOS_QUE_ELIMINAM = ("ELIMINACAO",)
NOME_REMOVIDO = "Pessoa removida (a pedido do titular)"
MARCADOR = "(apagado a pedido do titular)"
DESLIGADO = "Desligado"
MOTIVO = "a pedido do titular"
# os papéis cujo fim a eliminação pode decretar (o voluntário já tem o termo conferido em vinculos_vivos; o participante só serve aos eventos)
PAPEIS_QUE_ACABAM = ("associado", "participante_externo", "voluntario")

# o cadastro: sai inteiro quando não há vínculo vivo; senão fica, com o vínculo como fundamento
CADASTRO = frozenset({
    "pessoas", "associados", "enderecos", "usuarios", "valores_campo", "documentos_anexos", "fotos_da_diretoria", "preferencias_de_comunicacao",
    "registros_horas_voluntariado", "trocas_turno_voluntario", "mudancas_situacao", "papeis",
})
# as tabelas em que a eliminação escolhe linha a linha o que sai; o que resta delas fica, pelo motivo ao lado
RESTA: dict[str, tuple[str, str]] = {
    "atendimentos": ("OUTRO", "Ficam os pedidos ainda em andamento, os pedidos de titular já atendidos (a prova de que foram atendidos; a rotina apaga o texto em "
                              "5 anos) e os ligados a outro cadastro que usa o mesmo e-mail."),
    "intencoes_de_doacao": ("ESCRITURACAO_FINANCEIRA", "Ficam a intenção que virou doação (com recibo), a que ainda espera a tesouraria conferir o Pix e a de outro CPF."),
    "inscricoes": ("OUTRO", "Ficam as inscrições em eventos que ainda vão acontecer e as de outro cadastro; das que já passaram fica só a contagem do evento."),
    "respostas_pesquisa_satisfacao": ("OUTRO", "A nota da pesquisa de satisfação fica só como contagem; o comentário sai com a inscrição do evento que já passou."),
    "documentos_emitidos": ("OUTRO", "Ficam os documentos emitidos pela associação (declarações) e o crachá de evento que ainda vai acontecer, como registro do que foi emitido."),
    "propostas_filiacao": ("LIVRO_DE_ASSOCIADOS", "Fica a proposta que virou filiação (o registro da entrada no quadro de associados, Estatuto)."),
}
SAEM = CADASTRO | frozenset(RESTA)
_FINANCEIRO = ("ESCRITURACAO_FINANCEIRA", "A escrituração e os recibos são guardados por lei (Código Tributário Nacional e Código Civil).")
_ATAS = ("ATAS_E_VOTACOES", "Atas, votações e mandatos são o registro dos atos da associação (Estatuto).")
_SOCIAL = ("OUTRO", "O atendimento social tem eliminação própria, em Beneficiários (o prontuário e o consentimento são conferidos lá).")
FICAM: dict[str, tuple[str, str]] = {
    **{t: _FINANCEIRO for t in (
        "titulos_financeiros", "doacoes", "creditos_associado", "negociacoes_divida", "isencoes_contribuicao", "isencoes_taxa_contexto", "reembolsos_despesa",
        "fornecedores", "dados_bancarios_fornecedor", "cotacoes_compra", "contas_a_pagar_recorrentes", "solicitacoes_compra", "aprovacoes_compra",
        "questionamentos_lancamento", "delegacoes_aprovacao")},
    **{t: _ATAS for t in (
        "votos_abertos", "comprovantes_voto_secreto", "credenciamentos_assembleia", "habilitados_assembleia", "impugnacoes_votacao",
        "justificativas_falta_assembleia", "adesoes_peticao", "declaracoes_conflito_interesse", "mandatos", "historico_cargos", "atos_do_encarregado")},
    **{t: _SOCIAL for t in ("beneficiarios", "beneficiarios_projeto", "registros_atendimento", "encaminhamentos_rede_externa")},
    "consentimentos": ("PROVA_DE_CONSENTIMENTO", "A prova do consentimento fica pelo prazo dela (LGPD, art. 8º, § 2º)."),
    "termos_adesao_voluntario": ("OUTRO", "O termo de adesão é a prova do serviço voluntário (Lei 9.608/1998); a rotina apaga as referências 5 anos depois do fim."),
    "eventos_linha_do_tempo": ("LIVRO_DE_ASSOCIADOS", "O histórico do cadastro de associado acompanha o livro de associados (Estatuto)."),
    "propostas_de_socios": ("LIVRO_DE_ASSOCIADOS", "A indicação dos sócios é parte do registro da filiação (Estatuto)."),
    "processos_disciplinares": ("OUTRO", "O processo disciplinar é registro da associação previsto no Estatuto."),
    "manifestacoes_diretoria_disciplinar": ("OUTRO", "O processo disciplinar é registro da associação previsto no Estatuto."),
    "funcionarios": ("OUTRO", "O registro de quem trabalhou na associação é guardado pela lei trabalhista e previdenciária."),
    "registros_presenca": ("OUTRO", "A presença fica só como contagem do evento (quantas pessoas vieram)."),
    "alocacoes_voluntarios": ("OUTRO", "A escala fica só como registro das horas de voluntariado (o texto livre sai)."),
    "equipe_projeto": ("OUTRO", "A equipe do projeto é registro da prestação de contas do projeto."),
    "dependentes_familiares": ("OUTRO", "O núcleo familiar pertence também ao cadastro do associado titular."),
    "avisos_destinatarios": ("OUTRO", "A prova de que um aviso obrigatório foi entregue (convocação, mudança de regra) fica."),
    "entregas_de_aviso": ("OUTRO", "A prova de que um aviso obrigatório foi entregue (convocação, mudança de regra) fica."),
    "reservas_espaco": ("OUTRO", "O registro de uso do espaço da associação fica."),
}


def _agora() -> datetime:
    return datetime.utcnow()


def _pedido_valido(a: Atendimento) -> None:
    if a.tipo != TITULAR_LGPD or a.subtipo not in SUBTIPOS_QUE_ELIMINAM:
        raise HTTPException(status_code=400, detail="Só a solicitação do titular que pede a eliminação abre a eliminação.")
    if a.identidade_validada_em is None:
        raise HTTPException(status_code=400, detail="Valide antes a identidade de quem pediu.")
    if a.status == ENCERRADO:
        raise HTTPException(status_code=400, detail="O pedido está encerrado: para eliminar, a pessoa faz um novo pedido.")


# ------------------------------------------------------------------------------------------------ o que segura o cadastro
def vinculos_vivos(db: Session, id_pessoa: int, agora: datetime) -> list[str]:
    """Por que o CADASTRO ainda não pode sair (decisão B), em palavras para a resposta à pessoa. Mais estrito que a rotina de guarda: na dúvida, o cadastro fica."""
    from app.models.associados import Associado, DependenteFamiliar
    from app.models.beneficiarios import Beneficiario, BeneficiarioProjeto
    from app.models.financeiro import TituloFinanceiro
    from app.models.mandatos import Mandato
    from app.models.motores import Inscricao
    from app.models.pessoas import Papel
    from app.models.voluntariado import Funcionario, TermoAdesaoVoluntario
    from app.services.fuso import dia_em_belem
    from app.services.retencao_participacao import _fim_dos_eventos

    motivos = []
    associados = db.query(Associado).filter(Associado.id_pessoa == id_pessoa).all()
    for x in associados:
        if x.status_arrolamento != DESLIGADO:
            motivos.append(f"está no quadro de associados (situação: {x.status_arrolamento}): os dados servem ao vínculo enquanto ele durar")
        elif x.data_desligamento is None:
            motivos.append("o desligamento do cadastro de associado não tem data registrada (a secretaria registra a data antes)")
        elif x.data_desligamento > agora:
            motivos.append(f"o desligamento só vale a partir de {dia_em_belem(x.data_desligamento)}")
    ids_associado = [x.id_associado for x in associados]
    if ids_associado:
        if any(m.vigente(agora) or m.data_inicio > agora for m in db.query(Mandato).filter(Mandato.id_associado.in_(ids_associado))
               if m.data_fim_efetivo is None or m.data_fim_efetivo > agora):
            motivos.append("tem mandato vigente (ou que vai começar) na Diretoria ou no Conselho Fiscal")
        if db.query(TituloFinanceiro.id_titulo).filter(TituloFinanceiro.id_associado.in_(ids_associado), TituloFinanceiro.status == "Aberto").first():
            motivos.append("tem débito em aberto com a associação (a cobrança precisa do contato: LGPD, art. 7º, VI)")
    if any(t.ativo and (t.data_fim_vigencia is None or t.data_fim_vigencia >= agora)
           for t in db.query(TermoAdesaoVoluntario).filter(TermoAdesaoVoluntario.id_pessoa == id_pessoa)):
        motivos.append("é voluntário(a) com termo de adesão em vigor")
    beneficiarios = [b for (b,) in db.query(Beneficiario.id_beneficiario).filter(Beneficiario.id_pessoa == id_pessoa)]
    if beneficiarios:
        em_curso = db.query(BeneficiarioProjeto.id_vinculo).filter(
            BeneficiarioProjeto.id_beneficiario.in_(beneficiarios),
            or_(BeneficiarioProjeto.data_fim.is_(None), BeneficiarioProjeto.data_fim >= agora)).first()
        motivos.append("é atendido(a) num projeto" if em_curso else "tem cadastro no atendimento social (a eliminação dele é feita em Beneficiários)")
    if db.query(Funcionario.id_funcionario).filter(Funcionario.id_pessoa == id_pessoa).first():
        motivos.append("trabalhou ou trabalha na associação (o registro trabalhista e previdenciário guarda a identificação)")
    if db.query(DependenteFamiliar.id_pessoa_titular).filter(
            or_(DependenteFamiliar.id_pessoa_titular == id_pessoa, DependenteFamiliar.id_pessoa_vinculada == id_pessoa)).first():
        motivos.append("faz parte do núcleo familiar de um associado")
    outros = [t for (t,) in db.query(Papel.tipo_papel).filter(Papel.id_pessoa == id_pessoa, Papel.ativo.is_(True), Papel.tipo_papel.not_in(
        PAPEIS_QUE_ACABAM + ("beneficiario", "funcionario")))]
    if outros:
        motivos.append(f"tem outro papel ativo na associação ({', '.join(sorted(set(outros)))})")
    fins = _fim_dos_eventos(db)
    if any(fins.get((c, i), datetime.max) >= agora for c, i in db.query(Inscricao.contexto_tipo, Inscricao.id_contexto).filter(Inscricao.id_pessoa == id_pessoa)):
        motivos.append("está inscrito(a) num evento que ainda vai acontecer")
    return motivos


def _valores_do_cadastro(db: Session, id_pessoa: int, ids_associado: list[int]) -> list:
    """Os campos personalizados do cadastro da pessoa e do associado (o número do registro só vale junto com o tipo de cadastro do campo)."""
    from app.models.core import DefinicaoCampo, ValorCampo

    valores = []
    for valor, definicao in db.query(ValorCampo, DefinicaoCampo).join(DefinicaoCampo, DefinicaoCampo.id_definicao == ValorCampo.id_definicao).all():
        entidade = (definicao.entidade or "").strip().lower()
        if (entidade == "pessoa" and valor.id_registro == id_pessoa) or (entidade == "associado" and valor.id_registro in ids_associado):
            valores.append(valor)
    return valores


def _cadastro_pendente(db: Session, id_pessoa: int) -> bool:
    """Ainda há o que tirar do cadastro (a segunda execução não promete o que já foi feito)."""
    from app.models.associados import Associado, DocumentoAnexo, Endereco
    from app.models.core import Usuario
    from app.models.mandatos import FotoDaDiretoria
    from app.models.pessoas import Papel, Pessoa
    from app.models.preferencias_de_comunicacao import PreferenciaDeComunicacao
    from app.services.retencao_participacao import CAMPOS_DA_PESSOA

    pessoa = db.get(Pessoa, id_pessoa)
    if pessoa is None:
        return False
    associados = db.query(Associado).filter(Associado.id_pessoa == id_pessoa).all()
    ids = [x.id_associado for x in associados]
    if any(getattr(pessoa, c) is not None for c in CAMPOS_DA_PESSOA) or (not associados and pessoa.nome_completo != NOME_REMOVIDO):
        return True
    contas = [x.id_usuario for x in associados if x.id_usuario is not None]
    if _valores_do_cadastro(db, id_pessoa, ids):
        return True
    return any(q.first() is not None for q in (
        db.query(Endereco.id_endereco).filter(Endereco.id_associado.in_(ids)) if ids else None,
        db.query(DocumentoAnexo.id_documento).filter(DocumentoAnexo.id_associado.in_(ids)) if ids else None,
        db.query(FotoDaDiretoria.id_foto).filter(FotoDaDiretoria.id_pessoa == id_pessoa),
        db.query(Usuario.id_usuario).filter(Usuario.id_usuario.in_(contas), ~Usuario.email.like("removido-%")) if contas else None,
        db.query(PreferenciaDeComunicacao.id_pessoa).filter(PreferenciaDeComunicacao.id_pessoa == id_pessoa),
        db.query(Papel.id_papel).filter(Papel.id_pessoa == id_pessoa, Papel.ativo.is_(True), Papel.tipo_papel.in_(PAPEIS_QUE_ACABAM)),
    ) if q is not None)


# ------------------------------------------------------------------------------------------------ a prévia
def _numeros(relatorio: dict, tabela: str) -> list[int]:
    return [linha["numero"] for s in relatorio["secoes"] if s["tabela"] == tabela for linha in s["linhas"]]


def planejar(db: Session, a: Atendimento, agora: Optional[datetime] = None) -> dict:
    """A prévia: o relatório do pedido, as linhas que saem (escolhidas no banco: só as que são dela), o que fica (com o fundamento) e os vínculos que seguram o cadastro."""
    from app.models.filiacao import APROVADA, PropostaFiliacao
    from app.models.intencoes_de_doacao import CONFIRMADA, IntencaoDeDoacao
    from app.models.motores import DocumentoEmitido, Inscricao, TemplateDocumento
    from app.models.pessoas import Pessoa
    from app.services.retencao_participacao import MODELOS_DE_EVENTO, _fim_dos_eventos

    agora = agora or _agora()
    _pedido_valido(a)
    # v7.2g: a validação automática (o e-mail e o CPF digitados, ou o código do e-mail) prova só o e-mail: a eliminação, que não tem volta, fica no que foi
    # feito com ele até a equipe conferir a identidade por outro meio (o reforço em "Identidade de quem pediu")
    so_email = a.identidade_validacao in atendimentos.IDENTIDADES_AUTOMATICAS_FRACAS
    relatorio = relatorio_do_titular.montar(db, email=a.email_contato) if so_email else relatorio_do_titular.montar(db, **entrega_ao_titular.quem_do_pedido(a))
    id_pessoa = (relatorio.get("pessoa") or {}).get("id_pessoa")
    pessoa = db.get(Pessoa, id_pessoa) if id_pessoa is not None else None
    cpf = relatorio_do_titular._so_digitos(pessoa.cpf if pessoa else a.cpf)
    vinculos = vinculos_vivos(db, id_pessoa, agora) if id_pessoa is not None else []
    cadastro_sai = id_pessoa is not None and not vinculos and _cadastro_pendente(db, id_pessoa)
    fins = _fim_dos_eventos(db)
    dela = (lambda coluna: coluna.is_(None)) if id_pessoa is None else (lambda coluna: or_(coluna.is_(None), coluna == id_pessoa))

    ids: dict[str, list[int]] = {}
    numeros = _numeros(relatorio, "atendimentos")
    ids["atendimentos"] = [x for (x,) in db.query(Atendimento.id_atendimento).filter(
        Atendimento.id_atendimento.in_(numeros), Atendimento.id_atendimento != a.id_atendimento, Atendimento.tipo != TITULAR_LGPD,
        Atendimento.status.in_([RESPONDIDO, ENCERRADO]), Atendimento.mensagem != MARCADOR, dela(Atendimento.id_pessoa))] if numeros else []
    numeros = _numeros(relatorio, "intencoes_de_doacao")
    ids["intencoes_de_doacao"] = [i.id_intencao for i in db.query(IntencaoDeDoacao).filter(
        IntencaoDeDoacao.id_intencao.in_(numeros), IntencaoDeDoacao.id_doacao.is_(None), IntencaoDeDoacao.status != CONFIRMADA,
        or_(IntencaoDeDoacao.status != "PENDENTE", IntencaoDeDoacao.expira_em < agora))
        if not i.documento_doador or relatorio_do_titular._so_digitos(i.documento_doador) == cpf] if numeros else []
    numeros = _numeros(relatorio, "inscricoes")
    passadas = [i for i in db.query(Inscricao).filter(Inscricao.id_inscricao.in_(numeros)) if fins.get((i.contexto_tipo, i.id_contexto), datetime.max) < agora] \
        if numeros else []
    if so_email:
        # só pelo e-mail: sai a ligação com o e-mail (quem foi inscrito pode ser outra pessoa, como o filho); as respostas e os códigos ficam com a rotina
        ids["inscricoes"] = [i.id_inscricao for i in passadas if i.email_da_inscricao]
    else:
        ids["inscricoes"] = [i.id_inscricao for i in passadas if i.id_pessoa == id_pessoa and any(
            (i.respostas_formulario, i.email_da_inscricao, i.codigo_checkin, i.token_cancelamento))]
    numeros = _numeros(relatorio, "documentos_emitidos")
    ids["documentos_emitidos"] = [d.id_documento for d in db.query(DocumentoEmitido).join(
        TemplateDocumento, TemplateDocumento.id_template == DocumentoEmitido.id_template).filter(
        DocumentoEmitido.id_documento.in_(numeros), TemplateDocumento.codigo.in_(MODELOS_DE_EVENTO), DocumentoEmitido.contexto_tipo == "Evento",
        or_(DocumentoEmitido.caminho_arquivo != "", DocumentoEmitido.id_pessoa.isnot(None)))
        if fins.get(("Evento", d.id_contexto), datetime.max) < agora] if numeros else []
    numeros = _numeros(relatorio, "propostas_filiacao")
    ids["propostas_filiacao"] = [p.id_proposta for p in db.query(PropostaFiliacao).filter(
        PropostaFiliacao.id_proposta.in_(numeros), PropostaFiliacao.status != APROVADA, PropostaFiliacao.id_associado_efetivado.is_(None))
        if not so_email and cpf and relatorio_do_titular._so_digitos(p.cpf) == cpf] if numeros else []

    sai = []
    if ids["atendimentos"]:
        sai.append(f"{len(ids['atendimentos'])} pedido(s) antigo(s) feito(s) pelo site: o texto e os contatos")
    if ids["intencoes_de_doacao"]:
        sai.append(f"{len(ids['intencoes_de_doacao'])} intenção(ões) de doação sem recibo")
    if ids["inscricoes"]:
        sai.append(f"{len(ids['inscricoes'])} inscrição(ões) em eventos que já passaram: " + (
            "a ligação com este e-mail" if so_email else "as respostas, o e-mail e os códigos (a contagem do evento fica)"))
    if ids["documentos_emitidos"]:
        sai.append(f"{len(ids['documentos_emitidos'])} certificado(s) ou crachá(s) de evento que já passou: o arquivo e o nome (o código de verificação continua válido)")
    if ids["propostas_filiacao"]:
        sai.append(f"{len(ids['propostas_filiacao'])} proposta(s) de filiação que não virou(viraram) filiação")
    tabelas = {s["tabela"]: s for s in relatorio["secoes"]}
    if cadastro_sai:
        if "associados" in tabelas:
            sai.append("o cadastro de associado: CPF, contatos, data de nascimento, foto e endereço (ficam o nome e a matrícula, no livro de associados)")
            sai.append("a conta de acesso ao painel (e-mail, segundo passo, sessões e chaves), a foto da Diretoria e os documentos anexados, se houver")
        else:
            sai.append("o cadastro: nome, CPF, contatos, data de nascimento e foto")
        sai.append("os campos personalizados, as preferências de e-mail e o texto livre das horas de voluntariado, se houver")

    fica = []
    for t, s in tabelas.items():
        n = len(s["linhas"])
        nome = s["atividades"][0]["nome"] if s["atividades"] else t
        if t in FICAM:
            codigo, porque = FICAM[t]
        elif t in CADASTRO:
            if cadastro_sai:
                if t == "associados":
                    fica.append({"tabela": t, "registros": n, "fundamento": "LIVRO_DE_ASSOCIADOS", "nome": nome,
                                 "por_que": "O nome e a matrícula ficam no livro de associados (Estatuto)."})
                continue
            if id_pessoa is None or not vinculos:
                continue  # sem cadastro no relatório, ou o cadastro já foi tirado (segunda execução)
            codigo, porque = "VINCULO_ATIVO", "O cadastro fica enquanto durar o vínculo: " + "; ".join(vinculos) + "."
        elif t in RESTA:
            if t == "atendimentos":
                n -= 1  # este pedido entra abaixo, à parte
            n -= len(ids.get(t, []))
            if n <= 0:
                continue
            codigo, porque = RESTA[t]
        else:  # pragma: no cover - o teste reprova a tabela sem destino
            continue
        fica.append({"tabela": t, "registros": n, "fundamento": codigo, "por_que": porque, "nome": nome})
    if so_email and db.query(Pessoa.id_pessoa).filter(func.lower(Pessoa.email_contato) == (a.email_contato or "").strip().lower()).first():
        fica.append({"tabela": "pessoas", "registros": 1, "fundamento": "IDENTIDADE_NAO_CONFIRMADA", "nome": "O cadastro ligado a este e-mail",
                     "por_que": "O pedido provou só o e-mail: o cadastro só sai depois de a equipe conferir a identidade da pessoa por outro meio (em "
                                "\"Identidade de quem pediu\", neste pedido) e abrir a prévia de novo."})
    resultado = "ATENDIDO" if not fica else ("ATENDIDO_EM_PARTE" if sai else "NEGADO")
    fundamento = next((f["fundamento"] for f in fica if f["fundamento"] == "VINCULO_ATIVO"), fica[0]["fundamento"] if fica else None)
    fica.append({"tabela": "atendimentos", "registros": 1, "fundamento": "OUTRO", "nome": "Este pedido de eliminação",
                 "por_que": "Fica como prova de que o pedido foi atendido; a rotina de guarda apaga o texto e os contatos 5 anos depois."})
    plano = {"vinculos": vinculos, "cadastro_sai": cadastro_sai, "ids": ids}
    impressao = hashlib.sha256((relatorio["impressao"] + json.dumps(plano, sort_keys=True)).encode("utf-8")).hexdigest()
    return {
        "relatorio": relatorio, "impressao": impressao, "id_pessoa": id_pessoa, **plano, "sai": sai, "fica": fica,
        "resultado_sugerido": resultado, "fundamento_sugerido": fundamento,
    }


def previa(db: Session, a: Atendimento) -> dict:
    p = planejar(db, a)
    return {k: p[k] for k in ("impressao", "vinculos", "cadastro_sai", "sai", "fica", "resultado_sugerido", "fundamento_sugerido")} | {
        "pessoa": p["relatorio"]["pessoa"], "algum_corte": p["relatorio"]["algum_corte"]}


# ------------------------------------------------------------------------------------------------ a execução
def _remover_arquivo(url: Optional[str]) -> None:
    alvo = armazenamento.separar_url(url) if url else None
    if alvo is not None:
        armazenamento.obter().remover(*alvo)  # se falhar, levanta antes de a linha mudar: dá para tentar de novo


def _pedidos(db: Session, ids: list[int]) -> None:
    """O mesmo que a rotina de 5 anos faz com o pedido antigo (retencao._pedidos_de_atendimento), com o marcador de "a pedido"."""
    for p in db.query(Atendimento).filter(Atendimento.id_atendimento.in_(ids)):
        p.nome_completo = NOME_REMOVIDO
        p.email_contato = p.telefone_whatsapp = p.cpf = p.data_nascimento = p.id_pessoa = p.chave_remetente = p.impressao_do_pedido = None
        p.assunto = p.motivo_encerramento = p.identidade_nota = None
        p.mensagem = MARCADOR
        if p.resposta is not None:
            p.resposta = MARCADOR
    db.commit()


def _intencoes(db: Session, ids: list[int]) -> None:
    from app.models.intencoes_de_doacao import IntencaoDeDoacao

    db.query(IntencaoDeDoacao).filter(IntencaoDeDoacao.id_intencao.in_(ids), IntencaoDeDoacao.id_doacao.is_(None)).delete(synchronize_session=False)
    db.commit()


def _inscricoes(db: Session, ids: list[int], so_email: bool) -> None:
    from app.models.motores import Inscricao
    from app.models.pesquisa_satisfacao import RespostaPesquisaSatisfacao

    for i in db.query(Inscricao).filter(Inscricao.id_inscricao.in_(ids)):
        i.email_da_inscricao = None
        if not so_email:
            i.respostas_formulario = i.codigo_checkin = i.token_cancelamento = None  # o grupo fica: ele junta as inscrições de outras pessoas
    if not so_email:
        db.query(RespostaPesquisaSatisfacao).filter(RespostaPesquisaSatisfacao.id_inscricao.in_(ids), RespostaPesquisaSatisfacao.comentario.isnot(None)).update(
            {RespostaPesquisaSatisfacao.comentario: None}, synchronize_session=False)
    db.commit()


def _certificados(db: Session, ids: list[int]) -> None:
    from app.models.motores import DocumentoEmitido

    for d in db.query(DocumentoEmitido).filter(DocumentoEmitido.id_documento.in_(ids)).all():
        _remover_arquivo(d.caminho_arquivo)
        try:
            variaveis = json.loads(d.variaveis_usadas or "{}")
        except ValueError:
            variaveis = {}
        variaveis["nome_completo"] = None
        d.variaveis_usadas = json.dumps(variaveis, ensure_ascii=False)
        d.caminho_arquivo = ""
        d.id_pessoa = None
        db.commit()


def _propostas(db: Session, ids: list[int]) -> None:
    from app.models.filiacao import PropostaDeSocio, PropostaFiliacao

    db.query(PropostaDeSocio).filter(PropostaDeSocio.id_proposta.in_(ids)).delete(synchronize_session=False)
    db.query(PropostaFiliacao).filter(PropostaFiliacao.id_proposta.in_(ids)).delete(synchronize_session=False)
    db.commit()


def _cadastro(db: Session, id_pessoa: int, usuario, ip: Optional[str], protocolo: str, agora: datetime) -> None:
    """O cadastro de quem não tem mais vínculo (vinculos_vivos já conferiu): o do associado desligado pela anonimização do associado (ficam nome e matrícula) e o
    que ela não cobre (decisão F); quem não é associado perde também o nome. Cada parte é gravada: se uma falha, a seguinte execução continua."""
    from app.models.associados import Associado, DocumentoAnexo
    from app.models.core import CodigoRecuperacaoMFA, CredencialWebAuthn, TokenAcesso, Usuario
    from app.models.mandatos import FotoDaDiretoria
    from app.models.pessoas import Papel, Pessoa
    from app.models.preferencias_de_comunicacao import PreferenciaDeComunicacao
    from app.models.projetos import AlocacaoVoluntario, TrocaTurnoVoluntario
    from app.models.voluntariado import RegistroHorasVoluntariado, TermoAdesaoVoluntario
    from app.services import anonimizacao, fotos_da_diretoria
    from app.services.retencao_participacao import CAMPOS_DA_PESSOA

    associados = db.query(Associado).filter(Associado.id_pessoa == id_pessoa).all()
    ids_associado = [x.id_associado for x in associados]
    # o texto livre do voluntariado (o termo fica: é a prova do serviço voluntário)
    termos = [t for (t,) in db.query(TermoAdesaoVoluntario.id_termo).filter(TermoAdesaoVoluntario.id_pessoa == id_pessoa)]
    if termos:
        db.query(RegistroHorasVoluntariado).filter(RegistroHorasVoluntariado.id_termo.in_(termos), RegistroHorasVoluntariado.descricao_atividade.isnot(None)).update(
            {RegistroHorasVoluntariado.descricao_atividade: MARCADOR}, synchronize_session=False)
    alocacoes = [x for (x,) in db.query(AlocacaoVoluntario.id_alocacao).filter(AlocacaoVoluntario.id_pessoa == id_pessoa)]
    if alocacoes:
        db.query(TrocaTurnoVoluntario).filter(TrocaTurnoVoluntario.id_alocacao.in_(alocacoes), TrocaTurnoVoluntario.motivo.isnot(None)).update(
            {TrocaTurnoVoluntario.motivo: MARCADOR}, synchronize_session=False)
    # os campos personalizados, as preferências, os papéis que acabam e a cópia do relatório entregue
    for valor in _valores_do_cadastro(db, id_pessoa, ids_associado):
        db.delete(valor)
    db.query(PreferenciaDeComunicacao).filter(PreferenciaDeComunicacao.id_pessoa == id_pessoa).delete(synchronize_session=False)
    db.query(Papel).filter(Papel.id_pessoa == id_pessoa, Papel.ativo.is_(True), Papel.tipo_papel.in_(PAPEIS_QUE_ACABAM)).update(
        {Papel.ativo: False}, synchronize_session=False)
    entrega_ao_titular.apagar_da_pessoa(db, id_pessoa, agora)
    # F: a conta de acesso ao painel (sem login possível: e-mail trocado, sem o segundo passo, sem sessões nem chaves)
    for x in associados:
        conta = db.get(Usuario, x.id_usuario) if x.id_usuario is not None else None
        if conta is not None:
            conta.email, conta.ativo, conta.mfa_secret, conta.mfa_ativado = f"removido-{conta.id_usuario}@exemplo.invalid", False, None, False
            for modelo in (TokenAcesso, CodigoRecuperacaoMFA, CredencialWebAuthn):
                db.query(modelo).filter(modelo.id_usuario == conta.id_usuario).delete(synchronize_session=False)
    db.commit()
    # F: os documentos anexados (o arquivo antes da linha) e a foto da Diretoria (a função apaga o arquivo, a linha e encerra o consentimento)
    for doc in (db.query(DocumentoAnexo).filter(DocumentoAnexo.id_associado.in_(ids_associado)).all() if ids_associado else []):
        _remover_arquivo(doc.caminho_arquivo)
        db.delete(doc)
        db.commit()
    if associados and db.query(FotoDaDiretoria.id_foto).filter(FotoDaDiretoria.id_pessoa == id_pessoa).first():
        fotos_da_diretoria.apagar_foto(db, associados[0].id_associado, usuario=usuario, revogado=True,
                                       motivo=f"Eliminação a pedido do titular (protocolo {protocolo}).")
    if associados:
        for x in associados:
            anonimizacao.anonimizar_associado(db, x, usuario, ip, dias=0, agora=agora, motivo=f"{MOTIVO}, protocolo {protocolo}")
    else:
        pessoa = db.get(Pessoa, id_pessoa)
        _remover_arquivo(pessoa.foto)
        pessoa.nome_completo = NOME_REMOVIDO
        for campo in CAMPOS_DA_PESSOA:
            setattr(pessoa, campo, None)
        db.commit()


def executar(db: Session, a: Atendimento, impressao_conferida: str, usuario, ip: Optional[str] = None, agora: Optional[datetime] = None) -> dict:
    """Refaz a prévia, confere que é a mesma que foi conferida (senão 409) e elimina, etapa por etapa. A Auditoria guarda o protocolo, o que sai e o que fica ANTES
    de mexer; se uma etapa falha, guarda qual (e a prévia seguinte mostra o que falta). Devolve o plano executado."""
    agora = agora or _agora()
    plano = planejar(db, a, agora)
    if plano["impressao"] != impressao_conferida:
        raise HTTPException(status_code=409, detail="Os dados mudaram desde que você conferiu a prévia (entrou, saiu ou venceu algo): confira de novo.")
    if not plano["sai"]:
        raise HTTPException(status_code=400, detail="Não há nada que possa sair agora: responda à pessoa com o fundamento do que fica.")
    registrar_auditoria(db, usuario, "atendimentos", "ELIMINACAO_A_PEDIDO", id_registro_afetado=a.id_atendimento, ip_origem=ip,
                        dados_depois={"protocolo": a.protocolo, "id_pessoa": plano["id_pessoa"], "cadastro_sai": plano["cadastro_sai"], "sai": plano["sai"],
                                      "fica": [{"tabela": f["tabela"], "fundamento": f["fundamento"]} for f in plano["fica"]]})
    ids, so_email = plano["ids"], a.identidade_validacao in atendimentos.IDENTIDADES_AUTOMATICAS_FRACAS
    etapas = [
        ("pedidos", lambda: _pedidos(db, ids["atendimentos"])),
        ("intencoes", lambda: _intencoes(db, ids["intencoes_de_doacao"])),
        ("inscricoes", lambda: _inscricoes(db, ids["inscricoes"], so_email)),
        ("certificados", lambda: _certificados(db, ids["documentos_emitidos"])),
        ("propostas", lambda: _propostas(db, ids["propostas_filiacao"])),
    ]
    if plano["cadastro_sai"]:
        etapas.append(("cadastro", lambda: _cadastro(db, plano["id_pessoa"], usuario, ip, a.protocolo, agora)))
    for nome, etapa in etapas:
        try:
            etapa()
        except Exception as erro:
            db.rollback()
            LOG.exception("a eliminação do pedido %s parou na etapa %s", a.protocolo, nome)
            registrar_auditoria(db, usuario, "atendimentos", "ELIMINACAO_A_PEDIDO_INCOMPLETA", id_registro_afetado=a.id_atendimento, ip_origem=ip,
                                dados_depois={"protocolo": a.protocolo, "parou_em": nome, "erro": type(erro).__name__})
            raise HTTPException(status_code=502, detail="Parte da eliminação foi feita e parte não (o armazenamento ou o banco falhou). Abra a prévia de novo: "
                                                        "ela mostra o que ainda falta, e eliminar de novo termina.") from erro
    return plano
