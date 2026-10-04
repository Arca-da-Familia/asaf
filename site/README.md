# site/ — site institucional da ASAF (asaf.org.br)

Astro (geração estática) + Tailwind 4 (plugin do Vite, tema em `../design/`) + TypeScript `strict`. Publicado no Static Web App
`asaf-site` por `.github/workflows/deploy-site.yml`. Plano completo: FASE 5 do
[`PLANO_PROJETO.md`](../PLANO_PROJETO.md); decisões de arquitetura: [`ARQUITETURA.md`](../ARQUITETURA.md).

## A regra que mantém o site simples

| O que é                                             | De onde vem                      | Quando chega ao visitante                                                        |
| --------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| **Dado** (eventos, vagas, transparência, inscrição) | API FastAPI (`/api/publico/...`) | Buscado **no navegador, a cada visita** (ilha) — evento novo aparece sem rebuild |
| **Editorial** (textos, notícias, banners, galeria)  | Directus (v5.3)                  | Gerado **no build**; o Directus dispara um rebuild quando o conteúdo muda        |

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
npm test               # unitários (vitest): datas/fuso, SEO/JSON-LD, cliente da API, ilha de eventos, Estatuto, menus
npm run logos          # regenera logo/ícones a partir de design/logo (ver design/README.md)
npm run build:teste    # build com a API SIMULADA de pé (obrigatório p/ e2e e Lighthouse)
npm run test:e2e       # Playwright: axe WCAG 2.1 AA, SEO, links, ilha em cada estado
npm run test:vazio     # build contra API sem nenhum dado: confere o estado vazio (o da produção no 1º dia)
npm run test:sincronizacao  # igual não reconstrói; diferente e 1º deploy reconstroem
npm run lighthouse     # Lighthouse CI (precisa de Chrome; localmente: CHROME_PATH=...)
```

- O **e2e descobre as páginas pelo `sitemap`**: toda página nova entra sozinha na auditoria de
  acessibilidade e SEO. Ninguém precisa lembrar de registrar.
- `global-setup` recusa rodar o e2e contra um `dist/` de produção (testaria a API real).
- Metas que **reprovam o deploy**: axe sem nenhuma violação (desktop e 375px); Lighthouse
  desempenho ≥ 90, melhores práticas ≥ 95, acessibilidade = 100, SEO = 100 — medido na home,
  em Quem somos, Seja associado, Estatuto e Contato (`lighthouserc.json`; acrescente a página
  nova pesada aqui).

## Páginas (v5.2) e de onde vem cada texto

**Regra: nada é inventado.** Cada página institucional cita o artigo do Estatuto de onde tirou a
informação, e o que falta (história além da data de fundação, mapa com pino) NÃO é preenchido.

| Página                            | Fonte                                                                                                                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/estatuto/`                      | `ESTATUTO_ASAF.txt` (raiz do repo), lido por `src/lib/estatuto.ts`; `tests/estatuto.test.ts` prova que **nenhuma palavra se perde, repete ou troca de ordem** e que o build falha se o formato mudar |
| `/quem-somos/`, `/transparencia/` | Estatuto (artigos citados no texto) + `src/config/organizacao.ts`                                                                                                                                    |
| `/seja-associado/`                | Arts. 11–15 e 28 do Estatuto — as listas de exigências, direitos e deveres são **lidas** do Estatuto, não redigitadas                                                                                |
| `/seja-voluntario/`               | regras do módulo de voluntariado do sistema (termo de adesão, menores) e Lei 9.608/1998                                                                                                              |
| `/como-ajudar/`, `/contato/`      | Estatuto (Art. 28) e dados confirmados da entidade                                                                                                                                                   |
| `/privacidade/`, `/termos/`       | descrevem só o que o site/sistema fazem hoje; versão e data em `DOCUMENTOS_LEGAIS` (`organizacao.ts`)                                                                                                |

- **Navegação** num lugar só: `src/config/navegacao.ts` (cabeçalho, menu de celular em
  `<details>` sem JavaScript, rodapé). Só entra página que existe — o e2e confere que todo link
  interno responde 200.
- **Migalhas** (`<TituloDePagina migalhas=...>` + `<Base migalhas=...>`) geram o dado
  estruturado `BreadcrumbList`.
- **Texto com link**: o Astro junta palavras quando o texto termina numa linha e o `<a>` começa na
  seguinte. Use `{' '}` antes/depois do link; `e2e/texto.spec.ts` reprova se alguma palavra colar.
- **Contato sem mapa embutido, de propósito**: o CEP 68515-000 é da cidade inteira e o
  OpenStreetMap não conhece a rua — qualquer pino seria chute. O botão busca pelo endereço.

## Dados vivos (v5.2): Diretoria, Projetos, Agenda, Evento, Edital

Estas páginas são **geradas no build** lendo a API (`src/lib/dados-publicos.ts` →
`scripts/lib/conteudo-publico.mjs`): ficam rápidas, indexáveis e com a prévia certa ao compartilhar no
WhatsApp. Rotas da API (`app/routers/publico.py`, sem login, só leitura, lista explícita de campos):
`/api/publico/diretoria`, `/projetos`, `/projetos/{id}`, `/assembleias`, `/assembleias/{id}` (+ os eventos).

