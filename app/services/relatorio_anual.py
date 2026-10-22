"""v6.3c (FASE 6) - o relatório anual de atividades, montado pelo sistema a partir do próprio dado (nunca digitado duas vezes).

Decisão do Presidente (2026-10-22): o sistema monta os números do ano, a secretaria (permissão Documentos) escreve a APRESENTAÇÃO e o Presidente ou o
Secretário (outra pessoa) aprova a publicação. O que este módulo garante:
  - só de ano ENCERRADO (o ano civil em Belém já acabou) e em que o sistema JÁ ERA USADO (o primeiro registro da Auditoria): um ano anterior ao sistema
    sairia com zeros que não correspondem à realidade; no ano em que o sistema começou, o texto diz a partir de quando os números contam;
  - os números são contagens e somas, sem nome de pessoa: projetos PÚBLICOS do ano (nome e situação de hoje; o projeto interno não aparece nem na
    contagem; suspenso não conta como em andamento), eventos PÚBLICOS realizados no ano (marcados como realizados ou com presença registrada), com
    inscrições confirmadas e presenças (pessoas distintas, somando as sessões), beneficiários ATENDIDOS no ano e atendimentos, horas de voluntariado
    aprovadas e quantos voluntários, associados com vínculo em 31/12, o último valor do ano dos indicadores ATIVOS dos projetos públicos e, se já
    publicadas, as contas do exercício (v6.3b). Toda contagem de pessoas abaixo de 5 vira "menos de 5" (ninguém reconhecido pelo número);
  - vira um documento da biblioteca (tipo Relatório anual, Público, versão pública em TEXTO) com os números em JSON (`dados_publicos_json`), como as
    contas: o texto é o gerado; a única parte escrita é a apresentação, guardada no próprio JSON e conferida pelo mesmo verificador de dado pessoal;
  - sem a apresentação o relatório não vai para revisão; quem a escreveu não aprova (nem quem criou ou enviou); refazer depois de publicado abre uma
    versão nova (a publicada continua no ar até a nova ser aprovada), levando a apresentação da anterior para ser revista."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.beneficiarios import BeneficiarioProjeto, RegistroAtendimento
from app.models.core import AuditLog
from app.models.documentos import APROVADO, EM_REVISAO, PUBLICA, RASCUNHO, RELATORIO_ANUAL, DocumentoInstitucional
from app.models.eventos import STATUS_EVENTO_ADIADO, STATUS_EVENTO_CANCELADO, STATUS_EVENTO_REALIZADO, Evento, SessaoEvento
from app.models.motores import AUSENTE, CONFIRMADO, PRESENTE, Indicador, Inscricao, MedicaoIndicador, RegistroPresenca
from app.models.projetos import ProjetoEvento
from app.models.voluntariado import RegistroHorasVoluntariado, TermoAdesaoVoluntario
from app.services import contas_publicas, documentos_institucionais
from app.services.formato import reais
from app.services.fuso import para_belem
from app.services.projetos import CONTEXTO_PROJETO
from app.services.publico_contexto import dia_de_belem

TIPO = RELATORIO_ANUAL
PUBLICA_VIS = "Pública"
MINIMO_PUBLICAVEL = 5  # contagem de pessoas abaixo disto vira "menos de 5"
TAMANHO_MINIMO_DA_APRESENTACAO = 40
TAMANHO_MAXIMO_DA_APRESENTACAO = 6000
ACAO_APRESENTACAO = "APRESENTACAO_ESCRITA"
# situação de HOJE (o sistema não guarda a de cada ano); suspenso não entra (não esteve em andamento)
SITUACOES_DO_PROJETO = {"EM_EXECUCAO": "Em execução", "CONCLUIDO": "Concluído", "CANCELADO": "Cancelado"}
# o período da medição: "2025", "2025-06" (ou "2025-6"), "2025-T2" (trimestre), "2025-S1" (semestre); outro formato não entra
_PERIODO = re.compile(r"^(\d{4})(?:-(?:(\d{1,2})|T([1-4])|S([12])))?$")


def _ano_de_hoje_em_belem() -> int:
    return para_belem(datetime.utcnow()).year


def _instantes_do_ano(ano: int) -> tuple[datetime, datetime]:
    """O ano civil de Belém em UTC (como o banco guarda os instantes): de 01/01 00:00 a 31/12 23:59:59 de Belém = 03:00 UTC a 03:00 UTC."""
    return datetime(ano, 1, 1, 3, 0), datetime(ano + 1, 1, 1, 3, 0)


def _protegido(n: int) -> int | str:
    return n if n == 0 or n >= MINIMO_PUBLICAVEL else f"menos de {MINIMO_PUBLICAVEL}"


def inicio_dos_registros(db: Session) -> Optional[datetime]:
    """Quando o sistema começou a ser usado: o primeiro registro da Auditoria (todo cadastro, login e lançamento passa por ela)."""
    return db.query(func.min(AuditLog.timestamp)).scalar()


def primeiro_ano(db: Session) -> Optional[int]:
    inicio = inicio_dos_registros(db)
    return para_belem(inicio).year if inicio else None


def exigir_ano_permitido(db: Session, ano: int) -> None:
    if not 2000 <= ano < _ano_de_hoje_em_belem():
        raise HTTPException(status_code=409, detail=f"O relatório anual é de ano encerrado: o de {ano} só pode ser montado a partir de 1º de janeiro de {ano + 1}.")
    primeiro = primeiro_ano(db)
    if primeiro is None or ano < primeiro:
        desde = dia_de_belem(inicio_dos_registros(db))
        raise HTTPException(
            status_code=409,
            detail=f"O sistema da ASAF só tem registros desde {_data(desde) if desde else 'agora'}: um relatório de {ano} sairia com zeros que não "
                   "correspondem à realidade.",
        )


def _projetos(db: Session, ano: int) -> list[dict]:
    """Projetos PÚBLICOS do ano: em execução que começaram até 31/12 (o fim PREVISTO não tira um projeto atrasado que continua); concluídos e cancelados
    que começaram até 31/12 e cujo fim previsto não é anterior ao ano (sem fim previsto, ficam de fora: apareceriam em todos os anos seguintes). O sistema
    não guarda a data real do fim: um projeto concluído com atraso ou antes do previsto pode cair num ano vizinho (limite registrado no plano)."""
    inicio_seguinte, inicio_do_ano = datetime(ano + 1, 1, 1), datetime(ano, 1, 1)
    projetos = (
        db.query(ProjetoEvento)
        .filter(
            ProjetoEvento.visibilidade == PUBLICA_VIS, ProjetoEvento.status.in_(SITUACOES_DO_PROJETO),
            ProjetoEvento.data_inicio < inicio_seguinte,
            or_(ProjetoEvento.status == "EM_EXECUCAO", ProjetoEvento.data_fim_prevista >= inicio_do_ano),
        )
        .order_by(ProjetoEvento.nome_projeto)
        .all()
    )
    return [{"nome": p.nome_projeto, "situacao": SITUACOES_DO_PROJETO[p.status], "id_projeto": p.id_projeto} for p in projetos]


def _pessoas(db: Session, modelo, evento: Evento, sessoes: list[int], *filtros) -> set[int]:
    contexto = or_(
        (modelo.contexto_tipo == "Evento") & (modelo.id_contexto == evento.id_evento),
        (modelo.contexto_tipo == "SessaoEvento") & (modelo.id_contexto.in_(sessoes or [-1])),
    )
    return {p for (p,) in db.query(modelo.id_pessoa).filter(contexto, *filtros).distinct().all()}


def _eventos(db: Session, ano: int) -> tuple[list[dict], dict]:
    """Eventos PÚBLICOS do ano (em Belém) que de fato aconteceram: marcados como realizados ou com presença registrada (um evento "Programado" que
    passou sem ninguém não conta); nem cancelados nem adiados. Inscrições confirmadas e presenças são pessoas distintas, somando as sessões; a
    presença vale pela leitura na entrada ou pela marcação "Presente" na inscrição."""
    inicio, fim = _instantes_do_ano(ano)
    eventos = (
        db.query(Evento)
        .filter(
            Evento.visibilidade == PUBLICA_VIS, Evento.status.notin_((STATUS_EVENTO_CANCELADO, STATUS_EVENTO_ADIADO)),
            Evento.data_hora_inicio >= inicio, Evento.data_hora_inicio < fim, Evento.data_hora_inicio <= datetime.utcnow(),
        )
        .order_by(Evento.data_hora_inicio, Evento.id_evento)
        .all()
    )
    linhas, total_inscritos, total_presentes = [], 0, 0
    for e in eventos:
        sessoes = [s for (s,) in db.query(SessaoEvento.id_sessao).filter(SessaoEvento.id_evento == e.id_evento).all()]
        presentes = _pessoas(db, RegistroPresenca, e, sessoes) | _pessoas(db, Inscricao, e, sessoes, Inscricao.status == PRESENTE)
        if e.status != STATUS_EVENTO_REALIZADO and not presentes:
            continue
        inscritos = _pessoas(db, Inscricao, e, sessoes, Inscricao.status.in_((CONFIRMADO, PRESENTE, AUSENTE)))
        total_inscritos += len(inscritos)
        total_presentes += len(presentes)
        linhas.append({
            "titulo": e.titulo, "data": para_belem(e.data_hora_inicio).date().isoformat(),
            "inscritos": _protegido(len(inscritos)), "presentes": _protegido(len(presentes)),
        })
    return linhas, {"inscritos": _protegido(total_inscritos), "presentes": _protegido(total_presentes)}


def _beneficiarios(db: Session, ano: int) -> dict:
    """Só os totais do ano (todos os projetos): quem foi ATENDIDO no ano (pessoas distintas com atendimento registrado) e quantos atendimentos.
    Abaixo de 5, "menos de 5"."""
    inicio, fim = _instantes_do_ano(ano)
    no_ano = (RegistroAtendimento.data_atendimento >= inicio, RegistroAtendimento.data_atendimento < fim)
    atendidos = (
        db.query(func.count(func.distinct(BeneficiarioProjeto.id_beneficiario)))
        .join(RegistroAtendimento, RegistroAtendimento.id_vinculo == BeneficiarioProjeto.id_vinculo)
        .filter(*no_ano)
        .scalar() or 0
    )
    atendimentos = db.query(func.count(RegistroAtendimento.id_registro)).filter(*no_ano).scalar() or 0
    return {"pessoas": _protegido(atendidos), "atendimentos": _protegido(atendimentos)}


def _voluntariado(db: Session, ano: int) -> dict:
    """Horas APROVADAS com data no ano (o campo é só de data: sem fuso) e quantos voluntários as fizeram."""
    filtro = (
        RegistroHorasVoluntariado.status == "APROVADO",
        RegistroHorasVoluntariado.data >= datetime(ano, 1, 1), RegistroHorasVoluntariado.data < datetime(ano + 1, 1, 1),
    )
    horas = db.query(func.coalesce(func.sum(RegistroHorasVoluntariado.horas), 0)).filter(*filtro).scalar() or 0
    voluntarios = (
        db.query(func.count(func.distinct(TermoAdesaoVoluntario.id_pessoa)))
        .join(RegistroHorasVoluntariado, RegistroHorasVoluntariado.id_termo == TermoAdesaoVoluntario.id_termo)
        .filter(*filtro)
        .scalar() or 0
    )
    return {"horas": str(Decimal(str(horas)).quantize(Decimal("0.1"))), "voluntarios": _protegido(voluntarios)}


def _associados_no_fim_do_ano(db: Session, ano: int) -> int | str:
    """Admitidos até 31/12 (instante, em Belém) e não desligados até 31/12 (o desligamento é uma DATA: o de 01/01 ainda tinha vínculo em 31/12)."""
    _inicio, fim = _instantes_do_ano(ano)
    total = (
        db.query(func.count(Associado.id_associado))
        .filter(Associado.data_admissao < fim, or_(Associado.data_desligamento.is_(None), Associado.data_desligamento >= datetime(ano + 1, 1, 1)))
        .scalar() or 0
    )
    return _protegido(total)


def _ordem_do_periodo(periodo: str, ano: int) -> Optional[tuple]:
    """A posição do período dentro do ano (para achar o ÚLTIMO): mês 1–12, trimestre = mês final, semestre = mês final, o ano inteiro = depois de
    todos. Período de outro ano ou fora do formato: None (não entra)."""
    m = _PERIODO.match((periodo or "").strip())
    if not m or int(m.group(1)) != ano:
        return None
    mes, trimestre, semestre = m.group(2), m.group(3), m.group(4)
    if mes is not None:
        return (int(mes), 3) if 1 <= int(mes) <= 12 else None
    if trimestre is not None:
        return (int(trimestre) * 3, 2)
    if semestre is not None:
        return (int(semestre) * 6, 1)
    return (13, 0)


def _indicadores(db: Session, ano: int, projetos: list[dict]) -> list[dict]:
    """O ÚLTIMO período do ano de cada indicador ATIVO dos projetos públicos do relatório."""
    nomes = {p["id_projeto"]: p["nome"] for p in projetos}
    if not nomes:
        return []
    linhas = []
    indicadores = (
        db.query(Indicador)
        .filter(Indicador.contexto_tipo == CONTEXTO_PROJETO, Indicador.id_contexto.in_(nomes), Indicador.ativo.is_(True))
        .order_by(Indicador.id_contexto, Indicador.nome)
        .all()
    )
    for i in indicadores:
        medicoes = db.query(MedicaoIndicador).filter(MedicaoIndicador.id_indicador == i.id_indicador, MedicaoIndicador.periodo.like(f"{ano}%")).all()
        do_ano = [(ordem, m) for m in medicoes if (ordem := _ordem_do_periodo(m.periodo, ano)) is not None]
        if not do_ano:
            continue
        ultima = max(do_ano, key=lambda par: (par[0], par[1].id_medicao))[1]  # empate: a medição mais nova
        linhas.append({
            "projeto": nomes[i.id_contexto], "indicador": i.nome, "periodo": ultima.periodo, "valor": str(ultima.valor), "unidade": i.unidade,
            "meta": str(i.meta) if i.meta is not None else None,
        })
    return linhas


def _contas(db: Session, ano: int) -> Optional[dict]:
    """As contas do exercício, SE já publicadas (v6.3b): os mesmos números aprovados; senão, nada (o texto diz que vão depois da Assembleia)."""
    publicado = next(
        (d for d in contas_publicas.documentos_das_contas(db, ano) if d.situacao == APROVADO and d.vigente),
        None,
    )
    if publicado is None:
        return None
    dados = json.loads(publicado.dados_publicos_json)
    return {
        "id_documento": publicado.id_documento, "titulo": publicado.titulo, "total_receitas": dados["total_receitas"],
        "total_despesas": dados["total_despesas"], "resultado": dados["resultado"], "aprovadas_em_assembleia_em": dados["aprovadas_em_assembleia_em"],
    }


def montar(db: Session, ano: int, apresentacao: str = "") -> dict:
    projetos = _projetos(db, ano)
    eventos, totais = _eventos(db, ano)
    inicio = inicio_dos_registros(db)
    return {
        "ano": ano,
        "apresentacao": apresentacao,
        # no ano em que o sistema começou a ser usado, os números contam só a partir daí (o texto e o site dizem isso)
        "registros_desde": dia_de_belem(inicio) if inicio and para_belem(inicio).year == ano else None,
        "projetos": [{"nome": p["nome"], "situacao": p["situacao"]} for p in projetos],
        "eventos": eventos,
        "eventos_totais": totais,
        "beneficiarios": _beneficiarios(db, ano),
        "voluntariado": _voluntariado(db, ano),
        "associados_no_fim_do_ano": _associados_no_fim_do_ano(db, ano),
        "indicadores": _indicadores(db, ano, projetos),
        "contas": _contas(db, ano),
    }


def _data(iso: Optional[str]) -> str:
    return "/".join(reversed(iso.split("-"))) if iso else ""


def _numero(valor) -> str:
    """"12.0" -> "12"; "12.5" -> "12,5" (o jeito brasileiro); "menos de 5" fica como está."""
    try:
        d = Decimal(str(valor)).normalize()
    except ArithmeticError:
        return str(valor)
    return f"{d:f}".replace(".", ",")


def texto(dados: dict) -> str:
    """O texto publicado (a página do documento no site): a apresentação e os mesmos números da página do relatório, em linhas."""
    ano = dados["ano"]
    linhas = [f"Relatório anual de atividades {ano}", "", "Apresentação da diretoria", dados["apresentacao"].strip() or "(a apresentação ainda não foi escrita)", ""]
    linhas += [f"Os números de {ano}, montados pelo sistema da ASAF a partir dos próprios registros (sem nome de ninguém; contagem de pessoas abaixo de "
               f"{MINIMO_PUBLICAVEL} aparece como \"menos de {MINIMO_PUBLICAVEL}\"):"]
    if dados.get("registros_desde"):
        linhas += [f"O sistema começou a ser usado em {_data(dados['registros_desde'])}: os números de {ano} contam a partir dessa data."]
    linhas += ["", f"Projetos do ano (com a situação de hoje): {len(dados['projetos'])}"]
    linhas += [f"  {p['nome']} ({p['situacao']})" for p in dados["projetos"]]
    eventos, totais = dados["eventos"], dados["eventos_totais"]
    linhas += ["", f"Eventos abertos ao público realizados no ano: {len(eventos)}, com {_numero(totais['inscritos'])} inscrições confirmadas e "
                   f"{_numero(totais['presentes'])} presenças"]
    linhas += [f"  {_data(e['data'])} {e['titulo']}: {_numero(e['inscritos'])} inscritos, {_numero(e['presentes'])} presentes" for e in eventos]
    b, v = dados["beneficiarios"], dados["voluntariado"]
    linhas += [
        "",
        f"Beneficiários atendidos nos projetos: {_numero(b['pessoas'])} (atendimentos registrados: {_numero(b['atendimentos'])})",
        f"Voluntariado: {_numero(v['horas'])} horas, de {_numero(v['voluntarios'])} voluntário(s)",
        f"Associados com vínculo em 31/12/{ano}: {_numero(dados['associados_no_fim_do_ano'])}",
    ]
    if dados["indicadores"]:
        linhas += ["", "Indicadores dos projetos (o último valor do ano)"]
        linhas += [
            f"  {i['projeto']} - {i['indicador']}: {_numero(i['valor'])} {i['unidade']} ({i['periodo']})" + (f", meta {_numero(i['meta'])}" if i["meta"] else "")
            for i in dados["indicadores"]
        ]
    c = dados["contas"]
    linhas += [""]
    if c:
        linhas += [
            f"Contas do exercício (aprovadas pela Assembleia Geral em {_data(c['aprovadas_em_assembleia_em'])}): receitas {reais(Decimal(c['total_receitas']))}, "
            f"despesas {reais(Decimal(c['total_despesas']))}, resultado {reais(Decimal(c['resultado']))}. O detalhe está em \"{c['titulo']}\"."
        ]
    else:
        linhas += ["Contas do exercício: ainda não publicadas (vão ao site depois de aprovadas pela Assembleia Geral)."]
    return "\n".join(linhas)


def documentos_do_relatorio(db: Session, ano: int) -> list[DocumentoInstitucional]:
    return (
        db.query(DocumentoInstitucional)
        .filter(DocumentoInstitucional.tipo == TIPO, DocumentoInstitucional.ano == ano, DocumentoInstitucional.dados_publicos_json.isnot(None))
        .order_by(DocumentoInstitucional.id_documento.desc())
        .all()
    )


def situacao_no_site(db: Session, ano: int) -> dict:
    documentos = documentos_do_relatorio(db, ano)
    atual = next((d for d in documentos if d.situacao in (RASCUNHO, EM_REVISAO)), None) or next((d for d in documentos if d.situacao == APROVADO), None)
    return {
        "ano": ano,
        "ano_encerrado": 2000 <= ano < _ano_de_hoje_em_belem(),
        "primeiro_ano": primeiro_ano(db),
        "registros_desde": dia_de_belem(inicio_dos_registros(db)),
        "documento": {"id_documento": atual.id_documento, "situacao": atual.situacao, "versao": atual.versao} if atual else None,
    }


def _apresentacao_de(doc: Optional[DocumentoInstitucional]) -> str:
    return json.loads(doc.dados_publicos_json).get("apresentacao", "") if doc is not None and doc.dados_publicos_json else ""


def apresentacao_do_documento(doc: DocumentoInstitucional) -> Optional[str]:
    """A apresentação gravada num relatório anual gerado (para o painel mostrar e editar); None em qualquer outro documento."""
    return _apresentacao_de(doc) if doc.tipo == TIPO and doc.dados_publicos_json else None


def exigir_apresentacao(doc: DocumentoInstitucional) -> None:
    """Na revisão e na aprovação: o relatório só vai a público com a apresentação escrita pela secretaria (decisão do Presidente)."""
    if doc.tipo == TIPO and doc.dados_publicos_json and len(_apresentacao_de(doc).strip()) < TAMANHO_MINIMO_DA_APRESENTACAO:
        raise HTTPException(
            status_code=409,
            detail=f"Escreva a apresentação da diretoria (pelo menos {TAMANHO_MINIMO_DA_APRESENTACAO} caracteres) antes de enviar o relatório anual para revisão.",
        )


def escreveu_a_apresentacao(db: Session, usuario, doc: DocumentoInstitucional) -> bool:
    """Quem escreveu a apresentação DESTA versão (está na Auditoria) não aprova a publicação: a aprovação é de outra pessoa. Vale também quando a versão
    nova traz o MESMO texto que a pessoa escreveu numa versão anterior (a apresentação é levada para ser revista; Ponto FASE 6 2/2)."""
    if doc.tipo != TIPO or not doc.dados_publicos_json:
        return False
    escritas = db.query(AuditLog.id_registro_afetado, AuditLog.dados_depois).filter(
        AuditLog.tabela_afetada == "documentos_institucionais", AuditLog.acao == ACAO_APRESENTACAO, AuditLog.id_usuario == usuario.id_usuario,
    ).all()
    if any(id_registro == doc.id_documento for id_registro, _ in escritas):
        return True
    apresentacao = _apresentacao_de(doc).strip()
    if not apresentacao:
        return False
    sha = hashlib.sha256(apresentacao.encode("utf-8")).hexdigest()
    da_mesma_familia = {
        d for (d,) in db.query(DocumentoInstitucional.id_documento).filter(DocumentoInstitucional.grupo_versao == doc.grupo_versao).all()
    }
    for id_registro, depois in escritas:
        if id_registro in da_mesma_familia:
            try:
                if json.loads(depois or "{}").get("sha256") == sha:
                    return True
            except ValueError:
                continue
    return False


def preparar(db: Session, usuario, ano: int) -> tuple[DocumentoInstitucional, str]:
    """Monta (ou remonta, no rascunho, mantendo a apresentação) o relatório do ano. Devolve (documento, ação para a auditoria)."""
    exigir_ano_permitido(db, ano)
    documentos = documentos_do_relatorio(db, ano)
    em_revisao = next((d for d in documentos if d.situacao == EM_REVISAO), None)
    if em_revisao is not None:
        return em_revisao, "JA_EM_REVISAO"
    rascunho = next((d for d in documentos if d.situacao == RASCUNHO), None)
    publicado = next((d for d in documentos if d.situacao == APROVADO), None)
    # a apresentação continua a do rascunho (ou, numa versão nova, a da publicada, para ser revista)
    dados = montar(db, ano, _apresentacao_de(rascunho or publicado))
    corpo = texto(dados)
    documentos_institucionais.conferir_texto_gerado(corpo)  # ANTES de criar: uma recusa não deixa rascunho órfão
    acao = "NUMEROS_ATUALIZADOS"
    if rascunho is None:
        if publicado is not None:
            rascunho, acao = documentos_institucionais.nova_versao(db, usuario, publicado, gerado=True), "NOVA_VERSAO"
        else:
            rascunho = documentos_institucionais.criar_documento(db, usuario, {
                "tipo": TIPO, "titulo": f"Relatório anual de atividades {ano}", "classificacao": PUBLICA, "publicar_no_site": True,
                "descricao": "O ano da ASAF em números (projetos, eventos, beneficiários, voluntariado, indicadores e contas), montados pelo sistema, "
                             "com a apresentação da diretoria.",
                "data_documento": date(ano, 12, 31), "ano": ano,
            })
            acao = "CRIADO"
    documentos_institucionais.gravar_texto_gerado(db, rascunho, corpo, dados)
    return rascunho, acao


def conferir_apresentacao(db: Session, ano: int, apresentacao: str) -> tuple[DocumentoInstitucional, dict, str, str]:
    """A única parte escrita: a apresentação, no RASCUNHO. Confere tudo ANTES de gravar (tamanho, dado pessoal na própria apresentação: 422 com o achado
    mascarado) e devolve (rascunho, dados, texto remontado com os números já preparados, SHA-256 da apresentação). Quem chama grava a Auditoria (quem
    escreveu, e por isso não aprova esta versão) e só DEPOIS o texto (`gravar_texto_gerado`): se a Auditoria falhar, nada é gravado."""
    limpa = (apresentacao or "").strip()
    if len(limpa) < TAMANHO_MINIMO_DA_APRESENTACAO:
        raise HTTPException(status_code=400, detail=f"A apresentação é curta demais (pelo menos {TAMANHO_MINIMO_DA_APRESENTACAO} caracteres).")
    if len(limpa) > TAMANHO_MAXIMO_DA_APRESENTACAO:
        raise HTTPException(status_code=400, detail=f"A apresentação passa de {TAMANHO_MAXIMO_DA_APRESENTACAO:,} caracteres.".replace(",", "."))
    rascunho = next((d for d in documentos_do_relatorio(db, ano) if d.situacao == RASCUNHO), None)
    if rascunho is None:
        raise HTTPException(status_code=409, detail=f"Não há relatório de {ano} em rascunho: prepare o relatório (ou abra uma versão nova) antes de escrever a apresentação.")
    resultado = documentos_institucionais.verificar_texto_publico(limpa)
    if not resultado.ok:
        raise HTTPException(
            status_code=422,
            detail={"mensagem": "A apresentação tem dado pessoal: retire-o (o achado está abaixo, mascarado) e salve de novo.",
                    "resultado": resultado.como_dicionario()},
        )
    dados = {**json.loads(rascunho.dados_publicos_json), "apresentacao": limpa}
    corpo = texto(dados)
    documentos_institucionais.conferir_texto_gerado(corpo)
    return rascunho, dados, corpo, hashlib.sha256(limpa.encode("utf-8")).hexdigest()
