"""v5.4h (FASE 5): regras do formulário público de filiação do site (Estatuto Art. 12): idade e aviso de privacidade.

O Estatuto admite filiação de maiores de dezoito anos e, a partir dos dezesseis, com autorização expressa dos pais ou responsáveis. O formulário
só recebe a DECLARAÇÃO de que a autorização existe (o papel é conferido pela secretaria na análise documental). O aviso de privacidade tem versão:
o site manda a versão que mostrou e o servidor recusa se o texto mudou, para ninguém aceitar um texto que não leu."""
from datetime import date

from fastapi import HTTPException

VERSAO_AVISO_DE_PRIVACIDADE_FILIACAO = "1"
IDADE_MINIMA_COM_AUTORIZACAO = 16
MAIORIDADE = 18

# a mesma frase para "já é sócio" e para "já tem pedido em andamento": quem está de fora não descobre se um CPF é de associado
RECUSA_DE_DUPLICIDADE = "Já existe um pedido em andamento ou um cadastro com estes dados. Fale com a secretaria para saber a situação."


def idade_em(nascimento: date, hoje: date) -> int:
    return hoje.year - nascimento.year - ((hoje.month, hoje.day) < (nascimento.month, nascimento.day))


def exigir_idade_do_estatuto(nascimento: date, autorizacao_responsavel: bool, hoje: date | None = None) -> None:
    idade = idade_em(nascimento, hoje or date.today())
    if idade < IDADE_MINIMA_COM_AUTORIZACAO:
        raise HTTPException(status_code=400, detail=f"O Estatuto (Art. 12) só admite filiação a partir dos {IDADE_MINIMA_COM_AUTORIZACAO} anos.")
    if idade < MAIORIDADE and not autorizacao_responsavel:
        raise HTTPException(
            status_code=400,
            detail=(
                f"De {IDADE_MINIMA_COM_AUTORIZACAO} a {MAIORIDADE - 1} anos o Estatuto (Art. 12) exige a autorização expressa dos pais ou responsáveis: "
                "marque a declaração e entregue a autorização à secretaria."
            ),
        )


def exigir_aviso_de_privacidade(aceito: bool, versao: str | None) -> None:
    if not aceito:
        raise HTTPException(status_code=400, detail="Para enviar o pedido é preciso ler e aceitar o aviso de privacidade.")
    if versao != VERSAO_AVISO_DE_PRIVACIDADE_FILIACAO:
        raise HTTPException(status_code=422, detail="O aviso de privacidade foi atualizado: recarregue a página, leia e aceite a versão atual.")
