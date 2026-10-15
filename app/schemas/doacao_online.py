"""v5.6a - corpo das rotas de doação pelo site (público) e da confirmação pelo Tesoureiro (painel)."""
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, field_validator

from app.validadores import somente_digitos, validar_cpf

VALOR_MAXIMO_DA_DOACAO = Decimal("1000000")


def validar_valor_da_doacao(v: Optional[Decimal], obrigatorio: bool) -> Optional[Decimal]:
    if v is None:
        if obrigatorio:
            raise ValueError("Informe o valor.")
        return None
    if v <= 0:
        raise ValueError("O valor da doação precisa ser maior que zero.")
    if v > VALOR_MAXIMO_DA_DOACAO:
        raise ValueError("Esse valor é alto demais para o Pix pelo site: fale com a secretaria.")
    return v.quantize(Decimal("0.01"))


class IntencaoDeDoacaoCriar(BaseModel):
    """Doação IDENTIFICADA pelo site. `pagina_web` é a armadilha para robôs (um campo que a pessoa nunca vê nem preenche). O valor é opcional: quem deixa em branco digita no app do banco."""
    nome_completo: str
    email: str
    cpf: Optional[str] = None
    valor: Optional[Decimal] = None
    id_campanha: Optional[int] = None
    consentimento_lgpd: bool = False
    versao_texto_consentimento: Optional[str] = None
    pagina_web: Optional[str] = None

    @field_validator("nome_completo")
    @classmethod
    def validar_nome(cls, v):
        v = " ".join((v or "").split())
        if len(v) < 3:
            raise ValueError("Informe o seu nome completo.")
        if len(v) > 120:
            raise ValueError("O nome ficou grande demais: confira.")
        return v

    @field_validator("email", mode="before")
    @classmethod
    def validar_email_em_portugues(cls, v):
        try:
            from email_validator import EmailNotValidError, validate_email

            return validate_email(str(v or "").strip(), check_deliverability=False).normalized
        except EmailNotValidError:
            raise ValueError("Esse e-mail não parece certo: confira se está escrito sem erro.")

    @field_validator("cpf", mode="before")
    @classmethod
    def validar_cpf_opcional(cls, v):
        if v is None or str(v).strip() == "":
            return None
        if not validar_cpf(str(v)):
            raise ValueError("Esse CPF não confere: confira os números ou deixe em branco.")
        return somente_digitos(str(v))

    @field_validator("valor")
    @classmethod
    def validar_valor(cls, v):
        return validar_valor_da_doacao(v, obrigatorio=False)


class ConfirmarIntencaoDeDoacao(BaseModel):
    """O Tesoureiro achou o dinheiro no extrato: o valor RECEBIDO (pode diferir do informado), as contas e, se houver, a destinação."""
    valor_recebido: Decimal
    id_conta_contabil: int
    id_conta_contabil_caixa: int
    id_centro_custo_destinacao: Optional[int] = None

    @field_validator("valor_recebido")
    @classmethod
    def validar_valor(cls, v):
        return validar_valor_da_doacao(v, obrigatorio=True)


class IntencaoNaoLocalizada(BaseModel):
    observacao: Optional[str] = None

    @field_validator("observacao")
    @classmethod
    def validar_observacao(cls, v):
        v = (v or "").strip()
        return v[:300] or None
