# design/ — identidade visual da ASAF (fonte única)

Painel (`painel/`) e site (`site/`) precisam parecer a mesma instituição. Em vez de manter cores
copiadas nos dois, **tudo vive aqui** e os dois projetos consomem:

| Arquivo | O que é | Quem usa |
| --- | --- | --- |
| `tokens.css` | Variáveis CSS (cores, raio) — tema claro e escuro | `painel/src/index.css`, `site/src/styles/global.css` |
| `base.css` | Regras-base (borda, fundo do `body`, foco visível) | idem |
| `tailwind-preset.js` | `theme.extend` do Tailwind (cores nomeadas, sombras, fonte) | `painel/tailwind.config.js`, `site/tailwind.config.js` |

## Regras

- **Trocar uma cor?** Edite `tokens.css`. Os dois projetos mudam juntos no próximo deploy (mudança
  em `design/` dispara o workflow do painel *e* do site).
- **Nunca redefina um token dentro de `painel/` ou `site/`.** Se um dos dois precisar de algo
  diferente, o token novo nasce aqui, com nome próprio.
- Valores no formato `H S% L%` (sem `hsl()`), para o Tailwind aplicar opacidade (`bg-primary/50`).
- Contraste: texto sobre `--primary` e sobre `--secondary`/`--muted` já foi auditado (axe, WCAG AA)
  nas telas do site. `--muted-foreground` sobre fundo `--muted` **não** passa em AA para texto
  pequeno — use sobre `--background` ou `--card`.
- Dark mode: os tokens `.dark` existem (o painel usa). O site, por ora, é só claro (v5.0).
