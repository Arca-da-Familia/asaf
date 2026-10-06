"""Texto para gente ler: dinheiro no padrão brasileiro (R$ 1.234,56), nunca o ponto decimal do Python (1234.56)."""
from decimal import Decimal


def reais(valor) -> str:
    """`R$ 1.234,56` - milhar com ponto, centavos com vírgula; aceita Decimal, int, float ou texto numérico."""
    numero = Decimal(str(valor)).quantize(Decimal("0.01"))
    negativo = numero < 0
    inteiro, centavos = f"{abs(numero):.2f}".split(".")
    com_milhar = f"{int(inteiro):,}".replace(",", ".")
    return f"{'-' if negativo else ''}R$ {com_milhar},{centavos}"
