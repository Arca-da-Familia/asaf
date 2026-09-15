from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    cpf: str
    senha: str


class BootstrapAdminRequest(BaseModel):
    cpf: str
    nome_completo: str
    email: str
    senha: str


class LoginMFARequest(BaseModel):
    cpf: str
    # token temporário emitido pelo /auth/login quando detecta que precisa de MFA,
    # evita ter que reenviar a senha no segundo passo.
    login_temp_token: str
    # 2º passo aceita TOTP OU um código de recuperação (v0.2.2d) — nunca os dois ao mesmo tempo.
    codigo_totp: Optional[str] = None
    codigo_recuperacao: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str = "bearer"
    expires_in_minutos: int
    requer_mfa: bool = False
    login_temp_token: Optional[str] = None
    # v3.0 (achado 2026-09-15) - True quando a senha ativa foi definida por outra pessoa
    # (secretaria concedendo acesso), nunca pelo titular - front-end deve forçar troca de senha.
    senha_provisoria: bool = False


class RefreshRequest(BaseModel):
    # Opcional: quando o cliente web usa o cookie HttpOnly, o corpo pode vir vazio
    # (a API lê o token do cookie). Clientes de linha de comando/teste continuam
    # enviando no corpo JSON.
    refresh_token: Optional[str] = None


class LogoutRequest(BaseModel):
    # Opcional: idem acima — logout via cookie quando o corpo não vier.
    refresh_token: Optional[str] = None


class MFAAtivarResponse(BaseModel):
    otpauth_uri: str


class MFAConfirmarRequest(BaseModel):
    codigo_totp: str


class MFAConfirmarResponse(BaseModel):
    mensagem: str
    codigos_recuperacao: list[str]


class MFAResetRequest(BaseModel):
    id_usuario: int


class ImpersonandoInfo(BaseModel):
    """v0.2.9 - presente em MeResponse só quando o admin está no modo 'ver como'. `nivel_real`
    é o nível de verdade da pessoa logada (nunca perdido, usado pra sair do modo)."""
    id_nivel: int
    nome_nivel: str
    nivel_real: str


class MeResponse(BaseModel):
    id_usuario: int
    id_associado: Optional[int] = None
    nome_completo: Optional[str] = None
    email: Optional[str] = None
    nivel: Optional[str] = None
    mfa_ativado: bool
    # v0.2.2 - o nível exige MFA (configurável no catálogo) e o usuário ainda não ativou.
    mfa_obrigatorio: bool = False
    mfa_pendente: bool = False
    permissoes: list[str] = []
    impersonando: Optional[ImpersonandoInfo] = None


class ImpersonarResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in_minutos: int


class AlterarSenhaRequest(BaseModel):
    senha_atual: str
    senha_nova: str


class EnderecoResponse(BaseModel):
    cep: Optional[str] = None
    logradouro: Optional[str] = None
    numero: Optional[str] = None
    bairro: Optional[str] = None
    cidade: Optional[str] = None
    estado: Optional[str] = None


class PerfilResponse(BaseModel):
    id_associado: Optional[int] = None
    nome_completo: Optional[str] = None
    cpf: Optional[str] = None
    email_contato: Optional[str] = None
    telefone_whatsapp: Optional[str] = None
    categoria: Optional[str] = None
    status_arrolamento: Optional[str] = None
    data_admissao: Optional[datetime] = None
    endereco: Optional[EnderecoResponse] = None


class PerfilUpdateRequest(BaseModel):
    email_contato: EmailStr
    telefone_whatsapp: str
    cep: Optional[str] = None
    logradouro: Optional[str] = None
    numero: Optional[str] = None
    bairro: Optional[str] = None
    cidade: Optional[str] = None
    estado: Optional[str] = None


class SessaoResponse(BaseModel):
    id_token: int
    criado_em: Optional[datetime] = None
    ultimo_uso_em: Optional[datetime] = None
    ip_origem: Optional[str] = None
    user_agent: Optional[str] = None
    is_atual: bool = False


class DocumentoResponse(BaseModel):
    id_documento: int
    tipo_documento: Optional[str] = None
    data_upload: Optional[datetime] = None


class MFADesativarRequest(BaseModel):
    senha: str
    codigo_totp: str


class MFARegenerarRequest(BaseModel):
    senha: str


# ==========================================
# PASSKEY / WEBAUTHN (v0.4 - adendo pós-fechamento da FASE 0)
# ==========================================
class WebAuthnOpcoesResponse(BaseModel):
    """`opcoes` é o dict devolvido por `webauthn.options_to_json` (já no formato que
    `@simplewebauthn/browser` espera em `startRegistration`/`startAuthentication`) -
    passado como `dict` puro (não tipado campo a campo) porque o contrato de verdade é o do
    navegador/biblioteca JS, não um schema nosso; `desafio_token` carrega o challenge para o
    passo de conclusão (ver `criar_webauthn_pending_token`)."""
    opcoes: dict
    desafio_token: str


class WebAuthnRegistrarConcluirRequest(BaseModel):
    credencial: dict
    desafio_token: str
    apelido: Optional[str] = None


class WebAuthnLoginConcluirRequest(BaseModel):
    credencial: dict
    desafio_token: str


class WebAuthnCredencialResponse(BaseModel):
    id_credencial: int
    apelido: Optional[str] = None
    criado_em: Optional[datetime] = None
    ultimo_uso_em: Optional[datetime] = None
