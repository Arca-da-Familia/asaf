# Plano de saída do Azure

Escrito na v8.5 (2026-11-03) para o dia em que for preciso levar o sistema da ASAF para outro provedor: o crédito de ONG do Azure (US$ 2.000 por ano)
vence em **05/02/2027** e a renovação não está confirmada. **Sair não é a primeira opção:** em outubro o Azure custou R$ 119,38 no mês inteiro (seção 9 do
`RUNBOOK.md`), então pagar do próprio bolso provavelmente sai mais barato que mudar. Este plano existe para que a mudança seja uma decisão, nunca uma
emergência sem caminho.

A arquitetura foi escolhida para ser portátil: um **Postgres** comum, uma **API em contêiner** comum, **páginas estáticas** e **arquivos**. No código da API, a
única peça que fala com o Azure é o módulo de arquivos (`app/services/armazenamento.py`, bibliotecas `azure-storage-blob` e `azure-identity`).

## 1. O que existe hoje e o que o substitui

| Parte | Hoje (Azure) | Fora do Azure | Esforço |
|---|---|---|---|
| Banco | Postgres 18 Flexible (`asaf-pg-server`), um banco com as tabelas da API e, no esquema `directus`, as do editor do site | Qualquer Postgres 18 gerenciado, ou num servidor próprio | Copiar (seção 2). A única extensão usada é `btree_gist` (reserva de espaço, v4.3), que todo Postgres tem |
| API | Contêiner (`Dockerfile`: `python:3.15-slim`, `uvicorn` na porta 8000) no Container App `asaf-api` | Qualquer lugar que rode um contêiner Docker | Baixo: a mesma imagem, com as variáveis da seção 3 |
| Arquivos da API | Blob privado `stasafprivado`, entrada pela identidade do Container App (sem chave) | (a) **disco do servidor**, que a API já sabe usar (sem `ARMAZENAMENTO_BLOB_URL` ela grava em `uploads/`), desde que esse disco seja **permanente** e entre na cópia de segurança; ou (b) um armazenamento compatível com S3, escrevendo um terceiro tipo no módulo de arquivos (4 operações: salvar, ler, remover, verificar) | (a) baixo; (b) médio, com testes |
| Editor do site (Directus) | Contêiner `directus/directus` no Container App `asaf-directus`; arquivos dele na conta `stasafarcadafamilia` (contêiner `uploads`) | O mesmo contêiner em outro lugar; o Directus grava arquivos também em disco local ou S3 (`STORAGE_LOCATIONS`) | Baixo |
| Site e painel | Static Web Apps (`asaf-site`, `asaf-painel`): só arquivos prontos (Astro e Vite) | Qualquer hospedagem de páginas estáticas | Baixo: refazer as regras de `staticwebapp.config.json` (o painel manda todo endereço para `index.html`; o site tem a página 404 e o tempo de guarda de cada arquivo) |
| Domínio (DNS) | Zona `asaf.org.br` no Azure DNS, **com DNSSEC** | O próprio Registro.br ou outro serviço de DNS | **Cuidado** (seção 4) |
| Senhas e chaves | Cofre `kv-asaf-arca` | O cofre de segredos do novo provedor | Baixo: copiar (e aproveitar para trocar) |
| Imagens da API | Registro `asafregistry` | O registro de contêineres do GitHub ou do novo provedor | Baixo |
| Publicação automática | GitHub Actions entrando no Azure (`azure/login`, `az acr build`, `az containerapp update`, tokens das Static Web Apps) | GitHub Actions com os comandos do novo provedor | Médio: os passos de teste e de montagem ficam; mudam os de publicar |
| E-mail | Google Workspace (SMTP), fora do Azure | Não muda | Nenhum |
| Monitor do site | GitHub Actions, fora do Azure | Não muda (só os endereços, se mudarem) | Nenhum |

## 2. Copiar os dados

**Banco:** com o cliente do Postgres 18, um retrato do banco inteiro (tabelas da API e do Directus) e a restauração no novo servidor:

```bash
pg_dump --format=custom --no-owner --no-privileges --file asaf.dump "<endereço do banco atual, DATABASE-URL do cofre>"
pg_restore --no-owner --no-privileges --dbname "<endereço do banco novo>" asaf.dump
```

Depois, confira as contagens (associados, lançamentos, auditoria) nos dois lados. O arquivo `asaf.dump` tem **todos os dados pessoais**: nunca o deixe
em pasta compartilhada nem em computador sem senha, e apague-o quando a mudança estiver conferida.

**Arquivos:** `azcopy login` e `azcopy copy "https://stasafprivado.blob.core.windows.net/*" ./arquivos --recursive` (o mesmo para `stasafarcadafamilia`,
os arquivos do Directus). Os nomes das pastas e dos arquivos ficam iguais; no destino (a) da tabela, a pasta `arquivos/` vira o `uploads/` da API.

## 3. As variáveis da API

As que a API lê (conferidas no código em 2026-11-03): `DATABASE_URL`, `JWT_SECRET`, `SMTP_HOST`, `SMTP_PORTA`, `SMTP_USUARIO`, `SMTP_SENHA`,
`SMTP_REMETENTE`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, `WEBAUTHN_RP_NAME`, `CORS_ORIGINS`, `COOKIE_SECURE`, `URL_BASE_PAINEL`, `URL_BASE_SITE_PUBLICO`,
`RUN_DB_MIGRATION`, `CONFIAR_NO_PRIMEIRO_IP`, `ARMAZENAMENTO_BLOB_URL` (só no Azure), `DB_POOL_SIZE`, `DB_MAX_OVERFLOW` e `ASAF_REGISTRO_SEGURO`. As que
não são segredo estão em `infra/config/api-producao.env`; os segredos estão no cofre. **Não** defina `VISITANTE_CODIGO_NA_RESPOSTA` (só existe na
homologação). Se o domínio do painel mudar, as chaves de segurança do segundo passo (WebAuthn) já cadastradas deixam de valer, porque ficam presas ao domínio, e cada pessoa cadastra de novo.

## 4. O domínio, sem derrubar o site

O domínio tem **DNSSEC**: o Registro.br guarda um código (DS) que só vale para as chaves do Azure DNS. Trocar os servidores de DNS com o DS lá deixa o
domínio **fora do ar** para quem confere assinatura. Ordem certa: (1) recriar todos os registros no DNS novo (site, painel, API, editor, e-mail: MX, SPF,
DMARC e o que mais houver na zona); (2) **tirar o DS** no Registro.br e esperar um dia; (3) trocar os servidores de DNS no Registro.br; (4) depois de tudo funcionando,
ligar o DNSSEC no DNS novo e publicar o DS novo.

## 5. A ordem da mudança

1. **Ensaio com a homologação** (dados inventados): copiar o banco `asaf_hml` e os arquivos de teste para o novo provedor, subir a API e o painel de teste
   lá e passar os robôs (`painel/e2e-hml`). Corrigir o que aparecer. Nada da produção é tocado.
2. Avisar a Diretoria e marcar uma noite. Mudança de onde os dados ficam guardados **muda o que a Política de Privacidade e o inventário dizem**
   (`app/services/inventario.py`: hoje "Microsoft Azure, Brasil, com réplica nos Estados Unidos"): atualizar os dois antes, pelo caminho normal.
3. Na noite: parar a API do Azure (mínimo e máximo de cópias em 0), fazer a cópia do banco e dos arquivos (seção 2), subir tudo no novo provedor,
   conferir `/health`, o `version.json` e as contagens.
4. Trocar os endereços de DNS da API, do painel, do site e do editor para o novo provedor (seção 4, se o DNS também mudar).
5. Manter o Azure parado, **sem apagar**, por 30 dias. Só então apagar, com a confirmação da Diretoria.

## 6. O que não sai do lugar

O código (GitHub), o e-mail (Google Workspace), o domínio (Registro.br) e as decisões guardadas no repositório não dependem do Azure. As cópias de
segurança do Azure (35 dias) deixam de existir com ele: antes de apagar, guarde um último `pg_dump` cifrado.
