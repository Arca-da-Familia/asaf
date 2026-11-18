"""v9.5h (desenho aprovado pelo Presidente, rodadas 4 e 5: "é um painel executivo... muito cru, poucos gráficos; e se a pessoa quiser filtrar?") - os
números e os gráficos do módulo Associados num pedido só, com filtros (período, situação, categoria, bairro). Só CONTAGENS: nenhum nome, CPF ou
contato sai daqui. Quem pode: a permissão `associados` (a mesma da lista).

O que cada número significa:
- "no quadro": quem não está Desligado; "cadastrados": todos (inclusive desligados);
- "em dia": Ativo - Em Dia sobre os ativos (Em Dia + Inadimplente);
- "entraram"/"saíram": data de entrada (admissão) e de desligamento DENTRO do período;
- idade: de quem está no quadro e tem data de nascimento;
- tamanho do quadro: quantos estavam no quadro no fim de cada mês (entrada até o mês; o desligamento, se a situação for Desligado, depois dele);
- onde moram: o bairro de quem está no quadro (os 5 mais comuns; o resto em "Outros bairros");
- tempo de associação: há quanto tempo quem está no quadro entrou;
- filiação: os pedidos RECEBIDOS no período e onde estão hoje (com os 3 sócios, aprovados, recusados, ainda abertos).
Os filtros de situação, categoria e bairro valem para os cadastros de associado; a filiação (pedidos, que ainda não são associados) só segue o
período."""
from collections import Counter
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.associados import Associado, Endereco
from app.models.filiacao import APROVADA, PROPOE, PROPONENTES_EXIGIDOS, RECUSADA, PropostaDeSocio, PropostaFiliacao
from app.models.pessoas import Pessoa
from app.security import exigir_permissao
from app.services.fuso import para_belem

router = APIRouter()
_permissao_associados = exigir_permissao("associados")

DESLIGADO = "Desligado"
EM_DIA = "Ativo - Em Dia"
INADIMPLENTE = "Ativo - Inadimplente"
ORDEM_DAS_SITUACOES = [EM_DIA, INADIMPLENTE, "Em Experiência", "Suspenso (Estatuto)", "Licenciado", DESLIGADO]
FAIXAS = [("16–17", 16, 17), ("18–29", 18, 29), ("30–44", 30, 44), ("45–59", 45, 59), ("60 ou mais", 60, 200)]
# anos completos desde a entrada: [mínimo, máximo)
TEMPOS = [("Menos de 1 ano", 0, 1), ("De 1 a 3 anos", 1, 3), ("De 3 a 5 anos", 3, 5), ("De 5 a 10 anos", 5, 10), ("10 anos ou mais", 10, 1000)]
BAIRROS_NO_GRAFICO = 5
OUTROS_BAIRROS = "Outros bairros"
SEM_BAIRRO = "Sem bairro informado"


def _meses(hoje: date, quantos: int) -> list[str]:
    """Os `quantos` meses até o atual, do mais antigo ao atual, como "AAAA-MM"."""
    ano, mes = hoje.year, hoje.month
    lista = []
    for _ in range(quantos):
        lista.append(f"{ano:04d}-{mes:02d}")
        mes -= 1
        if mes == 0:
            ano, mes = ano - 1, 12
    return list(reversed(lista))


def _idade(nascimento: date, hoje: date) -> int:
    return hoje.year - nascimento.year - ((hoje.month, hoje.day) < (nascimento.month, nascimento.day))


def _mes_de(momento: Optional[datetime]) -> Optional[str]:
    if not momento:
        return None
    local = para_belem(momento) if momento.tzinfo is None else momento
    return f"{local.year:04d}-{local.month:02d}"


