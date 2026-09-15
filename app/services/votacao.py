"""v2.4 (FASE 2) - motor de votação: abertura (com quórum de instalação verificado na hora),
registro de voto (aberto ou secreto - desacoplado de verdade, ver app/models/votacao.py),
apuração com hash de integridade e resolução de empate."""
import hashlib
import json
import math
import secrets
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models.governanca import HabilitadoAssembleia
from app.models.sessao_assembleia import EM_VOTACAO, ItemPauta
from app.models.votacao import (
    ENCERRADA, MAIORIA_ABSOLUTA, MAIORIA_SIMPLES, OPCOES_RESERVADAS, QUALIFICADA, SECRETA,
    ComprovanteVotoSecreto, RegistroVotoSecreto, Votacao, VotoAberto,
)
from app.services.estatuto import obter_regra_vigente
from app.services.sessao_assembleia import quorum_instalacao_atual


def opcoes_validas(votacao: Votacao) -> list[str]:
    return [o for o in votacao.opcoes_validas.split(",") if o] + sorted(OPCOES_RESERVADAS)


def abrir_votacao(
    db: Session, item: ItemPauta, titulo: str, tipo: str, escrutinio: str, opcoes: list[str],
    fracao_qualificada: Optional[str], considerar_abstencao_na_base: bool, id_usuario: Optional[int],
) -> Votacao:
    from app.models.governanca import Assembleia  # import local pra evitar ciclo com app.services.assembleia

    assembleia = db.query(Assembleia).filter(Assembleia.id_assembleia == item.id_assembleia).first()
    quorum = quorum_instalacao_atual(db, assembleia)
    if not quorum["quorum_atingido"]:
        raise ValueError(
            f"Quórum de instalação não atingido agora ({quorum['credenciados_habilitados']}/{quorum['minimo_exigido']}, "
            f"{quorum['convocacao_aplicavel']} convocação) - a Assembleia Geral só pode deliberar com o quórum apurado (Art. 6º)."
        )

    votacao = Votacao(
        id_item_pauta=item.id_item, titulo=titulo, tipo=tipo, escrutinio=escrutinio,
        fracao_qualificada=fracao_qualificada, opcoes_validas=",".join(opcoes),
        considerar_abstencao_na_base=considerar_abstencao_na_base,
        quorum_instalacao_minimo=quorum["minimo_exigido"], id_usuario_criacao=id_usuario,
    )
    db.add(votacao)
    item.status = EM_VOTACAO
    if item.aberto_em is None:
        item.aberto_em = datetime.utcnow()
    db.commit()
    db.refresh(votacao)
    return votacao


def associado_habilitado(db: Session, id_assembleia: int, id_associado: int) -> bool:
    linha = db.query(HabilitadoAssembleia).filter(
        HabilitadoAssembleia.id_assembleia == id_assembleia, HabilitadoAssembleia.id_associado == id_associado
    ).first()
    return bool(linha and linha.habilitado)


def ja_votou(db: Session, votacao: Votacao, id_associado: int) -> bool:
    if votacao.tipo == SECRETA:
        return db.query(ComprovanteVotoSecreto).filter(
            ComprovanteVotoSecreto.id_votacao == votacao.id_votacao, ComprovanteVotoSecreto.id_associado == id_associado
        ).first() is not None
    return db.query(VotoAberto).filter(
        VotoAberto.id_votacao == votacao.id_votacao, VotoAberto.id_associado == id_associado
    ).first() is not None


def registrar_voto(db: Session, votacao: Votacao, id_associado: int, opcao: str) -> None:
    if votacao.tipo == SECRETA:
        # Duas linhas, em duas tabelas SEM coluna em comum - nada aqui liga uma à outra depois de
        # gravado (ver docstring de app/models/votacao.py).
        db.add(ComprovanteVotoSecreto(id_votacao=votacao.id_votacao, id_associado=id_associado))
        db.add(RegistroVotoSecreto(
            id_votacao=votacao.id_votacao, identificador_aleatorio=secrets.token_hex(16), opcao=opcao,
        ))
    else:
        db.add(VotoAberto(id_votacao=votacao.id_votacao, id_associado=id_associado, opcao=opcao))
    db.commit()


