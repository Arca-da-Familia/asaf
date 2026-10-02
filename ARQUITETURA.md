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
>
> **Domínio do Directus (CMS) — criado em 2026-10-01**: `cms.asaf.org.br`. Mesmo procedimento do
> `api`: registro `CNAME cms` → endereço do Container App `asaf-directus` + `TXT asuid.cms`
> (verificação de domínio), hostname vinculado ao Container App com certificado gerenciado, e
> `PUBLIC_URL=https://cms.asaf.org.br` no Container App. **O endereço é definitivo**: a chave de
> licença do Directus (abaixo) fica amarrada ao `PUBLIC_URL`, e trocá-lo exige reativar a chave.
> O endereço longo do Azure (`*.azurecontainerapps.io`) continua respondendo, mas não é para uso.
> O Directus escala a zero (`minReplicas: 0`): a primeira abertura depois de um tempo parado leva
> cerca de 30 s (medido: `GET /server/ping` em 33 s) — normal, não é defeito.
>
> **Licença do Directus (conferido na documentação oficial em 2026-10-01)**: o sistema de licença
> é da **versão 12**. A instância rodava a 11.17.4, que não tem a aba *Settings → License*, e foi
> **atualizada em 2026-10-01 para `directus/directus:12.4.1`** (imagem fixada; regra do projeto:
> tudo na última versão, ver `CLAUDE.md`). Instâncias self-hosted sem licença rodam no plano
> *core*, **gratuito e sem chave**. O
> uso comercial gratuito com limites maiores é o **Open Innovation
> Grant** (entidade com menos de US$ 5 milhões de receita anual e menos de 50 funcionários): a
> chave (`DXXXX-XXXXX-XXXXX-XXXXX-XXXXC`) é pedida à Directus pelo formulário de contato
> (directus.com/oig) — não há cadastro automático — e cobre até 5 ativações (local, dev, staging,
> produção). Ela entra em *Studio → Settings → License* ou na variável `LICENSE_KEY`. Na migração
> para a v12, instância acima dos limites do *core* tem 30 dias de carência e depois é bloqueada
> (a API devolve erro até a licença ser resolvida; os dados ficam salvos). Por isso a chave vale
> ser pedida **antes** de subir para a v12 (a instância já está na 12.4.1).
>
> **Isolamento do Directus no banco — aplicado em 2026-10-02.** O Directus divide o Postgres
> `asaf_db` com a API, mas **não** o mesmo usuário nem as mesmas tabelas: conecta como o papel
> `directus_app` (sem superusuário/CREATEROLE/CREATEDB), com `DB_SEARCH_PATH=directus`, e só
> alcança o schema `directus` (as 33 tabelas `directus_*` e, no futuro, as coleções de conteúdo).
> As 123 tabelas do sistema ficam em `public`, sem nenhum privilégio para ele — um administrador do
> Directus não lê nem edita dado de associado ou financeiro, e o que o site mostra do sistema
> (evento, transparência) vem da API pública do FastAPI. Integração por *ID* (divulgação do evento
> ligada por `evento_id`) ou por uma VIEW de campos públicos concedida de propósito. A senha do
> papel vive no segredo `dbpasswordapp` do Container App. Verificação reexecutável:
> `DATABASE_URL=… python scripts/isolar_directus.py verificar`. O firewall do Postgres tem a regra
> `AllowAzureServices` (API, Directus, GitHub Actions) e duas regras de administrador
> (`AllowAdminMachine`, `AllowAdminMachine2`) para os dois endereços da internet do usuário.

### Os dois domínios da associação (esclarecimento do usuário, 2026-10-01)

- **`asaf.org.br`** — domínio **nacional e oficial**: site, painel (`painel.`), API (`api.`),
  Directus (`cms.`), zona de DNS no Azure e e-mail no Google Workspace (`asaf@asaf.org.br`). **É
  com ele que toda identidade pública e todo e-mail novo devem sair** (inclusive o autor dos
  commits do repositório, trocado em 2026-10-01).
- **`arcadafamilia.org`** — domínio internacional, que é o do **tenant Microsoft/Azure**
  (conta master `asaf@arcadafamilia.org`): serve **só para entrar no Azure**. O plano do usuário é
  tirá-lo de cena nos próximos tempos por causa do custo. Qualquer endereço `@arcadafamilia.org`
  que não seja essa conta master **não existe como caixa de e-mail** (foi o caso do
  `admin@arcadafamilia.org` do Directus, que nunca recebeu nada).

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
