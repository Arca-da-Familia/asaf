# design/ — identidade visual da ASAF (fonte única)

Painel (`painel/`) e site (`site/`) precisam parecer a mesma instituição. Em vez de manter cores
copiadas nos dois, **tudo vive aqui** e os dois projetos consomem.

## Paleta da marca (definida pelo usuário em 2026-10-01, tirada da logo)

| Papel          | Cor                      | Token                   | Uso                                                                           |
| -------------- | ------------------------ | ----------------------- | ----------------------------------------------------------------------------- |
| **Primária**   | Verde bandeira `#145238` | `--primary` / `--brand` | botões, links, cabeçalho de destaque, rodapé                                  |
| **Secundária** | Amarelo ouro `#E3C435`   | `--brand-secondary`     | botão de ação principal sobre verde, selos, detalhes                          |
| **Terciária**  | Azul claro `#5FBBE9`     | `--brand-tertiary`      | fundos suaves, etiquetas (**provisório**: o usuário vai informar o tom exato) |

Texto sobre ouro ou azul é **sempre** o verde-escuro (`--brand-secondary-foreground`). Contrastes
WCAG calculados: texto claro sobre o verde 8,75:1; verde sobre branco 9,16:1; verde-escuro sobre
ouro 9,47:1 e sobre o azul 7,57:1. No tema escuro o verde sobe para `152 55% 45%` (7,4:1 sobre o
fundo) e o texto do botão fica escuro (6,3:1).

Os tokens neutros do shadcn (`--secondary`, `--muted`, `--accent`) continuam **cinza de
propósito**: são superfícies de interface, não cor de marca.

## Arquivos

| Arquivo                                         | O que é                                                                                                                                                                                                                             | Quem usa                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `tokens.css`                                    | Variáveis CSS (cores, raio) — tema claro e escuro                                                                                                                                                                                   | `painel/src/index.css`, `site/src/styles/global.css` |
| `theme.css`                                     | Tema do **Tailwind 4** (`@theme`): transforma as variáveis em classes (`bg-primary`, `text-brand-secondary-foreground`, `rounded-lg`, `shadow-card`), fonte, sombras, variante `dark`, paleta v3 preservada para as cores de status | idem                                                 |
| `base.css`                                      | Regras-base (borda, fundo do `body`, foco visível, compatibilidade de botão/placeholder com o Tailwind 3)                                                                                                                           | idem                                                 |
| `logo/asaf-logo-original.png`                   | **Logo institucional — arquivo mestre** (2607×2160, fundo transparente)                                                                                                                                                             | tudo abaixo é gerado dele                            |
| `logo/*.webp`, `logo/*.png`, `logo/favicon.ico` | Derivados (160/640/600 px, ícones 48/192/512, apple-touch)                                                                                                                                                                          | copiados para `site/public/` e `painel/public/`      |

Em JavaScript (gráficos Recharts) as cores espelham os tokens em `painel/src/lib/tokens.ts`.

### Como os dois projetos consomem (Tailwind 4, CSS-first)

Não existe mais `tailwind.config.js`, `postcss.config.js` nem preset em JavaScript: o Tailwind 4
é configurado em CSS e entra pelo plugin do Vite (`@tailwindcss/vite`: em `painel/vite.config.ts`
e em `site/astro.config.mjs`). O CSS de entrada de cada projeto tem sempre as mesmas 4 linhas,
**nesta ordem**:

```css
@import "tailwindcss" source(none);
@import "<caminho>/design/theme.css";
@import "<caminho>/design/tokens.css";
@import "<caminho>/design/base.css";

@source '<onde estão as classes do projeto>';
```

`source(none)` + `@source` fazem o Tailwind varrer só os arquivos do próprio projeto (painel:
`index.html` e `src/**/*.{ts,tsx}`; site: `src/**/*.{astro,html,ts}`), igual ao antigo `content`.
Tudo que é identidade (cor, raio, sombra, fonte, tema escuro) está nos três arquivos daqui.

## Regras

- **Trocar uma cor?** Edite `tokens.css` (e o espelho em `painel/src/lib/tokens.ts`). Os dois
  projetos mudam juntos no próximo deploy (mudança em `design/` dispara o workflow do painel _e_
  do site). O contraste (WCAG AA: 4,5:1 para texto) é **guardado por teste**:
  `painel/src/test/tokens-contraste.test.ts` lê este `tokens.css` e calcula 15 pares texto/fundo
  nos dois temas — trocou uma cor para um par que não passa, o CI do painel reprova. (O axe do
  painel roda em jsdom e **não** mede contraste; o do site, em navegador real, mede.) Vermelho de
  erro/exclusão: claro `0 72% 46%`; escuro **mais claro** (`0 84.2% 60.2%`) com texto escuro, porque
  como texto de erro sobre o fundo escuro o vermelho antigo dava 2,0:1.
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
- Valores no formato `H S% L%` (sem `hsl()`): o `theme.css` os envolve em `hsl(var(--x))`, o que
  deixa o Tailwind aplicar opacidade (`bg-primary/50`) e o JavaScript dos gráficos usar
  `hsl(var(--border))`. **Token de cor novo = uma linha em `tokens.css` (claro e `.dark`) + uma
  linha `--color-<nome>: hsl(var(--<nome>))` em `theme.css`.**
- **`shadow-card` é uma sombra branca (invisível) de propósito** — reproduz o que o Tailwind 3
  sempre renderizou por causa de um conflito de nome (`card` era cor e sombra). Detalhes e como
  ligar a sombra suave no comentário de `theme.css`.
- **`v3-space-y-N` no lugar de `space-y-N` (só no painel).** O `space-y` do Tailwind 4 mudou de
  semântica (margem inferior, especificidade zero): em coluna simples é igual, mas nos formulários
  `flex flex-wrap items-end` e `grid` do FormShell desalinhava botões em 16 px e mudava a altura de
  telas inteiras. O utilitário `v3-space-y-*` (em `theme.css`) é a regra do Tailwind 3 byte a byte.
  Código novo: prefira `flex flex-col gap-N` / `grid gap-N`.
- `base.css` também repõe três padrões do Tailwind 3 que o preflight do 4 mudou: `padding: 1px`
  nas células de tabela, botão do `<input type="file">` com o visual do navegador e `cursor:
pointer`/cor do placeholder. Foram achados medindo a posição de TODOS os elementos de 53 telas
  do painel nos dois Tailwind (diferença final: 0 de 5.909 elementos).
- Em `npm run dev` o Vite não observa `design/` (fica fora da raiz do projeto): depois de editar
  `tokens.css`, `theme.css` ou `base.css`, reinicie o servidor de desenvolvimento.
- A paleta padrão do Tailwind 3 (`text-green-600`, `text-amber-600`...) está preservada em
  `theme.css` só para as famílias em uso (verde, âmbar, esmeralda, azul): o Tailwind 4 trocou a
  paleta padrão por outra, mais saturada, e os estados de status mudariam de cor.
- `--muted-foreground` sobre fundo `--muted` **não** passa em AA para texto pequeno — use sobre
  `--background` ou `--card`.
- Dark mode: os tokens `.dark` existem (o painel usa). O site, por ora, é só claro.