def _contagem_por_opcao(db: Session, votacao: Votacao) -> dict[str, int]:
    if votacao.tipo == SECRETA:
        linhas = db.query(RegistroVotoSecreto).filter(RegistroVotoSecreto.id_votacao == votacao.id_votacao).all()
    else:
        linhas = db.query(VotoAberto).filter(VotoAberto.id_votacao == votacao.id_votacao).all()
    contagem: dict[str, int] = {}
    for linha in linhas:
        contagem[linha.opcao] = contagem.get(linha.opcao, 0) + 1
    return contagem


def _hash_resultado(db: Session, votacao: Votacao) -> str:
    """SHA-256 do conjunto de votos - qualquer alteração de um voto depois do fechamento muda o
    hash. Em votação secreta, usa `identificador_aleatorio:opcao` (nunca `id_associado`, que nem
    existe na tabela); em votação aberta, `id_associado:opcao` (o vínculo é proposital ali)."""
    if votacao.tipo == SECRETA:
        linhas = db.query(RegistroVotoSecreto).filter(RegistroVotoSecreto.id_votacao == votacao.id_votacao).order_by(RegistroVotoSecreto.identificador_aleatorio).all()
        partes = [f"{linha.identificador_aleatorio}:{linha.opcao}" for linha in linhas]
    else:
        linhas = db.query(VotoAberto).filter(VotoAberto.id_votacao == votacao.id_votacao).order_by(VotoAberto.id_associado).all()
        partes = [f"{linha.id_associado}:{linha.opcao}" for linha in linhas]
    return hashlib.sha256("|".join(partes).encode("utf-8")).hexdigest()


def apurar_e_encerrar(db: Session, votacao: Votacao) -> Votacao:
    contagem = _contagem_por_opcao(db, votacao)
    votos_reservados = sum(contagem.get(o, 0) for o in OPCOES_RESERVADAS)
    votos_conteudo = {o: q for o, q in contagem.items() if o not in OPCOES_RESERVADAS}
    total_conteudo = sum(votos_conteudo.values())
    base_calculo = total_conteudo + votos_reservados if votacao.considerar_abstencao_na_base else total_conteudo

    vencedor, aprovado, empate = _resultado_escrutinio(votacao, votos_conteudo, base_calculo)

    votacao.resultado_contagem = json.dumps(contagem, ensure_ascii=False)
    votacao.resultado_hash = _hash_resultado(db, votacao)
    votacao.vencedor = vencedor
    votacao.aprovado = aprovado
    votacao.empate = empate
    votacao.status = ENCERRADA
    votacao.encerrada_em = datetime.utcnow()
    db.commit()
    db.refresh(votacao)
    return votacao


def _resultado_escrutinio(votacao: Votacao, votos_conteudo: dict[str, int], base_calculo: int):
    if not votos_conteudo or base_calculo == 0:
        return None, None, False

    maximo = max(votos_conteudo.values())
    vencedores = [o for o, q in votos_conteudo.items() if q == maximo]
    if len(vencedores) > 1:
        return None, None, True  # empate - resolvido por app.services.votacao.resolver_empate

    vencedor = vencedores[0]
    votos_vencedor = votos_conteudo[vencedor]

    if votacao.escrutinio == MAIORIA_SIMPLES:
        return vencedor, True, False
    if votacao.escrutinio == MAIORIA_ABSOLUTA:
        return vencedor, votos_vencedor > base_calculo / 2, False
    if votacao.escrutinio == QUALIFICADA:
        fracao_str = votacao.fracao_qualificada or "2/3"
        numerador, denominador = fracao_str.split("/")
        minimo = math.ceil(base_calculo * int(numerador) / int(denominador))
        return vencedor, votos_vencedor >= minimo, False
    return vencedor, None, False


def resolver_empate(db: Session, votacao: Votacao, vencedor: str, justificativa: str) -> Votacao:
    votacao.vencedor = vencedor
    votacao.aprovado = True
    votacao.empate = False
    db.commit()
    db.refresh(votacao)
    return votacao


def prazo_recurso_impugnacao(db: Session) -> datetime:
    dias = int(obter_regra_vigente(db, "PRAZO_RECURSO_IMPUGNACAO_DIAS", "5") or "5")
    return datetime.utcnow() + timedelta(days=dias)
