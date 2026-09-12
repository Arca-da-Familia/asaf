from typing import Optional
from pydantic import BaseModel


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
