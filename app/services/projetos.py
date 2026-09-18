"""v4.1 (FASE 4) - Projeto como entidade única e configurável. Reaproveita os motores
compartilhados (v4.0) para indicador e o `Orcamento`/`realizado_do_orcamento` (v3.5) para
execução financeira - nunca um mecanismo próprio de indicador/orçamento duplicado aqui."""
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.financeiro import CentroDeCusto
from app.models.projetos import STATUS_ATRASADO, STATUS_CONCLUIDO, STATUS_PENDENTE, EquipeProjeto, ItemCronograma, ProjetoEvento, RelatorioFinalProjeto
from app.services import indicadores as servico_indicadores
from app.services import orcamento as servico_orcamento
from app.services.catalogos import validar_codigo_em_catalogo
from app.services.voluntariado import termo_vigente

CONTEXTO_PROJETO = "Projeto"


def criar_projeto(
    db: Session, *, nome_projeto: str, tipo_foco: str, necessita_alvara_bombeiros: bool,
    data_inicio: datetime, data_fim_prevista: datetime, descricao: Optional[str], tipo_projeto: Optional[str],
    id_associado_responsavel: Optional[int], publico_alvo: Optional[str], id_centro_custo: Optional[int],
    visibilidade: str, id_usuario: Optional[int],
) -> ProjetoEvento:
    if tipo_projeto is not None:
        validar_codigo_em_catalogo(db, "tipo_projeto", tipo_projeto, "Tipo de projeto")
    if id_associado_responsavel is not None and not db.query(Associado).filter(Associado.id_associado == id_associado_responsavel).first():
        raise HTTPException(status_code=404, detail="Associado responsável não encontrado.")
    if id_centro_custo is not None and not db.query(CentroDeCusto).filter(CentroDeCusto.id_centro_custo == id_centro_custo).first():
        raise HTTPException(status_code=404, detail="Centro de custo não encontrado.")

    projeto = ProjetoEvento(
        nome_projeto=nome_projeto, tipo_foco=tipo_foco, necessita_alvara_bombeiros=necessita_alvara_bombeiros,
        data_inicio=data_inicio, data_fim_prevista=data_fim_prevista, descricao=descricao, tipo_projeto=tipo_projeto,
        status="PLANEJAMENTO", id_associado_responsavel=id_associado_responsavel,
        publico_alvo=publico_alvo, id_centro_custo=id_centro_custo, visibilidade=visibilidade, id_usuario_criacao=id_usuario,
    )
    if projeto.necessita_alvara_bombeiros:
        projeto.status_liberacao = "Pendente de Vistoria"
    db.add(projeto)
    db.commit()
    db.refresh(projeto)
    return projeto


def alterar_status_projeto(db: Session, *, id_projeto: int, novo_status: str) -> ProjetoEvento:
    validar_codigo_em_catalogo(db, "status_projeto", novo_status, "Status do projeto")
    projeto = db.query(ProjetoEvento).filter(ProjetoEvento.id_projeto == id_projeto).first()
    if not projeto:
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    projeto.status = novo_status
    db.commit()
    db.refresh(projeto)
    return projeto


def listar_projetos(db: Session) -> list[ProjetoEvento]:
    return db.query(ProjetoEvento).order_by(ProjetoEvento.criado_em.desc()).all()


def obter_projeto(db: Session, id_projeto: int) -> ProjetoEvento:
    projeto = db.query(ProjetoEvento).filter(ProjetoEvento.id_projeto == id_projeto).first()
    if not projeto:
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    return projeto


def alocar_voluntario(db: Session, *, id_projeto: int, id_associado: int, funcao_desempenhada: str):
    from app.models.projetos import AlocacaoVoluntario

    if not db.query(ProjetoEvento).filter(ProjetoEvento.id_projeto == id_projeto).first():
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    if not termo_vigente(db, associado.id_pessoa):
        raise HTTPException(status_code=403, detail="Voluntário sem termo de adesão vigente - não pode ser alocado em projeto.")

    alocacao = AlocacaoVoluntario(id_projeto=id_projeto, id_associado=id_associado, funcao_desempenhada=funcao_desempenhada)
    db.add(alocacao)
    db.commit()
    db.refresh(alocacao)
    return alocacao