@router.get("/api/associados/painel-de-graficos", summary="Números e gráficos do módulo Associados, com filtros (só contagens)")
def painel_de_graficos(
    meses: int = Query(12, ge=1, le=60),
    situacao: Optional[str] = None,
    categoria: Optional[str] = None,
    bairro: Optional[str] = None,
    db: Session = Depends(get_db),
    _usuario=Depends(_permissao_associados),
):
    hoje = para_belem(datetime.utcnow()).date()
    lista_de_meses = _meses(hoje, meses)
    primeiro_mes = lista_de_meses[0]

    linhas = (
        db.query(Associado, Pessoa.data_nascimento, Endereco.bairro)
        .join(Pessoa, Pessoa.id_pessoa == Associado.id_pessoa)
        .outerjoin(Endereco, Endereco.id_associado == Associado.id_associado)
        .all()
    )
    # um associado pode ter mais de um endereço antigo: vale o primeiro, sem contar a pessoa duas vezes
    vistos: dict[int, tuple] = {}
    for associado, nascimento, bairro_dele in linhas:
        vistos.setdefault(associado.id_associado, (associado, nascimento, (bairro_dele or "").strip()))
    todos = list(vistos.values())

    disponiveis = {
        "situacoes": [s for s in ORDEM_DAS_SITUACOES if any(a.status_arrolamento == s for a, _, _ in todos)]
        + sorted({a.status_arrolamento for a, _, _ in todos if a.status_arrolamento and a.status_arrolamento not in ORDEM_DAS_SITUACOES}),
        "categorias": sorted({a.categoria for a, _, _ in todos if a.categoria}),
        "bairros": sorted({b for _, _, b in todos if b}),
    }
    filtrados = [
        (a, nasc, b) for a, nasc, b in todos
        if (not situacao or a.status_arrolamento == situacao)
        and (not categoria or a.categoria == categoria)
        and (not bairro or b == bairro)
    ]

    no_quadro = [(a, nasc, b) for a, nasc, b in filtrados if a.status_arrolamento != DESLIGADO]
    em_dia = sum(1 for a, _, _ in no_quadro if a.status_arrolamento == EM_DIA)
    com_acesso = sum(1 for a, _, _ in no_quadro if a.id_usuario)
    ativos = sum(1 for a, _, _ in no_quadro if a.status_arrolamento in (EM_DIA, INADIMPLENTE))

    entradas = Counter(m for a, _, _ in filtrados if (m := _mes_de(a.data_admissao)) and m >= primeiro_mes)
    saidas = Counter(m for a, _, _ in filtrados if (m := _mes_de(a.data_desligamento)) and m >= primeiro_mes)

    idades = [_idade(nasc.date() if isinstance(nasc, datetime) else nasc, hoje) for _, nasc, _ in no_quadro if nasc]
    faixas = [{"faixa": nome, "total": sum(1 for i in idades if minimo <= i <= maximo)} for nome, minimo, maximo in FAIXAS]
    abaixo = sum(1 for i in idades if i < FAIXAS[0][1])  # cadastro com idade abaixo da primeira faixa não some da conta
    if abaixo:
        faixas.insert(0, {"faixa": f"Menos de {FAIXAS[0][1]}", "total": abaixo})
    sem_data = len(no_quadro) - len(idades)
    if sem_data:
        faixas.append({"faixa": "Sem data de nascimento", "total": sem_data})

    # tamanho do quadro no fim de cada mês: a data de desligamento só conta para quem está Desligado (quem foi readmitido guarda a data antiga);
    # desligado sem data não entra em mês nenhum (não se sabe quando saiu)
    def no_quadro_no_fim_de(mes: str, a: Associado) -> bool:
        entrada = _mes_de(a.data_admissao)
        if entrada and entrada > mes:
            return False
        if a.status_arrolamento == DESLIGADO:
            saida = _mes_de(a.data_desligamento)
            return bool(saida) and saida > mes
        return True

    quadro_por_mes = [{"mes": m, "total": sum(1 for a, _, _ in filtrados if no_quadro_no_fim_de(m, a))} for m in lista_de_meses]

    contagem_de_bairros = Counter(b for _, _, b in no_quadro if b)
    principais = contagem_de_bairros.most_common(BAIRROS_NO_GRAFICO)
    por_bairro = [{"nome": nome, "total": total} for nome, total in principais]
    outros = sum(contagem_de_bairros.values()) - sum(total for _, total in principais)
    if outros:
        por_bairro.append({"nome": OUTROS_BAIRROS, "total": outros})
    sem_bairro = sum(1 for _, _, b in no_quadro if not b)
    if sem_bairro:
        por_bairro.append({"nome": SEM_BAIRRO, "total": sem_bairro})

    anos_de_casa = [
        _idade((a.data_admissao.date() if isinstance(a.data_admissao, datetime) else a.data_admissao), hoje)
        for a, _, _ in no_quadro if a.data_admissao
    ]
    tempo_de_associacao = [
        {"faixa": nome, "total": sum(1 for anos in anos_de_casa if minimo <= anos < maximo)} for nome, minimo, maximo in TEMPOS
    ]
    sem_entrada = len(no_quadro) - len(anos_de_casa)
    if sem_entrada:
        tempo_de_associacao.append({"faixa": "Sem data de entrada", "total": sem_entrada})

    situacoes = Counter(a.status_arrolamento or "—" for a, _, _ in filtrados)
    categorias = Counter(a.categoria or "—" for a, _, _ in no_quadro)

    # filiação: os pedidos recebidos no período
    pedidos = [p for p in db.query(PropostaFiliacao).all() if (_mes_de(p.criado_em) or "") >= primeiro_mes]
    ids = [p.id_proposta for p in pedidos]
    propoem = Counter(
        d.id_proposta for d in db.query(PropostaDeSocio).filter(PropostaDeSocio.id_proposta.in_(ids), PropostaDeSocio.decisao == PROPOE).all()
    ) if ids else Counter()

    return {
        "periodo": {"meses": meses, "de": primeiro_mes, "ate": lista_de_meses[-1]},
        "filtros_disponiveis": disponiveis,
        "numeros": {
            "cadastrados": len(filtrados),
            "no_quadro": len(no_quadro),
            "desligados": len(filtrados) - len(no_quadro),
            "ativos": ativos,
            "em_dia": em_dia,
            "percentual_em_dia": round(100 * em_dia / ativos) if ativos else None,
            "entraram": sum(entradas.values()),
            "sairam": sum(saidas.values()),
            "idade_media": round(sum(idades) / len(idades)) if idades else None,
            "idade_minima": min(idades) if idades else None,
            "idade_maxima": max(idades) if idades else None,
            "com_acesso": com_acesso,
            "percentual_com_acesso": round(100 * com_acesso / len(no_quadro)) if no_quadro else None,
        },
        "por_mes": [{"mes": m, "entraram": entradas.get(m, 0), "sairam": saidas.get(m, 0)} for m in lista_de_meses],
        "por_situacao": [
            {"nome": s, "total": situacoes[s]} for s in [*ORDEM_DAS_SITUACOES, *sorted(set(situacoes) - set(ORDEM_DAS_SITUACOES))] if situacoes.get(s)
        ],
        "por_categoria": [{"nome": c, "total": n} for c, n in categorias.most_common()],
        "faixas_de_idade": faixas,
        "quadro_por_mes": quadro_por_mes,
        "por_bairro": por_bairro,
        "tempo_de_associacao": tempo_de_associacao,
        "filiacao": {
            "pedidos": len(pedidos),
            "com_os_3_socios": sum(1 for p in pedidos if propoem.get(p.id_proposta, 0) >= PROPONENTES_EXIGIDOS),
            "aprovados": sum(1 for p in pedidos if p.status == APROVADA),
            "recusados": sum(1 for p in pedidos if p.status == RECUSADA),
            "em_andamento": sum(1 for p in pedidos if p.status not in (APROVADA, RECUSADA)),
        },
    }
