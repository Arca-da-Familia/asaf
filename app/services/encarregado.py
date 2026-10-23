"""v7.0a (FASE 7) - o encarregado pelo tratamento de dados pessoais (LGPD, art. 41) com ato formal e substituto (Resolução CD/ANPD nº 18/2024, conferida no texto oficial).

Decisão do Presidente (2026-10-09): o encarregado é o Presidente ("coloca eu"); a associação não tem segunda pessoa para o papel. O Estatuto atribui aos
Vice-Presidentes a substituição do Presidente nas faltas e impedimentos (art. 21, parágrafo único, sem ordem entre eles); o ATO designa o 1º e, na falta dele, o 2º
(a ordem é designação da associação, não texto do Estatuto). Os nomes saem SEMPRE dos mandatos vigentes da Diretoria Executiva, calculados na leitura (nunca um nome
digitado à parte que alguém precise lembrar de atualizar); o mandato só conta a partir do dia em que começa em Belém (a data do ato é a de Belém: o ato nunca sai
datado da véspera do mandato que cita).

Ver e baixar: `privacidade` (a Presidência e os cargos de Presidente e Vice-Presidentes). Gerar e registrar a cópia assinada: `privacidade_gerir` (só a Presidência
e o cargo de Presidente: o Vice-Presidente não troca o ato que o Presidente assinou).

O ato (art. 3º da Resolução): o sistema gera o texto e o PDF para imprimir; o texto fica guardado como foi gerado; a cópia assinada (PDF ou foto do papel) vai para o
armazenamento PRIVADO e só ela torna o ato vigente (o anterior passa a "Substituído"). Gerar outro ato descarta o rascunho que ainda não foi assinado. Registrar a
assinatura confere que o ato ainda nomeia quem os mandatos dizem: o mandato pode ter mudado entre imprimir e assinar.

Os avisos (calculados na leitura) dizem o que falta: sem mandato de Presidente, sem ato assinado, ato aguardando a assinatura, ato que nomeia outra pessoa, substituto
diferente do Vice-Presidente de hoje, sem Vice-Presidente."""
import hashlib
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config_cache import obter_configuracao
from app.models.associados import Associado
from app.models.mandatos import Mandato
from app.models.privacidade import DESCARTADO, RASCUNHO, SUBSTITUIDO, VIGENTE, AtoDoEncarregado
from app.services import armazenamento, pdf_de_texto
from app.services.documentos_institucionais import PASTA_ORIGINAIS, _nome_para_exibir, _validar_original
from app.services.fuso import para_belem
from app.services.site_publico import url_base_do_site

PERMISSAO = "privacidade"
PERMISSAO_GERIR = "privacidade_gerir"
ORGAO = "DIRETORIA_EXECUTIVA"
CARGO_ENCARREGADO = "PRESIDENTE"
CARGOS_SUBSTITUTOS = (("VICE_PRESIDENTE", "1º Vice-Presidente"), ("VICE_PRESIDENTE_2", "2º Vice-Presidente"))

# Os dados fixos da associação, iguais aos do site (site/src/config/organizacao.ts; um teste compara): a Instituição do painel, quando preenchida, vale por cima.
ORGANIZACAO_PADRAO = {
    "nome": "Associação Arca da Família (ASAF)",
    "cnpj": "17.631.942/0001-70",
    "endereco": "Rua Paulo Afonso, 150 — Bairro da Paz, Parauapebas — PA, CEP 68515-000",
    "email": "asaf@asaf.org.br",
    "cidade": "Parauapebas (PA)",
}

_MESES = ("janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro")


def _data_por_extenso(momento_utc: datetime) -> str:
    dia = para_belem(momento_utc)
    return f"{dia.day} de {_MESES[dia.month - 1]} de {dia.year}"


def _data_curta(momento: datetime) -> str:
    return momento.strftime("%d/%m/%Y")


