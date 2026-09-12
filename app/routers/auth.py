import pyotp
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.associados import Associado
from app.models.core import NivelAcesso, PermissaoSistema, Usuario, perfil_permissao
from app.schemas.auth import (
    BootstrapAdminRequest,
    LoginMFARequest,
    LoginRequest,
    LogoutRequest,
    MeResponse,
    MFAAtivarResponse,
    MFAConfirmarRequest,
    RefreshRequest,
    TokenResponse,
)
from app.security import (
    ACCESS_TOKEN_MINUTOS,
    COOKIE_SECURE,
    REFRESH_COOKIE_NAME,
    REFRESH_TOKEN_DIAS,
    criar_access_token,
    criar_mfa_pending_token,
    criar_refresh_token,
    decodificar_mfa_pending_token,
    get_current_user,
    hash_senha,
    limpar_tentativas_falhas,
    registrar_tentativa_falha,
    revogar_refresh_token,
    usuario_esta_bloqueado,
    validar_refresh_token,
    verificar_senha,
)

router = APIRouter(prefix="/auth", tags=["Autenticação"])


def _buscar_usuario_por_cpf(db: Session, cpf: str) -> Usuario:
    associado = db.query(Associado).filter(Associado.cpf == cpf).first()
    if associado is None or associado.id_usuario is None:
        # Mensagem genérica de propósito - nunca revelar se o CPF existe ou não (evita
        # enumeração de associados por tentativa de login).
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="CPF ou senha inválidos.")
    usuario = db.query(Usuario).filter(Usuario.id_usuario == associado.id_usuario).first()
    if usuario is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="CPF ou senha inválidos.")
    return usuario


@router.post("/login", response_model=TokenResponse, summary="Login por CPF + senha")
def login(dados: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    usuario = _buscar_usuario_por_cpf(db, dados.cpf)

    if usuario_esta_bloqueado(usuario):
        segundos = max(1, int((usuario.bloqueado_ate - datetime.utcnow()).total_seconds()))
        minutos = max(1, (segundos + 59) // 60)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Muitas tentativas de login. Tente novamente em {minutos} min.",
            headers={"Retry-After": str(segundos)},
        )

    if not usuario.ativo or not verificar_senha(dados.senha, usuario.senha_hash or ""):
        registrar_tentativa_falha(db, usuario)
        registrar_auditoria(
            db, None, "usuarios", "LOGIN_FALHA", id_registro_afetado=usuario.id_usuario,
            ip_origem=request.client.host if request.client else None,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="CPF ou senha inválidos.")

    limpar_tentativas_falhas(db, usuario)

    if usuario.mfa_ativado:
        return TokenResponse(
            access_token="",
            expires_in_minutos=0,
            requer_mfa=True,
            login_temp_token=criar_mfa_pending_token(usuario),
        )

    registrar_auditoria(
        db, usuario, "usuarios", "LOGIN", id_registro_afetado=usuario.id_usuario,
        ip_origem=request.client.host if request.client else None,
    )
    refresh_token = criar_refresh_token(db, usuario)
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="strict",
        max_age=REFRESH_TOKEN_DIAS * 24 * 60 * 60,
    )
    # O valor NUNCA volta no corpo JSON quando já foi gravado em cookie HttpOnly - devolvê-lo
    # aqui também anularia a proteção contra XSS que o HttpOnly existe para dar (um script
    # injetado na página não pode ler o cookie, mas conseguiria ler a resposta desta chamada
    # se ela também carregasse o token). Cliente de linha de comando/teste que precise do valor
    # bruto lê do header Set-Cookie da resposta (nunca acessível a partir de JS do navegador,
    # mas perfeitamente legível por curl/httpx) - ver DECISOES_CONGELADAS.md seção 4.2.
    return TokenResponse(
        access_token=criar_access_token(usuario),
        refresh_token=None,
        expires_in_minutos=ACCESS_TOKEN_MINUTOS,
    )


@router.post("/login/mfa", response_model=TokenResponse, summary="2º passo do login (código TOTP)")
def login_mfa(dados: LoginMFARequest, request: Request, response: Response, db: Session = Depends(get_db)):
    payload = decodificar_mfa_pending_token(dados.login_temp_token)
    usuario = db.query(Usuario).filter(Usuario.id_usuario == payload["id_usuario"]).first()
    if usuario is None or not usuario.mfa_ativado or not usuario.mfa_secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="MFA inválido.")

    totp = pyotp.TOTP(usuario.mfa_secret)
    if not totp.verify(dados.codigo_totp, valid_window=1):
        registrar_tentativa_falha(db, usuario)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Código TOTP inválido.")

    limpar_tentativas_falhas(db, usuario)
    registrar_auditoria(
        db, usuario, "usuarios", "LOGIN", id_registro_afetado=usuario.id_usuario,
        ip_origem=request.client.host if request.client else None,
    )
    refresh_token = criar_refresh_token(db, usuario)
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="strict",
        max_age=REFRESH_TOKEN_DIAS * 24 * 60 * 60,
    )
    # Idem à observação em /auth/login - nunca ecoar o valor no corpo já que foi para o cookie.
    return TokenResponse(
        access_token=criar_access_token(usuario),
        refresh_token=None,
        expires_in_minutos=ACCESS_TOKEN_MINUTOS,
    )


