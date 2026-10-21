"""v6.2c (FASE 6) - modelos de mensagem versionados, pré-visualização e envio de teste dos avisos do mural (ver app/models/comunicacao.py::ModeloDeAviso).

O que este módulo garante:
  - o modelo é VERSIONADO: editar cria uma versão nova (a anterior fica, desativada, e o aviso que a usou continua apontando para ela); arquivar tira o modelo da lista sem apagar;
  - título e texto do modelo passam pela mesma regra do aviso (título sem variável; texto só com {primeiro_nome} e {nome});
  - a pré-visualização mostra o texto como chega a UMA pessoa real do grupo (a primeira, em ordem de nome), sem gravar nada;
  - o envio de teste vai SÓ para o e-mail de quem está publicando, marcado "[TESTE]", com limite por hora, e vai para a Auditoria sem o endereço;
  - criar, editar, arquivar e enviar teste vão para a Auditoria."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.models.associados import Associado
from app.models.comunicacao import ModeloDeAviso
from app.models.core import Usuario
from app.services import comunicacao, notificacoes
from app.services.catalogos import validar_codigo_em_catalogo
from app.services.fuso import dia_e_hora_em_belem
from app.services.protecao_publica import limitar_taxa_por_ip

TAMANHO_DO_NOME = 100
TESTES_POR_HORA = 10


def _serializar(m: ModeloDeAviso) -> dict:
    return {
        "id_modelo": m.id_modelo, "grupo": m.grupo, "versao": m.versao, "nome": m.nome, "titulo": m.titulo, "texto": m.texto, "categoria": m.categoria,
        "exige_confirmacao": m.exige_confirmacao, "por_email": m.por_email, "ativo": m.ativo, "criado_em": m.criado_em,
    }


def _validar(db: Session, dados: dict) -> dict:
    nome = (dados.get("nome") or "").strip()
    if not nome or len(nome) > TAMANHO_DO_NOME:
        raise HTTPException(status_code=422, detail=f"O nome do modelo é obrigatório e tem até {TAMANHO_DO_NOME} letras.")
    titulo, texto = comunicacao.validar_texto_e_titulo(dados.get("titulo"), dados.get("texto"))
    validar_codigo_em_catalogo(db, comunicacao.CATALOGO_DE_CATEGORIA, dados.get("categoria") or "", "Categoria do aviso")
    return {
        "nome": nome, "titulo": titulo, "texto": texto, "categoria": dados["categoria"],
        "exige_confirmacao": bool(dados.get("exige_confirmacao")), "por_email": bool(dados.get("por_email")),
    }


def listar(db: Session) -> list[dict]:
    """A versão em uso de cada modelo (os arquivados não aparecem), em ordem de nome."""
    return [_serializar(m) for m in db.query(ModeloDeAviso).filter(ModeloDeAviso.ativo.is_(True)).order_by(func.lower(ModeloDeAviso.nome)).all()]


def versoes(db: Session, id_modelo: int) -> list[dict]:
    modelo = _obter(db, id_modelo)
    return [_serializar(m) for m in db.query(ModeloDeAviso).filter(ModeloDeAviso.grupo == modelo.grupo).order_by(ModeloDeAviso.versao.desc()).all()]


def _obter(db: Session, id_modelo: int) -> ModeloDeAviso:
    modelo = db.get(ModeloDeAviso, id_modelo)
    if modelo is None:
        raise HTTPException(status_code=404, detail="Modelo de aviso não encontrado.")
    return modelo


def criar(db: Session, usuario: Usuario, dados: dict) -> dict:
    limpo = _validar(db, dados)
    modelo = ModeloDeAviso(grupo=str(uuid.uuid4()), versao=1, ativo=True, id_usuario_autor=usuario.id_usuario, criado_em=datetime.utcnow(), **limpo)
    db.add(modelo)
    db.flush()
    registrar_auditoria(db, usuario, "modelos_de_aviso", "MODELO_DE_AVISO_CRIADO", id_registro_afetado=modelo.id_modelo, dados_depois={"nome": limpo["nome"]})
    db.refresh(modelo)
    return _serializar(modelo)


def editar(db: Session, usuario: Usuario, id_modelo: int, dados: dict) -> dict:
    """Uma versão NOVA no mesmo modelo; a anterior fica guardada (desativada)."""
    atual = _obter(db, id_modelo)
    if not atual.ativo:
        raise HTTPException(status_code=409, detail="Esta não é a versão em uso do modelo (ou ele foi arquivado): edite a versão mais nova.")
    limpo = _validar(db, dados)
    atual.ativo = False
    nova = ModeloDeAviso(grupo=atual.grupo, versao=atual.versao + 1, ativo=True, id_usuario_autor=usuario.id_usuario, criado_em=datetime.utcnow(), **limpo)
    db.add(nova)
    db.flush()
    registrar_auditoria(
        db, usuario, "modelos_de_aviso", "MODELO_DE_AVISO_NOVA_VERSAO", id_registro_afetado=nova.id_modelo,
        dados_antes={"id_modelo": atual.id_modelo, "versao": atual.versao}, dados_depois={"versao": nova.versao, "nome": limpo["nome"]},
    )
    db.refresh(nova)
    return _serializar(nova)


def arquivar(db: Session, usuario: Usuario, id_modelo: int) -> None:
    modelo = _obter(db, id_modelo)
    if not modelo.ativo:
        raise HTTPException(status_code=409, detail="Este modelo já não está em uso.")
    modelo.ativo = False
    registrar_auditoria(db, usuario, "modelos_de_aviso", "MODELO_DE_AVISO_ARQUIVADO", id_registro_afetado=id_modelo, dados_depois={"nome": modelo.nome})


# ------------------------------------------------------------------------------------------------ pré-visualização e teste
def pre_visualizar(db: Session, usuario: Usuario, *, titulo: str, texto: str, publico: Optional[dict]) -> dict:
    """Como o aviso chega a uma pessoa real do grupo (a primeira em ordem de nome). Sem grupo (ou grupo vazio), com o nome de quem está publicando. Não grava nada."""
    titulo, texto = comunicacao.validar_texto_e_titulo(titulo, texto)
    nome, de_quem = None, "você"
    if publico:
        destinos = comunicacao.resolver_publico(db, comunicacao.normalizar_publico(db, publico, usuario))
        if destinos:
            primeiro = destinos[0]
            de_quem = primeiro.nome
            associado = db.get(Associado, primeiro.id_associado) if primeiro.id_associado is not None else None
            # o mesmo nome que o painel e o e-mail usam: o do associado; login sem associado vê "associado(a)" (nunca o e-mail no lugar do nome)
            nome = associado.nome_completo if associado is not None else ""
            if associado is None:
                de_quem = f"{primeiro.nome} (sem cadastro de associado)"
    if nome is None:
        associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
        nome = associado.nome_completo if associado is not None else None
    return {"para": de_quem, "titulo": titulo, "texto": comunicacao.personalizar(texto, nome)}


def enviar_teste(db: Session, usuario: Usuario, *, titulo: str, texto: str, exige_confirmacao: bool) -> dict:
    """O aviso, ainda NÃO publicado, só para o e-mail de quem está publicando (o de contato do cadastro; sem ele, o do login)."""
    titulo, texto = comunicacao.validar_texto_e_titulo(titulo, texto)
    if not notificacoes.smtp_configurado():
        raise HTTPException(status_code=409, detail="Este ambiente não tem servidor de e-mail: o envio de teste não sai daqui.")
    limitar_taxa_por_ip(db, ip=f"usuario:{usuario.id_usuario}", rota="aviso-envio-de-teste", limite=TESTES_POR_HORA, janela_minutos=60)
    associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
    endereco, _ = comunicacao.email_de(associado.pessoa.email_contato if associado is not None and associado.pessoa else None, usuario.email)
    if endereco is None:
        raise HTTPException(status_code=409, detail="Não há e-mail no seu cadastro nem no seu login para mandar o teste.")
    nome = associado.nome_completo if associado is not None else None
    partes = [
        "ENVIO DE TESTE: este aviso ainda NÃO foi publicado. É assim que ele chega por e-mail (com o seu nome no lugar das variáveis).",
        "", comunicacao.personalizar(texto, nome), "", "—",
        f"Teste pedido em {dia_e_hora_em_belem(datetime.utcnow())} (horário de Belém) no painel da ASAF.",
    ]
    if exige_confirmacao:
        partes.append("No aviso de verdade, aqui vem o link para abrir o aviso no painel e confirmar que leu.")
    try:
        notificacoes.enviar_email(endereco, f"[TESTE] ASAF: {titulo}"[:200], "\n".join(partes))
    except Exception as erro:  # noqa: BLE001 - quem pediu precisa saber que não saiu
        raise HTTPException(status_code=502, detail="O servidor de e-mail não aceitou o teste agora. Tente de novo em alguns minutos.") from erro
    registrar_auditoria(db, usuario, "avisos", "AVISO_EMAIL_DE_TESTE", dados_depois={"titulo": titulo})
    return {"enviado_para": endereco}
