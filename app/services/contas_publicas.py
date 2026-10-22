"""v6.3b (FASE 6) - as contas do exercício no site, geradas do próprio dado (nunca digitadas duas vezes).

Decisão do Presidente (2026-10-22): as contas do ano só vão ao site DEPOIS de a Assembleia aprovar e de o Presidente ou o Secretário confirmar a
publicação. O que este módulo garante:
  - só se prepara (e só se envia para revisão e se aprova) a publicação de um exercício que tem a deliberação de APROVAÇÃO DE CONTAS daquele ano numa
    ata ASSINADA (e não revogada) de assembleia REALIZADA DEPOIS do fim do exercício (contas de ano encerrado; um ano parcial nunca vai a público); a
    deliberação, por sua vez, já exige o parecer do Conselho Fiscal do ano (v2.6);
  - o resumo é montado dos lançamentos (receitas e despesas por conta, totais e resultado do exercício) REGISTRADOS ATÉ A DATA DA ASSEMBLEIA: o que
    vai a público é o que a Assembleia aprovou, não o razão de hoje (um lançamento de competência retroativa registrado depois não entra; o painel
    avisa quantos há); com o parecer de cada conselheiro do ano (o último de cada um até a deliberação) e a data da
    Assembleia; sem nome de associado nem de conselheiro (nada de inadimplência nem de quem pagou o quê);
  - vira um documento da biblioteca (tipo Balanço, Público, versão pública em TEXTO) com os números em JSON (`dados_publicos_json`) para o site
    montar as tabelas; o texto é o gerado: ninguém o digita nem o troca por um arquivo; passa pelo mesmo verificador de dado pessoal;
  - a publicação segue o fluxo de sempre: revisão e aprovação por OUTRA pessoa (Presidente ou Secretário); refazer depois de publicado abre uma
    versão nova (a publicada continua no ar até a nova ser aprovada)."""
from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.ata import APROVACAO_CONTAS, ASSINADA, REVOGADA, Ata, Deliberacao
from app.models.conselho_fiscal import ParecerPrestacaoContas
from app.models.documentos import APROVADO, EM_REVISAO, PUBLICA, RASCUNHO, DocumentoInstitucional
from app.models.financeiro import LancamentoContabil
from app.models.governanca import REALIZADA, Assembleia
from app.services import documentos_institucionais
from app.services.formato import reais
from app.services.publico_contexto import dia_de_belem
from app.services.relatorios import receitas_e_despesas_por_conta

TIPO = "BALANCO"


def _centavos(valor) -> str:
    return str(Decimal(valor).quantize(Decimal("0.01")))


def aprovacao_das_contas(db: Session, ano: int) -> Optional[tuple[Deliberacao, Ata, Assembleia]]:
    """A deliberação de aprovação das contas do ano, numa ata assinada de assembleia realizada e não revogada (a mais recente), ou nada."""
    linha = (
        db.query(Deliberacao, Ata, Assembleia)
        .join(Ata, Ata.id_ata == Deliberacao.id_ata)
        .join(Assembleia, Assembleia.id_assembleia == Ata.id_assembleia)
        .filter(
            Deliberacao.tipo == APROVACAO_CONTAS, Deliberacao.ano_exercicio == ano, Deliberacao.status_execucao != REVOGADA,
            Ata.status == ASSINADA, Assembleia.status == REALIZADA,
            # a Assembleia de um exercício encerrado: no dia 1º de janeiro seguinte ou depois, no relógio de Belém (00:00 de Belém = 03:00 UTC)
            Assembleia.data_hora_convocacao >= datetime(ano + 1, 1, 1, 3, 0),
        )
        # a mais recente pela data da Assembleia (uma deliberação registrada tarde numa ata antiga não recua o corte)
        .order_by(Assembleia.data_hora_convocacao.desc(), Deliberacao.id_deliberacao.desc())
        .first()
    )
    return tuple(linha) if linha is not None else None


def dia_da_assembleia(assembleia: Assembleia) -> str:
    """O dia da Assembleia em Belém (o instante é gravado em UTC, como todo o sistema) - não o do clique em "Assinar" a ata."""
    return dia_de_belem(assembleia.data_hora_convocacao)


def corte_da_assembleia(assembleia: Assembleia) -> datetime:
    """O instante da Assembleia, em UTC, como os lançamentos: o que foi registrado até ele é o que ela aprovou."""
    return assembleia.data_hora_convocacao