# ------------------------------------------------------------------------------------------------ quem é, pelos mandatos
def _mandato_vigente(db: Session, cargo: str, agora: datetime) -> Optional[Mandato]:
    """O mandato vigente do cargo na Diretoria Executiva (se houver mais de um, o que começou por último)."""
    hoje_em_belem = para_belem(agora).date()
    candidatos = (
        db.query(Mandato).filter(Mandato.orgao_codigo == ORGAO, Mandato.cargo_codigo == cargo)
        .order_by(Mandato.data_inicio.desc(), Mandato.id_mandato.desc()).all()
    )

    # Contado pelo DIA de Belém (a data do ato é a de Belém), com a mesma regra de dias de `Mandato.vigente`: vale do dia do início até a véspera do fim
    # previsto. Pelo relógio UTC, das 21h às 24h o mandato que começa amanhã já contaria e o que termina amanhã já teria acabado. O encerramento
    # antecipado (renúncia, destituição) é um instante e vale na hora.
    def vale(m: Mandato) -> bool:
        if m.data_fim_efetivo is not None and agora >= m.data_fim_efetivo:
            return False
        return m.data_inicio.date() <= hoje_em_belem < m.data_fim_previsto.date()

    return next((m for m in candidatos if vale(m)), None)


def _pessoa_do_mandato(db: Session, mandato: Optional[Mandato], cargo_rotulo: str) -> Optional[dict]:
    if mandato is None:
        return None
    associado = db.get(Associado, mandato.id_associado)
    nome = (associado.nome_completo or "").strip() if associado else ""
    if not nome:
        return None
    return {
        "id_associado": mandato.id_associado, "nome": nome, "cargo": cargo_rotulo,
        "mandato_inicio": mandato.data_inicio.date().isoformat(), "mandato_fim": mandato.data_fim_previsto.date().isoformat(),
    }


def quem_e_hoje(db: Session, agora: Optional[datetime] = None) -> tuple[Optional[dict], Optional[dict]]:
    """(encarregado, substituto) pelos mandatos vigentes: o Presidente e o 1º Vice-Presidente (ou o 2º, na falta do 1º)."""
    agora = agora or datetime.utcnow()
    encarregado = _pessoa_do_mandato(db, _mandato_vigente(db, CARGO_ENCARREGADO, agora), "Presidente")
    substituto = None
    for cargo, rotulo in CARGOS_SUBSTITUTOS:
        substituto = _pessoa_do_mandato(db, _mandato_vigente(db, cargo, agora), rotulo)
        if substituto:
            break
    return encarregado, substituto


# ------------------------------------------------------------------------------------------------ o texto do ato
def _organizacao(db: Session) -> dict:
    dados = dict(ORGANIZACAO_PADRAO)
    for campo, chave in (("nome", "NOME_INSTITUICAO"), ("cnpj", "CNPJ"), ("endereco", "ENDERECO"), ("email", "EMAIL_INSTITUCIONAL")):
        valor = (obter_configuracao(db, chave, "") or "").strip()
        if valor:
            dados[campo] = valor
    return dados


