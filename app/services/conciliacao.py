"""v3.2 (FASE 3) - conciliação bancária MANUAL a partir de extrato (OFX/CSV) - a ASAF não tem
orçamento pra API paga de PSP/banco (achado confirmado com o usuário), então o fluxo real é: a
tesouraria baixa o extrato do próprio internet banking (grátis) e sobe aqui. Este módulo só
PARSEIA o arquivo e SUGERE correspondência por valor+data com os títulos em aberto - a baixa em
si é sempre confirmada por um humano (`POST /baixar-titulo/`), nunca automática."""
import csv
import io
import re
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.financeiro import TituloFinanceiro

JANELA_DIAS_SUGESTAO = 5


@dataclass
class TransacaoExtrato:
    data: datetime
    valor: Decimal
    descricao: str
    identificador: str


def _parse_valor(texto: str) -> Decimal:
    texto = texto.strip().replace("R$", "").strip()
    # aceita tanto "1.234,56" (padrão BR) quanto "1234.56" (padrão OFX/US)
    if "," in texto and texto.rfind(",") > texto.rfind("."):
        texto = texto.replace(".", "").replace(",", ".")
    try:
        return Decimal(texto)
    except InvalidOperation:
        raise HTTPException(status_code=400, detail=f"Valor inválido no extrato: '{texto}'.")


def _parse_data(texto: str) -> datetime:
    texto = texto.strip()
    for formato in ("%Y%m%d", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(texto, formato)
        except ValueError:
            continue
    raise HTTPException(status_code=400, detail=f"Data inválida no extrato: '{texto}'.")


def _parse_csv(conteudo: str) -> list[TransacaoExtrato]:
    """CSV com colunas `data,valor,descricao` (cabeçalho obrigatório, nessa ordem ou nomeado) -
    o formato mais comum de exportação de internet banking."""
    transacoes = []
    leitor = csv.DictReader(io.StringIO(conteudo))
    campos = {c.lower().strip(): c for c in (leitor.fieldnames or [])}
    campo_data = campos.get("data") or campos.get("date")
    campo_valor = campos.get("valor") or campos.get("value") or campos.get("amount")
    campo_descricao = campos.get("descricao") or campos.get("description") or campos.get("historico")
    if not campo_data or not campo_valor:
        raise HTTPException(status_code=400, detail="CSV precisa ter ao menos as colunas 'data' e 'valor'.")
    for i, linha in enumerate(leitor):
        transacoes.append(TransacaoExtrato(
            data=_parse_data(linha[campo_data]), valor=_parse_valor(linha[campo_valor]),
            descricao=(linha.get(campo_descricao) or "").strip() if campo_descricao else "",
            identificador=f"csv-{i}",
        ))
    return transacoes


_REGEX_STMTTRN = re.compile(r"<STMTTRN>(.*?)</STMTTRN>", re.DOTALL | re.IGNORECASE)
_REGEX_TAG = re.compile(r"<(\w+)>([^<\r\n]*)")


def _parse_ofx(conteudo: str) -> list[TransacaoExtrato]:
    """OFX é SGML, não XML bem-formado (tags sem fechamento) - um parser completo exigiria uma
    biblioteca nova só pra isso; como só precisamos de DTPOSTED/TRNAMT/MEMO/FITID de cada
    `<STMTTRN>`, uma extração por regex dá conta sem dependência nova."""
    transacoes = []
    for bloco in _REGEX_STMTTRN.findall(conteudo):
        campos = {tag.upper(): valor.strip() for tag, valor in _REGEX_TAG.findall(bloco)}
        if "DTPOSTED" not in campos or "TRNAMT" not in campos:
            continue
        transacoes.append(TransacaoExtrato(
            data=_parse_data(campos["DTPOSTED"][:8]), valor=_parse_valor(campos["TRNAMT"]),
            descricao=campos.get("MEMO", ""), identificador=campos.get("FITID", f"ofx-{len(transacoes)}"),
        ))
    if not transacoes:
        raise HTTPException(status_code=400, detail="Nenhuma transação (<STMTTRN>) encontrada no arquivo OFX.")
    return transacoes


def parse_extrato(nome_arquivo: str, conteudo: str) -> list[TransacaoExtrato]:
    if nome_arquivo.lower().endswith(".ofx"):
        return _parse_ofx(conteudo)
    if nome_arquivo.lower().endswith((".csv", ".txt")):
        return _parse_csv(conteudo)
    raise HTTPException(status_code=400, detail="Formato não suportado - envie um arquivo .ofx ou .csv.")


def sugerir_correspondencias(db: Session, transacoes: list[TransacaoExtrato]) -> list[dict]:
    """Sugestão por valor exato + data dentro de uma janela de alguns dias - confirmação
    continua sempre humana (`POST /baixar-titulo/`), isto só poupa procurar título por título."""
    titulos_abertos = db.query(TituloFinanceiro).filter(TituloFinanceiro.status != "Pago").all()

    resultado = []
    for transacao in transacoes:
        valor_absoluto = abs(transacao.valor)
        candidatos = [
            {"id_titulo": t.id_titulo, "descricao": t.descricao, "tipo_titulo": t.tipo_titulo, "saldo_devedor": t.saldo_devedor}
            for t in titulos_abertos
            if t.saldo_devedor == valor_absoluto and abs((t.data_vencimento - transacao.data).days) <= JANELA_DIAS_SUGESTAO
        ]
        resultado.append({
            "identificador": transacao.identificador, "data": transacao.data.date().isoformat(),
            "valor": transacao.valor, "descricao": transacao.descricao, "sugestoes": candidatos,
        })
    return resultado