# ==========================================
# CRONOGRAMA (status sempre derivado, nunca escolhido à mão)
# ==========================================
def status_item_cronograma(item: ItemCronograma) -> str:
    if item.concluido_em is not None:
        return STATUS_CONCLUIDO
    if item.prazo < datetime.utcnow():
        return STATUS_ATRASADO
    return STATUS_PENDENTE


def criar_item_cronograma(db: Session, *, id_projeto: int, tipo: str, titulo: str, prazo: datetime, id_associado_responsavel: Optional[int], id_usuario: Optional[int]) -> ItemCronograma:
    if not db.query(ProjetoEvento).filter(ProjetoEvento.id_projeto == id_projeto).first():
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    if id_associado_responsavel is not None and not db.query(Associado).filter(Associado.id_associado == id_associado_responsavel).first():
        raise HTTPException(status_code=404, detail="Associado responsável não encontrado.")

    item = ItemCronograma(
        id_projeto=id_projeto, tipo=tipo, titulo=titulo, prazo=prazo,
        id_associado_responsavel=id_associado_responsavel, id_usuario_criacao=id_usuario,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def concluir_item_cronograma(db: Session, *, id_item: int) -> ItemCronograma:
    item = db.query(ItemCronograma).filter(ItemCronograma.id_item == id_item).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item de cronograma não encontrado.")
    if item.concluido_em is not None:
        raise HTTPException(status_code=400, detail="Este item já está concluído.")
    item.concluido_em = datetime.utcnow()
    db.commit()
    db.refresh(item)
    return item


def listar_cronograma(db: Session, *, id_projeto: int) -> list[dict]:
    itens = db.query(ItemCronograma).filter(ItemCronograma.id_projeto == id_projeto).order_by(ItemCronograma.prazo).all()
    return [
        {
            "id_item": i.id_item, "tipo": i.tipo, "titulo": i.titulo, "prazo": i.prazo,
            "id_associado_responsavel": i.id_associado_responsavel, "concluido_em": i.concluido_em,
            "status": status_item_cronograma(i),
        }
        for i in itens
    ]


# ==========================================
# EQUIPE DO PROJETO
# ==========================================
def adicionar_membro_equipe(db: Session, *, id_projeto: int, id_associado: int, papel: str) -> EquipeProjeto:
    if not db.query(ProjetoEvento).filter(ProjetoEvento.id_projeto == id_projeto).first():
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    if not db.query(Associado).filter(Associado.id_associado == id_associado).first():
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    validar_codigo_em_catalogo(db, "papel_equipe_projeto", papel, "Papel na equipe")

    ja_ativo = db.query(EquipeProjeto).filter(
        EquipeProjeto.id_projeto == id_projeto, EquipeProjeto.id_associado == id_associado, EquipeProjeto.data_fim.is_(None),
    ).first()
    if ja_ativo:
        raise HTTPException(status_code=400, detail="Este associado já está ativo na equipe deste projeto.")

    membro = EquipeProjeto(id_projeto=id_projeto, id_associado=id_associado, papel=papel)
    db.add(membro)
    db.commit()
    db.refresh(membro)
    return membro


def encerrar_participacao_equipe(db: Session, *, id_membro: int) -> EquipeProjeto:
    membro = db.query(EquipeProjeto).filter(EquipeProjeto.id_membro == id_membro).first()
    if not membro:
        raise HTTPException(status_code=404, detail="Participação na equipe não encontrada.")
    if membro.data_fim is not None:
        raise HTTPException(status_code=400, detail="Esta participação já foi encerrada.")
    membro.data_fim = datetime.utcnow()
    db.commit()
    db.refresh(membro)
    return membro


def eh_coordenador_do_projeto(db: Session, *, id_associado: int, id_projeto: int) -> bool:
    return db.query(EquipeProjeto).filter(
        EquipeProjeto.id_projeto == id_projeto, EquipeProjeto.id_associado == id_associado,
        EquipeProjeto.papel == "COORDENADOR", EquipeProjeto.data_fim.is_(None),
    ).first() is not None


def listar_equipe(db: Session, *, id_projeto: int) -> list[EquipeProjeto]:
    return db.query(EquipeProjeto).filter(EquipeProjeto.id_projeto == id_projeto).order_by(EquipeProjeto.data_inicio).all()


# ==========================================
# ENCERRAMENTO FORMAL (relatório final versionado)
# ==========================================
def _gerar_texto_relatorio_final(db: Session, projeto: ProjetoEvento) -> str:
    linhas = [f"RELATÓRIO FINAL — {projeto.nome_projeto}", "", f"Status: {projeto.status}", ""]

    linhas.append("1. INDICADORES (resultados x metas)")
    lista_indicadores = servico_indicadores.listar_indicadores(db, contexto_tipo=CONTEXTO_PROJETO, id_contexto=projeto.id_projeto)
    if not lista_indicadores:
        linhas.append("   Nenhum indicador cadastrado para este projeto.")
    for indicador in lista_indicadores:
        medicoes = servico_indicadores.listar_medicoes(db, id_indicador=indicador.id_indicador)
        ultima = medicoes[-1] if medicoes else None
        meta_txt = f"{indicador.meta} {indicador.unidade}" if indicador.meta is not None else "sem meta definida"
        realizado_txt = f"{ultima.valor} {indicador.unidade} (período {ultima.periodo})" if ultima else "sem medição registrada"
        linhas.append(f"   {indicador.nome}: meta {meta_txt} — realizado {realizado_txt}")

    linhas += ["", "2. PÚBLICO ATENDIDO"]
    linhas.append("   Pendência registrada: motor de beneficiários (v4.2) ainda não existe - este relatório não afirma um número que não tem base em dado real.")

    linhas += ["", "3. EXECUÇÃO FINANCEIRA"]
    if projeto.id_centro_custo is None:
        linhas.append("   Projeto sem centro de custo vinculado - sem execução financeira a reportar.")
    else:
        ano_atual = datetime.utcnow().year
        orcamentos = [o for o in servico_orcamento.listar_orcamentos(db, ano=ano_atual) if o["id_centro_custo"] == projeto.id_centro_custo]
        if not orcamentos:
            linhas.append(f"   Nenhum orçamento ({ano_atual}) cadastrado para o centro de custo deste projeto.")
        for o in orcamentos:
            linhas.append(f"   Previsto R$ {o['valor_previsto']:.2f} — Realizado R$ {o['realizado']:.2f} ({'estourado' if o['estourado'] else 'dentro do previsto'})")

    linhas += ["", "4. CRONOGRAMA"]
    cronograma = listar_cronograma(db, id_projeto=projeto.id_projeto)
    if not cronograma:
        linhas.append("   Nenhum item de cronograma cadastrado.")
    for item in cronograma:
        linhas.append(f"   [{item['status']}] {item['tipo']}: {item['titulo']} (prazo {item['prazo'].date().isoformat()})")

    return "\n".join(linhas)


def gerar_relatorio_final(db: Session, *, id_projeto: int, id_usuario: Optional[int]) -> RelatorioFinalProjeto:
    projeto = obter_projeto(db, id_projeto)
    conteudo = _gerar_texto_relatorio_final(db, projeto)

    ultima_versao = db.query(func.max(RelatorioFinalProjeto.versao)).filter(RelatorioFinalProjeto.id_projeto == id_projeto).scalar() or 0
    relatorio = RelatorioFinalProjeto(id_projeto=id_projeto, versao=ultima_versao + 1, conteudo=conteudo, id_usuario_geracao=id_usuario)
    db.add(relatorio)
    db.commit()
    db.refresh(relatorio)
    return relatorio


def listar_relatorios_finais(db: Session, *, id_projeto: int) -> list[RelatorioFinalProjeto]:
    return db.query(RelatorioFinalProjeto).filter(RelatorioFinalProjeto.id_projeto == id_projeto).order_by(RelatorioFinalProjeto.versao.desc()).all()