def montar_texto(db: Session, numero: int, encarregado: dict, substituto: Optional[dict], anterior: Optional[AtoDoEncarregado], agora: datetime) -> str:
    org = _organizacao(db)
    formulario = f"{url_base_do_site(db)}/privacidade/solicitacao-do-titular/"
    if substituto:
        quem_substitui = (
            f"{substituto['nome']}, {substituto['cargo']} da associação (mandato de {_data_curta(datetime.fromisoformat(substituto['mandato_inicio']))} "
            f"a {_data_curta(datetime.fromisoformat(substituto['mandato_fim']))}). O Estatuto (art. 21, parágrafo único) atribui aos Vice-Presidentes a "
            "substituição do Presidente em suas faltas e impedimentos; na falta do substituto aqui designado, a função é exercida pelo outro Vice-Presidente em "
            "exercício"
        )
    else:
        quem_substitui = (
            "o 1º Vice-Presidente em exercício e, na falta dele, o 2º Vice-Presidente em exercício (o Estatuto, art. 21, parágrafo único, atribui aos "
            "Vice-Presidentes a substituição do Presidente em suas faltas e impedimentos); o nome será indicado em novo ato quando o mandato estiver registrado"
        )
    revoga = f"Este ato revoga o Ato nº {anterior.numero}, de {_data_por_extenso(anterior.gerado_em)}." if anterior else "Este é o primeiro ato desta designação."
    paragrafos = [
        f"ATO Nº {numero} — DESIGNAÇÃO DO ENCARREGADO PELO TRATAMENTO DE DADOS PESSOAIS",
        "",
        f"A {org['nome']}, inscrita no CNPJ sob o nº {org['cnpj']}, com sede na {org['endereco']}, na qualidade de controladora de dados pessoais, representada "
        "por seu Presidente (Estatuto, art. 21, I), com fundamento no art. 41 da Lei nº 13.709, de 14 de agosto de 2018 (Lei Geral de Proteção de Dados "
        "Pessoais), e nos arts. 3º e 4º do Regulamento sobre a atuação do encarregado pelo tratamento de dados pessoais (Resolução CD/ANPD nº 18, de 16 de "
        "julho de 2024), resolve:",
        "",
        f"1. Designar como encarregado pelo tratamento de dados pessoais {encarregado['nome']}, Presidente da associação (mandato de "
        f"{_data_curta(datetime.fromisoformat(encarregado['mandato_inicio']))} a {_data_curta(datetime.fromisoformat(encarregado['mandato_fim']))}).",
        "",
        f"2. Designar como substituto do encarregado, nas suas ausências, impedimentos e vacâncias (Resolução CD/ANPD nº 18/2024, art. 4º), {quem_substitui}.",
        "",
        f"3. Formas de atuação: o encarregado recebe as comunicações dos titulares de dados e da Autoridade Nacional de Proteção de Dados (ANPD) pelo e-mail "
        f"{org['email']} e pelo formulário de solicitação do titular no site da associação ({formulario}); os pedidos feitos pelo formulário ficam registrados "
        "no sistema da associação, com protocolo e prazo. A identidade e o contato do encarregado são divulgados na Política de Privacidade do site, em local de destaque "
        "(Resolução CD/ANPD nº 18/2024, arts. 8º e 9º).",
        "",
        "4. Atividades (Resolução CD/ANPD nº 18/2024, art. 15): I - aceitar reclamações e comunicações dos titulares, prestar esclarecimentos e adotar "
        "providências cabíveis; II - receber comunicações da ANPD e adotar providências; III - orientar os funcionários e os contratados da associação a "
        "respeito das práticas a serem tomadas em relação à proteção de dados pessoais; IV - executar as demais atribuições determinadas pela associação ou "
        "estabelecidas em normas complementares. Cabe-lhe ainda prestar assistência e orientação à associação nas matérias do art. 16 do mesmo regulamento, "
        "entre elas o registro e a comunicação de incidente de segurança, o registro das operações de tratamento de dados pessoais e o relatório de impacto à "
        "proteção de dados pessoais.",
        "",
        "5. Conflito de interesse (Resolução CD/ANPD nº 18/2024, arts. 18 a 21): o encarregado declara que acumula a função com a de Presidente, que toma "
        "decisões estratégicas sobre o tratamento de dados pessoais da associação (art. 19, § 1º, II). Como medida para afastar o risco (art. 21, parágrafo "
        "único, II), a reclamação de titular ou a comunicação da ANPD que questione decisão tomada pelo próprio Presidente sobre o tratamento de dados "
        "pessoais é encaminhada pelo encarregado ao substituto designado no item 2, que a examina e responde.",
        "",
        f"6. Este ato vale a partir da assinatura e será apresentado à ANPD quando solicitado (Resolução CD/ANPD nº 18/2024, art. 3º, § 2º). {revoga}",
        "",
        f"{org['cidade']}, {_data_por_extenso(agora)}.",
        "",
        "",
        "______________________________________________",
        f"{encarregado['nome']}",
        "Presidente, pela associação, e encarregado designado (ciente)",
    ]
    if substituto:
        paragrafos += [
            "",
            "",
            "______________________________________________",
            f"{substituto['nome']}",
            f"{substituto['cargo']}, substituto designado (ciente)",
        ]
    return "\n".join(paragrafos)


