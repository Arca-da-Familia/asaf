from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import os

from app.database import preparar_banco, seed_catalogos, seed_niveis_e_permissoes, seed_configuracoes_institucionais
from app.routers import auth, core, associados, financeiro, governanca, projetos, admin_portal, filiacao, importacao, situacao, voluntariado, qualidade_cadastro
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

os.makedirs("uploads/fotos", exist_ok=True)

# ==========================================
# INICIALIZAÇÃO DO SERVIDOR E FRONTEND
# ==========================================
app = FastAPI(title="ERP ASAF - Versão Enterprise", version="2.0")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# CORS: o painel React (v0.2) chama a API de outra origem. Precisa de origem explícita
# (nunca "*") + allow_credentials para o cookie HttpOnly de refresh funcionar.
# Em dev, o Vite faz proxy para o backend; em produção a origem é o painel (asaf.org.br).
_origens_padrao = "http://localhost:5173,http://127.0.0.1:5173,https://painel.asaf.org.br"
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
app.include_router(admin_portal.router)
app.include_router(filiacao.router)
app.include_router(importacao.router)
app.include_router(situacao.router)
app.include_router(voluntariado.router)
app.include_router(qualidade_cadastro.router)

@app.get("/", response_class=HTMLResponse, summary="Página Inicial (Landing Page)")
def ler_pagina_inicial():
    # Lê o arquivo index.html da pasta templates diretamente, sem erros de cache do Jinja
    try:
        with open("templates/index.html", "r", encoding="utf-8") as arquivo:
            return arquivo.read()
    except FileNotFoundError:
        return "<h1>Erro: Arquivo templates/index.html não encontrado!</h1>"
