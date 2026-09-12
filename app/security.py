"""Autenticação (senha, JWT) e autorização (permissão por nível) - v0.1 do plano.

Fica separado de app/utils.py (que é só formatação/HTML) porque isso é código de
segurança - merece estar isolado e fácil de auditar sozinho.
"""
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.core import NivelAcesso, PermissaoSistema, TokenAcesso, Usuario, CodigoRecuperacaoMFA, perfil_permissao

# JWT_SECRET vem do ambiente (Key Vault -> Container App em produção), igual DATABASE_URL.
# Nunca hardcoded - se não estiver configurado, falha alto (nunca assina token com segredo
# adivinhável).
JWT_SECRET = os.environ.get("JWT_SECRET")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTOS = 45
REFRESH_TOKEN_DIAS = 30
MAX_TENTATIVAS_LOGIN = 5
BLOQUEIO_MINUTOS = 15

# Cookie do refresh token (v0.2.1a): HttpOnly + SameSite=Strict + Secure (em produção).
# Secure pode ser desligado via COOKIE_SECURE=false apenas para dev local via HTTP (localhost) —
# um cookie Secure não é gravado pelo navegador em conexão HTTP sem TLS.
REFRESH_COOKIE_NAME = "asaf_refresh"
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").lower() != "false"

_bearer_scheme = HTTPBearer(auto_error=False)


def _checar_jwt_secret_configurado():
    if not JWT_SECRET:
        # Erro de configuração do ambiente, não do usuário - 500, não 401.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="JWT_SECRET não configurado no ambiente do servidor.",
        )


