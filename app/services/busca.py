"""Ajudante das buscas por texto das listas (associados, Razão): quando o que a pessoa digitou é um número, ele pode ser a matrícula ou o número de um lançamento."""
from typing import Optional

# as colunas de número (matrícula, número do lançamento) são inteiros de 32 bits no Postgres: comparar com um número maior (um CPF inteiro, o número de uma rodada de
# testes) é recusado com "integer out of range". O SQLite dos testes não reclama, por isso o teste confere a consulta como o Postgres a recebe.
LIMITE_DO_INTEIRO_DO_BANCO = 2_147_483_647


def numero_que_cabe_no_banco(texto: str) -> Optional[int]:
    """O número escrito em `texto`, se for só dígitos e couber numa coluna de inteiro; senão `None` (e aí a busca segue só pelos campos de texto)."""
    if not texto.isascii() or not texto.isdigit():
        return None
    numero = int(texto)
    return numero if numero <= LIMITE_DO_INTEIRO_DO_BANCO else None
