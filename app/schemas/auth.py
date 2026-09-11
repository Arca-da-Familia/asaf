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
    codigo_totp: str
    # token temporário emitido pelo /auth/login quando detecta que precisa de MFA,
    # evita ter que reenviar a senha no segundo passo.
    login_temp_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str = "bearer"
    expires_in_minutos: int
    requer_mfa: bool = False
    login_temp_token: Optional[str] = None


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class MFAAtivarResponse(BaseModel):
    otpauth_uri: str


class MFAConfirmarRequest(BaseModel):
    codigo_totp: str


class MeResponse(BaseModel):
    id_usuario: int
    id_associado: Optional[int] = None
    nome_completo: Optional[str] = None
    email: Optional[str] = None
    nivel: Optional[str] = None
    mfa_ativado: bool
    permissoes: list[str] = []
