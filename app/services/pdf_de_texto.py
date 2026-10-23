"""v7.0c - um PDF de texto corrido em A4 (o ato do encarregado, o inventário de dados): quebra de linha pela largura real da fonte e página nova quando acaba o
espaço. O motor de documentos emitidos (app/services/documentos.py) é para certificado e crachá, de uma página; este é para o texto que pode ser longo."""
import io

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

_FONTE, _FONTE_TITULO, _CORPO, _ENTRELINHA = "Helvetica", "Helvetica-Bold", 11, 0.55 * cm


def _quebrar(texto: str, largura: float, fonte: str, tamanho: float) -> list[str]:
    linhas, atual = [], ""
    for palavra in texto.split(" "):
        candidato = f"{atual} {palavra}".strip()
        if atual and stringWidth(candidato, fonte, tamanho) > largura:
            linhas.append(atual)
            atual = palavra
        else:
            atual = candidato
    linhas.append(atual)
    return linhas


def gerar(titulo_do_arquivo: str, paragrafos: list[str], rodape: str, *, titulos: frozenset = frozenset({0}), tamanho: float = _CORPO) -> bytes:
    """`paragrafos`: uma linha de texto por item ("" = linha em branco). Os índices em `titulos` saem em negrito."""
    saida = io.BytesIO()
    c = canvas.Canvas(saida, pagesize=A4)
    c.setTitle(titulo_do_arquivo)
    largura, altura = A4
    margem = 2.2 * cm
    util = largura - 2 * margem
    entrelinha = _ENTRELINHA * tamanho / _CORPO
    y = altura - margem

    def escrever_rodape():
        c.setFont("Helvetica-Oblique", 8)
        c.drawString(margem, margem / 2, rodape)

    for indice, paragrafo in enumerate(paragrafos):
        fonte = _FONTE_TITULO if indice in titulos else _FONTE
        # o texto digitado num campo pode ter quebras de linha: cada uma vira linha própria (sem isso, o PDF juntava tudo)
        linhas = [pedaco for parte in paragrafo.split("\n") for pedaco in (_quebrar(parte, util, fonte, tamanho) if parte else [""])] if paragrafo else [""]
        for linha in linhas:
            if y < margem + entrelinha:
                escrever_rodape()
                c.showPage()
                y = altura - margem
            c.setFont(fonte, tamanho)
            c.drawString(margem, y, linha)
            y -= entrelinha
    escrever_rodape()
    c.showPage()
    c.save()
    return saida.getvalue()