# ------------------------------------------------------------------------------------------------ a situação e os avisos
def _serializar(ato: AtoDoEncarregado) -> dict:
    return {
        "id_ato": ato.id_ato, "numero": ato.numero, "situacao": ato.situacao, "texto": ato.texto,
        "id_associado_encarregado": ato.id_associado_encarregado, "nome_encarregado": ato.nome_encarregado,
        "id_associado_substituto": ato.id_associado_substituto, "nome_substituto": ato.nome_substituto, "cargo_substituto": ato.cargo_substituto,
        "gerado_em": ato.gerado_em.isoformat(), "assinatura_registrada_em": ato.assinatura_registrada_em.isoformat() if ato.assinatura_registrada_em else None,
        "tem_copia_assinada": bool(ato.assinado_arquivo), "assinado_nome_arquivo": ato.assinado_nome_arquivo, "assinado_sha256": ato.assinado_sha256,
        "encerrado_em": ato.encerrado_em.isoformat() if ato.encerrado_em else None,
    }


def _do_tipo(db: Session, situacao: str, travar: bool = False) -> Optional[AtoDoEncarregado]:
    consulta = db.query(AtoDoEncarregado).filter(AtoDoEncarregado.situacao == situacao).order_by(AtoDoEncarregado.numero.desc())
    return (consulta.with_for_update() if travar else consulta).first()


def _gravar(db: Session, so_enviar: bool = False) -> None:
    """Grava (ou só envia, sem fechar a transação); se outra pessoa gerou ou registrou um ato no mesmo instante (número repetido, segundo ato aguardando
    assinatura ou segundo vigente), desfaz e pede para recarregar, em vez de um erro 500."""
    try:
        db.flush() if so_enviar else db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Outro ato foi gerado ou registrado ao mesmo tempo. Recarregue a página e confira.")


def avisos(encarregado: Optional[dict], substituto: Optional[dict], vigente: Optional[AtoDoEncarregado], rascunho: Optional[AtoDoEncarregado]) -> list[dict]:
    lista = []
    if encarregado is None:
        lista.append({
            "codigo": "SEM_PRESIDENTE",
            "texto": "Não há mandato vigente de Presidente cadastrado (Governança > Mandatos). Sem ele, o site não mostra o nome do encarregado e o ato não pode ser gerado.",
        })
    if vigente is None:
        lista.append({"codigo": "SEM_ATO", "texto": "Ainda não há ato de designação do encarregado assinado (Resolução CD/ANPD nº 18/2024, art. 3º)."})
    if rascunho is not None:
        lista.append({
            "codigo": "AGUARDANDO_ASSINATURA",
            "texto": f"O Ato nº {rascunho.numero} foi gerado e aguarda a cópia assinada: o Presidente imprime, colhe as assinaturas e anexa aqui a cópia.",
        })
    if vigente is not None and encarregado is not None and vigente.id_associado_encarregado != encarregado["id_associado"]:
        lista.append({
            "codigo": "ATO_DE_OUTRA_PESSOA",
            "texto": f"O ato vigente (nº {vigente.numero}) nomeia {vigente.nome_encarregado}, mas o Presidente hoje é {encarregado['nome']}: gere e assine um novo ato.",
        })
    if vigente is not None and substituto is not None and vigente.id_associado_substituto != substituto["id_associado"]:
        lista.append({
            "codigo": "SUBSTITUTO_DIFERENTE",
            "texto": f"O substituto hoje é {substituto['nome']} ({substituto['cargo']}), mas o ato vigente (nº {vigente.numero}) "
                     + (f"nomeia {vigente.nome_substituto}" if vigente.nome_substituto else "não nomeia ninguém") + ": gere e assine um novo ato.",
        })
    if substituto is None:
        if vigente is not None and vigente.id_associado_substituto is not None:
            texto = (
                f"Não há mandato vigente de 1º ou 2º Vice-Presidente cadastrado: o ato vigente (nº {vigente.numero}) nomeia {vigente.nome_substituto} como "
                "substituto, que não tem mais o cargo. Cadastre o mandato e gere um novo ato."
            )
        else:
            texto = (
                "Não há mandato vigente de 1º ou 2º Vice-Presidente cadastrado: um ato gerado agora designa o substituto só pelo cargo, sem o nome "
                "(Resolução CD/ANPD nº 18/2024, art. 4º)."
            )
        lista.append({"codigo": "SEM_SUBSTITUTO", "texto": texto})
    return lista


