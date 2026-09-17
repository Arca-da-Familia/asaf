"""v3.2 (FASE 3) - Pix ESTÁTICO (BR Code / "copia e cola"), gerado 100% localmente a partir do
Manual de Padrões para Iniciação do Pix (Banco Central) - nenhuma chamada a API de banco/PSP.
É o único caminho possível hoje (achado confirmado com o usuário: a ASAF não tem convênio de
boleto nem orçamento pra API paga de PSP) - o associado copia o código, paga pelo próprio banco,
anexa o comprovante (`POST /api/comprovantes/`) e a tesouraria confirma a baixa manualmente.
Confirmação automática de pagamento (webhook de PSP) fica para quando houver orçamento - mesma
pendência já registrada na v3.2.1 (Pix Automático)."""
import unicodedata
from decimal import Decimal
from typing import Optional

_GUI_PIX = "br.gov.bcb.pix"


def _campo(id_campo: str, valor: str) -> str:
    return f"{id_campo}{len(valor):02d}{valor}"


def _crc16_ccitt_false(payload: str) -> str:
    """CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, sem reflexão) - o algoritmo exigido pelo
    padrão EMV(R) QR Code que o Pix usa, calculado sobre o payload inteiro até e incluindo o
    "6304" do próprio campo do CRC (o valor do CRC não entra no cálculo dele mesmo)."""
    polinomio = 0x1021
    resultado = 0xFFFF
    for byte in payload.encode("utf-8"):
        resultado ^= byte << 8
        for _ in range(8):
            if resultado & 0x8000:
                resultado = ((resultado << 1) ^ polinomio) & 0xFFFF
            else:
                resultado = (resultado << 1) & 0xFFFF
    return f"{resultado:04X}"


def _sanitizar(texto: str, tamanho_maximo: int) -> str:
    # BR Code só aceita ASCII sem acento em nome/cidade/descrição - remove diacríticos e corta.
    sem_acento = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    limpo = sem_acento.strip() or "NA"
    return limpo[:tamanho_maximo]


def gerar_payload_pix(
    *, chave_pix: str, nome_beneficiario: str, cidade_beneficiario: str,
    valor: Decimal, txid: str, descricao: Optional[str] = None,
) -> str:
    """Gera o "copia e cola" (BR Code) de uma cobrança Pix ESTÁTICA com valor fixo, identificada
    por `txid` (usado aqui como o id do título - permite reconhecer de qual cobrança veio quando
    o comprovante chegar, mesmo sem confirmação automática)."""
    txid_normalizado = "".join(c for c in txid if c.isalnum())[:25] or "***"
    conta_pix = _campo("00", _GUI_PIX) + _campo("01", chave_pix.strip())
    if descricao:
        conta_pix += _campo("02", _sanitizar(descricao, 40))

    campos = (
        _campo("00", "01")
        + _campo("26", conta_pix)
        + _campo("52", "0000")
        + _campo("53", "986")
        + _campo("54", f"{valor:.2f}")
        + _campo("58", "BR")
        + _campo("59", _sanitizar(nome_beneficiario, 25))
        + _campo("60", _sanitizar(cidade_beneficiario, 15))
        + _campo("62", _campo("05", txid_normalizado))
    )
    payload_sem_crc = campos + "6304"
    return payload_sem_crc + _crc16_ccitt_false(payload_sem_crc)
