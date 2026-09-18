"""v1.6 (FASE 1) - regras de negócio do voluntariado: termo vigente, menoridade, encerramento
automático do termo anterior na renovação."""
from datetime import date, datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.pessoas import Papel, Pessoa
from app.models.voluntariado import RegistroHorasVoluntariado, TermoAdesaoVoluntario


def pessoa_e_menor_de_idade(data_nascimento: Optional[date], na_data: date) -> bool:
    if data_nascimento is None:
        # Sem data de nascimento cadastrada não dá pra confirmar maioridade - trata como
        # potencialmente menor (mais restritivo é mais seguro aqui do que assumir adulto sem
        # provar), exigindo a autorização até o cadastro ser completado.
        return True
    idade = na_data.year - data_nascimento.year - (
        (na_data.month, na_data.day) < (data_nascimento.month, data_nascimento.day)
    )
    return idade < 18


def termo_vigente(db: Session, id_pessoa: int) -> Optional[TermoAdesaoVoluntario]:
    """O termo mais recente marcado `ativo` só conta como vigente se a data de fim ainda não
    passou - um termo vencido e nunca desativado manualmente não deve autorizar nada."""
    termo = (
        db.query(TermoAdesaoVoluntario)
        .filter(TermoAdesaoVoluntario.id_pessoa == id_pessoa, TermoAdesaoVoluntario.ativo == True)
        .order_by(TermoAdesaoVoluntario.criado_em.desc())
        .first()
    )
    if termo and termo.data_fim_vigencia.date() >= datetime.utcnow().date():
        return termo
    return None


def criar_termo_adesao(
    db: Session,
    pessoa: Pessoa,
    atividade: str,
    carga_horaria_semanal: float,
    data_inicio: datetime,
    data_fim_vigencia: datetime,
    local: Optional[str] = None,
    documento_referencia: Optional[str] = None,
    autorizacao_responsavel_referencia: Optional[str] = None,
    id_usuario_registrou: Optional[int] = None,
) -> TermoAdesaoVoluntario:
    if pessoa_e_menor_de_idade(pessoa.data_nascimento.date() if pessoa.data_nascimento else None, data_inicio.date()):
        if not autorizacao_responsavel_referencia:
            raise HTTPException(
                status_code=422,
                detail="Voluntário menor de idade exige autorização de responsável anexada.",
            )

    # Renovação: encerra o termo ATIVO anterior (mesmo se já tiver vencido - "vigente" filtra
    # por data também, mas aqui o que importa é achar o último termo marcado ativo pra
    # incrementar a versão certa) antes de criar o novo - nunca dois termos ativos ao mesmo
    # tempo para a mesma pessoa.
    anterior = (
        db.query(TermoAdesaoVoluntario)
        .filter(TermoAdesaoVoluntario.id_pessoa == pessoa.id_pessoa, TermoAdesaoVoluntario.ativo == True)
        .order_by(TermoAdesaoVoluntario.criado_em.desc())
        .first()
    )
    proxima_versao = 1
    if anterior:
        anterior.ativo = False
        proxima_versao = anterior.versao + 1

    novo = TermoAdesaoVoluntario(
        id_pessoa=pessoa.id_pessoa, atividade=atividade, carga_horaria_semanal=carga_horaria_semanal,
        local=local, data_inicio=data_inicio, data_fim_vigencia=data_fim_vigencia,
        documento_referencia=documento_referencia,
        autorizacao_responsavel_referencia=autorizacao_responsavel_referencia,
        versao=proxima_versao, id_usuario_registrou=id_usuario_registrou,
    )
    db.add(novo)

    # Toda pessoa com termo de adesão ganha o papel "voluntario" marcado (mesma regra de
    # Associado/Papel desde a v1.0) - reativa se já existia e tinha sido desativado.
    papel = db.query(Papel).filter(Papel.id_pessoa == pessoa.id_pessoa, Papel.tipo_papel == "voluntario").first()
    if papel:
        papel.ativo = True
    else:
        db.add(Papel(id_pessoa=pessoa.id_pessoa, tipo_papel="voluntario"))

    db.commit()
    db.refresh(novo)
    return novo


# ==========================================
# HABILIDADES (v4.4) - CSV de códigos do catálogo `habilidade_voluntario`, mesmo padrão de
# `Votacao.opcoes_validas` - comparação é sempre informativa, nunca trava a candidatura (só o
# termo de adesão vigente é trava real, ver `criar_alocacao_por_candidatura` em
# app/services/projetos.py).
# ==========================================
def habilidades_csv_para_lista(csv: Optional[str]) -> list[str]:
    if not csv:
        return []
    return [c.strip() for c in csv.split(",") if c.strip()]


def comparar_habilidades(habilidades_exigidas: Optional[str], habilidades_pessoa: Optional[str]) -> dict:
    exigidas = set(habilidades_csv_para_lista(habilidades_exigidas))
    da_pessoa = set(habilidades_csv_para_lista(habilidades_pessoa))
    return {
        "atendidas": sorted(exigidas & da_pessoa),
        "faltantes": sorted(exigidas - da_pessoa),
    }


# ==========================================
# REGISTRO DE HORAS (v1.6, aprovação do coordenador desde a v4.4)
# ==========================================
def registrar_horas_voluntariado(
    db: Session, *, id_pessoa: int, data: datetime, horas: float, descricao_atividade: Optional[str],
    id_projeto: Optional[int], id_alocacao: Optional[int], id_usuario: Optional[int],
) -> RegistroHorasVoluntariado:
    termo = termo_vigente(db, id_pessoa)
    if not termo:
        raise HTTPException(
            status_code=400,
            detail="Pessoa sem termo de adesão de voluntário vigente - registre o termo antes de lançar horas.",
        )
    # Horas amarradas a uma alocação de projeto nascem PENDENTES - só contam (soma de horas
    # realizadas, futuro certificado/score) depois que o coordenador aprova. Horas soltas (sem
    # projeto, fluxo antigo da v1.6) nascem já aprovadas, porque não existe coordenador nenhum
    # daquele contexto pra aprovar.
    status_inicial = "PENDENTE" if id_alocacao is not None else "APROVADO"
    registro = RegistroHorasVoluntariado(
        id_termo=termo.id_termo, data=data, horas=horas, descricao_atividade=descricao_atividade,
        id_projeto=id_projeto, id_alocacao=id_alocacao, status=status_inicial,
        id_usuario_registrou=id_usuario,
    )
    db.add(registro)
    db.commit()
    db.refresh(registro)
    return registro