def situacao(db: Session, agora: Optional[datetime] = None) -> dict:
    encarregado, substituto = quem_e_hoje(db, agora)
    vigente, rascunho = _do_tipo(db, VIGENTE), _do_tipo(db, RASCUNHO)
    historico = db.query(AtoDoEncarregado).order_by(AtoDoEncarregado.numero.desc()).all()
    return {
        "encarregado": encarregado, "substituto": substituto,
        "ato_vigente": _serializar(vigente) if vigente else None, "rascunho": _serializar(rascunho) if rascunho else None,
        "historico": [_serializar(a) for a in historico],
        "avisos": avisos(encarregado, substituto, vigente, rascunho),
    }


# ------------------------------------------------------------------------------------------------ gerar e assinar
def buscar(db: Session, id_ato: int) -> AtoDoEncarregado:
    ato = db.get(AtoDoEncarregado, id_ato)
    if ato is None:
        raise HTTPException(status_code=404, detail="Ato não encontrado.")
    return ato


def gerar(db: Session, usuario, agora: Optional[datetime] = None) -> tuple[AtoDoEncarregado, Optional[AtoDoEncarregado]]:
    """Gera um novo ato (aguardando assinatura) com os nomes dos mandatos de hoje. Devolve (novo, rascunho descartado ou None)."""
    agora = agora or datetime.utcnow()
    encarregado, substituto = quem_e_hoje(db, agora)
    if encarregado is None:
        raise HTTPException(
            status_code=409,
            detail="Não há mandato vigente de Presidente cadastrado. Cadastre o mandato em Governança > Mandatos antes de gerar o ato: o encarregado é o Presidente.",
        )
    # trava as linhas (Postgres: SELECT ... FOR UPDATE): dois cliques ao mesmo tempo, ou gerar enquanto outra pessoa registra a assinatura, não deixam dois
    # atos vigentes nem um rascunho descartado e vigente ao mesmo tempo
    # e o banco tem um índice único parcial: no máximo UM ato aguardando assinatura e UM vigente (o que escapar da trava vira 409, nunca dois)
    descartado = _do_tipo(db, RASCUNHO, travar=True)
    vigente = _do_tipo(db, VIGENTE, travar=True)
    if descartado is not None:
        descartado.situacao, descartado.encerrado_em = DESCARTADO, agora
        _gravar(db, so_enviar=True)  # o rascunho antigo sai antes de o novo entrar
    numero = (db.query(func.max(AtoDoEncarregado.numero)).scalar() or 0) + 1
    ato = AtoDoEncarregado(
        numero=numero, situacao=RASCUNHO, texto=montar_texto(db, numero, encarregado, substituto, vigente, agora),
        id_associado_encarregado=encarregado["id_associado"], nome_encarregado=encarregado["nome"],
        id_associado_substituto=substituto["id_associado"] if substituto else None, nome_substituto=substituto["nome"] if substituto else None,
        cargo_substituto=substituto["cargo"] if substituto else None, gerado_em=agora, id_usuario_geracao=usuario.id_usuario,
    )
    db.add(ato)
    _gravar(db)
    db.refresh(ato)
    return ato, descartado


