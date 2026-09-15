import json
import pyotp
from datetime import datetime
from typing import Optional

import webauthn
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session
from webauthn.helpers import bytes_to_base64url
from webauthn.helpers.exceptions import InvalidRegistrationResponse, InvalidAuthenticationResponse
from webauthn.helpers.structs import (
    AttestationConveyancePreference,
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.associados import Associado, DocumentoAnexo, Endereco
from app.models.core import CredencialWebAuthn, NivelAcesso, PermissaoSistema, TokenAcesso, Usuario, perfil_permissao
from app.models.pessoas import Papel
from app.services.ficha_360 import montar_ficha_360
from app.services.matricula import proximo_numero_matricula
from app.schemas.auth import (
    AlterarSenhaRequest,
    BootstrapAdminRequest,
    DocumentoResponse,
    EnderecoResponse,
    ImpersonandoInfo,
    ImpersonarResponse,
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
    WebAuthnCredencialResponse,
    WebAuthnLoginConcluirRequest,
    WebAuthnOpcoesResponse,
    WebAuthnRegistrarConcluirRequest,
)
from app.security import (
    ACCESS_TOKEN_MINUTOS,
    COOKIE_SECURE,
    REFRESH_COOKIE_NAME,
    REFRESH_TOKEN_DIAS,
    WEBAUTHN_ORIGIN,
    WEBAUTHN_RP_ID,
    WEBAUTHN_RP_NAME,
    criar_access_token,
    criar_mfa_pending_token,
    criar_refresh_token,
    criar_webauthn_pending_token,
    decodificar_mfa_pending_token,
    decodificar_webauthn_pending_token,
    exigir_permissao,
    gerar_codigos_recuperacao,
    get_current_user,
    hash_senha,
    limpar_tentativas_falhas,
    nivel_efetivo_id,
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


def _finalizar_login(db: Session, usuario: Usuario, request: Request, response: Response, acao: str = "LOGIN") -> TokenResponse:
    """Emite a sessão completa (cookie de refresh + access token) e audita - compartilhado por
    /login, /login/mfa e /webauthn/login/concluir (os três terminam da mesma forma depois de
    validar a credencial por caminhos diferentes)."""
    registrar_auditoria(
        db, usuario, "usuarios", acao, id_registro_afetado=usuario.id_usuario,
        ip_origem=request.client.host if request.client else None,
    )
    refresh_token = criar_refresh_token(
        db, usuario,
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
    # Idem à observação original em /auth/login: nunca ecoar o refresh token no corpo já que
    # foi gravado no cookie HttpOnly - repeti-lo aqui anularia a proteção contra XSS que o
    # HttpOnly existe para dar.
    return TokenResponse(
        access_token=criar_access_token(usuario),
        refresh_token=None,
        expires_in_minutos=ACCESS_TOKEN_MINUTOS,
        senha_provisoria=usuario.senha_provisoria,
    )


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

    # NUNCA ecoar o refresh token no corpo (ver DECISOES_CONGELADAS.md seção 4.2) - o header
    # Set-Cookie já carrega, e devolvê-lo aqui também anularia a proteção do HttpOnly contra XSS.
    return _finalizar_login(db, usuario, request, response)


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
    return _finalizar_login(db, usuario, request, response)


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
        senha_provisoria=usuario.senha_provisoria,
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
    nivel_real = db.query(NivelAcesso).filter(NivelAcesso.id_nivel == usuario.id_nivel).first()

    # v0.2.9 - em modo "ver como", `nivel`/`permissoes` refletem o nível IMPERSONADO (o que o
    # front usa pra montar menu e checar rota) - é isso que faz o admin "ver o que aquele papel
    # enxerga" de verdade, não só de fachada. O MFA continua sendo checado pelo nível REAL:
    # impersonar não pode ser usado pra escapar de uma exigência de MFA da própria conta.
    id_nivel_efetivo = nivel_efetivo_id(usuario)
    nivel_efetivo = (
        nivel_real
        if id_nivel_efetivo == usuario.id_nivel
        else db.query(NivelAcesso).filter(NivelAcesso.id_nivel == id_nivel_efetivo).first()
    )
    permissoes = (
        db.query(PermissaoSistema.codigo_permissao)
        .join(perfil_permissao, perfil_permissao.c.id_permissao == PermissaoSistema.id_permissao)
        .filter(perfil_permissao.c.id_nivel == id_nivel_efetivo)
        .all()
    )
    mfa_obrigatorio = bool(nivel_real.exige_mfa) if nivel_real else False

    impersonando = None
    if usuario.id_nivel_impersonado and nivel_efetivo and nivel_real:
        impersonando = ImpersonandoInfo(
            id_nivel=nivel_efetivo.id_nivel,
            nome_nivel=nivel_efetivo.nome_nivel,
            nivel_real=nivel_real.nome_nivel,
        )

    return MeResponse(
        id_usuario=usuario.id_usuario,
        id_associado=associado.id_associado if associado else None,
        nome_completo=associado.nome_completo if associado else None,
        email=usuario.email,
        nivel=nivel_efetivo.nome_nivel if nivel_efetivo else None,
        mfa_ativado=usuario.mfa_ativado,
        mfa_obrigatorio=mfa_obrigatorio,
        mfa_pendente=mfa_obrigatorio and not usuario.mfa_ativado,
        permissoes=[p[0] for p in permissoes],
        impersonando=impersonando,
    )


@router.post(
    "/impersonar/parar",
    response_model=ImpersonarResponse,
    summary="Encerra o modo 'ver como', volta pro nível real — v0.2.9",
)
def parar_impersonacao(request: Request, usuario: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    # Precisa ser registrada ANTES de /impersonar/{id_nivel}: rota dinâmica casaria com
    # "parar" como se fosse um id_nivel (Starlette não usa o tipo `int` do parâmetro na hora de
    # rotear, só na validação depois) e a checagem de permissão errada rodaria primeiro.
    id_nivel_impersonado = usuario.id_nivel_impersonado
    token = criar_access_token(usuario)  # sem claim de impersonação -> nível real
    if id_nivel_impersonado:
        registrar_auditoria(
            db, usuario, "niveis_acesso", "IMPERSONACAO_ENCERRADA",
            id_registro_afetado=id_nivel_impersonado,
            ip_origem=request.client.host if request.client else None,
        )
    return ImpersonarResponse(access_token=token, expires_in_minutos=ACCESS_TOKEN_MINUTOS)


@router.post(
    "/impersonar/{id_nivel}",
    response_model=ImpersonarResponse,
    summary="Ver o sistema como outro nível (somente leitura) — v0.2.9",
)
def iniciar_impersonacao(
    id_nivel: int,
    request: Request,
    usuario: Usuario = Depends(exigir_permissao("gerenciar_acesso")),
    db: Session = Depends(get_db),
):
    if usuario.id_nivel_impersonado:
        raise HTTPException(status_code=400, detail="Encerre o modo 'ver como' atual antes de iniciar outro.")
    nivel = db.query(NivelAcesso).filter(NivelAcesso.id_nivel == id_nivel).first()
    if not nivel:
        raise HTTPException(status_code=404, detail="Nível de acesso não encontrado.")
    token = criar_access_token(usuario, id_nivel_impersonado=id_nivel)
    registrar_auditoria(
        db, usuario, "niveis_acesso", "IMPERSONACAO_INICIADA",
        id_registro_afetado=id_nivel,
        ip_origem=request.client.host if request.client else None,
    )
    return ImpersonarResponse(access_token=token, expires_in_minutos=ACCESS_TOKEN_MINUTOS)


@router.post("/mfa/ativar", response_model=MFAAtivarResponse, summary="Inicia a ativação de MFA (TOTP)")
def mfa_ativar(usuario: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    # Achado (v0.3.3): esta rota sobrescrevia o segredo mesmo com MFA já ativo, derrubando
    # silenciosamente o app autenticador de quem já tinha configurado (foi o que travou a
    # conta de produção). Reativar exige passar por /auth/mfa/reset (outro administrador
    # zera o MFA primeiro) - nunca regenerar segredo por baixo de um MFA já confirmado.
    if usuario.mfa_ativado:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA já está ativo nesta conta. Peça a outro administrador para resetar (/auth/mfa/reset) antes de reconfigurar.",
        )
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
            numero_matricula=proximo_numero_matricula(db),  # v1.2 - mesma regra de todo Associado novo
        )
        db.add(associado)
        db.flush()
        # v1.0 - mesma regra de cadastrar_ficha_master: Associado novo ganha o papel marcado.
        db.add(Papel(id_pessoa=associado.id_pessoa, tipo_papel="associado"))
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
    usuario.senha_provisoria = False
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
    # v1.8 - editar o próprio perfil conta como confirmação de dado ("recadastramento") - a
    # pessoa acabou de revisar e corrigir o que estava errado, não faz sentido continuar
    # marcando o cadastro como desatualizado.
    associado.pessoa.data_ultima_confirmacao = datetime.utcnow()
    db.commit()
    registrar_auditoria(db, usuario, "associados", "PERFIL_ATUALIZADO", id_registro_afetado=associado.id_associado)
    return {"mensagem": "Perfil atualizado com sucesso."}


@router.post("/perfil/confirmar-dados", summary="Confirma que os dados cadastrais continuam corretos, sem alterar nada (v1.8)")
def confirmar_dados(usuario: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    associado = _associado_do_usuario(db, usuario)
    associado.pessoa.data_ultima_confirmacao = datetime.utcnow()
    db.commit()
    registrar_auditoria(db, usuario, "pessoas", "DADOS_CONFIRMADOS", id_registro_afetado=associado.id_pessoa)
    return {"mensagem": "Dados confirmados.", "data_ultima_confirmacao": associado.pessoa.data_ultima_confirmacao}


@router.get("/me/ficha-360", summary="Ficha 360º do próprio associado (v1.5): dados, financeiro resumido, cargos, linha do tempo")
def minha_ficha_360(usuario: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    associado = _associado_do_usuario(db, usuario)
    return montar_ficha_360(db, associado)


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


# ==========================================
# PASSKEY / WEBAUTHN (v0.4 - adendo pós-fechamento da FASE 0)
#
# Substitui senha+MFA por uma credencial atrelada ao dispositivo (Windows Hello, Face ID/
# Touch ID, chave física) - a chave privada nunca sai do dispositivo, só a pública é guardada
# aqui. Cadastro exige estar logado (adiciona o dispositivo à própria conta); login é
# "usernameless"/discoverable (o navegador oferece as credenciais salvas daquele site sem
# precisar digitar CPF antes) - por isso exige-se `resident_key=REQUIRED` no cadastro. Como o
# desbloqueio do autenticador (biometria/PIN) já é uma verificação forte do usuário
# (`user_verification=REQUIRED`, checado nos dois lados - cliente E servidor, nunca só
# confiado do navegador), o login por passkey substitui senha E o segundo fator (TOTP) na
# mesma etapa - é assim que Google/Microsoft tratam passkey, não uma "lembrança" frouxa de
# dispositivo por prazo.
# ==========================================
@router.post(
    "/webauthn/registrar/iniciar",
    response_model=WebAuthnOpcoesResponse,
    summary="1º passo: gera as opções para o navegador criar uma passkey neste dispositivo",
)
def webauthn_registrar_iniciar(usuario: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    existentes = db.query(CredencialWebAuthn).filter(CredencialWebAuthn.id_usuario == usuario.id_usuario).all()
    opcoes = webauthn.generate_registration_options(
        rp_id=WEBAUTHN_RP_ID,
        rp_name=WEBAUTHN_RP_NAME,
        user_id=str(usuario.id_usuario).encode(),
        user_name=usuario.email,
        attestation=AttestationConveyancePreference.NONE,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=webauthn.base64url_to_bytes(c.credential_id))
            for c in existentes
        ],
    )
    desafio_token = criar_webauthn_pending_token("webauthn_registro", opcoes.challenge, id_usuario=usuario.id_usuario)
    return WebAuthnOpcoesResponse(opcoes=json.loads(webauthn.options_to_json(opcoes)), desafio_token=desafio_token)


@router.post(
    "/webauthn/registrar/concluir",
    response_model=WebAuthnCredencialResponse,
    summary="2º passo: valida a resposta do autenticador e grava a passkey",
)
def webauthn_registrar_concluir(
    dados: WebAuthnRegistrarConcluirRequest,
    usuario: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    payload = decodificar_webauthn_pending_token(dados.desafio_token, "webauthn_registro")
    if payload.get("id_usuario") != usuario.id_usuario:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Desafio de passkey inválido.")

    try:
        verificado = webauthn.verify_registration_response(
            credential=dados.credencial,
            expected_challenge=payload["challenge"],
            expected_rp_id=WEBAUTHN_RP_ID,
            expected_origin=WEBAUTHN_ORIGIN,
            require_user_verification=True,
        )
    except InvalidRegistrationResponse as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Não foi possível registrar a passkey: {exc}")

    credential_id = bytes_to_base64url(verificado.credential_id)
    if db.query(CredencialWebAuthn).filter(CredencialWebAuthn.credential_id == credential_id).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Esta passkey já está cadastrada.")

    credencial = CredencialWebAuthn(
        id_usuario=usuario.id_usuario,
        credential_id=credential_id,
        chave_publica_cose=bytes_to_base64url(verificado.credential_public_key),
        contador_assinatura=verificado.sign_count,
        apelido=dados.apelido or "Dispositivo sem nome",
        transports=",".join(dados.credencial.get("response", {}).get("transports") or []) or None,
    )
    db.add(credencial)
    db.commit()
    db.refresh(credencial)
    registrar_auditoria(
        db, usuario, "credenciais_webauthn", "PASSKEY_REGISTRADA",
        id_registro_afetado=credencial.id_credencial,
    )
    return WebAuthnCredencialResponse(
        id_credencial=credencial.id_credencial, apelido=credencial.apelido,
        criado_em=credencial.criado_em, ultimo_uso_em=credencial.ultimo_uso_em,
    )


@router.get(
    "/webauthn/credenciais",
    response_model=list[WebAuthnCredencialResponse],
    summary="Lista as passkeys da própria conta",
)
def webauthn_listar_credenciais(usuario: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    credenciais = (
        db.query(CredencialWebAuthn)
        .filter(CredencialWebAuthn.id_usuario == usuario.id_usuario)
        .order_by(CredencialWebAuthn.criado_em.desc())
        .all()
    )
    return [
        WebAuthnCredencialResponse(
            id_credencial=c.id_credencial, apelido=c.apelido,
            criado_em=c.criado_em, ultimo_uso_em=c.ultimo_uso_em,
        )
        for c in credenciais
    ]


@router.delete(
    "/webauthn/credenciais/{id_credencial}",
    summary="Remove uma passkey (perdeu o dispositivo, ou não quer mais usá-la)",
)
def webauthn_remover_credencial(
    id_credencial: int, usuario: Usuario = Depends(get_current_user), db: Session = Depends(get_db),
):
    credencial = db.query(CredencialWebAuthn).filter(
        CredencialWebAuthn.id_credencial == id_credencial,
        CredencialWebAuthn.id_usuario == usuario.id_usuario,
    ).first()
    if credencial is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Passkey não encontrada.")
    db.delete(credencial)
    db.commit()
    registrar_auditoria(db, usuario, "credenciais_webauthn", "PASSKEY_REMOVIDA", id_registro_afetado=id_credencial)
    return {"mensagem": "Passkey removida."}


@router.post(
    "/webauthn/login/iniciar",
    response_model=WebAuthnOpcoesResponse,
    summary="1º passo do login por passkey (sem CPF - o navegador oferece a credencial salva)",
)
def webauthn_login_iniciar():
    # Público de propósito: login por passkey não pede CPF antes (discoverable credential) -
    # é o próprio navegador que sabe quais credenciais salvas servem para este RP_ID.
    opcoes = webauthn.generate_authentication_options(
        rp_id=WEBAUTHN_RP_ID,
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    desafio_token = criar_webauthn_pending_token("webauthn_login", opcoes.challenge)
    return WebAuthnOpcoesResponse(opcoes=json.loads(webauthn.options_to_json(opcoes)), desafio_token=desafio_token)


@router.post(
    "/webauthn/login/concluir",
    response_model=TokenResponse,
    summary="2º passo do login por passkey - substitui senha E o segundo fator na mesma etapa",
)
def webauthn_login_concluir(dados: WebAuthnLoginConcluirRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    payload = decodificar_webauthn_pending_token(dados.desafio_token, "webauthn_login")

    credential_id = dados.credencial.get("id")
    credencial = db.query(CredencialWebAuthn).filter(CredencialWebAuthn.credential_id == credential_id).first()
    if credencial is None:
        # Mensagem genérica de propósito - mesmo raciocínio de _buscar_usuario_por_cpf: nunca
        # revelar se a credencial existe ou não.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Passkey inválida.")

    usuario = db.query(Usuario).filter(Usuario.id_usuario == credencial.id_usuario).first()
    if usuario is None or not usuario.ativo:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Passkey inválida.")
    if usuario_esta_bloqueado(usuario):
        segundos = max(1, int((usuario.bloqueado_ate - datetime.utcnow()).total_seconds()))
        minutos = max(1, (segundos + 59) // 60)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Muitas tentativas de login. Tente novamente em {minutos} min.",
            headers={"Retry-After": str(segundos)},
        )

    try:
        verificado = webauthn.verify_authentication_response(
            credential=dados.credencial,
            expected_challenge=payload["challenge"],
            expected_rp_id=WEBAUTHN_RP_ID,
            expected_origin=WEBAUTHN_ORIGIN,
            credential_public_key=webauthn.base64url_to_bytes(credencial.chave_publica_cose),
            credential_current_sign_count=credencial.contador_assinatura or 0,
            require_user_verification=True,
        )
    except InvalidAuthenticationResponse as exc:
        registrar_tentativa_falha(db, usuario)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Passkey inválida: {exc}")

    # contador_assinatura detecta autenticador clonado: um valor que não avança (ou recua) em
    # relação ao guardado é sinal de duas cópias da mesma credencial em uso - autenticadores
    # de plataforma (Windows Hello/Face ID) tipicamente mantêm o contador zerado (não
    # incrementam), então só bloqueia quando o valor RECUOU de um patamar que já tinha
    # avançado, nunca quando os dois lados ficam parados em zero.
    if verificado.new_sign_count != 0 and verificado.new_sign_count <= (credencial.contador_assinatura or 0):
        registrar_auditoria(
            db, usuario, "credenciais_webauthn", "PASSKEY_CONTADOR_SUSPEITO",
            id_registro_afetado=credencial.id_credencial,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Passkey recusada (contador de uso suspeito).")

    credencial.contador_assinatura = verificado.new_sign_count
    credencial.ultimo_uso_em = datetime.utcnow()
    db.commit()

    limpar_tentativas_falhas(db, usuario)
    return _finalizar_login(db, usuario, request, response, acao="LOGIN_PASSKEY")
