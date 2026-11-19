"""v9.5k - o desenho da credencial (o criador de credencial): as regras que todo modelo cumpre e os modelos prontos.

O cartão tem 85,6 x 54 mm (o tamanho do cartão de banco). Cada PARTE tem lugar e tamanho em milímetros (x e y a partir do canto de cima, à
esquerda). As faixas (retângulos de cor) ficam sempre por baixo de tudo; as outras partes, por cima, na ordem da lista.

O que todo modelo cumpre (o servidor recusa o que não cumpre, com o motivo em português; a tela mostra o mesmo aviso antes de guardar):
  - tem o NOME e o QR (o QR é a credencial: sem ele o cartão não confere nada); no máximo um de cada parte de dado (foto, nome, matrícula...),
    até 3 faixas e até 4 textos livres;
  - toda parte cabe dentro do cartão e tem pelo menos 2 mm de lado;
  - o QR é quadrado, tem pelo menos 18 mm (abaixo disso a leitura pelo celular falha) e nada além de faixa fica por cima ou por baixo dele;
  - letra entre 5 e 24 pontos; o texto de cada parte tem contraste de pelo menos 4,5 : 1 com TUDO o que fica atrás dele (a faixa ou o fundo
    do cartão), a mesma regra de contraste do painel;
  - texto livre de até 60 letras, sem quebra de linha.

O desenho não guarda dado de pessoa: nome, foto, matrícula, categoria e "associado desde" entram na hora de mostrar. A situação NÃO é parte do
cartão (ela muda; quem lê o QR vê a de agora), nem CPF, endereço ou telefone."""
import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, ValidationError

LARGURA_MM = 85.6
ALTURA_MM = 54.0
QR_MINIMO_MM = 18.0
LADO_MINIMO_MM = 2.0
LETRA_MINIMA, LETRA_MAXIMA = 5.0, 24.0
CONTRASTE_MINIMO = 4.5
MAXIMO_DE_TEXTO = 60
MAXIMO_DE_MODELOS_GUARDADOS = 30

TipoDeParte = Literal["faixa", "logo", "foto", "nome", "matricula", "categoria", "desde", "qr", "texto"]
COM_LETRA = {"nome", "matricula", "categoria", "desde", "texto"}
NO_MAXIMO_UMA = {"logo", "foto", "nome", "matricula", "categoria", "desde", "qr"}
LIMITE = {"faixa": 3, "texto": 4}
OBRIGATORIAS = ("nome", "qr")
NOME_DA_PARTE = {
    "faixa": "Faixa", "logo": "Logo da ASAF", "foto": "Foto", "nome": "Nome", "matricula": "Matrícula", "categoria": "Categoria",
    "desde": "Associado desde", "qr": "QR de conferência", "texto": "Texto",
}
_COR = r"^#[0-9a-fA-F]{6}$"
_FOLGA = 0.01  # milímetro: arredondamento do arrastar na tela


class Parte(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9-]{1,20}$")
    tipo: TipoDeParte
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    largura: float = Field(gt=0)
    altura: float = Field(gt=0)
    tamanho: Optional[float] = None  # pontos (letra), só nas partes com letra
    negrito: bool = False
    alinhamento: Literal["esquerda", "centro", "direita"] = "esquerda"
    cor: Optional[str] = Field(default=None, pattern=_COR)  # a cor da letra; na faixa, a cor da faixa
    texto: Optional[str] = None  # só no texto livre
    forma: Literal["retangulo", "redonda"] = "retangulo"  # só na foto


class Desenho(BaseModel):
    fundo: str = Field(pattern=_COR)
    partes: list[Parte] = Field(min_length=2, max_length=20)


