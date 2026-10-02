"""Serve os arquivos enviados (`/uploads/<pasta>/<nome>`) a partir do armazenamento persistente.

Substitui o `StaticFiles(directory="uploads")` que lia o disco efêmero do contêiner. O contrato de
URL é o mesmo (o que está gravado no banco e o que o painel abre continua valendo). Continua SEM
login - o painel abre foto/documento por link direto e o QR/certificado público depende disso -, e
por isso a única barreira é o nome aleatório (ver `app/services/armazenamento.py`).

Defesas: pasta e nome passam por lista/regex fixos (sem path traversal); só se serve PDF/JPG/PNG/WEBP,
com `nosniff` e `Content-Disposition` conforme o tipo (nunca HTML/SVG vindo de upload)."""
from fastapi import APIRouter, HTTPException, Response
from fastapi.concurrency import run_in_threadpool

from app.services import armazenamento

router = APIRouter()


@router.get("/uploads/{pasta}/{nome}", summary="Baixar arquivo enviado", include_in_schema=False)
async def baixar_arquivo(pasta: str, nome: str):
    try:
        armazenamento.validar(pasta, nome)
    except armazenamento.ArmazenamentoInvalido:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")
    tipo = armazenamento.tipo_servido(nome)
    if tipo is None:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")

    conteudo = await run_in_threadpool(armazenamento.obter().ler, pasta, nome)
    if conteudo is None:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")

    return Response(
        content=conteudo,
        media_type=tipo,
        headers={
            "X-Content-Type-Options": "nosniff",
            # Nome aleatório é feio para quem salva: o navegador abre inline, mas o "salvar como"
            # sugere o nome do arquivo mesmo assim.
            "Content-Disposition": f'inline; filename="{nome}"',
            # Arquivo com nome aleatório nunca muda de conteúdo; cache privado de 1 h poupa leitura
            # do Blob (a rota é pública, mas o conteúdo é de associado: nada de cache compartilhado).
            "Cache-Control": "private, max-age=3600",
        },
    )