# ==========================================
# SENHA (bcrypt - nunca hash rápido tipo sha256/md5)
# ==========================================
def hash_senha(senha_pura: str) -> str:
    return bcrypt.hashpw(senha_pura.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verificar_senha(senha_pura: str, hash_armazenado: str) -> bool:
    try:
        return bcrypt.checkpw(senha_pura.encode("utf-8"), hash_armazenado.encode("utf-8"))
    except ValueError:
        # hash_armazenado em formato inválido/antigo (ex.: sha256 legado) - trata como senha errada,
        # nunca deixa passar.
        return False


# ==========================================
# CÓDIGOS DE RECUPERAÇÃO DE MFA (v0.2.2d)
# ==========================================
def _normalizar_codigo_recuperacao(codigo: str) -> str:
    """Aceita o código com ou sem hífens/espaços e em qualquer caixa."""
    return "".join(ch for ch in codigo.upper() if ch.isalnum())


def gerar_codigos_recuperacao(db: Session, usuario: Usuario, quantidade: int = 10) -> list[str]:
    """Gera N códigos de uso único, grava apenas o hash bcrypt de cada um e devolve os valores
    em texto puro UMA única vez (quem chama é responsável por exibi-los e nunca mais guardá-los)."""
    revogar_codigos_recuperacao(db, usuario)
    codigos = ["-".join(secrets.token_hex(2).upper() for _ in range(3)) for _ in range(quantidade)]
    for codigo in codigos:
        db.add(CodigoRecuperacaoMFA(
            id_usuario=usuario.id_usuario,
            codigo_hash=hash_senha(_normalizar_codigo_recuperacao(codigo)),
        ))
    db.commit()
    return codigos


def verificar_codigo_recuperacao(db: Session, usuario: Usuario, codigo_informado: str) -> bool:
    """Confere o código contra os hashes pendentes do usuário e, se bater, queima (marca usado)."""
    normalizado = _normalizar_codigo_recuperacao(codigo_informado)
    if not normalizado:
        return False
    pendentes = (
        db.query(CodigoRecuperacaoMFA)
        .filter(CodigoRecuperacaoMFA.id_usuario == usuario.id_usuario, CodigoRecuperacaoMFA.usado == False)
        .all()
    )
    for registro in pendentes:
        if verificar_senha(normalizado, registro.codigo_hash):
            registro.usado = True
            db.commit()
            return True
    return False


def revogar_codigos_recuperacao(db: Session, usuario: Usuario):
    """Apaga todos os códigos de recuperação do usuário (reset de MFA e regeração)."""
    db.query(CodigoRecuperacaoMFA).filter(CodigoRecuperacaoMFA.id_usuario == usuario.id_usuario).delete()
    db.commit()


# ==========================================
# BLOQUEIO POR FORÇA BRUTA (guardado no banco, não em memória do processo -
# funciona igual mesmo com várias réplicas do Container App)
# ==========================================
def usuario_esta_bloqueado(usuario: Usuario) -> bool:
    if usuario.bloqueado_ate is None:
        return False
    return datetime.utcnow() < usuario.bloqueado_ate


def registrar_tentativa_falha(db: Session, usuario: Usuario):
    usuario.tentativas_falhas = (usuario.tentativas_falhas or 0) + 1
    if usuario.tentativas_falhas >= MAX_TENTATIVAS_LOGIN:
        usuario.bloqueado_ate = datetime.utcnow() + timedelta(minutes=BLOQUEIO_MINUTOS)
    db.commit()


def limpar_tentativas_falhas(db: Session, usuario: Usuario):
    usuario.tentativas_falhas = 0
    usuario.bloqueado_ate = None
    db.commit()


# ==========================================
# JWT (access token stateless + refresh token opaco guardado em TokenAcesso)
# ==========================================
def criar_access_token(usuario: Usuario) -> str:
    _checar_jwt_secret_configurado()
    agora = datetime.now(timezone.utc)
    payload = {
        "id_usuario": usuario.id_usuario,
        "id_nivel": usuario.id_nivel,
        "iat": agora,
        "exp": agora + timedelta(minutes=ACCESS_TOKEN_MINUTOS),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def criar_mfa_pending_token(usuario: Usuario) -> str:
    """Token de vida curta (5 min) emitido no 1º passo do login quando MFA está ativado -
    permite o 2º passo (/auth/login/mfa) sem reenviar a senha, sem liberar acesso real."""
    _checar_jwt_secret_configurado()
    agora = datetime.now(timezone.utc)
    payload = {
        "id_usuario": usuario.id_usuario,
        "iat": agora,
        "exp": agora + timedelta(minutes=5),
        "type": "mfa_pending",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decodificar_mfa_pending_token(token: str) -> dict:
    _checar_jwt_secret_configurado()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token de MFA inválido ou expirado.")
    if payload.get("type") != "mfa_pending":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token de MFA inválido.")
    return payload


def criar_refresh_token(db: Session, usuario: Usuario) -> str:
    token = secrets.token_urlsafe(48)
    db.add(
        TokenAcesso(
            id_usuario=usuario.id_usuario,
            token=token,
            data_expiracao=datetime.utcnow() + timedelta(days=REFRESH_TOKEN_DIAS),
        )
    )
    db.commit()
    return token


def validar_refresh_token(db: Session, token: str) -> Usuario:
    registro = db.query(TokenAcesso).filter(TokenAcesso.token == token).first()
    if registro is None or registro.data_expiracao < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token inválido ou expirado.")
    usuario = db.query(Usuario).filter(Usuario.id_usuario == registro.id_usuario).first()
    if usuario is None or not usuario.ativo:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuário inválido ou inativo.")
    return usuario


def revogar_refresh_token(db: Session, token: str):
    db.query(TokenAcesso).filter(TokenAcesso.token == token).delete()
    db.commit()


def decodificar_access_token(token: str) -> dict:
    _checar_jwt_secret_configurado()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão expirada.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido.")
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido.")
    return payload


def get_current_user(
    credenciais: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> Usuario:
    if credenciais is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Não autenticado.")
    payload = decodificar_access_token(credenciais.credentials)
    usuario = db.query(Usuario).filter(Usuario.id_usuario == payload["id_usuario"]).first()
    if usuario is None or not usuario.ativo:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuário inválido ou inativo.")
    return usuario


# ==========================================
# AUTORIZAÇÃO (permissão por nível de acesso)
# ==========================================
def usuario_tem_permissao(db: Session, usuario: Usuario, codigo_permissao: str) -> bool:
    if usuario.id_nivel is None:
        return False
    existe = (
        db.query(PermissaoSistema)
        .join(perfil_permissao, perfil_permissao.c.id_permissao == PermissaoSistema.id_permissao)
        .filter(
            perfil_permissao.c.id_nivel == usuario.id_nivel,
            PermissaoSistema.codigo_permissao == codigo_permissao,
        )
        .first()
    )
    return existe is not None


def exigir_permissao(codigo_permissao: str):
    """Dependency factory - use como Depends(exigir_permissao("financeiro"))."""

    def _checar(
        usuario: Usuario = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> Usuario:
        if not usuario_tem_permissao(db, usuario, codigo_permissao):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Sem permissão '{codigo_permissao}'.",
            )
        return usuario

    return _checar
