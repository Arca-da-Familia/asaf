"""v7.2b (FASE 7) - o RELATÓRIO DOS DADOS DE UMA PESSOA (LGPD, art. 18, I, II e VII; art. 19): tudo o que o sistema guarda sobre ela, tabela por tabela, com a
atividade do inventário de cada uma (para que serve, a base legal, com quem é compartilhado e por quanto tempo é guardado).

Decisões do Presidente (2026-10-28): só o ENCARREGADO gera (permissão `privacidade_gerir`; ou quem atende a solicitação do titular dela, quando o pedido é sobre o
próprio Presidente - decisão 10); entra todo dado pessoal, inclusive as anotações da equipe e o histórico; a AUDITORIA fica de fora.

Como acha os dados. A partir da pessoa (o número do cadastro, o CPF, o e-mail; com o número, o CPF e o e-mail do cadastro dela também valem) junta os números dela
nas tabelas-âncora (cadastro, associado, beneficiário e o vínculo aos projetos, usuário do painel, inscrições, pedidos do site, pedidos de doação, pedido de
filiação, processo disciplinar, termo de adesão e escala de voluntário, avisos do mural recebidos) e, em cada tabela do modelo, traz as linhas que apontam para
elas por chave estrangeira - menos as ligações em que a pessoa aparece como quem OPEROU ou em que o conteúdo é sobre OUTRA pessoa (`LIGACOES_DE_OUTRA_NATUREZA`). Uma
tabela nova ligada à pessoa entra sozinha; o teste confere que toda ligação nova foi pensada.

O que mostra: as colunas da linha (o contexto: datas, valores, situação), com o nome do evento/projeto no lugar do número, MENOS os segredos (senha cifrada, semente do
segundo passo, códigos e chaves de acesso: `COLUNAS_SECRETAS`) e os números internos de outras pessoas. Tabelas técnicas de segurança (sessões, códigos de acesso)
não entram. A leitura vai para a Auditoria (quantas tabelas e linhas e quais têm dado sensível; nunca os valores)."""
from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app import classificacao_de_dados as cl

