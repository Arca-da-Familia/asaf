"""v1.1 - validadores reais de dado pessoal (antes só existiam no cliente, painel/src/lib/cpf.ts
- validar só no front deixa a API aceita qualquer POST direto). Algoritmo de CPF é o mesmo do
painel (módulo 11), portado pra manter os dois lados de acordo."""
import re
from datetime import date, datetime
from typing import Optional


def somente_digitos(valor: str) -> str:
    return re.sub(r"\D", "", valor or "")


def validar_cpf(cpf: str) -> bool:
    digitos = somente_digitos(cpf)
    if len(digitos) != 11:
        return False
    if digitos == digitos[0] * 11:  # sequência de dígitos iguais (111.111.111-11) passa no
        return False                # cálculo mas não é CPF real - mesma regra do painel.

    def _calcular_digito(base: str, peso_inicial: int) -> int:
        soma = sum(int(d) * peso for d, peso in zip(base, range(peso_inicial, 1, -1)))
        resto = (soma * 10) % 11
        return 0 if resto == 10 else resto

    dv1 = _calcular_digito(digitos[:9], 10)
    dv2 = _calcular_digito(digitos[:9] + str(dv1), 11)
    return dv1 == int(digitos[9]) and dv2 == int(digitos[10])


def validar_telefone_br(telefone: str) -> bool:
    """Aceita celular (11 dígitos, DDD + 9XXXXXXXX) ou fixo (10 dígitos, DDD + XXXXXXXX)."""
    digitos = somente_digitos(telefone)
    if len(digitos) not in (10, 11):
        return False
    ddd = int(digitos[:2])
    if ddd < 11 or ddd > 99:
        return False
    if len(digitos) == 11 and digitos[2] != "9":
        return False
    return True


def validar_data_nascimento_coerente(data_nascimento: Optional[date], idade_maxima: int = 130) -> bool:
    if data_nascimento is None:
        return True
    hoje = datetime.utcnow().date()
    if data_nascimento > hoje:
        return False
    idade = hoje.year - data_nascimento.year - (
        (hoje.month, hoje.day) < (data_nascimento.month, data_nascimento.day)
    )
    return 0 <= idade <= idade_maxima
