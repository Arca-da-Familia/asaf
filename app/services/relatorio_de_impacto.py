"""v7.0d (FASE 7) - o RELATÓRIO DE IMPACTO à proteção de dados pessoais (RIPD) antes de qualquer tratamento de alto risco.

LGPD art. 5º, XVII: "documentação do controlador que contém a descrição dos processos de tratamento de dados pessoais que podem gerar riscos às liberdades civis e
aos direitos fundamentais, bem como medidas, salvaguardas e mecanismos de mitigação de risco"; art. 38, parágrafo único: "no mínimo, a descrição dos tipos de dados
coletados, a metodologia utilizada para a coleta e para a garantia da segurança das informações e a análise do controlador com relação a medidas, salvaguardas e
mecanismos de mitigação de risco adotados". Alto risco: Resolução CD/ANPD nº 2/2022, art. 4º (um critério geral — afetar significativamente interesses e direitos
— e um específico — dado sensível ou de criança, tecnologia nova, decisão só automatizada).

Os tratamentos de alto risco ficam no código (`TRATAMENTOS`). O PORTÃO: `exigir_aprovado(db, codigo)` recusa (409) a gravação quando não há relatório APROVADO —
o prontuário e o encaminhamento à rede externa já chamam; a biometria (v20.3) e a pontuação de engajamento (v11.1), quando forem construídas, chamam o mesmo.
O sistema monta o rascunho a partir do inventário (v7.0c) e do que o código faz (cada afirmação do rascunho foi conferida com o código: tests/
test_relatorio_de_impacto.py); o encarregado escreve o parecer e o Presidente aprova (`privacidade_gerir`). Suspender fecha os NOVOS REGISTROS até aprovar de novo
(a leitura do que já existe continua, auditada). Cada versão guarda as seções como estavam; salvar e aprovar travam a linha (aprovar no meio de um salvar não muda o
texto aprovado) e quem salva sobre um rascunho que outra pessoa mudou recebe 409."""
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.core import Usuario
from app.models.privacidade import RIPD_APROVADO, RIPD_RASCUNHO, RIPD_SUBSTITUIDO, RIPD_SUSPENSO, RelatorioDeImpacto
from app.services import inventario, pdf_de_texto
from app.services.fuso import dia_e_hora_em_belem

TAMANHO_MINIMO = 20


@dataclass(frozen=True)
class Tratamento:
    codigo: str
    nome: str
    atividade: Optional[str]  # a atividade do inventário (v7.0c) de onde vêm os dados, a base legal e as medidas
    ligado: bool  # já existe no sistema (o portão vale já) ou ainda vai ser construído
    versao_do_plano: str
    por_que_alto_risco: str


TRATAMENTOS: tuple[Tratamento, ...] = (
    Tratamento(
        "ATENDIMENTO_SOCIAL", "Prontuário e encaminhamentos de beneficiários", "BENEFICIARIOS", True, "v4.2",
        "Trata dado pessoal sensível (o relato do atendimento e o encaminhamento ao posto de saúde, ao CRAS ou ao Conselho Tutelar falam de saúde e de "
        "vulnerabilidade social) de crianças, adolescentes e famílias atendidas (critério específico da Resolução CD/ANPD nº 2/2022, art. 4º), e pode afetar "
        "significativamente os direitos de quem é atendido (critério geral).",
    ),
    Tratamento(
        "BIOMETRIA", "Biometria (presença por reconhecimento facial)", None, False, "v20.3",
        "Biometria é dado pessoal sensível (LGPD art. 5º, II) tratado com tecnologia nova; ainda não existe no sistema: quando for construída, só roda com "
        "relatório aprovado.",
    ),
    Tratamento(
        "PONTUACAO_DE_ENGAJAMENTO", "Pontuação de engajamento (perfilamento de associados)", None, False, "v11.1",
        "Avaliar e classificar pessoas por pontuação é perfilamento que pode levar a decisão automatizada (LGPD art. 20); ainda não existe no sistema: quando for "
        "construída, só roda com relatório aprovado.",
    ),
)
_POR_CODIGO = {t.codigo: t for t in TRATAMENTOS}