@router.post("/refresh", response_model=TokenResponse, summary="Renova o access token")
def refresh(request: Request, dados: Optional[RefreshRequest] = None, db: Session = Depends(get_db)):
    refresh_token = (dados.refresh_token if dados else None) or request.cookies.get(REFRESH_COOKIE_NAME)
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token ausente.")
    usuario = validar_refresh_token(db, refresh_token)
    # O corpo nunca ecoa o refresh token de volta - quem chamou já tem o valor (no próprio
    # cookie, ou no corpo que acabou de enviar); repeti-lo aqui só ampliaria à toa a superfície
    # de exposição do token a qualquer script que leia esta resposta.
    return TokenResponse(
        access_token=criar_access_token(usuario),
        refresh_token=None,
        expires_in_minutos=ACCESS_TOKEN_MINUTOS,
    )


@router.post("/logout", summary="Revoga o refresh token (logout real, não só do lado do cliente)")
def logout(request: Request, response: Response, dados: Optional[LogoutRequest] = None, db: Session = Depends(get_db)):
    refresh_token = (dados.refresh_token if dados else None) or request.cookies.get(REFRESH_COOKIE_NAME)
    if refresh_token:
        revogar_refresh_token(db, refresh_token)
    response.delete_cookie(REFRESH_COOKIE_NAME)
    return {"mensagem": "Logout realizado."}


@router.get("/me", response_model=MeResponse, summary="Dados de quem está logado")
def me(usuario: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
    nivel = db.query(NivelAcesso).filter(NivelAcesso.id_nivel == usuario.id_nivel).first()
    permissoes = (
        db.query(PermissaoSistema.codigo_permissao)
        .join(perfil_permissao, perfil_permissao.c.id_permissao == PermissaoSistema.id_permissao)
        .filter(perfil_permissao.c.id_nivel == usuario.id_nivel)
        .all()
    )
    return MeResponse(
        id_usuario=usuario.id_usuario,
        id_associado=associado.id_associado if associado else None,
        nome_completo=associado.nome_completo if associado else None,
        email=usuario.email,
        nivel=nivel.nome_nivel if nivel else None,
        mfa_ativado=usuario.mfa_ativado,
        permissoes=[p[0] for p in permissoes],
    )


@router.post("/mfa/ativar", response_model=MFAAtivarResponse, summary="Inicia a ativação de MFA (TOTP)")
def mfa_ativar(usuario: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    # Gera o segredo mas NÃO ativa ainda - só em /mfa/confirmar, depois de confirmar que o
    # usuário configurou o app autenticador direito.
    secret = pyotp.random_base32()
    usuario.mfa_secret = secret
    db.commit()
    uri = pyotp.TOTP(secret).provisioning_uri(name=usuario.email, issuer_name="ASAF")
    return MFAAtivarResponse(otpauth_uri=uri)


@router.post("/mfa/confirmar", summary="Confirma a ativação de MFA com o 1º código gerado")
def mfa_confirmar(
    dados: MFAConfirmarRequest,
    usuario: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not usuario.mfa_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ative o MFA primeiro (/auth/mfa/ativar).")
    totp = pyotp.TOTP(usuario.mfa_secret)
    if not totp.verify(dados.codigo_totp, valid_window=1):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Código TOTP inválido.")
    usuario.mfa_ativado = True
    db.commit()
    registrar_auditoria(db, usuario, "usuarios", "MFA_ATIVADO", id_registro_afetado=usuario.id_usuario)
    return {"mensagem": "MFA ativado com sucesso."}


@router.post("/bootstrap-admin", summary="Cria o 1º administrador (só funciona se ainda não existir nenhum usuário)")
def bootstrap_admin(dados: BootstrapAdminRequest, db: Session = Depends(get_db)):
    # Trava de segurança: só existe UMA janela de oportunidade, o sistema inteiro sem
    # nenhum Usuario cadastrado. Depois que o primeiro existir, essa rota nunca mais
    # cria ninguém - impede que essa rota vire uma porta de entrada pra sempre.
    if db.query(Usuario).count() > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Já existe usuário cadastrado - esta rota só funciona na primeira configuração do sistema.",
        )

    nivel_presidente = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == "Presidente").first()
    if nivel_presidente is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Catálogo de níveis de acesso não foi semeado ainda - reinicie o servidor.",
        )

    associado = db.query(Associado).filter(Associado.cpf == dados.cpf).first()
    if associado is None:
        associado = Associado(
            nome_completo=dados.nome_completo,
            cpf=dados.cpf,
            email_contato=dados.email,
            categoria="Fundador",
        )
        db.add(associado)
        db.flush()
    elif associado.id_usuario is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Este CPF já tem usuário vinculado.")

    usuario = Usuario(email=dados.email, senha_hash=hash_senha(dados.senha), id_nivel=nivel_presidente.id_nivel)
    db.add(usuario)
    db.flush()
    associado.id_usuario = usuario.id_usuario
    db.commit()

    registrar_auditoria(db, usuario, "usuarios", "BOOTSTRAP_ADMIN", id_registro_afetado=usuario.id_usuario)
    return {"mensagem": "Administrador criado com sucesso. Faça login em /auth/login."}