def _luminancia(cor: str) -> float:
    def canal(v: int) -> float:
        c = v / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (int(cor[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)


def contraste(cor_a: str, cor_b: str) -> float:
    """A razão de contraste (WCAG) entre duas cores #rrggbb: de 1 (igual) a 21 (preto no branco)."""
    a, b = _luminancia(cor_a), _luminancia(cor_b)
    claro, escuro = max(a, b), min(a, b)
    return (claro + 0.05) / (escuro + 0.05)


def _sobrepoe(a: Parte, b: Parte) -> bool:
    return a.x < b.x + b.largura - _FOLGA and b.x < a.x + a.largura - _FOLGA and a.y < b.y + b.altura - _FOLGA and b.y < a.y + a.altura - _FOLGA


def _cobre(faixa: Parte, parte: Parte) -> bool:
    return (faixa.x <= parte.x + _FOLGA and faixa.y <= parte.y + _FOLGA and parte.x + parte.largura <= faixa.x + faixa.largura + _FOLGA
            and parte.y + parte.altura <= faixa.y + faixa.altura + _FOLGA)


def cores_atras(desenho: Desenho, parte: Parte) -> list[str]:
    """As cores que ficam atrás da parte: as faixas que encostam nela e, se nenhuma faixa a cobre inteira, o fundo do cartão."""
    faixas = [f for f in desenho.partes if f.tipo == "faixa" and f.cor and _sobrepoe(f, parte)]
    cores = [f.cor for f in faixas]
    if not any(_cobre(f, parte) for f in faixas):
        cores.append(desenho.fundo)
    return list(dict.fromkeys(c.lower() for c in cores))


def _numero(v: float) -> str:
    return f"{v:.1f}".replace(".", ",")


def problemas(desenho: Desenho) -> list[str]:
    """Tudo o que impede o modelo de ser guardado, em frases curtas (vazio = pode guardar)."""
    achados: list[str] = []
    ids = [p.id for p in desenho.partes]
    if len(set(ids)) != len(ids):
        achados.append("Duas partes com o mesmo identificador: recarregue o editor.")
    quantas: dict[str, int] = {}
    for p in desenho.partes:
        quantas[p.tipo] = quantas.get(p.tipo, 0) + 1
    for tipo in OBRIGATORIAS:
        if quantas.get(tipo, 0) == 0:
            achados.append(f"Falta a parte \"{NOME_DA_PARTE[tipo]}\": todo cartão tem o nome e o QR.")
    for tipo in NO_MAXIMO_UMA:
        if quantas.get(tipo, 0) > 1:
            achados.append(f"\"{NOME_DA_PARTE[tipo]}\" aparece mais de uma vez.")
    for tipo, limite in LIMITE.items():
        if quantas.get(tipo, 0) > limite:
            achados.append(f"No máximo {limite} partes \"{NOME_DA_PARTE[tipo]}\".")

    for p in desenho.partes:
        nome = NOME_DA_PARTE[p.tipo] if p.tipo != "texto" else f"Texto \"{(p.texto or '').strip()[:20]}\""
        if p.largura < LADO_MINIMO_MM - _FOLGA or p.altura < LADO_MINIMO_MM - _FOLGA:
            achados.append(f"{nome}: pequeno demais (o mínimo é {_numero(LADO_MINIMO_MM)} mm de lado).")
        if p.x + p.largura > LARGURA_MM + _FOLGA or p.y + p.altura > ALTURA_MM + _FOLGA:
            achados.append(f"{nome}: passa da borda do cartão.")
        if p.tipo == "qr":
            if abs(p.largura - p.altura) > 0.05:
                achados.append("QR de conferência: tem de ser quadrado.")
            if min(p.largura, p.altura) < QR_MINIMO_MM - _FOLGA:
                achados.append(f"QR de conferência: pequeno demais para o celular ler (o mínimo é {_numero(QR_MINIMO_MM)} mm).")
            for outra in desenho.partes:
                if outra is not p and outra.tipo != "faixa" and _sobrepoe(p, outra):
                    achados.append(f"{NOME_DA_PARTE[outra.tipo] if outra.tipo != 'texto' else 'Um texto'} está em cima do QR: o celular não lê.")
        if p.tipo == "faixa" and not p.cor:
            achados.append("Faixa sem cor.")
        if p.tipo == "texto":
            texto = (p.texto or "").strip()
            if not texto:
                achados.append("Texto vazio: escreva ou tire a parte.")
            elif len(texto) > MAXIMO_DE_TEXTO:
                achados.append(f"Texto com mais de {MAXIMO_DE_TEXTO} letras.")
            elif re.search(r"[\x00-\x1f\x7f]", texto):
                achados.append("Texto com quebra de linha ou caractere de controle.")
        if p.tipo in COM_LETRA:
            if p.tamanho is None or not (LETRA_MINIMA - _FOLGA <= p.tamanho <= LETRA_MAXIMA + _FOLGA):
                achados.append(f"{nome}: a letra vai de {_numero(LETRA_MINIMA)} a {_numero(LETRA_MAXIMA)} pontos.")
            if not p.cor:
                achados.append(f"{nome}: sem cor de letra.")
            else:
                for atras in cores_atras(desenho, p):
                    razao = contraste(p.cor, atras)
                    if razao < CONTRASTE_MINIMO:
                        achados.append(
                            f"{nome}: contraste {_numero(razao)} : 1 com o que fica atrás (o mínimo é {_numero(CONTRASTE_MINIMO)} : 1); escolha outra cor."
                        )
                        break
    return list(dict.fromkeys(achados))


def ler(dados: dict) -> Desenho:
    """O desenho guardado (já conferido quando foi guardado)."""
    return Desenho.model_validate(dados)


def erros_de_formato(erro: ValidationError) -> list[str]:
    return [f"Desenho inválido ({'.'.join(str(x) for x in e['loc'])}): {e['msg']}" for e in erro.errors()][:5]


# ---------------------------------------------------------------- os modelos prontos ----------------------------------------------------------------
VERDE = "#14532d"
BRANCO = "#ffffff"
TINTA = "#0b1611"
CINZA = "#525252"


def _p(id_: str, tipo: str, x: float, y: float, largura: float, altura: float, **extra) -> dict:
    return {"id": id_, "tipo": tipo, "x": x, "y": y, "largura": largura, "altura": altura, **extra}


PRONTOS: dict[str, dict] = {
    # o cartão da v9.5j (a folha A4 das credenciais emitidas)
    "faixa-no-alto": {
        "nome": "Faixa no alto",
        "desenho": {"fundo": BRANCO, "partes": [
            _p("faixa", "faixa", 0, 0, 85.6, 10, cor=VERDE),
            _p("logo", "logo", 3, 1.5, 8, 7),
            _p("asaf", "texto", 13, 1.3, 40, 4.4, tamanho=9, negrito=True, cor=BRANCO, texto="ASAF"),
            _p("subtitulo", "texto", 13, 5.4, 45, 3.4, tamanho=6.5, cor=BRANCO, texto="Credencial de associado"),
            _p("foto", "foto", 3, 17, 20, 26),
            _p("nome", "nome", 25.5, 17, 33.5, 10.5, tamanho=9, negrito=True, cor=TINTA),
            _p("matricula", "matricula", 25.5, 28, 33.5, 3.8, tamanho=7.5, cor=TINTA),
            _p("categoria", "categoria", 25.5, 32, 33.5, 3.8, tamanho=7.5, cor=TINTA),
            _p("desde", "desde", 25.5, 36.2, 33.5, 3.4, tamanho=6.5, cor=CINZA),
            _p("qr", "qr", 61, 17, 22, 22),
            _p("confira", "texto", 59.5, 39.6, 25, 3, tamanho=5.5, cor=CINZA, alinhamento="centro", texto="Confira a situação"),
        ]},
    },
    "faixa-do-lado": {
        "nome": "Faixa do lado",
        "desenho": {"fundo": BRANCO, "partes": [
            _p("faixa", "faixa", 0, 0, 27, 54, cor=VERDE),
            _p("logo", "logo", 8.5, 4, 10, 8.5),
            _p("foto", "foto", 3.5, 15, 20, 25),
            _p("asaf", "texto", 2, 42, 23, 4.6, tamanho=9, negrito=True, cor=BRANCO, alinhamento="centro", texto="ASAF"),
            _p("subtitulo", "texto", 1.5, 47, 24, 3.4, tamanho=5.5, cor=BRANCO, alinhamento="centro", texto="Credencial de associado"),
            _p("nome", "nome", 30, 6, 52, 11, tamanho=10, negrito=True, cor=TINTA),
            _p("matricula", "matricula", 30, 18.5, 30, 3.8, tamanho=7.5, cor=TINTA),
            _p("categoria", "categoria", 30, 23, 30, 3.8, tamanho=7.5, cor=TINTA),
            _p("desde", "desde", 30, 27.5, 30, 3.4, tamanho=6.5, cor=CINZA),
            _p("qr", "qr", 62, 28, 20, 20),
            _p("confira", "texto", 59, 49, 26, 3, tamanho=5.5, cor=CINZA, alinhamento="centro", texto="Confira a situação"),
        ]},
    },
    "foto-no-centro": {
        "nome": "Foto no centro",
        "desenho": {"fundo": BRANCO, "partes": [
            _p("faixa", "faixa", 0, 0, 85.6, 9, cor=VERDE),
            _p("logo", "logo", 3, 1.2, 7.5, 6.6),
            _p("asaf", "texto", 12.5, 2.3, 60, 4.4, tamanho=8, negrito=True, cor=BRANCO, texto="ASAF · Credencial de associado"),
            _p("foto", "foto", 18, 12, 20, 20, forma="redonda"),
            _p("nome", "nome", 3, 33.5, 50, 8, tamanho=9, negrito=True, cor=TINTA, alinhamento="centro"),
            _p("matricula", "matricula", 3, 42, 50, 3.6, tamanho=7.5, cor=TINTA, alinhamento="centro"),
            _p("categoria", "categoria", 3, 45.8, 50, 3.6, tamanho=7.5, cor=TINTA, alinhamento="centro"),
            _p("desde", "desde", 3, 49.6, 50, 3.2, tamanho=6.5, cor=CINZA, alinhamento="centro"),
            _p("qr", "qr", 61, 16, 21, 21),
            _p("confira", "texto", 58.5, 38, 26, 3, tamanho=5.5, cor=CINZA, alinhamento="centro", texto="Confira a situação"),
        ]},
    },
}
PADRAO = "faixa-no-alto"
