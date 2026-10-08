from datetime import date
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator, model_validator

from app.validadores import somente_digitos, validar_cpf, validar_data_nascimento_coerente, validar_telefone_br


class PropostaFiliacaoCriar(BaseModel):
    """v1.2 - o que uma pessoa de fora informa ao propor filiação: só o essencial pra
    triagem. Endereço e demais dados do cadastro completo (v1.1) ficam pra secretaria
    preencher na conferência documental, via os mesmos endpoints de edição já existentes.

    v5.4h - é o corpo do formulário público do site: a data de nascimento é obrigatória (o Estatuto, Art. 12, tem idade mínima e os sócios veem a
    idade), a pessoa declara que leu o aviso de privacidade (com a versão que viu), de 16 a 17 anos declara a autorização dos pais ou responsáveis,
    e `pagina_web` é a armadilha para robôs: um campo que a pessoa nunca vê, nunca preenche."""
    nome_completo: str
    cpf: str
    email_contato: Optional[EmailStr] = None
    telefone_whatsapp: Optional[str] = None
    data_nascimento: date
    consentimento_lgpd: bool = False
    versao_texto_consentimento: Optional[str] = None
    autorizacao_responsavel: bool = False
    pagina_web: Optional[str] = None

    @field_validator("email_contato", mode="before")
    @classmethod
    def validar_email_em_portugues(cls, v):
        # a mensagem padrão da biblioteca vem em inglês e é a que aparece para quem preenche o formulário do site
        if v is None or str(v).strip() == "":
            return None
        try:
            from email_validator import EmailNotValidError, validate_email

            return validate_email(str(v).strip(), check_deliverability=False).normalized
        except EmailNotValidError:
            raise ValueError("Esse e-mail não parece certo: confira se está escrito sem erro.")

    @field_validator("nome_completo")
    @classmethod
    def validar_nome(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Informe o nome completo.")
        return v.strip()

    @field_validator("cpf")
    @classmethod
    def validar_cpf_campo(cls, v):
        if not validar_cpf(v):
            raise ValueError("CPF inválido (dígito verificador não confere).")
        return somente_digitos(v)

    @field_validator("telefone_whatsapp")
    @classmethod
    def validar_telefone_campo(cls, v):
        if v and not validar_telefone_br(v):
            raise ValueError("Telefone inválido - use DDD + número (10 ou 11 dígitos).")
        return v

    @field_validator("data_nascimento")
    @classmethod
    def validar_nascimento_campo(cls, v):
        if not validar_data_nascimento_coerente(v):
            raise ValueError("Data de nascimento inválida (não pode ser futura nem implicar idade implausível).")
        return v

    @model_validator(mode="after")
    def exigir_um_contato(self):
        if not self.email_contato and not (self.telefone_whatsapp or "").strip():
            raise ValueError("Informe um e-mail ou um telefone para a secretaria conseguir falar com você.")
        return self


class PropostaDoSocio(BaseModel):
    """v5.4h - o que um sócio apto diz sobre um pedido de filiação (Estatuto Art. 12, par. único VI): propõe ou recusa; recusar exige o motivo."""
    decisao: str
    observacao: Optional[str] = None


class PropostaRecusar(BaseModel):
    motivo: str

    @field_validator("motivo")
    @classmethod
    def validar_motivo(cls, v):
        if len(v.strip()) < 3:
            raise ValueError("Informe o motivo da recusa.")
        return v.strip()


class PropostaAprovar(BaseModel):
    categoria: str = "Efetivo"
    # v1.8 - mesma trava de cadastrar_ficha_master: só tem efeito com a permissão
    # `forcar_cadastro_duplicado` (Presidente, por padrão).
    forcar: bool = False
