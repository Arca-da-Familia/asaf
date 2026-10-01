# Arquitetura do Sistema ASAF

> Este documento existe para que qualquer pessoa que venha a manter este sistema no futuro —
> daqui a 1 ano ou daqui a 20 — entenda as decisões principais sem precisar reconstruir esse
> raciocínio do zero. Atualizar sempre que uma decisão de arquitetura mudar de verdade, não é
> um documento "escreve uma vez e esquece".
>
> **Nunca coloque senha, chave ou string de conexão aqui.** Isso vive só em
> `CREDENCIAIS_AZURE.md` (arquivo local, fora do Git) — este documento é público, faz parte do
> repositório.

## 1. O que é este sistema

Sistema de gestão para a Associação Arca da Família (ASAF) — associados, financeiro,
governança, projetos/eventos — mais um site institucional. O plano completo de produto (todas
as fases, módulos e decisões de escopo) está em [`PLANO_PROJETO.md`](./PLANO_PROJETO.md); este
documento aqui é só sobre a arquitetura técnica.

## 2. Visão geral da infraestrutura

Tudo hospedado no Azure, grupo de recursos `Associacao-RG`, região Brazil South:

| Componente | Serviço Azure | Por quê |
| --- | --- | --- |
| Banco de dados | Postgres Flexible Server (Burstable) | Único banco, compartilhado entre a API e o Directus (só tabelas de conteúdo) |
| API (este repositório) | Container Apps | Escala a zero quando ocioso — sem custo de servidor parado |
| CMS do site institucional | Container Apps (Directus) | Conteúdo editável sem tocar em código |
| Arquivos/uploads | Blob Storage | Fotos, documentos anexados |
| Site + painel do associado | Static Web Apps | Domínio próprio (`asaf.org.br` / `painel.asaf.org.br`) |
| Segredos | Key Vault | Nenhuma senha em variável de ambiente exposta em texto no Portal |
| Build de imagem | Container Registry (ACR Tasks) | Builda a imagem Docker na nuvem — não precisa de Docker instalado localmente |
| Observabilidade | Application Insights | Log e métrica, plano gratuito cobre o porte deste sistema |

> **Domínio da API — resolvido em 2026-09-11**: o painel (`painel.asaf.org.br`) guarda o refresh
> token num cookie `HttpOnly`+`SameSite=Strict` emitido pela API, que só é enviado em requisições
> **same-site**. `api.asaf.org.br` foi criado (registro DNS + hostname vinculado ao Container App
> `asaf-api` com certificado gerenciado, `bindingType: SniEnabled`) e confirmado respondendo em
> produção (`https://api.asaf.org.br/docs` → 200 OK). `VITE_API_URL=https://api.asaf.org.br` está
> definido no workflow `deploy-painel.yml` (valor público, não é segredo, por isso vive no
> workflow e não no Key Vault) — todo build de produção do painel já aponta pra esse domínio.

### Por que Postgres, não SQLite

O protótipo original usava SQLite. Postgres foi escolhido porque escala verticalmente (mais
CPU/storage) sem reescrever nada, é o que o Directus também precisa, e é a base de dado que
qualquer serviço de nuvem trata como cidadão de primeira classe (backup automático, HA, etc.).

### Por que Container Apps, não uma VM

Uma associação sem equipe de TI dedicada não deveria precisar "cuidar de servidor". Container
Apps no plano consumo escala de zero sozinho, e o custo acompanha o uso real.

### Por que Directus, e só para conteúdo

Directus não carrega nenhuma regra de negócio (financeiro, votação, permissão por módulo) — só
conteúdo do site público (página, notícia, banner). Reescrever a lógica de negócio já pronta do
zero dentro do Directus não compensaria. Ver `PLANO_PROJETO.md` seção 3 para o raciocínio
completo.

## 3. Estrutura do código (API)

```text
app/
  database.py     Conexão com o banco (engine, Base, get_db), migração de schema
  utils.py        Funções compartilhadas entre módulos (hash de senha, escape HTML, avatar)
  main.py         Cria o app FastAPI, inclui os routers, monta uploads
  models/         Um arquivo por domínio (core, associados, financeiro, governanca, projetos)
  schemas/        Modelos Pydantic de entrada, mesmo agrupamento por domínio
  routers/        Rotas HTTP, mesmo agrupamento por domínio
alembic/          Migrações de banco versionadas (ver seção 4)
templates/        HTML estático do protótipo inicial (legado — o site institucional real é o `site/`, abaixo)
painel/           Painel do associado/administrador (Vite + React) — painel.asaf.org.br
site/             Site institucional público (Astro) — asaf.org.br
design/           Tokens de design compartilhados por painel/ e site/ (fonte única da identidade visual)
```

**Por que separado por domínio, não um arquivo só**: o código nasceu como um único
`servidor.py` de ~3400 linhas. Um bug num módulo (ex. financeiro) não deveria arriscar quebrar
outro (ex. associados) só por estarem no mesmo arquivo, e qualquer pessoa que for dar
manutenção daqui a alguns anos precisa conseguir entender um pedaço sem ler o sistema inteiro.

O front-end (painel do associado/admin) vive em `painel/` — Vite + React + TypeScript `strict` +
Tailwind + shadcn/ui + Recharts + TanStack Query + React Router. É um monorepo simples (mesma
repo, sem ferramenta de monorepo), conforme a v0.2 do plano; o shell, o design system e os
contratos de front-end ali construídos são a base que as FASES 1–20 consomem.