def registrar_assinatura(
    db: Session, usuario, id_ato: int, nome_arquivo: Optional[str], conteudo: bytes, agora: Optional[datetime] = None,
) -> tuple[AtoDoEncarregado, Optional[AtoDoEncarregado]]:
    """Anexa a cópia assinada e torna o ato vigente. Devolve (ato, ato anterior substituído ou None)."""
    agora = agora or datetime.utcnow()
    ato = db.query(AtoDoEncarregado).filter(AtoDoEncarregado.id_ato == id_ato).with_for_update().first()
    if ato is None:
        raise HTTPException(status_code=404, detail="Ato não encontrado.")
    if ato.situacao != RASCUNHO:
        raise HTTPException(status_code=409, detail=f"O Ato nº {ato.numero} está \"{ato.situacao}\": só o ato que aguarda assinatura recebe a cópia assinada.")
    encarregado, substituto = quem_e_hoje(db, agora)
    if encarregado is None or encarregado["id_associado"] != ato.id_associado_encarregado:
        raise HTTPException(
            status_code=409,
            detail=f"O Ato nº {ato.numero} nomeia {ato.nome_encarregado}, que não é o Presidente com mandato vigente hoje: gere um novo ato.",
        )
    if (substituto["id_associado"] if substituto else None) != ato.id_associado_substituto:
        raise HTTPException(status_code=409, detail=f"O substituto mudou desde que o Ato nº {ato.numero} foi gerado: gere um novo ato.")
    extensao = _validar_original(nome_arquivo, conteudo)
    nome = armazenamento.nome_aleatorio(extensao)
    armazenamento.obter().salvar(PASTA_ORIGINAIS, nome, conteudo)
    try:
        anteriores = db.query(AtoDoEncarregado).filter(AtoDoEncarregado.situacao == VIGENTE).with_for_update().all()
        for vigente in anteriores:
            vigente.situacao, vigente.encerrado_em = SUBSTITUIDO, agora
        _gravar(db, so_enviar=True)  # o anterior deixa de ser vigente antes de este passar a ser (índice único parcial)
        anterior = max(anteriores, key=lambda a: a.numero, default=None)
        ato.situacao = VIGENTE
        ato.assinado_arquivo, ato.assinado_nome_arquivo = nome, _nome_para_exibir(nome_arquivo)
        ato.assinado_sha256, ato.assinado_tamanho = hashlib.sha256(conteudo).hexdigest(), len(conteudo)
        ato.assinatura_registrada_em, ato.id_usuario_assinatura = agora, usuario.id_usuario
        _gravar(db)
    except HTTPException:
        armazenamento.obter().remover(PASTA_ORIGINAIS, nome)  # não deixa no armazenamento uma cópia que nenhum ato aponta
        raise
    db.refresh(ato)
    return ato, anterior


def ler_copia_assinada(ato: AtoDoEncarregado) -> bytes:
    if not ato.assinado_arquivo:
        raise HTTPException(status_code=404, detail="Este ato não tem cópia assinada.")
    conteudo = armazenamento.obter().ler(PASTA_ORIGINAIS, ato.assinado_arquivo)
    if conteudo is None:
        raise HTTPException(status_code=404, detail="A cópia assinada não foi encontrada no armazenamento.")
    return conteudo


# ------------------------------------------------------------------------------------------------ o PDF para imprimir
def pdf(ato: AtoDoEncarregado) -> bytes:
    """O texto guardado do ato, em A4, com quebra de linha pela largura real e página nova quando acaba o espaço."""
    return pdf_de_texto.gerar(
        f"Ato nº {ato.numero} - Designação do encarregado pelo tratamento de dados pessoais", ato.texto.split("\n"),
        f"Ato nº {ato.numero} — gerado pelo sistema da ASAF em {_data_por_extenso(ato.gerado_em)}; vale com as assinaturas.",
    )