# o que nunca entra: a Auditoria (decisão de 2026-10-28), as tabelas técnicas de segurança e de controle, e os avisos do sino (o texto cita OUTRAS pessoas)
FORA_DO_RELATORIO = {
    "audit_log", "textos_de_privacidade", "tokens_acesso", "codigos_de_nova_senha", "codigos_recuperacao_mfa", "credenciais_webauthn", "codigos_de_visitante",
    "sessoes_de_visitante", "operacoes_portaria_idempotentes", "notificacoes_painel", "fila_revisao_cadastro", "versoes_de_atividade_de_tratamento",
    "entregas_ao_titular",  # v7.2c: a cópia do próprio relatório entregue (repeti-la dentro do relatório seguinte não diz nada novo)
}
# as ligações em que a pessoa aparece como quem OPEROU, como responsável institucional, ou em que o conteúdo é sobre outra pessoa (o titular dele é outro)
LIGACOES_DE_OUTRA_NATUREZA = {
    ("auditorias_de_titulo", "id_associado_conselheiro"), ("pareceres_prestacao_contas", "id_associado_conselheiro"),
    ("deliberacoes", "id_associado_responsavel"), ("eventos", "id_associado_responsavel"), ("projetos_eventos", "id_associado_responsavel"),
    ("itens_cronograma_projeto", "id_associado_responsavel"),
    ("manifestacoes_diretoria_disciplinar", "id_associado_diretor"),  # é sobre o processado: entra no relatório dele pelo processo
    ("propostas_de_socios", "id_associado"),  # a observação do sócio é sobre o candidato: entra no relatório dele pela proposta
    ("trocas_turno_voluntario", "id_associado_substituto"),  # o motivo é de quem pediu a troca: entra no relatório dele pela escala
}
# as ligações que FORAM PENSADAS e são dela (o teste reprova a ligação nova que não estiver aqui nem em LIGACOES_DE_OUTRA_NATUREZA: quem cria a tabela decide)
LIGACOES_DA_PESSOA = frozenset({
    ('adesoes_peticao', 'id_associado'), ('alocacoes_voluntarios', 'id_pessoa'), ('alocacoes_voluntarios', 'id_associado'),
    ('aprovacoes_compra', 'id_associado_creditado'), ('associados', 'id_pessoa'), ('associados', 'id_usuario'), ('atendimentos', 'id_pessoa'),
    ('atos_do_encarregado', 'id_associado_encarregado'), ('atos_do_encarregado', 'id_associado_substituto'), ('avisos_destinatarios', 'id_associado'),
    ('avisos_destinatarios', 'id_usuario'), ('beneficiarios', 'id_pessoa'), ('beneficiarios_projeto', 'id_beneficiario'),
    ('comprovantes_voto_secreto', 'id_associado'), ('consentimentos', 'id_pessoa'), ('contas_a_pagar_recorrentes', 'id_fornecedor'),
    ('cotacoes_compra', 'id_fornecedor'), ('credenciamentos_assembleia', 'id_associado'), ('creditos_associado', 'id_associado'),
    ('dados_bancarios_fornecedor', 'id_fornecedor'), ('declaracoes_conflito_interesse', 'id_associado'), ('declaracoes_conflito_interesse', 'id_fornecedor'),
    ('delegacoes_aprovacao', 'id_associado_delegante'), ('delegacoes_aprovacao', 'id_associado_delegado'), ('dependentes_familiares', 'id_pessoa_titular'),
    ('dependentes_familiares', 'id_pessoa_vinculada'), ('doacoes', 'id_associado'), ('documentos_anexos', 'id_associado'),
    ('documentos_emitidos', 'id_pessoa'), ('encaminhamentos_rede_externa', 'id_vinculo'), ('enderecos', 'id_associado'),
    ('entregas_de_aviso', 'id_destinatario'), ('equipe_projeto', 'id_associado'), ('eventos_linha_do_tempo', 'id_pessoa'), ('fotos_da_diretoria', 'id_pessoa'),
    ('funcionarios', 'id_pessoa'), ('habilitados_assembleia', 'id_associado'), ('historico_cargos', 'id_associado'),
    ('impugnacoes_votacao', 'id_associado_impugnante'), ('inscricoes', 'id_pessoa'), ('intencoes_de_doacao', 'id_doacao'),
    ('isencoes_contribuicao', 'id_associado'), ('isencoes_taxa_contexto', 'id_pessoa'), ('justificativas_falta_assembleia', 'id_associado'),
    ('mandatos', 'id_associado'), ('manifestacoes_diretoria_disciplinar', 'id_processo'), ('mudancas_situacao', 'id_associado'),
    ('negociacoes_divida', 'id_associado'), ('papeis', 'id_pessoa'), ('preferencias_de_comunicacao', 'id_pessoa'), ('processos_disciplinares', 'id_associado'),
    ('propostas_de_socios', 'id_proposta'), ('propostas_filiacao', 'id_associado_efetivado'), ('questionamentos_lancamento', 'id_associado_questionador'),
    ('reembolsos_despesa', 'id_associado'), ('registros_atendimento', 'id_vinculo'), ('registros_horas_voluntariado', 'id_termo'),
    ('registros_horas_voluntariado', 'id_alocacao'), ('registros_presenca', 'id_pessoa'), ('reservas_espaco', 'id_associado_solicitante'),
    ('respostas_pesquisa_satisfacao', 'id_inscricao'), ('solicitacoes_compra', 'id_fornecedor'), ('termos_adesao_voluntario', 'id_pessoa'),
    ('titulos_financeiros', 'id_associado'), ('titulos_financeiros', 'id_fornecedor'), ('trocas_turno_voluntario', 'id_alocacao'),
    ('votos_abertos', 'id_associado'),
})
# segredos: nunca saem (quem os tivesse entraria no lugar da pessoa)
COLUNAS_SECRETAS = re.compile(r"(senha|hash|secret|segredo|token|impressao|chave_publica|chave_remetente|chave_idempotencia|codigo_checkin)", re.I)
# os números internos de pessoas (não dizem nada a quem lê e podem ser de outra pessoa)
TABELAS_DE_PESSOA = {"pessoas", "associados", "usuarios", "beneficiarios", "beneficiarios_projeto"}
# o que dá nome a um número (o evento, o projeto...): a primeira destas colunas que a tabela de destino tiver
COLUNAS_DE_NOME = ("titulo", "nome_projeto", "nome", "razao_social", "rotulo", "descricao")
LIMITE_DE_LINHAS_POR_TABELA = 500
NAO_LOCALIZAVEL = (
    "Não entram automaticamente: a Auditoria do sistema (o registro técnico de quem fez o quê); as atas, os documentos institucionais e as fotos de eventos, "
    "que citam pessoas pelo nome no texto ou na imagem (se a pessoa aparece neles, o encarregado confere à mão); os registros técnicos de acesso (sessões, códigos "
    "e chaves de entrada), que são segredos de segurança; e, no atendimento por família, o que o relato diz das outras pessoas da casa."
)