- **URLs estáveis só com o id** (`/eventos/12/`, `/projetos/3/`): um título editado nunca quebra um link
  já compartilhado.
- **Se a API não responder no build, o build FALHA** (3 tentativas, 60 s cada, por causa da partida a frio):
  nunca se publica um site sem a diretoria e sem os eventos.
- **O que muda depois do build é resolvido no navegador** (`src/lib/evento-vivo.ts`): vagas livres,
  evento **retirado do ar** (a API passa a responder 404 → aviso na hora) e "a data já passou". A lista da
  Agenda ("Próximos" e "Eventos anteriores") também é ilha: evento novo aparece sem rebuild, e só vira link quando a página dele já existe.
- **Notícias (v5.3)** vêm do **Directus** (editor do site), lidas NO BUILD por `scripts/lib/directus.mjs` com o
  token da conta de serviço `leitor-do-site@asaf.org.br`, que só lê o que está **publicado** e já na data
  (guardado no Key Vault, `DIRECTUS-SITE-TOKEN`; o build o recebe mascarado, nunca vai para o HTML). Páginas:
  `/noticias/`, `/noticias/<endereço>/`, `/noticias/feed.xml` (RSS) e a foto de cada notícia em
  `/midia/noticias/<id>.webp`, **copiada do Directus no build** (o site não depende de o Directus estar
  acordado). **Notícia com foto só vai ao ar com texto alternativo e autorização de imagem**; a que descumpre
  NÃO é publicada (a notícia inteira) e vira aviso amarelo no resumo do deploy. O texto do editor é limpo
  (`sanitize-html`): sem script, sem imagem solta, só links http/https/mailto/tel. `DIRECTUS_OBRIGATORIO=1`
  (workflows de publicação): sem o token o build FALHA. Em desenvolvimento, sem `DIRECTUS_SITE_TOKEN`, a lista
  de notícias fica vazia. O guia para quem edita está em `COMO-ATUALIZAR.md` (raiz do repositório).
- **Sincronização automática** (`.github/workflows/sincronizar-site.yml`, a cada 15 min): compara a
  impressão digital do conteúdo (API do sistema **e notícias do Directus**) com a de `/conteudo.json` do
  site no ar; se mudou, dispara o `deploy-site.yml`. A impressão **ignora vagas livres** (mudam a cada
  inscrição) e o diagnóstico de notícia recusada. Usa o `GITHUB_TOKEN` (`actions: write`) para disparar e
  login OIDC no Azure para ler o token do Directus no Key Vault; sem esse token a comparação FALHA (nunca
  conclui "nada mudou"). **Se as 3 últimas publicações falharam, para e avisa** (execução vermelha) em vez de
  repetir o erro. Testar: `npm run test:sincronizacao`.
- **Estado vazio** é o da produção no 1º dia (sem projeto, diretoria, evento nem edital):
  `npm run test:vazio` constrói contra uma API vazia e confere o que aparece e o que NÃO pode aparecer.
- **Evento sem endereço próprio**: o site NÃO presume a sede nem o modo presencial (pode ser online):
  a página diz "a confirmar" e o schema.org/Event omite `location`.
- **Privacidade**: a API NÃO publica CPF/e-mail/telefone/foto de dirigente, nem responsável/orçamento de
  projeto, e **remove o link de acesso remoto do edital** (publicá-lo daria a sala da assembleia a
  qualquer pessoa); o SHA-256 do edital é calculado sobre o texto publicado.
- **Mock da API** (`scripts/mock-api.mjs`) é ligado durante o `build:teste` (`scripts/com-mock.mjs`);
  dados fixos no dia — um campo que mude a cada chamada faria a sincronização reconstruir sem parar.
- Cancelar um evento hoje = voltar a visibilidade para "Interna" (some do site na próxima sincronização;
  enquanto isso a página mostra o aviso de "retirado"). O sistema ainda não tem status "cancelado".

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

O workflow `deploy-site.yml` tem `workflow_dispatch`. Hoje quem republica quando uma notícia muda é a
sincronização (a cada 15 min, acima); um **Flow do Directus** que chame o endereço abaixo no ato de publicar
(para a notícia ir ao ar em ~5 min em vez de ≤25) é um refinamento opcional:

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

- Cabeçalhos de segurança (CSP, `X-Frame-Options`) — **v5.7**. A CSP só pode ser escrita certa
  depois que as páginas e ilhas existirem. (HSTS e `X-Content-Type-Options` o Static Web App já
  envia por padrão.)
- Dark mode do site (tokens `.dark` já existem no `design/`).
- Tom exato do azul (terciária): hoje é o azul claro da logo (`#5FBBE9`), provisório.
- Arquivo vetorial (SVG) da logo no repositório, para impressão/ampliação.
- `www.asaf.org.br` não resolve (sem registro DNS) — decidir se vale criar com redirecionamento
  para o domínio sem `www`.
