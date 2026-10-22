"""v6.1 (FASE 6) - comunicação interna no painel: o módulo Comunicação (quem tem `comunicar` publica, acompanha a leitura e retira) e o mural e a caixa de entrada de cada pessoa
(ver app/services/comunicacao.py)."""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.core import Usuario
from app.schemas.comunicacao import (
    AgendamentoCancelar,
    AvisoAgendar,
    AvisoConferirPublico,
    AvisoEnviarTeste,
    AvisoPreVisualizar,
    AvisoPublicar,
    AvisoRetirar,
    ModeloDeAvisoDados,
)
from app.security import exigir_permissao, get_current_user
from app.services import avisos_agendados, modelos_de_aviso
from app.services import comunicacao as servico

router = APIRouter()
_pode_comunicar = exigir_permissao(servico.PERMISSAO)


# ------------------------------------------------------------------------------------------------ o módulo Comunicação
@router.get("/api/avisos/opcoes-de-publico", summary="O que se pode escolher para montar o grupo de um aviso (situações, categorias, permissões, projetos)")
def opcoes_de_publico(db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_comunicar)):
    return servico.opcoes_de_publico(db, usuario)


@router.post("/api/avisos/conferir-publico", summary="Conferir quem receberia o aviso hoje: o total, quantos não têm acesso ao painel e quem são (não grava nada)")
def conferir_publico(dados: AvisoConferirPublico, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_comunicar)):
    return servico.conferir_publico(db, usuario, dados.publico.model_dump())


@router.post("/api/avisos/", summary="Publicar um aviso no mural do grupo, com o total de pessoas conferido antes")
def publicar(dados: AvisoPublicar, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_comunicar)):
    aviso = servico.publicar(
        db, usuario, titulo=dados.titulo, texto=dados.texto, categoria=dados.categoria, valido_ate=dados.valido_ate,
        exige_confirmacao=dados.exige_confirmacao, publico=dados.publico.model_dump(), total_confirmado=dados.total_confirmado, por_email=dados.por_email,
        id_modelo=dados.id_modelo,
    )
    return servico.detalhar(db, usuario, aviso.id_aviso)


@router.post("/api/avisos/pre-visualizar", summary="Ver o aviso como chega a uma pessoa real do grupo (as variáveis com o nome dela); não grava nada (v6.2c)")
def pre_visualizar(dados: AvisoPreVisualizar, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_comunicar)):
    return modelos_de_aviso.pre_visualizar(db, usuario, titulo=dados.titulo, texto=dados.texto, publico=dados.publico.model_dump() if dados.publico else None)


@router.post("/api/avisos/enviar-teste", summary="Mandar o aviso, ainda não publicado, só para o meu e-mail (v6.2c)")
def enviar_teste(dados: AvisoEnviarTeste, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_comunicar)):
    return modelos_de_aviso.enviar_teste(db, usuario, titulo=dados.titulo, texto=dados.texto, exige_confirmacao=dados.exige_confirmacao)


@router.post("/api/avisos-agendados/", summary="Agendar um aviso para publicar depois (data e hora), com o total de pessoas conferido antes (v6.2c)")
def agendar(dados: AvisoAgendar, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_comunicar)):
    return avisos_agendados.agendar(
        db, usuario, titulo=dados.titulo, texto=dados.texto, categoria=dados.categoria, valido_ate=dados.valido_ate, exige_confirmacao=dados.exige_confirmacao,
        por_email=dados.por_email, publico=dados.publico.model_dump(), total_confirmado=dados.total_confirmado, publicar_em=dados.publicar_em, id_modelo=dados.id_modelo,
    )


@router.get("/api/avisos-agendados/", summary="Os avisos agendados (situação: Agendado, Publicado ou Cancelado)")
def listar_agendados(situacao: Optional[str] = None, db: Session = Depends(get_db), _usuario: Usuario = Depends(_pode_comunicar)):
    return avisos_agendados.listar(db, situacao=situacao)


@router.post("/api/avisos-agendados/{id_agendado}/cancelar", summary="Cancelar um aviso agendado antes da hora, com o motivo")
def cancelar_agendado(id_agendado: int, dados: AgendamentoCancelar, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_comunicar)):
    return avisos_agendados.cancelar(db, usuario, id_agendado, dados.motivo)


@router.get("/api/modelos-de-aviso/", summary="Os modelos de aviso em uso (a versão mais nova de cada um)")
def listar_modelos(db: Session = Depends(get_db), _usuario: Usuario = Depends(_pode_comunicar)):
    return modelos_de_aviso.listar(db)