def _so_digitos(texto: Optional[str]) -> str:
    return "".join(c for c in (texto or "") if c.isdigit())


def _valor(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, (bytes, bytearray, memoryview)):
        return "(arquivo)"
    return v


def _ids(db: Session, coluna_id, *condicoes) -> set:
    condicoes = [c for c in condicoes if c is not None]
    return {i for (i,) in db.query(coluna_id).filter(or_(*condicoes))} if condicoes else set()


def _ancoras(db: Session, *, id_pessoa: Optional[int], cpf: Optional[str], email: Optional[str]) -> tuple[dict[str, set], str, str]:
    """Os números da pessoa nas tabelas-âncora. Devolve (âncoras, cpf, e-mail) - com o cadastro, o CPF e o e-mail dele completam a busca."""
    from app.models.associados import Associado
    from app.models.atendimento import Atendimento
    from app.models.beneficiarios import Beneficiario, BeneficiarioProjeto
    from app.models.comunicacao import AvisoDestinatario
    from app.models.doacoes import Doacao
    from app.models.filiacao import PropostaFiliacao
    from app.models.intencoes_de_doacao import IntencaoDeDoacao
    from app.models.motores import Inscricao
    from app.models.pessoas import Pessoa
    from app.models.projetos import AlocacaoVoluntario
    from app.models.voluntariado import TermoAdesaoVoluntario

    cpf = _so_digitos(cpf)
    email = (email or "").strip().lower()
    pessoas: set = set()
    if id_pessoa is not None:
        pessoa = db.get(Pessoa, id_pessoa)
        if pessoa is None:
            raise HTTPException(status_code=404, detail="Pessoa não encontrada no cadastro.")
        pessoas.add(id_pessoa)
        # o CPF e o e-mail do cadastro também acham o que ela fez pelo site (pedido de doação, pedido do titular sem ligação ao cadastro, inscrição pelo e-mail)
        cpf = cpf or _so_digitos(pessoa.cpf)
        email = email or (pessoa.email_contato or "").strip().lower()
    if cpf:
        pessoas |= _ids(db, Pessoa.id_pessoa, Pessoa.cpf == cpf)
    em_pessoas = (lambda coluna: coluna.in_(pessoas)) if pessoas else (lambda coluna: None)
    associados = _ids(db, Associado.id_associado, em_pessoas(Associado.id_pessoa))
    em_associados = (lambda coluna: coluna.in_(associados)) if associados else (lambda coluna: None)
    beneficiarios = _ids(db, Beneficiario.id_beneficiario, em_pessoas(Beneficiario.id_pessoa))
    vinculos = _ids(db, BeneficiarioProjeto.id_vinculo, BeneficiarioProjeto.id_beneficiario.in_(beneficiarios) if beneficiarios else None)
    usuarios = {i for (i,) in db.query(Associado.id_usuario).filter(Associado.id_associado.in_(associados), Associado.id_usuario.isnot(None))} if associados else set()
    so_cpf = (lambda coluna: coluna == cpf) if cpf else (lambda coluna: None)

    def so_email(coluna, outra=None, dela=None):
        """Pelo e-mail - mas, quando a linha diz de quem é (outra pessoa do cadastro, outro CPF), só se for dela: a família que usa um e-mail só não mistura os
        pedidos e as inscrições dos irmãos ou dos pais."""
        if not email:
            return None
        condicao = func.lower(coluna) == email
        if outra is not None and dela:
            condicao = and_(condicao, or_(outra.is_(None), outra.in_(dela)))
        return condicao
    return {
        "pessoas": pessoas, "associados": associados, "beneficiarios": beneficiarios, "beneficiarios_projeto": vinculos, "usuarios": usuarios,
        "inscricoes": _ids(db, Inscricao.id_inscricao, em_pessoas(Inscricao.id_pessoa), so_email(Inscricao.email_da_inscricao, Inscricao.id_pessoa, pessoas)),
        "atendimentos": _ids(db, Atendimento.id_atendimento, em_pessoas(Atendimento.id_pessoa), so_email(Atendimento.email_contato, Atendimento.id_pessoa, pessoas),
                             so_cpf(Atendimento.cpf)),
        "intencoes_de_doacao": _ids(db, IntencaoDeDoacao.id_intencao, so_email(IntencaoDeDoacao.email_doador, IntencaoDeDoacao.documento_doador, {cpf} if cpf else None),
                                    so_cpf(IntencaoDeDoacao.documento_doador)),
        "propostas_filiacao": _ids(db, PropostaFiliacao.id_proposta, em_associados(PropostaFiliacao.id_associado_efetivado), so_cpf(PropostaFiliacao.cpf),
                                   so_email(PropostaFiliacao.email_contato, PropostaFiliacao.cpf, {cpf} if cpf else None)),
        "doacoes": _ids(db, Doacao.id_doacao, em_associados(Doacao.id_associado), so_cpf(Doacao.documento_doador)),
        "processos_disciplinares": _processos(db, associados),
        "termos_adesao_voluntario": _ids(db, TermoAdesaoVoluntario.id_termo, em_pessoas(TermoAdesaoVoluntario.id_pessoa)),
        "alocacoes_voluntarios": _ids(db, AlocacaoVoluntario.id_alocacao, em_pessoas(AlocacaoVoluntario.id_pessoa), em_associados(AlocacaoVoluntario.id_associado)),
        "avisos_destinatarios": _ids(db, AvisoDestinatario.id_destinatario, em_associados(AvisoDestinatario.id_associado),
                                     AvisoDestinatario.id_usuario.in_(usuarios) if usuarios else None),
        "fornecedores": _fornecedores(db, cpf),
    }, cpf, email


