"""Esqueci a minha senha (pedido do Presidente em 21/10): pedir o código por e-mail e trocar a senha com ele, sem login (ver app/services/esqueci_a_senha.py). As duas rotas são abertas e
têm limite por IP; a resposta ao pedido é a mesma, no conteúdo e no tempo, exista ou não uma conta com o CPF."""
from fastapi import APIRouter, BackgroundTasks, Depends, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.esqueci_a_senha import PedirCodigoDeNovaSenha, TrocarSenhaPeloCodigo
from app.services import conta_de_visitante, notificacoes
from app.services import esqueci_a_senha as servico
from app.services.protecao_publica import ip_publico as _ip_publico

router = APIRouter()


@router.post("/auth/senha/esqueci", summary="Pedir o código para trocar a senha do painel por e-mail (público - a resposta é a mesma exista ou não uma conta com o CPF)")
def pedir_codigo(dados: PedirCodigoDeNovaSenha, request: Request, tarefas: BackgroundTasks, db: Session = Depends(get_db)):
    resposta = {"mensagem": servico.MENSAGEM_DO_PEDIDO, "minutos_de_validade": servico.MINUTOS_DE_VALIDADE_DO_CODIGO}
    cpf = servico.limitar_pedido(db, cpf=dados.cpf, ip=_ip_publico(request))
    if conta_de_visitante.codigo_de_teste_na_resposta():
        # só na homologação (sem servidor de e-mail e com a chave que só ela define), para o robô provar o caminho; e só para conta fora do cofre e sem nenhuma permissão do
        # sistema: os CPFs das contas de teste do cofre estão no repositório, e o código delas na resposta deixaria qualquer um trocar a senha do Presidente de teste
        gerado = servico.gerar_codigo(db, cpf=cpf)
        if gerado is not None and servico.pode_mostrar_o_codigo_de_teste(db, gerado[2]):
            resposta["codigo_de_teste"] = gerado[0]
        return resposta
    # procurar a conta, gerar o código e mandar o e-mail vão para DEPOIS da resposta: nem o conteúdo nem o tempo dela mostram a quem está de fora que o CPF tem conta
    tarefas.add_task(servico.gerar_e_enviar, cpf)
    return resposta


@router.post("/auth/senha/trocar-com-codigo", summary="Trocar a senha do painel com o código recebido por e-mail (público)")
def trocar_com_codigo(dados: TrocarSenhaPeloCodigo, request: Request, tarefas: BackgroundTasks, db: Session = Depends(get_db)):
    _usuario, email = servico.trocar_senha(db, cpf=dados.cpf, codigo=dados.codigo, senha_nova=dados.senha_nova, ip=_ip_publico(request))
    if email and notificacoes.smtp_configurado():
        tarefas.add_task(servico.avisar_a_troca, email)
    return {"mensagem": "Senha trocada. Entre com o seu CPF e a senha nova."}
