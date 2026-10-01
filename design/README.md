# design/ — identidade visual da ASAF (fonte única)

Painel (`painel/`) e site (`site/`) precisam parecer a mesma instituição. Em vez de manter cores
copiadas nos dois, **tudo vive aqui** e os dois projetos consomem.

## Paleta da marca (definida pelo usuário em 2026-10-01, tirada da logo)

| Papel | Cor | Token | Uso |
| --- | --- | --- | --- |
| **Primária** | Verde bandeira `#145238` | `--primary` / `--brand` | botões, links, cabeçalho de destaque, rodapé |
| **Secundária** | Amarelo ouro `#E3C435` | `--brand-secondary` | botão de ação principal sobre verde, selos, detalhes |
| **Terciária** | Azul claro `#5FBBE9` | `--brand-tertiary` | fundos suaves, etiquetas (**provisório**: o usuário vai informar o tom exato) |

Texto sobre ouro ou azul é **sempre** o verde-escuro (`--brand-secondary-foreground`). Contrastes
WCAG calculados: texto claro sobre o verde 8,75:1; verde sobre branco 9,16:1; verde-escuro sobre
ouro 9,47:1 e sobre o azul 7,57:1. No tema escuro o verde sobe para `152 55% 45%` (7,4:1 sobre o
fundo) e o texto do botão fica escuro (6,3:1).

Os tokens neutros do shadcn (`--secondary`, `--muted`, `--accent`) continuam **cinza de
propósito**: são superfícies de interface, não cor de marca.

## Arquivos

| Arquivo | O que é | Quem usa |
| --- | --- | --- |
| `tokens.css` | Variáveis CSS (cores, raio) — tema claro e escuro | `painel/src/index.css`, `site/src/styles/global.css` |
| `base.css` | Regras-base (borda, fundo do `body`, foco visível) | idem |
| `tailwind-preset.js` | `theme.extend` do Tailwind (cores nomeadas, sombras, fonte) | `painel/tailwind.config.js`, `site/tailwind.config.js` |
| `logo/asaf-logo-original.png` | **Logo institucional — arquivo mestre** (2607×2160, fundo transparente) | tudo abaixo é gerado dele |
| `logo/*.webp`, `logo/*.png`, `logo/favicon.ico` | Derivados (160/640/600 px, ícones 48/192/512, apple-touch) | copiados para `site/public/` e `painel/public/` |

Em JavaScript (gráficos Recharts) as cores espelham os tokens em `painel/src/lib/tokens.ts`.

## Regras

- **Trocar uma cor?** Edite `tokens.css` (e o espelho em `painel/src/lib/tokens.ts`). Os dois
  projetos mudam juntos no próximo deploy (mudança em `design/` dispara o workflow do painel *e*
  do site). Confira o contraste (WCAG AA: 4,5:1 para texto) — o e2e do site reprova o deploy se
  quebrar.
- **Trocar a logo?** Substitua `logo/asaf-logo-original.png` e rode, na pasta `site/`:
  `npm run logos` (gera e distribui todos os derivados) e depois `npm run og` (imagem de
  compartilhamento). **Nunca edite um derivado à mão** — o próximo `npm run logos` o sobrescreve.
- A logo institucional é usada **em todo lugar**: cabeçalho e destaque do site, ícone da aba,
  imagem ao compartilhar um link, dados estruturados do Google (`Organization.logo`), login e
  cabeçalho do painel. Documentos gerados pelo sistema (certificados, carteirinha) ainda não a
  usam — fazer quando cada um for retrabalhado.
- O arquivo **vetorial** (SVG do CorelDRAW) não está no repositório: serve para impressão e
  qualquer ampliação grande. Se for salvo em `logo/asaf-logo.svg`, o `npm run logos` pode passar
  a gerá-lo daí.
- **Nunca redefina um token dentro de `painel/` ou `site/`.** Se um dos dois precisar de algo
  diferente, o token novo nasce aqui, com nome próprio.
- Valores no formato `H S% L%` (sem `hsl()`), para o Tailwind aplicar opacidade (`bg-primary/50`).
- `--muted-foreground` sobre fundo `--muted` **não** passa em AA para texto pequeno — use sobre
  `--background` ou `--card`.
- Dark mode: os tokens `.dark` existem (o painel usa). O site, por ora, é só claro.