def _processos(db: Session, associados: set) -> set:
    from app.models.disciplina import ProcessoDisciplinar

    return {i for (i,) in db.query(ProcessoDisciplinar.id_processo).filter(ProcessoDisciplinar.id_associado.in_(associados))} if associados else set()


def _fornecedores(db: Session, cpf: str) -> set:
    """O fornecedor pessoa física é achado pelo CPF (gravado no campo do CNPJ, com ou sem pontuação)."""
    from app.models.financeiro import Fornecedor

    if not cpf:
        return set()
    return {f.id_fornecedor for f in db.query(Fornecedor.id_fornecedor, Fornecedor.cnpj) if _so_digitos(f.cnpj) == cpf}


def _atividades_por_tabela(db: Session) -> dict[str, list[dict]]:
    from app.services import inventario

    por_tabela: dict[str, list[dict]] = {}
    for a in inventario.listar(db)["atividades"]:
        resumo = {
            "codigo": a["codigo"], "nome": a["nome"], "finalidade": a["finalidade"], "bases_legais": a["bases_legais_texto"],
            "base_legal_conferida": bool(a.get("base_legal_conferida")),
            "compartilhado_com": [o["nome"] for o in a["operadores_detalhe"]], "transferencia_internacional": a["transferencia_internacional"],
            "prazos_de_guarda": [f"{p['rotulo']}: {p['dias']} dias" for p in a["prazos_de_guarda"]] + list(a["prazos_fixos"]),
        }
        for t in a["tabelas"]:
            por_tabela.setdefault(t, []).append(resumo)
    return por_tabela


