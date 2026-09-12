# ASAF · Painel (front-end)

Shell + design system + contratos de front-end do sistema da ASAF (Associação Arca
da Família). Esta pasta é a **fundação do front-end** (v0.2.0 do `PLANO_PROJETO.md`):
os módulos de negócio das FASES 1–20 são construídos por cima desta base, sem reescrever
o shell, o tema ou os contratos.

## Stack (decisão congelada — ver `DECISOES_CONGELADAS.md` §4)

- **Vite + React + TypeScript em modo `strict`** (`strict: true`,
  `noUncheckedIndexedAccess: true`) — nunca TS frouxo que vira "JavaScript com enfeite".
- **Tailwind CSS** + **shadcn/ui** — os componentes ficam **copiados no repo**
  (`src/components/ui/`), não são uma dependência que pode "sumir" numa atualização.
- **Recharts** (gráficos), **TanStack Query** (estado de servidor) e **React Router**
  (navegação SPA).

## Perpetuidade (item 3 da v0.2.0)

Nenhum componente de UI vem de biblioteca paga nem de SaaS com licença por usuário.
Tudo que entra aqui precisa continuar funcionando se a associação parar de pagar
qualquer coisa. O custo do painel é só o Static Web App (dentro do crédito nonprofit).
A lista concreta de dependências open-source acima respeita essa regra.

## Scripts

| Comando                | O que faz                                      |
| ---------------------- | ---------------------------------------------- |
| `npm install`          | Instala as dependências                        |
| `npm run dev`          | Sobe o Vite em modo desenvolvimento            |
| `npm run build`        | `tsc --noEmit` + build de produção (`dist/`)   |
| `npm run preview`      | Serve o build de produção localmente           |
| `npm run typecheck`    | `tsc --noEmit` (checagem de tipos, sem emitir) |
| `npm run lint`         | ESLint                                         |
| `npm run format`       | Prettier (grava as formatações)                |
| `npm run format:check` | Prettier (apenas confere, sem gravar)          |

Os três portões de qualidade — `lint`, `format:check` e `typecheck` — rodam no CI
(`.github/workflows/deploy-painel.yml`) em todo pull request e push em `main`,
bloqueando merge de código quebrado.

## Deploy

O build de `main` é publicado no Static Web App `asaf-painel`
(`painel.asaf.org.br`) via GitHub Actions. O workflow loga no Azure por OIDC (sem
senha salva), busca o token `SWA-PAINEL-DEPLOY-TOKEN` no Key Vault `kv-asaf-arca` e
faz o upload do `dist/`.

## Autenticação no cliente (v0.2.1)

- **Access token em memória** (`src/lib/auth.ts`) — nunca em `localStorage`, que qualquer XSS lê.
- **Refresh token em cookie `HttpOnly`+`Secure`+`SameSite=Strict`** emitido pela API
  (ajuste de backend `v0.2.1a` em `app/routers/auth.py`).
- **Cliente HTTP único** (`src/lib/api.ts`): injeta `Authorization: Bearer`, detecta `401`,
  chama `POST /auth/refresh` **uma vez** (com fila de espera — nunca dois refresh concorrentes)
  e refaz a requisição original; se o refresh falhar, derruba a sessão e manda para o login.
- **Tela de login** (`src/pages/Login.tsx`): CPF com máscara e dígito verificador validado
  **no cliente** + segundo passo de TOTP quando a API responde `requer_mfa: true`.
- **429 de força bruta** tratado explicitamente: mensagem com minutos restantes, nunca erro
  genérico.

> Em produção o cookie `SameSite=Strict` exige que API e painel sejam o **mesmo site**
> (ex.: `painel.asaf.org.br` + `api.asaf.org.br`). Hoje a API responde em
> `*.azurecontainerapps.io` — para o cookie funcionar em produção é preciso publicar a API num
> domínio sob `asaf.org.br` e definir `VITE_API_URL` no build (ver `.env.example`).

## MFA obrigatório por nível (v0.2.2)

- `NivelAcesso.exige_mfa` (catálogo v0.1.5): Presidente e Diretoria exigem MFA por padrão.
- `GET /auth/me` devolve `mfa_obrigatorio` e `mfa_pendente`; quando pendente, o painel trava
  numa tela guiada (`/mfa/setup`): QR code + confirmação + **códigos de recuperação**.
- Códigos de recuperação (10, uso único, hasheados com bcrypt) aceitos no login no lugar do TOTP.
- Reset de MFA por outro admin (`gerenciar_acesso`), sempre auditado (`MFA_RESET_POR_TERCEIRO`).

## Shell do painel (v0.2.3)

- **Layout de três zonas**: barra superior (identidade, busca global, notificações, perfil),
  navegação lateral colapsável (vira gaveta abaixo de 1024px) e área de conteúdo.
- **Menu 100% por permissão**: manifesto `src/lib/modulos.ts` (`{ rota, rótulo, ícone, permissao }`)
  filtrado pelas permissões de `/auth/me` — zero `if (nivel === 'Presidente')`.
- **Guarda de rota** (`RequirePermission`) + página 403 que explica qual permissão falta; o
  backend revalida a mesma permissão (`exigir_permissao`).
- Slot reservado para a **barra de impersonação** (v0.2.9).

## Estrutura

```
painel/
  src/
    components/ui/       Componentes shadcn/ui copiados para o repo
    components/layout/   Shell (barra superior + navegação + conteúdo)
    lib/api.ts           Cliente HTTP único (Bearer + interceptor de refresh)
    lib/auth.ts      Access token em memória + callback de sessão expirada
    lib/auth-context.tsx  AuthProvider/useAuth (estado de login na UI)
    lib/cpf.ts           Máscara + validação de CPF no cliente
    lib/modulos.ts       Manifesto dos módulos (rota/rótulo/ícone/permissão)
    lib/use-me.ts        Hook do /auth/me (compartilhado entre shell e guards)
    lib/utils.ts         Helper cn() (clsx + tailwind-merge)
    pages/               Login, MfaSetup, Home, Forbidden e EmConstrucao
    App.tsx              Rotas + guards (RequireAuth/RequireMfa/RequirePermission)
    main.tsx         Entrypoint: QueryClientProvider + BrowserRouter + AuthProvider
  components.json    Config do shadcn/ui (para `npx shadcn add` no futuro)
```

## Referência rápida

- Plano de fases: `../PLANO_PROJETO.md` (seção v0.2).
- Decisões congeladas: `../DECISOES_CONGELADAS.md`.
- Arquitetura: `../ARQUITETURA.md`.