def _fim_do_ano(ano: int) -> datetime:
    return datetime(ano, 12, 31, 23, 59, 59, 999999)


def lancamentos_registrados_depois(db: Session, ano: int, assembleia: Assembleia) -> int:
    """Quantos lançamentos do exercício foram registrados depois da Assembleia (não entram no que vai a público)."""
    referencia = func.coalesce(LancamentoContabil.data_competencia, LancamentoContabil.data_lancamento)
    return (
        db.query(LancamentoContabil)
        .filter(
            LancamentoContabil.registrado_em > corte_da_assembleia(assembleia),
            referencia >= datetime(ano, 1, 1), referencia <= _fim_do_ano(ano),
        )
        .count()
    )


def montar(db: Session, ano: int, deliberacao: Deliberacao, assembleia: Assembleia) -> dict:
    """Os números do exercício (o mesmo recorte da prestação de contas interna, v3.6) como estavam na Assembleia, sem nome de pessoa."""
    linhas = receitas_e_despesas_por_conta(
        db, data_inicio=datetime(ano, 1, 1), data_fim=_fim_do_ano(ano), registrados_ate=corte_da_assembleia(assembleia),
    )
    receitas = sorted((l for l in linhas if l["tipo"] == "Receita"), key=lambda l: l["codigo_contabil"])
    despesas = sorted((l for l in linhas if l["tipo"] == "Despesa"), key=lambda l: l["codigo_contabil"])
    total_receitas = sum((Decimal(l["valor_periodo"]) for l in receitas), Decimal("0"))
    total_despesas = sum((Decimal(l["valor_periodo"]) for l in despesas), Decimal("0"))
    pareceres = db.query(ParecerPrestacaoContas).filter(ParecerPrestacaoContas.ano_exercicio == ano)
    if deliberacao.criado_em is not None:
        pareceres = pareceres.filter(ParecerPrestacaoContas.criado_em <= deliberacao.criado_em)
    # o último parecer de cada conselheiro (quem corrige o seu emite outro: só o mais recente vale)
    por_conselheiro: dict = {}
    for p in pareceres.order_by(ParecerPrestacaoContas.criado_em, ParecerPrestacaoContas.id_parecer).all():
        por_conselheiro.pop(p.id_associado_conselheiro, None)
        por_conselheiro[p.id_associado_conselheiro] = p
    pareceres = list(por_conselheiro.values())
    return {
        "ano": ano,
        "receitas": [{"codigo": l["codigo_contabil"], "conta": l["descricao_conta"], "valor": _centavos(l["valor_periodo"])} for l in receitas],
        "despesas": [{"codigo": l["codigo_contabil"], "conta": l["descricao_conta"], "valor": _centavos(l["valor_periodo"])} for l in despesas],
        "total_receitas": _centavos(total_receitas),
        "total_despesas": _centavos(total_despesas),
        "resultado": _centavos(total_receitas - total_despesas),
        "pareceres": [{"tipo": p.tipo, "texto": p.texto, "data": dia_de_belem(p.criado_em)} for p in pareceres],
        "aprovadas_em_assembleia_em": dia_da_assembleia(assembleia),
    }


def texto(dados: dict) -> str:
    """O texto publicado (a página do documento no site): o mesmo conteúdo das tabelas, em linhas."""
    linhas = [
        f"Prestação de contas do exercício {dados['ano']}",
        "",
        "Resumo gerado pelo sistema da ASAF a partir dos lançamentos contábeis do exercício registrados até a Assembleia Geral que aprovou as contas, "
        f"em {_data(dados['aprovadas_em_assembleia_em'])}.",
        "",
        "Receitas",
    ]
    linhas += [f"  {r['codigo']} {r['conta']}: {reais(Decimal(r['valor']))}" for r in dados["receitas"]] or ["  Nenhuma receita no exercício."]
    linhas += ["", "Despesas"]
    linhas += [f"  {d['codigo']} {d['conta']}: {reais(Decimal(d['valor']))}" for d in dados["despesas"]] or ["  Nenhuma despesa no exercício."]
    linhas += [
        "",
        f"Total das receitas: {reais(Decimal(dados['total_receitas']))}",
        f"Total das despesas: {reais(Decimal(dados['total_despesas']))}",
        f"Resultado do exercício: {reais(Decimal(dados['resultado']))}",
    ]
    pareceres = dados["pareceres"]
    if pareceres:
        linhas += ["", "Parecer do Conselho Fiscal" if len(pareceres) == 1 else f"Pareceres do Conselho Fiscal ({len(pareceres)}, um por conselheiro)"]
        for p in pareceres:
            linhas += [f"{p['tipo']}, emitido em {_data(p['data'])}:", p["texto"]]
    return "\n".join(linhas)


