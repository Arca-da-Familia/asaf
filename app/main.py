from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
import os

from app.database import preparar_banco, seed_catalogos, seed_niveis_e_permissoes, seed_configuracoes_institucionais, seed_regras_estatutarias
from app.services import armazenamento
from app.routers import publico, arquivos, auth, core, associados, financeiro, governanca, projetos, filiacao, importacao, situacao, voluntariado, qualidade_cadastro, estatuto, mandatos, sessao_assembleia, votacao, ata, conselho_fiscal, disciplina, dissolucao, calendario, chamada, compras, doacoes, orcamento, relatorios, antifraude, motores, beneficiarios, espacos, eventos, portaria, certificados, pesquisa_satisfacao, documentos, parcerias
from app.security import decodificar_access_token_silencioso

# A auditoria de schema (preparar_banco) audita as ~50 tabelas uma a uma a cada start -
# em produção (Postgres na nuvem) isso passou de 27s e estourou o startup probe do
# Container App, causando reinício em loop. Roda por padrão em dev local; em produção
# fica desligada por variável de ambiente - schema de produção agora é responsabilidade
# do Alembic (RUN_DB_MIGRATION=true só serve pra conveniência de dev local, nunca deveria
# ser ligado em produção de novo).
if os.environ.get("RUN_DB_MIGRATION", "true").lower() != "false":
    preparar_banco()

# Seeds são rápidos (poucas consultas "já existe?" idempotentes) e SEMPRE rodam, mesmo em
# produção com RUN_DB_MIGRATION=false - achado real desta sessão: estavam amarrados à mesma
# flag da auditoria lenta, então nunca tinham rodado de fato contra o banco de produção.
seed_catalogos()
seed_niveis_e_permissoes()
seed_configuracoes_institucionais()
seed_regras_estatutarias()



@asynccontextmanager
async def _ciclo_de_vida(_app: FastAPI):
    """Trava de armazenamento (achado de 2026-10-01: a API gravava foto/ata/comprovante no disco
    EFÊMERO do contêiner e os arquivos sumiam a cada deploy/reinício). `obter()` RECUSA subir no
    Azure sem `ARMAZENAMENTO_BLOB_URL`; `verificar()` grava, lê e apaga uma sonda no Blob - se a
    identidade, o papel (RBAC) ou a rede não funcionam, a revisão nova NÃO fica saudável e o Azure
    mantém a anterior servindo: o problema aparece no deploy, não no upload de um associado."""
    armazenamento_ativo = armazenamento.obter()
    await run_in_threadpool(armazenamento_ativo.verificar)
    await run_in_threadpool(_migrar_atas_para_documentos)
    yield


def _migrar_atas_para_documentos() -> None:
    """v5.4a - a ata assinada deixou de ser servida em `/uploads/atas` (tem RG/CPF): copia as que ainda estão lá
    para a biblioteca de Documentos (original privado). Idempotente, não faz nada quando não há ata antiga, e uma
    falha aqui NUNCA impede a API de subir (fica no log e roda de novo no próximo início)."""
    from app.database import SessaoLocal
    from app.services.documentos_institucionais import migrar_atas_legadas

    try:
        with SessaoLocal() as db:
            resultado = migrar_atas_legadas(db)
        if any(resultado.values()):
            armazenamento.LOG.warning("atas antigas copiadas para a biblioteca de Documentos: %s", resultado)
    except Exception:  # noqa: BLE001
        armazenamento.LOG.exception("não foi possível migrar as atas antigas para a biblioteca de Documentos")


# ==========================================
# INICIALIZAÇÃO DO SERVIDOR E FRONTEND
# ==========================================
app = FastAPI(title="ERP ASAF - Versão Enterprise", version="2.0", lifespan=_ciclo_de_vida)

# CORS: o painel React (v0.2) chama a API de outra origem. Precisa de origem explícita
# (nunca "*") + allow_credentials para o cookie HttpOnly de refresh funcionar.
# Em dev, o Vite faz proxy para o backend; em produção a origem é o painel (painel.asaf.org.br).
# v5.0 - o site institucional (https://asaf.org.br) também chama a API do navegador, para o dado
# dinâmico das ilhas (eventos abertos, depois transparência) sem exigir rebuild do site a cada
# inscrição. Só as rotas públicas de leitura (/api/publico/...) servem a ele; o resto continua
# exigindo JWT, então liberar a origem não dá acesso novo a nada.
_origens_padrao = (
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4321,http://127.0.0.1:4321,"
    "https://painel.asaf.org.br,https://asaf.org.br"
)
_origens = [o.strip() for o in os.environ.get("CORS_ORIGINS", _origens_padrao).split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origens,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# v0.2.9 - reforço de "somente leitura" do modo "ver como": mesmo que o nível impersonado
# tenha alguma permissão de escrita, NENHUMA rota mutante roda enquanto o token carregar o
# claim de impersonação. Isto é defesa em profundidade além do usuario_tem_permissao já usar o
# nível impersonado (security.py) - se uma rota nova esquecer de checar permissão certo, ainda
# assim não escreve nada em modo impersonação.
_ROTAS_SEMPRE_PERMITIDAS_EM_IMPERSONACAO = {"/auth/logout", "/auth/impersonar/parar", "/auth/refresh"}


@app.middleware("http")
async def bloquear_escrita_em_impersonacao(request: Request, call_next):
    if (
        request.method in ("POST", "PUT", "PATCH", "DELETE")
        and request.url.path not in _ROTAS_SEMPRE_PERMITIDAS_EM_IMPERSONACAO
    ):
        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            payload = decodificar_access_token_silencioso(auth_header[7:])
            if payload and payload.get("id_nivel_impersonado"):
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Modo \"ver como\" é somente leitura — nenhuma escrita é permitida."},
                )
    return await call_next(request)


app.include_router(auth.router)
app.include_router(core.router)
app.include_router(associados.router)
app.include_router(financeiro.router)
app.include_router(governanca.router)
app.include_router(projetos.router)
app.include_router(filiacao.router)
app.include_router(importacao.router)
app.include_router(situacao.router)
app.include_router(voluntariado.router)
app.include_router(qualidade_cadastro.router)
app.include_router(estatuto.router)
app.include_router(mandatos.router)
app.include_router(sessao_assembleia.router)
app.include_router(votacao.router)
app.include_router(ata.router)
app.include_router(conselho_fiscal.router)
app.include_router(disciplina.router)
app.include_router(dissolucao.router)
app.include_router(calendario.router)
app.include_router(chamada.router)
app.include_router(compras.router)
app.include_router(doacoes.router)
app.include_router(orcamento.router)
app.include_router(relatorios.router)
app.include_router(antifraude.router)
app.include_router(motores.router)
app.include_router(beneficiarios.router)
app.include_router(espacos.router)
app.include_router(eventos.router)
app.include_router(portaria.router)
app.include_router(certificados.router)
app.include_router(pesquisa_satisfacao.router)
app.include_router(arquivos.router)
app.include_router(documentos.router)
app.include_router(parcerias.router)
app.include_router(publico.router)

@app.get("/", response_class=HTMLResponse, summary="Página Inicial (Landing Page)")
def ler_pagina_inicial():
    # Lê o arquivo index.html da pasta templates diretamente, sem erros de cache do Jinja
    try:
        with open("templates/index.html", "r", encoding="utf-8") as arquivo:
            return arquivo.read()
    except FileNotFoundError:
        return "<h1>Erro: Arquivo templates/index.html não encontrado!</h1>"
