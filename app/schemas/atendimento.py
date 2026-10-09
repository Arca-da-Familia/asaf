from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, field_validator, model_validator

from app.validadores import somente_digitos, validar_cpf, validar_telefone_br

# os tipos que o site manda (o voluntariado entrou na v5.5b)
TipoPublico = Literal["CONTATO", "PEDIDO_INFORMACAO", "TITULAR_LGPD", "VOLUNTARIO"]
ASSUNTO_DO_VOLUNTARIADO = "Quero ser voluntário"
SUBTIPOS_DA_SOLICITACAO_DE_TITULAR = ("CONFIRMACAO", "ACESSO", "CORRECAO", "ELIMINACAO", "PORTABILIDADE", "COMPARTILHAMENTO", "REVOGACAO", "OUTRO")


class AtendimentoPublicoCriar(BaseModel):
    """O corpo dos formulários do site (contato, pedido de informação sobre recursos públicos, solicitação de titular de dados). Para a pessoa poder ser
    respondida é preciso ao menos um e-mail ou telefone; a solicitação de titular exige o CPF (é com ele que a associação confere quem pede) e diz qual direito
    do art. 18 da LGPD. `pagina_web` é a armadilha para robôs: um campo que a pessoa nunca vê, nunca preenche."""
    tipo: TipoPublico
    subtipo: Optional[str] = None
    assunto: Optional[str] = None
    mensagem: str
    nome_completo: str
    email_contato: Optional[str] = None
    telefone_whatsapp: Optional[str] = None
    cpf: Optional[str] = None
    data_nascimento: Optional[date] = None
    consentimento_lgpd: bool = False
    versao_texto_consentimento: Optional[str] = None
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
        v = " ".join(v.split())
        if len(v) < 3:
            raise ValueError("Informe o seu nome.")
        if len(v) > 150:
            raise ValueError("O nome está comprido demais (até 150 letras).")
        return v

    @field_validator("assunto")
    @classmethod
    def validar_assunto(cls, v):
        if v is None or v.strip() == "":
            return None
        v = " ".join(v.split())
        if len(v) > 150:
            raise ValueError("O assunto está comprido demais (até 150 letras).")
        return v

    @field_validator("mensagem")
    @classmethod
    def validar_mensagem(cls, v):
        v = v.strip()
        if len(v) < 10:
            raise ValueError("Escreva a sua mensagem (pelo menos 10 letras).")
        if len(v) > 4000:
            raise ValueError("A mensagem está comprida demais (até 4.000 letras).")
        return v

    @field_validator("cpf")
    @classmethod
    def validar_cpf_campo(cls, v):
        if v is None or v.strip() == "":
            return None
        if not validar_cpf(v):
            raise ValueError("CPF inválido (dígito verificador não confere).")
        return somente_digitos(v)

    @field_validator("telefone_whatsapp")
    @classmethod
    def validar_telefone_campo(cls, v):
        if v is None or v.strip() == "":
            return None
        if not validar_telefone_br(v):
            raise ValueError("Telefone inválido - use DDD + número (10 ou 11 dígitos).")
        return v

    @model_validator(mode="after")
    def exigir_o_que_cada_tipo_precisa(self):
        if not self.email_contato and not self.telefone_whatsapp:
            raise ValueError("Informe um e-mail ou um telefone para a associação poder responder.")
        if self.tipo == "TITULAR_LGPD":
            if self.subtipo not in SUBTIPOS_DA_SOLICITACAO_DE_TITULAR:
                raise ValueError("Escolha o que você quer pedir sobre os seus dados.")
            if not self.cpf:
                raise ValueError("Informe o seu CPF: é com ele que a associação confere quem está pedindo.")
        elif self.tipo == "VOLUNTARIO":
            # o voluntariado não pede assunto (é sempre o mesmo) nem direito do titular; pede a data de nascimento (o termo de adesão de menor de 18 anos exige a autorização
            # de um responsável) e o CPF é opcional (a secretaria pede depois, para o termo)
            self.subtipo = None
            self.assunto = ASSUNTO_DO_VOLUNTARIADO
            if self.data_nascimento is None:
                raise ValueError("Informe a sua data de nascimento.")
            if self.data_nascimento > date.today():
                raise ValueError("A data de nascimento não pode ser no futuro.")
            if self.data_nascimento.year < 1900:
                raise ValueError("Confira a data de nascimento.")
        else:
            self.subtipo = None
            if not self.assunto or len(self.assunto) < 3:
                raise ValueError("Informe o assunto.")
        if self.tipo != "VOLUNTARIO":
            self.data_nascimento = None
        return self


class AtendimentoResponder(BaseModel):
    resposta: str


class AtendimentoEncerrar(BaseModel):
    motivo: str