SECOES: tuple[tuple[str, str], ...] = (
    ("descricao", "Descrição do tratamento (o que se faz, de quem, para quê)"),
    ("dados", "Tipos de dados coletados (LGPD art. 38, parágrafo único)"),
    ("metodologia", "Metodologia da coleta e da garantia da segurança das informações (art. 38, parágrafo único)"),
    ("necessidade", "Necessidade e proporcionalidade (por que é preciso e por que não dá para fazer com menos dado)"),
    ("riscos", "Riscos às liberdades civis e aos direitos dos titulares"),
    ("medidas", "Medidas, salvaguardas e mecanismos de mitigação de risco adotados (art. 38, parágrafo único)"),
    ("parecer_do_encarregado", "Parecer do encarregado (Resolução CD/ANPD nº 18/2024, art. 16, III)"),
)
_CHAVES = tuple(c for c, _ in SECOES)


def buscar(codigo: str) -> Tratamento:
    t = _POR_CODIGO.get(codigo)
    if t is None:
        raise HTTPException(status_code=404, detail="Tratamento de alto risco não encontrado.")
    return t


def _proposta(db: Session, t: Tratamento) -> dict:
    """O rascunho que o sistema monta: do inventário (dados, base, medidas) e do que o código faz. O parecer fica em branco: é do encarregado."""
    if t.atividade is None:
        return {chave: "" for chave in _CHAVES} | {"descricao": t.por_que_alto_risco}
    atividade = next(a for a in inventario.listar(db)["atividades"] if a["codigo"] == t.atividade)
    return {
        "descricao": f"{atividade['finalidade']} Titulares: {'; '.join(atividade['titulares'])}. Por que é de alto risco: {t.por_que_alto_risco}",
        "dados": (
            f"Dados sensíveis: {', '.join(atividade['dados_sensiveis']) or 'nenhum'}. Demais dados pessoais: {', '.join(atividade['dados_pessoais'])}. "
            f"{atividade['requisito_crianca'] or ''}"
        ).strip(),
        "metodologia": (
            "O relato e o encaminhamento são escritos e lidos no painel só por quem está ATIVO na equipe daquele projeto (a Presidência também precisa estar "
            "na equipe); quem tem a permissão Projetos pode pôr alguém (ou a si) na equipe de um projeto, e isso fica na Auditoria, como cada leitura. O "
            "atendimento só é registrado com o termo de consentimento assinado (pela pessoa atendida ou, se era criança ou adolescente na assinatura, por um "
            "dos pais ou pelo responsável) registrado no sistema, com a versão do termo (a marca antiga do cadastro não vale); revogado, nada novo grava. Onde fica: {' '.join(atividade['armazenamento'])}. Base legal (proposta): {'; '.join(atividade['bases_legais_texto'])}."
        ),
        "necessidade": (
            "Sem o registro do atendimento e do encaminhamento a equipe não acompanha a família nem garante a continuidade quando muda quem atende. "
            "O relato e o encaminhamento são texto, sem anexo; a orientação é não escrever documento nem dado de saúde que o atendimento não precise."
        ),
        "riscos": (
            "Exposição de dado de saúde ou de vulnerabilidade de criança ou de família (constrangimento, discriminação); leitura por quem entrou na equipe só "
            "para ler (fica na Auditoria, mas não é impedida); consentimento registrado sem o termo de fato assinado (o sistema confia em quem registra); no atendimento por família, o relato pode falar de outras "
            "pessoas da casa, que não assinaram termo próprio; ainda não há como apagar do sistema o prontuário de quem pede a eliminação (previsto na v7.1d); cópia "
            "para fora do sistema; uso para outra finalidade; guarda sem prazo (ainda não há rotina automática de eliminação para este dado)."
        ),
        "medidas": atividade["medidas"],
        "parecer_do_encarregado": "",
    }


def _atual(db: Session, codigo: str, situacoes: tuple[str, ...]) -> Optional[RelatorioDeImpacto]:
    return db.query(RelatorioDeImpacto).filter(RelatorioDeImpacto.codigo_tratamento == codigo, RelatorioDeImpacto.situacao.in_(situacoes)).order_by(
        RelatorioDeImpacto.versao.desc()).first()


def aprovado(db: Session, codigo: str) -> Optional[RelatorioDeImpacto]:
    return _atual(db, codigo, (RIPD_APROVADO,))


def exigir_aprovado(db: Session, codigo: str) -> None:
    """O PORTÃO: sem relatório de impacto aprovado, o tratamento de alto risco não roda."""
    if aprovado(db, codigo) is None:
        t = buscar(codigo)
        raise HTTPException(
            status_code=409,
            detail=f"{t.nome}: só pode ser registrado depois de aprovado o relatório de impacto à proteção de dados (LGPD art. 38). A Presidência aprova em "
                   "Privacidade > Relatório de impacto.",
        )