def _valores_de_campo(db: Session, ancoras: dict) -> list[dict]:
    """Os campos personalizados (texto livre que a associação criou) do cadastro de associado, de beneficiário e de pessoa."""
    from app.models.core import DefinicaoCampo, ValorCampo

    linhas = []
    por_entidade = {"associado": ancoras["associados"], "beneficiario": ancoras["beneficiarios"], "pessoa": ancoras["pessoas"]}
    for valor, definicao in db.query(ValorCampo, DefinicaoCampo).join(DefinicaoCampo, DefinicaoCampo.id_definicao == ValorCampo.id_definicao):
        ids = por_entidade.get((definicao.entidade or "").strip().lower())
        if ids and valor.id_registro in ids:
            linhas.append({"numero": valor.id_valor, "campo": definicao.rotulo, "valor": valor.valor})
    return linhas


def montar(db: Session, *, id_pessoa: Optional[int] = None, cpf: Optional[str] = None, email: Optional[str] = None) -> dict:
    """O relatório: a pessoa (do cadastro, se houver) e, por tabela, a atividade e as linhas. Pelo menos um dos três para achar a pessoa."""
    from app.database import Base
    from app.models.pessoas import Pessoa

    if id_pessoa is None and not _so_digitos(cpf) and not (email or "").strip():
        raise HTTPException(status_code=400, detail="Diga de quem é o relatório: o número do cadastro, o CPF ou o e-mail.")
    ancoras, cpf_usado, email_usado = _ancoras(db, id_pessoa=id_pessoa, cpf=cpf, email=email)
    sensiveis = {linha["tabela"] for linha in cl.inventario_do_modelo() if linha["colunas_sensiveis"]}
    atividades = _atividades_por_tabela(db)
    secoes = []
    for nome, tabela in sorted(Base.metadata.tables.items()):
        chave = list(tabela.primary_key.columns)
        if nome in FORA_DO_RELATORIO or len(chave) != 1:
            continue
        [pk] = chave
        condicoes = [pk.in_(ancoras[nome])] if ancoras.get(nome) else []
        for coluna in tabela.columns:
            for fk in coluna.foreign_keys:
                alvo = fk.column.table.name
                if (nome, coluna.name) in LIGACOES_DE_OUTRA_NATUREZA or (alvo == "usuarios" and coluna.name != "id_usuario"):
                    continue
                if ancoras.get(alvo):
                    condicoes.append(coluna.in_(ancoras[alvo]))
        if not condicoes:
            continue
        colunas = [c for c in tabela.columns if c is not pk and not COLUNAS_SECRETAS.search(c.name)
                   and not any(fk.column.table.name in TABELAS_DE_PESSOA for fk in c.foreign_keys)]
        linhas = db.execute(select(pk, *colunas).where(or_(*condicoes)).order_by(pk.desc()).limit(LIMITE_DE_LINHAS_POR_TABELA + 1)).all()
        if not linhas:
            continue
        cortado = len(linhas) > LIMITE_DE_LINHAS_POR_TABELA
        linhas = linhas[:LIMITE_DE_LINHAS_POR_TABELA]
        nomes = _nomes_dos_numeros(db, colunas, linhas)
        secoes.append({
            "tabela": nome, "atividades": atividades.get(nome, []), "tem_dado_sensivel": nome in sensiveis, "cortado": cortado,
            "linhas": [{"numero": linha[0], **{c.name: nomes.get((c.name, v), _valor(v)) for c, v in zip(colunas, linha[1:]) if v is not None}}
                       for linha in linhas],
        })
    campos = _valores_de_campo(db, ancoras)
    if campos:
        secoes.append({"tabela": "valores_campo", "atividades": atividades.get("valores_campo", []), "tem_dado_sensivel": False, "cortado": False,
                       "linhas": campos})
    pessoa = db.get(Pessoa, min(ancoras["pessoas"])) if ancoras["pessoas"] else None
    dados_da_pessoa = {"id_pessoa": pessoa.id_pessoa, "nome_completo": pessoa.nome_completo, "cpf": pessoa.cpf} if pessoa else None
    return {
        "gerado_em": datetime.utcnow().isoformat(),
        "pessoa": dados_da_pessoa,
        "procurado_por": {"cadastro": id_pessoa is not None, "cpf": bool(cpf_usado), "email": bool(email_usado)},
        # v7.2c: a impressão do conteúdo (sem a hora): a liberação ao titular só aceita o relatório igual ao que o encarregado conferiu
        "impressao": impressao(dados_da_pessoa, secoes),
        "secoes": secoes,
        "total_de_linhas": sum(len(s["linhas"]) for s in secoes),
        "algum_corte": any(s["cortado"] for s in secoes),
        "fora_do_relatorio": NAO_LOCALIZAVEL,
    }