O site institucional público (`asaf.org.br`) vive em `site/` — Astro (geração estática, com
"ilhas" de JavaScript só onde há dado dinâmico) + Tailwind + TypeScript `strict`, publicado no
Static Web App `asaf-site`. **A fronteira que impede o site de virar um segundo sistema**: tudo
que é *dado* (eventos, transparência, inscrição) vem da API FastAPI e é buscado no navegador do
visitante, a cada visita, sem rebuild; só o que é *editorial* (textos, notícias, banners) vem do
Directus e é gerado no build. Detalhes de uso em [`site/README.md`](./site/README.md).

A identidade visual (cores, raio, sombras, fonte) mora em `design/` — **fonte única** consumida
pelo painel e pelo site. Nunca redefinir um token dentro de `painel/` ou `site/`; ver
[`design/README.md`](./design/README.md).

## 4. Migração de banco de dados (Alembic)

Schema é versionado via Alembic — cada mudança de model vira uma migração numerada, revisável,
com histórico. **Nunca edite uma tabela direto no banco de produção** — sempre gere uma
migração (`alembic revision --autogenerate -m "descrição"`) e aplique com `alembic upgrade
head`.

Isso substitui o mecanismo anterior (`preparar_banco()`, que auditava todas as tabelas a cada
início do servidor) — esse mecanismo chegou a causar um incidente real de produção (27
segundos de boot, estourando o tempo de inicialização esperado pelo Container App, causando
reinício em loop). O código antigo continua em `app/database.py` como referência histórica,
desligado por padrão (variável `RUN_DB_MIGRATION`), mas o caminho daqui pra frente é sempre
Alembic.

## 5. Deploy e CI/CD

Todo push na branch `main` que altere `app/`, `requirements.txt`, `Dockerfile`,
`alembic/`, `templates/` ou o próprio workflow dispara `.github/workflows/deploy-api.yml`:

1. Login no Azure via OIDC (sem senha salva no GitHub, usa Service Principal com credencial
   federada — ver `CREDENCIAIS_AZURE.md`).
2. Builda a imagem Docker no ACR Tasks (não precisa de Docker instalado no runner).
3. Atualiza o Container App pra usar a imagem nova.

Todo push na branch `main` que altere `painel/` (ou o próprio workflow) dispara
`.github/workflows/deploy-painel.yml`: ele roda os portões de qualidade (ESLint, Prettier e
`tsc --noEmit` + build) em todo pull request/push e, só na `main`, publica o build no Static Web
App `asaf-painel` usando o deploy token `SWA-PAINEL-DEPLOY-TOKEN` que vive no Key Vault
`kv-asaf-arca`.

Todo push na branch `main` que altere `site/` ou `design/` (ou o próprio workflow) dispara
`.github/workflows/deploy-site.yml`. Os portões de qualidade rodam em todo pull request/push:
Prettier, `astro check`, testes unitários e — contra o site **montado**, num navegador de
verdade — auditoria de acessibilidade (axe, WCAG 2.1 AA, todas as páginas do sitemap, em
desktop e celular), SEO técnico, links internos e Lighthouse CI (desempenho ≥ 90, acessibilidade
e SEO = 100). Só na `main`, depois dos portões, publica no Static Web App `asaf-site` com o token
`SWA-SITE-DEPLOY-TOKEN` (Key Vault) e **confere sozinho** que `asaf.org.br/version.json` já mostra
o commit publicado. Mudança em `design/` também reconstrói o painel (`deploy-painel.yml`).

O mesmo workflow aceita **disparo manual** (`workflow_dispatch`) — é o gatilho do "rebuild quando
o conteúdo editorial muda": o Flow do Directus (ligado na v5.1, quando as coleções existirem)
chama a API do GitHub com um token restrito à permissão *Actions: Read and write* deste
repositório, o mínimo possível (dispara workflow; não lê nem altera código). Esse caminho pula os
portões de qualidade: publicar uma notícia já revisada não deve ficar preso numa rodada
instável do Lighthouse.

Directus em si não tem CI/CD próprio ligado a este repositório — é gerido separadamente (é
conteúdo, editado pelo próprio painel do Directus).

## 6. Onde estão os segredos

Nunca em código, nunca commitado. Vivem em dois lugares:

- **Azure Key Vault** (`kv-asaf-arca`): string de conexão do banco, chave do storage, segredos
  do Directus, `JWT_SECRET`.
- **Secrets do GitHub** (`Arca-da-Familia/asaf` → Settings → Secrets): `AZURE_CLIENT_ID`,
  `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (usados só para o login OIDC do CI/CD).
- **`CREDENCIAIS_AZURE.md`** (local, nunca commitado — ver `.gitignore`): registro de qual
  segredo está onde, para quem administra a infraestrutura. Detalha nomes de recurso, mas
  nunca o valor de uma senha em texto puro.

## 7. Rodando localmente

```bash
python -m venv .venv
.venv\Scripts\activate         # Windows
pip install -r requirements-dev.txt
# copie .env.example para .env e preencha DATABASE_URL com um Postgres seu (local ou de teste)
uvicorn app.main:app --reload
```

## 8. Práticas de continuidade (para durar décadas, não só para hoje)

- **Rotação de segredo não é evento único.** Senha do Postgres, `JWT_SECRET`, tokens do
  Directus — devem ser trocados periodicamente (recomendado: anualmente, ou sempre que uma
  pessoa com acesso à infraestrutura deixar a gestão da associação).
- **Este documento e o `CREDENCIAIS_AZURE.md` precisam ser mantidos atualizados** a cada
  mudança real de infraestrutura — documentação desatualizada é pior que nenhuma, porque
  engana quem confia nela.
- **Revisão de custo** é periódica, não configurada uma vez — ver alerta de orçamento (Cost
  Management no Portal Azure) e a seção 9 do `PLANO_PROJETO.md`.