def _serializar(r: Optional[RelatorioDeImpacto]) -> Optional[dict]:
    if r is None:
        return None
    return {
        "id_relatorio": r.id_relatorio, "versao": r.versao, "situacao": r.situacao, "secoes": r.secoes,
        "criado_em": r.criado_em.isoformat(), "atualizado_em": r.atualizado_em.isoformat() if r.atualizado_em else None,
        "aprovado_em": r.aprovado_em.isoformat() if r.aprovado_em else None, "suspenso_em": r.suspenso_em.isoformat() if r.suspenso_em else None,
        "motivo_suspensao": r.motivo_suspensao,
    }


def listar(db: Session) -> dict:
    tratamentos = []
    for t in TRATAMENTOS:
        vigente = aprovado(db, t.codigo)
        rascunho = _atual(db, t.codigo, (RIPD_RASCUNHO,))
        suspenso = _atual(db, t.codigo, (RIPD_SUSPENSO,))
        historico = db.query(RelatorioDeImpacto).filter(RelatorioDeImpacto.codigo_tratamento == t.codigo).order_by(RelatorioDeImpacto.versao.desc()).all()
        tratamentos.append({
            "codigo": t.codigo, "nome": t.nome, "ligado": t.ligado, "versao_do_plano": t.versao_do_plano, "por_que_alto_risco": t.por_que_alto_risco,
            "liberado": vigente is not None, "aprovado": _serializar(vigente), "rascunho": _serializar(rascunho),
            "suspenso": _serializar(suspenso) if vigente is None else None,
            # a proposta do sistema só serve de ponto de partida quando não existe versão nenhuma; depois, parte-se do aprovado ou do suspenso
            "proposta": _proposta(db, t) if not historico else None,
            "marcador_do_rascunho": _marcador(rascunho),
            "historico": [{"versao": r.versao, "situacao": r.situacao, "criado_em": r.criado_em.isoformat(),
                           "aprovado_em": r.aprovado_em.isoformat() if r.aprovado_em else None} for r in historico],
        })
    return {"tratamentos": tratamentos, "secoes": [{"chave": c, "rotulo": r} for c, r in SECOES]}


def _marcador(rascunho: Optional[RelatorioDeImpacto]) -> Optional[str]:
    """O que a tela tinha quando começou a editar: se outra pessoa salvou depois, o marcador muda e quem salva recebe 409."""
    if rascunho is None:
        return None
    return f"{rascunho.id_relatorio}:{(rascunho.atualizado_em or rascunho.criado_em).isoformat()}"


def _travado(db: Session, codigo: str, situacoes: tuple[str, ...]) -> Optional[RelatorioDeImpacto]:
    return db.query(RelatorioDeImpacto).filter(RelatorioDeImpacto.codigo_tratamento == codigo, RelatorioDeImpacto.situacao.in_(situacoes)).order_by(
        RelatorioDeImpacto.versao.desc()).with_for_update().first()