def impressao(pessoa: Optional[dict], secoes: list) -> str:
    import hashlib
    import json

    texto = json.dumps({"pessoa": pessoa, "secoes": secoes}, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def _nomes_dos_numeros(db: Session, colunas, linhas) -> dict:
    """(coluna, número) -> "o nome (nº)" para as chaves que apontam para algo com nome (o evento, o projeto, a campanha), nunca para outra pessoa."""
    from app.database import Base

    nomes = {}
    for i, c in enumerate(colunas, start=1):
        fks = [fk for fk in c.foreign_keys if fk.column.table.name not in TABELAS_DE_PESSOA]
        if not fks:
            continue
        destino = Base.metadata.tables[fks[0].column.table.name]
        coluna_de_nome = next((destino.c[n] for n in COLUNAS_DE_NOME if n in destino.c), None)
        valores = {linha[i] for linha in linhas if linha[i] is not None}
        if coluna_de_nome is None or not valores:
            continue
        for numero, rotulo in db.execute(select(fks[0].column, coluna_de_nome).where(fks[0].column.in_(valores))):
            nomes[(c.name, numero)] = f"{rotulo} (nº {numero})"
    return nomes


def buscar_pessoas(db: Session, busca: str) -> list[dict]:
    """Para o encarregado achar de quem é o relatório: pelo nome, pelo CPF ou pelo e-mail do cadastro (até 20)."""
    from app.models.associados import Associado
    from app.models.beneficiarios import Beneficiario
    from app.models.pessoas import Pessoa
    from app.services.cpf_protegido import mascarar

    texto = " ".join((busca or "").split())
    if len(texto) < 3:
        raise HTTPException(status_code=400, detail="Digite pelo menos 3 letras ou números para buscar.")
    condicoes = [Pessoa.nome_completo.ilike(f"%{texto}%"), func.lower(Pessoa.email_contato) == texto.lower()]
    digitos = _so_digitos(texto)
    # só procura pelo CPF quando o texto é um número (um e-mail com números não vira busca de CPF)
    # v7.3f: o CPF só pelo número inteiro, como em todo o sistema
    if "@" not in texto and len(digitos) == 11 and re.fullmatch(r"[\d\s.\-]+", texto):
        condicoes.append(Pessoa.cpf == digitos)
    pessoas = db.query(Pessoa).filter(or_(*condicoes)).order_by(Pessoa.nome_completo).limit(20).all()
    ids = [p.id_pessoa for p in pessoas]
    associados = {i for (i,) in db.query(Associado.id_pessoa).filter(Associado.id_pessoa.in_(ids))} if ids else set()
    beneficiarios = {i for (i,) in db.query(Beneficiario.id_pessoa).filter(Beneficiario.id_pessoa.in_(ids))} if ids else set()
    return [{
        "id_pessoa": p.id_pessoa, "nome_completo": p.nome_completo,
        "cpf_mascarado": mascarar(p.cpf),  # v7.3a: o formato único
        "associado": p.id_pessoa in associados, "beneficiario": p.id_pessoa in beneficiarios,
    } for p in pessoas]
