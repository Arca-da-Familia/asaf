"""v6.2b (FASE 6) - preferências de contato: a página pública do link "não quero mais receber" e o Meu Perfil do painel (ver app/services/preferencias_de_comunicacao.py)."""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.core import Usuario
from app.security import get_current_user
from app.services import preferencias_de_comunicacao as servico
from app.services.protecao_publica import ip_publico, limitar_taxa_por_ip

router = APIRouter()

# o link vem do e-mail da própria pessoa; o limite segura quem tenta adivinhar links (a assinatura já não deixa, mas não precisa de tentativa sem fim)
LIMITE_DE_LEITURAS, LIMITE_DE_MUDANCAS, JANELA_MINUTOS = 30, 10, 10


class MudarPeloLink(BaseModel):
    token: str
    recebe: bool


class MudarNoPainel(BaseModel):
    tipo: str
    recebe: bool


@router.get("/api/publico/descadastro", summary="O tipo de e-mail que um link de descadastro controla, e se a pessoa recebe (público, sem dado pessoal)")
def ler_pelo_link(token: str, request: Request, db: Session = Depends(get_db)):
    limitar_taxa_por_ip(db, ip=ip_publico(request), rota="descadastro-ler", limite=LIMITE_DE_LEITURAS, janela_minutos=JANELA_MINUTOS)
    return servico.resumo_publico(db, token)


@router.post("/api/publico/descadastro", summary="Parar (ou voltar) de receber um tipo de e-mail pelo link do próprio e-mail (público)")
def mudar_pelo_link(dados: MudarPeloLink, request: Request, db: Session = Depends(get_db)):
    ip = ip_publico(request)
    limitar_taxa_por_ip(db, ip=ip, rota="descadastro-mudar", limite=LIMITE_DE_MUDANCAS, janela_minutos=JANELA_MINUTOS)
    return servico.mudar_pelo_link(db, dados.token, dados.recebe, ip)


@router.get("/api/minhas-preferencias-de-comunicacao/", summary="Os e-mails que eu recebo da ASAF e os que desliguei")
def minhas(db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    return servico.minhas(db, usuario)


@router.put("/api/minhas-preferencias-de-comunicacao/", summary="Ligar ou desligar um tipo de e-mail não obrigatório")
def mudar(dados: MudarNoPainel, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    return servico.mudar_no_painel(db, usuario, dados.tipo, dados.recebe)