def _gravar(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Outra pessoa salvou este relatório ao mesmo tempo. Recarregue a página e confira.")


def salvar_rascunho(db: Session, usuario: Usuario, codigo: str, secoes: dict, agora: Optional[datetime] = None,
                    marcador_base: Optional[str] = "") -> RelatorioDeImpacto:
    """Grava as seções no rascunho (cria um, em versão nova, se não houver); o relatório aprovado continua valendo até o rascunho ser aprovado.
    `marcador_base`: o marcador do rascunho que a tela carregou (None se não havia); "" = não conferir (uso interno)."""
    buscar(codigo)
    agora = agora or datetime.utcnow()
    limpas = {c: (str(secoes.get(c) or "")).strip() for c in _CHAVES}
    rascunho = _travado(db, codigo, (RIPD_RASCUNHO,))  # trava: um aprovar ao mesmo tempo espera, e não se reescreve o texto já aprovado
    if marcador_base != "" and marcador_base != _marcador(rascunho):
        db.rollback()
        raise HTTPException(status_code=409, detail="Outra pessoa salvou ou aprovou este relatório enquanto você editava. Recarregue a página e confira.")
    if rascunho is None:
        numero = (db.query(func.max(RelatorioDeImpacto.versao)).filter(RelatorioDeImpacto.codigo_tratamento == codigo).scalar() or 0) + 1
        rascunho = RelatorioDeImpacto(codigo_tratamento=codigo, versao=numero, situacao=RIPD_RASCUNHO, secoes=limpas, id_usuario_criacao=usuario.id_usuario,
                                      criado_em=agora)
        db.add(rascunho)
    else:
        rascunho.secoes, rascunho.atualizado_em = limpas, agora
    _gravar(db)
    db.refresh(rascunho)
    return rascunho


def aprovar(db: Session, usuario: Usuario, codigo: str, agora: Optional[datetime] = None) -> tuple[RelatorioDeImpacto, Optional[RelatorioDeImpacto]]:
    """Aprova o rascunho: todas as seções preenchidas, inclusive o parecer do encarregado. O anterior (aprovado ou suspenso) fica "Substituído"."""
    buscar(codigo)
    agora = agora or datetime.utcnow()
    rascunho = _travado(db, codigo, (RIPD_RASCUNHO,))
    if rascunho is None:
        db.rollback()
        raise HTTPException(status_code=409, detail="Não há rascunho para aprovar: salve o relatório primeiro.")
    faltando = [rotulo for chave, rotulo in SECOES if len((rascunho.secoes or {}).get(chave, "").strip()) < TAMANHO_MINIMO]
    if faltando:
        raise HTTPException(status_code=422, detail="Preencha antes de aprovar (pelo menos 20 letras cada): " + "; ".join(faltando) + ".")
    anteriores = db.query(RelatorioDeImpacto).filter(
        RelatorioDeImpacto.codigo_tratamento == codigo, RelatorioDeImpacto.situacao.in_((RIPD_APROVADO, RIPD_SUSPENSO)),
    ).all()
    for anterior in anteriores:
        anterior.situacao = RIPD_SUBSTITUIDO
    rascunho.situacao, rascunho.aprovado_em, rascunho.id_usuario_aprovacao = RIPD_APROVADO, agora, usuario.id_usuario
    _gravar(db)
    db.refresh(rascunho)
    return rascunho, max(anteriores, key=lambda r: r.versao, default=None)


def suspender(db: Session, usuario: Usuario, codigo: str, motivo: str, agora: Optional[datetime] = None) -> RelatorioDeImpacto:
    """Fecha os NOVOS REGISTROS do tratamento até aprovar de novo (o relatório ficou desatualizado, houve incidente...); a leitura do que existe continua."""
    buscar(codigo)
    if len((motivo or "").strip()) < 10:
        raise HTTPException(status_code=422, detail="Diga o motivo da suspensão (pelo menos 10 letras).")
    vigente = aprovado(db, codigo)
    if vigente is None:
        raise HTTPException(status_code=409, detail="Não há relatório aprovado para suspender: o tratamento já está fechado.")
    vigente.situacao, vigente.suspenso_em, vigente.id_usuario_suspensao, vigente.motivo_suspensao = RIPD_SUSPENSO, agora or datetime.utcnow(), \
        usuario.id_usuario, motivo.strip()[:500]
    _gravar(db)
    db.refresh(vigente)
    return vigente


def pdf(db: Session, codigo: str) -> bytes:
    """O texto que vale: o aprovado; sem ele, o suspenso (com a data e o motivo); sem eles, o rascunho; sem nada, a proposta do sistema."""
    t = buscar(codigo)
    r = aprovado(db, codigo) or _atual(db, codigo, (RIPD_SUSPENSO,)) or _atual(db, codigo, (RIPD_RASCUNHO,))
    secoes = r.secoes if r else _proposta(db, t)
    if r is None:
        situacao = "proposta do sistema (ainda não salva)"
    elif r.situacao == RIPD_SUSPENSO:
        situacao = f"versão {r.versao}, aprovada em {dia_e_hora_em_belem(r.aprovado_em)} e suspensa em {dia_e_hora_em_belem(r.suspenso_em)}: {r.motivo_suspensao}"
    elif r.situacao == RIPD_APROVADO:
        situacao = f"versão {r.versao}, aprovada em {dia_e_hora_em_belem(r.aprovado_em)}"
    else:
        situacao = f"versão {r.versao}, rascunho ainda não aprovado"
    paragrafos = [f"RELATÓRIO DE IMPACTO À PROTEÇÃO DE DADOS PESSOAIS — {t.nome.upper()}", f"Situação: {situacao}.", *inventario._cabecalho(db), ""]
    titulos = {0}
    for chave, rotulo in SECOES:
        titulos.add(len(paragrafos))
        paragrafos += [rotulo, secoes.get(chave) or "(em branco)", ""]
    return pdf_de_texto.gerar(f"Relatório de impacto - {t.nome}", paragrafos, f"Relatório de impacto da ASAF — {t.nome}.", titulos=frozenset(titulos), tamanho=10)
