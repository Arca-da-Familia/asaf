import pyotp
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.associados import Associado, DocumentoAnexo, Endereco
from app.models.core import NivelAcesso, PermissaoSistema, TokenAcesso, Usuario, perfil_permissao
from app.schemas.auth import (
    AlterarSenhaRequest,
    BootstrapAdminRequest,
    DocumentoResponse,
    EnderecoResponse,
    LoginMFARequest,
    LoginRequest,
    LogoutRequest,
    MeResponse,
    MFAAtivarResponse,
    MFAConfirmarRequest,
    MFAConfirmarResponse,
    MFADesativarRequest,
    MFARegenerarRequest,
    MFAResetRequest,
    PerfilResponse,
    PerfilUpdateRequest,
    RefreshRequest,
    SessaoResponse,
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
    exigir_permissao,
    gerar_codigos_recuperacao,
    get_current_user,
    hash_senha,
    limpar_tentativas_falhas,
    registrar_tentativa_falha,
    revogar_codigos_recuperacao,
    revogar_refresh_token,
    revogar_tokens_exceto,
    usuario_esta_bloqueado,
    validar_refresh_token,
    validar_senha_forte,
    verificar_codigo_recuperacao,
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
    refresh_token = criar_refresh_token(
        db,
        usuario,
        request.client.host if request.client else None,
        request.headers.get("user-agent"),
    )
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


@router.post("/login/mfa", response_model=TokenResponse, summary="2º passo do login (código TOTP ou de recuperação)")
def login_mfa(dados: LoginMFARequest, request: Request, response: Response, db: Session = Depends(get_db)):
    payload = decodificar_mfa_pending_token(dados.login_temp_token)
    usuario = db.query(Usuario).filter(Usuario.id_usuario == payload["id_usuario"]).first()
    if usuario is None or not usuario.mfa_ativado:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="MFA inválido.")

    if dados.codigo_recuperacao:
        # Código de recuperação substitui o TOTP (v0.2.2d) - é de uso único, queimado no uso.
        if not verificar_codigo_recuperacao(db, usuario, dados.codigo_recuperacao):
            registrar_tentativa_falha(db, usuario)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Código de recuperação inválido.")
    else:
        if not usuario.mfa_secret or not dados.codigo_totp:
            registrar_tentativa_falha(db, usuario)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Código TOTP inválido.")
        totp = pyotp.TOTP(usuario.mfa_secret)
        if not totp.verify(dados.codigo_totp, valid_window=1):
            registrar_tentativa_falha(db, usuario)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Código TOTP inválido.")

    limpar_tentativas_falhas(db, usuario)
    registrar_auditoria(
        db, usuario, "usuarios", "LOGIN", id_registro_afetado=usuario.id_usuario,
        ip_origem=request.client.host if request.client else None,
    )
    refresh_token = criar_refresh_token(
        db,
        usuario,
        request.client.host if request.client else None,
        request.headers.get("user-agent"),
    )
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
    mfa_obrigatorio = bool(nivel.exige_mfa) if nivel else False
    return MeResponse(
        id_usuario=usuario.id_usuario,
        id_associado=associado.id_associado if associado else None,
        nome_completo=associado.nome_completo if associado else None,
        email=usuario.email,
        nivel=nivel.nome_nivel if nivel else None,
        mfa_ativado=usuario.mfa_ativado,
        mfa_obrigatorio=mfa_obrigatorio,
        mfa_pendente=mfa_obrigatorio and not usuario.mfa_ativado,
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


@router.post("/mfa/confirmar", response_model=MFAConfirmarResponse, summary="Confirma a ativação de MFA com o 1º código gerado")
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
    # Gera os códigos de recuperação (v0.2.2d) e devolve em texto UMA única vez.
    codigos = gerar_codigos_recuperacao(db, usuario)
    registrar_auditoria(db, usuario, "usuarios", "MFA_ATIVADO", id_registro_afetado=usuario.id_usuario)
    return MFAConfirmarResponse(mensagem="MFA ativado com sucesso.", codigos_recuperacao=codigos)


@router.post("/mfa/reset", summary="Reseta o MFA de outro usuário (requer gerenciar_acesso)")
def mfa_reset(
    dados: MFAResetRequest,
    admin: Usuario = Depends(exigir_permissao("gerenciar_acesso")),
    db: Session = Depends(get_db),
):
    # Reset por terceiro (v0.2.2e) - sempre auditado, jamais silencioso. Serve para o caso
    # de um Presidente/Diretoria perder o celular: outro administrador remove o MFA e o
    # usuário refaz o onboarding na próxima entrada.
    alvo = db.query(Usuario).filter(Usuario.id_usuario == dados.id_usuario).first()
    if alvo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado.")
    alvo.mfa_ativado = False
    alvo.mfa_secret = None
    db.commit()
    revogar_codigos_recuperacao(db, alvo)
    registrar_auditoria(
        db, admin, "usuarios", "MFA_RESET_POR_TERCEIRO",
        id_registro_afetado=alvo.id_usuario,
        dados_depois={"mfa_ativado": False},
    )
    return {"mensagem": "MFA do usuário resetado."}


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


# ==========================================
# MEU PERFIL (v0.2.5)
# ==========================================
def _associado_do_usuario(db: Session, usuario: Usuario) -> Associado:
    associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
    if associado is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nenhum associado vinculado a este usuário.")
    return associado


@router.post("/senha/alterar", summary="Troca a própria senha (exige a senha atual)")
def alterar_senha(dados: AlterarSenhaRequest, request: Request, usuario: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    if not usuario.senha_hash or not verificar_senha(dados.senha_atual, usuario.senha_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Senha atual incorreta.")
    erro = validar_senha_forte(dados.senha_nova)
    if erro:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=erro)
    usuario.senha_hash = hash_senha(dados.senha_nova)
    db.commit()
    # Revoga todos os refresh tokens EXCETO o da sessão corrente (identificado pelo cookie).
    revogar_tokens_exceto(db, usuario, request.cookies.get(REFRESH_COOKIE_NAME))
    registrar_auditoria(db, usuario, "usuarios", "SENHA_ALTERADA", id_registro_afetado=usuario.id_usuario)
    return {"mensagem": "Senha alterada com sucesso."}


@router.get("/perfil", response_model=PerfilResponse, summary="Dados cadastrais do próprio associado")
def perfil(usuario: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    associado = _associado_do_usuario(db, usuario)
    endereco = db.query(Endereco).filter(Endereco.id_associado == associado.id_associado).first()
    return PerfilResponse(
        id_associado=associado.id_associado,
        nome_completo=associado.nome_completo,
        cpf=associado.cpf,
        email_contato=associado.email_contato,
        telefone_whatsapp=associado.telefone_whatsapp,
        categoria=associado.categoria,
        status_arrolamento=associado.status_arrolamento,
        data_admissao=associado.data_admissao,
        endereco=EnderecoResponse(
            cep=endereco.cep, logradouro=endereco.logradouro, numero=endereco.numero,
            bairro=endereco.bairro, cidade=endereco.cidade, estado=endereco.estado,
        ) if endereco else None,
    )


@router.put("/perfil", summary="Atualiza os campos de contato do próprio cadastro")
def atualizar_perfil(dados: PerfilUpdateRequest, usuario: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    associado = _associado_do_usuario(db, usuario)
    associado.email_contato = dados.email_contato
    associado.telefone_whatsapp = dados.telefone_whatsapp
    endereco = db.query(Endereco).filter(Endereco.id_associado == associado.id_associado).first()
    if endereco is None:
        endereco = Endereco(id_associado=associado.id_associado)
        db.add(endereco)
    endereco.cep = dados.cep
    endereco.logradouro = dados.logradouro
    endereco.numero = dados.numero
    endereco.bairro = dados.bairro
    endereco.cidade = dados.cidade
    endereco.estado = dados.estado
    db.commit()
    registrar_auditoria(db, usuario, "associados", "PERFIL_ATUALIZADO", id_registro_afetado=associado.id_associado)
    return {"mensagem": "Perfil atualizado com sucesso."}


@router.get("/me/documentos", response_model=list[DocumentoResponse], summary="Documentos do próprio associado (somente leitura)")
def meus_documentos(usuario: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    associado = _associado_do_usuario(db, usuario)
    docs = (
        db.query(DocumentoAnexo)
        .filter(DocumentoAnexo.id_associado == associado.id_associado)
        .order_by(DocumentoAnexo.data_upload.desc())
        .all()
    )
    return [
        DocumentoResponse(id_documento=d.id_documento, tipo_documento=d.tipo_documento, data_upload=d.data_upload)
        for d in docs
    ]


@router.get("/sessoes", response_model=list[SessaoResponse], summary="Sessões ativas do usuário")
def sessoes(request: Request, usuario: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    token_atual = request.cookies.get(REFRESH_COOKIE_NAME)
    tokens = (
        db.query(TokenAcesso)
        .filter(TokenAcesso.id_usuario == usuario.id_usuario)
        .order_by(TokenAcesso.criado_em.desc())
        .all()
    )
    return [
        SessaoResponse(
            id_token=t.id_token,
            criado_em=t.criado_em,
            ultimo_uso_em=t.ultimo_uso_em,
            ip_origem=t.ip_origem,
            user_agent=t.user_agent,
            is_atual=(t.token == token_atual),
        )
        for t in tokens
    ]


@router.delete("/sessoes/{id_token}", summary="Encerra uma sessão específica")
def revogar_sessao(id_token: int, request: Request, usuario: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    registro = db.query(TokenAcesso).filter(
        TokenAcesso.id_token == id_token,
        TokenAcesso.id_usuario == usuario.id_usuario,
    ).first()
    if registro is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sessão não encontrada.")
    db.delete(registro)
    db.commit()
    registrar_auditoria(db, usuario, "tokens_acesso", "SESSAO_REVOGADA", id_registro_afetado=id_token)
    return {"mensagem": "Sessão encerrada."}


@router.post("/mfa/desativar", summary="Desativa o MFA (exige senha + TOTP)")
def mfa_desativar(dados: MFADesativarRequest, usuario: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    if not usuario.mfa_ativado:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="MFA não está ativado.")
    if not usuario.senha_hash or not verificar_senha(dados.senha, usuario.senha_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Senha incorreta.")
    if not usuario.mfa_secret or not pyotp.TOTP(usuario.mfa_secret).verify(dados.codigo_totp, valid_window=1):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Código TOTP inválido.")
    usuario.mfa_ativado = False
    usuario.mfa_secret = None
    db.commit()
    revogar_codigos_recuperacao(db, usuario)
    registrar_auditoria(db, usuario, "usuarios", "MFA_DESATIVADO", id_registro_afetado=usuario.id_usuario)
    return {"mensagem": "MFA desativado."}


@router.post("/mfa/recuperacao/regenerar", response_model=MFAConfirmarResponse, summary="Regera os códigos de recuperação (exige senha)")
def mfa_regerar_recuperacao(dados: MFARegenerarRequest, usuario: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    if not usuario.mfa_ativado:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="MFA não está ativado.")
    if not usuario.senha_hash or not verificar_senha(dados.senha, usuario.senha_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Senha incorreta.")
    codigos = gerar_codigos_recuperacao(db, usuario)
    registrar_auditoria(db, usuario, "usuarios", "MFA_RECUPERACAO_REGERADA", id_registro_afetado=usuario.id_usuario)
    return MFAConfirmarResponse(mensagem="Códigos de recuperação regerados.", codigos_recuperacao=codigos)