def _data(iso: Optional[str]) -> str:
    return "/".join(reversed(iso.split("-"))) if iso else ""


def documentos_das_contas(db: Session, ano: int) -> list[DocumentoInstitucional]:
    return (
        db.query(DocumentoInstitucional)
        .filter(DocumentoInstitucional.tipo == TIPO, DocumentoInstitucional.ano == ano, DocumentoInstitucional.dados_publicos_json.isnot(None))
        .order_by(DocumentoInstitucional.id_documento.desc())
        .all()
    )


def situacao_no_site(db: Session, ano: int) -> dict:
    aprovacao = aprovacao_das_contas(db, ano)
    documentos = documentos_das_contas(db, ano)
    atual = next((d for d in documentos if d.situacao in (RASCUNHO, EM_REVISAO)), None) or next((d for d in documentos if d.situacao == APROVADO), None)
    return {
        "ano": ano,
        "aprovadas_pela_assembleia": aprovacao is not None,
        "aprovadas_em": dia_da_assembleia(aprovacao[2]) if aprovacao else None,
        "lancamentos_registrados_depois": lancamentos_registrados_depois(db, ano, aprovacao[2]) if aprovacao else 0,
        "documento": {"id_documento": atual.id_documento, "situacao": atual.situacao, "versao": atual.versao} if atual else None,
    }


def exigir_aprovacao_vigente(db: Session, doc: DocumentoInstitucional) -> None:
    """Na revisão e na aprovação da publicação, confere DE NOVO: a deliberação pode ter sido revogada depois do preparo."""
    if doc.tipo == TIPO and doc.dados_publicos_json and doc.ano and aprovacao_das_contas(db, doc.ano) is None:
        raise HTTPException(
            status_code=409,
            detail=f"As contas de {doc.ano} não têm mais a aprovação da Assembleia (a deliberação foi revogada?): elas não podem ir ao site.",
        )


def preparar(db: Session, usuario, ano: int) -> tuple[DocumentoInstitucional, str]:
    """Monta (ou remonta, no rascunho) o documento das contas do ano para o site. Devolve (documento, ação para a auditoria)."""
    aprovacao = aprovacao_das_contas(db, ano)
    if aprovacao is None:
        raise HTTPException(
            status_code=409,
            detail=f"As contas de {ano} ainda não foram aprovadas pela Assembleia: falta a deliberação de aprovação de contas desse exercício numa ata "
                   "assinada. Elas só vão ao site depois disso.",
        )
    deliberacao, _ata, assembleia = aprovacao
    documentos = documentos_das_contas(db, ano)
    em_revisao = next((d for d in documentos if d.situacao == EM_REVISAO), None)
    if em_revisao is not None:
        return em_revisao, "JA_EM_REVISAO"
    # monta e confere ANTES de criar o documento ou a versão: uma recusa (dado pessoal no parecer) não deixa rascunho órfão
    dados = montar(db, ano, deliberacao, assembleia)
    corpo = texto(dados)
    documentos_institucionais.conferir_texto_gerado(corpo)
    rascunho = next((d for d in documentos if d.situacao == RASCUNHO), None)
    acao = "NUMEROS_ATUALIZADOS"
    if rascunho is None:
        publicado = next((d for d in documentos if d.situacao == APROVADO), None)
        if publicado is not None:
            rascunho, acao = documentos_institucionais.nova_versao(db, usuario, publicado, gerado=True), "NOVA_VERSAO"
        else:
            rascunho = documentos_institucionais.criar_documento(db, usuario, {
                "tipo": TIPO, "titulo": f"Prestação de contas do exercício {ano}", "classificacao": PUBLICA, "publicar_no_site": True,
                "descricao": "Resumo das receitas e despesas do exercício, gerado pelo sistema a partir dos lançamentos, com o parecer do Conselho Fiscal.",
                "data_documento": date.fromisoformat(dia_da_assembleia(assembleia)), "ano": ano,
            })
            acao = "CRIADO"
    documentos_institucionais.gravar_texto_gerado(db, rascunho, corpo, dados)
    return rascunho, acao
