from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
import os

from app.database import preparar_banco, seed_opcoes_lista, seed_niveis_e_permissoes
from app.routers import auth, core, associados, financeiro, governanca, projetos, admin_portal

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
seed_opcoes_lista()
seed_niveis_e_permissoes()

os.makedirs("uploads/fotos", exist_ok=True)

# ==========================================
# INICIALIZAÇÃO DO SERVIDOR E FRONTEND
# ==========================================
app = FastAPI(title="ERP ASAF - Versão Enterprise", version="2.0")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


app.include_router(auth.router)
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
