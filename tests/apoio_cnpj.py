"""CNPJ de teste com os dígitos verificadores certos (a API recusa CNPJ que não confere)."""


def cnpj_valido(raiz: int) -> str:
    """14 dígitos: 8 da raiz inventada + filial 9999 (que não existe de verdade) + os dois dígitos verificadores."""
    base = f"{raiz % 10**8:08d}9999"

    def _digito(digitos: str, pesos: list[int]) -> int:
        resto = sum(int(d) * p for d, p in zip(digitos, pesos)) % 11
        return 0 if resto < 2 else 11 - resto

    dv1 = _digito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    dv2 = _digito(base + str(dv1), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return f"{base}{dv1}{dv2}"
