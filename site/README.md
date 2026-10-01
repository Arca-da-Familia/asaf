# site/ — site institucional da ASAF (asaf.org.br)

Astro (geração estática) + Tailwind + TypeScript `strict`. Publicado no Static Web App
`asaf-site` por `.github/workflows/deploy-site.yml`. Plano completo: FASE 5 do
[`PLANO_PROJETO.md`](../PLANO_PROJETO.md); decisões de arquitetura: [`ARQUITETURA.md`](../ARQUITETURA.md).

## A regra que mantém o site simples

| O que é                                             | De onde vem                      | Quando chega ao visitante                                                        |
| --------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| **Dado** (eventos, vagas, transparência, inscrição) | API FastAPI (`/api/publico/...`) | Buscado **no navegador, a cada visita** (ilha) — evento novo aparece sem rebuild |
| **Editorial** (textos, notícias, banners, galeria)  | Directus (v5.1)                  | Gerado **no build**; o Directus dispara um rebuild quando o conteúdo muda        |

Nunca digite no site um dado que o sistema já tem (nome de dirigente, evento, valor): ele
envelhece e vira um segundo sistema. O mesmo vale para dado institucional que o Estatuto não traz
(CNPJ, telefone, endereço atual): fica fora até ser confirmado — ver
`src/config/organizacao.ts`.

## Rodando

```bash
cd site
npm ci
npm run dev          # http://127.0.0.1:4321 (usa a API real; precisa de CORS — ver abaixo)
npm run build        # build de produção (astro check + astro build) -> dist/
npm run preview      # serve dist/
```

**Dica (dev sem depender da API real):** `node scripts/mock-api.mjs` sobe uma API simulada em
`:4322`; rode o dev com `PUBLIC_API_URL=http://127.0.0.1:4322`.

## Qualidade (o que o CI roda — e o que rodar antes de enviar)

```bash
npm run format:check   # Prettier
npm run typecheck      # astro check
npm test               # unitários (vitest): datas/fuso, SEO/JSON-LD, cliente da API, ilha de eventos
npm run logos          # regenera logo/ícones a partir de design/logo (ver design/README.md)
npm run build:teste    # build com a ilha apontando para a API SIMULADA (obrigatório p/ e2e e Lighthouse)
npm run test:e2e       # Playwright: axe WCAG 2.1 AA, SEO, links, ilha em cada estado
npm run lighthouse     # Lighthouse CI (precisa de Chrome; localmente: CHROME_PATH=...)
```

- O **e2e descobre as páginas pelo `sitemap`**: toda página nova entra sozinha na auditoria de
  acessibilidade e SEO. Ninguém precisa lembrar de registrar.
- `global-setup` recusa rodar o e2e contra um `dist/` de produção (testaria a API real).
- Metas que **reprovam o deploy**: axe sem nenhuma violação (desktop e 375px); Lighthouse
  desempenho ≥ 90, melhores práticas ≥ 95, acessibilidade = 100, SEO = 100.

## SEO técnico

Tudo em `src/layouts/Base.astro` + `src/lib/seo.ts`: título, descrição, canonical absoluta
(sempre em `https://asaf.org.br`, mesmo no build de teste), Open Graph/Twitter Card, JSON-LD de
organização (`NGO`), `robots.txt` e `sitemap-index.xml` gerados no build, 404 com `noindex`.

- Página nova: use `<Base titulo="..." descricao="..." caminho="/pagina">`. Sem `descricao`, cai
  na descrição da organização (**escreva uma própria** — 50 a 170 caracteres, o e2e confere).
- **Evento (schema.org/Event):** `jsonLdEvento()` em `src/lib/seo.ts` já existe e está testado
  (inclui o fuso `-03:00`, sem o qual o Google mostra o horário 3 h errado). Quem o consome são
  as páginas de evento da **v5.2**: `<Base jsonLd={[jsonLdEvento(ev, url)]}>`.
- Imagem de compartilhamento: `public/og-padrao.png` (1200×630), gerada por `npm run og`.
  Provisória — sem logotipo oficial no repositório ainda.

## Rebuild quando o conteúdo do Directus muda

O workflow `deploy-site.yml` tem `workflow_dispatch`. O Flow do Directus (**v5.1** — precisa das
coleções de conteúdo para ter o que escutar) deve chamar:

```text
POST https://api.github.com/repos/Arca-da-Familia/asaf/actions/workflows/deploy-site.yml/dispatches
Authorization: Bearer <token fine-grained>
Accept: application/vnd.github+json
{"ref": "main"}
```

O token deve ser **fine-grained, restrito a este repositório, só com "Actions: Read and
write"** — dispara workflow, não lê nem altera código. **Não** use `repository_dispatch`: exige
"Contents: write". O token vive no Directus (variável do Flow) e deve ser rotacionado junto dos
demais segredos (`ARQUITETURA.md`, seção 8). Esse caminho pula os portões de qualidade de
propósito (publicar conteúdo revisado não fica preso numa rodada instável do Lighthouse).

Para testar o gatilho sem o Directus: `gh workflow run deploy-site.yml --ref main`.

## Ilhas (JavaScript no navegador)

Cada ilha é um `<script>` do Astro dentro do componente, falando com a API via `src/lib/api.ts`.
Regras (a ilha de eventos, `src/lib/eventos-dom.ts`, é o modelo):

- **Nunca `innerHTML` com dado da API** — título/descrição são texto digitado pela diretoria.
  Use `createElement` + `textContent` (há teste de XSS unitário e no navegador).
- Trate os três estados: carregando, vazio, erro (com "Tentar novamente").
- Sem JavaScript o contêiner é escondido (`@media (scripting: none)`) e o `<noscript>` explica.
- Datas da API são horário local de Parauapebas **sem fuso**: use `src/lib/datas.ts`, nunca
  `new Date(texto)` direto (mostraria hora errada para quem está em outro fuso).
- Precisa de interação complexa (formulário de doação, inscrição)? Aí sim adicione
  `@astrojs/react` — até lá, zero framework de JS no navegador.

## CORS

A ilha chama a API de outra origem (`https://api.asaf.org.br`). `app/main.py` libera
`https://asaf.org.br` e `http://localhost:4321` (dev); só rotas `/api/publico/...` servem ao
site, o resto exige JWT. `tests/test_cors_site.py` guarda isso.

## Pendente (registrado no plano)

- Cabeçalhos de segurança (CSP, `X-Frame-Options`) — **v5.5**. A CSP só pode ser escrita certa
  depois que as páginas e ilhas existirem. (HSTS e `X-Content-Type-Options` o Static Web App já
  envia por padrão.)
- Dark mode do site (tokens `.dark` já existem no `design/`).
- Tom exato do azul (terciária): hoje é o azul claro da logo (`#5FBBE9`), provisório.
- Arquivo vetorial (SVG) da logo no repositório, para impressão/ampliação.
- `www.asaf.org.br` não resolve (sem registro DNS) — decidir se vale criar com redirecionamento
  para o domínio sem `www`.