@router.post("/api/modelos-de-aviso/", summary="Criar um modelo de aviso")
def criar_modelo(dados: ModeloDeAvisoDados, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_comunicar)):
    return modelos_de_aviso.criar(db, usuario, dados.model_dump())


@router.put("/api/modelos-de-aviso/{id_modelo}", summary="Editar um modelo: cria uma versão nova (a anterior fica guardada)")
def editar_modelo(id_modelo: int, dados: ModeloDeAvisoDados, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_comunicar)):
    return modelos_de_aviso.editar(db, usuario, id_modelo, dados.model_dump())


@router.post("/api/modelos-de-aviso/{id_modelo}/arquivar", summary="Tirar o modelo de uso (as versões ficam guardadas)")
def arquivar_modelo(id_modelo: int, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_comunicar)):
    modelos_de_aviso.arquivar(db, usuario, id_modelo)
    return {"arquivado": True}


@router.get("/api/modelos-de-aviso/{id_modelo}/versoes", summary="Todas as versões de um modelo, da mais nova para a mais antiga")
def versoes_do_modelo(id_modelo: int, db: Session = Depends(get_db), _usuario: Usuario = Depends(_pode_comunicar)):
    return modelos_de_aviso.versoes(db, id_modelo)


@router.get("/api/avisos/", summary="Os avisos publicados, com os totais de leitura (situação: No mural, Vencido ou Retirado)")
def listar(
    situacao: Optional[str] = None,
    busca: Optional[str] = None,
    pagina: int = Query(1, ge=1),
    por_pagina: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    _usuario: Usuario = Depends(_pode_comunicar),
):
    return servico.listar(db, situacao_filtro=situacao, busca=busca, pagina=pagina, por_pagina=por_pagina)


@router.get("/api/avisos/{id_aviso}", summary="Um aviso e o relatório de leitura: quem recebeu, quem leu, quem confirmou e quem não tem acesso ao painel")
def detalhar(id_aviso: int, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_comunicar)):
    return servico.detalhar(db, usuario, id_aviso)


class IncluirNovos(BaseModel):
    total_confirmado: int = Field(ge=0)


@router.get("/api/avisos/{id_aviso}/novos", summary="Quantos entraram no grupo depois da publicação (a conferência antes de incluir)")
def contar_novos(id_aviso: int, db: Session = Depends(get_db), _usuario: Usuario = Depends(_pode_comunicar)):
    return servico.contar_novos(db, id_aviso)


@router.post("/api/avisos/{id_aviso}/incluir-novos", summary="Incluir quem entrou no grupo depois da publicação (ninguém sai), com a contagem conferida")
def incluir_novos(id_aviso: int, dados: IncluirNovos, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_comunicar)):
    incluidos = servico.incluir_novos(db, usuario, id_aviso, dados.total_confirmado)
    return {"incluidos": incluidos, "aviso": servico.detalhar(db, usuario, id_aviso)}


@router.post("/api/avisos/{id_aviso}/retirar", summary="Retirar o aviso do mural, com o motivo (continua no histórico de quem recebeu)")
def retirar(id_aviso: int, dados: AvisoRetirar, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_comunicar)):
    servico.retirar(db, usuario, id_aviso, dados.motivo)
    return servico.detalhar(db, usuario, id_aviso)


@router.post("/api/avisos/{id_aviso}/reenviar-emails", summary="Pôr de volta na fila os e-mails deste aviso que falharam (v6.2a)")
def reenviar_emails(id_aviso: int, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_comunicar)):
    voltaram = servico.reenviar_falhas(db, usuario, id_aviso)
    return {"voltaram_para_a_fila": voltaram, "aviso": servico.detalhar(db, usuario, id_aviso)}


# ------------------------------------------------------------------------------------------------ o mural e a caixa de entrada de cada pessoa
@router.get("/api/meus-avisos/", summary="Os meus avisos: todos (caixa de entrada) ou só os que estão no mural; os que pedem confirmação primeiro")
def meus_avisos(mural: bool = False, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    return servico.meus_avisos(db, usuario, so_mural=mural)


@router.get("/api/meus-avisos/{id_aviso}", summary="Abrir um aviso meu (grava a data da leitura na primeira vez)")
def abrir_meu(id_aviso: int, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    return servico.abrir_meu(db, usuario, id_aviso)


@router.post("/api/meus-avisos/{id_aviso}/confirmar", summary="Li e estou ciente: confirmar a leitura de um aviso que pede confirmação")
def confirmar_meu(id_aviso: int, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    return servico.confirmar_meu(db, usuario, id_aviso)
