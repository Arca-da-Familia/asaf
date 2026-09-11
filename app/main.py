from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
import os

from app.database import preparar_banco, seed_opcoes_lista
from app.routers import core, associados, financeiro, governanca, projetos, admin_portal

# A auditoria de schema (preparar_banco) audita as ~50 tabelas uma a uma a cada start -
# em produção (Postgres na nuvem) isso passou de 27s e estourou o startup probe do
# Container App, causando reinício em loop. Roda por padrão em dev local; em produção
# fica desligada por variável de ambiente até virar um passo de migração explícito
# separado do boot da aplicação (RUN_DB_MIGRATION=true força rodar mesmo em produção,
# ex.: logo após alterar um Model).
if os.environ.get("RUN_DB_MIGRATION", "true").lower() != "false":
    preparar_banco()

if os.environ.get("RUN_DB_MIGRATION", "true").lower() != "false":
    seed_opcoes_lista()

os.makedirs("uploads/fotos", exist_ok=True)

# ==========================================
# INICIALIZAÇÃO DO SERVIDOR E FRONTEND
# ==========================================
app = FastAPI(title="ERP ASAF - Versão Enterprise", version="2.0")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


app.include_router(core.router)
app.include_router(associados.router)
app.include_router(financeiro.router)
app.include_router(governanca.router)
app.include_router(projetos.router)
app.include_router(admin_portal.router)

@app.get("/", response_class=HTMLResponse, summary="Página Inicial (Landing Page)")
def ler_pagina_inicial():
    # Lê o arquivo index.html da pasta templates diretamente, sem erros de cache do Jinja
    try:
        with open("templates/index.html", "r", encoding="utf-8") as arquivo:
            return arquivo.read()
    except FileNotFoundError:
        return "<h1>Erro: Arquivo templates/index.html não encontrado!</h1>"
