"""v5.4b (FASE 5) - tratamento comum das FOTOS do sistema que vão ao site (etapa de parceria, edição de evento).

Foto de oficina, entrega ou evento mostra pessoas (muitas vezes crianças). Regras que valem para toda foto publicada:
  - só entra com a confirmação de autorização de uso de imagem (dos responsáveis, no caso de criança ou adolescente) e com a
    descrição para quem não enxerga (texto alternativo), que passa pelo verificador de dado pessoal;
  - a imagem é REGRAVADA no servidor: some tudo que o celular escreveu dentro do arquivo (localização/GPS, modelo do aparelho,
    data), a rotação é aplicada, o lado maior fica em até 2000 px e o formato é sempre JPEG. O arquivo original nunca é guardado;
  - o arquivo fica em armazenamento PRIVADO; ao público só chega por rota que confere a situação a cada pedido, e o site copia a
    foto no build conferindo o SHA-256;
  - quem retira a autorização pode APAGAR a foto: some do sistema e, na próxima publicação, do site (a auditoria registra quem
    apagou). O Azure guarda uma cópia de segurança por 30 dias (apagamento reversível, versionamento) antes de apagar de vez."""
from __future__ import annotations

import io
import warnings

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

from app.services.documentos_verificacao import exigir_texto_sem_dado_pessoal

TAMANHO_MAXIMO_DO_ARQUIVO = 10 * 1024 * 1024
LADO_MAXIMO = 2000
PIXELS_MAXIMOS = 50_000_000  # recusa imagem gigante (bomba de descompressão)
FOTOS_POR_ETAPA = 12
FOTOS_POR_EVENTO = 40
ALT_MINIMO, ALT_MAXIMO = 10, 300
_ASSINATURAS = {b"\xff\xd8\xff": "JPEG", b"\x89PNG\r\n\x1a\n": "PNG", b"RIFF": "WEBP"}

MENSAGEM_SEM_AUTORIZACAO = (
    "Sem a autorização de uso de imagem a foto não é aceita: confirme que as pessoas que aparecem "
    "(ou os responsáveis, no caso de criança e adolescente) autorizaram."
)


def formato_pela_assinatura(conteudo: bytes) -> str | None:
    for assinatura, nome in _ASSINATURAS.items():
        if conteudo.startswith(assinatura):
            if nome == "WEBP" and conteudo[8:12] != b"WEBP":
                return None
            return nome
    return None


def tratar_imagem(conteudo: bytes) -> tuple[bytes, int, int]:
    """Imagem aceita -> (JPEG novo, largura, altura). Recusa o que não for JPEG/PNG/WEBP de verdade."""
    if len(conteudo) > TAMANHO_MAXIMO_DO_ARQUIVO:
        raise HTTPException(status_code=400, detail=f"Foto muito grande (máximo {TAMANHO_MAXIMO_DO_ARQUIVO // (1024 * 1024)} MB).")
    if formato_pela_assinatura(conteudo) is None:
        raise HTTPException(status_code=400, detail="Formato não suportado. Use foto JPG, PNG ou WEBP.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            Image.MAX_IMAGE_PIXELS = PIXELS_MAXIMOS
            imagem = Image.open(io.BytesIO(conteudo))
            imagem.load()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(status_code=400, detail="Não consegui abrir a foto (arquivo danificado ou grande demais).")
    imagem = ImageOps.exif_transpose(imagem)  # aplica a rotação que o celular só anotou
    if imagem.mode in ("RGBA", "LA", "P"):
        fundo = Image.new("RGB", imagem.size, (255, 255, 255))
        imagem = imagem.convert("RGBA")
        fundo.paste(imagem, mask=imagem.split()[-1])
        imagem = fundo
    else:
        imagem = imagem.convert("RGB")
    imagem.thumbnail((LADO_MAXIMO, LADO_MAXIMO))
    # O Pillow devolve para o arquivo novo o que veio em `info` (inclusive o COMENTÁRIO do JPEG, onde há programa que escreve
    # texto livre): limpa, para nada do arquivo original ir junto. Exif, XMP e perfil de cor já não vão (não passam por aqui).
    imagem.info = {}
    saida = io.BytesIO()
    imagem.save(saida, format="JPEG", quality=85, optimize=True)  # sem exif=: nenhum metadado vai junto
    return saida.getvalue(), imagem.width, imagem.height


def remover_arquivo(pasta: str, nome: str) -> None:
    """Apaga o arquivo da foto do armazenamento. Se NÃO conseguir, avisa (a pessoa tenta de novo) em vez de mostrar sucesso com a
    foto ainda lá: quem retirou a autorização precisa saber. (O Azure ainda guarda uma cópia de segurança por 30 dias.)"""
    from app.services import armazenamento

    try:
        armazenamento.obter().remover(pasta, nome)
    except Exception:  # noqa: BLE001
        armazenamento.LOG.exception("não foi possível apagar a foto %s/%s", pasta, nome)
        raise HTTPException(
            status_code=502,
            detail="Não consegui apagar o arquivo da foto do armazenamento. A foto continua cadastrada: tente de novo em instantes.",
        )


def validar_alt(alt: str | None) -> str:
    """Texto alternativo (descrição da foto para quem não enxerga): tamanho certo e sem dado pessoal."""
    texto = (alt or "").strip()
    if not ALT_MINIMO <= len(texto) <= ALT_MAXIMO:
        raise HTTPException(
            status_code=400,
            detail=f"Descreva a foto para quem não enxerga ({ALT_MINIMO} a {ALT_MAXIMO} caracteres). "
                   "Ex.: Crianças tocando tambores na quadra da escola. Não escreva nomes de pessoas.",
        )
    exigir_texto_sem_dado_pessoal({"descrição da foto": texto})
    return texto
