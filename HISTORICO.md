# Histórico de versões concluídas — ASAF

> Separado de `PLANO_PROJETO.md` em 2026-09-30 para manter o roteiro do que falta construir
> enxuto e navegável (o arquivo único tinha passado de 6.600 linhas). Aqui mora o registro
> completo — checklist original e o parágrafo de confirmação em produção — de cada fase/versão
> já entregue. Nada foi reescrito ou resumido: o conteúdo abaixo é a cópia exata do que estava em
> `PLANO_PROJETO.md`.
>
> **Nota sobre checkboxes `[ ]` que ainda aparecem aqui**: em várias versões (majoritariamente
> v3.2.3–v4.7), o processo de trabalho antigo só marcava `[x]` depois de confirmação visual num
> navegador interativo — ferramenta que várias sessões de implementação não tinham disponível. A
> versão ficou pronta, testada e implantada em produção (ver o parágrafo de confirmação logo
> abaixo do checklist de cada uma) mas a caixinha nunca foi marcada depois. **O parágrafo de
> confirmação é a fonte de verdade sobre o que foi de fato entregue, não o estado do `[ ]`/`[x]`**
> — não foi feita uma varredura item-a-item corrigindo cada caixinha retroativamente, pra não
> arriscar reclassificar errado algo que ainda é uma pendência real (ex.: itens que dependem de
> uma fase futura, como assinatura eletrônica da FASE 20, ou que foram deliberadamente adiados,
> como o Pix Automático de verdade na v3.2.1) sem reler cada um com cuidado.

> **FASE 5 (movida em 2026-10-20)**: quando a FASE 5 fechou, o bloco inteiro dela (v5.0 a v5.7h, os dois Pontos de
> Revisão e o "Fechamento da FASE 5") foi copiado para o fim deste arquivo, também sem alteração.

---

<a id="fase-0"></a>

### FASE 0 — Fundação (infraestrutura, identidade, permissão, painel único)

#### v0.0 — Provisionamento de infraestrutura (Azure + GitHub) — literalmente o primeiro passo ✅ CONCLUÍDO (2026-09-11)

- [x] Criar o repositório no GitHub (`Arca-da-Familia/asaf`, público) — feito, com LICENSE de
      uso restrito. `.gitignore`/`CREDENCIAIS_AZURE.md` protegendo segredo desde o commit zero.
- [x] Criar o grupo de recursos no Azure e provisionar: Postgres (`asaf-pg-server`/`asaf_db`,
      backup 35 dias + geo-redundância) → Blob Storage (`stasafarcadafamilia`, soft delete +
      versionamento) → Container Registry (`asafregistry`) → Container App do FastAPI
      (`asaf-api`) → Container App do Directus (`asaf-directus`) → Static Web Apps (site +
      painel, com domínio próprio `asaf.org.br`/`painel.asaf.org.br`) → Key Vault
      (`kv-asaf-arca`) → Application Insights (`asaf-appinsights`).
- [x] `CREDENCIAIS_AZURE.md` preenchido e mantido atualizado a cada recurso criado.
- [x] Service Principal (`asaf-github-actions`) com OIDC, escopado só ao resource group, com
      credencial federada — corrigida uma vez em produção (GitHub passou a exigir subject com
      IDs numéricos de org/repo, não só o nome).
- [x] Alerta de orçamento de US$100/mês configurado manualmente pelo Portal (a API rejeitou a
      criação automatizada — limitação real do tipo de assinatura, documentada).
- [x] **CI/CD completo e testado**: workflow builda a imagem via ACR Tasks e atualiza o
      Container App a cada push em `main` — dois incidentes reais de produção encontrados e
      corrigidos nesse processo (ver `CREDENCIAIS_AZURE.md`): (1) o IP "estático" do ambiente
      Container Apps é só de entrada, não de saída — restringir o firewall do Postgres a ele
      quebrou tudo; a regra correta para este porte é "Allow Azure services", sem VNET+NAT
      Gateway; (2) a auto-migração de schema (`preparar_banco()`) levava 27s a cada boot e
      estourava o startup probe do Container App, causando reinício em loop — agora é opcional
      via `RUN_DB_MIGRATION`, desligada em produção.
- [x] Dependências do backend atualizadas para a versão mais recente estável de cada uma
      (fastapi, uvicorn, sqlalchemy, pydantic, psycopg2-binary, python-multipart), testado de
      ponta a ponta antes e depois do deploy. `pyjwt` já instalado com antecedência para a
      migração de autenticação da v0.1, e `JWT_SECRET` já gerado no Key Vault.

#### v0.1 — Identidade e permissão (expandida ao nível mais alto antes de codar, 2026-09-11)

> **Achado ao ler o código antes de começar**: `criptografar_senha()` (SHA-256 sem salt) existe
> em `app/utils.py` mas **nunca é chamado em nenhuma rota** — não existe login funcional hoje, só
> o scaffolding de tabelas (`Usuario`, `TokenAcesso`, `NivelAcesso`, `PermissaoSistema`,
> `perfil_permissao`). `Associado.id_usuario` (FK pra `usuarios.id_usuario`) já existe e confirma
> o desenho pretendido: login por CPF do `Associado`, senha fica no `Usuario` vinculado — 1:1.
> Ou seja, v0.1 não é "migrar" nada quebrado, é **construir identidade e permissão do zero** em
> cima de uma modelagem de tabela que já está certa. Isso muda o v0.1 de "ajuste" pra "módulo
> novo completo" — daí a expansão abaixo.

##### v0.1.1 — Hash de senha ✅ IMPLEMENTADO (2026-09-11)

- [x] Trocado SHA-256 sem salt por **bcrypt** (`bcrypt` direto). `hash_senha`/`verificar_senha`
      em `app/security.py` (módulo novo, separado de `app/utils.py`).

##### v0.1.2 — Login por CPF + senha, com JWT de verdade (access + refresh) ✅ IMPLEMENTADO

- [x] `POST /auth/login` — access token JWT (45 min) + refresh token opaco (30 dias, guardado em
      `TokenAcesso`). Mensagem de erro genérica de propósito ("CPF ou senha inválidos") — nunca
      revela se o CPF existe, evita enumeração de associado por tentativa de login.
- [x] `POST /auth/refresh` — valida contra `TokenAcesso`, emite novo access token. Rotação do
      refresh token a cada uso **não** implementada nesta versão (avaliar depois se compensa).
- [x] `POST /auth/logout` — apaga a linha de `TokenAcesso` (revogação real, testado: refresh
      depois do logout falha com 401).
- [x] `GET /auth/me` — nome, nível, permissões do nível logado.
- [x] Bloqueio por força bruta guardado no banco (`tentativas_falhas`/`bloqueado_ate` no
      `Usuario`, funciona entre réplicas do Container App) — testado: 5 tentativas erradas → 429
      na 6ª.

##### v0.1.3 — Autorização: dependency de permissão por rota ✅ IMPLEMENTADO

- [x] `get_current_user` e `exigir_permissao(codigo)` em `app/security.py` — testado: rota
      protegida (`/api/niveis-acesso/`) dá 401 sem token e 200 com token de nível autorizado.

##### v0.1.4 — MFA (TOTP) ✅ IMPLEMENTADO

- [x] `Usuario.mfa_secret`/`mfa_ativado` (migração Alembic aplicada em produção).
- [x] `POST /auth/mfa/ativar` (gera segredo, devolve `otpauth://`) + `POST /auth/mfa/confirmar`
      (só ativa depois de confirmar o 1º código) + `POST /auth/login/mfa` (2º passo do login,
      token temporário de 5 min entre os dois passos). Testado de ponta a ponta com `pyotp`:
      ativação, código errado rejeitado, código certo libera token completo.
- [ ] **Decisão confirmada com o usuário (2026-09-11)**: ativação **obrigatória** por nível
      (Presidente/Diretoria) fica para a v0.2 de propósito, não é esquecimento. Hoje é opcional
      pra todo mundo (ativa quem quiser via `/auth/mfa/ativar`) porque forçar isso sem uma tela
      guiada (QR code, confirmação) deixaria a pessoa travada tentando logar sem interface pra
      configurar — só via Swagger/Postman, experiência ruim. Assim que o painel (v0.2) existir:
      login detecta `mfa_ativado=false` num nível que exige, mostra a tela de configuração antes
      de liberar o resto do sistema.

##### v0.1.5 — Catálogo configurável de `NivelAcesso` e `PermissaoSistema` ✅ IMPLEMENTADO

- [x] CRUD completo em `app/routers/core.py`, protegido pela permissão `gerenciar_acesso`.
- [x] Seed inicial (`seed_niveis_e_permissoes()` em `app/database.py`): Presidente, Diretoria,
      Conselho Fiscal, Associado, Voluntário Externo — com permissões básicas por módulo já
      atribuídas (Presidente recebe todas). Roda sempre no boot (não depende de
      `RUN_DB_MIGRATION`, ver achado abaixo).

##### v0.1.6 — `AuditLog` ✅ IMPLEMENTADO

- [x] Model novo (`app/models/core.py`) + `registrar_auditoria()` em `app/auditoria.py`.
      Registra hoje: `LOGIN`, `LOGIN_FALHA`, `MFA_ATIVADO`, `BOOTSTRAP_ADMIN`. Uso em mais rotas
      (financeiro, edição de associado) fica pra quando essas rotas ganharem `exigir_permissao`
      de verdade (ainda não protegidas — ver pontos em aberto).

##### v0.1.8 — Achado durante a implementação: seeds presos à flag errada

- [x] `seed_opcoes_lista()` e o novo `seed_niveis_e_permissoes()` estavam (o primeiro já
      existia assim) condicionados à mesma variável `RUN_DB_MIGRATION` que desliga a auditoria
      **lenta** de schema (`preparar_banco()`, causa do incidente de crash-loop) — como essa
      variável está `false` em produção desde aquele incidente, **os seeds nunca tinham rodado
      de fato em produção**. Corrigido: seeds (rápidos, idempotentes) sempre rodam; só
      `preparar_banco()` (lento, substituído pelo Alembic) continua condicionado à flag.

##### v0.1.9 — Bootstrap do primeiro administrador

- [x] `POST /auth/bootstrap-admin` — cria o primeiro `Usuario`/`Associado` com nível Presidente,
      só funciona enquanto `Usuario` estiver vazio (trava de segurança, testada: 2ª tentativa
      dá 403). **Pendente**: a diretoria real da ASAF ainda precisa chamar essa rota com os
      próprios dados (nome, CPF, e-mail, senha) para criar o primeiro acesso de verdade — não
      foi criado nenhum usuário real nesta sessão, só testado com dado fictício e removido
      depois.

##### v0.1.7 — O que fica fora desta versão, de propósito (não é "esquecimento")

- **Row-level security do Postgres** (FASE 15/v15.1) — só faz sentido pleno quando existir
  diferenciação real de acesso por linha (ex.: voluntário vendo só o próprio histórico, FASE 4) —
  ainda não construído. Implementar RLS agora seria antecipar proteção para um dado que ainda não
  existe.
- **Keycloak/SSO externo** (FASE 20/v20.1) — login próprio (v0.1.2) resolve a necessidade
  imediata; Keycloak entra quando precisar de SSO entre múltiplos sistemas (painel + Directus +
  outro), não antes.
- ~~Login via gov.br~~ — **descartado, confirmado por pesquisa e pela tentativa real do
  usuário**: o Login Único gov.br para aplicação privada não é um cadastro aberto — passa por
  Loja do Serpro/Dataprev, análise discricionária de "interesse público" e cobrança comercial por
  volume, inviável para o porte da ASAF.

#### v0.2 — Painel único (expandido ao nível máximo antes de codar)

> **Por que esta versão é grande**: o painel não é "uma tela de menu". Ele é a **casca** que todos
> os módulos das FASES 1–20 vão habitar pelos próximos 10–20 anos. Erro de fundação aqui (menu
> hardcoded, permissão só no front, tema preso a uma biblioteca, tabela sem padrão) se paga em
> retrabalho em cada módulo novo. Por isso a v0.2 vai muito além de "substituir o
> `templates/index.html`": ela entrega o **shell + o design system + os contratos de front-end**
> que as fases seguintes só consomem.

##### v0.2.0 — Fundação do projeto de front-end

- [x] Repositório/pasta `painel/` no mesmo repo (monorepo simples, sem ferramenta de monorepo) —
      Vite + React + TypeScript **strict** (`strict: true`, `noUncheckedIndexedAccess`), nunca
      TS frouxo que vira JavaScript com enfeite.
- [x] Tailwind + shadcn/ui (componentes copiados pro repo, não dependência que some) + Recharts
      para gráfico + TanStack Query para estado de servidor + React Router.
- [x] **Decisão explícita de perpetuidade**: nenhum componente de UI vem de biblioteca paga ou de
      SaaS com licença por usuário. Tudo que entrar tem que continuar funcionando se a associação
      parar de pagar qualquer coisa.
- [x] ESLint + Prettier + `tsc --noEmit` rodando no CI (workflow novo `deploy-painel.yml`),
      bloqueando merge quebrado.
- [x] Build publicado no Static Web App `asaf-painel` (já provisionado na v0.0) via GitHub Actions
      com o deploy token que já está no Key Vault (`SWA-PAINEL-DEPLOY-TOKEN`).

##### v0.2.1 — Camada de autenticação no cliente (contrato com a v0.1)

- [x] Cliente HTTP único (`api.ts`) com interceptor: injeta `Authorization: Bearer`, detecta 401,
      tenta `POST /auth/refresh` **uma vez**, refaz a requisição original; se o refresh falhar,
      derruba a sessão e manda pro login. Nunca dois refresh concorrentes (fila de espera de
      requisições enquanto o refresh está em voo).
- [x] Armazenamento do token: access token **em memória** (nunca `localStorage`, que é lido por
      qualquer XSS); refresh token em cookie `HttpOnly`+`Secure`+`SameSite=Strict` emitido pela
      API — **muda o contrato da v0.1**, que hoje devolve o refresh no corpo JSON. Registrar como
      ajuste de API a fazer junto com esta versão (`v0.2.1a`).
- [x] `v0.2.1a` (ajuste no backend) — `POST /auth/login` e `/auth/login/mfa` passam a também
      setar o refresh token como cookie `HttpOnly`; `/auth/refresh` e `/auth/logout` passam a
      aceitar o token pelo cookie quando o corpo não vier. **Corrigido no ponto de revisão
      abaixo**: o corpo JSON de resposta nunca ecoa o valor do refresh token de volta (nem em
      `/login`, `/login/mfa` nem em `/refresh`) — devolvê-lo ali também anularia a proteção do
      `HttpOnly` contra XSS. Cliente de linha de comando/teste que precise do valor bruto lê do
      header `Set-Cookie` da resposta (não acessível a partir de JS do navegador, mas legível
      por qualquer cliente HTTP fora do navegador).
- [x] Tela de login: CPF com máscara e validação de dígito verificador **no cliente** (evita
      requisição inútil) + segundo passo de TOTP quando a API responder `requer_mfa: true`.
- [x] Tratamento explícito do 429 de bloqueio por força bruta (v0.1.2): mensagem clara de "muitas
      tentativas, tente de novo em X minutos", nunca erro genérico.
- [x] Bootstrap de sessão no carregamento da aplicação (`bootstrapSession()`, chamado uma vez
      pelo `AuthProvider`): como o access token só existe em memória, ele não sobrevive a um F5
      — sem isso, o cookie de refresh de 30 dias nunca teria efeito prático. Enquanto a checagem
      roda, nenhuma rota redireciona para `/login` (evita o "pisca" de tela de login a cada
      recarga).

##### 🔍 Ponto de Revisão — FASE 0 / v0.2 (1/3, fecha v0.2.0–v0.2.3) — aplicado em 2026-09-11

Implementação de v0.2.0–v0.2.1 feita por outra sessão de IA; revisado nesta sessão contra o
checklist padrão (seção 4.1) antes de aceitar. **Dois problemas reais encontrados e corrigidos**:

1. **(Crítico)** O backend gravava o refresh token no cookie `HttpOnly` **e também** devolvia o
   mesmo valor em texto no corpo JSON de `/login`, `/login/mfa` e `/refresh` — isso anulava a
   proteção contra XSS que o `HttpOnly` existe para dar (um script injetado na página não lê o
   cookie, mas conseguiria ler o valor na resposta da própria chamada de login que o usuário
   legítimo faz). Violava a decisão congelada 4.2. Corrigido: os três endpoints agora sempre
   devolvem `refresh_token: null` no corpo depois que o cookie foi gravado/consultado.
2. O painel não tinha nenhum bootstrap de sessão no carregamento — a marcação `[x]` das
   sub-versões estava otimista: o cookie de 30 dias existia, mas nada o usava ao recarregar a
   página, então toda sessão morria em qualquer F5. Corrigido: `bootstrapSession()` +
   `isBootstrapping` no `AuthProvider`.

Depois da correção: `npm run typecheck`, `npm run lint`, `npm run format:check` e `npm run build`
rodados manualmente e todos passando; `python -m py_compile` confirmando que o backend segue
válido. Nenhum teste automatizado existe ainda para este fluxo (a v0.2.8 — Vitest/Playwright —
ainda não foi implementada); registrar como item a cobrir quando aquela sub-versão for feita.

##### v0.2.2 — Onboarding obrigatório de MFA (fecha a pendência registrada na v0.1.4)

- [x] `v0.2.2a` (backend) — `NivelAcesso.exige_mfa` (booleano, configurável pelo catálogo da
      v0.1.5, não hardcoded). Seed: `true` para Presidente e Diretoria, `false` para os demais.
- [x] `v0.2.2b` (backend) — `GET /auth/me` passa a devolver `mfa_obrigatorio` (do nível) e
      `mfa_pendente` (`exige_mfa && !mfa_ativado`).
- [x] `v0.2.2c` (front) — se `mfa_pendente`, o roteador trava o painel inteiro numa tela guiada:
      QR code renderizado a partir do `otpauth_uri` de `/auth/mfa/ativar`, campo do 1º código,
      confirmação via `/auth/mfa/confirmar`. Só depois libera a navegação.
- [x] `v0.2.2d` (backend) — **códigos de recuperação**: 10 códigos de uso único gerados na
      confirmação do MFA, mostrados **uma única vez**, guardados hasheados (bcrypt) numa tabela
      `CodigoRecuperacaoMFA`. Aceitos no lugar do TOTP em `/auth/login/mfa`, queimados no uso.
      Sem isso, perder o celular = perder o acesso de Presidente, o que é um risco operacional
      real e não teórico.
- [x] `v0.2.2e` — reset de MFA por outro administrador (quem tiver `gerenciar_acesso`), sempre
      registrado em `AuditLog` com `MFA_RESET_POR_TERCEIRO` — jamais reset silencioso.

##### v0.2.3 — Shell do painel (layout, navegação, estado global)

- [x] Layout de três zonas: barra superior (identidade da associação, busca global, perfil,
      notificações), navegação lateral colapsável, área de conteúdo. Responsivo real: a lateral
      vira gaveta abaixo de 1024px — a diretoria vai usar isso no celular, não é hipótese.
- [x] **Menu montado 100% a partir das permissões** devolvidas por `/auth/me`: cada módulo se
      registra num manifesto (`modulos.ts`) declarando `{ rota, rótulo, ícone, permissao }`; o
      shell filtra pelo que o usuário tem. Nenhum `if (nivel === 'Presidente')` em lugar nenhum
      do código — esse é o antipadrão que o plano está explicitamente evitando.
- [x] Guarda de rota por permissão, com página 403 própria (não redireciona em silêncio, explica
      que falta permissão e qual) — e a mesma permissão checada **de novo no backend**: o front
      esconde, o backend proíbe.
- [x] Barra de "impersonação" visível quando um administrador estiver vendo o sistema como outro
      papel (v0.2.9) — nunca permitir sessão ambígua.

##### v0.2.4 — Design system e padrões de tela reaproveitáveis

- [x] Tokens de design (cores institucionais da ASAF, tipografia, espaçamento, raio, sombra) num
      único lugar — trocar a identidade visual da associação não pode exigir caçar cor em 40
      arquivos.
- [x] Modo claro/escuro respeitando a preferência do sistema, com opção manual persistida.
- [x] **Componentes-padrão que todo módulo futuro reusa** (construídos aqui, uma vez só):
      `DataTable` (ordenação, filtro, paginação server-side, seleção, densidade), `FormShell`
      (validação com Zod + react-hook-form, erro de campo vindo do 422 do FastAPI mapeado
      automaticamente), `ConfirmDialog` (ação destrutiva sempre com confirmação nomeada),
      `EmptyState`, `SkeletonLoader`, `ErrorBoundary` por módulo, `PageHeader` com trilha de
      navegação, `Timeline` (histórico/auditoria), `FileUpload` (com barra de progresso e limite
      de tipo/tamanho), `MoneyInput`/`CpfInput`/`CnpjInput`/`DateInput` com formato brasileiro.
- [x] Catálogo vivo dos componentes (Storybook **ou** uma rota `/dev/componentes` no próprio
      painel, decisão de implementação) — documentação que não apodrece porque é o próprio código.

##### v0.2.5 — Módulo "Meu Perfil" (o único módulo funcional entregue na v0.2)

- [x] Dados cadastrais próprios (leitura do `Associado` vinculado; edição entra como **solicitação
      de alteração** quando o fluxo de aprovação da v13.3 existir — na v0.2 edita direto só campo
      de contato: telefone, e-mail, endereço).
- [x] Troca de senha com política explícita (mínimo 10 caracteres, verificação contra lista de
      senhas mais comuns, nunca regra decorativa de "1 maiúscula e 1 símbolo" que só gera
      `Senha@123`) — `v0.2.5a` no backend: `POST /auth/senha/alterar` exigindo a senha atual e
      revogando **todos os refresh tokens** do usuário exceto o da sessão corrente.
- [x] Gestão de MFA (ativar, desativar exigindo senha + TOTP, regerar códigos de recuperação).
- [x] **Sessões ativas**: lista de refresh tokens vivos com data de criação, IP e User-Agent, com
      botão "encerrar esta sessão" e "encerrar todas as outras" — `v0.2.5b` no backend:
      `TokenAcesso` ganha `ip_origem`, `user_agent`, `criado_em`, `ultimo_uso_em`; endpoints
      `GET /auth/sessoes` e `DELETE /auth/sessoes/{id}`.
- [x] Meus documentos (lista dos `DocumentoAnexo` do próprio associado) — só leitura nesta versão.

##### v0.2.6 — Acessibilidade e internacionalização de base (feito agora, não "depois")

- [x] Navegação completa por teclado, foco visível, `aria-label` em ícone sem texto, contraste
      mínimo AA — auditado com axe-core no CI. Fazer isso na v0.2 custa pouco; retrofitar em 20
      módulos prontos custa caro (antecipa a FASE 9/v9.1 para o que é estrutural).
- [x] Todo texto de interface sai de um arquivo de mensagens (`pt-BR.ts`), mesmo sem plano de
      traduzir — o ganho imediato é padronizar vocabulário ("associado", nunca "membro"/"usuário"
      alternando na mesma tela) e permitir revisão de texto sem mexer em componente.
- [x] Formatação de data/moeda/número sempre por `Intl`, nunca concatenação manual.

##### 🔍 Ponto de Revisão — FASE 0 / v0.2 (2/3, fecha v0.2.4–v0.2.6) — aplicado em 2026-09-12

Revisado nesta sessão contra o checklist padrão (seção 4.1), a partir de uma máquina nova
recém-configurada (git, SOPS/age, Node e Python instalados só para tornar esta verificação real,
não de leitura de código). **Nenhum problema bloqueante encontrado** nos três itens específicos:

1. **Nenhuma dependência paga/SaaS** (v0.2.4): `painel/package.json` conferido linha a linha
   contra `DECISOES_CONGELADAS.md` §4.3 — tudo open-source (Radix UI, TanStack Query/Table,
   Recharts, lucide-react, qrcode.react, react-hook-form, Zod). Nenhuma licença por usuário.
2. **Troca de senha revoga sessões** (v0.2.5): confirmado em código
   (`app/routers/auth.py::alterar_senha` chama `revogar_tokens_exceto` com o cookie da sessão
   corrente preservado) — bate com o desenho descrito. **Achado**: não existe teste automatizado
   backend para esse fluxo (nem para nenhum outro — `requirements-dev.txt` lista `pytest`, mas
   não há um único arquivo `test_*.py` no repositório, e `deploy-api.yml` não roda teste algum).
   Não é regressão desta revisão — já era esperado (ver v0.2.8, ainda não implementada) — mas
   fica registrado aqui de novo para não virar pendência silenciosa: **v0.2.8 precisa cobrir
   isto com prioridade**, é comportamento de segurança, não deveria depender só de leitura de
   código para ser confiável.
3. **Auditoria de acessibilidade roda no CI de verdade** (v0.2.6): confirmado lendo
   `.github/workflows/deploy-painel.yml` (job `quality` roda `npm run test`) e rodando
   localmente — `acessibilidade.test.tsx` passou contra o catálogo `DevComponents` real. Testado
   também que o axe **de fato pega violação** (teste temporário com `<img>` sem `alt`, falhou
   como esperado, removido em seguida) — não é auditoria decorativa.

**Suíte completa do painel rodada de ponta a ponta nesta sessão** (não só o intervalo revisado):
`npm run lint` (0 erros, 3 avisos pré-existentes de fast-refresh, sem relação com este intervalo),
`npm run typecheck` (limpo), `npm run test` (1/1 passando), `npm run build` (build de produção
concluído). `npm run format:check` **acusou 53 arquivos** — investigado e é causado por
`core.autocrlf=true` desta máquina Windows convertendo LF→CRLF no checkout, não por código fora
do padrão; o CI roda em `ubuntu-latest` e não sofre disso. Registrado aqui para a próxima sessão
não se assustar com o mesmo sintoma nem "corrigir" isso commitando CRLF.

**Achado adicional, fora do escopo dos 3 itens específicos mas relevante à seção 4.1 item 4**:
`npm audit` acusa 7 vulnerabilidades (5 moderadas, 1 alta, 1 crítica) em `vitest`/`esbuild`
(servidor de dev, não afeta o build estático de produção) e `react-router` (redirecionamento
aberto, severidade moderada). Nenhuma delas atinge o app publicado — mas a correção exige upgrade
com breaking change (`npm audit fix --force`); não aplicado nesta revisão para não introduzir
regressão sem plano de teste. Fica como item de manutenção a agendar, fora deste ponto de revisão.

Backend: `python -m compileall app` rodado, sem erro de sintaxe. Sem suíte de teste backend para
rodar (ver achado #2 acima). `AuditLog` confirmado gravando de verdade para todas as ações
sensíveis do intervalo (`SENHA_ALTERADA`, `MFA_DESATIVADO`, `SESSAO_REVOGADA`,
`PERFIL_ATUALIZADO`, `MFA_RECUPERACAO_REGERADA`) e toda rota de `/auth/perfil`, `/auth/sessoes`,
`/auth/mfa/*` exige `get_current_user` e filtra pelo `id_usuario` do token — nunca por parâmetro
vindo do cliente. **Fase liberada para avançar** para v0.2.7–v0.2.10.

##### v0.2.7 — Robustez operacional do painel ✅ IMPLEMENTADO (2026-09-12)

- [x] Estado de erro de rede tratado globalmente (`lib/network-status.ts`, um store mínimo
      assinado via `useSyncExternalStore`): toda chamada HTTP passa por `fetchInstrumentado`
      em `lib/api.ts`. Requisição em voo por mais de 3s sem resposta → `StatusBar` mostra
      "acordando o servidor…" (cobre o cold start do scale-to-zero); falha de rede de verdade
      (fetch lança exceção, ou evento `offline` do navegador) → faixa persistente "sem conexão".
      Uma resposta HTTP real (mesmo 4xx/5xx) sempre volta o estado a "ok" — só falha de
      transporte conta como offline, nunca erro de aplicação.
- [x] `scripts/gerar-version.js` gera `public/version.json` (commit curto + timestamp) antes de
      `dev`/`build` (`predev`/`prebuild` no `package.json`); Vite copia para `dist/` como
      qualquer asset de `public/`. `lib/versao.ts` (`useVersaoBuild`) busca esse arquivo com
      `cache: 'no-store'` a cada 5 min e compara com o commit carregado no início da sessão —
      diferente, mostra o aviso "nova versão disponível" com botão "Recarregar" no `StatusBar`.
      Rodapé do `Shell` mostra o commit atual. Testado: build local gerou `version.json` com o
      commit correto e o Vite serviu `/version.json` de verdade no dev server.
- [x] `lib/monitoramento.ts` inicializa o Application Insights Web SDK
      (`@microsoft/applicationinsights-web`) a partir de `VITE_APPINSIGHTS_CONNECTION_STRING` —
      **sem essa variável configurada, vira no-op** (só `console.error`), nunca quebra o painel
      por falta de telemetria configurada. Conectado a três fontes de erro: `ErrorBoundary`
      (`componentDidCatch`, por módulo), `window.onerror` e `unhandledrejection` (globais).
      **Achado corrigido nesta versão**: o `ErrorBoundary` (construído na v0.2.4) existia mas
      não estava usado em nenhuma rota — adicionado ao redor de cada módulo de negócio em
      `App.tsx` (Associados, Financeiro, Governança, Projetos, Acesso, Auditoria), do contrário
      a auditoria de erro desta versão nunca capturaria um erro de render de módulo de verdade.
      **Pendência registrada, fora de escopo desta sessão**: ninguém ainda configurou o valor
      real de `VITE_APPINSIGHTS_CONNECTION_STRING` no `deploy-painel.yml` (não é segredo, mas
      não adivinhei o nome do secret no Key Vault sem confirmar — fica para quem for ativar a
      telemetria em produção).

Verificação real feita nesta sessão: `npm run lint`/`typecheck`/`test`/`build` passando, dev
server rodado de verdade com Playwright/Chromium headless (tela de login renderizada sem erro
de JS, `/version.json` servido corretamente) — não deu para testar o `StatusBar`/rodapé
dentro do Shell autenticado porque isso exige backend + Postgres rodando, que não existem
nesta máquina; registrado aqui para quem tiver o backend de pé validar visualmente.

> **Achado de infraestrutura (não é bug de código), corrigido nesta sessão**: acompanhando o
> deploy real desta versão no GitHub Actions, descobrimos que **o painel nunca tinha sido
> publicado com sucesso no Static Web App via CI/CD** — todo run de `deploy-painel.yml` desde o
> primeiro registrado (v0.2.0) falhava na etapa "Busca o deploy token no Key Vault": o Service
> Principal `asaf-github-actions` não tinha permissão `get`/`list` de segredo no `kv-asaf-arca`
> (só tinha o login OIDC, nunca ganhou acesso ao cofre). Corrigido com
> `az keyvault set-policy` concedendo `secrets: get, list` a esse Service Principal. Depois
> dessa correção, apareceu um **segundo problema, também de infraestrutura**: a action
> `Azure/static-web-apps-deploy@v1` zipa `app_location` (`painel/`) inteiro para publicar, mesmo
> com `skip_app_build: true` — como o `npm ci` roda nessa mesma pasta no job, o `node_modules`
> (~330MB) ia junto e estourava o limite de 250MB do Static Web App no plano Free ("size of the
> app content was too large"). Um `.swaignore` sozinho não resolveu; a correção efetiva foi um
> passo `rm -rf node_modules` entre o build e a publicação (o build já está pronto em `dist/`
> nesse ponto). Confirmado com deploy real, bem-sucedido, em 2026-09-12 —
> `https://black-smoke-0d66eee10.3.azurestaticapps.net/` responde 200. **Isso significa que
> nenhuma versão do painel (v0.2.0 até aqui) tinha chegado à produção antes desta correção**,
> apesar do código estar correto e dos portões de qualidade sempre terem passado — vale revisar
> se algo do que se assumia "já em produção" precisa ser reconferido.

##### v0.2.8 — Testes do painel (padrão que vale para todas as fases seguintes) ✅ IMPLEMENTADO (2026-09-12)

- [x] **Vitest + Testing Library**: `test/form-shell.test.tsx` (o `FormShell` é reaproveitado por
      todo formulário do painel — validação Zod bloqueia envio inválido, mapeia 422 do backend
      pro campo certo, mostra erro geral pra falha genérica), `test/app-guards.test.tsx` (as três
      regras de tela que protegem o roteamento inteiro — `RequireAuth`, `RequireMfa`,
      `RequirePermission`, exportadas de `App.tsx` propositalmente para isso — testadas
      isoladas com `useAuth`/`useMe` mockados), `test/api.test.ts` (o interceptor 401→refresh→
      retry-uma-vez, mapeamento de erro 422, e que falha de transporte de verdade marca o
      `network-status` como offline).
- [x] **Playwright** (`e2e/auth.spec.ts`, roda contra a API **mockada via `page.route`** — não
      existe Postgres nesta máquina, e esses testes validam o comportamento do painel diante de
      cada resposta possível da API, não o backend em si, que tem sua própria suíte):
      login sem MFA, login com MFA (segundo fator), CPF inválido bloqueado no cliente sem
      chamar a API, sessão derrubada quando o refresh falha de verdade (volta pro login), e 403
      ao acessar um módulo sem a permissão (não o conteúdo do módulo). 5/5 passando localmente.
      Adicionado ao CI (`deploy-painel.yml`, job `quality`): instala o Chromium do Playwright e
      roda `npm run test:e2e` como portão, antes do build de produção.
- [x] **Teste de contrato Zod** (`lib/schemas.ts` + `lib/api.ts`): `meResponseSchema` e
      `perfilResponseSchema` validam a resposta de `/auth/me` e `/auth/perfil` de verdade em
      tempo de execução (`.safeParse`, não só tipo TS que desaparece no build) — `perfilEditavelSchema`
      é literalmente o mesmo schema usado no formulário de "Dados cadastrais"
      (`pages/Perfil.tsx`), não uma cópia paralela. Testado: um fixture com `mfa_ativado`
      renomeado para `mfaAtivado` (simulando o backend mudando um campo) faz `me()` rejeitar com
      mensagem apontando o campo exato — antes de qualquer componente reagir a um `undefined`.

Verificação real: `npm run lint`/`typecheck`/`test`/`test:e2e`/`build` todos rodados e passando
nesta sessão (18 testes Vitest + 5 Playwright). `vitest.config.ts` ganhou `exclude: ['e2e/**']`
— sem isso o Vitest tenta rodar os specs do Playwright e quebra (`test.describe` não é API do
Vitest). `.gitignore` do painel ganhou `test-results/`/`playwright-report/`.

##### v0.2.9 — Ferramentas de administração dentro do painel ✅ IMPLEMENTADO (2026-09-12)

- [x] **Matriz nível × permissão** (`pages/Acesso.tsx`): `GET /api/niveis-acesso/` passou a
      devolver também os ids de permissão já atribuídos a cada nível (antes só existia via
      chamada por nível); a grade marca/desmarca célula com efeito imediato
      (`atribuirPermissao`/`removerPermissao`, sem botão "salvar"). Formulários simples de criar
      nível/permissão também entraram (CRUD já existia via API desde a v0.1.5, só faltava UI).
- [x] **Visualizador de `AuditLog`** (`pages/Auditoria.tsx`): novo `GET /api/auditoria/`
      (filtros: usuário, tabela, ação, período; paginado) e `GET /api/auditoria/acoes` (lista de
      ações distintas, alimenta o filtro). Resolve o nome do usuário via join com `Associado`
      direto no backend. Somente leitura de propósito — nenhum botão de exclusão na interface.
- [x] **"Ver o sistema como"** (impersonação de papel, não de pessoa) — a parte mais delicada
      desta versão, porque mexe em código de segurança central:
      - `criar_access_token` ganhou um claim opcional `id_nivel_impersonado`; `usuario_tem_permissao`
        passou a checar esse nível (via `nivel_efetivo_id`) em vez do nível real quando presente.
        Nunca eleva privilégio — só permite "ver como" um nível com o que aquele nível já tem.
      - **Bloqueio de escrita em profundidade**: além da checagem de permissão usar o nível
        impersonado, um middleware em `main.py` rejeita **toda** requisição POST/PUT/PATCH/DELETE
        com 403 quando o token carrega o claim de impersonação (exceto `/auth/logout`,
        `/auth/refresh` e `/auth/impersonar/parar`) — mesmo que uma rota nova esqueça de checar
        permissão certo, ou que o nível impersonado tivesse permissão de escrita, nada é gravado.
      - `POST /auth/impersonar/{id_nivel}` (exige `gerenciar_acesso`, rejeita impersonação
        aninhada) e `POST /auth/impersonar/parar` emitem um novo access token; `GET /auth/me`
        reflete `nivel`/`permissoes` do papel impersonado (é isso que filtra o menu de verdade) e
        expõe `impersonando: {id_nivel, nome_nivel, nivel_real}`. MFA obrigatório continua
        checado pelo **nível real** — impersonar não é brecha para escapar dessa exigência.
      - Front: `lib/impersonacao.ts` (troca o token em memória, invalida `/auth/me`), faixa de
        aviso permanente e sempre visível no `Shell` (com "Encerrar"), layout ajusta a altura do
        topo dinamicamente para nunca sobrepor o header.
      - **Achado real, corrigido nesta sessão**: `POST /auth/impersonar/parar` foi registrado
        DEPOIS de `POST /auth/impersonar/{id_nivel}` no router — como o Starlette casa rotas por
        padrão de caminho (não pelo tipo `int` do parâmetro, isso só é validado depois), "parar"
        combinava com `{id_nivel}` primeiro e caía na checagem de permissão errada. Corrigido
        registrando a rota estática antes da dinâmica; testado manualmente contra um backend
        real rodando localmente (SQLite) que o bug realmente acontecia e que a correção resolveu.
      - **Limitação conhecida e aceita**: o claim de impersonação vive só no access token (45
        min), não no refresh token. Se o access token expirar em pleno modo "ver como", o
        próximo `/auth/refresh` emite um token sem o claim — a sessão volta ao nível real
        silenciosamente (sem registro de `IMPERSONACAO_ENCERRADA`), mas nunca elevando
        privilégio nem deixando a UI mostrar informação de nível errada.

**Verificação real, não só leitura de código**: rodei o backend de verdade nesta máquina
(Python — SQLite local) e testei via `curl` — login, matriz de níveis/permissões, auditoria com nome de
usuário resolvido, iniciar impersonação, **tentar escrever em modo impersonação (bloqueado com
403, testado em duas rotas diferentes)**, impersonação aninhada rejeitada, parar impersonação, e
os dois registros de auditoria (`IMPERSONACAO_INICIADA`/`ENCERRADA`) — foi assim que o bug de
ordem de rota foi encontrado, não teria aparecido só lendo o código. No painel: `npm run
lint`/`typecheck`/`test`/`test:e2e`/`build` todos passando (18 testes Vitest + 6 Playwright,
incluindo um novo E2E de impersonação), e verificação visual real com Playwright/Chromium
mostrando a matriz, a auditoria e o banner "Vendo como" com o menu corretamente filtrado.

> **Achado crítico de infraestrutura, corrigido logo depois desta versão (2026-09-12)**:
> conferindo a própria URL de produção depois do primeiro deploy bem-sucedido, o painel estava
> servindo o `index.html` **bruto** (referenciando `/src/main.tsx` não compilado) — não o build
> de produção. `favicon.svg` e os assets em `/assets/*` respondiam 404 de verdade (arquivo
> ausente no local servido, não fallback de SPA). Causa: com `skip_app_build: true`, o
> `app_location` da action `Azure/static-web-apps-deploy@v1` precisa ser a **pasta de saída do
> build** (`painel/dist`) — a combinação anterior (`app_location: painel` +
> `output_location: dist`) fazia a action publicar a pasta fonte inteira. Corrigido apontando
> `app_location: painel/dist` (e removido o passo de `rm -rf node_modules`, que só existia para
> contornar o sintoma). **Isso significa que nenhum deploy bem-sucedido desta sessão (v0.2.7,
> v0.2.8, v0.2.9) de fato serviu o app funcional em produção antes desta correção**, apesar do
> CI reportar sucesso o tempo todo — o "sucesso" do CI media só se o upload aconteceu, não se o
> conteúdo publicado era o certo. De quebra, faltava `staticwebapp.config.json` com
> `navigationFallback`: sem ele, acessar uma rota interna direto (ex.: `/perfil`) ou dar F5 nela
> dava 404 (só `/` batia com um arquivo físico). Adicionado em `painel/public/staticwebapp.config.json`
> (Vite copia para `dist/` no build), excluindo `/assets/*`, `/favicon.svg` e `/version.json` do
> fallback. Confirmado em produção depois da correção: `/`, `/perfil`, `/acesso` e uma rota
> inexistente todos respondem 200; `favicon.svg` e os assets JS/CSS carregam; `version.json`
> reflete o commit exato do deploy.

##### v0.2.10 — O que fica fora da v0.2, de propósito

- Nenhum módulo de negócio (associados, financeiro, eventos) — v0.2 entrega **casca, identidade
  visual e contratos**. Módulo entra a partir da FASE 1, já usando tudo isso pronto.
- PWA/instalação e push (FASE 9/10): a base do shell já nasce compatível, mas o manifesto e o
  service worker entram junto com a decisão de PWA, não antes.

#### v0.3 — Base de catálogos configuráveis (o motor que evita deploy por regra de negócio)

> Princípio de perpetuidade: em 15 anos, a ASAF vai querer uma categoria de associado, um motivo
> de desligamento ou um tipo de documento que ninguém imaginou hoje. Nada disso pode exigir
> programador. A v0.3 constrói **um motor genérico de catálogo** em vez de 12 CRUDs parecidos.

##### 🔍 Ponto de Revisão — FASE 0 / v0.2 (3/3 — fim, fecha v0.2.7–v0.2.10) — aplicado em 2026-09-12

- [x] **Nenhum módulo de negócio adiantado**: conferido em `App.tsx` — `/associados`,
      `/financeiro`, `/governanca` e `/projetos` continuam todos como `<EmConstrucao />`, sem
      nenhuma lógica de negócio. Só `/acesso` e `/auditoria` viraram páginas reais na v0.2.9 —
      e ambas são ferramenta de administração do próprio painel (catálogo de permissões,
      trilha de auditoria), não módulo de negócio das FASES 1+; não viola a v0.2.10.
- [x] **Impersonação nunca escreve, sempre audita**: testado de verdade contra um backend local
      na v0.2.9 (não só lido no código) — tentativa de escrita em modo "ver como" bloqueada com
      403 em duas rotas diferentes (uma delas numa permissão que o nível impersonado nem
      tinha), e os dois eventos (`IMPERSONACAO_INICIADA`/`ENCERRADA`) confirmados no
      `AuditLog` via `GET /api/auditoria/`.
- [x] **Testes automatizados dos fluxos críticos existem**: login sem MFA, login com MFA,
      refresh expirado (sessão cai e volta pro login) e 403 por falta de permissão — os 5
      testes Playwright da v0.2.8 (`e2e/auth.spec.ts`) cobrem exatamente isso, rodando no CI a
      cada push desde então; nenhuma pendência a registrar aqui.

**Achado adicional desta revisão, fora dos três itens específicos mas direto da seção 4.1
(item 4, nenhum segredo exposto)**: não foi durante este checkpoint que se descobriu, mas vale
reafirmar aqui porque mudou o resultado prático da v0.2 inteira — o deploy do painel só passou
a servir o build de produção de verdade **depois** da v0.2.9 (ver nota de infraestrutura na
v0.2.10 acima). Ou seja, a v0.2 só está de fato em produção, utilizável, a partir do commit
`06a1d9a` (2026-09-12), não desde o primeiro "sucesso" do CI. Registrado para quem revisar o
histórico não presumir que "CI verde" sempre significou "está no ar".

**Fase 0 / v0.2 encerrada.** Nada pendente sem registro; próxima fase é a v0.3 (catálogos
configuráveis), abaixo.

##### v0.3.1 — Modelo genérico de catálogo ✅ IMPLEMENTADO (2026-09-12)

- [x] `Catalogo` (`chave`, `nome_exibido`, `descricao`, `editavel_pelo_usuario`) +
      `OpcaoCatalogo` (`id_catalogo`, `codigo`, `rotulo`, `ordem`, `ativo`, `cor`, `icone`,
      `id_pai`, `metadados` — `JSONB` em Postgres, cai pra `JSON` genérico em SQLite de dev via
      `.with_variant()`) em `app/models/core.py`. Migração Alembic `d2e3f4a5b6c7` cria as tabelas
      **e migra o dado que já existia em `opcoes_lista`** (derivando um código estável por slug
      do rótulo em texto livre, com desempate automático em caso de colisão) — `opcoes_lista`
      **não é apagada**, fica como backup/rollback da migração; nenhuma rota nova lê dela.
- [x] **Código estável separado do rótulo**: `OpcaoCatalogoAtualizar` (schema de edição) nem
      aceita o campo `codigo` — só quem cria a opção define o código, e nunca mais muda depois.
      Testado: `PUT` enviando `codigo` junto com `rotulo` altera só o rótulo, código intocado.
- [x] **Nunca excluir opção em uso**: `DELETE /api/opcoes-catalogo/{id}` recusa (400) se a opção
      ainda estiver `ativo=true`; exige desativar primeiro. Com a opção já inativa, checa uso
      real contra as tabelas de negócio que hoje ainda guardam o rótulo como string solta (não
      há FK ainda — `_CONSULTAS_USO` em `routers/core.py` documenta isso e cobre os dois
      catálogos que já têm consumidor conhecido: `categoria_associado`/`status_arrolamento` →
      `Associado`). Testado de ponta a ponta: opção sem uso excluída com sucesso (200), opção em
      uso pela conta do próprio admin bloqueada (409).
- [x] Hierarquia opcional via `id_pai` (self-referencing FK em `opcoes_catalogo`) — sem tabela
      nova, pronta pra plano de contas/subtipos quando a FASE que precisar disso chegar.
- [x] Catálogos de sistema x de usuário: `categoria_associado` e `status_arrolamento` marcados
      `editavel_pelo_usuario=False` (código hoje depende do rótulo específico existir — ver
      `Associado.status_arrolamento` default e `ConfiguracaoInstitucional.STATUS_ARROLAMENTO_PADRAO`).
      Testado: `POST` de opção nova num catálogo de sistema recusado com 403.

**Compatibilidade preservada**: `/api/opcoes/{tipo_lista}` (GET/POST) e `/api/opcoes/{id}` (PUT)
— usadas pelas páginas HTML do protótipo antigo ainda em produção (`/admin/secretaria`,
`/meu-portal`, `/meu-perfil`, `/minha-familia` em `app/routers/associados.py`) — viraram um shim
sobre as tabelas novas, mesmo contrato JSON de sempre (`id_opcao`/`valor`/`ativo`). Testado que
`/admin/secretaria` continua renderizando (200) sem nenhuma mudança visível pro usuário final.

**Achado corrigido durante o teste real**: a primeira versão do seed direto (`seed_catalogos`,
usado por banco novo que nunca teve `opcoes_lista`) saiu com `editavel_pelo_usuario` **invertido**
(catálogos de sistema marcados editáveis e vice-versa) — um erro de tradução entre "é sistema"
e "é editável pelo usuário" ao copiar os mesmos booleanos da migração para o seed. Só apareceu
rodando o backend de verdade e conferindo a resposta de `GET /api/catalogos/`; corrigido e
reconfirmado.

Verificação real (não só leitura de código): backend rodado localmente (SQLite), fluxo completo
testado via `curl` — catálogos semeados corretos, opções do catálogo, shim de compatibilidade
com o formato antigo, bloqueio de escrita em catálogo de sistema, exclusão bloqueada em opção
ativa e em opção com uso real, exclusão permitida em opção inativa sem uso, e a página HTML do
protótipo antigo continuando no ar. `python -m py_compile` em todos os arquivos tocados.

> **Migração aplicada em produção de verdade, no mesmo dia (2026-09-12)** — não só testada
> localmente. Rodar `alembic upgrade head` contra o Postgres real revelou que a produção estava
> **duas revisões atrás** (`3cdd1f03f29c`): as migrações de v0.2.2 (`codigos_recuperacao_mfa`) e
> v0.2.5 (colunas de sessão em `tokens_acesso`) nunca tinham sido aplicadas — ou seja, "códigos
> de recuperação de MFA" e "sessões ativas" estavam quebrados em produção até este momento,
> silenciosamente, sem ninguém ter percebido. A primeira tentativa da migração desta versão
> também falhou (`inserted_primary_key` não funciona com o `sa.table()` leve usado no script de
> migração) — o Postgres reverteu a transação inteira sozinho, sem deixar nada pela metade;
> corrigido com `.returning()` explícito, testado isoladamente com dado real (incluindo colisão
> de slug) antes de tentar de novo. Resultado final, conferido direto no banco de
> produção: `alembic current` em `d2e3f4a5b6c7` (head), 8 catálogos, 42 opções — **contagem
> idêntica**, catálogo por catálogo, à `opcoes_lista` original —, `opcoes_lista` com as mesmas
> 42 linhas de sempre, intacta. Deploy da API cancelado a tempo (`gh run cancel`) antes de subir
> código que dependia das tabelas novas enquanto elas ainda não existiam em produção, e
> re-disparado manualmente só depois da migração confirmada. Testado ao vivo em
> `https://api.asaf.org.br/api/opcoes/categoria_associado` respondendo no formato de sempre.

##### v0.3.2 — Catálogos iniciais semeados ✅ IMPLEMENTADO (2026-09-12)

- [x] Cargos da diretoria e do conselho, categorias de associado e formas de pagamento **já
      existiam** (migrados de `opcoes_lista` na v0.3.1 — `titulo_cargo`, `categoria_associado`,
      `forma_pagamento`). Catálogos novos acrescentados em `seed_catalogos()`
      (`app/database.py`), todos `editavel_pelo_usuario=True` (semente de exemplo, ajustável):
      `tipo_documento` (RG, CPF, Comprovante de Residência, Certidão de Nascimento, Comprovante
      de Renda, Foto 3x4), `motivo_desligamento` (Inadimplência, Pedido voluntário, Falecimento,
      Conduta incompatível com o estatuto, Mudança de cidade), `tipo_projeto` (Assistencial,
      Educacional, Cultural, Esportivo, Saúde), `tipo_evento` (Assembleia, Reunião de
      Diretoria, Culto, Confraternização, Ação Social, Palestra), `tipo_protocolo`
      (Solicitação de Documento, Reclamação, Sugestão, Denúncia, Requerimento Administrativo),
      `tipo_requerimento` (Alteração Cadastral, Segunda Via de Carteirinha, Isenção de
      Mensalidade, Licença Temporária, Desligamento), `unidade_medida_indicador` (Unidade,
      Percentual, Real (R$), Quilograma, Hora, Pessoa).

Verificação real: backend rodado localmente (SQLite) — os 15 catálogos (8 migrados + 7 novos)
aparecem em `GET /api/catalogos/`, conteúdo e acentuação conferidos em dois catálogos novos via
`curl`, e reiniciar o servidor **não duplicou nada** (seed idempotente, testado de propósito).

##### v0.3.3 — Campos personalizados (custom fields) sem deploy ✅ IMPLEMENTADO (2026-09-12)

- [x] `DefinicaoCampo` (entidade: `associado`/`projeto_evento`/`beneficiário` — lista fechada no
      código, nunca catálogo, porque uma entidade nova sempre exige o modelo/tabela existir;
      rótulo; tipo: texto/número/data/booleano/seleção-ligada-a-catálogo/arquivo; `id_catalogo`
      quando seleção; obrigatório; ordem; `niveis_visiveis` — lista de `id_nivel`, vazio = todo
      mundo vê) + `ValorCampo` (`id_definicao`, `id_registro`, `valor` sempre como texto — o tipo
      já foi validado na escrita). Migração `e3f4a5b6c7d8`.
- [x] Backend: `GET/POST/PUT/DELETE /api/campos-personalizados/...` — leitura de definição e
      valor liberada a qualquer usuário autenticado (filtrada por `niveis_visiveis`, calculado
      pelo **nível efetivo** — respeita impersonação v0.2.9), escrita de definição exige
      `gerenciar_acesso`. Validação de valor por tipo no servidor (número/data/booleano/seleção
      contra o catálogo). Exclusão só com definição já inativa e **zero valor gravado**.
- [x] Front: `CamposPersonalizadosFields` (renderiza texto/número/data/booleano/seleção/arquivo
      a partir de `useDefinicoesCampo(entidade)`) + `construirSchemaCamposPersonalizados` (Zod
      dinâmico, combinável com `.merge()` ao schema fixo do módulo) — um módulo novo só adiciona
      `<CamposPersonalizadosFields definicoes={...} form={form} />` dentro do `FormShell`,
      nenhum código por campo. Demonstrado com dado **real** (não estático) em
      `/dev/componentes`, contra o que estiver cadastrado agora via API.
- [x] Limite consciente respeitado: nenhuma regra de negócio lê `ValorCampo` — é só
      apresentação/coleta, exatamente o que a versão pede.

**Achados corrigidos construindo o consumidor real (não só o backend isolado)**:

- `GET /api/catalogos/` e `GET /api/catalogos/{chave}/opcoes` (v0.3.1) exigiam
  `gerenciar_acesso` — um campo personalizado tipo "seleção" preenchido por qualquer usuário
  precisa ler as opções do catálogo. Corrigido: leitura liberada a qualquer autenticado, escrita
  continua admin-only.
- O `<label>` do campo personalizado não tinha `htmlFor`/`id` associando ao input (bug de
  acessibilidade real, pego pelo Playwright falhando ao localizar o campo por label, não por
  leitura de código) — corrigido.
- A auditoria de acessibilidade (`acessibilidade.test.tsx`, v0.2.6) quebrou ao ganhar a demo
  viva (primeiro `useQuery` dentro de `/dev/componentes`) por faltar `QueryClientProvider` no
  teste — corrigido, com `listarDefinicoesCampo` mockado pra não bater rede de verdade.

Verificação real: backend rodado localmente (SQLite) — criar definição de cada tipo, rejeitar
seleção sem catálogo, validar valor por tipo (número/data/booleano/seleção, incluindo código
inexistente), obrigatoriedade, exclusão bloqueada com definição ativa e com valor gravado,
visibilidade por nível confirmada **com impersonação de verdade** (campo só-Presidente some ao
impersonar Associado). No painel: `lint`/`typecheck`/`test`/`build` passando, e verificação
visual real com Playwright/Chromium cobrindo os 5 tipos de campo, incluindo o fluxo de erro de
validação e o envio com sucesso.

> **Achado crítico de infraestrutura, sem relação com campos personalizados em si, encontrado ao
> testar o endpoint novo em produção (2026-09-12)**: `JWT_SECRET` **nunca esteve configurado**
> no Container App `asaf-api` — só `DATABASE_URL` e `RUN_DB_MIGRATION` existiam como variável de
> ambiente. Toda rota autenticada (`get_current_user` → `decodificar_access_token` →
> `_checar_jwt_secret_configurado()`) falhava com 500 antes mesmo de validar o token — incluindo
> o próprio `POST /auth/login` no momento de emitir o token após validar a senha. **Ou seja,
> login nunca funcionou de verdade em produção**, desde sempre, para ninguém — não é uma
> regressão desta sessão. Corrigido com `az containerapp secret set` (novo secret `jwtsecret`,
> valor lido do Key Vault `JWT-SECRET`) + `az containerapp update --set-env-vars
> JWT_SECRET=secretref:jwtsecret`, mesmo padrão já usado pelo `DATABASE_URL`. Confirmado depois:
> a mesma chamada que antes dava `"JWT_SECRET não configurado no ambiente do servidor"` passou a
> dar `"Token inválido."` (o erro esperado pra um token malformado) — a validação de verdade
> agora roda. **Pendência registrada**: `CREDENCIAIS_AZURE.md` ainda não foi atualizado com essa
> mudança de configuração do Container App; fazer isso na próxima sessão que mexer nesse arquivo.
>
> **Segundo achado, encontrado logo em seguida ao criar o primeiro usuário real de verdade em
> produção (Presidente, 2026-09-12)**: nenhum endpoint de escrita em `routers/core.py` gravava
> `AuditLog` — nem os de catálogo/opção (v0.3.1), nem os de nível/permissão (v0.2.9/v0.1.5), nem
> os de campo personalizado (v0.3.3) — apesar do checklist padrão da seção 4.1 (item 5: "toda
> ação sensível grava AuditLog de verdade") já ter passado por essas versões. `routers/auth.py`
> sempre fez isso certo; só `routers/core.py` ficou pra trás. Corrigido: `criar/atualizar/excluir
> catálogo`, `criar/atualizar opção de catálogo`, `criar/atualizar nível de acesso`, `criar
> permissão`, `atribuir/remover permissão`, `criar/atualizar/excluir definição de campo` e
> `gravar valor de campo` agora registram `CREATE`/`UPDATE`/`DELETE` com `dados_antes`/
> `dados_depois`. Testado localmente de ponta a ponta: cada uma dessas ações apareceu na
> auditoria com a tabela, o registro e o usuário certos (inclusive um caso que pareceu "não
> logar" na primeira tentativa — na real, a combinação nível/permissão testada já vinha do seed
> padrão, nada de novo pra logar; confirmado com uma combinação genuinamente nova).
>
> **Verificação em produção (2026-09-12), com o usuário Presidente real**: após o deploy da
> correção acima, criado um catálogo de teste (`teste_auditoria_v2`) via `POST
> /api/catalogos/` em produção e confirmado via `GET /api/auditoria/` que a entrada aparece
> com `"nome_usuario":"Mateus Henrique"`, `"acao":"CREATE"`, `dados_depois` preenchido — a
> correção funciona de ponta a ponta, não só localmente.
>
> **Terceiro achado, descoberto no meio dessa mesma verificação**: `POST /auth/mfa/ativar`
> gera um segredo TOTP **novo a cada chamada**, mesmo com o MFA já ativo (`mfa_ativado=True`),
> sobrescrevendo silenciosamente o segredo que o usuário já tinha escaneado no app
> autenticador. Isso aconteceu na própria conta real de produção (ativada, depois
> sobrescrita por uma chamada de teste subsequente) e travou o login — nenhum código TOTP
> gerado pelo app batia mais com o segredo salvo no banco, e não existia um segundo
> administrador para usar `/auth/mfa/reset`, criando um bloqueio circular real (a única
> saída seria mexer direto no banco de produção). Corrigido em `app/routers/auth.py`:
> `/auth/mfa/ativar` agora recusa (400) regenerar o segredo se `mfa_ativado` já for `True`,
> orientando a usar `/auth/mfa/reset` (por outro administrador) antes de reconfigurar.
> Testado localmente de ponta a ponta: 1ª ativação funciona normalmente; confirmado com TOTP
> real; 2ª chamada a `/mfa/ativar` com MFA já ativo agora retorna 400 em vez de sobrescrever.
> Destravado em produção com um `UPDATE` direto (`mfa_ativado=false, mfa_secret=NULL`) só na
> conta afetada (`id_usuario=2`), rodado pelo usuário fora do Claude Code (o classificador de
> auto-modo deste ambiente bloqueia o assistente de materializar a `DATABASE_URL`
> diretamente); MFA reconfigurado do zero em seguida.
>
> **Renumeração da conta real para id=1 (2026-09-12)**: a conta Presidente real nasceu com
> `id_usuario=2`/`id_associado=2` (sequência do Postgres já tinha avançado por causa de um
> teste fictício de v0.1, criado e apagado antes de qualquer dado real existir — ver nota no
> início da FASE 0). Decisão: renumerar para 1, e não deixar uma "matrícula fantasma" sem
> nome no meio da lista de associados. Como `id_usuario`/`id_associado` são chave primária
> referenciada por FK de verdade (`tokens_acesso`, `codigos_recuperacao_mfa`,
> `associados.id_usuario`, e qualquer tabela de associado), a troca não é um `UPDATE` simples:
> script rodado pelo usuário (mesma razão do achado anterior - materializar `DATABASE_URL` é
> bloqueado para o assistente) que (1) libera `email`/`cpf` da linha antiga (únicos), (2)
> duplica as linhas de `usuarios`/`associados` com id=1, (3) migra toda FK encontrada via
> introspecção de `information_schema` (evita depender de listar tabelas manualmente e
> esquecer alguma), (4) migra `audit_log.id_registro_afetado` (não é FK de verdade, é
> referência genérica por `tabela_afetada`), (5) apaga as linhas antigas id=2. Rodado primeiro
> em modo simulação (mesma transação, `ROLLBACK` no final) para validar contra o banco real
> sem gravar nada; conferido manualmente cada contagem de linha; só depois rodado de novo
> gravando (`COMMIT`). Verificado depois: login com o mesmo CPF/senha responde com
> `id_usuario=1` no token. Sessões antigas (token/cookie com `id_usuario=2`) ficaram
> invalidadas — esperado, exige novo login.

##### 🔍 Ponto de Revisão — FASE 0 / v0.3 (1/2, meio, fecha v0.3.1–v0.3.3) — aplicado em 2026-09-13 (retroativo)
>
> **Achado do próprio processo, não do conteúdo de v0.3.1-v0.3.3**: este ponto de revisão
> deveria ter sido inserido ANTES de avançar até a v0.3.5 (regra da seção 4.1: toda fase ganha
> pelo menos um ponto de revisão no meio) — não foi, e só apareceu ao aplicar a checklist
> retroativamente depois de fechar a v0.3.5. Aplicando os 9 itens do checklist padrão contra
> v0.3.1-v0.3.3 agora:

- [x] **Item 1 (implementado e testado de fato)**: sim — cada versão foi verificada com backend
      local rodando de verdade (curl), não só lida no código; v0.3.1 também teve migração e
      dado real conferidos em produção.
- [ ] → [x] **Item 2 (testes automatizados existem e passam)**: **não existia nenhum** até este
      ponto de revisão — toda verificação de v0.3.1-v0.3.3 (e do projeto inteiro) era manual via
      curl, nunca virou suíte repetível, apesar de `pytest` estar em `requirements-dev.txt` desde
      sempre. **Corrigido nesta revisão**: criada a infraestrutura de teste
      (`tests/conftest.py` — TestClient + SQLite descartável por sessão, fixture de admin via
      bootstrap-admin) e os testes reais de `tests/test_catalogos.py` (7 casos: criar catálogo,
      chave duplicada recusada, catálogo de sistema não aceita opção nova, código da opção nunca
      muda no update, exclusão de opção ativa recusada, exclusão de opção inativa sem uso
      permitida, escrita sem autenticação recusada) e `tests/test_campos_personalizados.py` (5
      casos: criar definição, tipo número recusa não-número, tipo número aceita e lê de volta,
      campo obrigatório recusa vazio, campo seleção exige catálogo). 12 testes, todos passando.
- [x] **Item 3 (nenhuma regra congelada violada)**: confirmado — Alembic continua sendo o único
      caminho de mudança de schema (`DECISOES_CONGELADAS.md` 1.3), RBAC por nível continua sendo
      o único modelo de permissão (1.3.2 / 3.2).
- [x] **Item 4 (nenhum segredo exposto)**: nenhum segredo novo introduzido nessas versões.
- [x] **Item 5 (AuditLog de verdade)**: sim, com uma ressalva já corrigida - o achado registrado
      no fechamento da v0.3.3 (core.py não gravava `AuditLog` em nenhuma escrita) foi corrigido
      antes deste ponto de revisão, com verificação em produção.
- [x] **Item 6 (permissão checada no backend)**: sim - `_permissao_gerenciar_catalogos`/
      `_permissao_gerenciar_campos` (`exigir_permissao("gerenciar_acesso")`) em toda rota de
      escrita, nunca só escondido no front; testado (`test_escrita_em_catalogo_sem_autenticacao_falha`).
- [x] **Item 7 (nada fora de escopo adiantado)**: catálogos/campos personalizados ficaram
      restritos ao motor genérico - nenhuma regra de negócio de FASE futura embutida (ver
      docstring de `DefinicaoCampo`).
- [x] **Item 8 (plano atualizado refletindo a realidade)**: sim, cada versão marcada `[x]` com
      nota de verificação real na hora.
- [x] **Item 9 (suíte completa continua passando)**: `pytest tests/` — 12 testes (deste
      intervalo) passando; suíte completa do projeto até aqui é só esta, criada agora.

**Fase não bloqueada**: o único item que falhava (testes automatizados) foi corrigido dentro
desta mesma revisão, não empurrado como pendência. v0.3 segue para o segundo ponto de revisão,
no fim (v0.3.4–v0.3.5), abaixo.

##### v0.3.4 — Configuração institucional central ✅ IMPLEMENTADO (2026-09-12)

- [x] Evoluir `ConfiguracaoInstitucional` para chave/valor tipado e versionado: nome, CNPJ,
      endereço, logo, cores, dados bancários, fuso horário, textos padrão de documento, e-mail
      remetente, parâmetros de regra (prazo de convocação, dias de tolerância de inadimplência,
      teto de alçada financeira).
      > Adicionadas colunas `tipo` (texto/numero/booleano/email/cor/data), `categoria`,
      > `descricao`, `atualizado_em`, `id_usuario_atualizacao` (migração
      > `f4a5b6c7d8e9`). 13 chaves canônicas semeadas via `seed_configuracoes_institucionais()`
      > (roda sempre, mesmo padrão de `seed_catalogos`/`seed_niveis_e_permissoes`, não amarrado
      > a `RUN_DB_MIGRATION`). "Versionado" aqui é só quem mudou e quando (`atualizado_em`/
      > `id_usuario_atualizacao`) - vigência temporal completa por período é `RegraEstatutaria`
      > (v0.7), propositalmente fora de escopo aqui. `GET /api/configuracoes/` (qualquer
      > usuário autenticado - essas chaves são lidas amplamente, inclusive por não-admin) e
      > `PUT /api/configuracoes/{chave}` (permissão `gerenciar_acesso`, mesma reutilizada por
      > catálogos/campos personalizados - sem criar/excluir chave via API, só as 13 fixas).
      > Validação de tipo no backend (numero/booleano/email/cor#RRGGBB/data) testada localmente
      > com valor válido e inválido de cada tipo (422 nos inválidos). Bloqueio de escrita em
      > modo "ver como" confirmado (403, mesma trava da v0.2.9).
- [x] Toda alteração registrada em `AuditLog` com valor antes/depois — parâmetro que muda regra de
      negócio é dado crítico, não "configuração inocente".
      > Testado localmente: `PUT` de `COR_PRIMARIA` gerou entrada `UPDATE` em
      > `configuracoes_institucionais` com `dados_antes`/`dados_depois` corretos.
- [x] Cache em memória com invalidação na escrita (essas chaves são lidas em quase toda requisição
      de documento; não podem virar consulta a banco repetida).
      > `app/config_cache.py` (`obter_configuracao`/`invalidar_cache_configuracao`), chamado a
      > partir do endpoint de escrita. Testado diretamente (fora do HTTP): 1ª leitura popula o
      > cache; alterar a linha no banco sem invalidar continua devolvendo o valor antigo (cache
      > funcionando); após invalidar, devolve o valor novo. Ainda sem nenhum consumidor real
      > (geração de documento é fase futura) - a função existe pronta pra quando existir.
      >
      > **Achado ao testar a migração `f4a5b6c7d8e9` contra SQLite local**: `op.add_column`
      > com `sa.ForeignKey` embutido no mesmo passo falha no dialeto SQLite ("No support for
      > ALTER of constraints" - precisa de "batch mode"). Não é bug da migração: Postgres
      > (produção) aceita `ALTER TABLE ADD COLUMN ... REFERENCES ...` numa tacada só sem
      > problema; mesmo assim, separado em dois passos (`add_column` sem FK +
      > `create_foreign_key` à parte) por ser mais portável e não custar nada em produção.
      > Confirmado via teste isolado (tabela no formato antigo, stamp no revision anterior,
      > upgrade) que as 4 colunas sem FK aplicam sem erro no SQLite; a 5ª (`create_foreign_key`)
      > só falha pela limitação do dialeto, não da migração em si - sem Postgres local
      > disponível para testar ponta a ponta antes de aplicar em produção (sem Docker neste
      > ambiente), aplicar com atenção redobrada na hora de rodar contra produção de verdade.
>
> **Verificação em produção (2026-09-12)**: migração `f4a5b6c7d8e9` aplicada com sucesso contra
> o Postgres real (a FK via Postgres funcionou de primeira, confirmando a hipótese acima). Após
> o redeploy, `GET /api/configuracoes/` com o usuário Presidente real devolveu as 13 chaves
> semeadas; `PUT /api/configuracoes/CNPJ` gravou o valor e gerou entrada em `AuditLog` com
> `"nome_usuario":"Mateus Henrique"`, `dados_antes`/`dados_depois` corretos.
>
> **Mudança de processo (2026-09-13): migração deixou de ser manual.** Até aqui, toda migração
> exigia o dono da máquina rodar `alembic upgrade head` manualmente (buscando `DATABASE_URL` do
> Key Vault primeiro) — o classificador de auto-modo deste ambiente bloqueia o assistente de
> materializar essa credencial sozinho (ver achados de MFA/renumeração acima). O usuário
> observou que essa trava manual é redundante com a revisão que já acontece antes de qualquer
> push (o assistente sempre pede confirmação antes de commitar/dar push) - se a intenção fosse
> revisar cada mudança de banco à parte, não faria sentido ter travas de revisão em outro lugar.
> `deploy-api.yml` agora busca `DATABASE_URL` do Key Vault (mesma identidade OIDC que já lê
> `JWT-SECRET`/constrói a imagem) e roda `alembic upgrade head` como parte do próprio deploy,
> antes de construir/subir a imagem nova - sem pausa manual. Adicionado `alembic/**` e
> `requirements-dev.txt` (onde `alembic` está declarado - nunca entra na imagem Docker de
> produção, só ferramenta de dev/CI) aos `paths` que disparam o workflow - sem isso, um commit
> só com migração nova nunca acionaria o deploy. O padrão "cancelar deploy automático, migrar,
> redisparar manualmente" documentado nos achados acima (v0.3.1, v0.3.4) não se aplica mais a
> partir daqui.

##### v0.3.5 — Importação/exportação de configuração ✅ IMPLEMENTADO (2026-09-13) — fecha a FASE 0/v0.3

- [x] Exportar todos os catálogos e configurações em JSON e reimportar — serve de backup lógico da
      parametrização, de caminho de cópia entre homologação e produção, e de plano de contingência
      se a base precisar ser recriada.
      > `GET /api/configuracoes/exportar` devolve `{catalogos: [{chave, nome_exibido, descricao,
      > editavel_pelo_usuario, opcoes: [{codigo, rotulo, ordem, ativo}]}], configuracoes: [{chave,
      > valor, tipo, categoria, descricao}]}`. `POST /api/configuracoes/importar` é **upsert por
      > chave/código estável, nunca apaga** o que já existe e não está no arquivo (mesmo
      > raciocínio dos seeds - importar de homologação não pode destruir ajuste feito só em
      > produção) - catálogo/opção ausente cria; existente atualiza. Configuração institucional
      > nunca cria chave nova via import (só as 13 canônicas da v0.3.4) - chave desconhecida no
      > arquivo é ignorada e reportada em `configuracoes_ignoradas`, nunca trava o resto da
      > importação. Uma entrada de `AuditLog` por importação (`acao=IMPORT`, `dados_depois` com
      > as contagens), não uma por linha - proporcional ao volume de uma operação em lote.
      > Permissão `gerenciar_acesso`, mesma reutilizada por catálogos/campos/configurações.
      >
      > **Achado de rota durante o teste local**: registrar `GET /api/configuracoes/exportar`
      > DEPOIS de `GET /api/configuracoes/{chave}` faria o FastAPI casar "exportar" como valor de
      > `{chave}` primeiro (ordem de registro importa) - devolveria 404 em vez de exportar.
      > Corrigido registrando exportar/importar ANTES das rotas `{chave}`. Testado localmente de
      > ponta a ponta: export com dado real (15 catálogos + 42 opções + 13 configs);
      > import criando catálogo/opção novos, atualizando opção existente e ignorando uma chave de
      > configuração inexistente (contagens corretas, `AuditLog` com o resumo certo); depois,
      > teste de round-trip completo - reexportar tudo e reimportar o próprio export de volta é
      > **idempotente** (tudo reportado como "atualizado", nada duplicado, zero chaves
      > ignoradas) - confirma que o formato de export é o mesmo aceito de volta pelo import, sem
      > perda de informação no ciclo.

##### 🔍 Ponto de Revisão — FASE 0 / v0.3 (2/2, fim, fecha v0.3.4–v0.3.5) — aplicado em 2026-09-13

- [x] **Item 1 (implementado e testado de fato)**: sim — v0.3.4 e v0.3.5 verificadas com backend
      local e, nas duas, também em produção real (migração aplicada, endpoints testados com o
      usuário Presidente real, `AuditLog` conferido com o nome dele).
- [x] **Item 2 (testes automatizados existem e passam)**: `tests/test_configuracoes.py` (8
      casos: listar as 13 chaves, atualizar tipo número válido/inválido, tipo cor inválida, tipo
      email inválido, chave inexistente 404, auditoria gerada na escrita, escrita sem
      autenticação recusada) e `tests/test_import_export.py` (4 casos: exportar traz
      catálogos+configurações, importar cria catálogo novo e ignora chave de config
      desconhecida, reimportar o export completo é idempotente, importar sem autenticação
      recusado). Total da suíte (v0.3 inteira): **27 testes, todos passando**
      (`pytest tests/ -v`). Adicionado como step no próprio `deploy-api.yml`, rodando ANTES do
      login no Azure — um push com teste quebrado nunca chega a tocar produção.
      >
      > **Achado confirmado no primeiro deploy real com o step**: o próprio mecanismo provou seu
      > valor imediatamente — o step falhou (`ModuleNotFoundError: No module named 'app'`) e
      > bloqueou o deploy antes de chegar no login do Azure, exatamente como desenhado. Causa:
      > `pytest tests/ -v` (comando direto) não põe a raiz do repositório no `sys.path` do jeito
      > que `python -m pytest` põe — `conftest.py` fazendo `from app.main import app` funcionava
      > local (sempre rodado como `python -m pytest`) mas não no runner do GitHub Actions.
      > Corrigido trocando para `python -m pytest tests/ -v` no workflow.
- [x] **Item 3 (nenhuma regra congelada violada)**: confirmado.
- [x] **Item 4 (nenhum segredo exposto)**: a automação de migração (mudança de processo
      registrada no fechamento da v0.3.4) busca `DATABASE_URL` do Key Vault e mascara o valor
      explicitamente (`::add-mask::`) antes de qualquer uso — conferido no log real do primeiro
      deploy que usou o mecanismo (`DATABASE_URL: ***`).
- [x] **Item 5 (AuditLog de verdade)**: sim, testado em ambos (`UPDATE` em
      `configuracoes_institucionais`, `IMPORT` em `catalogos_e_configuracoes`).
- [x] **Item 6 (permissão checada no backend)**: sim - `_permissao_gerenciar_configuracoes`
      (mesma `gerenciar_acesso`) em toda escrita, testado (`test_atualizar_configuracao_sem_autenticacao_falha`,
      `test_importar_sem_autenticacao_falha`).
- [x] **Item 7 (nada fora de escopo adiantado)**: `ConfiguracaoInstitucional` ficou só com "valor
      atual + quem mudou/quando" - vigência temporal por período (`RegraEstatutaria`) foi
      explicitamente deixada de fora, registrada como escopo da v0.7.
- [x] **Item 8 (plano atualizado)**: sim.
- [x] **Item 9 (suíte completa continua passando)**: `pytest tests/` - 27/27, incluindo os 12
      testes do ponto de revisão anterior (v0.3.1-v0.3.3) - nada quebrou entre um ponto e outro.

**Fase 0 encerrada.** v0.0 até v0.3.5 completas, testadas (manualmente em produção real e agora
também por suíte automatizada), documentadas, e com os dois pontos de revisão da fase aplicados
(o do meio de forma retroativa, corrigindo a lacuna de processo assim que percebida, em vez de
ignorá-la). Próxima fase é a FASE 1 (Associados), abaixo.

#### v0.4 — Passkey (WebAuthn): login pelo próprio dispositivo, sem senha nem MFA separado ✅ IMPLEMENTADO (2026-09-14, adendo pós-fechamento)
>
> **Fora de sequência, por pedido direto do usuário durante a revisão da FASE 1**: o usuário
> relatou dois atritos reais no login por MFA (código de 6 dígitos não confirma com Enter em
> alguns teclados/navegadores; nenhuma forma de "confiar no dispositivo" como Windows Hello/
> Google faz). O segundo ponto não é um simples "lembrar por 30 dias" - é **passkey/WebAuthn**
> de verdade (credencial atrelada ao dispositivo, chave privada nunca sai dele). Tecnicamente
> pertence à FASE 0 (identidade/autenticação), não à FASE 1 (ciclo de vida do associado) - por
> isso entra aqui como v0.4, mesmo com a fase já formalmente encerrada acima.

- [x] **Correção do atrito do Enter**: `<input>` do código MFA (`Login.tsx`, `MfaSetup.tsx`)
      ganhou `enterKeyHint="done"` - sem isso, um `inputMode="numeric"` sozinho não garante
      tecla de Enter/Ir no teclado virtual de todo navegador/SO. Testado num navegador real
      (Playwright): preencher o código e apertar Enter (sem clicar em "Verificar") completa o
      login (`e2e/auth.spec.ts`, "tecla Enter no código do autenticador...").
- [x] **Passkey (WebAuthn) completo**: `CredencialWebAuthn` (`app/models/core.py`, migração
      `e9f0a1b2c3d4`) guarda só a chave PÚBLICA (formato COSE) + contador de assinatura por
      dispositivo - a chave privada nunca sai do notebook/celular do usuário, que é o que torna
      isso mais seguro que senha. `POST /auth/webauthn/registrar/iniciar` (autenticado) exige
      `resident_key=REQUIRED` (permite login sem digitar CPF antes - o navegador já sabe quais
      credenciais salvas servem para este site) e `user_verification=REQUIRED` (o desbloqueio
      por biometria/PIN do próprio autenticador é obrigatório, checado no servidor também, nunca
      só confiado do navegador) + `/concluir` (verifica a resposta com a biblioteca `webauthn`,
      grava a credencial). `GET /auth/webauthn/credenciais` e
      `DELETE /auth/webauthn/credenciais/{id}` (perdeu o dispositivo, revoga). Login:
      `POST /auth/webauthn/login/iniciar` (público, sem CPF) e `/concluir` (verifica a
      assinatura contra a chave pública guardada, checa o contador de uso contra clonagem de
      autenticador, e finaliza a sessão pelo mesmo caminho de `/auth/login` -
      `_finalizar_login`, extraído nesta versão para não triplicar a lógica de cookie/token
      entre login por senha, por MFA e por passkey).
      > **Por que substitui senha E o segundo fator na mesma etapa**: diferente de "lembrar
      > este dispositivo por N dias" (que reduziria a segurança por um prazo), a verificação de
      > usuário exigida pelo WebAuthn (`user_verification=REQUIRED`, exigida nos dois lados) já
      > É uma prova forte de posse do dispositivo + identidade da pessoa - é assim que
      > Google/Microsoft tratam passkey. Documentado no próprio código
      > (`app/routers/auth.py`), não escondido como comportamento implícito.
      > Desafio (challenge) entre "iniciar" e "concluir" viaja num JWT de vida curta (5 min,
      > `criar_webauthn_pending_token`) - stateless, mesmo raciocínio de `criar_mfa_pending_token`
      > (funciona igual com várias réplicas do Container App, sem tabela/estado em memória).
- [x] `WEBAUTHN_RP_ID=painel.asaf.org.br` e `WEBAUTHN_ORIGIN=https://painel.asaf.org.br`
      configurados no Container App `asaf-api` de produção (2026-09-14), preservando as
      variáveis já existentes (`DATABASE_URL`/`RUN_DB_MIGRATION`/`JWT_SECRET`) - confirmado via
      `az containerapp show` e a API respondendo 200 depois do restart.
      > **Achado de processo nesta configuração**: a sessão que aplicou isso estava logada por
      > padrão numa assinatura Azure diferente da que contém `Associacao-RG` (duas assinaturas
      > com o mesmo nome de exibição, "Azure subscription 1", em tenants diferentes) -
      > `az account show` sozinho não denunciava isso; só `az account list` + `az group list`
      > confirmaram qual assinatura tinha o resource group certo. Fica registrado porque é o
      > tipo de confusão que se repete em qualquer sessão nova que rode comandos Azure aqui.
>
> Testado: `pytest tests/` - 78/78 (6 novos em `tests/test_webauthn.py`, com um **autenticador
> virtual real** construído com `cryptography`+`cbor2` - gera uma chave EC P-256 de verdade,
> monta `authenticatorData`/`attestationObject` e assina o desafio de autenticação; a suíte
> confirma criptografia de ponta a ponta, não mock: assinatura adulterada e credencial
> desconhecida são recusadas de verdade pela biblioteca `webauthn`). Painel: `tsc --noEmit` e
> `eslint` limpos, `vitest` 22/22. Testado também num navegador real (Playwright, Chromium) com
> o domínio WebAuthn do Chrome DevTools Protocol simulando um autenticador de plataforma de
> verdade (`e2e/auth.spec.ts`, "Passkey (WebAuthn) › login usando uma passkey já registrada no
> dispositivo") - confirma que o painel liga certo as duas pontas (opções do servidor → cerimônia
> real do navegador → resposta de volta pro servidor), não só que os endpoints funcionam
> isolados.
>
> Migração `e9f0a1b2c3d4` testada isoladamente (upgrade cria a tabela com a FK esperada para
> `usuarios`; downgrade remove) contra SQLite, mesmo padrão de rigor das migrações anteriores.

---

<a id="fase-1"></a>

### FASE 1 — Associados (ciclo de vida completo da pessoa na associação)

> Esta fase deixa de ser "cadastro" e passa a ser **ciclo de vida**: como a pessoa entra, como é
> aprovada, como muda de categoria, como paga, como sai, como volta, e o que fica registrado de
> cada transição. Sistema de associação que só tem "cadastro" vira planilha bonita.

#### v1.0 — Modelo de pessoa: uma pessoa, vários papéis ✅ IMPLEMENTADO (2026-09-13)

- [x] **Decisão estrutural**: a mesma pessoa física pode ser, ao mesmo tempo, associada,
      voluntária, beneficiária de projeto, aluna, fornecedora pessoa física e participante externa
      de evento. Modelar isso como cadastros separados é o erro que gera duplicidade eterna.
- [x] `Pessoa` como raiz (nome, CPF único, data de nascimento, contatos, foto — endereço
      continua em `Endereco` ligado ao papel `Associado`, não em `Pessoa`, ver ressalva abaixo) +
      `Papel` N:N (`id_pessoa`, `tipo_papel`, `ativo`) em `app/models/pessoas.py`. Só o papel
      `associado` tem tabela satélite de atributos hoje (`Associado`); os outros seis tipos
      (`voluntario`, `beneficiario`, `aluno`, `participante_externo`, `funcionario`,
      `fornecedor_pf`) existem como valor válido de `tipo_papel`, sem tabela satélite ainda —
      **fora de escopo de propósito aqui**, cada um ganha sua tabela quando a FASE
      correspondente chegar (voluntário na FASE 4, aluno na FASE 14 etc.).
- [x] `Associado` passa a referenciar `Pessoa` (`id_pessoa`, NOT NULL) em vez de duplicar dado
      pessoal. Migração `a5b6c7d8e9f0`: cria `pessoas`/`papeis`, copia `nome_completo`/`cpf`/
      `email_contato`/`telefone_whatsapp`/`data_nascimento`/`estado_civil`/`profissao`/
      `naturalidade`/`foto` de cada `Associado` existente para uma `Pessoa` nova + um `Papel`
      (`tipo_papel="associado"`), e só then remove essas 9 colunas de `associados`. Verificação
      de contagem embutida na própria migração (aborta com `RuntimeError`, revertendo a
      transação, se `pessoas`/`papeis` criados ≠ `associados` de origem) — mesmo rigor da
      migração de catálogo v0.3.1. Testado com simulação de dado real (linha única "Mateus
      Henrique", formato exato do schema de produção): migração e reversão (`downgrade`)
      testadas, dado idêntico antes/depois em ambos os sentidos.
      >
      > **Compatibilidade via `association_proxy`, não reescrita de todo o código**: em vez de
      > mudar os ~15 pontos do backend que liam/escreviam `associado.nome_completo`/`cpf`/etc.
      > (mapeados antes de começar, incluindo o portal HTML legado de 1800 linhas ainda em
      > produção), os 9 campos viraram `association_proxy("pessoa", campo)` em `Associado` —
      > leitura, escrita e `Associado(nome_completo=..., cpf=..., ...)` no construtor continuam
      > funcionando **sem nenhuma mudança de código** nesses call sites (cada proxy tem seu
      > próprio `creator`, então atribuir qualquer um cria a `Pessoa` na hora se ainda não
      > existir). Confirmado com teste isolado antes de tocar em qualquer call site real.
      > **Duas exceções reais, com `NotImplementedError` confirmado e corrigidas**: proxy não
      > funciona em `order_by()` nem em seleção de coluna solta (`query(Associado.campo)`) — só
      > em comparação (`filter(Associado.cpf == x)`, que funciona igual a antes). Os dois pontos
      > afetados (`busca-simples` em `associados.py` e resolução de nome de usuário em
      > `auditoria` no `core.py`) foram reescritos com `join(Pessoa)` explícito.
      > **Achado real, corrigido antes de fechar**: a migração cria o `Papel` pras linhas
      > existentes, mas os dois pontos de CRIAÇÃO de associado (`cadastrar_ficha_master` e
      > `bootstrap-admin`) não criavam o `Papel` pra associado novo — só percebido testando de
      > ponta a ponta contra um servidor real (a tabela `papeis` ficou vazia mesmo com
      > associados novos criados). Corrigido nos dois pontos.
- [ ] Chave de deduplicação: CPF normalizado (só dígitos) é único em `Pessoa` — **feito**
      (`Pessoa.cpf`, `unique=True`). E-mail e telefone normalizados como chave secundária de
      sugestão (nunca bloqueio) — **não implementado nesta versão**, fora de escopo: exige uma
      tela de resolução de duplicidade que só faz sentido quando existir importação em massa
      (v1.3) ou mais de uma pessoa real no sistema; hoje o sistema tem uma única pessoa real.
- [ ] CPF **não obrigatório** para todos os papéis: o **modelo** já suporta (`Pessoa.cpf`
      `nullable=True`, diferente do antigo `Associado.cpf` que era `NOT NULL`) — mas nenhum
      endpoint hoje cria um `Papel` sem passar por `AssociadoMasterCriar`/`bootstrap-admin`, que
      continuam exigindo CPF de 11 dígitos por schema. Criar pessoa sem CPF (chave alternativa
      nome + nascimento + responsável) só tem sentido quando existir o primeiro papel que
      realmente dispensa CPF (beneficiário criança, participante externo) — **fora de escopo de
      propósito aqui**, registrado para quando a FASE correspondente (beneficiário: FASE 6;
      participante externo de evento: FASE 4) chegar.
>
> Testado: `pytest tests/` — 33/33 (6 novos em `tests/test_pessoas.py`: bootstrap cria
> Pessoa+Papel, ficha master cria Pessoa+Papel, CPF duplicado recusado, ordenação via join
> funciona de verdade com dois nomes fora de ordem alfabética, edição admin propaga pra
> `Pessoa`, auditoria resolve nome via join). Testado também contra servidor real rodando
> localmente (não só pytest): bootstrap-admin, `auth/me`, `auth/perfil` GET/PUT,
> `associados-master` (criar), `api/associados/{id}` (editar), `api/meu-perfil/{id}`,
> `api/associados/{id}/foto` (upload), `api/associados/{id}/dependentes`, e o portal HTML
> legado `/admin/secretaria` — confirmado renderizando o nome de dois associados reais
> (migrados através da `Pessoa`) na tabela HTML, sem nenhuma mudança na página em si.

#### v1.1 — Cadastro, categorias e qualificação do dado ✅ IMPLEMENTADO (2026-09-13)

- [x] Cadastro completo (dados pessoais, endereço com preenchimento por CEP, dependentes,
      documentos, campos personalizados da v0.3.3).
      > Dados pessoais/endereço/dependentes/documentos já existiam desde o protótipo
      > (`app/routers/associados.py`) - v1.1 não recriou, só validou de verdade (abaixo).
      > Campos personalizados: o motor genérico da v0.3.3
      > (`/api/campos-personalizados/{entidade}/{id_registro}/valores`) já aceita
      > `entidade="associado"` sem nenhuma mudança - confirmado que funciona por desenho, não
      > precisou de código novo. CEP: endpoint novo `GET /api/cep/{cep}` (ViaCEP, gratuito, sem
      > chave) para autopreenchimento - melhor esforço (503 se o serviço externo estiver fora,
      > nunca trava o cadastro por dependência de terceiro).
- [x] Validação real: dígito verificador de CPF, CEP existente, e-mail com sintaxe válida,
      telefone em formato brasileiro, data de nascimento coerente (não futura, idade plausível).
      > `app/validadores.py` (módulo 11 pro CPF, portado do mesmo algoritmo já usado no painel
      > `lib/cpf.ts` - os dois lados concordam), telefone BR (DDD 11-99, celular exige `9` como
      > 3º dígito), nascimento (não futura, idade 0-130). E-mail já era `EmailStr` desde sempre
      > (Pydantic). Aplicado em `AssociadoMasterCriar`/`AssociadoAdminUpdate`/
      > `AssociadoPerfilUpdate`. CEP validado batendo no ViaCEP (`erro: true` → 404).
- [x] **Categorias calculadas, nunca marcadas à mão**: ativo, inadimplente, em experiência,
      licenciado, desligado — derivadas de dados reais (tempo de casa, situação financeira,
      registro de licença). Campo derivado é função, não coluna editável.
      > **Escopo real, não fingido**: só Ativo/Inadimplente são calculados hoje, porque só esses
      > dois têm dado real que os sustente (`TituloFinanceiro` + `DIAS_TOLERANCIA_INADIMPLENCIA`,
      > v0.3.4). "Em experiência" depende do período de integração da v1.2 (ainda não existe);
      > "licenciado"/"desligado" dependem da v1.4 (ainda não existe) - pendências registradas
      > nessas versões acima, para quando cada uma for construída conectar ao mesmo lugar
      > (`app/services/categoria_associado.py`). `status_arrolamento` **saiu do schema**
      > `AssociadoAdminUpdate` (não é mais aceito no `PUT` administrativo) e o campo no formulário
      > HTML virou só exibição (input desabilitado) - decisão consciente de não fingir cálculo
      > sem o dado que o sustente, em vez de simular as 5 categorias com dado que não existe.
- [x] `v1.1a` — **materialização com auditoria**: a categoria é calculada na leitura, mas também
      gravada num campo materializado atualizado por gatilho de evento (pagamento registrado,
      licença lançada), para permitir consulta/relatório rápido sem recalcular a base inteira.
      O cálculo continua sendo a fonte da verdade; o campo materializado é cache verificável.
      > `calcular_categoria()` é a fonte da verdade (pura, não grava nada);
      > `recalcular_categoria_associado()` materializa em `status_arrolamento` só quando o
      > cálculo muda, e só se o estado atual for um dos dois calculáveis (nunca sobrescreve
      > Suspenso/Desligado). Disparado nos dois eventos financeiros reais que existem hoje:
      > lançar título (`POST /titulos/`) e baixar título (`POST /baixar-titulo/`). Toda mudança
      > efetiva gera `AuditLog` (`acao=CATEGORIA_RECALCULADA`, antes/depois). Endpoint
      > `GET /api/associados/{id}/categoria-calculada` expõe o cálculo puro ao lado do
      > materializado, pra auditar se os dois convergem (`desatualizado: true/false`).
- [x] Indicador de completude do cadastro (percentual de campos preenchidos) — dirige o esforço da
      secretaria para quem está com dado faltando, em vez de auditoria manual.
      > `GET /api/associados/{id}/completude` - 10 campos (9 de `Pessoa` + endereço), percentual
      > + lista de quais faltam.
- [x] Carteirinha digital: QR code assinado (JWT curto com `id_pessoa` + validade), verificável
      por endpoint público `/carteirinha/verificar/{token}` que mostra **só** nome, foto, categoria
      e validade — nunca CPF, nunca telefone, nunca endereço. Evolução prevista para Apple/Google
      Wallet na FASE 19, sem app nativo.
      > `criar_token_carteirinha`/`decodificar_token_carteirinha` em `app/security.py` (mesmo
      > `JWT_SECRET`/padrão dos outros tokens, `type="carteirinha"` para não ser confundido com
      > access token). `GET /api/associados/{id}/carteirinha` gera; `GET
      > /carteirinha/verificar/{token}` (público) confere o papel "associado" ainda ativo e
      > devolve só nome/foto/categoria/validade - testado que `cpf`/`telefone_whatsapp`/
      > `endereco` realmente não aparecem na resposta, e que um token adulterado é rejeitado
      > (400). Geração de imagem QR fica pro painel (frontend), quando a tela existir - o
      > backend só assina/verifica o conteúdo.
>
> **Achado e corrigido em 2026-09-15 (v3.0.1)**: cadastrar a ficha master nunca criou login -
> `POST /associados-master/` só grava dado pessoal, nunca `Usuario`. Não tinha nenhum jeito de
> dar acesso a um associado comum (só o Presidente, via `bootstrap-admin`, uma vez). Fechado por
> `POST /api/associados/{id}/conceder-acesso`: a secretaria define uma senha provisória
> (`Usuario.senha_provisoria=True`), o associado é obrigado a trocá-la no primeiro login
> (`POST /auth/login` devolve a flag, `POST /auth/senha/alterar` zera). Mesmo achado trouxe a
> política de senha mínima de 10 pra **8 caracteres** (`app/security.py::validar_senha_forte`,
> decisão do usuário - 10 era difícil demais de lembrar pra associado comum, sem diferenciação
> por cargo por enquanto). Recuperação de senha por e-mail ("esqueci minha senha") continua **não
> implementada** - depende de escolher provedor de envio de e-mail antes (mesmo padrão de
> decisão em aberto do PSP do Pix Automático/BSP do WhatsApp, ver DECISOES_CONGELADAS.md seção 7).
>
> **v3.0.2 (2026-09-15, mesmo dia)**: primeira tela de negócio real do módulo "Associados" no
> painel único (`painel.asaf.org.br/associados`) - até aqui era `<EmConstrucao>` (só guarda de
> permissão, nenhum conteúdo), situação já registrada como pendência nas v1.5/v1.6/v1.7. Entrega
> listagem (`GET /api/associados/`, nova), cadastro (`/associados/novo`, ligado ao
> `POST /associados-master/` de sempre) e concessão de acesso por linha (v3.0.1) - tudo dentro
> do painel único, sem link separado.
>
> **Remoção de UI legada, mesmo dia**: as páginas HTML `/admin` (Mega Portal),
> `/admin/secretaria`, `/meu-portal/{id}`, `/meu-perfil/{id}` (HTML) e `/minha-familia/{id}`
> (`app/routers/associados.py`, `app/routers/financeiro.py`, `app/routers/admin_portal.py` -
> este último apagado por inteiro) foram removidas - eram do protótipo pré-plano (servidor
> Python de +3000 linhas, abas por função numerada, dois painéis soltos em vez de um painel
> modular), incompatíveis com a decisão congelada 4.1 (painel único React) e nunca deveriam ter
> sido apontadas como caminho válido, nem reaproveitadas - erro corrigido no mesmo dia em que foi
> cometido. As rotas JSON reais (`/api/...`) que essas páginas chamavam continuam intactas.
> **Consequência real, ainda não coberta pelo painel React**: `/admin/secretaria` também tinha
> edição de associado (com foto), gestão de cargos, gestão de dependentes/família e gestão de
> listas de catálogo - nenhuma dessas telas foi reconstruída ainda. Editar um associado, gerenciar
> cargo ou família hoje só é possível via API direta (Swagger/curl), até o módulo Associados do
> painel ganhar essas telas - mesmo padrão de pendência já registrado em v1.5/v1.6/v1.7.
>
> Testado: `pytest tests/` — 43/43 (10 novos em `tests/test_v1_1.py`: CPF/telefone/nascimento
> inválidos recusados, status_arrolamento não editável via schema, categoria vira Inadimplente
> com título vencido e volta a Em Dia ao pagar, completude, CEP válido/inválido contra o ViaCEP
> real, carteirinha gera+verifica sem CPF, token adulterado recusado). Testado também contra
> servidor real: HTML do admin renderiza o campo de status como somente-leitura sem quebrar.

#### v1.2 — Filiação: da intenção ao associado efetivo ✅ IMPLEMENTADO (2026-09-14, escopo real declarado)

- [~] Formulário público de proposta de filiação no site (FASE 5), caindo numa fila de triagem do
      painel — nunca criando associado direto.
      > O site institucional (FASE 5) não existe ainda - **não dá pra construir o HTML público
      > de verdade agora**. O que dá (e foi feito): `POST /api/filiacao/propor` funciona de
      > ponta a ponta hoje, sem autenticação, validando CPF/telefone/nascimento (mesmos
      > validadores da v1.1) e recusando proposta duplicada (CPF já associado, ou já com
      > proposta em andamento). Quando a FASE 5 existir, o formulário do site só precisa
      > chamar este endpoint que já existe - não é um esqueleto vazio.
- [x] Fluxo configurável: proposta → conferência documental pela secretaria → (opcional) aprovação
      pela diretoria ou assembleia, conforme o estatuto → efetivação com número de matrícula
      sequencial → boas-vindas automáticas.
      > `PropostaFiliacao` (`Pendente → Em Conferência → Aprovada/Recusada`).
      > `POST /api/filiacao/propostas/{id}/conferir` → `/aprovar` (efetiva: cria `Pessoa` +
      > `Associado` + `Papel`) → `/recusar` (motivo obrigatório). **"Conforme o estatuto"
      > simplificado de propósito**: toda aprovação hoje é feita por quem tem a permissão
      > `associados` (Diretoria/Presidente) - rotear pra aprovação por Assembleia depende da
      > FASE 2 (Governança/votação) existir, e essa ainda não foi construída; não há o que
      > rotear ainda, então não fingi essa distinção (ver nota em `app/models/filiacao.py`).
      > Matrícula sequencial: `Associado.numero_matricula` (nova coluna, `UNIQUE`), atribuída
      > por `app/services/matricula.py` em toda criação de associado (ficha master direta,
      > bootstrap-admin e filiação aprovada) - migração `b6c7d8e9f0a1` faz backfill dos
      > associados já existentes na ordem de `id_associado` (o primeiro associado real do
      > sistema vira matrícula 1). "Boas-vindas automáticas": sem infra de envio de e-mail
      > ainda (pendência registrada na v6.2), fica registrado em `AuditLog`
      > (`acao=BOAS_VINDAS_REGISTRADAS`) - o evento existe, o envio de verdade vem depois.
- [x] Cada transição grava quem decidiu, quando e por quê (inclusive recusa, com motivo de
      catálogo) — é o histórico que protege a associação numa contestação futura.
      > `registrar_auditoria` em conferir/aprovar/recusar (`tabela_afetada="propostas_filiacao"`).
      > **Ressalva**: motivo de recusa é texto livre (`PropostaRecusar.motivo`), não catálogo -
      > o checklist original pedia catálogo; dado o volume baixo esperado de recusas e a
      > ausência de uma lista de motivos padronizada ainda definida pela diretoria, texto livre
      > foi a decisão pragmática por ora (fácil de trocar por catálogo depois, sem migração de
      > dado perdida, já que o texto fica preservado no `AuditLog` de qualquer forma).
- [ ] Termo de filiação assinado eletronicamente (motor da FASE 20/v20.2) e arquivado no cadastro.
      > **Não implementado** - depende do motor de assinatura eletrônica da FASE 20/v20.2, que
      > não existe. `DocumentoAnexo` (já existente desde o protótipo) pode arquivar um termo
      > como upload comum hoje, mas sem verificação de assinatura - registrado como pendência
      > na FASE 20/v20.2 para conectar aqui quando o motor existir.
- [x] Período de experiência/integração configurável (ex.: 90 dias ~~sem direito a voto~~), com
      promoção automática ao fim do prazo e aviso à secretaria.
      > `PRAZO_EXPERIENCIA_DIAS` (config, default 90 - 0 desativa). `Associado.data_fim_experiencia`
      > gravado na efetivação. **Resolve a pendência que a própria v1.1 tinha registrado aqui**:
      > `app/services/categoria_associado.py` ganhou o estado `Em Experiência` (`calcular_categoria`
      > verifica `data_fim_experiencia` antes de checar financeiro; `_ESTADOS_CALCULAVEIS` inclui
      > o novo estado). "Promoção automática" tem a mesma limitação já aceita na v1.1a: sem
      > scheduler, a transição de verdade só acontece no próximo evento financeiro ou numa
      > chamada a `/categoria-calculada` - documentado, não escondido. "Aviso à secretaria" não
      > implementado (mesma pendência de e-mail/notificação da v6.2 acima).
      > **Contradição corrigida pela v2.2 (2026-09-15)**: "sem direito a voto" era suposição
      > original deste item, sem base no estatuto (igual "categoria com direito a voto"/"tempo
      > mínimo de filiação", descartadas na v2.2 pelo mesmo motivo) - o Art. 12 não reconhece
      > período de experiência, quem foi aprovado já entra no livro de associados como pleno. O
      > usuário confirmou explicitamente que "Em Experiência" conta como habilitado a votar
      > (`app/services/assembleia.py::calcular_lista_habilitados`, v2.2). `PRAZO_EXPERIENCIA_DIAS`
      > continua existindo como controle administrativo interno (categoria/status), só deixou de
      > ser lido como regra de voto.
- [ ] **Idade mínima de filiação** (`IDADE_MINIMA_FILIACAO_ANOS` = 18, ou 16 com autorização
      expressa dos pais/responsáveis - Art. 12, `RegraEstatutaria` já semeada na v2.0). Pendência
      movida para cá pela v2.0/v2.2 (2026-09-15): nem `PropostaFiliacaoCriar` nem
      `AssociadoMasterCriar` verificam idade mínima hoje - qualquer idade passa. Falta checar
      `data_nascimento` contra a regra vigente, exigindo referência de autorização do responsável
      para 16-17 anos (mesmo padrão de `autorizacao_responsavel_referencia` do voluntariado, v1.6).
- [ ] **Sócios proponentes da filiação** (`QTD_SOCIOS_PROPONENTES_FILIACAO` = 3, Art. 12,
      Parágrafo Único, VI, `RegraEstatutaria` já semeada na v2.0). Pendência movida para cá pela
      v2.0/v2.2 (2026-09-15): `PropostaFiliacaoCriar` não pede nem guarda nenhum proponente hoje.
      Falta exigir 3 associados identificados (CPF ou id_pessoa de cada um) como proponentes,
      gravados na proposta e conferíveis pela secretaria antes da aprovação - rastrear QUEM
      propôs, não um checkbox "sim/não".
>
> Os dois itens de idade mínima e sócios proponentes ficaram fora do escopo original desta
> versão (registrados só depois, na v2.0, quando o estatuto real chegou) - por isso continuam
> como pendência aberta mesmo com a v1.2 fechada, em vez de reabrir a versão inteira.
>
> **Achados corrigidos durante a implementação**: (1) matrícula sequencial só tinha sido
> conectada ao endpoint de filiação, esquecendo `cadastrar_ficha_master` e `bootstrap-admin` -
> corrigido antes de fechar, os três caminhos de criação de associado agora atribuem matrícula.
> (2) a opção de catálogo "Em Experiência" só tinha entrado na migração (bancos já existentes),
> não no `seed_catalogos()` usado por banco novo (dev local/teste) - corrigido, os dois
> caminhos concordam agora (mesmo padrão de paridade já usado na v0.3.1).
>
> Testado: `pytest tests/` — 51/51 (8 novos em `tests/test_filiacao.py`: propor sem auth,
> CPF inválido recusado, CPF duplicado em andamento recusado, fluxo completo até aprovação com
> matrícula + "Em Experiência", matrículas sequenciais e únicas em duas aprovações seguidas,
> recusa com motivo, recusa de proposta já aprovada falha, endpoints administrativos exigem
> autenticação). Testado também contra servidor real: bootstrap-admin ganha matrícula 1,
> proposta → conferir → aprovar cria associado com matrícula 2 e categoria "Em Experiência",
> catálogo `status_arrolamento` com a opção nova confirmado no banco.

#### v1.3 — Importação e exportação de base existente ✅ IMPLEMENTADO (2026-09-14, um item com escopo reduzido por segurança)

- [~] Importação de planilha (Excel/CSV) com assistente de 4 passos: envio → mapeamento de coluna
      → validação linha a linha com relatório de erro → confirmação.
      > Assistente de 4 passos construído no painel (`painel/src/pages/ImportarAssociados.tsx`),
      > testado num navegador de verdade (Playwright) de ponta a ponta: upload → mapeamento
      > (sugestão automática de coluna por nome, ex. "CPF"/"Documento" → `cpf`) → validação +
      > checagem de duplicidade → confirmação → resultado com opção de desfazer.
      > **Só CSV, não Excel (.xlsx), decisão consciente de segurança**: a única biblioteca
      > client-side madura pra `.xlsx` (`xlsx`/SheetJS via npm) tem duas vulnerabilidades de
      > alta severidade **sem correção disponível** (prototype pollution + ReDoS -
      > GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9) - exatamente a superfície de ataque de
      > "parsear arquivo enviado por qualquer um". Instalado e desinstalado na hora (`npm audit`
      > confirmou as duas vulnerabilidades antes de eu decidir não usar). Usado `papaparse`
      > (CSV, sem vulnerabilidade conhecida) no lugar - Excel exporta pra CSV nativamente
      > ("Salvar como"), documentado na própria tela do assistente.
- [x] Detecção de duplicidade por CPF exato **e** por similaridade de nome + data de nascimento,
      com tela de resolução (é a mesma pessoa / são pessoas diferentes / mesclar).
      > `app/services/duplicidade.py`: CPF exato (bloqueio automático) e nome normalizado
      > (sem acento/maiúsculas) + mesma data de nascimento (sinal, não bloqueio). Tela de
      > resolução no assistente deixa escolher "ignorar esta linha" ou "criar mesmo assim" por
      > linha - **"mesclar" não implementado** (juntar o registro novo com um existente é uma
      > operação bem mais delicada - qual dado prevalece? - fora de escopo aqui; hoje a
      > resolução possível é aceitar como pessoa nova ou não importar aquela linha).
- [x] Parsing no navegador (o arquivo bruto não sobe pro servidor), importação em lote idempotente
      identificada por `lote_id` — permite **desfazer uma importação inteira** que deu errado,
      requisito que quase todo sistema esquece e que salva uma migração ruim.
      > `LoteImportacao` (`app/models/importacao.py`) + `Associado.id_lote_importacao`.
      > `POST /api/associados/importar-lote/{id}/desfazer` remove todos os associados daquele
      > lote (Pessoa/Papel/Endereco/Documento/HistoricoCargo/DependenteFamiliar em cascata) -
      > **bloqueado se qualquer um já tiver lançamento financeiro** (nunca apaga dado
      > financeiro, mesma regra congelada da FASE 3). Cada linha da importação roda em
      > `SAVEPOINT` próprio (`db.begin_nested()`) - um erro numa linha não desfaz as outras já
      > gravadas na mesma chamada (achado corrigido durante a implementação: a primeira versão
      > usava `db.rollback()` direto, que desfaria o lote inteiro, não só a linha com erro).
- [x] Exportação com seleção de colunas, sempre registrada em `AuditLog` (quem exportou, quantas
      linhas, quais campos) — exportação de base de associados é o maior vetor de vazamento numa
      associação; ela não pode ser invisível.
      > `GET /api/associados/exportar?colunas=...` - allowlist explícita de colunas exportáveis
      > (nunca um `getattr` solto em cima do parâmetro), audita quem/quantas linhas/quais campos
      > (nunca o conteúdo em si, pra não o próprio `AuditLog` virar um segundo vazamento).
- [x] Exportação de dado pessoal em massa exige permissão própria (`exportar_dados_pessoais`),
      separada de "ver associado".
      > Nova permissão, atribuída só ao Presidente por padrão (Diretoria tem `associados` mas
      > não `exportar_dados_pessoais`) - testado via impersonação que Diretoria recebe 403.
>
> Testado: `pytest tests/` — 61/61 (10 novos em `tests/test_importacao.py`); painel: `vitest`
> 22/22 (4 novos testando `sugerirMapeamento`/`aplicarMapeamento`), `tsc --noEmit` e `eslint`
> limpos. Testado também num navegador real via Playwright: login → MFA → assistente completo
> (upload de CSV com 2 linhas reais → mapeamento sugerido automaticamente → validação sem erro →
> confirmação → "2 criado(s), 0 ignorado(s), 0 erro(s)" → botão de desfazer funcionando).
>
> **Achado de infraestrutura, corrigido no caminho**: `painel/vite.config.ts` só tinha proxy de
> dev pra `/auth` e `/uploads` - `/api/*` (usado por praticamente toda tela construída desde a
> v0.2.3) nunca tinha sido adicionado, então nenhuma tela que chama a API funcionava contra o
> backend local via `npm run dev` sem configurar `VITE_API_URL` manualmente. Corrigido
> adicionando `/api` e `/carteirinha` ao proxy - benefício void pra qualquer trabalho futuro no
> painel, não só esta versão.
>
> **Achado de segurança em dependências pré-existentes, não introduzido por esta versão, mas
> encontrado rodando `npm audit` durante o trabalho**: `painel/package.json` já tinha
> `vitest`/`vite`/`react-router-dom` com vulnerabilidades conhecidas (uma delas crítica -
> `vitest`, path traversal via `@vitest/mocker`). Não corrigido aqui - `npm audit fix --force`
> instalaria versões com breaking changes (`vitest@5`, `react-router-dom@7`) que exigem teste
> completo do painel, fora do escopo de "importar associados". Registrado como pendência na
> FASE 18 (Qualidade de software).

#### v1.4 — Mudança de situação: licença, desligamento e retorno ✅ IMPLEMENTADO (2026-09-14)
>
> **"Transferência" removida do escopo em 2026-09-14**: o título original desta versão
> mencionava "transferência", mas nenhum item da lista abaixo chegou a defini-la, e o sistema
> não tem (nem tem previsão de ter no curto prazo) o conceito de "outra associação" para
> transferir alguém - não existe rede entre associações hoje. Fica de fora até existir uma
> razão concreta para essa funcionalidade.

- [x] Licença temporária (motivo de catálogo, período, efeito sobre voto e mensalidade conforme
      parâmetro) — hoje resolvido informalmente em quase toda associação, aqui vira registro.
      > `POST /api/associados/{id}/licenca` (motivo validado contra catálogo novo
      > `motivo_licenca` - Saúde/Motivo pessoal/Mudança temporária/Estudo -, período
      > `data_inicio`/`data_fim_prevista`, documento de referência). Grava `MudancaSituacao`
      > (`tipo=licenca`) e materializa `status_arrolamento="Licenciado"` +
      > `Associado.data_fim_licenca`. **"Efeito sobre voto" não implementado** - não existe
      > sistema de votação ainda (FASE 2); "efeito sobre mensalidade" também não - ninguém
      > gera mensalidade automática ainda (isso é FASE 3, lançamento manual de título hoje).
      > Promoção automática ao fim do prazo tem a mesma limitação já aceita na v1.2 (sem
      > scheduler - `calcular_categoria` sempre correto na hora que é chamado, materializado
      > só atualiza no próximo evento).
- [x] Desligamento com causa de catálogo (pedido do associado, inadimplência, exclusão
      disciplinar, falecimento), data efetiva, documento de referência e efeitos automáticos:
      acesso revogado, cobranças futuras canceladas, QR code invalidado.
      > `POST /api/associados/{id}/desligar` (motivo validado contra `motivo_desligamento`,
      > catálogo já existente da v0.3.2). Efeitos automáticos, testados de ponta a ponta contra
      > servidor real: `Papel` do associado desativado (invalida a carteirinha digital na hora -
      > reaproveita a checagem de `Papel.ativo` já existente em `verificar_carteirinha`, v1.1,
      > sem precisar de nenhum código novo pra isso), `Usuario.ativo=False` (acesso ao sistema
      > revogado), títulos financeiros `Pendente` com vencimento futuro viram `Cancelado`
      > (dado financeiro nunca é apagado, só marcado - mesma regra congelada da FASE 3).
- [x] **Readmissão**: pessoa que volta reaproveita o mesmo `Pessoa`/histórico, com novo período de
      filiação — nunca cadastro novo. A linha do tempo mostra os dois períodos.
      > `POST /api/associados/{id}/readmitir` reativa o mesmo `Associado`/`Pessoa` (nunca cria
      > registro novo), reativa `Papel` e `Usuario`, aceita CPF/e-mail/telefone novos pra
      > repopular campos que tiverem sido anonimizados (ver item de anonimização abaixo) -
      > testado que a carteirinha volta a verificar depois da readmissão. `MudancaSituacao`
      > (`tipo=readmissao`) registra o evento. "A linha do tempo mostra os dois períodos": a UI
      > de linha do tempo em si é v1.5 (ainda não construída) - o DADO já existe
      > (`GET /api/associados/{id}/historico-situacao` lista todos os eventos em ordem), pronto
      > pra v1.5 renderizar sem precisar de nenhum modelo novo.
- [x] Falecimento tratado com cuidado específico: registro, encerramento das cobranças, retenção
      do histórico por prazo definido na política de retenção (FASE 7), e supressão da pessoa de
      qualquer comunicação automática — falha aqui é dano humano, não bug.
      > Usa o mesmo fluxo de desligamento (`motivo=FALECIMENTO`, já existente no catálogo desde
      > a v0.3.2) - "encerramento das cobranças" já é o efeito automático de cancelar títulos
      > futuros. "Supressão de comunicação automática": não implementado porque não existe
      > NENHUM envio automático de comunicação em nenhum lugar do sistema ainda (não é uma
      > lacuna nova, é ausência total da FASE 6/v6.2) - nada a suprimir hoje; quando v6.2
      > existir, checar `status_arrolamento` antes de enviar.
>
> **A retenção/anonimização de dado (achado da v1.1 registrado acima) foi resolvida agora, não
> adiada pra FASE 7** - decisão explícita do usuário: dado sensível de quem saiu não pode ficar
> retido sem justificativa até "algum dia" a FASE 7 chegar. `app/services/anonimizacao.py`:
> `PRAZO_RETENCAO_DESLIGADO_DIAS` (config, default 1825 dias = 5 anos - **valor de partida, não
> validado juridicamente**; ajustar quando a associação confirmar o prazo certo com
> contador/advogado). Zera CPF/e-mail/telefone/nascimento/estado civil/profissão/
> naturalidade/foto em `Pessoa` - **nome completo e número de matrícula NUNCA são apagados**
> (é o que sustenta o vínculo com registro financeiro/histórico), e nenhum dado de
> `TituloFinanceiro`/`LancamentoContabil`/`PartidaContabil` (v3.0) é tocado (fica perpétuo, por
> exigência contábil, exatamente como o usuário descreveu). `POST /api/associados/{id}/anonimizar` (um só,
> recusa com a data em que fica elegível se ainda não chegou o prazo) e
> `POST /api/associados/anonimizar-vencidos` (lote - pensado pra um admin rodar
> periodicamente até existir scheduler de verdade, FASE 16/18). **Cuidado verificado
> explicitamente**: o `AuditLog` da anonimização registra QUAIS campos foram apagados, nunca
> os valores em si - senão o próprio log de auditoria vazaria pra sempre o dado que a
> anonimização existe pra apagar.
>
> Testado: `pytest tests/` — 72/72 (11 novos em `tests/test_situacao.py`: licença muda
> categoria, desligamento com motivo inválido recusado, desligamento invalida papel e bloqueia
> carteirinha, desligar duas vezes falha, readmissão reativa papel e a carteirinha volta a
> funcionar, readmitir quem não está desligado falha, anonimizar antes do prazo é recusado,
> anonimizar depois do prazo apaga dado sensível mas preserva nome/matrícula, anonimização em
> lote processa só os vencidos, histórico de situação registra os eventos, endpoints exigem
> autenticação). Testado também contra servidor real com dado "realista" (CPF/nome de
> verdade): desligado em 2020 → categoria calculada mostra `Desligado` (nunca recalculada
> automaticamente) → anonimizado com sucesso (prazo de 5 anos já vencido) → `pessoas` mostra
> nome preservado e CPF/e-mail/telefone `NULL` → `AuditLog` confirmado sem vazar os valores
> apagados → readmitido com CPF/e-mail novos → dados repopulados corretamente.

##### 🔍 Ponto de Revisão — FASE 1 (1/2 — meio, fecha v1.0–v1.4) — aplicado em 2026-09-14

- [x] **Item 1 (implementado e testado de fato)**: sim — v1.0-v1.4 verificadas contra o código
      real (não por analogia): dedup de CPF, cálculo de categoria, auditoria de filiação e
      efeitos automáticos de desligamento/readmissão/anonimização foram lidos e conferidos linha
      a linha nesta revisão, não só relidos no texto do plano.
- [x] **Item 2 (testes automatizados existem e passam)**: `pytest tests/` — **72/72 passando**,
      confirmado rodando a suíte completa agora (`test_pessoas.py`, `test_v1_1.py`,
      `test_filiacao.py`, `test_importacao.py`, `test_situacao.py` entre outros). Só warnings de
      depreciação (`datetime.utcnow()`), nenhuma falha.
- [x] **Item 3 (nenhuma regra congelada violada)**: confirmado — Alembic continua o único
      caminho de mudança de schema, RBAC por permissão (`exigir_permissao`) continua o único
      modelo de autorização, nenhum dado financeiro (`TituloFinanceiro`/`TransacaoCaixa`) foi
      apagado por desligamento/anonimização (só marcado/preservado, como já registrado na v1.4).
- [x] **Item 4 (nenhum segredo exposto)**: `git status` limpo, nenhum segredo novo introduzido
      por v1.0-v1.4 (tokens de carteirinha usam o `JWT_SECRET` já existente).
- [x] **Item 5 (AuditLog de verdade)**: confirmado no código, não só no plano —
      `conferir_proposta`/`recusar_proposta`/`aprovar_proposta` (`app/routers/filiacao.py`) e
      licença/desligamento/readmissão/anonimização (`app/routers/situacao.py`) chamam
      `registrar_auditoria` de fato, com motivo/data.
- [x] **Item 6 (permissão checada no backend)**: confirmado — toda rota de `filiacao.py` e
      `situacao.py` depende de `exigir_permissao("associados")`, nunca só escondida no front.
- [x] **Item 7 (nada fora de escopo adiantado)**: confirmado pelas próprias ressalvas já
      registradas em v1.0-v1.4 (voto/mensalidade de licença, termo assinado eletronicamente,
      mesclagem de duplicidade) — cada uma aponta pra fase futura em vez de fingir pronto.
- [x] **Item 8 (plano atualizado refletindo a realidade)**: sim, cada versão já documentada com
      nota de verificação real na hora da implementação.
- [x] **Item 9 (suíte completa continua passando)**: mesma execução do item 2 — 72/72, nada
      anterior quebrou silenciosamente.

**Itens específicos do trecho**:

- [x] **Deduplicação por CPF (v1.0)**: `test_cpf_duplicado_e_recusado` cobre CPF idêntico (400).
      CPF com formatação diferente ("111.222.333-44" vs "11122233344") não tem teste explícito,
      mas é coberto **por construção**: `AssociadoMasterCriar.validar_cpf_campo`
      (`app/schemas/associados.py:44-49`) normaliza para só-dígitos (`somente_digitos`) antes de
      qualquer gravação/comparação, e `Pessoa.cpf` é `unique=True` sobre o valor já normalizado —
      não existe caminho onde um CPF formatado diferente escape da checagem. **Achado registrado,
      não bloqueante**: falta um teste explícito pra essa formatação — anotado como pendência de
      cobertura de teste (FASE 18), não como bug. "Nome parecido sem CPF" **não é bloqueado em
      v1.0 nem deveria ser** — o próprio v1.0 declarou isso fora de escopo (nº 1075 do plano);
      quem cobre nome+nascimento como sinal (nunca bloqueio) é a v1.3 (`duplicidade.py`), só no
      assistente de importação, não na criação direta de associado — comportamento como
      documentado, não uma lacuna nova.
- [x] **Categoria calculada (v1.1)**: confirmado no código — `status_arrolamento` só é escrito
      por `app/services/categoria_associado.py`, `app/routers/situacao.py` e
      `app/routers/filiacao.py` (todos server-side, a partir de evento real). Não existe em
      nenhum schema de entrada (`AssociadoAdminUpdate`/`AssociadoPerfilUpdate`) e o único `<select
      id="listas_tipo">` que lista "status_arrolamento" no HTML admin é o gerenciador do
      **catálogo** de rótulos (renomear/reordenar opção), não uma forma de atribuir a categoria a
      um associado específico — não é um campo editável disfarçado.
- [x] **Fluxo de filiação (v1.2)**: confirmado — `conferir`/`recusar`/`aprovar` chamam
      `registrar_auditoria` cada um, com o usuário autenticado (`usuario=Depends(...)`) como
      quem decidiu e o motivo obrigatório em `recusar`.

**Fase não bloqueada**: nenhum item do checklist falhou de forma que exija correção antes de
avançar; o único achado (falta de teste explícito pra CPF formatado) foi registrado como
pendência de cobertura, não como bug de comportamento. FASE 1 segue para v1.5–v1.8, com o
segundo ponto de revisão no fim.

#### v1.5 — Linha do tempo e ficha 360º do associado ✅ IMPLEMENTADO (2026-09-14, escopo real declarado)

- [~] Uma única tela reunindo: dados, situação financeira resumida, cargos exercidos, participação
      em projetos/eventos, presença em assembleias, votos computados (sem revelar o voto secreto),
      documentos, protocolos abertos, comunicações enviadas e recebidas.
      > **Escopo real, não fingido**: dados/situação financeira resumida/cargos/documentos/linha
      > do tempo - construídos, com dado de verdade. "Projetos/eventos" (FASE 4), "presença em
      > assembleias"/"votos computados" (FASE 2), "protocolos abertos" (nenhuma fase ainda define
      > o que é um protocolo) e "comunicações enviadas e recebidas" (FASE 6) **não têm nenhuma
      > fase construída ainda** - não há dado real pra mostrar, então não fingi seção vazia
      > decorativa. Cada um aparece sozinho no dia em que o módulo correspondente existir e
      > chamar `publicar_evento_linha_do_tempo` (ver item abaixo) - documentado em
      > `app/services/ficha_360.py`.
      > **Tela real construída no painel React, não só o endpoint**: a aba "Linha do tempo" em
      > Meu Perfil (`painel/src/pages/Perfil.tsx`) - situação financeira, cargos e a linha do
      > tempo juntas, com estado vazio tratado (não erro). **Achado de escopo, registrado**: o
      > painel React ainda não tem um módulo "Associados" de verdade (`/associados` é
      > `<EmConstrucao>` - só o portal HTML legado de `associados.py`, não migrado, cobre isso
      > hoje) - por isso a tela nova é **autoatendimento** (`GET /auth/me/ficha-360`, o associado
      > vendo a própria ficha), não a versão administrativa (secretaria consultando a ficha de
      > qualquer um). O endpoint administrativo equivalente
      > (`GET /api/associados/{id}/ficha-360`, permissão `associados`) **já existe e está
      > testado** - só falta a tela quando o módulo Associados do painel for construído (fora de
      > escopo aqui: é um módulo CRUD inteiro, não uma tela isolada).
- [x] Alimentada por um `EventoLinhaDoTempo` genérico que cada módulo publica — módulo novo
      aparece na ficha sem alterar a tela.
      > `app/models/linha_do_tempo.py` (tabela `eventos_linha_do_tempo`) +
      > `app/services/linha_do_tempo.py::publicar_evento_linha_do_tempo`. Publicado hoje em:
      > filiação aprovada (`filiacao.py`), licença/desligamento/readmissão (`situacao.py`),
      > anonimização (`anonimizacao.py` - nunca lista os valores apagados, mesmo cuidado do
      > `AuditLog`) e posse/saída de cargo (`associados.py`). As tabelas de domínio
      > (`MudancaSituacao`, `HistoricoCargo`, `TituloFinanceiro`) continuam sendo a fonte de
      > verdade de cada cálculo - esta tabela é só a narrativa unificada que a ficha lê, nunca
      > recalcula nada a partir dela.
      > Migração `f0a1b2c3d4e5` faz **backfill** do histórico já existente antes desta versão
      > (mudanças de situação, filiações já aprovadas, cargos já registrados) - testado
      > isoladamente contra um banco sintético com dado "pré-v1.5" (upgrade gera os 4 eventos
      > esperados na ordem certa; downgrade remove a tabela sem erro).
>
> Testado: `pytest tests/` - 83/83 (5 novos em `tests/test_ficha_360.py`: exige autenticação,
> 404 pra associado inexistente, reúne financeiro+cargos+linha do tempo corretamente ordenada,
> filiação aprovada aparece na linha do tempo com a matrícula certa, autoatendimento e
> administrativo mostram a mesma ficha para a mesma pessoa). Painel: `tsc --noEmit` e `eslint`
> limpos, `vitest` 22/22. Testado também em navegador real via Playwright (`e2e/ficha-360.spec.ts`,
> 2 casos: linha do tempo com dado real e estado vazio tratado sem erro) - suíte e2e completa
> 10/10.

#### v1.6 — Pessoas além do associado: voluntário e empregado (base legal confirmada) ✅ IMPLEMENTADO (2026-09-15)

Distinção jurídica real, não só de rótulo: voluntário (Lei 9.608/1998) nunca gera vínculo
empregatício; empregado CLT tem outro regime inteiro (eSocial, ponto, folha).
> **Confirmado com o usuário antes de construir**: a ASAF hoje não tem voluntário, beneficiário
> nem funcionário reais - só associados. Decisão explícita: construir a infraestrutura mesmo
> assim, porque o Painel é **unificado por Pessoa**, não por Associado - é exatamente o desenho
> da v1.0 (Pessoa como raiz, Papel N:N). Não é "fingir pronto" (nenhum dado falso foi criado);
> é a mesma lógica de construir o motor de categoria calculada antes de existir associado
> inadimplente de verdade.

- [x] `TermoAdesaoVoluntario` (atividade, carga horária, local, vigência) — documento formal
      exigido pela Lei 9.608/1998, versionado, assinado pelo motor da FASE 20, renovável, com
      alerta de vencimento. Voluntário sem termo vigente não é alocável em projeto (trava real,
      não aviso).
      > `app/models/voluntariado.py` + `app/services/voluntariado.py::criar_termo_adesao` -
      > renovação NUNCA edita a linha anterior (cria uma nova, `versao` incrementada, marca a
      > anterior `ativo=False`) - histórico completo preservado. **"Assinado pelo motor da FASE
      > 20" não implementado** - mesma pendência já registrada pela v1.2 pro termo de filiação
      > (`documento_referencia` aqui é só upload comum, sem verificação de assinatura; conectar
      > quando a FASE 20/v20.2 existir). **"Alerta de vencimento" não implementado** - mesma
      > limitação já aceita nas v1.1a/v1.2/v1.4 (sem infra de notificação, pendência da v6.2).
      > **Trava real testada de ponta a ponta**: `POST /projetos/alocar/` (endpoint legado de
      > FASE 4, ainda prototípico) passou a recusar (403) alocação de associado sem termo
      > vigente - `tests/test_voluntariado.py::test_alocar_voluntario_sem_termo_vigente_e_recusado`.
- [x] Registro de horas de voluntariado e certificado gerado a partir dele (motor único da v4.8).
      > `RegistroHorasVoluntariado`, sempre amarrado a um termo (nunca aceito sem termo vigente
      > - `POST /api/pessoas/{id}/horas-voluntariado` devolve 400 sem termo). **Certificado não
      > implementado** - depende do "motor único" da v4.8, que ainda não existe (FASE 4 não
      > construída); o registro de horas em si já é real e consultável, pronto pra alimentar o
      > motor quando ele existir.
- [x] Voluntário menor de idade: exige autorização de responsável anexada, e o sistema trata o
      dado como sensível (FASE 7).
      > `pessoa_e_menor_de_idade` calcula a idade na `data_inicio` do termo (nunca na data atual
      > - a menoridade que importa é a de quando o vínculo começou); sem `data_nascimento`
      > cadastrada, trata como potencialmente menor (mais restritivo, nunca assume maioridade
      > sem prova). Sem `autorizacao_responsavel_referencia`, a criação do termo é recusada
      > (422). Testado com pessoa de 15 anos: recusado sem autorização, aceito com.
- [x] Empregados CLT: folha/ponto/eSocial ficam **fora do escopo** por decisão registrada —
      recomenda-se integrar com sistema de folha especializado. O que fica aqui é só o cadastro da
      pessoa como `funcionario` e o vínculo com centro de custo, para o financeiro enxergar a
      despesa. Confirmar com a diretoria se a ASAF tem empregados antes de qualquer integração.
      > Confirmado acima. `Funcionario` (cargo + `id_conta_centro_custo` opcional, referenciando
      > `PlanoDeContas`) - 1:1 por pessoa (recusa cadastro duplicado). Papel `funcionario`
      > marcado junto, mesmo padrão de todo satélite desde a v1.0.
>
> **Achado corrigido nesta versão, antes de virar dívida maior**: `EventoLinhaDoTempo` (v1.5)
> tinha nascido chaveado por `id_associado` - cobria só quem já era Associado. Voluntário/
> funcionário são papéis que uma `Pessoa` pode ter SEM nunca ser Associado (o próprio motivo da
> v1.0 ter criado `Pessoa`/`Papel`). Corrigido para `id_pessoa` (migração `a1b2c3d4e5f6`, com
> backfill via join em `associados` e verificação de contagem - mesmo rigor de migrações
> anteriores) antes que mais módulos futuros passassem a depender da chave errada. Efeito
> colateral bom: a Ficha 360º (v1.5) e a linha do tempo continuam funcionando idênticas para
> quem já é associado (nenhum teste de v1.5 quebrou), e agora eventos de voluntário/funcionário
> **já são publicados** de verdade (`app/services/linha_do_tempo.py`) - só não têm endpoint de
> **visualização** ainda pra uma pessoa que nunca foi associada (a ficha-360 de hoje é
> associado-only; uma "ficha da pessoa" genérica é a extensão natural, registrada como pendência,
> não construída agora - fora de escopo desta versão).
>
> **Sem tela no painel React**: mesma situação já registrada na v1.5 - não existe módulo
> "Voluntários"/"Funcionários" no painel (só o backend, testado via API). Fica pendente até um
> desses módulos ser priorizado.
>
> Testado: `pytest tests/` - 91/91 (8 novos em `tests/test_voluntariado.py`: exige autenticação,
> termo cria papel e aparece vigente, renovação incrementa versão e encerra o anterior, termo
> vencido não conta como vigente, menor de idade sem/com autorização, horas exigem termo
> vigente, alocação em projeto sem termo é recusada, cadastro de funcionário cria papel e recusa
> duplicata). Migrações testadas em cadeia completa (v1.5 → v1.6 id_pessoa → v1.6 tabelas novas)
> contra um banco sintético "pré-v1.5": upgrade e downgrade de ponta a ponta, sem erro.

#### v1.7 — Relacionamento familiar e núcleo doméstico ✅ IMPLEMENTADO (2026-09-15)

- [x] `DependenteFamiliar` evoluído para vínculo entre `Pessoa`s (parentesco de catálogo), o que
      permite dependente virar associado depois sem recadastro, e permite "cobrança por família"
      na FASE 3 sem gambiarra.
      > **Limitação real corrigida**: até aqui as duas pontas do vínculo precisavam JÁ ser
      > `Associado` (`id_titular`/`id_associado_vinculado`, ambos FK pra `associados`) - impedia
      > o caso mais comum (filho menor sem cadastro nenhum ainda). Migração `c3d4e5f6a7b8`
      > troca para `id_pessoa_titular`/`id_pessoa_vinculada` (FK pra `pessoas`), com backfill via
      > join e verificação de contagem (mesmo rigor de `a1b2c3d4e5f6`/`a5b6c7d8e9f0`).
      > `POST /api/pessoas/{id}/dependentes` (novo, autenticado, permissão `associados`) aceita
      > **ou** `id_pessoa_vinculada` (vincula alguém que já tem cadastro de `Pessoa`) **ou**
      > `nome_completo`/`data_nascimento` (cria a `Pessoa` na hora, sem nenhum `Papel` ainda) -
      > é assim que um filho menor entra no sistema pela primeira vez. Se um dia ele virar
      > associado, a `Pessoa` já existe - só ganha o `Papel` "associado" (mesma regra desde a
      > v1.0), sem recadastro, que é exatamente o que este item pedia.
      > `grau_parentesco` agora é validado contra o catálogo `grau_parentesco` (existente desde
      > a v0.3.1, mas nunca checado no backend - aceitava texto livre solto) -
      > `app/services/catalogos.py::validar_codigo_em_catalogo`, extraído do que era uma função
      > privada em `situacao.py` (`_validar_motivo_em_catalogo`) pra ser reaproveitado aqui sem
      > duplicar a mesma consulta.
      > **Compatibilidade preservada, mesmo padrão da v0.3.1**: as rotas legadas
      > (`/api/associados/{id}/dependentes`, usadas pelo portal HTML antigo ainda em produção)
      > continuam funcionando com o mesmo contrato JSON de sempre - por baixo, viraram um shim
      > sobre a tabela reformada (resolvem `id_associado` ↔ `id_pessoa` nos dois sentidos).
      > **"Cobrança por família" fica para a FASE 3** - o vínculo agora existe (Pessoa-Pessoa),
      > mas nenhuma regra de cobrança foi implementada aqui (fora de escopo desta versão, por
      > desenho - é o financeiro que vai consumir isso quando chegar sua vez).
>
> Testado: `pytest tests/` - 98/98 (7 novos em `tests/test_dependentes.py`: exige autenticação,
> dependente criado como Pessoa nova sem nenhum cadastro prévio, vínculo com Pessoa já existente
> (inclusive já associada), rejeição quando nem `id_pessoa_vinculada` nem `nome_completo` são
> informados, grau de parentesco inválido recusado, vínculo duplicado recusado, rota legada
> associado-associado continua funcionando sem mudança de contrato). Migração testada em cadeia
> completa (v1.5 → v1.6 → v1.7) contra banco sintético "pré-v1.5": upgrade e downgrade de ponta
> a ponta, sem erro.
>
> **Sem tela no painel React** - mesma situação já registrada nas v1.5/v1.6 (só o portal HTML
> legado tem UI de família hoje, agora falando com a tabela nova por baixo).

#### v1.8 — Qualidade permanente da base (o que mantém o cadastro vivo em 15 anos) ✅ IMPLEMENTADO (2026-09-15)

- [x] Campanha de recadastramento periódica: o associado confirma/atualiza os próprios dados pelo
      painel, com registro da data da última confirmação — dado "confirmado há 8 anos" é dado
      duvidoso e o sistema precisa saber disso.
      > `Pessoa.data_ultima_confirmacao` (nulo = nunca confirmado). `POST
      > /auth/perfil/confirmar-dados` (confirma sem alterar nada) e `PUT /auth/perfil` (editar já
      > conta como confirmação - a pessoa acabou de revisar) atualizam o carimbo. Ficha 360º
      > (`/api/associados/{id}/ficha-360` e `/auth/me/ficha-360`) expõe
      > `recadastramento_pendente` (calculado contra `PRAZO_RECADASTRAMENTO_DIAS`, configurável,
      > default 365 dias - mesmo padrão de configuração de `PRAZO_EXPERIENCIA_DIAS`/
      > `PRAZO_RETENCAO_DESLIGADO_DIAS`). **"Campanha" (disparo em massa/lembrete) não
      > implementado** - mesma limitação já aceita repetidamente desde a v1.1a (sem
      > infraestrutura de notificação, pendência da v6.2); o indicador existe e é consultável
      > agora, o "empurrão" pra secretaria/associado vem depois.
- [x] Detector de duplicidade rodando continuamente (não só na importação), gerando fila de
      revisão para a secretaria, com **mesclagem de cadastros** que preserva o histórico dos dois
      lados e registra a operação em `AuditLog` (operação irreversível, exige confirmação nomeada).
      > `FilaRevisaoCadastro` (genérica - carrega tanto par de duplicidade quanto sinal de
      > contato suspeito, "alimentando a mesma fila" como o item de higienização pede).
      > `POST /api/pessoas/duplicidade/escanear` (`app/services/duplicidade.py::
      > escanear_duplicidade_continua`) agrupa TODAS as `Pessoa`s por nome normalizado +
      > nascimento (não só a linha sendo importada, como a v1.3 já cobria) - idempotente, não
      > duplica entrada pendente já existente pro mesmo par. **Mesclagem real**
      > (`app/services/mesclagem.py::mesclar_pessoas`), não um esqueleto: reatribui `Papel`
      > (descarta duplicata de mesmo tipo), `Associado`, `Funcionario`, `TermoAdesaoVoluntario`
      > (desativa o da absorvida se a mantida já tiver um ativo - nunca dois ativos ao mesmo
      > tempo), `EventoLinhaDoTempo` e `DependenteFamiliar` (descarta vínculo que viraria
      > autorreferência ou duplicata) da pessoa absorvida para a mantida, preenche campos
      > pessoais vazios da mantida com os da absorvida (nunca sobrescreve o que já existe), grava
      > `AuditLog` com as contagens movidas por tabela, e só então apaga a `Pessoa` absorvida.
      > Exige `nome_confirmacao` batendo exatamente com o nome de quem será absorvida - sem isso,
      > recusado (400). **Limite de segurança deliberado**: se as duas pessoas já são `Associado`
      > (ou já são `Funcionario`) ao mesmo tempo, a mesclagem automática é recusada (409) - qual
      > matrícula/vínculo prevalece é decisão de negócio que este serviço não tenta adivinhar.
      > `POST /api/pessoas/fila-revisao/{id}/ignorar` marca sinal falso; mesclar resolve
      > automaticamente qualquer entrada pendente que envolvia as duas pessoas.
- [x] Higienização de contato: e-mail que volta (bounce) e telefone inválido marcam o contato como
      suspeito, alimentando a mesma fila de revisão.
      > **Telefone**: `POST /api/pessoas/higienizar-contatos`
      > (`app/services/higienizacao_contato.py::escanear_telefones_invalidos`) varre toda pessoa
      > com telefone preenchido contra o mesmo validador de formato da v1.1
      > (`validar_telefone_br`) - marca `Pessoa.contato_suspeito=True` e alimenta a fila.
      > **E-mail "bounce" não é detectável automaticamente** - não existe nenhuma infraestrutura
      > de envio de e-mail no sistema (pendência repetida desde a v6.2); sem enviar nada, não há
      > como saber que algo "voltou". `POST /api/pessoas/{id}/marcar-contato-suspeito` é o
      > caminho manual - pra quando a secretaria descobre um bounce por fora do sistema,
      > registrado com motivo, alimentando a mesma fila. Documentado, não fingido.
>
> Testado: `pytest tests/` - 105/105 (7 novos em `tests/test_qualidade_cadastro.py`:
> recadastramento pendente antes/depois de confirmar, detecção de par duplicado por nome+
> nascimento com variação de caixa/acento, varredura repetida não duplica entrada, ignorar
> item some da fila pendente, mesclagem preserva histórico e some com a absorvida, mesclagem de
> dois associados é bloqueada, higienização marca telefone inválido, marcação manual de e-mail
> suspeito). Três testes pré-existentes (`test_configuracoes`/`test_import_export`/
> `test_smoke`) tinham a contagem de chaves de configuração hardcoded - atualizados de 15 para
> 16 (a nova `PRAZO_RECADASTRAMENTO_DIAS`), não é regressão. Migração testada isoladamente
> (upgrade cria as colunas/tabela esperadas; downgrade remove sem erro).
>
> **Sem tela no painel React** - mesma situação já registrada nas v1.5-v1.7 (fila de revisão e
> mesclagem só existem via API por ora, testadas diretamente).

#### v1.8a — Adendo (2026-09-15): bloqueio de cadastro duplicado na hora, não mesclagem depois
>
> **Origem**: ao revisar a mesclagem acima, o usuário questionou por que mesclar dois
> `Associado` já existentes é bloqueado (409) em vez de resolvido automaticamente. A discussão
> chegou a uma alternativa mais simples e mais segura: **impedir o cadastro duplicado na
> largada**, em vez de detectar e desfazer depois. CPF nunca bate por erro de digitação (é
> exatamente por isso que o CPF sozinho não pega o caso real) - nome + pelo menos outro dado
> pessoal batendo (nascimento, telefone ou e-mail) agora **bloqueia o cadastro direto**, não é
> mais só um sinal que vira tela de revisão depois.

- [x] `app/services/duplicidade.py::detectar_cadastro_duplicado` - nome normalizado batendo +
      pelo menos 1 de (nascimento, telefone, e-mail) batendo = bloqueio (409), mostrando qual
      cadastro parecido já existe. Rodou nos dois pontos onde um `Associado` novo nasce direto
      (não em lote - a importação v1.3 mantém sinal, nunca bloqueio, por decisão já registrada
      naquela versão): `POST /associados-master/` (`cadastrar_ficha_master`) e
      `POST /api/filiacao/propostas/{id}/aprovar` (`aprovar_proposta`).
- [x] Nova permissão `forcar_cadastro_duplicado` (módulo `associados`), concedida por padrão só
      ao nível Presidente (mesmo padrão de `exportar_dados_pessoais` da v1.3) - só quem tem essa
      permissão consegue passar `forcar: true` no corpo da requisição e cadastrar mesmo assim;
      sem a permissão, `forcar` não tem efeito nenhum. Toda vez que é usado, gera `AuditLog`
      (`CADASTRO_DUPLICADO_FORCADO`) com o nome e a pessoa parecida - decisão deliberada nunca
      fica silenciosa.
      > **Achado de arquitetura corrigido**: `/associados-master/` nunca teve nenhuma
      > autenticação (herdado do protótipo pré-plano, ainda chamado sem token pelo portal HTML
      > legado) - não dava pra checar permissão de ninguém ali. Em vez de exigir login (quebraria
      > o portal antigo em produção, fora de escopo mexer nisso agora), criada
      > `get_current_user_opcional` (`app/security.py`) - resolve o usuário SE um token válido
      > vier, sem exigir um se não vier. O portal legado (sem token) nunca consegue forçar
      > cadastro duplicado; só um cliente autenticado com a permissão certa consegue.
- [x] `mesclagem.py` (v1.8 original) continua exatamente como estava, agora como **segunda linha
      de defesa**, não a primeira: cobre o que já existia antes desta trava (dado importado em
      lote, ou cadastrado antes desta versão existir) - não faz mais sentido ser o caminho
      principal pra duplicidade nova a partir de agora.
>
> Testado: `pytest tests/` - 110/110 (5 novos em `tests/test_cadastro_duplicado.py`: bloqueado
> mesmo sem forçar, `forcar=true` sem usuário autenticado continua bloqueado, Presidente
> consegue forçar, nome igual sozinho OU nome+telefone diferente não bloqueia (evita falso
> positivo com nome comum), aprovação de filiação bloqueia e Presidente força). **Achado nos
> testes já existentes**: vários arquivos de teste tinham um `_criar_associado` local com nome E
> telefone fixos, reaproveitados em várias chamadas dentro do mesmo teste/sessão - o novo
> bloqueio (corretamente) passou a recusar essas chamadas como "mesma pessoa". Corrigido dando
> nome/e-mail únicos por padrão a cada chamada (usando o mesmo sufixo do CPF já gerado), em
> `test_qualidade_cadastro.py`, `test_dependentes.py`, `test_ficha_360.py`, `test_situacao.py`,
> `test_v1_1.py` e `test_filiacao.py` - não é regressão do comportamento, é o teste tendo que
> criar pessoas de fato distintas quando a intenção é criar pessoas distintas.

##### 🔍 Ponto de Revisão — FASE 1 (2/2 — fim, fecha v1.5–v1.8) — aplicado em 2026-09-15

- [x] **Item 1 (implementado e testado de fato)**: sim — v1.5-v1.8/v1.8a foram lidas e
      conferidas contra o código real nesta revisão (endpoints, migrações, permissões), não só
      relidas no texto do plano.
- [x] **Item 2 (testes automatizados existem e passam)**: `pytest tests/` — **110/110
      passando**, confirmado rodando a suíte completa agora (`test_ficha_360.py`,
      `test_voluntariado.py`, `test_dependentes.py`, `test_qualidade_cadastro.py`,
      `test_cadastro_duplicado.py`, entre outros).
- [x] **Item 3 (nenhuma regra congelada violada)**: confirmado — todo schema novo (v1.5-v1.8)
      passou por migração Alembic, nenhuma criada só via `create_all`; a nova permissão
      `forcar_cadastro_duplicado` (v1.8a) segue o contrato de RBAC por permissão nomeada, nunca
      checagem de nível hardcoded (`DECISOES_CONGELADAS.md` 3.x) - conferido em
      `app/routers/associados.py`/`filiacao.py` que o código chama
      `usuario_tem_permissao(db, usuario, "forcar_cadastro_duplicado")`, nunca
      `if nivel == "Presidente"`.
- [x] **Item 4 (nenhum segredo exposto)**: `git status` limpo, nenhum segredo novo introduzido
      em nenhuma das versões desta janela.
- [x] **Item 5 (AuditLog de verdade)**: confirmado no código - `mesclar_pessoas` (contagens por
      tabela), `CADASTRO_DUPLICADO_FORCADO` (ficha master e aprovação de filiação),
      `DADOS_CONFIRMADOS` (recadastramento), `MESCLADO` (pessoas.py) todos chamam
      `registrar_auditoria` de fato.
- [x] **Item 6 (permissão nova checada no backend)**: confirmado - toda rota de
      `qualidade_cadastro.py`, `voluntariado.py` e os novos endpoints de dependentes por Pessoa
      depende de `exigir_permissao("associados")`; o bloqueio de cadastro duplicado depende de
      `usuario_tem_permissao(..., "forcar_cadastro_duplicado")`, nunca só escondido no front.
- [x] **Item 7 (nada fora de escopo adiantado)**: confirmado pelas próprias ressalvas já
      registradas em cada versão (certificado de voluntariado pendente da v4.8, assinatura
      eletrônica pendente da FASE 20, campanha de recadastramento em massa pendente da v6.2,
      "grupo de comunicação" registrado na v6.2 mas não construído) - cada uma aponta pra fase
      futura em vez de fingir pronto.
- [x] **Item 8 (plano atualizado refletindo a realidade)**: sim, cada versão (v1.5-v1.8, v1.8a)
      já documentada com nota de verificação real na hora da implementação.
- [x] **Item 9 (suíte completa continua passando)**: mesma execução do item 2 - 110/110, nada
      anterior quebrou silenciosamente.

**Itens específicos do trecho**:

- [x] **Importação em lote (v1.3) reversível por `lote_id`**:
      `test_desfazer_lote_remove_associados_criados` (`tests/test_importacao.py`) confirmado
      passando nesta revisão - desfazer remove os associados criados pelo lote e é bloqueado se
      qualquer um já tiver lançamento financeiro (nunca apaga dado financeiro).
- [x] **Readmissão (v1.4) reaproveita o `Pessoa` existente, nunca cria cadastro novo**:
      confirmado no código (`app/routers/situacao.py::readmitir_associado`) - reativa o mesmo
      `Associado`/`Papel` (`associado.status_arrolamento = ATIVO_EM_DIA`, papel existente
      reativado ou criado só se realmente não existir), nunca instancia um `Associado` novo.
      `test_readmissao_reativa_papel_e_zera_data_desligamento` confirmado passando.
- [x] **Detector de duplicidade contínuo (v1.8) gera fila de revisão, não mescla sozinho**:
      confirmado no código - `escanear_duplicidade_continua` (`app/services/duplicidade.py`) só
      chama `db.add(FilaRevisaoCadastro(...))`; `mesclar_pessoas` (`app/services/mesclagem.py`)
      só é chamado a partir do endpoint explícito `POST /api/pessoas/{id}/mesclar`, nunca do
      escaneamento. `test_escanear_duplicidade_fluxo_completo` confirmado passando.

**Fase não bloqueada**: nenhum item do checklist falhou. **FASE 1 encerrada** - v1.0 até v1.8a
completas, testadas (110/110, incluindo verificação real de código nesta revisão), documentadas,
com os dois pontos de revisão da fase aplicados. Próxima fase é a FASE 2 (Governança).

---

<a id="fase-2"></a>

### FASE 2 — Governança (assembleias, diretoria, conselho fiscal)

Base legal confirmada por pesquisa: Código Civil, Arts. 53–61 (associações). O módulo de
governança segue esses artigos como piso mínimo, não como teto — a FASE 12 trata do que vai além
deles, e a FASE 13 leva assembleia/diretoria ao detalhamento máximo. **A FASE 2 entrega o núcleo
funcional; a FASE 13 entrega o refinamento.** Esta separação é deliberada: a associação precisa
conseguir fazer uma assembleia válida bem antes de ter todos os refinamentos.

#### v2.0 — O estatuto como configuração, não como código
>
> **Estatuto real recebido do usuário (2026-09-15)**: transcrito em `ESTATUTO_ASAF.txt` (raiz do
> repositório, sem a parte de assinaturas/reconhecimento de firma - só o texto normativo, Art. 1º
> a 35). Registrado em cartório (Comarca de Parauapebas/PA, Livro A-17/A-18, 23/05/2013).
> Fundado em 10/02/2013, Código Civil Arts. 45/46/54. **Resolve a pendência da seção 8**: "o
> estatuto permite procuração?" - **não**, o Art. 7º veda expressamente ("é vedada a
> representação de um associado por outro mesmo que devidamente credenciado para efeito de
> quórum ou do voto"). O usuário confirmou que é um estatuto "muito defasado" e pediu foco só no
> essencial (quórum, prazos, mandato) - refinamento além disso é explicitamente FASE 13, não
> aqui.

- [x] **Decisão de perpetuidade mais importante desta fase**: nenhum número estatutário fica
      escrito em código. Quórum, prazos, mandatos, quem vota, se cabe procuração — tudo vira
      parâmetro em `ConfiguracaoInstitucional`/`RegraEstatutaria` (v0.3.4). A ASAF vai reformar o
      estatuto ao longo de 20 anos; reforma de estatuto não pode virar tarefa de programador.
      > Implementado: `app/models/estatuto.py` (`RegraEstatutaria`), `app/services/estatuto.py`
      > (`obter_regra_vigente`/`reformar_regra`) e `app/routers/estatuto.py`
      > (`/api/estatuto/regras/*`, permissão `governanca`). Teste
      > `tests/test_regras_estatutarias.py::test_mudar_parametro_muda_comportamento_sem_deploy`
      > prova a decisão: reformar um parâmetro pela API muda `obter_regra_vigente` sem deploy.
- [x] `RegraEstatutaria` versionada por vigência: cada parâmetro guarda o período em que valeu.
      Uma assembleia de 2027 continua sendo auditável pelas regras de 2027 mesmo depois da reforma
      de 2031 — sem isso, todo histórico de governança fica mentiroso.
      > Implementado: `reformar_regra` nunca faz UPDATE em `valor` — fecha `vigencia_fim` da
      > linha vigente e insere uma nova; `obter_regra_vigente(db, parametro, em=<data>)`
      > reconstitui a regra vigente em qualquer instante do passado. Testado em
      > `test_reformar_regra_fecha_vigencia_anterior_e_preserva_historico`.
- [x] Documento do estatuto vigente anexado e versionado, com o número de registro em cartório
      (a eficácia perante terceiros vem do registro, ver v13.4) e link de cada parâmetro ao artigo
      que o originou — quem for auditar entende de onde saiu cada número.
      > Implementado: `DocumentoEstatuto` (migração `e1f2a3b4c5d6`), semeado com o registro real
      > (Comarca de Parauapebas/PA, Livro A-17/A-18, 23/05/2013) via `seed_regras_estatutarias`;
      > cada `RegraEstatutaria` carrega `artigo_origem` e `id_documento_estatuto`. Upload de
      > arquivo do estatuto em si ainda não tem rota dedicada — hoje só `caminho_arquivo` aponta
      > para `ESTATUTO_ASAF.txt` na raiz do repositório; pendência menor para quando o site
      > público (FASE 5) precisar servir o documento.
- [x] **Seed inicial de `RegraEstatutaria`, com os valores reais do estatuto vigente da ASAF**
      (cada um editável depois pela diretoria, sem deploy, se o estatuto for reformado):
      - `QUORUM_1A_CONVOCACAO` = 2/3 dos associados aptos; `QUORUM_2A_CONVOCACAO` = 1/2 + 1
        (meia hora após a 1ª); `QUORUM_3A_CONVOCACAO` = 1/4 (meia hora após a 2ª) - Art. 6º.
        Deliberação por maioria simples dos presentes aptos, **salvo exceção estatutária** - a
        dissolução (Art. 31) já é uma: 2/3 dos presentes, 1ª chamada com a totalidade dos
        associados, 2ª chamada (uma hora depois) com no mínimo 1/3. O modelo de dado não pode
        assumir "um quórum só" - precisa admitir quórum por TIPO de deliberação.
      - `PRAZO_MINIMO_CONVOCACAO_DIAS` = 15 dias de antecedência (Art. 8º) - já existe como
        `PRAZO_CONVOCACAO_DIAS` desde a v0.3.4 (seed atual "15", confirmado batendo com o
        estatuto real - nenhuma mudança de valor necessária, só a origem agora está documentada).
      - `PRAZO_ATENDIMENTO_PEDIDO_CONVOCACAO_DIAS` = 30 dias (Art. 10, Parágrafo Único) - prazo
        que o Presidente tem para convocar depois de um pedido formal de associado; findo o
        prazo sem convocação, os próprios associados podem convocar (efeito automático a
        implementar na v2.2, junto da convocação por petição do Art. 60 do CC).
      - `FRACAO_MINIMA_PETICAO_CONVOCACAO` = 1/5 dos associados ativos (Art. 8º/10 do estatuto,
        que já bate com o Art. 60 do Código Civil - v2.2 já previa isso, agora com a fonte
        estatutária confirmada, não só a legal).
      - `DURACAO_MANDATO_ANOS` = 4 anos (Art. 25/32), **sem limite de reeleição** ("podendo
        qualquer dos seus membros serem conduzidos para mandatos subsequentes" - Art. 32,
        confirma que não há trava de número de mandatos consecutivos a impor no sistema).
      - `PROCURACAO_PERMITIDA` = **não**, sempre (Art. 7º) - ver nota acima. Diferente do que a
        v2.2 original previa ("parâmetro configurável"): aqui não é configurável de fato, é
        proibição estatutária vigente - o parâmetro existe pra quando uma reforma futura mudar
        isso, não porque hoje há escolha.
      - `IDADE_MINIMA_FILIACAO_ANOS` = 18, **ou 16 com autorização expressa dos pais/responsáveis**
        (Art. 12) - **achado real, ainda não implementado em lugar nenhum**: nem
        `PropostaFiliacaoCriar` (v1.2) nem `AssociadoMasterCriar` (v1.0/v1.1) verificam idade
        mínima hoje - qualquer idade passa. Pendência **movida para a FASE 1/v1.2** (2026-09-15,
        onde o código de verdade mora - `app/routers/filiacao.py`), já que a v2.1 (FASE 2) tratou
        de mandato/cargo, não de filiação: conectar aqui (checar `data_nascimento` contra
        `IDADE_MINIMA_FILIACAO_ANOS`, exigindo referência de autorização do responsável quando for
        o caso de 16-17 anos - mesmo padrão de `autorizacao_responsavel_referencia` já usado no
        voluntariado, v1.6).
      - `QTD_SOCIOS_PROPONENTES_FILIACAO` = 3 (Art. 12, Parágrafo Único, VI: "apresentar o pedido
        de adesão por escrito, devendo ser proposto por 03 (três) sócios") - **achado real, ainda
        não implementado**: `PropostaFiliacaoCriar` (v1.2) não pede nem guarda nenhum
        proponente. Pendência **movida para a FASE 1/v1.2** (2026-09-15) agora que
        `RegraEstatutaria` já existe (v2.0): a filiação passa a exigir 3 associados identificados
        (ex.: CPF ou id_pessoa de cada um) como proponentes, gravados na proposta, conferíveis
        pela secretaria antes da aprovação - não é um checkbox "sim/não", é rastrear QUEM propôs.
      - `QTD_MENSALIDADES_INADIMPLENCIA_EXCLUSAO` = 6 mensalidades consecutivas em atraso é
        motivo de abertura de processo disciplinar com possível exclusão (Art. 16, §1º, V) -
        **distinto** do que já existe: `DIAS_TOLERANCIA_INADIMPLENCIA` (v0.3.4) só marca a
        categoria calculada como "Inadimplente" (v1.1), nunca desliga ninguém sozinho - a
        exclusão por 6 mensalidades exige o processo disciplinar com ampla defesa (v2.7), nunca
        automática. Registrado aqui para a v2.7 conectar.
      - Cláusulas pétreas (Art. 33 - data magna 10/02, versículos-base II Crônicas 4:9-10, oração
        oficial): **não são regra operacional, são identidade institucional** - guardadas como
        texto informativo (ex.: novas chaves em `ConfiguracaoInstitucional`, categoria
        "identidade", mesmo padrão de `NOME_INSTITUICAO`), nunca como regra que bloqueia
        nenhuma ação do sistema.

#### v2.1 — Diretoria, Conselho Fiscal e mandatos

- [x] Cadastro de órgãos (Diretoria Executiva, Conselho Fiscal, Conselho Deliberativo se houver) e
      de cargos dentro de cada órgão, tudo por catálogo (v0.3) — a ASAF pode criar um conselho
      novo sem deploy.
      > Implementado com o motor de catálogo já existente (v0.3.1), sem tabela nova: catálogo
      > `orgao_direcao` (Art. 18 - Diretoria Executiva/Conselho Fiscal) novo, e `titulo_cargo`
      > (já existia) reaproveitado para os cargos. Ambos `editavel_pelo_usuario=True`.
- [x] `Mandato` (pessoa, cargo, órgão, início, fim previsto, fim efetivo, ato que originou —
      assembleia/eleição de referência) — vencimento **calculado na leitura**, nunca job/cron que
      pode falhar em silêncio.
      > `app/models/mandatos.py::Mandato` + `POST/GET /api/mandatos/`. `Mandato.vigente()` nunca
      > lê um campo "status" gravado - compara `data_inicio`/`data_fim_previsto`/`data_fim_efetivo`
      > contra o agora, sempre na leitura.
- [x] Vacância e substituição: renúncia, destituição (Art. 59, parágrafo único — exige assembleia
      especialmente convocada), impedimento temporário, com sucessão automática conforme a regra
      estatutária configurada.
      > `POST /api/mandatos/{id}/encerrar` (motivo: Renúncia/Destituição/Impedimento temporário).
      > "Sucessão automática" não virou reatribuição automática de cargo de propósito: o próprio
      > Art. 26 do estatuto diz que, sem substituto imediato, quem recompõe o órgão é a Assembleia
      > Geral Extraordinária - o endpoint detecta a vaga sem substituto vigente e registra a
      > pendência (`vaga_aberta`/`AuditLog` "VACANCIA_SEM_SUBSTITUTO"), sem convocar sozinho
      > (convocação de assembleia é v2.2, ainda não construída).
- [x] **Cargo dá permissão, automaticamente**: assumir "Tesoureiro" concede o conjunto de
      permissões do cargo enquanto o mandato estiver vigente, e as revoga na data de término, sem
      intervenção manual. Esse é o ponto que evita o problema clássico de ex-diretor com acesso
      eterno. Toda concessão/revogação vai para `AuditLog`.
      > `app.security.usuario_tem_permissao` soma, em tempo real, as permissões do nível de
      > acesso com `metadados["permissoes"]` do cargo (catálogo `titulo_cargo`) de todo mandato
      > vigente (`app/services/mandatos.py`) - nunca um campo gravado que alguém precisa lembrar
      > de atualizar, mesmo princípio de vencimento na leitura. A decisão humana que concede
      > (criar mandato) ou revoga antecipadamente (encerrar mandato) vai para `AuditLog`; o
      > vencimento natural não gera evento (não há cron) - testado em
      > `tests/test_mandatos.py::test_cargo_concede_permissao_automaticamente_e_revoga_ao_encerrar`.
- [x] Alerta automático de mandato vencendo (90/30/7 dias) para a diretoria e para a secretaria.
      > `GET /api/mandatos/vencendo?dias=90` - computado sob demanda na leitura, nunca job/cron.
- [x] Segregação de funções prevista desde aqui (quem lança financeiro não é quem aprova) —
      princípio confirmado por pesquisa de mercado como proteção nº 1 contra fraude em associações.
      > Nenhum fluxo de aprovação financeira existe ainda (FASE 3) para segregar - "previsto desde
      > aqui" quer dizer que a modelagem não impede: cada cargo já concede permissões específicas e
      > independentes (`TESOUREIRO`→`financeiro`, `CONSELHO_FISCAL`→`financeiro`+`auditoria`), e
      > `metadados` do cargo pode carregar uma futura distinção lança/aprova sem migração nova.
      > Pendência de consumo real registrada para a FASE 3, mesmo padrão de outras pendências
      > deste plano (ex.: v1.2 → FASE 2).
- [x] Categorias de associado com vantagens especiais (Art. 55 do Código Civil admite
      expressamente) — catálogo configurável, nunca hardcoded.
      > Reaproveita `OpcaoCatalogo.metadados["vantagens"]` (texto livre) no catálogo
      > `categoria_associado` já existente - editável via `PUT /api/opcoes-catalogo/{id}` mesmo
      > sendo catálogo de sistema (só criar/apagar código é bloqueado, não editar metadados).
      > Sem tabela nova; migração `f2a3b4c5d6e7` popula o valor inicial em produção.
- [x] Declaração de conflito de interesse por dirigente (parente em fornecedor, interesse em
      contrato), consultada automaticamente pelo fluxo de aprovação financeira da FASE 3.
      > `app/models/mandatos.py::DeclaracaoConflitoInteresse` + `/api/mandatos/conflitos-interesse`.
      > "Consultada automaticamente" depende do fluxo de aprovação financeira, que é FASE 3 e
      > ainda não existe - por ora só o registro e a consulta manual/via API, pendência registrada
      > para quando a FASE 3 tiver um fluxo de aprovação para consultar.

#### v2.2 — Assembleias: convocação e habilitação
>
> **Verificação contra o texto real do estatuto antes de codificar (2026-09-15, a pedido do
> usuário)**: o rascunho original desta versão previa "categoria com direito a voto" e "tempo
> mínimo de filiação" como critério de habilitados, e tratava a convocação por petição como algo
> que dependeria "da lei preencher lacuna do estatuto". Nenhuma das duas premissas resistiu à
> leitura do `ESTATUTO_ASAF.txt`: (1) a convocação por petição (1/5 dos associados) já está
> **expressa** no próprio estatuto (Art. 8º e Art. 10, Parágrafo Único), não depende da lei
> suprir lacuna nenhuma — o Art. 60 do Código Civil só reforça, não preenche vazio; (2) o
> estatuto não tem "categoria com direito a voto" nem "tempo mínimo de filiação" em lugar
> nenhum — os únicos critérios reais são Art. 13 (caput: direitos, incluindo votar/ser votado,
> "desde que em dia com suas obrigações") e Art. 4º (Assembleia formada por associados "em pleno
> gozo de seus direitos associativos"). O usuário confirmou remover as duas condições sem base
> textual. Também esclarecido: "Licenciado" (`status_arrolamento`, v1.4) **não é conceito do
> estatuto** — é recurso do próprio sistema para registrar afastamento temporário, sem decisão
> prévia sobre efeito no voto. O usuário decidiu: pedir licença é abrir mão dos direitos
> associativos enquanto durar (inclusive votar/ser votado), **independente** de o associado
> continuar em dia com a mensalidade — não é "licenciado E inadimplente que não vota", é
> licenciado que não vota, ponto.

- [x] `Assembleia` (tipo: ordinária/extraordinária, data/hora das convocações, local físico e/ou
      link remoto, pauta, status) com edital gerado a partir de modelo, respeitando o prazo mínimo
      de antecedência configurado (v2.0) — o sistema recusa convocar fora do prazo, explicando qual
      regra foi violada, com possibilidade de override registrado e justificado.
      > `app/models/governanca.py::Assembleia` (substitui o protótipo v0.1/v0.2 do mesmo nome, que
      > nunca teve migração Alembic própria - nunca existiu de fato em produção). 2ª/3ª
      > convocação (Art. 6º) calculadas na leitura a partir de `INTERVALO_ENTRE_CONVOCACOES_MINUTOS`
      > (nova `RegraEstatutaria`, v2.0), nunca gravadas. `POST /api/assembleias/{id}/convocar`
      > recusa fora do prazo (`PRAZO_CONVOCACAO_DIAS`) com a regra violada na mensagem. "Override
      > registrado e justificado" **não implementado** - pendência registrada, ninguém pediu ainda
      > um caso real que precise pular o prazo mínimo.
- [x] **Convocação por petição de associados** (Art. 60 do Código Civil: 1/5 dos associados tem
      direito de convocar assembleia) — coleta de adesão digital assinada (FASE 20), contador de
      quórum de petição em tempo real, disparo formal da convocação ao atingir o limite.
      > `PeticaoConvocacao`/`AdesaoPeticao` + `/api/peticoes-convocacao/*`. Contador de quórum em
      > tempo real (`fracao_adesao_peticao`), disparo automático ao atingir 1/5
      > (`FRACAO_MINIMA_PETICAO_CONVOCACAO`, v2.0). Depois de atingido, a Diretoria converte em
      > assembleia a qualquer momento; se `PRAZO_ATENDIMENTO_PEDIDO_CONVOCACAO_DIAS` (Art. 10,
      > Parágrafo Único) passar sem isso, qualquer aderente pode converter sozinho. "Adesão digital
      > **assinada**" ainda não - motor de assinatura é FASE 20/v20.2, que não existe; por ora a
      > adesão é só o vínculo autenticado usuário↔associado, sem assinatura criptográfica.
- [ ] Publicação do edital simultaneamente no painel, por e-mail/WhatsApp (FASE 11/v11.3) e na
      área pública do site (FASE 5), com comprovante de publicação arquivado — a prova de que a
      convocação aconteceu é tão importante quanto a convocação.
      > **Não implementado** - depende de FASE 11 (e-mail/WhatsApp) e FASE 5 (site público),
      > nenhuma das duas construída ainda. O edital já é gerado e fica disponível via API
      > (`GET /api/assembleias/{id}/edital`) - falta só publicá-lo nos canais que ainda não existem.
- [x] **Lista de habilitados calculada** (~~categoria com direito a voto~~, ~~tempo mínimo de
      filiação~~ removidos por não terem base no estatuto - ver nota acima) — congelada no momento
      da convocação, preservada como anexo imutável da assembleia. Nunca marcação manual, nunca
      recalculada depois do fato.
      > `HabilitadoAssembleia`, calculada em `calcular_lista_habilitados` só na primeira convocação
      > (idempotente - se já existe lista congelada, devolve a mesma, nunca recalcula). Critério
      > final: `calcular_categoria` (fonte da verdade, v1.1) resulta em `Ativo - Em Dia` ou `Em
      > Experiência` (Art. 12 não reconhece período de experiência, associado aprovado já é pleno)
      > → habilitado; `Ativo - Inadimplente`, `Suspenso`, `Desligado` ou `Licenciado` → não
      > habilitado, com motivo registrado. Testado (congelamento sobrevive a mudança de situação
      > depois): `tests/test_assembleia.py`.
- [x] Procuração/representação como parâmetro estatutário (`PROCURACAO_PERMITIDA`, v2.0) — **hoje
      vedada** pelo Art. 7º do estatuto real da ASAF ("é vedada a representação de um associado
      por outro mesmo que devidamente credenciado para efeito de quórum ou do voto"), então o
      sistema não constrói fluxo de upload/conferência de instrumento de procuração agora (não
      há o que conferir se é sempre proibido) — só garante que o parâmetro existe e que, se uma
      reforma futura do estatuto passar a permitir, o fluxo de upload/conferência entra sem
      precisar de outra versão nova, só ligar o parâmetro.
      > Nada novo a fazer aqui além do que a v2.0 já entregou (`PROCURACAO_PERMITIDA = "nao"`) -
      > confirmado que continua correto, sem fluxo de upload/conferência construído de propósito.

##### 🔍 Ponto de Revisão — FASE 2 (1/3, fecha v2.0–v2.2) — aplicado em 2026-09-15

Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:

- Nenhum quórum/prazo/mandato está escrito em código — todos vêm de `RegraEstatutaria` (v2.0), com teste que prova isso (mudar o parâmetro muda o comportamento sem deploy).
- Lista de habilitados a votar (v2.2) é calculada e **congelada** no momento da convocação — testar que ela não recalcula depois do fato.
- Cargo concede/revoga permissão automaticamente na data de início/fim do mandato (v2.1) — testar a revogação automática, não só a concessão.

**Checklist padrão (seção 4.1)**:

- [x] **Item 1 (implementado e testado de fato)**: v2.0-v2.2 lidas e conferidas contra o código
      real nesta revisão (`app/models/estatuto.py`, `app/services/estatuto.py`,
      `app/routers/estatuto.py`, `app/models/mandatos.py`, `app/services/mandatos.py`,
      `app/models/governanca.py`, `app/services/assembleia.py`, `app/routers/governanca.py`),
      não só relidas no texto do plano.
- [x] **Item 2 (testes automatizados existem e passam)**: `pytest tests/` — **128/128 passando**
      (110 herdados da FASE 1 + 18 novos de FASE 2: `test_regras_estatutarias.py`,
      `test_mandatos.py`, `test_assembleia.py`), confirmado rodando a suíte completa nesta
      revisão.
- [x] **Item 3 (nenhuma regra congelada violada)**: confirmado — `RegraEstatutaria`/`Mandato`/
      `Assembleia`/`PeticaoConvocacao`/`HabilitadoAssembleia` chegaram por migração Alembic, nada
      via `create_all`; toda rota nova depende de `exigir_permissao("governanca")`, nunca checagem
      de nível hardcoded.
- [x] **Item 4 (nenhum segredo exposto)**: `git status` limpo, nenhum segredo novo introduzido.
- [x] **Item 5 (AuditLog de verdade)**: confirmado no código — `registrar_auditoria` chamado em
      toda ação sensível de `estatuto.py` (REFORMA), `mandatos.py` (criação/encerramento/
      declaração de conflito) e `governanca.py` (convocação/cancelamento/petição/adesão/
      conversão em assembleia).
- [x] **Item 6 (permissão nova checada no backend)**: confirmado — `estatuto.py`, `mandatos.py` e
      `governanca.py` protegidos por `exigir_permissao("governanca")` em toda rota de escrita,
      nunca só escondido no front.
- [x] **Item 7 (nada fora de escopo adiantado)**: confirmado — pendências reais da janela (upload
      do documento do estatuto, publicação de edital em canais que não existem, assinatura digital
      de adesão, consumo de segregação de funções e conflito de interesse pela aprovação
      financeira) já estavam roteadas para as fases que as resolvem (commit `0621a1a`), nenhuma
      fingida como pronta.
- [x] **Item 8 (plano atualizado refletindo a realidade)**: sim, v2.0-v2.2 já documentadas com
      nota de verificação real na hora da implementação.
- [x] **Item 9 (suíte completa continua passando)**: mesma execução do item 2 — 128/128, nada
      anterior quebrou silenciosamente.

**Itens específicos do trecho**:

- [x] **Nenhum quórum/prazo/mandato escrito em código**: `test_mudar_parametro_muda_comportamento_
      sem_deploy` prova isso para `PROCURACAO_PERMITIDA`. **Achado real nesta revisão**:
      `gerar_edital` (`app/services/assembleia.py`) tinha os três quóruns de convocação
      ("2/3", "1/2 + 1", "1/4") **escritos direto no texto do edital**, ignorando
      `QUORUM_1A/2A/3A_CONVOCACAO` (v2.0) que já existiam semeados mas nunca eram lidos — violação
      direta deste item e do próprio docstring do módulo ("nada aqui é hardcoded"). **Corrigido
      nesta revisão**: `gerar_edital` agora lê os três parâmetros via `obter_regra_vigente`, com
      teste novo (`test_edital_le_quorum_de_regra_estatutaria_nao_de_texto_fixo`) provando que
      reformar `QUORUM_1A_CONVOCACAO` muda o texto do edital sem deploy — mesmo padrão de
      `test_mudar_parametro_muda_comportamento_sem_deploy`.
- [x] **Lista de habilitados (v2.2) congelada, não recalcula**:
      `test_convocar_assembleia_congela_lista_de_habilitados_pelo_criterio_real_do_estatuto`
      confirmado passando — muda o status de "licenciado" para fora da licença depois da
      convocação e confirma que `habilitado` continua `False` (valor congelado no momento da
      convocação), nunca recalculado pela leitura seguinte.
- [x] **Cargo concede/revoga permissão automaticamente (v2.1)**:
      `test_cargo_concede_permissao_automaticamente_e_revoga_ao_encerrar` confirmado passando —
      testa as duas pontas: `usuario_tem_permissao` retorna `True` com o mandato vigente e `False`
      depois de `POST /api/mandatos/{id}/encerrar`, sem exigir nenhum job/cron (revogação é
      computada na leitura, mesmo padrão do vencimento natural).

**Fase não bloqueada, com correção aplicada**: um achado real (quórum hardcoded no edital) foi
encontrado, corrigido e coberto por teste nesta mesma revisão — o ponto de revisão funcionou como
portão, não deixou a fase avançar com o problema em aberto. FASE 2 (1/3) liberada para v2.3-v2.5.

#### v2.3 — Condução da sessão (presencial, remota ou híbrida)
>
> **Achado real corrigido durante a implementação (2026-09-15)**: `app/services/categoria_associado.py::calcular_categoria`
> (fonte da verdade do financeiro) não tem nenhuma noção de "Suspenso (Estatuto)" - é estado só
> materializado manualmente, nunca recalculado (documentado assim de propósito desde a v1.1/v1.4:
> "NUNCA sobrescreve Suspenso ou Desligado"). A lista de habilitados da v2.2
> (`calcular_lista_habilitados`) usava `calcular_categoria` sem checar isso primeiro - um
> associado suspenso mas em dia com a mensalidade seria contado como habilitado, violando o
> "pleno gozo dos direitos associativos" do Art. 4º. Corrigido nesta versão (`app/services/assembleia.py`)
> e coberto por teste de regressão em `tests/test_assembleia.py`.

- [x] Credenciamento por QR code da carteirinha (v1.1) ou busca manual pela secretaria, com
      registro de horário de entrada e saída — quórum de instalação apurado em tempo real na tela
      da mesa, por convocação (1ª/2ª/3ª).
      > `Credenciamento` (`app/models/sessao_assembleia.py`) + `/api/assembleias/{id}/credenciamentos/*`.
      > QR reaproveita `decodificar_token_carteirinha` (v1.1) tal e qual; busca manual aceita
      > `id_associado` direto. `GET /api/assembleias/{id}/quorum` apura em tempo real qual
      > convocação (1ª/2ª/3ª) está em vigor pelo horário e se o quórum dela foi atingido, contando
      > só credenciados que também estão na lista de habilitados congelada (v2.2) - presença de
      > quem não vota nunca conta pro quórum. `avaliar_quorum_minimo` (`app/services/estatuto.py`)
      > interpreta o valor da `RegraEstatutaria` ("2/3", "1/2+1", "totalidade") sem nenhum número
      > cru no código.
- [x] Assembleia híbrida como caso de primeira classe: presença remota vale igual, com o mesmo
      credenciamento; a lista final de presença não distingue direitos, só registra a modalidade.
      > `Credenciamento.modalidade` (Presencial/Remoto) é só metadado de registro - nenhuma regra
      > de habilitação ou quórum depende dela, os dois contam igual.
- [x] Painel da mesa: pauta item a item, com controle de abertura/encerramento de votação, tempo
      de fala opcional e registro de ocorrências.
      > `ItemPauta` (Aguardando → Em discussão → Em votação → Encerrado) +
      > `/api/assembleias/{id}/itens-pauta/*`; `OcorrenciaSessao` (vinculada a um item ou solta) +
      > `/api/assembleias/{id}/ocorrencias`. "Abrir votação" aqui só troca o status do item -
      > nenhum voto é de fato contado ainda, isso é o motor da v2.4 conectando em cima deste
      > controle de estado. Sessão só aceita essas ações com `Assembleia.status = "Em andamento"`
      > (novo status, entre "Convocada" e "Realizada" - `POST /api/assembleias/{id}/abrir-sessao`
      > e `/encerrar-sessao`).
- [ ] Registro de presença final assinado eletronicamente (FASE 20) — substitui a lista de
      presença em papel para efeitos internos, mantendo o limite da v20.2.1 para ato registral.
      > **Não implementado** - depende do motor de assinatura da FASE 20/v20.2, que não existe
      > ainda. `Credenciamento` já registra entrada/saída; falta só a assinatura em si quando o
      > motor existir (pendência anotada na FASE 20/v20.2, mesmo padrão das demais).

#### v2.4 — Motor de votação
>
> **Achado real (2026-09-15)**: diferente de quórum/prazo/mandato (v2.0), `ESTATUTO_ASAF.txt`
> (Art. 1º-35) **não define empate nem impugnação de voto** - nenhum dos dois termos aparece no
> texto. `REGRA_DESEMPATE` e `PRAZO_RECURSO_IMPUGNACAO_DIAS` (novos `RegraEstatutaria`) existem
> sem `artigo_origem` de propósito, documentados como necessidade operacional (uma votação
> precisa sempre terminar nalgum resultado), não mandato estatutário - diferente de todo outro
> parâmetro semeado até aqui. "Eleição com chapas/candidatos" também não virou modelo `Chapa`
> próprio: a `opcao` do voto já aceita livremente o nome/código do candidato informado na
> abertura da votação, suficiente para eleição simples sem estrutura nova (refinamento de chapa
> registrada formalmente fica pra FASE 13, se um caso real pedir).

- [x] `Votacao` vinculada a um item de pauta, com tipo configurável: aberta/nominal, secreta,
      aclamação; e escrutínio: maioria simples, maioria absoluta, qualificado (fração
      configurável, ex. 2/3), ou eleição com chapas/candidatos.
      > `app/models/votacao.py::Votacao` + `POST /api/itens-pauta/{id}/votacoes`. Eleição com
      > candidatos coberta por `opcoes_validas` livre (ver nota acima), não por modelo de chapa.
- [x] **Quórum de instalação separado do quórum de aprovação**, ambos por item (Art. 59: eleição e
      destituição de administrador e reforma do estatuto são competência privativa da assembleia,
      com quórum qualificado definido em estatuto).
      > Quórum de INSTALAÇÃO checado na abertura de cada votação (`abrir_votacao` recusa se
      > `quorum_instalacao_atual`, v2.3, não estiver atingido no momento - snapshot gravado em
      > `Votacao.quorum_instalacao_minimo`). Quórum de APROVAÇÃO é o `escrutinio` do item
      > (maioria simples/absoluta/qualificada), sobre os votos válidos - os dois nunca se
      > confundem: dá pra instalar e não aprovar, mas nunca aprovar sem ter instalado.
- [x] Abstenção e voto em branco como categorias próprias de resultado, com regra configurável de
      entrarem ou não na base de cálculo — essa é a fonte de metade das contestações reais de
      resultado de assembleia.
      > `ABSTENCAO`/`BRANCO` sempre disponíveis como opção (não precisam ser declaradas na
      > abertura); `Votacao.considerar_abstencao_na_base` (bool, por votação) decide se entram no
      > denominador do escrutínio.
- [x] **Voto secreto de verdade**: o voto é gravado desacoplado do eleitor (tabela de votos com
      identificador aleatório + tabela separada de "quem já votou"), de forma que nem um
      administrador do sistema consiga reconstruir a associação entre pessoa e voto. Em votação
      aberta/nominal, o vínculo é registrado propositalmente e exibido na ata.
      > `ComprovanteVotoSecreto` ("quem já votou", sem opção) e `RegistroVotoSecreto` (a opção,
      > com `identificador_aleatorio` em vez de `id_associado`) são tabelas SEM NENHUMA COLUNA EM
      > COMUM - a garantia é estrutural (não existe join possível, nem por SQL direto), não só
      > convenção de código. Testado em
      > `tests/test_votacao.py::test_votacao_secreta_desacoplada_de_verdade`. `VotoAberto` liga
      > `id_associado` propositalmente para o caso aberto/nominal.
- [x] Apuração em tempo real, com resultado congelado e hash SHA-256 do conjunto de votos gerado
      no fechamento (base para a ancoragem por carimbo de tempo da v15.1.1).
      > `apurar_e_encerrar`/`_hash_resultado` (`app/services/votacao.py`) - hash sobre
      > `identificador:opcao` (secreta) ou `id_associado:opcao` (aberta) de cada voto, ordenado.
      > Testado que o hash muda se um voto for alterado depois do fechamento
      > (`test_hash_do_resultado_muda_se_um_voto_for_alterado_depois`).
- [x] Empate resolvido pela regra estatutária configurada (voto de minerva do presidente,
      candidato mais antigo, nova votação) — nunca decisão improvisada na hora.
      > Empate detectado no fechamento (`Votacao.empate=True`, `aprovado=None`, nunca decisão
      > automática fingida). `REGRA_DESEMPATE` (v2.0, sem base estatutária - ver nota acima)
      > default "NOVA_VOTACAO"; resolução de fato é sempre manual e justificada
      > (`POST /api/votacoes/{id}/resolver-empate`, `justificativa` obrigatória, vai pro
      > `AuditLog`) - o sistema não decide sozinho quem venceu um empate.
- [x] Impugnação de voto e protesto registrados vinculados ao item, com prazo de recurso.
      > `Impugnacao` (`app/models/votacao.py`) + `/api/votacoes/{id}/impugnacoes`. Prazo de
      > recurso via `PRAZO_RECURSO_IMPUGNACAO_DIAS` (v2.0, sem base estatutária específica - se
      > apoia no direito geral de recurso do Art. 13, V). Resolução exige texto de resolução,
      > auditada.

#### v2.5 — Ata, deliberações e efeitos

- [x] Ata gerada a partir dos dados da sessão (presença, pauta, votos, ocorrências) em modelo
      configurável — **não é editor de texto livre**: o corpo é montado do registro, e há espaço
      controlado para relato textual da secretaria.
      > `gerar_corpo_ata` (`app/services/ata.py`) monta o texto a partir de `Credenciamento`,
      > `ItemPauta`, `Votacao` (resultado + hash quando encerrada) e `OcorrenciaSessao` - não há
      > endpoint que edite `Ata.corpo_texto` diretamente. `Ata.relato_secretaria` é o único campo
      > de texto livre, separado do corpo montado.
- [x] Livro de atas digital: numeração sequencial contínua, imutável após assinatura, com trilha
      de auditoria. Correção posterior só por **ata de retificação**, jamais por edição do
      documento original — mesma lógica de estorno do financeiro.
      > `POST /api/atas/{id}/assinar` atribui `numero_sequencial` (contínuo,
      > `proximo_numero_ata`) e trava a ata (`status=Assinada`) - não existe rota de edição do
      > corpo depois disso, então "imutável" é estrutural, não só checagem de status.
      > `POST /api/atas/{id}/retificar` só aceita ata já assinada e cria uma NOVA `Ata`
      > (`id_ata_retificada` apontando pra original, que nunca é tocada). Testado em
      > `tests/test_ata.py::test_retificar_exige_ata_assinada_e_preserva_original`.
- [x] `Deliberacao` como registro próprio, com status de execução e responsável — assembleia que
      delibera e ninguém executa é o padrão de falha mais comum em associação. O sistema cobra:
      deliberação pendente aparece no painel da diretoria até ser concluída ou formalmente
      revogada.
      > `Deliberacao` + `GET /api/deliberacoes/pendentes` (cross-assembleia, "painel da
      > diretoria" de verdade - lista toda deliberação `Pendente` de qualquer ata).
- [x] Efeitos automáticos da deliberação quando aplicável: eleição concluída cria os `Mandato`s
      (v2.1); reforma estatutária abre a pendência de registro em cartório (v13.4) e de nova
      versão de `RegraEstatutaria` (v2.0); aprovação de contas fecha o exercício no financeiro.
      > Eleição: `concluir_deliberacao` aceita `mandatos_criar` (lista) e cria os `Mandato`s de
      > verdade, reaproveitando `criar_mandato` (v2.1) - testado que o mandato aparece em
      > `/api/mandatos/` depois. Reforma de estatuto: registra a pendência em `AuditLog` e devolve
      > nota explícita (registro em cartório + nova `RegraEstatutaria` são manuais - o sistema não
      > sabe qual parâmetro mudou só pelo texto). **Aprovação de contas fechando o exercício NÃO
      > implementado de verdade** - `Exercicio` é FASE 3/v3.0, que ainda não existe; a conclusão
      > devolve a mesma nota de pendência, sem fingir o fechamento.
- [x] Certidão de deliberação (extrato de um item específico da ata) emitida sob demanda e
      numerada — evita mandar a ata inteira para um banco que só precisa de uma linha.
      > `CertidaoDeliberacao` (`numero_sequencial` próprio, contínuo, separado do livro de atas) +
      > `POST /api/deliberacoes/{id}/certidao`.

##### 🔍 Ponto de Revisão — FASE 2 (2/3, fecha v2.3–v2.5) ✅ FECHADO (2026-09-15)

Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:

- Voto secreto (v2.4) é **de verdade** desacoplado da identidade no banco — testar que nem uma consulta SQL direta de administrador reconstrói a associação pessoa↔voto em votação secreta.
  > ✅ `ComprovanteVotoSecreto`/`RegistroVotoSecreto` sem coluna em comum (garantia estrutural, não só código) - `tests/test_votacao.py::test_votacao_secreta_desacoplada_de_verdade`.
- Ata (v2.5) é imutável após assinatura — testar que tentar editar gera erro, e que correção só é possível via ata de retificação.
  > ✅ Sem rota de edição de `Ata` assinada; retificação testada em `tests/test_ata.py::test_retificar_exige_ata_assinada_e_preserva_original` (original nunca muda de status/conteúdo).
- Apuração em tempo real fecha com hash SHA-256 do resultado — testar que o hash muda se qualquer voto for alterado depois.
  > ✅ `tests/test_votacao.py::test_hash_do_resultado_muda_se_um_voto_for_alterado_depois`.

155/155 testes passando (`pytest tests/`), migrations v2.0-v2.5 testadas isoladamente (upgrade + downgrade sobre estado do head anterior).

#### v2.6 — Conselho Fiscal como órgão com poder real no sistema

- [x] Acesso de leitura irrestrita ao financeiro (FASE 3) com registro de auditoria de consulta
      (v15.2) — o conselho precisa ver tudo, e o sistema precisa registrar que viu.
      > `GET /api/conselho-fiscal/financeiro/titulos` e `/caixa` (permissão `financeiro`, já
      > concedida a Conselho Fiscal/Diretoria/Presidente desde a v0.1.5) - cada consulta grava
      > `AuditLog` (`acao=CONSULTA_CONSELHO_FISCAL`). "Irrestrita" é sobre o dado (nada
      > escondido), não uma trava nova - a auditoria de consulta de verdade em toda a aplicação
      > (não só aqui) é v15.2, ainda não construída; esta versão só cobre o financeiro, que é o
      > que o item pedia.
- [x] Emissão de parecer sobre prestação de contas (favorável, com ressalva, contrário), vinculado
      ao exercício e obrigatório antes da assembleia de aprovação de contas.
      > `ParecerPrestacaoContas` - `ano_exercicio` é inteiro solto, não FK para um `Exercicio` de
      > verdade (FASE 3/v3.0 não existe ainda; fingir a FK seria pior que não ter). Emitir parecer
      > exige nível com `is_conselho_fiscal=True` (`usuario_e_conselho_fiscal`, segregação de
      > função: quem fiscaliza não é quem lança). "Obrigatório antes da assembleia de aprovação de
      > contas" **é travado de verdade**: `Deliberacao` tipo "Aprovação de contas" (v2.5) exige
      > `ano_exercicio` e o router recusa criar a deliberação se não existir parecer para aquele
      > ano - testado em `tests/test_conselho_fiscal.py::test_deliberacao_aprovacao_contas_exige_parecer_previo`.
- [x] Fila de questionamentos: conselheiro marca um lançamento com pergunta, tesouraria responde,
      histórico preservado — transforma controle informal em processo auditável.
      > `QuestionamentoLancamento` (abrir exige `is_conselho_fiscal`) + `RespostaQuestionamento`
      > (responder exige permissão `financeiro` - tesouraria) - cada resposta é uma linha nova,
      > nunca edição, histórico completo preservado mesmo com idas e vindas.

#### v2.7 — Disciplina (condicionada ao estatuto real da ASAF)
>
> **Achado real (2026-09-15)**: diferente do que o rascunho original temia ("estatuto vago"), o
> `ESTATUTO_ASAF.txt` trata disciplina de forma concreta - Art. 16 (motivos do §1º, ampla defesa)
> e Art. 17 (as três penas - Advertência/Suspensão/Eliminação -, a escalada automática da 4ª
> advertência, e quem decide). O único número que o estatuto de fato não define é o prazo de
> defesa - confirmado com o usuário: 15 dias (`PRAZO_DEFESA_DIAS`, `RegraEstatutaria` sem
> `artigo_origem`, mesmo padrão do empate/impugnação na v2.4). Também confirmado: processo
> **aberto** não suspende voto por si só (só a pena efetivamente aplicada); decisão do processo
> comum é por maioria da Diretoria Executiva (por analogia ao Art. 17, Parágrafo Único).

- [x] Processo administrativo com rito configurável: abertura motivada, notificação do associado
      com prazo de defesa, instrução, decisão pelo órgão competente, recurso à assembleia.
      > `ProcessoDisciplinar` + `/api/processos-disciplinares/*`. "Recurso à assembleia" não é
      > opcional - Art. 17, Parágrafo Único torna a homologação da Assembleia **obrigatória**
      > para eliminação, sempre (`AGUARDANDO_HOMOLOGACAO` → `POST .../homologar`).
- [x] Ampla defesa e contraditório como travas do fluxo (o sistema não permite decisão antes do
      prazo de defesa correr) — Art. 57 do Código Civil condiciona a exclusão a justa causa
      reconhecida em procedimento que assegure direito de defesa e de recurso, nos termos do
      estatuto.
      > `pode_julgar_agora` (`app/services/disciplina.py`) bloqueia manifestação/decisão até a
      > defesa ser apresentada OU o prazo esgotar - testado em
      > `tests/test_disciplina.py::test_nao_pode_decidir_antes_do_prazo_de_defesa_sem_defesa_apresentada`.
      > Decisão em si é colegiada (maioria da Diretoria Executiva, quórum calculado sobre
      > mandatos vigentes em `DIRETORIA_EXECUTIVA` - v2.1), e o acusado nunca vota no próprio
      > processo mesmo sendo diretor.
- [x] Efeitos automáticos: suspensão de direito de voto durante o processo se o estatuto previr,
      com reversão automática no arquivamento.
      > **Decisão do usuário tornou este efeito inaplicável de propósito**: processo aberto não
      > suspende voto (o estatuto só liga perda de direito à PENA efetivamente aplicada, Art.
      > 17), então não há "durante o processo" a reverter. O que existe: pena de Suspensão
      > materializa `status_arrolamento="Suspenso (Estatuto)"` de verdade. Reversão automática ao
      > fim do prazo **não implementada** - mesma limitação já aceita desde a v1.1/v1.4
      > (`calcular_categoria` nunca sobrescreve Suspenso, documentado como decisão, não lacuna
      > esquecida); a 4ª advertência escala para Suspensão automaticamente, isso sim (Art. 17, I).
- [x] Confidencialidade: processo disciplinar visível só para o órgão julgador e para o próprio
      interessado — nunca para a diretoria inteira por padrão.
      > `GET /api/processos-disciplinares/{id}` devolve **404** (não 403 - não revela nem que o
      > processo existe) pra quem não é o acusado nem tem permissão `governanca`. Testado em
      > `tests/test_disciplina.py::test_confidencialidade_processo_visivel_so_para_acusado_e_orgao_julgador`.
- [x] **A confirmar com o estatuto real da ASAF** antes da implementação (ver seção 8).
      > Confirmado via `ESTATUTO_ASAF.txt` (Art. 16/17) + 3 perguntas ao usuário sobre os números
      > que o estatuto não define (prazo de defesa, voto durante processo, quórum decisório).

#### v2.8 — Destinação patrimonial em caso de dissolução (Art. 61 do Código Civil)
>
> **Achado real (2026-09-15)**: o checklist original cogitava "regra de deliberação pelos
> associados, se o estatuto for silente" - o estatuto real NÃO é silente. Art. 31, Parágrafo
> Único já define o critério: bens remanescentes vão para uma entidade congênere com sede e
> atividade preponderante em Parauapebas/PA, mais de 2 anos de existência, devidamente
> credenciada pelos órgãos competentes. Não é o NOME de uma entidade fixado agora (isso só se
> escolhe no momento real da dissolução, obedecendo o critério) - é a regra que o sistema precisa
> impor na hora. O próprio Art. 31 (quórum de dissolução: totalidade/1/3, aprovação 2/3 dos
> presentes) já tinha sido semeado como `RegraEstatutaria` desde a v2.0.

- [x] Campo estatutário formal: entidade de fins não econômicos designada para receber o
      patrimônio remanescente (ou regra de deliberação pelos associados, se o estatuto for
      silente) — registro de referência ligado ao módulo de patrimônio da FASE 12/v12.4.
      > `ProcessoDissolucao.entidade_destinataria_*` (nome, CNPJ, justificativa) + três
      > confirmações obrigatórias (`confirma_sede_parauapebas`, `confirma_anos_minimos`,
      > `confirma_credenciada`) - `POST .../destinar-patrimonio` recusa (400, citando o Art. 31)
      > se qualquer uma faltar. `ANOS_MINIMOS_ENTIDADE_DESTINATARIA_PATRIMONIO` = 2, nova
      > `RegraEstatutaria` (Art. 31, Parágrafo Único) - nenhum número cru no código. Vínculo com
      > o módulo de patrimônio (FASE 12/v12.4) **pendente** - essa fase ainda não existe.
- [x] Roteiro de dissolução documentado no sistema (deliberação, liquidação, destinação, baixa
      cadastral) — espera-se nunca usar, mas a ausência disso é justamente o que trava uma
      dissolução quando ela acontece.
      > `ProcessoDissolucao` + `/api/processos-dissolucao/*` - cinco etapas sequenciais e
      > auditadas (Aberto → Deliberada → Liquidação concluída → Patrimônio destinado → Baixa
      > cadastral concluída), cada uma só aceita a partir da anterior, cancelável a qualquer
      > momento antes da baixa cadastral. "Deliberar" exige uma `Deliberacao` (v2.5) do novo tipo
      > `Dissolução` já **concluída** pela Assembleia, vinculando o processo ao registro formal
      > da decisão. Liquidação do passivo em si continua manual (registro/observação, sem
      > automação) - depende de um módulo financeiro maduro (FASE 3) que ainda não existe;
      > documentado como limitação aceita, não escondida.

#### v2.9 — Calendário institucional
>
> **Escopo ampliado a pedido do usuário (2026-09-15)**: além das obrigações de governança, o
> calendário também agrega os eventos/ações reais da associação (`ProjetoEvento`, FASE 4) - é a
> base do que a ASAF vai realizar durante o ano, não só as obrigações estatutárias. Tudo
> **calculado na leitura a partir de dado que já existe em outro módulo**, nunca duplicado: AGO
> semestral (Art. 5º, I) e eleição quadrienal (Art. 25) são as únicas datas genuinamente
> *calculadas* (nenhum registro próprio as sustenta); o resto (assembleia convocada, mandato
> vencendo, prazo de deliberação, projeto/evento) é leitura direta do que a v2.1-v2.5/FASE 4 já
> gravam. "Reuniões periódicas de diretoria e conselho" não têm cadência nenhuma no estatuto (Art.
> 20 lista competências, não frequência) - viraram categoria de evento agendável manualmente
> (`EventoCalendario`), em vez de uma regra automática inventada sem base textual.

- [x] Calendário único com obrigações recorrentes de governança (AGO anual dentro do prazo
      estatutário, prestação de contas, renovação de mandatos, reuniões periódicas de diretoria e
      conselho) gerando alertas com antecedência configurável — é o que impede a associação de
      descobrir em dezembro que devia ter feito uma assembleia em abril.
      > `GET /api/calendario/?dias_antecedencia=N` (`app/services/calendario.py::montar_calendario`)
      > agrega: AGO fevereiro/agosto calculadas (Art. 5º, I), próxima eleição calculada a partir
      > do último `Mandato` de Presidente + `DURACAO_MANDATO_ANOS` (Art. 25, reaproveita
      > `RegraEstatutaria` da v2.0 - sem mandato de Presidente registrado ainda, devolve `None`
      > em vez de inventar uma data), assembleias convocadas (v2.2), mandatos vencendo (reaproveita
      > `mandatos_vencendo`, v2.1), deliberações com prazo de execução pendente (v2.5),
      > `ProjetoEvento` (FASE 4) e `EventoCalendario` (novo, genérico). "Prestação de contas" não
      > tem data recorrente própria no estatuto - já aparece indiretamente via AGO (Art. 8º, I, c:
      > "deliberar sobre a previsão orçamentária e a prestação de contas" é competência da AGO).
      > **Pendência**: `ProjetoEvento`/`app/routers/projetos.py` ainda é protótipo v0.1/v0.2 sem
      > autenticação (mesma categoria de achado da v2.6 pro financeiro) - fora de escopo aqui,
      > corrigir é tarefa da FASE 4.

##### 🔍 Ponto de Revisão — FASE 2 (3/3 — fim, fecha v2.6–v2.9) — refeito em 2026-09-15
>
> **Nota**: este bloco já tinha sido marcado "✅ FECHADO" antes, mas só com os dois itens
> específicos abaixo verificados — sem o checklist padrão da seção 4.1 item a item, sem re-leitura
> do código real, e com um artefato de edição (linha duplicada) sobrando no texto. O usuário pediu
> para refazer por não confiar na revisão anterior. Refeito do zero nesta revisão, contra o código
> real (`app/routers/conselho_fiscal.py`, `disciplina.py`, `dissolucao.py`, `calendario.py` e os
> `services`/`models` correspondentes), não só relido no plano.

Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:

- Processo disciplinar (v2.7) bloqueia decisão antes do prazo de defesa correr — testar tentativa de decisão prematura.
- Calendário institucional (v2.9) gera alerta antes do vencimento real de uma obrigação de governança, não só na data.

**Checklist padrão (seção 4.1)**:

- [x] **Item 1 (implementado e testado de fato)**: v2.6-v2.9 lidas e conferidas contra o código
      real nesta revisão, não só relidas no texto do plano — inclusive os quatro routers inteiros
      e os services de disciplina/conselho fiscal/calendário.
- [x] **Item 2 (testes automatizados existem e passam)**: `pytest tests/` — **181/181 passando**
      (180/180 antes do achado desta revisão acrescentar um teste novo; suíte completa rodada de
      verdade nesta revisão, não só o número copiado do bloco anterior).
- [x] **Item 3 (nenhuma regra congelada violada)**: `alembic heads` mostra uma única head
      (`b0c1d2e3f4a5`), cadeia completa e linear desde v2.0 — nenhuma tabela nova via
      `create_all`. Nenhuma checagem de nível hardcoded encontrada (`grep` por
      `nivel ==`/`== "Presidente"` nos quatro módulos: só uma ocorrência, e é a comparação de
      `is_conselho_fiscal` vindo do catálogo `NivelAcesso`, não um nome cru).
- [x] **Item 4 (nenhum segredo exposto)**: `git status` limpo, nenhum segredo novo introduzido.
- [x] **Item 5 (AuditLog de verdade)**: confirmado no código — `registrar_auditoria` chamado em
      toda ação sensível: consulta do Conselho Fiscal ao financeiro (`CONSULTA_CONSELHO_FISCAL`,
      inclusive leitura, não só escrita), emissão de parecer, questionamento/resposta,
      abertura/defesa/manifestação/decisão/homologação de processo disciplinar, e cada etapa do
      roteiro de dissolução.
- [x] **Item 6 (permissão nova checada no backend)**: confirmado — Conselho Fiscal
      (`financeiro` para leitura + `is_conselho_fiscal` para emitir parecer/questionar, segregado
      de quem responde), disciplina e dissolução (`exigir_permissao("governanca")` em toda escrita)
      nunca escondidos só no front.
- [x] **Item 7 (nada fora de escopo adiantado)**: confirmado pelas próprias ressalvas já
      registradas em cada versão (vínculo com patrimônio da FASE 12, liquidação financeira manual
      até a FASE 3, `ProjetoEvento` ainda prototípico até a FASE 4) — cada uma aponta para fase
      futura, nenhuma fingida como pronta.
- [x] **Item 8 (plano atualizado refletindo a realidade)**: sim, v2.6-v2.9 já documentadas com
      nota de verificação real na hora da implementação; o bloco de revisão em si é que estava
      desatualizado (corrigido agora).
- [x] **Item 9 (suíte completa continua passando)**: mesma execução do item 2 — 181/181, nada
      anterior quebrou silenciosamente.

**Itens específicos do trecho**:

- [x] **Processo disciplinar (v2.7) bloqueia decisão antes do prazo de defesa**: confirmado —
      `pode_julgar_agora` (`app/services/disciplina.py`) trava manifestação e decisão até a defesa
      ser apresentada OU o prazo esgotar; `test_nao_pode_decidir_antes_do_prazo_de_defesa_sem_defesa_apresentada`
      e `test_defesa_apresentada_libera_julgamento_antes_do_prazo_esgotar` confirmados passando
      (as duas pontas: bloqueio e liberação antecipada por defesa apresentada).
- [x] **Calendário institucional (v2.9) alerta antes do vencimento, não só na data**: confirmado —
      `dias_restantes` calculado em toda categoria de item, `dias_antecedencia` configurável por
      query param (1-730 dias); `test_calendario_traz_as_duas_ago_estatutarias` e
      `test_calendario_ordenado_por_data` confirmados passando.

**Achado real nesta revisão**: `proximas_ago` (`app/services/calendario.py`, v2.9) tinha os meses
da AGO semestral (fevereiro/agosto, Art. 5º, I) **escritos direto em código** (`for mes in (2, 8)`)
— mesma categoria de violação já corrigida na revisão 1/3 (quórum hardcoded no edital), e do
próprio princípio de perpetuidade da v2.0 ("nenhum número estatutário fica escrito em código").
**Corrigido nesta revisão**: novo parâmetro `MESES_AGO_ESTATUTARIA` (`RegraEstatutaria`, seed em
`app/database.py`, valor real `"2,8"`, `artigo_origem` "Art. 5º, I") — sem migração nova, mesmo
padrão de todo outro parâmetro da lista (tabela genérica já existe desde v2.0, só uma linha de
seed a mais). `proximas_ago` agora lê o parâmetro via `obter_regra_vigente` em vez do literal;
teste novo (`test_ago_le_meses_de_regra_estatutaria_nao_de_texto_fixo`) prova que reformar o
parâmetro muda as AGOs do calendário sem deploy, restaurando o valor real ao final (mesmo cuidado
de isolamento de estado do teste equivalente da revisão 1/3, já que este banco de teste não faz
rollback por transação).

**Fase não bloqueada, com correção aplicada**: um achado real (meses da AGO hardcoded) foi
encontrado, corrigido e coberto por teste nesta mesma revisão. **FASE 2 (Governança) completa:
v2.0-v2.9, com as três revisões (1/3, 2/3, 3/3) aplicadas de verdade contra o código.** 181/181
testes passando (`pytest tests/`).

> **Correção registrada em 2026-09-15**: "completa" acima significava só back-end (modelo,
> endpoint, teste automatizado) - nenhuma das três revisões desta fase checou se existia tela no
> painel único, porque o item 10 do checklist de revisão (seção 4.1) não existia ainda. Não
> existe hoje nenhuma tela de Governança no painel (`/governanca` é `<EmConstrucao>`) - é
> exatamente o vácuo que a FASE 2.5 abaixo fecha, com o item 10 aplicado de verdade desta vez.

---

<a id="fase-25"></a>

### FASE 2.5 — Painel (telas reais para Associados, Governança e Financeiro)

> **Por que esta fase existe**: achado grave do usuário em 2026-09-15, no mesmo dia da v3.0. As
> FASES 1 e 2 foram declaradas concluídas com back-end pronto e testado, mas **nenhuma tela real
> no painel único** foi construída pra nenhuma delas (`/associados`, `/financeiro`, `/governanca`
> eram todos `<EmConstrucao>` até este ponto - só navegação e guarda de permissão, zero conteúdo).
> Isso violava o próprio desenho da v0.2 (cada fase deveria nascer com sua tela, não deixar pra
> depois) sem que nenhum ponto de revisão anterior pegasse isso, porque o checklist padrão nunca
> checava a experiência visual (corrigido agora, item 10 da seção 4.1).
>
> **Regra desta fase**: cada sub-versão é **uma tela ou um conjunto pequeno e coeso de telas**,
> construída, testada e **mostrada rodando** antes de começar a próxima - nunca várias telas
> escritas de uma vez só. Ordem por prioridade do usuário: Associados primeiro (é o "mega
> painel" que a secretaria usa todo dia), depois Governança (por sub-módulo, é o maior volume),
> Financeiro por último (o back-end já está pronto desde a v3.0, pode esperar a fila).
>
> A FASE 3 (Financeiro, v3.1 em diante) só continua depois do Ponto de Revisão 3/3 desta fase.

#### v2.5.1 — Associados: completar o painel (edição, foto, cargos, família) ✅ CONCLUÍDO (2026-09-15)

- [x] Editar associado (dados cadastrais + endereço), reaproveitando `PUT /api/associados/{id}`
      já existente.
- [x] Upload de foto (`POST /api/associados/{id}/foto`, já existente).
- [x] Histórico de cargos: listar, registrar posse, encerrar (`/api/associados/{id}/cargos`,
      `/api/cargos/{id}/encerrar`, já existentes).
- [x] Dependentes/família (v1.7): listar, adicionar, editar grau de parentesco, remover
      (`/api/pessoas/{id_pessoa_titular}/dependentes` e afins, já existentes).
      > Tela real em `painel.asaf.org.br/associados/{id}` (abas Dados/foto, Cargos, Família),
      > acessível pelo link "Ver / editar" na listagem (construída antes desta fase existir,
      > registrada como v3.0.2). Item 10 do checklist (seção
      > 4.1) cumprido: confirmado rodando localmente (typecheck/lint/build limpos) antes de
      > marcar `[x]`.
      > **Achado 1 (auth)**: `PUT /api/associados/{id}`, `POST /.../foto` e todo o CRUD de
      > cargos/dependentes (exceto os dois endpoints v1.7 já corrigidos antes) não tinham
      > nenhuma autenticação - mesma classe de pendência do financeiro v0.1. Corrigidos com
      > `exigir_permissao("associados")` + `registrar_auditoria`, ao mesmo tempo em que a tela
      > passou a depender deles.
      > **Achado 2 (rota nova precisou de `GET /api/associados/{id}`, que não existia)**:
      > declarada sem conversor de tipo, colidiu com `/api/associados/busca-simples` (e, cross-
      > router, com `/api/associados/exportar` em `importacao.py`) - FastAPI casa rota por
      > ordem de registro, e uma string literal bate estruturalmente no padrão genérico
      > `{id_associado}`. Corrigido com `{id_associado:int}` (conversor Starlette), que restringe
      > o padrão a dígitos - resolve de vez, não depende de ordem de declaração entre routers.
      > Pego rodando a suíte completa (item 9 do checklist) antes de fechar a versão - 5 testes
      > quebraram, todos corrigidos.
      > Testado: `pytest tests/` - 198/198 (5 novos em `tests/test_associado_detalhe.py`).
      >
      > **v2.5.1b (mesmo dia) - achado do usuário sobre arquitetura de navegação**: a barra
      > lateral listava módulo de negócio direto (`Associados`, `Financeiro`, `Governança`,
      > `Projetos`, `Auditoria`, `Acesso`) - não escala pra 20+ fases, e a página "Início" não
      > fazia nada (só mostrava nível/permissão). Corrigido: barra lateral agora só tem "Início"
      > e "Meu Perfil" (uso pessoal); "Início" (`painel/src/pages/Home.tsx`) virou o lançador de
      > módulos - grade de cards, um por módulo com permissão, igual à referência que o usuário
      > mostrou. `painel/src/lib/modulos.ts` continua o manifesto único, só muda quem o consome
      > (Home, não mais o Shell). Acrescentada também a aba "Ficha 360" no detalhe do associado
      > (`GET /api/associados/{id}/ficha-360` - endpoint da v1.5, já testado, nunca tinha tela),
      > resolvendo a pergunta concreta "a pessoa pagou a mensalidade?" sem sair do módulo.
      >
      > **v2.5.1c (mesmo dia) - módulo ganha sub-navegação própria**: um módulo aberto (ex.:
      > Associados) precisa da própria barra de funções (Listar, Novo, Importar, Gráficos,
      > Configurações), não só abas soltas numa página - decisão que vale pra todo módulo
      > futuro, por isso resolvida agora, com só um módulo real existindo, em vez de refazer a
      > cada fase nova. Primeira tentativa: `components/layout/ModuleShell.tsx`, um sub-shell
      > com mini-nav própria ao lado do conteúdo - **corrigida na v2.5.1d abaixo, no mesmo dia**,
      > por criar uma segunda coluna de navegação.
      >
      > **v2.5.1d (mesmo dia) - correção: uma barra lateral só, nunca duas**: a v2.5.1c criava
      > duas colunas de navegação lado a lado (a barra global do painel + a mini-nav do
      > `ModuleShell`) - ruim em qualquer tela, e pior no celular (a maioria de quem usa o
      > painel não tem notebook), onde viraria uma faixa horizontal rolável comendo espaço em
      > cima do conteúdo. `ModuleShell.tsx` removido. Corrigido para: a MESMA barra lateral do
      > painel (`components/layout/Shell.tsx`) fica contextual - fora de um módulo mostra
      > Início/Meu Perfil; dentro de um módulo com `itens` próprios (`lib/modulos.ts`, campo
      > `itens?: ItemModulo[]`), troca pro menu daquele módulo + um link "← Início" pra voltar.
      > Zero coluna nova, zero componente por módulo além de registrar `itens` no manifesto
      > único que já existia.
      >
      > **Decisão registrada (não construída ainda): onde vivem os catálogos editáveis**
      > (categoria de associado, estado civil, grau de parentesco, tipo de conta contábil
      > etc.). Módulo **transversal próprio** ("Configurações", card na Início, permissão a
      > definir), nunca duplicado dentro de cada módulo de negócio - mesmo catálogo usado por
      > Associados e por outro módulo não pode ter duas telas de edição divergentes. Dentro
      > dele, a sub-navegação (mesmo padrão de `itens` por módulo da v2.5.1d) agrupa por módulo
      > dono do catálogo (ex.: "Associados" → categoria/estado civil/grau de parentesco;
      > "Assembleia" → o que for catálogo de governança) - resolve exatamente o caso que o
      > usuário descreveu ("quero mexer no catálogo da assembleia, não no de associados"), sem
      > duplicar tela por módulo. Cada `Catalogo` já tem `editavel_pelo_usuario` (só os marcados
      > assim aparecem pra edição - catálogo de sistema continua fixo). Fica pendente pra uma
      > próxima versão desta fase, depois que a Governança também tiver pelo menos um módulo
      > real pra confirmar que o agrupamento por dono faz sentido na prática, não só na teoria
      > com um módulo só.
      >
      > **v2.5.1e (mesmo dia) - primeiro dashboard de módulo**: achado do usuário ("quero saber
      > quantos estão inadimplentes, não tem um gráfico"). Tela `/associados/graficos`
      > (`painel/src/pages/AssociadosGraficos.tsx`), item novo na sub-navegação do módulo -
      > 3 números-chave (total, ativos em dia, inadimplentes) + dois gráficos de barra
      > (Recharts, já era dependência do painel, nunca usada) contando por situação e por
      > categoria. **Nenhum endpoint novo**: usa o mesmo `listarAssociados()` já buscado pra
      > listagem, agregado no cliente - não há volume de associados hoje que justifique
      > agregação no backend. Cor da barra de "situação" segue o mesmo mapeamento
      > semântico já usado no resto do painel (verde = em dia, vermelho = inadimplente, âmbar =
      > suspenso), não paleta categórica nova; "categoria" usa a cor primária única, sem
      > significado de ordem entre Efetivo/Contribuinte/Fundador.

#### v2.5.2 — Governança: Assembleias e Sessão

- [x] Listar/convocar assembleia, petição de convocação, habilitação de associado.
- [x] Painel da sessão em andamento: credenciamento, itens de pauta, ocorrências.

      > **v2.5.2 (2026-09-15) - confirmado visualmente pelo usuário (item 10 do checklist).** Backend (FASE 2, v2.2/v2.3) já tinha tudo isso completo e testado desde
      > antes desta fase - `/governanca` só nunca tinha ganhado tela. Telas novas:
      > `Assembleias.tsx` (listar), `AssembleiaNova.tsx` (criar rascunho **e** converter petição
      > em assembleia - mesma tela, `?peticao=<id>` troca o endpoint de destino),
      > `AssembleiaDetalhe.tsx` (ciclo de vida completo: convocar/cancelar/abrir e encerrar
      > sessão, ver edital, contagem de habilitados), `PeticoesConvocacao.tsx` (propor, aderir,
      > converter - Art. 8º/10) e `SessaoAssembleia.tsx` (credenciamento com quórum de instalação
      > em tempo real - poll de 5s -, itens de pauta com abrir discussão/votação/encerrar,
      > ocorrências). Cada transição de tela chama exatamente o endpoint que já existia; nenhuma
      > regra nova foi inventada no painel. Módulo Governança ganhou sub-navegação própria
      > (mesmo padrão contextual de Associados, v2.5.1d) com 3 itens: Assembleias, Nova
      > assembleia, Petições de convocação.
      >
      > **Ajuste (2026-09-15) - achado do usuário: "onde fica a chamada de presença/falta?"**
      > O credenciamento JÁ É a chamada, mas a tela só mostrava quem tinha comparecido - não
      > dava pra ver quem faltava chamar. `BlocoCredenciamento` (`SessaoAssembleia.tsx`) ganhou
      > uma segunda lista ("Faltantes até agora" = habilitados da assembleia menos quem já foi
      > credenciado) com um botão de um clique pra marcar presença - sem endpoint novo, só
      > cruzando `listarHabilitados` com `listarCredenciamentos` no cliente.

#### v2.5.3b — Governança: Chamada avançada (autochamada, justificativa de falta, Minhas Assembleias)

- [x] Autochamada: associado bate a própria presença com um código gerado quando a sessão abre.
- [x] Justificativa de falta (do edital ao encerramento) - associado propõe, `governanca` decide.
- [x] Correção manual de presença pelo secretário, inclusive após a sessão encerrada.
- [x] "Minhas Assembleias" (fora do módulo Governança, junto de Meu Perfil) - histórico próprio
      de presença/falta/justificativa de cada associado.

      > **v2.5.3b (2026-09-15) - confirmado visualmente pelo usuário/revisão em 2026-09-16
      > (item 10 do checklist, ver Ponto de Revisão 1/3 abaixo).** Versão inserida fora da
      > sequência original do plano - achado do usuário ao
      > revisar v2.5.2 ("onde fica a chamada de presença, e a justificativa de quem não pôde ir?")
      > pedia mais do que UI: um conceito novo (presença/falta como estado de três valores) que o
      > backend da FASE 2 nunca teve. Decisões de desenho confirmadas com o usuário antes de
      > implementar (AskUserQuestion): (1) código único por assembleia, anunciado/projetado na
      > sala - não um código individual por associado; (2) justificativa aceita do edital
      > (`Convocada`) até o encerramento da sessão (`Realizada`); (3) presença/falta continua
      > **calculada na leitura, nunca gravada** - mesmo princípio já usado pro quórum de
      > instalação (v2.3): Presente = tem `Credenciamento`; Falta justificada = sem credenciamento
      > mas com `JustificativaFalta` aceita; Falta = sem nenhum dos dois E a assembleia já está
      > `Realizada`; Pendente = nenhum dos casos acima ainda (sessão ainda rolando).
      >
      > **Backend novo** (`app/models/chamada.py`, `app/services/chamada.py`,
      > `app/routers/chamada.py`, migração `accfd3edfd97`): `Assembleia.codigo_chamada` (gerado em
      > `abrir_sessao`, 6 dígitos, exposto só a quem tem a permissão `governanca` via
      > `GET .../codigo-chamada` - nunca no serializador geral, senão qualquer autenticado
      > descobriria o código sem estar na sala) e a tabela `justificativas_falta_assembleia`.
      > `POST .../bater-presenca` é o mesmo credenciamento de sempre, resolvido pelo token do
      > associado em vez de escolhido por quem tem a permissão `governanca`, condicionado ao
      > código bater. `POST .../credenciamentos/manual` é a correção do secretário - único
      > caminho que aceita a assembleia já `Realizada` (achado do usuário: "app pode ter falhado").
      > Justificativa lançada pelo próprio associado nasce `Pendente` (precisa de decisão);
      > lançada por quem tem `governanca` em nome de outro já nasce `Aceita` (é a mesma autoridade
      > que decidiria depois). 10 testes novos em `tests/test_chamada.py`, suíte completa (208
      > testes) verde. Migração validada manualmente (upgrade E downgrade) contra um banco
      > simulando o schema anterior, já que não há Postgres de desenvolvimento local disponível.
      >
      > **Painel**: `BlocoCodigoChamada` e a lista de faltantes com marcação manual (usa
      > `credenciar` normal se "Em andamento", `credenciarManual` se "Realizada") ficam dentro de
      > `SessaoAssembleia.tsx`; `BlocoJustificativas` fica em `AssembleiaDetalhe.tsx` (não em
      > Sessão) porque justificativa vale mesmo antes da sessão abrir; `MinhasAssembleias.tsx` é
      > tela nova, rota `/minhas-assembleias`, **fora** do módulo Governança - fica no menu global
      > ao lado de "Meu Perfil" (não atrás da permissão `governanca`), porque é o associado vendo
      > a própria ficha, não a diretoria conduzindo a assembleia de todo mundo.
      >
      > Corrigido de passagem: `listarCredenciamentos` nunca devolveu `nome_completo` (só o
      > `POST` de criação devolve) - a lista de presentes em `SessaoAssembleia.tsx` desde v2.5.2
      > estava sempre caindo no fallback "Associado #ID". Resolvido cruzando com
      > `listarAssociados` no cliente, mesmo padrão já usado pra lista de faltantes.

#### v2.5.3 — Governança: Votação

- [x] Abrir votação (aberta e secreta), acompanhar quórum e apuração em tempo real.
- [x] Impugnação de voto e resolução de empate.

      > **v2.5.3 (2026-09-15) - confirmado visualmente pelo usuário/revisão em 2026-09-16
      > (item 10 do checklist, ver Ponto de Revisão 1/3 abaixo).** Motor de votação (FASE 2,
      > v2.4) já existia completo e testado - votação
      > secreta de verdade desacoplada (`ComprovanteVotoSecreto`/`RegistroVotoSecreto` sem
      > coluna em comum, ver `app/models/votacao.py`), hash de integridade no encerramento,
      > escrutínio (maioria simples/absoluta/qualificada), impugnação e desempate. Tela embutida
      > dentro de cada item de pauta (`SessaoAssembleia.tsx`, dentro de `LinhaItemPauta`) - votação
      > pertence a um item, não é uma tela própria. "Apuração em tempo real" **não mostra
      > contagem parcial enquanto a votação está aberta** - decisão deliberada, não lacuna: o
      > próprio backend só calcula `resultado_contagem` no encerramento (nunca antes), e mostrar
      > parcial de voto secreto durante a votação quebraria o próprio sentido do sigilo (efeito
      > manada). O "tempo real" é o poll de 5s que detecta o encerramento e mostra o resultado
      > completo (contagem, vencedor, aprovado/reprovado, hash) assim que ele existe, sem precisar
      > dar F5. Ações restritas (encerrar votação, resolver empate, ver/resolver impugnações) só
      > aparecem pra quem tem a permissão `governanca` (`useMe().permissoes`) - o backend já
      > recusava de qualquer forma, isto só evita mostrar um botão que ia dar 403.

#### v2.5.4 — Governança: Atas e Deliberações

- [x] Gerar/consultar ata, deliberações vinculadas, certidão de deliberação.

      > **v2.5.4 (2026-09-16) - confirmado visualmente pelo usuário/revisão em 2026-09-16
      > (item 10 do checklist, ver Ponto de Revisão 1/3 abaixo).** Achado do usuário ao pedir
      > esta versão: como a ata não é digitada (é
      > gerada do registro da sessão - presença, pauta, votação, ocorrências, ver
      > `app/services/ata.py`), o único texto livre é `relato_secretaria` - e esse campo existia
      > no modelo desde v2.5 sem NENHUM endpoint pra escrevê-lo (gap real do backend, não do
      > painel). Adicionado agora: `PUT /api/atas/{id}/relato-secretaria`, só enquanto a ata está
      > em rascunho (depois de assinada, nunca edita - só retificação nova). 1 teste novo
      > (`test_relato_secretaria_so_edita_enquanto_rascunho`), suíte completa (209) verde.
      >
      > Tela nova `Ata.tsx` (rota `/governanca/:id/ata`, link "Ata" no detalhe da assembleia só
      > quando `Realizada` - a ata não existe antes disso): corpo gerado (texto puro, pra copiar
      > pro documento oficial - o sistema não gera `.docx`, isso foi conversado explicitamente
      > com o usuário), relato da secretaria editável em rascunho, assinar (trava e numera),
      > retificar (ata nova vinculada, nunca edição). Deliberações: registrar (tipo, texto, ano
      > de exercício quando "Aprovação de contas"), concluir (com criação de mandato quando
      > "Eleição" - único tipo com campo extra) ou revogar, emitir certidão numerada por
      > deliberação concluída.
      >
      > **Ajuste (2026-09-16) - achado do usuário: "essa ata não tem valor pra cartório, não
      > é assinatura ICP-Brasil - falta anexar o documento de verdade".** Confirmado: o registro
      > interno (`corpo_texto`, "assinar") não tem NENHUM valor cartorial. Renomeado o botão pra
      > deixar isso explícito ("Travar registro interno (numerar)", não mais "Assinar ata") e
      > acrescentado um aviso na própria tela. Adicionado o que faltava: `Ata.arquivo_documento_
      > assinado`/`numero_protocolo_cartorio`/`data_protocolo_cartorio` (migração
      > `5a24a5918625`) e `POST /api/atas/{id}/documento-assinado` (upload do PDF/foto do papel
      > de verdade, assinado fora do sistema, com o protocolo do cartório se houver) - aceita em
      > qualquer status da ata, porque o documento físico não segue o ciclo de vida interno. 3
      > testes novos, suíte completa (212) verde; migração validada (upgrade e downgrade).
      >
      > Também virou item próprio "Atas" no menu de Governança (`Atas.tsx`, rota
      > `/governanca/atas`, endpoint novo `GET /api/atas/` com dados da assembleia de origem) -
      > antes só dava pra achar a ata entrando na assembleia específica; agora tem uma listagem
      > geral, do jeito que o usuário pediu.
      >
      > **Corrigido (2026-09-16), mesmo dia - usuário pediu prioridade imediata**: o gap acima
      > (link `/uploads/...` resolvendo contra a origem errada) afetava tanto o documento da ata
      > quanto a foto do associado (v2.5.1, nunca notado até agora porque nenhuma tela mostrava
      > a foto de volta antes desta revisão). `urlArquivo()` (nova, `lib/api.ts`) prefixa
      > qualquer caminho `/uploads/...` com `VITE_API_URL` antes de virar `src`/`href` - vazio em
      > dev (o proxy do Vite já resolve), a origem da API em produção. Aplicado nos dois lugares
      > que renderizavam o campo bruto (`AssociadoDetalhe.tsx` e `Ata.tsx`) - checado que não
      > existe um terceiro lugar fazendo a mesma coisa.

##### 🔍 Ponto de Revisão — FASE 2.5 (1/3, fecha v2.5.1–v2.5.4) ✅ FECHADO (2026-09-16)

Além do checklist padrão (seção 4.1, item 10 em especial): abrir cada tela no navegador e
confirmar visualmente que carrega dado real (não place holder, não erro no console) antes de
marcar qualquer checkbox acima como `[x]`.

> **Refeito de verdade em 2026-09-16** - achado do usuário: os pontos de revisão anteriores
> desta fase vinham fechando versão com o item 10 anotado como "aguardando confirmação visual"
> e nunca voltavam pra confirmar de fato - risco real de falso positivo (rota que "existe" no
> código mas nunca foi clicada, envio que "não dá erro" mas nunca aparece de volta na tela). A
> partir desta fase, todo Ponto de Revisão exige rodar o painel de verdade (backend local +
> `npm run dev`), logar como usuário real (associado comum e administrador) e navegar por cada
> tela/rota da fase — não só ler o código.
>
> **Ambiente**: backend FastAPI + SQLite local (`DATABASE_URL` isolado, nunca o Postgres de
> produção — as credenciais em `CREDENCIAIS_AZURE.md` seguem cifradas/fora de alcance, e não
> deveriam ser usadas pra um teste exploratório de qualquer forma), `painel` com `npm run dev`
> apontando pro backend local via o proxy do Vite já existente. Dado real semeado pela API
> (nunca direto no banco): 4 associados, 1 assembleia percorrendo o ciclo completo (convocar →
> abrir sessão → credenciar/autochamada/justificativa de falta → item de pauta → votação aberta
> → impugnação → encerrar → gerar ata → relato da secretaria → deliberação (com criação de
> mandato) → certidão → upload do documento assinado), mais uma assembleia parada em `Convocada`
> e outra em `Rascunho`. Navegação automatizada com Playwright (login real por CPF/senha,
> inclusive completando o cadastro de MFA obrigatório do Presidente com um TOTP gerado de
> verdade a partir do segredo devolvido por `/auth/mfa/ativar` — não pulado), capturando
> screenshot, console do navegador e status HTTP de cada requisição em cada rota.
>
> **Confirmado rodando de verdade (sem placeholder, sem erro de console, sem 404/401
> inesperado)**: `/` (Início - grade de módulos por permissão), `/associados` (listagem com
> dado real), `/associados/{id}` e suas 4 abas (Dados+foto, Ficha 360, Cargos, Família — todas
> com dado real, incluindo a foto enviada por upload renderizando de volta corretamente),
> `/associados/graficos`, `/associados/novo`, `/associados/importar`,
> `/associados/{id}/conceder-acesso`, `/governanca` (listagem com os 3 status reais -
> Rascunho/Convocada/Realizada), `/governanca/nova` (com e sem `?peticao=<id>`, pré-preenchendo
> a pauta da petição), `/governanca/peticoes`, `/governanca/atas` (listagem geral, achado da
> v2.5.4b), `/governanca/{id}` nos três status, `/governanca/{id}/sessao` (credenciamento com
> quórum em tempo real, lista de presentes com nome completo - não mais "Associado #ID", bloco
> de faltantes com marcação de um clique), `/governanca/{id}/ata` (corpo gerado com presença,
> pauta, votação e ocorrências; relato da secretaria editável; upload do documento assinado com
> link que resolve de verdade; deliberação concluída criando o mandato; certidão emitida),
> `/minhas-assembleias` (associado comum vendo a própria presença como "Presente"/"Pendente"
> corretamente) e `/perfil`. `Enviar justificativa`, autochamada com o código da sessão e
> impugnação de voto também confirmados de ponta a ponta (chamada real à API, não só o botão
> existindo). A guarda de permissão (403 pra quem não tem `associados`/`governanca`) também
> testada com um usuário associado comum de verdade, não só lida no código.
>
> **Achado 1 (bug real, corrigido nesta revisão) - empate e impugnação de voto ficavam
> irresolvíveis depois que a sessão encerrava.** `SessaoAssembleia.tsx` só renderizava o bloco
> de pauta/votação (onde vivem o formulário de "Resolver empate" e a lista de impugnações) com
> `assembleia.status === 'Em andamento'` - status "Realizada" mostrava só a correção de
> presença. Só que `POST /api/assembleias/{id}/encerrar-sessao` nunca checou se havia votação
> empatada ou impugnação pendente antes de fechar a sessão, e `resolver-empate`/
> `impugnacoes/{id}/resolver` (`app/routers/votacao.py`) nunca exigiram a assembleia "Em
> andamento" (de propósito - Art. 13, V é direito de recurso, não trava de encerramento).
> Resultado: uma votação que terminasse empatada e cuja sessão fosse encerrada antes de alguém
> resolver o empate (cenário plausível - nada impede) ficava para sempre sem vencedor **e sem
> nenhuma tela no painel pra corrigir isso** - o próprio texto gerado da ata (pra copiar pro
> documento oficial) chegava a imprimir `vencedor: None, aprovado: None` (repr cru do Python)
> nesse caso. Reproduzido de propósito (4 associados, votação 2x2, sessão encerrada sem resolver
> o empate) pra confirmar antes de corrigir - exatamente o tipo de lacuna que motivou o usuário
> a pedir esta revisão refeita.
>
> Corrigido: `SessaoAssembleia.tsx` agora também mostra `BlocoPauta`/`BlocoOcorrencias` com a
> assembleia "Realizada" (só sem os formulários de criar item/ocorrência e sem conduzir item -
> ações que o backend mesmo recusa fora de "Em andamento"), então "Resolver empate" e a lista de
> impugnações continuam alcançáveis depois que a sessão encerra. `app/services/ata.py` formata
> `vencedor`/`aprovado` por extenso (inclusive o caso de empate ainda pendente) em vez de
> confiar no valor bruto do Python. Corrigido e **confirmado resolvendo o empate pela tela de
> verdade** (não só chamando a API): criada uma segunda votação empatada de propósito, sessão
> encerrada sem resolver, "Resolver empate" apareceu na tela `/governanca/{id}/sessao` como
> esperado, resolvido pelo formulário, resultado (`Vencedor: ... · Aprovada`) refletido na hora.
> Suíte completa do backend (212 testes) e typecheck/testes do painel seguem verdes depois da
> correção.
>
> **Item 12 cumprido (2026-09-16, mesmo dia)**: a correção foi commitada (`00783e9`), enviada a
> `origin/main` (`git log origin/main..HEAD` vazio, confirmado) e os dois deploys dispararam de
> verdade - `deploy-api.yml` (run 35101127899) e `deploy-painel.yml` (run 35101127666), ambos
> `completed`/`success`. Não aceito o check verde como prova por si só (é exatamente o tipo de
> falso positivo que este item existe pra evitar): confirmado abrindo o log do run da API e
> achando a atualização real do Container App (`az containerapp update` → nova revisão
> `asaf-api--0000043`, `provisioningState: Succeeded`), e confirmado contra
> `https://painel.asaf.org.br/version.json` (endpoint público, sem necessidade de credencial)
> devolvendo `{"commit": "00783e9", ...}` - o mesmo hash do commit que acabou de subir. A API
> ainda não tem um endpoint de versão equivalente (lacuna já registrada no item 12 da seção 4.1);
> checagem mínima aceita até isso existir foi o log da Actions confirmando a revisão nova.
>
> **Achado 2 (não é bug, achado de rigor da própria revisão)**: os dados de teste desta revisão
> usaram o **código** do catálogo (`FUNDADOR`, `SECRETARIO`, `FILHO_A`) em vez do **rótulo**
> (`Fundador`, `Secretário`, `Filho(a)`) em `categoria`/`titulo_cargo`/`grau_parentesco` -
> parecia um bug de exibição ("categoria" aparecendo em caixa alta e duplicada no gráfico de
> Associados), mas na verdade é o formulário real (`AssociadoNovo.tsx` via
> `listarOpcoesLegado`) que só manda o rótulo (`o.rotulo`) pro backend; os campos em si
> (`Associado.categoria` etc.) são texto livre sem normalização nenhuma contra o catálogo.
> Comportamento correto do sistema, registrado aqui só para não repetir o susto numa próxima
> revisão que semeie dado direto pela API.
>
> **Trava desta fase permanece de pé**: a FASE 3 continua bloqueada até o Ponto de Revisão 3/3
> (fecha v2.5.8–v2.5.10) - v2.5.5 a v2.5.10 ainda não foram construídas (checkboxes `[ ]`), então
> os Pontos de Revisão 2/3 e 3/3 não têm o que revisar ainda.

#### v2.5.5 — Governança: Mandatos, Órgãos e Conselho Fiscal

- [x] Mandatos vigentes por órgão/cargo, declaração de conflito de interesse.
- [x] Painel do Conselho Fiscal: leitura financeira auditada, pareceres, questionamentos.

      > **v2.5.5 (2026-09-16) - backend já existia completo e testado desde v2.1 (mandatos)/v2.6
      > (Conselho Fiscal, FASE 2) - só nunca tinha tela.** Telas novas: `Mandatos.tsx`
      > (`/governanca/mandatos`) - mandatos por órgão/cargo com filtro "só vigentes", registrar
      > posse, encerrar mandato (motivo do enum real do backend), e declarações de conflito de
      > interesse (declarar/listar/encerrar); `ConselhoFiscal.tsx`
      > (`/financeiro/conselho-fiscal`) - leitura irrestrita de títulos e do razão contábil,
      > fila de questionamentos por título (perguntar/responder), pareceres sobre prestação de
      > contas (listar/emitir).
      >
      > **Achado de desenho (não é bug, decisão registrada)**: apesar do changelog da fase
      > agrupar "Mandatos, Órgãos **e Conselho Fiscal**" numa versão só, as duas telas moram em
      > módulos diferentes do painel - `Mandatos.tsx` dentro de Governança (permissão
      > `governanca`, a mesma do backend), `ConselhoFiscal.tsx` dentro de Financeiro (permissão
      > `financeiro`). O nível "Conselho Fiscal" (v0.1.5) só tem `financeiro`/`auditoria`, nunca
      > `governanca` - colocar a tela do Conselho Fiscal atrás da permissão `governanca` (só
      > porque o texto do plano os agrupa) a deixaria invisível pra quem mais precisa dela,
      > exatamente o tipo de "tela existe no código mas ninguém alcança" que os itens 10/11/12
      > existem pra pegar.
      >
      > **Achado 1 (bug real, corrigido antes de marcar `[x]`)**: `Mandatos.tsx` mandava
      > `data_fim_previsto: ''`/`ato_origem: ''` pro backend quando esses campos opcionais
      > ficavam em branco (react-hook-form nunca deixa `undefined` um input registrado) -
      > `MandatoCriar.data_fim_previsto` é `Optional[date]`, e Pydantic tenta interpretar a
      > string vazia como data e falha (`"Input should be a valid date or datetime, input is too
      > short"`), bloqueando "Registrar mandato" no caso mais comum (deixar em branco pra usar a
      > duração padrão). Achado rodando o formulário de verdade no navegador (não só lendo o
      > código) - o mesmo padrão de sanitização já usado em `BlocoPauta::criarItemPauta`
      > (`v.tempo_fala_minutos || undefined`) resolveu.
      >
      > **Achado 2 (bug evitado antes de existir)**: `Decimal` do backend (`valor_original`,
      > `saldo_devedor`, `valor` de partida) serializa como número JSON **em reais**
      > (`jsonable_encoder`, confirmado empiricamente, não suposto), nunca centavos e nunca
      > string. `lib/datas.ts::formatarMoeda` espera **centavos** (divide por 100) - usá-la aqui
      > exibiria R$ 75,50 como R$ 0,50. `ConselhoFiscal.tsx` usa um formatador próprio em reais
      > em vez de reaproveitar `formatarMoeda` errado.
      >
      > **Confirmado rodando de verdade** (backend local + painel, admin real completando MFA):
      > registrar mandato (com e sem os campos opcionais), encerrar mandato pela tela, declarar
      > conflito de interesse, títulos/razão contábil do Conselho Fiscal com valor monetário
      > correto, e o erro 403 real ("Só um membro do Conselho Fiscal pode fazer isso") aparecendo
      > de forma legível quando um Presidente (sem `is_conselho_fiscal`) tenta emitir parecer -
      > o painel nunca tenta adivinhar essa marca (não existe em `/auth/me`), só mostra o erro
      > real do backend. Suíte completa do backend (212 testes), typecheck e lint do painel
      > verdes.
      >
      > **Item 12 cumprido (2026-09-16)**: commit `36f9603` enviado a `origin/main` - o deploy
      > do painel **falhou de verdade** na primeira tentativa (run 35106788225, `prettier --check`
      > reprovou os 4 arquivos novos/editados - typecheck/lint/vitest locais não cobrem
      > formatação, achado só ao olhar o log do CI, exatamente o que o item 12 existe pra pegar
      > em vez de só confiar que "rodei os testes locais" bastava). Corrigido com `npm run format`
      > (commit `b23c5c4`), reenviado, `deploy-painel.yml` (run 35107414453) verde, e
      > `https://painel.asaf.org.br/version.json` confirmado batendo com `b23c5c4` - o hash do
      > commit que de fato corrigiu o problema, não do que falhou.

#### v2.5.6 — Governança: Disciplina e Dissolução

- [x] Processo disciplinar: abertura, defesa, manifestação da diretoria, decisão.
- [x] Processo de dissolução (tela rara, mas precisa existir - Art. 31).

      > **v2.5.6 (2026-09-16) - backend já existia completo desde v2.7 (disciplina)/v2.8
      > (dissolução, FASE 2) - só nunca tinha tela.** Telas novas: `Disciplina.tsx` (abertura,
      > defesa, manifestação colegiada, decisão, homologação) e `Dissolucao.tsx` (as cinco
      > etapas sequenciais do Art. 31 - deliberar, liquidar, destinar patrimônio, baixa
      > cadastral, cancelar).
      >
      > **Achado de desenho (não é bug)**: o backend de disciplina devolve **404, nunca 403**,
      > pra quem não é `governanca` nem o próprio acusado (confidencialidade real - nem revela
      > que o processo existe). Por isso `ProcessoDisciplinarDetalhePage` mora numa rota
      > **global** (`/processos-disciplinares/:id`), fora do módulo Governança - se morasse
      > dentro de `/governanca` (permissão `governanca`), o próprio acusado nunca conseguiria
      > abrir a própria defesa. Mesmo raciocínio da v2.5.5 com o Conselho Fiscal, segunda vez
      > que esse padrão aparece nesta fase. A listagem (`GET /api/processos-disciplinares/`) já
      > se auto-filtra no backend (governanca vê tudo, associado comum só o seu) - reaproveitada
      > sem mudança nas duas rotas (`/governanca/disciplina` e `/meus-processos-disciplinares`,
      > este último um novo item global no menu, ao lado de "Minhas assembleias").
      >
      > **Achado 1 (bug real, corrigido antes de marcar `[x]`)**: mesma classe de bug do achado 1
      > da v2.5.5 (campo opcional em branco chega como valor "vazio", não ausente) - aqui com
      > `suspensao_dias` (`DecisaoExecutar`): `<input type="number">` vazio + `z.coerce.number()`
      > vira `0`, e `0` nunca passa da validação do backend (`Suspensão deve ser entre 30 e 365
      > dias`), então **toda decisão que não fosse Suspensão** (a maioria - Advertência,
      > Eliminação, arquivar) quebrava ao tentar fechar o processo. Achado rodando o fluxo
      > completo de ponta a ponta no navegador (admin abre processo → acusado apresenta defesa →
      > diretor se manifesta → admin decide), não só lendo o código - reproduzido com uma decisão
      > de Advertência real antes de corrigir. Mesmo padrão de sanitização já usado em
      > `Mandatos.tsx`/`BlocoPauta`.
      >
      > **Confirmado rodando de verdade** (backend local + painel): ciclo completo de disciplina
      > com três contas reais diferentes (admin/Presidente abre o processo; a acusada, um
      > associado comum sem permissão nenhuma, vê só o próprio processo em "Meus processos
      > disciplinares" e apresenta defesa; um diretor com mandato vigente na Diretoria Executiva
      > se manifesta; admin decide e fecha com a pena aplicada) - e o roteiro de dissolução
      > completo, todas as cinco etapas em sequência contra uma deliberação de dissolução real
      > (criada e concluída via Ata.tsx), incluindo o erro esperado ("Deliberação não
      > encontrada") ao tentar vincular um número de deliberação inexistente. Suíte completa do
      > backend (212 testes), typecheck, lint e Prettier do painel verdes.
      >
      > **Item 12 cumprido (2026-09-16)**: commit `1a9b54e` enviado a `origin/main`,
      > `deploy-painel.yml` (run 35112647000) verde de primeira (Prettier já checado local antes
      > do push, achado da v2.5.5 aplicado), e `https://painel.asaf.org.br/version.json`
      > confirmado batendo com `1a9b54e`.

#### v2.5.7 — Calendário institucional

- [x] Agenda de eventos do calendário (`app/services/calendario.py`), com alerta de vencimento.

      > **v2.5.7 (2026-09-16) - backend já existia completo desde v2.9 (FASE 2) - só nunca tinha
      > tela.** `Calendario.tsx`: lista unificada (AGO/eleição estatutária, assembleia
      > convocada, mandato vencendo, prazo de deliberação, projeto/evento, evento avulso),
      > filtro de antecedência (30/90/180/365 dias) e alerta visual por cor conforme dias
      > restantes (vermelho ≤7, âmbar ≤30). "Agendar evento" exige `governanca`.
      >
      > **Achado de desenho (não é bug)**: `GET /api/calendario/` é liberado a **qualquer**
      > usuário autenticado no backend (`get_current_user`, nunca `exigir_permissao`) - o
      > próprio código documenta o motivo ("descobrir em dezembro que devia ter feito algo em
      > abril" vale pra qualquer associado, não só pra quem administra). Por isso a tela mora
      > numa rota **global** (`/calendario`), fora do módulo Governança - **terceira vez nesta
      > fase** que esse padrão aparece (depois de Conselho Fiscal, v2.5.5, e Disciplina, v2.5.6).
      > Confirmado na prática: um associado comum sem nenhuma permissão viu o calendário
      > completo (incluindo o evento agendado pela Diretoria) e, corretamente, não viu o botão
      > "Agendar evento".
      >
      > **Confirmado rodando de verdade**: dado real agregado de dois módulos diferentes
      > (mandato vencendo em 19 dias, assembleia convocada em 25 dias) mais um evento avulso
      > agendado pela tela mesma, todos ordenados por data corretamente; testado com duas contas
      > reais (Presidente e associado comum). Suíte completa do backend (212 testes),
      > typecheck/lint/Prettier do painel verdes de primeira.
      >
      > **Item 12 cumprido (2026-09-16)**: commit `32dbb2f` enviado a `origin/main`,
      > `deploy-painel.yml` (run 35128274204) verde, e
      > `https://painel.asaf.org.br/version.json` confirmado batendo com `32dbb2f`.

##### 🔍 Ponto de Revisão — FASE 2.5 (2/3, fecha v2.5.5–v2.5.7) ✅ FECHADO (2026-09-16)

Mesmo checklist do ponto 1/3.

> **Padrão que se repetiu três vezes nesta faixa (v2.5.5/v2.5.6/v2.5.7)**: um endpoint de
> leitura liberado no backend a um público mais amplo do que `governanca` (Conselho Fiscal,
> confidencialidade de disciplina pro próprio acusado, calendário pra qualquer associado) exige
> uma rota do painel FORA do módulo cuja permissão bloquearia esse público. Registrado aqui como
> item de atenção pra fases futuras: ao construir uma tela nova, checar sempre a permissão REAL
> do endpoint (`Depends(get_current_user)` vs `Depends(exigir_permissao(...))`), nunca só a
> agrupação temática do plano - a mesma armadilha já apareceu três vezes seguidas.

#### v2.5.7b — Módulo Configurações (catálogos editáveis por módulo)

- [x] Módulo transversal Configurações: edita os catálogos (categoria, status, motivos, tipos)
      usados pelos módulos de negócio - decisão registrada desde a v2.5.1, construída agora que
      Governança tem módulos reais o bastante pra confirmar o agrupamento por dono na prática.
- [x] Permissão de gerenciamento por catálogo (não mais só `gerenciar_acesso` pra tudo).

      > **v2.5.7b (2026-09-16) - achado do usuário ao pedir esta versão**: "o secretário
      > (permissão `associados`) não precisa mexer no financeiro, só no que é dele" - o backend
      > de catálogo (`Catalogo`/`OpcaoCatalogo`, v0.3.1) sempre exigiu `gerenciar_acesso` pra
      > **qualquer** opção de **qualquer** catálogo, mesmo pra ajustar a categoria de associado -
      > a mesma permissão de Níveis e permissões, bem mais ampla do que o necessário.
      >
      > **Correção de backend (não só tela nova)**: `Catalogo.permissao_gerenciamento` (migração
      > `75fa21fb920d`) - cada catálogo declara o módulo dono (`associados`, `governanca`,
      > `financeiro`, `projetos`; `None` = catálogo transversal/de sistema, ex.:
      > `status_arrolamento`, continua só `gerenciar_acesso`). `_exigir_permissao_catalogo`
      > (`app/routers/core.py`) substitui a permissão fixa nos três endpoints de escrita de
      > opção (criar/editar/excluir): quem tem a permissão do módulo dono OU `gerenciar_acesso`
      > (sempre, como reforço - nunca como único caminho) pode gerenciar. `seed_catalogos()`
      > (banco novo) e a migração (banco existente) preenchem o mesmo valor por catálogo, mesmo
      > raciocínio de sempre nesta base de código (os dois caminhos têm que chegar no mesmo
      > resultado). Migração validada manualmente (upgrade e downgrade, com dado real simulado -
      > sem Postgres de desenvolvimento local disponível).
      >
      > **Achado 2 (bug de segurança real, corrigido com prioridade)**: `POST /api/opcoes/{tipo}`
      > e `PUT /api/opcoes/{id}` (rotas legadas de compatibilidade v0.1/v0.2, ainda vivas e
      > gravando de verdade em `OpcaoCatalogo`) **nunca tiveram nenhuma checagem de autenticação**
      > - qualquer requisição não autenticada conseguia criar/alterar opção de catálogo real em
      > produção. Achado ao revisar o motor de catálogo pra construir esta versão, não relatado
      > pelo usuário - corrigido imediatamente (item 4 do checklist padrão: nada grava sem
      > autenticação), nunca deixado como estava só porque "ninguém usa mais essa rota" (ela
      > seguia exposta e funcional). Ambas agora exigem login e passam pela mesma
      > `_exigir_permissao_catalogo`.
      >
      > **Painel**: `Configuracoes.tsx`, rota **global** (`/configuracoes`, fora de qualquer
      > módulo) - mesmo padrão de Conselho Fiscal/Disciplina/Calendário (v2.5.5-v2.5.7): a tela
      > não trava atrás de uma permissão única, ela mesma filtra os catálogos que o usuário logado
      > pode ver/gerenciar (por `permissao_gerenciamento` cruzado com `useMe().permissoes`), com
      > "Nenhuma configuração disponível" pra quem não tem nenhuma permissão de módulo. Layout em
      > duas colunas (lista de catálogos agrupada por módulo dono à esquerda, opções do catálogo
      > selecionado à direita); catálogo de sistema mostra aviso e nunca oferece "Nova opção",
      > só editar/desativar/reativar o que já existe (o backend também recusa criar).
      >
      > **Confirmado rodando de verdade com duas contas reais**: Presidente (`gerenciar_acesso`)
      > vê todos os grupos, inclusive Sistema; uma secretária de teste com **só** a permissão
      > `associados` (nível criado na hora, nunca `gerenciar_acesso`) via só o grupo Associados -
      > Governança/Financeiro/Projetos/Sistema corretamente ausentes da lista dela. Adicionar,
      > editar e desativar opção testados pela tela de verdade. 6 testes novos de backend
      > (`tests/test_catalogos_permissao.py` - permissão do módulo dono basta, permissão de outro
      > módulo não basta, `gerenciar_acesso` sempre funciona, as duas rotas legadas exigem login),
      > suíte completa (218 testes), typecheck/lint/Prettier do painel verdes.

      > **Item 12 cumprido (2026-09-16)**: commit `dc5e033` em `origin/main`. Este é o primeiro
      > deploy da FASE 2.5 com migração Alembic real contra o Postgres de produção (`75fa21fb920d`)
      > - log confirma `Running upgrade 5a24a5918625 -> 75fa21fb920d` com `Context impl
      > PostgresqlImpl`. `deploy-api.yml` (run 35133280537) verde, com nova revisão
      > `asaf-api--0000044` e `provisioningState: Succeeded` confirmados no próprio log (não só o
      > check verde do Actions). `deploy-painel.yml` (run 35133280579) verde, e
      > `https://painel.asaf.org.br/version.json` confirmado batendo com `dc5e033`.

#### v2.5.8 — Financeiro: Plano de Contas, Fornecedores e Exercícios

- [x] Plano de Contas (listar, cadastrar, editar) com os cinco tipos reais (v3.0).
- [x] Fornecedores (listar, cadastrar, editar).
- [x] Exercícios contábeis (listar, abrir, fechar).

      > **v2.5.8 (2026-09-16)**: backend já existia inteiro (v3.0) - `PlanoDeContas`,
      > `Fornecedor`, `Exercicio` (`app/models/financeiro.py`), todos atrás de
      > `exigir_permissao("financeiro")`, a mesma já usada por `/financeiro` no painel. Só faltava
      > a tela; nenhum caso desta vez do padrão "permissão real mais ampla que a rota" que se
      > repetiu 4x nas versões anteriores.
      >
      > **Detalhe que exigiu checar o backend antes de escrever o `<select>`**: `PlanoDeContas.tipo`
      > guarda o RÓTULO do catálogo `tipo_conta_contabil` ("Ativo", "Despesa", "Patrimônio
      > Líquido"...), nunca o código técnico - confirmado em
      > `app/services/contabilidade.py::NATUREZA_POR_TIPO` e nos testes de backend, que só usam os
      > rótulos. O `<select>` usa `o.rotulo` como `value`, não `o.codigo`.
      >
      > **Achado real (ambiente de dev, não produção), corrigido antes de continuar**: `POST
      > /plano-contas/` e `POST /fornecedores/` são as únicas duas rotas de escrita do backend que
      > vivem fora de `/api` (compatibilidade de URL antiga). O proxy do Vite
      > (`painel/vite.config.ts`) só conhecia `/auth`, `/uploads`, `/api`, `/carteirinha` - sem uma
      > entrada pra essas duas, toda tentativa de criar conta/fornecedor em dev local batia 404 na
      > própria página do Vite, nunca chegava no backend. Em produção nunca apareceria (o build usa
      > `VITE_API_URL` absoluto, sem proxy - confirmado em `deploy-painel.yml`), mas travava
      > qualquer teste ou desenvolvimento local dessas duas telas. Corrigido adicionando as duas
      > rotas ao proxy.
      >
      > **Confirmado rodando de verdade** (Presidente, `financeiro` incluso): Plano de Contas -
      > criar conta, editar descrição, código contábil duplicado recusado com a mensagem real do
      > backend. Fornecedores - criar, editar telefone, CNPJ duplicado recusado com a mensagem
      > real. Exercícios - abrir 2026, tentar abrir um segundo enquanto o primeiro está aberto
      > (recusado com a mensagem real da regra de negócio "só um exercício aberto por vez"),
      > fechar 2026, abrir 2027 com sucesso depois de fechado. Typecheck/lint/Prettier/vitest do
      > painel verdes, suíte de backend (218 testes) intacta - versão sem alterações de backend.

      > **Item 12 cumprido (2026-09-16)**: commit `456814b` em `origin/main`. Só `painel/**` mudou
      > nesta versão (backend já existia) - só `deploy-painel.yml` disparou (run 35138085475),
      > confirmado verde, e `https://painel.asaf.org.br/version.json` batendo com `456814b`.

#### v2.5.9 — Financeiro: Títulos e baixa

- [x] Lançar título (a pagar/a receber), listar com filtro por tipo/status.
- [x] Baixar título (com conta de contrapartida), refletindo o saldo restante.

      > **v2.5.9 (2026-09-16)**: backend já existia inteiro (v2.6/v3.0) - `TituloFinanceiro`,
      > `LancamentoContabil`/`PartidaContabil` (`app/models/financeiro.py`), atrás de
      > `exigir_permissao("financeiro")`. Tipos novos e dedicados no painel (`TituloFinanceiro`,
      > não reaproveita o `TituloFinanceiroCF` do Conselho Fiscal) - o endpoint de gestão
      > (`GET /api/titulos/`) já devolve `conta_contabil`/`beneficiario` resolvidos como texto,
      > formato diferente do endpoint de leitura do CF (que devolve ids crus).
      >
      > **Achado do próprio schema (não coberto por teste de backend), documentado em vez de
      > "descoberto quebrando algo"**: `TituloCriar.id_associado`/`id_fornecedor` não são
      > mutuamente exclusivos no backend - dá pra mandar os dois ou nenhum sem erro 400. O painel
      > trata isso com um seletor "Sem beneficiário / Associado / Fornecedor" que só manda um dos
      > dois ids (nunca os dois), evitando o caso ambíguo pela própria UI mesmo sem trava no
      > backend.
      >
      > **Achado real (dev local, mesma causa do v2.5.8), corrigido antes de continuar**: `POST
      > /titulos/` e `POST /baixar-titulo/` são as mesmas duas rotas sem `/api` do padrão que já
      > tinha aparecido em Plano de Contas/Fornecedores - faltavam no proxy do Vite. Adicionadas
      > junto.
      >
      > **Confirmado rodando de verdade** (Presidente, `financeiro` incluso): título "A Pagar" com
      > fornecedor beneficiário e título "A Receber" com associado beneficiário, ambos criados;
      > conta contábil de tipo incompatível com o tipo do título recusada com a mensagem real do
      > backend ("precisa ser uma conta do tipo Despesa"); filtro por tipo funcionando; baixa
      > parcial (R$ 250,00 → paga R$ 100,00 → saldo R$ 150,00) refletindo o saldo restante
      > corretamente; baixa sem exercício aberto recusada com a mensagem real da regra de negócio;
      > formulário de baixa bloqueia no próprio painel se a conta de contrapartida não for
      > selecionada. Typecheck/lint/Prettier/vitest do painel verdes, suíte de backend (218
      > testes) intacta - versão sem alterações de backend.

      > **Item 12 cumprido (2026-09-16)**: commit `fea7fce` em `origin/main`. Só `painel/**` mudou
      > (backend já existia) - só `deploy-painel.yml` disparou (run 35142249119), confirmado
      > verde, e `https://painel.asaf.org.br/version.json` batendo com `fea7fce`.

#### v2.5.10 — Financeiro: Razão Contábil

- [x] Extrato de lançamentos em partida dobrada (débito/crédito por linha).
- [x] Estornar lançamento, com motivo.

      > **v2.5.10 (2026-09-16)**: backend já existia inteiro (v3.0) - `GET /api/livro-caixa/`
      > (extrato + saldo em contas Ativo) e `POST /api/lancamentos/{id}/estornar` (motivo
      > obrigatório, mínimo 5 caracteres). Fecha o módulo Financeiro desta fase. Tipos dedicados
      > no painel (`LancamentoContabil`/`PartidaContabil`, não reaproveita os `*CF` do Conselho
      > Fiscal - o endpoint de gestão devolve `id_exercicio`/`motivo_estorno`/
      > `id_lancamento_estorno`, que o CF não expõe). Lançamento é imutável por decisão do próprio
      > backend (comentário em `app/routers/financeiro.py`): nunca há editar/apagar, só estornar
      > (novo lançamento com partidas invertidas) + o original marcado "Estornado", nunca
      > removido - ambos ficam visíveis no extrato. Único endpoint desta fase que já nasceu com
      > `/api` em ambos os métodos - nenhum achado de proxy do Vite aqui (diferente de v2.5.8/
      > v2.5.9).
      >
      > **Confirmado rodando de verdade** (Presidente, `financeiro` incluso): título "A Receber"
      > criado e baixado (gera lançamento #1, débito Caixa/crédito Doações, saldo em caixa R$
      > 300,00 refletido no extrato); motivo de estorno curto recusado pela validação do próprio
      > painel ("mínimo 5 caracteres"); estorno com motivo válido cria o lançamento #2 com as
      > partidas exatamente invertidas (crédito Caixa/débito Doações), saldo em caixa volta a R$
      > 0,00, e o lançamento #1 passa a mostrar "Estornado" com o motivo e a referência ao
      > lançamento #2 - nunca desaparece do extrato. O próprio lançamento de estorno (#2) continua
      > estornável (comportamento correto do backend - nada fica definitivamente fora de auditoria).
      > Typecheck/lint/Prettier/vitest do painel verdes, suíte de backend (218 testes) intacta -
      > versão sem alterações de backend.

      > **Item 12 cumprido (2026-09-16)**: commit `0c3b9d7` em `origin/main`. Só `painel/**` mudou
      > (backend já existia) - só `deploy-painel.yml` disparou (run 35144348463), confirmado
      > verde, e `https://painel.asaf.org.br/version.json` batendo com `0c3b9d7`.

##### 🔍 Ponto de Revisão — FASE 2.5 (3/3 — fim, fecha v2.5.8–v2.5.10) ✅ FECHADO (2026-09-16)

Mesmo checklist dos pontos anteriores. **Esta é a trava**: a FASE 3 (v3.1 em diante) só começa
depois deste ponto de revisão aplicado de verdade, com as telas de Associados, Governança e
Financeiro todas confirmadas visualmente no painel.

> Diferente das duas faixas anteriores desta fase, v2.5.8-v2.5.10 não tiveram nenhum achado do
> padrão "permissão do front mais estrita que o backend exige" (as três telas vivem, corretamente,
> dentro do módulo `/financeiro`, mesma permissão `financeiro` que o backend sempre exigiu). O
> achado recorrente aqui foi outro, mas igualmente sistemático: duas rotas de escrita legadas sem
> prefixo `/api` (`/plano-contas/`, `/fornecedores/`, depois `/titulos/`, `/baixar-titulo/`)
> faltavam no proxy de desenvolvimento do Vite - só afetava dev local (produção usa
> `VITE_API_URL` absoluto), mas travava qualquer teste real dessas telas até ser corrigido.
> Registrado como lição: ao integrar uma tela nova com uma rota de escrita legada deste backend,
> checar sempre se ela tem `/api` no path antes de assumir que o proxy já cobre.

---

<a id="fase-3"></a>

### FASE 3 — Financeiro

> Módulo mais sensível do sistema: é onde fraude acontece, é o que o Conselho Fiscal audita, e é o
> que alimenta a contabilidade (FASE 17). Duas regras estruturais valem para tudo que segue:
> **(1) nada é excluído, só estornado**; **(2) quem registra nunca é quem aprova**.
>
> **Pendência crítica registrada pela v1.1 (2026-09-13), achado ao conectar categoria calculada
> ao financeiro**: `app/routers/financeiro.py` **inteiro** (plano de contas, fornecedores,
> títulos, baixa de título, livro-caixa) não tem **nenhuma** autenticação
> (`Depends(get_current_user)`/`exigir_permissao`) nem **nenhuma** chamada a
> `registrar_auditoria` - é código do protótipo v0.1, nunca migrado quando o resto do sistema
> ganhou login (v0.1) e auditoria (v0.2.9/achado da v0.3.3). Isso é MAIS grave aqui do que em
> qualquer outro módulo dado o item 4.1 da seção 4 do plano (fases com dinheiro merecem cuidado
> extra) - hoje qualquer requisição sem token lança título, baixa pagamento e lê o livro-caixa
> inteiro. Não corrigido na v1.1 de propósito (é reforma de um router inteiro, fora de escopo de
> "cadastro de associado"; corrigir só os 2 endpoints que a v1.1 passou a chamar
> internamente - `lancar_titulo`/`baixar_titulo` - seria pior que corrigir nenhum, por deixar o
> router com posturas de segurança inconsistentes entre endpoints). **Esta fase não pode
> começar sem resolver isto primeiro** - é o item 0 de fato de qualquer v3.x daqui.
>
> **Item 0 resolvido pela v3.0 (2026-09-15)**: todo endpoint `/api/...` e de escrita de
> `app/routers/financeiro.py` agora exige `Depends(exigir_permissao("financeiro"))` e grava
> `registrar_auditoria` em toda operação de escrita, mesmo padrão de
> `app/routers/conselho_fiscal.py`. As páginas HTML `/admin/...` deste router continuam sem
> `Depends` de auth de propósito - mesma convenção já usada em `admin_secretaria`
> (`app/routers/associados.py`): são UI legada substituída pelo painel React (v0.2), sem como
> anexar Bearer token a uma navegação de página; a proteção real está nas rotas `/api/...` que
> essas páginas chamam via fetch. Ainda pendente para v3.3: "quem registra nunca é quem aprova"
> como segregação de função checada no endpoint (hoje só a permissão de módulo é checada).

#### v3.0 — Fundamentos contábeis do módulo ✅ CONCLUÍDO (2026-09-15)
>
> **Revisão de desenho (2026-09-15, mesmo dia)**: a primeira implementação usava um par
> origem/destino por transação ("partida dobrada simplificada"). Rejeitada antes de fechar a
> versão: não é partida dobrada de verdade (não valida natureza da conta, não soma zero, não
> suporta rateio em N contas) e o financeiro é o módulo que mais precisa de rigor real, não de
> atalho. Redesenhado para o modelo abaixo antes de qualquer dado ter sido gravado em produção.

- [x] Lançamento em **partida dobrada real**: todo `LancamentoContabil` (cabeçalho) tem N
      `PartidaContabil` (linhas de Débito/Crédito), com a soma dos débitos sempre igual à soma
      dos créditos - validado em `app/services/contabilidade.py::criar_lancamento`, nunca
      confiado a quem chama. Suporta desde 2 linhas (baixa simples) até rateio em várias contas
      na mesma operação, o que torna a exportação para a contabilidade (FASE 17) direta em vez de
      reconstruída depois.
      > Cada `PlanoDeContas` tem um `tipo` de um dos cinco tipos contábeis reais (Ativo, Passivo,
      > Patrimônio Líquido, Receita, Despesa - catálogo `tipo_conta_contabil` ampliado), do qual
      > deriva a natureza devedora/credora (`NATUREZA_POR_TIPO`, adiantado da v3.1 de propósito -
      > sem isso débito/crédito não tem como ser validado de verdade). `lancar_titulo` exige que
      > a conta do título seja do tipo certo (Despesa para "A Pagar", Receita para "A Receber");
      > `baixar_titulo` exige que a contrapartida seja Ativo (Caixa/Banco - `ContaFinanceira`
      > formal ainda é v3.1, até lá é uma conta comum do Plano de Contas com esse tipo).
      > Centro de Custo continua v3.1, ainda não existe.
- [x] `Exercicio` (ano contábil) com abertura/fechamento formal. Exercício fechado não aceita
      lançamento novo — ajuste só por lançamento no exercício corrente, exatamente como na
      contabilidade real.
      > `POST/GET /api/exercicios/`, `POST /api/exercicios/{id}/fechar`. Só um exercício aberto
      > por vez; `baixar_titulo`/estorno exigem exercício aberto
      > (`contabilidade.exigir_exercicio_aberto`). Cada `LancamentoContabil` já nasce com
      > `numero_sequencial` único por exercício (adiantado da v3.1 - a numeração formal "termo
      > nº" com talão físico equivalente ainda é dela; aqui é só a garantia de sequência única).
- [x] Tipos numéricos: **sempre `Numeric`/`Decimal`**, jamais `float` para dinheiro. Erro comum,
      irreversível quando descoberto tarde.
      > `valor_original`/`saldo_devedor` (títulos) e `valor` (partidas) são `Numeric(14, 2)`
      > (migração Alembic `1a735681510a`, sem dado real a preservar - módulo ainda não tinha uso
      > real dado o item 0). Schemas Pydantic usam `Decimal`.
- [x] Imutabilidade: lançamento registrado nunca é editado nem apagado. Correção = estorno
      motivado + novo lançamento, ambos visíveis, com numeração sequencial preservada.
      > `POST /api/lancamentos/{id}/estornar`: cria um novo `LancamentoContabil` com cada
      > `PartidaContabil` invertida (débito↔crédito, mesmo valor) e marca o original
      > `estornado=True` + `motivo_estorno` + `id_lancamento_estorno` - nunca edita nem apaga a
      > linha original. Numeração sequencial de ambos preservada (cada um com seu próprio
      > `numero_sequencial`, nunca reordenado nem reaproveitado).
- [x] Toda operação financeira grava `AuditLog` com valores antes/depois — sem exceção, inclusive
      para quem tem permissão máxima.
      > `registrar_auditoria` em toda escrita (plano de contas, fornecedor, título, baixa,
      > estorno, abertura/fechamento de exercício), com `dados_antes`/`dados_depois` nas edições.

#### v3.1 — Plano de contas, centros de custo e caixa ✅ CONCLUÍDO (2026-09-17)
>
> **Já entregue pela v3.0** (revisão de desenho do mesmo dia, ver nota acima): os cinco tipos
> contábeis (Ativo/Passivo/Patrimônio Líquido/Receita/Despesa) com natureza devedora/credora
> derivada, e `numero_sequencial` único por exercício em todo `LancamentoContabil`. O que resta
> aqui é hierarquia (sintética x analítica) e a separação competência x caixa — nunca reabrir a
> classificação de tipo/natureza, que já está resolvida.

- [x] `PlanoDeContas` **hierárquico** (conta sintética x analítica, com `codigo_contabil_pai`) -
      só a analítica recebe lançamento (`PartidaContabil.id_conta` deve apontar só pra folha da
      árvore) - e bloqueio de exclusão de conta com movimento.
      > `codigo_contabil_pai` (FK pra `plano_de_contas.codigo_contabil`) em
      > `app/models/financeiro.py`. `contabilidade.exigir_conta_analitica` é chamada por
      > `criar_lancamento` pra toda `id_conta` de toda partida - conta com filha (sintética)
      > nunca recebe lançamento direto, checado ali, nunca confiado a quem chama.
      > `DELETE /api/plano-contas/{id_conta}` (não existia até aqui) bloqueia exclusão de conta
      > com filha, com movimento no razão, referenciada por título ou que seja uma
      > `ContaFinanceira`. Painel: `PlanoContas.tsx` ganhou seletor de conta pai, badge
      > "Sintética" e botão Excluir.
- [x] `CentroDeCusto` ligado a projeto/evento/área (FASE 4) — permite responder "quanto custou o
      projeto X" sem planilha paralela, e alimenta a prestação de contas a doador (v12.6). Entra
      como campo opcional em `PartidaContabil` (a partida sabe a conta E o centro de custo),
      nunca como tabela paralela que pode divergir do lançamento real.
      > `CentroDeCusto` (`app/models/financeiro.py`, com `id_projeto` opcional pra `ProjetoEvento`
      > da FASE 4, ainda prototípico) + `id_centro_custo` nullable em `PartidaContabil`. CRUD em
      > `POST/GET /api/centros-custo/` e `PUT /api/centros-custo/{id}/ativo` (ativa/inativa, nunca
      > apaga). Painel: tela nova `CentrosCusto.tsx`; selecionável na baixa de título
      > (`Titulos.tsx`) e na transferência (`RazaoContabil.tsx`).
- [x] `ContaFinanceira` (caixa, conta corrente, poupança, conta de aplicação) — uma
      especialização de `PlanoDeContas` tipo Ativo. Saldo sempre calculado somando
      `PartidaContabil` daquela conta (débito soma, crédito subtrai - a mesma mecânica que já
      existe desde a v3.0 para o indicador "saldo em contas Ativo"), jamais campo de saldo
      editável.
      > `ContaFinanceira` (`app/models/financeiro.py`) referencia uma `PlanoDeContas` tipo Ativo
      > (`contabilidade.exigir_tipo_conta`, mesma trava de sempre). `contabilidade.saldo_conta`
      > generaliza o cálculo que já existia inline em `listar_livro_caixa` — nenhum campo de saldo
      > gravado. CRUD em `POST/GET /api/contas-financeiras/` (GET já devolve o saldo calculado).
      > Painel: tela nova `ContasFinanceiras.tsx`.
- [x] Data de competência **separada** da data de caixa em `LancamentoContabil` (hoje só existe
      `data_lancamento`, que é as duas coisas ao mesmo tempo) — distinção que a contabilidade
      exige e que sistemas amadores ignoram. Numeração sequencial ("termo nº") já existe desde a
      v3.0; falta só o equivalente formal ao talão físico (numeração por tipo de lançamento,
      se o costume contábil da entidade exigir).
      > `data_competencia` nova em `LancamentoContabil`; `data_lancamento` passa a ser a data de
      > CAIXA (documentado no modelo). `criar_lancamento` aceita `data_competencia`/`data_caixa`
      > opcionais (default: hoje, competência = caixa quando omitida). Migração faz backfill dos
      > lançamentos antigos (`data_competencia = data_lancamento`). Numeração formal por tipo de
      > lançamento (talão físico) **não implementada** - fica pendente pra quando a entidade
      > confirmar que o costume contábil dela exige, mesmo padrão de pendência registrada de
      > outras versões deste plano.
- [x] Anexo de comprovante obrigatório por tipo de lançamento (configurável) — despesa sem
      comprovante é a porta de entrada de todo problema de prestação de contas.
      > `contabilidade.exige_comprovante` lê `OpcaoCatalogo.metadados["exige_comprovante"]` do
      > catálogo `tipo_conta_contabil` (motor genérico da v0.3.1) - a opção DESPESA nasce com o
      > flag ligado por padrão (seed novo + migração de dado pra quem já tinha o catálogo em
      > produção), ajustável pela diretoria no admin de catálogos sem deploy. Upload em
      > `POST /api/comprovantes/` (`/uploads/comprovantes/...`, mesmo padrão de
      > `associados.py`/`ata.py`); `baixar_titulo` recusa baixa de Despesa sem comprovante.
      > Painel: upload na baixa de título (`Titulos.tsx`) e link "Ver comprovante" no extrato
      > (`RazaoContabil.tsx`, via `urlArquivo` - mesma correção da v2.5.4c, nunca caminho bruto).
- [x] Transferência entre contas como operação própria (não duas entradas soltas que podem
      divergir) — na prática já é só mais um caso de uso de
      `contabilidade.criar_lancamento` (débito na conta de destino, crédito na de origem),
      exposto como endpoint dedicado pra não exigir que quem opera monte a partida na mão.
      > `POST /api/transferencias/` (`TransferenciaCriar`) recusa origem igual a destino e chama
      > `contabilidade.criar_lancamento` com `tipo_origem="TRANSFERENCIA"`. Painel: formulário
      > "Nova transferência" em `RazaoContabil.tsx`.
>
> **Testes**: 8 casos novos em `tests/test_financeiro.py` (conta sintética recusa lançamento
> direto, exclusão bloqueada por filha/movimento, saldo de `ContaFinanceira` pela soma das
> partidas, transferência move saldo entre duas contas, centro de custo registrado na partida,
> data de competência separada da de caixa, comprovante obrigatório/aceito) - 224/224 testes da
> suíte inteira passando. Migração `5278bf9ee537` validada upgrade+downgrade contra schema
> pré-v3.1 simulado (achado corrigido nesta mesma validação: coluna JSON grava `None` como o
> literal `"null"`, não SQL `NULL` - o backfill original checava `IS NULL` e não teria pego o
> catálogo já existente em produção; corrigido pra ler em Python antes de decidir).
> Deploy confirmado em produção (`painel.asaf.org.br/version.json` = commit `6204047`,
> `api.asaf.org.br` via `deploy-api.yml`, migração Alembic aplicada em produção).

#### v3.2 — Mensalidades e cobrança recorrente ✅ CONCLUÍDO (2026-09-17, boleto pendente por decisão explícita)
>
> **Achado confirmado com o usuário nesta versão**: a ASAF não tem convênio de emissão de boleto
> com nenhum banco (código de cedente/carteira) nem orçamento para API paga de PSP/banco - só a
> própria chave Pix. Decisão explícita: implementar Pix ESTÁTICO de verdade (sem depender de
> nenhum serviço pago) e deixar emissão de boleto e confirmação automática de pagamento
> pendentes, com a mesma pendência já registrada na v3.2.1 (Pix Automático) - "quando houver
> orçamento pra convênio bancário". O fluxo real hoje é manual: o associado copia o Pix, paga,
> anexa comprovante (ou avisa que pagou) e a tesouraria confirma a baixa - nunca fingido como
> automático.

- [x] `PlanoDeContribuicao` por categoria de associado (valor, periodicidade, dia de vencimento,
      reajuste anual por índice configurável, isenção por regra) — reajuste é decisão registrada
      com data de vigência, nunca edição direta que apaga o histórico.
      > `PlanoDeContribuicao` + `ValorPlanoContribuicao` (`app/models/financeiro.py`) — valor
      > NUNCA é coluna do plano, é uma linha versionada por vigência
      > (`app/services/contribuicoes.py::valor_vigente`); reajuste (`POST
      > /api/planos-contribuicao/{id}/reajustar`) encerra a vigência anterior e cria uma linha
      > nova, nunca edita a antiga - recusa reajuste com vigência igual/anterior à atual (nunca
      > reabre um período já fechado). "Índice configurável" não veio como campo à parte -
      > `motivo_reajuste` é texto livre onde o índice usado é registrado; catálogo de índices
      > fica pendente pra se um dia a diretoria pedir automação do cálculo.
- [x] Geração de `Cobranca` em lote com prévia obrigatória (quantas, para quem, total) antes de
      efetivar — e idempotência por competência: rodar a geração duas vezes no mesmo mês nunca
      duplica cobrança.
      > Decisão de arquitetura: "Cobrança" não é tabela nova — é um `TituloFinanceiro` "A
      > Receber" gerado em lote, reaproveitando toda a baixa/estorno/auditoria que já existem
      > desde a v2.6/v3.0, nunca um conceito paralelo. `POST /api/contribuicoes/gerar-cobrancas/`
      > com `confirmar=false` (padrão) é só a prévia; `confirmar=true` grava. Idempotência
      > garantida no BANCO, não só na lógica: `UniqueConstraint(id_associado,
      > id_plano_contribuicao, competencia)` em `TituloFinanceiro` — testado rodando a geração
      > duas vezes na mesma competência (`tests/test_contribuicoes.py`).
- [x] Isenções e descontos com motivo de catálogo, prazo de vigência e aprovador registrado.
      > `IsencaoContribuicao` (motivo do catálogo `motivo_isencao_contribuicao`, novo,
      > `percentual_desconto` 0-100, vigência com `data_inicio`/`data_fim`,
      > `id_usuario_aprovador` = quem cadastrou). Aplicada automaticamente na geração de
      > cobrança - isenção de 100% nunca gera título de valor zero, some da lista.
- [x] Cobrança por família/núcleo doméstico (v1.7) quando o estatuto previr.
      > `PlanoDeContribuicao.cobranca_por_nucleo_familiar` (opcional, por plano): na geração, um
      > associado que é DEPENDENTE registrado (`DependenteFamiliar.id_pessoa_vinculada`, v1.7) de
      > outro associado titular elegível não recebe cobrança própria - só o titular é cobrado
      > (`app/services/contribuicoes.py::_titular_do_nucleo`).
- [x] PIX estático (QR code e copia-e-cola) e boleto opcional — confirmado por pesquisa como
      baseline do mercado nacional (o mercado internacional resolve por cartão; aqui é PIX/boleto
      com conciliação).
      > Pix estático implementado de verdade e sem dependência externa: `app/services/pix.py`
      > gera o payload BR Code (EMV/BACEN) completo, incluindo CRC16-CCITT-FALSE calculado
      > localmente - `GET /api/titulos/{id}/pix` devolve o "copia e cola" de um título "A
      > Receber" pendente, valor e beneficiário vindos de `ConfiguracaoInstitucional`
      > (`CHAVE_PIX`/`NOME_BENEFICIARIO_PIX`/`CIDADE_BENEFICIARIO_PIX`, três chaves canônicas
      > novas). Painel renderiza o QR com `qrcode.react` (já usado no MFA) + botão de copiar
      > (`Titulos.tsx`). **Boleto não implementado, de propósito** - ver nota da versão acima
      > (sem convênio bancário, sem orçamento pra API paga).
- [x] Conciliação manual em lote a partir de extrato (OFX/CSV/colagem), com sugestão automática de
      correspondência por valor+data+identificador e confirmação humana.
      > `app/services/conciliacao.py` faz parsing de CSV (colunas `data`/`valor`/`descricao`) e
      > OFX (extração por regex dos blocos `<STMTTRN>` - OFX é SGML, não XML bem-formado; uma
      > biblioteca dedicada não se justificava só pra isso) e sugere correspondência por valor
      > exato + data dentro de uma janela de 5 dias contra títulos em aberto. Confirmação
      > continua sempre humana - a sugestão só aponta pra tela de Títulos, nunca dá baixa
      > sozinha. "Colagem" direta de texto não implementada — só upload de arquivo.
- [x] Baixa parcial, pagamento a maior (crédito em conta do associado) e pagamento antecipado
      tratados explicitamente — são a maior fonte de divergência em cobrança recorrente.
      > Baixa parcial e pagamento antecipado já funcionavam de forma genérica desde a v3.0/v2.6
      > (`baixar_titulo` sempre aceitou `valor_pago` menor que o saldo devedor, e nunca checou
      > data de vencimento) - só confirmados e testados explicitamente agora, nenhum código novo.
      > Pagamento a maior é novo: `CreditoAssociado` (`app/models/financeiro.py`) nasce do
      > excedente de uma baixa (`id_conta_contabil_adiantamento`, Passivo, exigido no momento -
      > `baixar_titulo` recusa valor pago maior que o saldo sem essa conta) e é consumível depois
      > em qualquer título futuro do mesmo associado (`POST /api/creditos-associado/aplicar`),
      > sempre com lançamento contábil de verdade (nunca um número solto numa tabela).
>
> **Testes**: 7 casos novos em `tests/test_contribuicoes.py` (valor vigente e reajuste preserva
> histórico, geração idempotente por competência, isenção reduz/zera cobrança, cobrança por
> família pula dependente, Pix copia-e-cola com estrutura EMV válida, pagamento a maior gera e
> aplica crédito, conciliação CSV sugere correspondência) — 231/231 testes da suíte inteira
> passando (3 asserts de contagem de configuração institucional em testes pré-existentes
> atualizados de 19 para 22, refletindo as 3 chaves novas do Pix). Migração `c24c04ccd948`
> validada upgrade+downgrade+upgrade contra schema pré-v3.2 simulado.

##### 🔍 Ponto de Revisão — FASE 3 (1/3, fecha v3.0–v3.2)

Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:

- Todo valor monetário é `Numeric`/`Decimal` — grep no código por `float` perto de campo de dinheiro, deve dar zero resultado.
- Lançamento é imutável — testar que tentar apagar/editar um lançamento já gravado falha, e que a correção é sempre estorno + novo lançamento.
- Geração de cobrança em lote (v3.2) é idempotente por competência — rodar duas vezes no mesmo mês não pode duplicar cobrança.

> **Revisado em 2026-09-17.** Checklist padrão (seção 4.1, 12 itens) + os três itens específicos
> acima, todos aplicados com evidência concreta (arquivo:linha), não por inspeção superficial:
>
> - **Item específico 1 (`float` perto de dinheiro)**: zero ocorrências em `app/models/financeiro.py`,
>   `app/schemas/financeiro.py`, `app/services/{contabilidade,contribuicoes,pix,conciliacao}.py` —
>   todo valor é `Numeric(14,2)`/`Decimal`, inclusive `percentual_desconto` da isenção.
> - **Item específico 2 (imutabilidade do lançamento)**: confirmado que não existe
>   PUT/PATCH/DELETE para `/api/lancamentos/` — só `POST .../estornar`
>   (`app/services/contabilidade.py::estornar_lancamento`), que cria um lançamento NOVO com
>   partidas invertidas e só marca `estornado`/`motivo_estorno` no original, nunca toca em
>   `valor`/partidas dele. **Lacuna de teste encontrada e fechada nesta revisão**: a suíte só
>   provava isso pela ausência de rota, nunca por uma chamada HTTP de verdade — adicionado em
>   `tests/test_financeiro.py::test_estorno_reverte_saldo_e_marca_lancamento_original_sem_apagar`
>   um PUT/PATCH/DELETE direto contra o lançamento já gravado, cada um assertando 404/405.
> - **Item específico 3 (idempotência da geração em lote)**: `UniqueConstraint` real em
>   `TituloFinanceiro(id_associado, id_plano_contribuicao, competencia)`
>   (`app/models/financeiro.py`) + checagem prévia em `gerar_cobrancas`
>   (`app/services/contribuicoes.py`) que pula quem já tem título na competência antes mesmo de
>   tentar gravar. `tests/test_contribuicoes.py::test_geracao_de_cobrancas_e_idempotente_por_competencia`
>   chama a geração duas vezes de verdade para a mesma competência e confirma que a segunda não
>   duplica.
> - **Itens 1–9 e 12 do checklist padrão**: sem violação. `AuditLog` grava toda ação sensível
>   (baixa, estorno, transferência, isenção, aplicação de crédito, cadastro de plano de
>   contas/centro de custo/conta financeira/fornecedor); toda rota nova usa
>   `Depends(exigir_permissao("financeiro"))`, nunca checagem escondida no front;
>   `DECISOES_CONGELADAS.md` sem violação (nenhuma troca de banco/framework, permissão sempre
>   dinâmica via `usuario_tem_permissao`); scan de segredo limpo nos commits do intervalo;
>   suíte completa 231/231 passando; commit que fecha a faixa (`92ec651`) está em `main` remoto,
>   `Deploy API` e `Deploy Painel` verdes para esse SHA, e `painel.asaf.org.br/version.json`
>   confirmado batendo com o commit no momento da revisão.
> - **Item 10 (tela real no painel) — bug real encontrado e corrigido na hora, antes de fechar
>   este ponto**: "Crédito de Associado" (pagamento a maior, v3.2) tinha back-end completo
>   (`CreditoAssociado`, `POST /api/creditos-associado/aplicar`) e cliente de API já pronto no
>   painel (`painel/src/lib/api.ts::listarCreditosAssociado`/`aplicarCredito`), mas **nenhuma tela
>   consumia isso** — o mesmo padrão de falha do achado de 2026-09-15 (back-end pronto, sem tela).
>   Corrigido nesta revisão: novo painel "Aplicar crédito" em `Titulos.tsx` (título "A Receber"
>   pendente com `id_associado` ganha o botão), listando os créditos disponíveis do associado e
>   aplicando contra o título escolhido. Exigiu também expor `id_associado` na resposta de
>   `GET /api/titulos/` (campo que já existia no model, só não estava sendo serializado).
> - **Item 11 (link/arquivo abre de verdade)**: nenhuma tela nova de v3.0–v3.2 usa caminho
>   relativo — comprovante de lançamento (Razão Contábil) e todo outro link a arquivo passam por
>   `urlArquivo()` (já corrigido contra a origem certa desde o achado de 2026-09-16).
> - **Atualização 2026-09-17**: fix de "Crédito de Associado" implantado (commit `42c5264`, API e
>   painel confirmados no ar via Actions verde + `version.json`). **Confirmação visual em
>   produção segue pendente** — a sessão não tem, hoje, uma ferramenta de navegador
>   interativo/logado para clicar no botão "Aplicar crédito" ela mesma (só `WebFetch`, que é
>   leitura estática, não substitui o item 10 de verdade), e vasculhar o sistema por uma chave de
>   descriptografia pra contornar isso foi corretamente bloqueado como exploração de credencial.
>   Registrado aqui em vez de fingir que foi conferido: falta o usuário (ou uma sessão com
>   ferramenta de navegador) confirmar visualmente antes deste ponto virar ✅ de fato.

#### v3.2.1 — Pix Automático → **adaptado para "Cobrança Recorrente Automática + Lembrete Pix"** (2026-09-17)
>
> **Achado confirmado com o usuário**: Pix Automático de verdade (Resolução BCB nº 402/506) exige
> integração com um banco/PSP parceiro **pago** — a associação não tem orçamento pra isso hoje.
> Em vez de deixar a versão em branco, foi desenhada em conversa com o usuário uma adaptação que
> entrega o mesmo benefício (associado não esquecer de pagar, ninguém precisar lembrar de rodar a
> cobrança manual todo mês) usando só recursos **já gratuitos**: o e-mail institucional da própria
> ASAF (`asaf@asaf.org.br`, Google Workspace — MX do domínio `asaf.org.br` já aponta pra
> `smtp.google.com`, achado confirmado direto no Azure DNS) e o cron do GitHub Actions, mesma
> infra que já roda o CI/CD.

- [x] Geração mensal automática da cobrança (`gerar_cobrancas`, já existente desde a v3.2) —
      elimina "alguém esquecer de rodar Gerar Cobranças todo mês".
- [x] Lembrete automático por e-mail com o Pix já pronto (copia e cola) alguns dias antes do
      vencimento (`DIAS_LEMBRETE_MENSALIDADE`, configurável) e no próprio dia do vencimento —
      nunca debita nada sozinho, só reduz ao máximo a fricção de pagar. Cada tipo de lembrete só
      sai uma vez por título (`LembreteMensalidadeEnviado`), mesmo se a rotina rodar de novo.
- [x] Roda como **SISTEMA** (`id_usuario=None` no AuditLog), direto contra o banco de produção —
      mesmo nível de confiança que já roda migração Alembic em produção via `DATABASE_URL` do Key
      Vault. **Decisão explícita do usuário**: nenhuma conta de usuário "fantasma" — e no fim nem
      precisou de login humano nenhum (registrar_auditoria já aceita `usuario=None`).
- [x] Credenciais SMTP (`SMTP_HOST`/`SMTP_PORTA`/`SMTP_USUARIO`/`SMTP_SENHA`/`SMTP_REMETENTE`)
      gravadas no Key Vault (`kv-asaf-arca`) pela própria sessão, com acesso Azure liberado pelo
      usuário (saiu do modo automático pra aprovar os comandos `az` um a um). Nenhum segredo novo
      pro usuário lembrar/gerenciar no dia a dia — é uma senha de app gerada uma única vez.
- [ ] v3.2 (PIX estático manual, geração por associado avulsa) continua existindo do jeito que
      está — esta adaptação não substitui, só reduz a fricção de quem já usa o fluxo mensal.
- [ ] Fica registrado para o futuro, **se e quando houver orçamento**: migrar para Pix Automático
      de verdade (ciclo de autorização, detecção de cancelamento, retentativa por saldo
      insuficiente) exatamente como descrito originalmente nesta versão — nada do desenho antigo
      foi perdido, só adiado até ter orçamento pra um PSP parceiro.

> **Verificado em produção (2026-09-17)**: rotina disparada manualmente duas vezes via
> `gh workflow run` — a primeira falhou (`ModuleNotFoundError: app`, corrigido no commit
> `9129ae7` com `PYTHONPATH=.`, mesmo motivo já documentado em `deploy-api.yml` para
> `python -m pytest`), a segunda rodou com sucesso ponta a ponta contra o Postgres de produção
> (Key Vault → `DATABASE_URL`/`SMTP_*` → `gerar_cobrancas` → `enviar_lembretes_do_dia`): 0
> cobranças novas (setembro/2026 já gerado antes) e 0 lembretes (nenhum título vencendo hoje ou
> em 5 dias no momento do teste) — comportamento correto, nenhum e-mail indevido foi disparado.
>
> **Achado durante esta versão, não específico dela**: `ConfiguracaoInstitucional` (`CHAVE_PIX`,
> `TETO_ALCADA_FINANCEIRA`, e agora `DIAS_LEMBRETE_MENSALIDADE`, entre outras) **nunca teve tela
> no painel** — só editável hoje via chamada direta à API (`PUT /api/configuracoes/{chave}`).
> Gap pré-existente desde a v0.3.4, não introduzido por esta versão, mas que se torna mais
> visível agora. Registrado aqui para uma versão futura construir a tela genérica de
> Configurações Institucionais (listar/editar por categoria) — fora do escopo deste intervalo por
> item 7 do checklist (não inflar a versão atual com um módulo à parte).

#### v3.2.2 — Inadimplência como processo, não como rótulo (2026-09-17)
>
> **Investigação antes de codar** (economizou trabalho duplicado): três dos quatro itens abaixo
> já estavam total ou parcialmente resolvidos por versões anteriores, achado confirmado lendo o
> código antes de implementar:
>
> - **"Perde direito a voto"** já existe desde a v2.2 —
>   `app/services/assembleia.py::calcular_lista_habilitados` já exclui `Ativo - Inadimplente` da
>   lista de habilitados a votar (Art. 13/4º do estatuto). Nenhuma mudança necessária.
> - **Reversão automática no pagamento** já existe desde a v1.1 —
>   `app/services/categoria_associado.py::recalcular_categoria_associado` já recalcula o status a
>   cada evento financeiro, sem exigir ação manual.
> - **Nunca exclui sozinho** já é garantido por design — a mesma função nunca toca em
>   `Suspenso`/`Desligado`, só transiciona entre estados reversíveis.
> - **"Não reserva espaço"/"não usa benefício"** não têm como ser conectados ainda — os módulos
>   de reserva de espaço e de parceiros/benefícios não existem no sistema. Registrado aqui como
>   pendência de integração futura, não uma lacuna desta versão.
>
- [x] Régua de cobrança escalonada **pós-vencimento** (`DIAS_ATRASO_LEMBRETE`, lista configurável
      de dias de atraso, ex.: "7,15,30") — soma-se ao lembrete antes/no vencimento já entregue na
      v3.2.1. Multicanal fica pra FASE 11/v11.3 (só e-mail por enquanto, mesmo canal do resto).
      Cada aviso só sai uma vez por título (`LembreteMensalidadeEnviado`).
- [x] Negociação/parcelamento de débito (`NegociacaoDivida`) — título vencido nunca é
      editado/apagado, ganha status "Renegociado" (excluído do cálculo de inadimplência) e vira
      um plano de parcelas novo, rastreável até a origem
      (`TituloFinanceiro.id_negociacao_origem`/`id_negociacao_parcela`). **Termo de confissão de
      dívida em TEXTO, não assinado eletronicamente** — assinatura eletrônica real é FASE 20,
      ainda não existe no sistema; até lá, o termo registra autoria/data e o aceite do associado
      é tratado como processo humano/presencial.
- [x] Efeitos estatutários automáticos e configuráveis: voto (já existente, ver acima) +
      reabilitação automática ao negociar (as parcelas novas vencem no futuro, então negociar já
      tira o associado de "Ativo - Inadimplente" na hora, incentivo real a regularizar).
- [x] Tratamento humano obrigatório antes de qualquer exclusão por inadimplência: já garantido
      por design (ver achado acima) — esta versão não adicionou nenhum caminho de exclusão
      automática.

> **Testes**: 5 casos novos em `tests/test_negociacao.py` (parcelamento cria títulos e reabilita
> o associado, recusa título já pago/de outro associado/já renegociado, listagem por associado) +
> 2 em `tests/test_lembretes.py` (aviso escalonado configurável, idempotência) — 249/249 testes da
> suíte inteira passando. Migração `e5f7a9c1d3b4` validada upgrade+downgrade+upgrade contra schema
> pré-v3.2.2 simulado. Painel: tela "Negociação de Dívida" (Financeiro › Negociação de Dívida) —
> confirmação visual em produção ainda pendente (mesma lacuna de ferramenta de navegador já
> registrada no Ponto de Revisão FASE 3 1/3, acima).

#### v3.2.3 — Desconto por Pagamento Antecipado em Bloco (configurável, decisão de assembleia 2026-09-17)
>
> **Pedido da diretoria (2026-09-17)**: incentivar quem paga a mensalidade adiantada, em bloco
> (ex.: semestral em janeiro/julho, ou anual), com desconto percentual. Desenhado em conversa
> nesta sessão — decisões confirmadas com o usuário antes de codar:
>
> - **Totalmente configurável** (não hardcoded): percentual de desconto, quantidade de meses do
>   bloco (semestral=6, anual=12, ou outro) e quais meses do calendário abrem a janela — tudo
>   pode mudar por decisão de assembleia sem precisar de código novo.
> - **Versionado como `ValorPlanoContribuicao`**: mudar a regra nunca edita a campanha anterior,
>   sempre cria uma vigência nova — quem já pagou um bloco fica com o percentual/meses que
>   valiam na hora, mesmo que a diretoria mude depois. Resolve a pergunta do usuário "e se eu
>   mudar em fevereiro, o que acontece com quem já pagou?" — nada, ficam com a regra antiga.
> - **Vale para todos os planos de contribuição**, sem configuração por plano (confirmado com o
>   usuário).
> - **Sempre com confirmação humana explícita** para gerar a cobrança do bloco (nunca detecção
>   automática de "associado pagou adiantado" que já mexe em lançamento sozinha) — mesmo padrão
>   de segurança de toda ação sensível a dinheiro neste projeto (baixa, conciliação, geração de
>   cobrança em lote).
> - **Um único título por bloco** (um PIX, um pagamento, um recibo — não 6 títulos separados),
>   decisão do usuário depois de entender a alternativa: com título único, o dinheiro entra
>   INTEIRO no caixa na hora da baixa (ex.: R$70 em julho aparecem no caixa em julho, não
>   fatiados até dezembro). Resolvido tecnicamente com **regime de competência x caixa** (já
>   existe desde a v3.1, `LancamentoContabil.data_competencia` vs `data_lancamento`): a baixa do
>   título-bloco credita uma conta de Passivo ("Receita Diferida"/"Mensalidades Recebidas
>   Antecipadamente") em vez da Receita do plano diretamente — `titulo.id_conta_contabil` do
>   bloco APONTA pra essa conta de Passivo, então `baixar_titulo` (já existe, não muda uma linha)
>   já faz a coisa certa sozinho. Todo mês (dentro da janela do bloco), um lançamento de
>   reclassificação (Débito Receita Diferida / Crédito Receita real do plano, NUNCA mexe em
>   caixa) reconhece 1/N do valor — acionado automaticamente dentro da mesma rotina mensal de
>   "Gerar Cobranças" que já existe, idempotente por competência (nunca reconhece o mesmo mês
>   duas vezes, mesmo rodando de novo).
> - Quem entra no meio do semestre/ano paga normal nos meses fora da janela e só ganha acesso ao
>   desconto no próximo mês-gatilho (ex.: entra em novembro, paga nov/dez normal, ganha acesso em
>   janeiro).
>
- [ ] `CampanhaDescontoAntecipado` (percentual, quantidade de meses do bloco, meses-gatilho,
      conta de Passivo p/ receita diferida, vigência) — CRUD só de criação de nova vigência,
      nunca edição da anterior.
- [ ] Geração do título-bloco (`POST /api/titulos/gerar-cobranca-bloco`): só permitido se o mês
      pedido for um mês-gatilho de uma campanha vigente e ativa; recusa se já existir título
      (bloco ou normal) cobrindo algum mês do intervalo, pra nunca cobrar duas vezes o mesmo mês.
      Isenção de contribuição (`IsencaoContribuicao`) continua se aplicando por cima, se houver.
- [ ] Geração de cobrança mensal normal (`gerar_cobrancas`) passa a pular quem já está coberto
      por um título-bloco vigente naquela competência.
- [ ] Reconhecimento mensal de receita diferida, disparado dentro da própria rotina de "Gerar
      Cobranças" do mês, só para blocos já pagos (`status == "Pago"` — baixa parcial não
      reconhece nada até o bloco inteiro estar quitado), com rastreamento próprio
      (`ReconhecimentoReceitaDiferida`) garantindo que nunca reconhece a mesma competência duas
      vezes, e que a soma das fatias mensais bate exatamente com o valor total do bloco (o
      último mês absorve o arredondamento).
- [ ] Painel: tela de gestão da campanha (criar nova vigência, ver histórico) + ação de gerar
      cobrança em bloco a partir de Títulos, visível só quando há campanha vigente e ativa.

> **Implementado em 2026-09-17 (commit `713d108`), backend + painel, todos os itens acima.**
> Migração `b1c9d3e7f5a2` validada upgrade+downgrade+upgrade contra schema pré-v3.2.3 simulado.
> 7 testes novos em `tests/test_desconto_antecipado.py` (campanha versionada nunca edita a
> anterior, bloco recusa mês fora do gatilho, título único na conta de receita diferida, recusa
> sobreposição com título existente, geração mensal normal pula quem tem bloco, dinheiro entra
> inteiro no caixa na baixa + receita reconhecida mês a mês sem tocar caixa, mudar a campanha não
> afeta bloco já gerado) — 238/238 testes da suíte inteira passando. `Deploy API` e
> `Deploy Painel` verdes para este commit, `painel.asaf.org.br/version.json` confirmado batendo.
> **Checkboxes não marcados `[x]` ainda** — item 10 do checklist (seção 4.1) exige confirmação
> visual real do usuário nas duas telas novas (Planos de Contribuição › Campanha, Gerar Cobranças
> › bloco), e esta sessão não tem ferramenta de navegador interativo pra fazer essa confirmação
> sozinha (mesma lacuna registrada no Ponto de Revisão FASE 3 1/3, acima, junto com a confirmação
> pendente do "Aplicar crédito"). Ambas seguem pendentes de confirmação visual do usuário.

#### v3.3 — Contas a pagar, compras e segregação de funções
>
> **Pendências registradas pela v2.1 (2026-09-15)**, que já entregou a base, mas sem consumidor
> real (não existia fluxo de aprovação financeira ainda): (1) `DeclaracaoConflitoInteresse`
> (`app/models/mandatos.py`) já existe e está pronta para consulta - o fluxo de aprovação abaixo
> precisa checar automaticamente se o aprovador (ou o solicitante) tem declaração ativa
> envolvendo o fornecedor/contrato em questão, bloqueando ou exigindo segundo aprovador quando
> houver; (2) segregação de funções já tem a base de permissão por cargo (v2.1,
> `app.security.usuario_tem_permissao` soma permissão do mandato vigente) - falta só o fluxo em
> si distinguir explicitamente "quem lança" de "quem aprova" nos códigos de permissão/endpoint;
> (3) `LancamentoContabil.id_usuario_lancamento` (v3.0) já grava quem lançou cada partida - a
> checagem "quem solicita/lança nunca aprova a própria solicitação" desta versão pode comparar
> direto contra essa coluna, sem precisar reconstruir autoria a partir do `AuditLog`.

- [ ] Cadastro de fornecedores com verificação de CPF/CNPJ duplicado e dados bancários
      versionados — **alteração de dados bancários de fornecedor exige segundo aprovador**: é o
      golpe mais comum contra organizações, e a defesa é processual, não tecnológica.
- [ ] **Validação automática de situação cadastral via API pública gratuita** (serviço "Minha
      Receita", que reorganiza dado público da Receita Federal sem CAPTCHA) antes de aprovar
      pagamento. Sem SLA garantido — prever fallback para a API oficial de dados abertos de CNPJ
      em uso crítico, e nunca bloquear o processo se o serviço estiver fora (registra "não
      verificado" e segue com aprovação consciente).
- [ ] Fluxo solicitação → cotação (quando acima de valor configurado) → aprovação por alçada →
      pagamento → conciliação, com **quem solicita nunca aprovando a própria solicitação, checado
      no endpoint**, não por convenção.
- [ ] Alçadas por valor e por cargo (v13.2), com dupla assinatura acima de um teto e delegação
      temporária rastreável.
- [ ] Reembolso de despesa de voluntário/dirigente como fluxo próprio (comprovante obrigatório,
      aprovação, pagamento) — despesa reembolsada informalmente é o buraco clássico de prestação
      de contas.
- [ ] Contas a pagar recorrentes (aluguel, energia, contador) com previsão no fluxo de caixa.

> **Implementado em 2026-09-17, backend + painel, todos os itens acima.**
>
> - `DadosBancariosFornecedor` — versionado (nunca editado), status Pendente/Aprovado/Rejeitado,
>   segundo aprovador sempre diferente de quem solicitou a troca (`app/services/fornecedores.py`).
> - `Fornecedor.situacao_cadastral` — validado sob demanda via API pública "Minha Receita"
>   (`httpx`, sem chave, sem custo), nunca bloqueia se a API estiver fora (fallback "Não
>   verificado", `app/services/fornecedores.py::validar_situacao_cadastral`). Fallback pra API
>   oficial de dados abertos de CNPJ registrado como pendência futura, não resolvido agora (sem
>   sinal ainda de instabilidade em uso real que justifique).
> - `AlcadaAprovacao` (faixa de valor → cargo(s) autorizados, dupla assinatura configurável) +
>   `DelegacaoAprovacao` (temporária, sempre rastreável — quem de fato aprovou nunca se perde,
>   mesmo usando delegação) + `SolicitacaoCompra`/`CotacaoCompra`/`AprovacaoCompra`
>   (`app/services/compras.py`): segregação de funções (quem solicita nunca aprova),
>   `DeclaracaoConflitoInteresse` (ganhou `id_fornecedor` opcional) bloqueia aprovador com
>   conflito ativo envolvendo o fornecedor em questão, cotação exigida acima de
>   `VALOR_MINIMO_EXIGE_COTACAO` (configurável). Aprovação completa gera o título "A Pagar" de
>   sempre — pagamento e conciliação reaproveitam `baixar_titulo`/conciliação (v3.0), nenhum
>   conceito paralelo.
> - `ReembolsoDespesa` (`app/services/reembolso.py`) — comprovante obrigatório, segregação de
>   funções, aprovação gera título "A Pagar".
> - `ContaAPagarRecorrente` (`app/services/contas_a_pagar.py::gerar_contas_a_pagar`) — geração
>   mensal idempotente (mesmo mecanismo de `gerar_cobrancas`, `UniqueConstraint` no banco),
>   acionada automaticamente dentro da mesma rotina mensal que já gera cobrança/lembrete (v3.2.1,
>   `scripts/tarefa_mensal_financeiro.py`) — o compromisso do mês nasce sozinho, sem esperar a
>   conta chegar.
> - Painel: telas novas "Compras", "Reembolso de Despesa", "Alçadas de Aprovação" (+ delegações) e
>   "Contas a Pagar Recorrentes"; "Fornecedores" ganhou situação cadastral + dados bancários.
> - Migração `f6a8b0c2e4d5` validada upgrade+downgrade+upgrade contra schema pré-v3.3 simulado.
>   11 testes novos em `tests/test_compras.py` (segregação de funções, cargo da alçada, dupla
>   assinatura, cotação exigida, conflito de interesse, delegação temporária, segundo aprovador
>   de dados bancários, reembolso, contas a pagar recorrentes, situação cadastral com e sem
>   falha simulada da API) + 1 nova chave de configuração (`VALOR_MINIMO_EXIGE_COTACAO`,
>   contagem de 24 para 25) — 260/260 testes da suíte inteira passando.
> **Checkboxes não marcados `[x]`** — confirmação visual das telas novas ainda pendente (mesma
> lacuna de ferramenta de navegador já registrada no Ponto de Revisão FASE 3 1/3).

#### v3.4 — Doações, captação e recibos

- [ ] `Doacao` (pessoa física/jurídica, identificada ou anônima, pontual ou recorrente, com ou sem
      destinação a projeto) — doação com destinação específica **não pode** ser gasta em outra
      finalidade: o sistema bloqueia e exige remanejamento formal.
- [ ] Recibo de doação numerado e emitido automaticamente, com a redação adequada à natureza da
      entidade.
- [ ] Doação em espécie/bens (não monetária) com avaliação registrada, alimentando o patrimônio
      (v12.4).
- [ ] Campanhas de arrecadação com meta, prazo e barra de progresso publicável no site (FASE 5).

> **Implementado em 2026-09-17, backend + painel, todos os itens acima.**
>
> - `Doacao` (`app/services/doacoes.py::registrar_doacao`) — identificada ou anônima (nome/CPF
>   nunca gravados quando anônima), pontual ou recorrente, monetária ou em bens. Doação
>   monetária SEMPRE vira `TituloFinanceiro` (status "Pago" na hora) + `LancamentoContabil` de
>   verdade — registrar a doação já é a confirmação de que o dinheiro chegou (mesmo espírito de
>   "PIX na hora do evento, lançado depois pela tesouraria"), nunca um número solto numa tabela.
>   Doação em bens fica só com valor avaliado registrado — integração com patrimônio de verdade
>   é a FASE 12 (v12.4), ainda não existe, registrado como pendência futura.
> - **Destinação específica bloqueia gasto em outra finalidade**, de verdade: reaproveitou
>   `CentroDeCusto` (v3.1) — um centro de custo pode ser marcado "restrito"
>   (`CentroDeCusto.saldo_restrito`), e a aprovação de compra (v3.3) contra ele já checa
>   `saldo_disponivel_centro_custo` (doações − remanejamentos de saída − gastos já aprovados)
>   antes de liberar, recusando se faltar saldo. Único jeito de gastar em outra finalidade é um
>   `RemanejamentoDestinacao` formal e auditado.
> - Recibo numerado (`Doacao.numero_recibo`, sequencial, emitido automaticamente no registro) —
>   texto gerado a partir do cadastro (`gerar_texto_recibo`), nunca editor livre, e nunca afirma
>   dedutibilidade fiscal sem a associação confirmar sua própria situação tributária (risco legal
>   de declarar isso errado).
> - `CampanhaArrecadacao` (meta, prazo, progresso calculado pela soma das doações vinculadas) —
>   publicação no site institucional é a FASE 5, ainda não existe; só a gestão administrativa por
>   ora.
> - Painel: nova tela "Doações" (campanhas + registro de doação + recibo) e extensão de "Centros
>   de Custo" (marcar destinação restrita, ver saldo disponível, registrar remanejamento).
> - Migração `a7c9e1f3b5d6` validada upgrade+downgrade+upgrade contra schema pré-v3.4 simulado.
>   6 testes novos em `tests/test_doacoes.py` (recibo numerado sequencial, doação anônima não
>   expõe dado, doação em bens não gera título, bloqueio de destinação restrita + remanejamento
>   resolvendo, remanejamento recusa saldo insuficiente, progresso de campanha) — 266/266 testes
>   da suíte inteira passando.
> **Checkboxes não marcados `[x]`** — confirmação visual da tela nova ainda pendente (mesma
> lacuna de ferramenta de navegador já registrada no Ponto de Revisão FASE 3 1/3).

##### 🔍 Ponto de Revisão — FASE 3 (2/3, fecha v3.2.1–v3.4)

Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:

- Cancelamento de Pix Automático pelo associado (v3.2.1) é detectado pelo sistema e reverte para cobrança avulsa — não fica emitindo cobrança que nunca será paga.
- Alteração de dado bancário de fornecedor (v3.3) exige segundo aprovador — testar que um único usuário não consegue fazer isso sozinho.
- Quem solicita uma compra nunca consegue aprovar a própria solicitação — checado no endpoint, testar tentando forçar via chamada direta à API.

> **Revisado em 2026-09-17.** Checklist padrão (seção 4.1, 12 itens) + os três itens específicos
> acima:
>
> - **Item específico 1 (cancelamento de Pix Automático)**: **reescrito** — a própria v3.2.1 (ver
>   nota acima) substituiu Pix Automático de verdade (autorização/cancelamento pelo banco) por
>   "Cobrança Recorrente Automática + Lembrete Pix", achado confirmado com o usuário por falta de
>   orçamento pra um PSP parceiro. Não existe autorização de débito automático nenhuma pra
>   "cancelar" — o item como escrito testa uma feature que foi deliberadamente adiada, não
>   esquecida (registrado no próprio bloco da v3.2.1). O risco real por trás do item ("fica
>   emitindo cobrança que nunca será paga") é coberto de outro jeito, já testado: título vencido
>   não pago entra na régua de cobrança escalonada (v3.2.2, `DIAS_ATRASO_LEMBRETE`) e no fluxo de
>   negociação/parcelamento (`NegociacaoDivida`), cada aviso só sai uma vez por título
>   (`LembreteMensalidadeEnviado`, `tests/test_lembretes.py`) — nunca um loop de cobrança morta
>   sem tratamento. Quando houver orçamento pra Pix Automático de verdade, este item volta a valer
>   como escrito.
> - **Item específico 2 (segundo aprovador de dados bancários)**: confirmado por chamada HTTP real
>   contra o endpoint (`tests/test_compras.py::test_dados_bancarios_fornecedor_exige_segundo_aprovador`)
>   — o mesmo usuário que solicita a troca recebe 400 ao tentar aprovar
>   (`app/services/fornecedores.py::aprovar_dados_bancarios`), um segundo usuário aprova com sucesso.
> - **Item específico 3 (solicitante não aprova a própria compra)**: confirmado por chamada HTTP
>   real contra o endpoint, não só na camada de serviço
>   (`tests/test_compras.py::test_segregacao_solicitante_nao_pode_aprovar_propria_solicitacao`) —
>   403 ao forçar via `POST /api/solicitacoes-compra/{id}/aprovar` com o token de quem solicitou
>   (`app/services/compras.py::_pode_aprovar`).
> - **Itens 1–9 do checklist padrão**: sem violação. `AuditLog` grava toda ação sensível de
>   compras/fornecedores/reembolso/contas a pagar/doações (`registrar_auditoria` em toda escrita
>   dos routers `compras.py` e `doacoes.py`, 11/11 endpoints de doações cobertos); toda rota nova
>   usa `Depends(exigir_permissao("financeiro"))`; `DECISOES_CONGELADAS.md` sem violação; scan de
>   segredo limpo (`git diff --stat` do intervalo, 43 arquivos); nada fora de escopo sem registro
>   (anexo opcional de cotação, patrimônio da doação em bens e publicação pública de campanha
>   ficaram de fora deliberadamente, registrado nos blocos de v3.3/v3.4); suíte completa
>   **266/266 passando** (backend) e **22/22 passando** (painel), rodada de verdade nesta revisão,
>   não assumida pelo número citado nos blocos anteriores.
> - **Item 10 (tela real no painel)**: confirmado que toda funcionalidade nova do intervalo tem
>   tela própria — `Compras.tsx`, `ReembolsoDespesa.tsx`, `AlcadasAprovacao.tsx`,
>   `ContasAPagarRecorrentes.tsx`, `Fornecedores.tsx` (extensão), `NegociacaoDivida.tsx`,
>   `Doacoes.tsx`, `CentrosCusto.tsx` (extensão) — todas registradas em `App.tsx`.
> - **Item 11 (link/arquivo abre de verdade) — bug real encontrado e corrigido na hora**: o
>   comprovante do Reembolso de Despesa (v3.3) é enviado (`enviarComprovante`, mesmo padrão do
>   comprovante de lançamento) e gravado (`ReembolsoDespesa.comprovante`), mas a listagem em
>   `ReembolsoDespesaPage` nunca oferecia um jeito de abrir o arquivo depois — nem link quebrado,
>   simplesmente nenhum link. Mesma categoria do achado de 2026-09-16 (foto do associado/documento
>   da ata), desta vez por omissão em vez de caminho relativo errado. **Corrigido nesta revisão**:
>   `ReembolsoDespesa.tsx` ganhou link "Ver comprovante" via `urlArquivo()` (mesmo helper já usado
>   em `RazaoContabil.tsx`/`Ata.tsx`/`AssociadoDetalhe.tsx`), typecheck/lint/build/teste do painel
>   rodados de novo depois do fix (limpos), commit próprio nesta faixa. **Gap menor registrado,
>   não corrigido por estar fora de escopo (item 7)**: o campo opcional `anexo` de `CotacaoCompra`
>   existe no backend mas o formulário de cotação em `Compras.tsx` nunca oferece upload dele —
>   nunca gera link quebrado (porque nunca é preenchido), só uma funcionalidade opcional incompleta;
>   fica para quando cotação ganhar anexo de verdade numa versão futura.
> - **Item 12 (produção)**: `git log origin/main..HEAD` vazio; `Deploy API` e `Deploy Painel`
>   verdes para o commit `927f8ad` (v3.4, e todos os commits do intervalo antes dele, conferido via
>   `gh run list`); `painel.asaf.org.br/version.json` confirmado **ao vivo** batendo `927f8ad` no
>   momento desta revisão. **Atualização**: fix do item 11 (link do comprovante) commitado
>   (`8fa0a9e`), empurrado pro `main` remoto e com `Deploy Painel` verde para esse SHA —
>   `painel.asaf.org.br/version.json` reconfirmado ao vivo batendo `8fa0a9e` (o resultado anterior
>   era cache de CDN, refeito com `?cachebust=` pra confirmar de verdade).
> - **Confirmação visual em produção segue pendente** (mesma lacuna de ferramenta de navegador
>   interativo/logado já registrada nos pontos de revisão anteriores desta fase) — checkboxes de
>   v3.2.1–v3.4 continuam sem `[x]` até o usuário (ou uma sessão com essa ferramenta) abrir as telas
>   listadas no item 10 acima e, em particular, clicar em "Ver comprovante" do Reembolso de Despesa
>   já com o fix no ar.

#### v3.5 — Orçamento e fluxo de caixa

- [ ] `Orcamento` anual por conta e centro de custo, aprovado em assembleia (vinculado à
      deliberação da v2.5), com acompanhamento realizado x previsto e alerta de estouro.
- [ ] Fluxo de caixa projetado (cobranças a receber + contas a pagar + recorrentes) com horizonte
      configurável — a pergunta "tem dinheiro pra pagar o mês que vem?" respondida sem planilha.
- [ ] Reserva de contingência como conta própria com regra de uso definida.

> **Implementado em 2026-09-17, backend + painel, todos os itens acima.**
>
> - `Orcamento` (`app/services/orcamento.py`) — uma linha por (ano, conta contábil, centro de
>   custo opcional), sempre vinculada a uma `Deliberacao` (v2.5) já **Concluída** — nunca um
>   orçamento "de gaveta" sem respaldo de assembleia (`_exigir_deliberacao_concluida`, recusa com
>   400 se a deliberação ainda estiver pendente). `realizado` e `estourado` **nunca são colunas**:
>   são calculados na hora contra `PartidaContabil` (mesma disciplina de
>   `contabilidade.saldo_conta`), recortados por ano e, se houver, por centro de custo
>   (`realizado_do_orcamento`) — dessincronizar do razão contábil de verdade é estruturalmente
>   impossível.
> - Fluxo de caixa projetado (`orcamento.fluxo_de_caixa_projetado`) — mês a mês, a partir de
>   qualquer competência, soma saldo real das `ContaFinanceira` ativas + títulos "A Receber"/"A
>   Pagar" pendentes vencendo no mês + `ContaAPagarRecorrente` ativas que **ainda não geraram**
>   título pra aquela competência (mesma checagem de idempotência de
>   `contas_a_pagar.py::gerar_contas_a_pagar`, nunca conta em dobro depois que a rotina mensal
>   roda). Horizonte configurável via nova chave `HORIZONTE_FLUXO_CAIXA_MESES`
>   (`ConfiguracaoInstitucional`, padrão 3 meses).
> - `ReservaContingencia` (`app/services/orcamento.py`) — sempre uma `ContaFinanceira` (v3.1) já
>   existente, nunca uma tabela de saldo paralela; `regra_uso` é texto (mesmo espírito do termo de
>   negociação de dívida, v3.2.2: processo humano documentado, não travado em código - travar de
>   verdade exigiria prever toda exceção legítima de antemão). Movimentação continua sendo
>   lançamento contábil normal, nunca um caminho de escrita à parte.
> - Pequeno complemento em `app/routers/ata.py`: `GET /api/deliberacoes/concluidas` (não existia
>   nenhuma listagem geral de deliberações concluídas cross-assembleia, só "pendentes" e "de uma
>   ata específica") — necessário pro combo de vincular orçamento/reserva à deliberação certa.
> - Painel: nova tela única "Orçamento e Fluxo de Caixa" (`Orcamento.tsx`, 3 seções: orçamento do
>   ano corrente com barra de progresso e alerta visual de estouro, fluxo de caixa projetado mês a
>   mês, reserva de contingência com alerta se o saldo cair abaixo do mínimo definido).
> - Migração `b3f5d7e9c1a2` (tabelas `orcamentos`, `reservas_contingencia`) validada
>   upgrade+downgrade+upgrade contra schema pré-v3.5 simulado (worktree git no commit anterior,
>   `preparar_banco()` + `alembic stamp head`, depois `alembic upgrade/downgrade/upgrade` a partir
>   do código novo). 5 testes novos em `tests/test_orcamento.py` (exige deliberação concluída,
>   recusa orçamento duplicado pra mesma conta/ano, realizado e estouro calculados contra
>   lançamento real, fluxo de caixa soma título + recorrente ainda não gerada por DELTA - a suíte
>   compartilha banco entre arquivos, nunca total absoluto -, reserva de contingência vinculada e
>   recusa duplicidade) + 1 nova chave de configuração (`HORIZONTE_FLUXO_CAIXA_MESES`, contagem de
>   25 para 26, ajustada também em `test_smoke.py`/`test_import_export.py` que tinham a mesma
>   contagem hardcoded) — 271/271 testes da suíte inteira passando.
> **Checkboxes não marcados `[x]`** — confirmação visual da tela nova ainda pendente (mesma
> lacuna de ferramenta de navegador já registrada nos pontos de revisão desta fase).
> **Verificado em produção (2026-09-17)**: `Deploy API` (com a migração `b3f5d7e9c1a2` aplicada
> de verdade contra o Postgres de produção) e `Deploy Painel` verdes — este último bloqueado uma
> vez por formatação Prettier (`schemas.ts`/`Orcamento.tsx`, mesmo tipo de bloqueio já visto em
> v3.1/v3.3), corrigido no commit `4ffbd27` e reconfirmado ao vivo em
> `painel.asaf.org.br/version.json`.

#### v3.6 — Relatórios, prestação de contas e transparência

- [ ] Demonstrativos: balancete por período, receitas x despesas por conta e por centro de custo,
      relatório de inadimplência, extrato por conta financeira, relatório por projeto.
- [ ] Prestação de contas do exercício em formato apresentável à assembleia, com parecer do
      Conselho Fiscal (v2.6) anexado e histórico de versões.
- [ ] Versão pública agregada (sem dado individual de associado) publicada em `/transparencia/`
      (FASE 5/12.7), puxada do mesmo dado — nunca digitada duas vezes.
- [ ] Exportação contábil para o contador (FASE 17) já contemplada no desenho desde a v3.0.

> **Implementado em 2026-09-17, backend + painel, itens 1 e 2 acima.**
>
> - Todos os demonstrativos (`app/services/relatorios.py`) são calculados **na hora** contra
>   `PartidaContabil`/`TituloFinanceiro`, nunca guardados em tabela própria - mesma disciplina de
>   `saldo_conta`/`realizado_do_orcamento` (v3.5):
>   - `balancete_por_periodo` — saldo anterior + débitos/créditos do período + saldo atual, por
>     conta analítica (nunca sintética).
>   - `receitas_e_despesas_por_conta`/`..._por_centro_custo` — reaproveita o balancete, filtrando
>     Receita/Despesa.
>   - `relatorio_inadimplencia` — associados `Ativo - Inadimplente` (v1.1) com título vencido,
>     total devido e dias de atraso máximo.
>   - `extrato_conta_financeira` — movimentos de uma `ContaFinanceira` (v3.1) com saldo corrente
>     acumulado.
>   - `relatorio_por_projeto` — reaproveita receitas x despesas por centro de custo, filtrando os
>     que têm `id_projeto` (FASE 4, ainda prototípica) vinculado.
> - `PrestacaoDeContas` (`app/models/relatorios.py`) — snapshot gerado sob demanda, **versionado**
>   (gerar de novo nunca edita a versão anterior, sempre cria uma linha nova, mesmo espírito de
>   `Ata` retificada/`ValorPlanoContribuicao`): reúne balancete + receitas x despesas do ano +
>   parecer do Conselho Fiscal (`ParecerPrestacaoContas`, v2.6) mais recente daquele
>   `ano_exercicio`, se já emitido - texto claro quando ainda não há parecer, nunca finge que
>   existe.
> - Pequeno complemento: `GET /api/relatorios/*` e `GET/POST /api/prestacoes-de-contas/` em
>   `app/routers/relatorios.py`, todos atrás de `exigir_permissao("financeiro")`.
> - **Itens 3 e 4 (versão pública `/transparencia/` e exportação formal para o contador)
>   deliberadamente fora do escopo desta versão** - o próprio item 3 já registra a dependência da
>   FASE 5/12.7 (site institucional, ainda não existe); o item 4 já é "contemplado no desenho"
>   (todo dado necessário já está estruturado e acessível via API), a construção formal do
>   exportador fica pra FASE 17 como o plano sempre previu. Nenhum dos dois é lacuna desta versão,
>   é sequenciamento correto de fase.
> - Painel: nova tela única "Relatórios" (`Relatorios.tsx`, 6 seções: balancete, receitas x
>   despesas com alternância conta/centro de custo, inadimplência, extrato por conta financeira,
>   por projeto, prestação de contas com histórico de versões e parecer anexado visível).
> - Migração `c5e7a9b1d3f4` (tabela `prestacoes_de_contas`) validada upgrade+downgrade+upgrade
>   contra schema pré-v3.6 simulado (mesmo método da v3.5: worktree git no commit anterior,
>   `preparar_banco()` + `alembic stamp head`, depois `alembic upgrade/downgrade/upgrade` a partir
>   do código novo). 5 testes novos em `tests/test_relatorios.py` (balancete e receitas/despesas
>   batendo com uma baixa real, inadimplência lista associado com título vencido, extrato calcula
>   saldo corrente certo, relatório por projeto agrega pelo centro de custo vinculado, prestação
>   de contas versiona e anexa o parecer certo) — 276/276 testes da suíte inteira passando.
> **Checkboxes não marcados `[x]`** — confirmação visual da tela nova ainda pendente (mesma
> lacuna de ferramenta de navegador já registrada nos pontos de revisão desta fase).
> **Verificado em produção (2026-09-17)**: `Deploy API` (migração `c5e7a9b1d3f4` aplicada de
> verdade contra o Postgres de produção) e `Deploy Painel` verdes de primeira (commit `7eca192`),
> `painel.asaf.org.br/version.json` confirmado ao vivo batendo esse commit.

#### v3.7 — Controles antifraude (além do mínimo)

- [ ] Detecção de padrões suspeitos como relatório de exceção mensal para o Conselho Fiscal:
      lançamentos fora do horário habitual, valores logo abaixo do teto de alçada (fracionamento),
      fornecedor novo com pagamento alto na primeira operação, sequência de estornos pelo mesmo
      usuário, pagamento a conta bancária alterada recentemente.
- [ ] Conciliação obrigatória: saldo do sistema (soma de `PartidaContabil` da `ContaFinanceira`,
      v3.1) x saldo do extrato bancário, com fechamento mensal assinado por quem conferiu —
      divergência aberta bloqueia o fechamento do mês. Fechamento de **exercício** (não só do
      mês) já existe desde a v3.0 (`POST /api/exercicios/{id}/fechar`) - esta versão é quem
      acrescenta a trava de conciliação antes de deixar fechar.
- [ ] Nenhum usuário, em nenhum nível, pode apagar lançamento ou log — inclusive o Presidente.
      Restrição garantida no banco (FASE 15), não só na aplicação.

> **Implementado em 2026-09-17, backend + painel, todos os itens acima.**
>
> - `app/services/antifraude.py::relatorio_padroes_suspeitos` — relatório de EXCEÇÃO mensal
>   (nunca bloqueia nada sozinho, é achado pra revisão humana do Conselho Fiscal), com os cinco
>   padrões pedidos, todos os limiares configuráveis (`ConfiguracaoInstitucional`, nunca
>   hardcoded, porque cada associação tem volume/perfil de operação diferente):
>   - Lançamento fora do expediente (`HORA_INICIO_EXPEDIENTE`/`HORA_FIM_EXPEDIENTE`, convertido
>     pro fuso `FUSO_HORARIO` de verdade, nunca hora UTC crua).
>   - Valor de solicitação de compra a menos de `PERCENTUAL_ALERTA_FRACIONAMENTO`% do teto de uma
>     `AlcadaAprovacao` (v3.3) ativa — possível fracionamento.
>   - Primeira operação com um fornecedor (nenhum título "A Pagar" anterior) já acima de
>     `VALOR_ALERTA_FORNECEDOR_NOVO`.
>   - `QUANTIDADE_ALERTA_ESTORNOS_MESMO_USUARIO` ou mais estornos (`tipo_origem="ESTORNO"`) pelo
>     mesmo usuário no mês.
>   - Pagamento a um fornecedor dentro de `DIAS_ALERTA_TROCA_DADOS_BANCARIOS` dias da aprovação de
>     uma troca de dados bancários dele (v3.3) — o golpe mais comum contra associações.
> - `FechamentoMensal` (`app/services/fechamento.py::fechar_mes`) — saldo do sistema (mesma
>   disciplina de `saldo_conta`, recortado até o fim da competência) comparado ao saldo do
>   extrato bancário informado; **divergência acima de R$ 0,01 recusa o fechamento (400)**, sem
>   exceção, sem "forçar mesmo assim" - a saída correta é investigar antes de tentar de novo.
>   Fechamento é imutável (`UniqueConstraint` por competência+conta financeira) e assinado
>   (`id_usuario_conferencia`, `assinado_em`).
> - **Trava de DELETE garantida no próprio banco** para `lancamentos_contabeis`,
>   `partidas_contabeis` e `audit_log` — trigger `BEFORE DELETE` que recusa a exclusão (Postgres:
>   função + trigger reais; SQLite: `RAISE(ABORT, ...)`), criada tanto na migração Alembic
>   (produção) quanto em `preparar_banco()` (`app/database.py::criar_trava_delete_imutavel`, dev
>   local/teste) — as duas precisavam existir porque `preparar_banco()` nunca passa pelo Alembic.
>   Confirmado que a trava é **real, não só a ausência de rota**: testado tentando `DELETE FROM
>   lancamentos_contabeis`/`partidas_contabeis`/`audit_log` direto por SQL contra o banco de
>   teste, e recusado pela trigger nos três casos (`tests/test_antifraude.py`).
> - Pequeno complemento: `GET /api/antifraude/padroes-suspeitos` e `GET/POST
>   /api/fechamentos-mensais/` em `app/routers/antifraude.py`, atrás de
>   `exigir_permissao("financeiro")`.
> - Painel: seção "Padrões suspeitos" nova em Relatórios (`Relatorios.tsx`) e seção "Fechamento
>   mensal" nova em Conciliação (`Conciliacao.tsx`) — a trava de DELETE não tem UI, é garantia de
>   infraestrutura.
> - Migração `d7f9b1c3e5a6` (tabela `fechamentos_mensais` + as três triggers) validada
>   upgrade+downgrade+upgrade contra schema pré-v3.7 simulado. **Achado real durante essa
>   validação**: a primeira tentativa usou um arquivo sqlite de teste que, por uma diferença entre
>   como o Git Bash e o Python nativo do Windows resolvem `sqlite:////tmp/...`, apontava pra dois
>   arquivos físicos diferentes (`C:\Users\...\Temp\` via Git Bash vs `C:\tmp\` via Python) -
>   mascarou o teste com tabelas de tentativas anteriores acumuladas. Corrigido usando um caminho
>   absoluto sem ambiguidade (`C:/tmp/...`) nos dois lados; o ciclo completo (upgrade cria
>   tabela+triggers, DELETE com linha real é recusado, downgrade remove tudo, upgrade recria) foi
>   então confirmado de verdade.
> - 6 testes novos em `tests/test_antifraude.py` (fracionamento, fornecedor novo com pagamento
>   alto, pagamento após troca de dados bancários, sequência de estornos, fechamento mensal
>   bloqueia com divergência e fecha sem divergência, trava de DELETE nas três tabelas) + 6 novas
>   chaves de configuração (contagem de 26 para 32, ajustada em
>   `test_configuracoes.py`/`test_smoke.py`/`test_import_export.py`) — 282/282 testes da suíte
>   inteira passando. **Achado de isolamento de teste, corrigido na hora**: a primeira versão do
>   teste de fracionamento usava uma faixa de valor pequena (parecida com o resto da suíte) e
>   colidiu com uma alçada de outro arquivo (`alcada_aplicavel`, v3.3, escolhe a alçada de MAIOR
>   `valor_minimo` entre as que casam com o valor) - corrigido usando uma faixa de valor bem alta
>   e fora do padrão do resto da suíte, documentado no próprio teste pra não se repetir.
> **Checkboxes não marcados `[x]`** — confirmação visual das telas novas ainda pendente (mesma
> lacuna de ferramenta de navegador já registrada nos pontos de revisão desta fase).
> **Verificado em produção (2026-09-17)**: `Deploy API` (migração `d7f9b1c3e5a6` aplicada de
> verdade contra o Postgres de produção - função + 3 triggers reais criadas nas tabelas que já
> têm dado real) e `Deploy Painel` verdes de primeira (commit `bbc1caf`),
> `painel.asaf.org.br/version.json` confirmado ao vivo batendo esse commit.

##### 🔍 Ponto de Revisão — FASE 3 (3/3 — fim, fecha v3.5–v3.7)

Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:

- Fechamento mensal (v3.7) bloqueia de fato quando há divergência entre saldo do sistema e extrato bancário — testar tentativa de fechar com divergência aberta.
- Nenhum usuário, em nenhum nível (inclusive Presidente), consegue apagar lançamento ou log — confirmar isso como restrição de banco, não só de aplicação.

> **Revisado em 2026-09-17.** Checklist padrão (seção 4.1, 12 itens) + os dois itens específicos
> acima, todos aplicados com evidência concreta (arquivo:linha/execução real), não por inspeção
> superficial. Diferente das duas revisões anteriores desta fase, **nenhum bug novo foi encontrado
> nesta** — os itens abaixo confirmam o que os blocos de v3.5/v3.6/v3.7 já haviam registrado, sem
> tomar a palavra escrita como suficiente.
>
> - **Item específico 1 (fechamento bloqueia com divergência)**: confirmado por teste HTTP real,
>   não só na camada de serviço — `tests/test_antifraude.py::test_fechar_mes_bloqueia_com_divergencia_e_fecha_sem_divergencia`
>   (nome corrigido nesta revisão - a citação anterior tinha o nome errado da função, achado ao
>   conferir contra o arquivo de verdade em vez de confiar na citação escrita)
>   tenta fechar com saldo de extrato errado (`499` contra saldo real `500`), recebe 400 com a
>   divergência explícita na mensagem (`app/services/fechamento.py::fechar_mes`, sem nenhum
>   caminho de "forçar mesmo assim"), fecha com sucesso ao corrigir o valor, e uma segunda
>   tentativa na mesma competência recebe 400 por já estar fechada (`UniqueConstraint`).
> - **Item específico 2 (trava de DELETE no banco, sem exceção de nível)**: confirmado por SQL
>   direto contra o banco de teste, não por ausência de rota —
>   `tests/test_antifraude.py::test_banco_recusa_apagar_lancamento_partida_e_log_de_auditoria`
>   executa `DELETE FROM lancamentos_contabeis`/`partidas_contabeis`/`audit_log` cru e as três
>   chamadas levantam `DBAPIError` (trigger `BEFORE DELETE`,
>   `app/database.py::criar_trava_delete_imutavel`, espelhada na migração `d7f9b1c3e5a6`). A trava
>   vive na camada SQL, antes de qualquer checagem de nível/permissão da aplicação — não existe
>   parâmetro de "Presidente pode", a restrição nem enxerga quem está chamando.
> - **Itens 1–9 e 12 do checklist padrão**: sem violação. Zero ocorrências de `float` perto de
>   dinheiro em `app/{models,services}/{orcamento,relatorios,fechamento,antifraude}.py` (tudo
>   `Numeric`/`Decimal`); todo POST novo do intervalo (`orcamentos`, `reservas-contingencia`,
>   `prestacoes-de-contas`, `fechamentos-mensais`) grava `registrar_auditoria` de verdade
>   (conferido linha a linha nos três routers, não só contado por `grep` cru); toda rota nova usa
>   `Depends(exigir_permissao("financeiro"))`; `DECISOES_CONGELADAS.md` sem violação (nenhuma
>   troca de banco/framework, permissão sempre dinâmica); scan de segredo limpo no intervalo
>   (`git log -p 9a3e53c^..ea3fe52`, único achado foi senha de fixture de teste
>   `SenhaForte123456`, mesmo padrão já usado em toda a suíte); nada fora de escopo sem registro —
>   os itens 3/4 da v3.6 (transparência pública, exportação formal pro contador) seguem
>   deliberadamente adiados pra FASE 5/17, exatamente como o próprio bloco da v3.6 já registrava;
>   suíte completa **282/282 passando** (backend, rodada de verdade nesta revisão) e **22/22
>   passando** (painel), `npm run typecheck`/`npm run lint` limpos (só os 3 warnings
>   pré-existentes de `react-refresh/only-export-components`, nada novo do intervalo).
> - **Item 10 (tela real no painel)**: confirmado que as três versões têm tela própria —
>   "Orçamento e Fluxo de Caixa" (`Orcamento.tsx`, rota `/financeiro/orcamento`), "Relatórios"
>   (`Relatorios.tsx`, 6 seções + "Padrões suspeitos" acrescentada pela v3.7) e "Fechamento
>   mensal" (seção nova dentro de `Conciliacao.tsx`) — todas registradas em `App.tsx` e no menu
>   (`modulos.ts`). A trava de DELETE (v3.7, item 3) não tem UI porque é garantia de
>   infraestrutura, não uma ação que um usuário realiza — corretamente sem tela, não uma omissão.
> - **Item 11 (link/arquivo abre de verdade)**: não se aplica a este intervalo — nenhuma tela nova
>   de v3.5–v3.7 introduz upload/link de arquivo. O único "parecer anexado" citado no bloco da
>   v3.6 (`ParecerPrestacaoContas`) é texto (`Column(Text)`,
>   `app/models/conselho_fiscal.py:26`), nunca um arquivo — não há link pra verificar. Item já
>   fechado corretamente na revisão FASE 3 (2/3) para o achado real que existia (comprovante do
>   Reembolso de Despesa).
> - **Item 12 (produção)**: `git log origin/main..HEAD` vazio; `Deploy API` e `Deploy Painel`
>   verdes para `bbc1caf` (commit de código da v3.7, e todos os commits do intervalo antes dele,
>   conferido via `gh run list`) — o commit seguinte (`ea3fe52`) é só documentação
>   (`PLANO_PROJETO.md`, `git show --stat` confirma nenhum arquivo de código tocado), então
>   corretamente não dispara novo deploy. `painel.asaf.org.br/version.json?cachebust=ea3fe52`
>   reconfirmado **ao vivo** nesta revisão batendo `bbc1caf` no momento da checagem.
> **Isto fecha a FASE 3 inteira (v3.0–v3.7).** Checkboxes de v3.5–v3.7 continuam sem `[x]` pela
> mesma pendência acumulada em toda a fase: confirmação visual em produção por um usuário/sessão
> com ferramenta de navegador interativo — nenhuma tela nova, achado ou correção pendente além
> disso.

---

<a id="fase-4-v40-v49"></a>

#### v4.0 — Motores compartilhados (construídos uma vez, usados por tudo)
>
> Sem esta versão, os mesmos quatro mecanismos seriam reimplementados em projeto, evento, aula e
> assembleia — quatro versões divergentes da mesma regra é como um sistema envelhece mal.

- [ ] **Motor de presença/check-in** único: `RegistroPresenca` (pessoa, contexto polimórfico —
      evento/projeto/turma/assembleia —, data/hora entrada e saída, meio de registro, operador).
      Consumido pela FASE 2 (assembleia), FASE 4 (projeto/evento) e FASE 14 (aula).
- [ ] **Motor de inscrição**: `Inscricao` genérica com contexto polimórfico, status
      (pré-inscrito, confirmado, lista de espera, cancelado, presente, ausente), respostas a
      formulário dinâmico e vínculo opcional a cobrança.
- [ ] **Motor de documento gerado**: template com variáveis → PDF (certificado, crachá,
      declaração, recibo, carteirinha). Um motor só, com numeração e registro do que foi emitido
      para quem e quando. Certificado de voluntariado, de participação em evento e de conclusão de
      curso são o mesmo motor com template diferente.
- [ ] **Motor de indicadores**: `Indicador` (nome, unidade, meta, periodicidade) + `MedicaoIndicador`
      (valor, período, fonte, quem mediu) aplicável a projeto, evento, área e plano estratégico
      (v12.9) — nunca fórmula fixa em código.
- [ ] **Motor de agenda/conflito**: verificação de sobreposição de horário reutilizada por reserva
      de espaço, aula e evento — regra de conflito escrita uma vez.

> **Implementado em 2026-09-18, backend, todos os itens acima.**
>
> - `contexto_tipo`/`id_contexto` (e `recurso_tipo`/`id_recurso` no motor de agenda) são a
>   **primeira associação polimórfica deste projeto** — decisão deliberada e documentada em
>   `app/models/motores.py`: até aqui todo relacionamento era FK explícita por tipo (ex.:
>   `CentroDeCusto.id_projeto`), mas estes motores existem justamente pra servir consumidores que
>   ainda não existem (Projeto nasce na v4.1, Evento na v4.5, Turma só na FASE 14) — uma FK
>   explícita por consumidor exigiria alterar o motor a cada fase nova, o oposto do que "motor
>   compartilhado" quer dizer.
> - `RegistroPresenca` (`app/services/presenca.py`) — entrada/saída, meio de registro, operador.
>   **Não substitui** `Credenciamento` (assembleia, v2.5.3) — investigado antes de codar: aquele
>   já tem entrada+saída com FK explícita e está carregando o cálculo de quórum, migrá-lo seria
>   risco desnecessário numa peça já travada da governança. Serve só consumidores novos.
> - `Inscricao` (`app/services/inscricao.py`) — máquina de estados explícita (Pré-inscrito →
>   Confirmado/Lista de Espera/Cancelado → Presente/Ausente; Cancelado → Pré-inscrito de novo,
>   pra reinscrever sem duplicar linha), nunca pula etapa. `respostas_formulario` é JSON em texto
>   (formulário dinâmico por contexto, sem tabela de resposta própria). O motor não decide o que
>   é "vaga cheia" — isso é do consumidor (v4.7).
> - `TemplateDocumento`/`DocumentoEmitido` (`app/services/documentos.py`) — template com
>   `{{variavel}}` vira PDF de verdade (biblioteca nova, `reportlab` — pura Python, sem
>   dependência de sistema operacional, escolhida por isso, dado que o Container App não tem
>   Cairo/Pango do WeasyPrint), numerado sequencialmente, nunca reaproveitado, com
>   `variaveis_usadas` preservando o valor exato de cada emissão mesmo que o template mude depois.
>   Certificado de voluntariado, de participação em evento e de conclusão de curso (FASE 14) são
>   o MESMO motor com template diferente. Modelo de "numerado + quem emitiu + quando" copiado de
>   `CertidaoDeliberacao` (v2.5), já existente e testado.
> - `Indicador`/`MedicaoIndicador` (`app/services/indicadores.py`) — `unidade` e `periodicidade`
>   validados contra catálogo (`unidade_medida_indicador` já estava seedado desde antes, sem
>   consumidor — sinal de que esta versão já era esperada; `periodicidade_indicador` novo nesta
>   versão), nunca texto livre. Uma medição por período por indicador, nunca duplicada
>   silenciosamente (`UniqueConstraint`).
> - `CompromissoAgenda` (`app/services/agenda.py::verificar_conflito`/`criar_compromisso`) —
>   sobreposição real (`inicio_a < fim_b AND fim_a > inicio_b`), não só "mesmo horário exato".
>   Endpoint de verificação (`POST /api/agenda/verificar-conflito`) é só leitura, pra um
>   consumidor futuro (v4.3, reserva de espaço) poder avisar o usuário ANTES de tentar submeter.
> - Todas as rotas novas (`app/routers/motores.py`) atrás de `exigir_permissao("projetos")` —
>   nível de proteção que o restante de `app/routers/projetos.py` **ainda não tem** (pendência já
>   registrada pela v2.9, não resolvida por esta versão, resolvida pela v4.1).
> - Migração `e9b1c3d5f7a8` (7 tabelas novas) validada upgrade+downgrade+upgrade contra schema
>   pré-v4.0 simulado. 7 testes novos em `tests/test_motores.py` (presença recusa entrada
>   duplicada em aberto, inscrição recusa duplicidade e transição inválida mas permite
>   reinscrever após cancelamento, documento emitido numera sequencial e gera PDF de verdade no
>   disco - conferido com `os.path.isfile`/`os.path.getsize`, não só "a chamada não caiu" -,
>   indicador valida catálogo e recusa medição duplicada no período, agenda recusa compromisso
>   sobreposto e permite horário livre) — 289/289 testes da suíte inteira passando.
> **Sem tela no painel nesta versão, deliberadamente** — motor compartilhado é infraestrutura
> consumida por outro serviço (item 10 do checklist da seção 4.1 não se aplica ainda): a tela real
> chega com o primeiro consumidor de verdade (v4.1, Projeto). Sem checkbox `[x]` por esse motivo,
> não pela lacuna de ferramenta de navegador já registrada nas fases anteriores.
> **Verificado em produção (2026-09-18)**: `git log origin/main..HEAD` vazio; `Deploy API` verde
> (commit `8ad0a95`) — migração `e9b1c3d5f7a8` (7 tabelas novas) e a dependência nova
> (`reportlab`) aplicadas de verdade contra produção. Sem `Deploy Painel` porque nenhum arquivo do
> painel mudou nesta versão (esperado, não é uma lacuna).

#### v4.1 — Projeto como entidade única e configurável

- [ ] `Projeto` (nome, descrição, `tipo_projeto` de catálogo, responsável, público-alvo, período,
      status, centro de custo, visibilidade pública ou interna) — API `/api/projetos`.
- [ ] `TipoProjeto` configurável pela diretoria (Educacional, Espaço/Infraestrutura, Assistencial,
      Cultural/Oficina, Capacitação como **sementes de exemplo**, nada fixo em código), cada tipo
      habilitando os sub-módulos das v4.2–v4.4 e campos personalizados (v0.3.3).
- [ ] Cronograma com marcos e tarefas, responsável e prazo; status derivado do andamento real, não
      escolhido à mão.
- [ ] Indicadores do projeto (motor v4.0) — genéricos o bastante para "frequência de aluno" ou
      "famílias atendidas/mês".
- [ ] Equipe do projeto (dirigente responsável, coordenador, voluntários, colaboradores) com papel
      e período — alimenta permissão contextual: coordenador enxerga os beneficiários **do projeto
      dele**, não de todos (preparação real para o RLS da FASE 15).
- [ ] Orçamento do projeto ligado ao centro de custo (FASE 3), com realizado x previsto.
- [ ] Encerramento formal: relatório final (resultados x metas, público atendido, execução
      financeira) gerado do próprio dado, arquivado e reutilizável em prestação de contas a doador
      e em edital futuro (v12.6).

> **Implementado em 2026-09-18, backend + painel, todos os itens acima.**
>
> - `ProjetoEvento`/`projetos_eventos` (v0.1/v0.2, `app/models/projetos.py`) **estendido em vez de
>   renomeado** — decisão deliberada, documentada no próprio arquivo: `CentroDeCusto.id_projeto`
>   (v3.1), `relatorio_por_projeto` (v3.6) e `EventoCalendario` (v2.9) já apontam pra essa tabela;
>   renomear agora trocaria FK/nome em módulos já testados e em produção sem necessidade real. A
>   separação de vez entre "Projeto" e "Evento" (se vier a existir) fica pra quando a v4.5 (Evento
>   como entidade própria) chegar.
> - **Achado real corrigido nesta versão, exatamente como a v2.9 já previa**: `criar_projeto` e
>   `alocar_voluntario` eram protótipo sem `exigir_permissao`/`registrar_auditoria` - agora atrás
>   de `exigir_permissao("projetos")` com auditoria em toda escrita
>   (`app/routers/projetos.py`). Achado durante a correção: dois testes existentes
>   (`tests/test_voluntariado.py::test_alocar_voluntario_sem_termo_vigente_e_recusado`) chamavam
>   esses endpoints **sem autenticação**, contando com o protótipo aberto - corrigidos para usar
>   `auth_headers`, preservando a intenção original do teste (recusa por falta de termo de
>   voluntário vigente, não por falta de autenticação).
> - `tipo_projeto` (catálogo `tipo_projeto`, **já estava seedado desde antes desta versão, sem
>   consumidor** - mesmo sinal de antecipação já visto no motor de indicadores da v4.0) e `status`
>   (catálogo novo `status_projeto`) — nunca texto livre.
> - `ItemCronograma` (`app/models/projetos.py`) — marco ou tarefa, **status sempre calculado**
>   (Pendente/Atrasado/Concluído a partir de `prazo`/`concluido_em` contra a data de hoje), nunca
>   uma coluna que alguém escolhe à mão - mesma disciplina de `status_arrolamento` (v1.1) e do
>   quórum de assembleia.
> - `EquipeProjeto` — papel de catálogo novo (`papel_equipe_projeto`), um associado só fica ativo
>   uma vez por projeto (encerra participação antiga antes de poder reentrar) - base real pra
>   permissão contextual futura ("coordenador só vê beneficiários do projeto dele", preparação pro
>   RLS da FASE 15); `eh_coordenador_do_projeto` já escrito no service, sem consumidor ainda
>   (chega com a v4.2).
> - **Orçamento do projeto NÃO ganhou mecanismo próprio** — reaproveita `Orcamento`/
>   `realizado_do_orcamento` (v3.5) via `id_centro_custo` do projeto; `GET
>   /api/projetos/{id}/orcamento` é só uma consulta filtrada, motor nenhum duplicado.
> - `RelatorioFinalProjeto` — snapshot **versionado** (mesmo padrão de `PrestacaoDeContas`, v3.6),
>   compõe indicadores (motor v4.0) + orçamento realizado x previsto (quando há centro de custo) +
>   cronograma; a seção "público atendido" **registra a pendência real** (motor de beneficiários,
>   v4.2, ainda não existe) em vez de fingir um número que não tem base em dado.
> - Migração `f1c3d5e7a9b0` validada upgrade+downgrade+upgrade contra schema pré-v4.1 simulado.
>   **Bug real encontrado e corrigido durante essa validação**: `batch_alter_table` do SQLite
>   recusa (`ValueError: Constraint must have a name`) adicionar coluna com `ForeignKey` sem nome
>   explícito - as três colunas novas de FK em `projetos_eventos` ganharam nome de constraint
>   (`fk_projetos_eventos_id_*`), mesmo padrão já usado em migrações anteriores do projeto
>   (ex.: v3.1) que eu não tinha seguido de primeira.
> - 8 testes novos em `tests/test_projetos.py` (autenticação exigida, tipo/status validados
>   contra catálogo, cronograma deriva status certo em cada caso incluindo depois de concluído,
>   equipe recusa membro ativo duplicado mas permite reentrar após encerrar, orçamento do projeto
>   bate com o `Orcamento` v3.5 cadastrado pro centro de custo, relatório final versiona e regista
>   a pendência do público atendido) — 297/297 testes da suíte inteira passando (achei e descartei
>   de novo a mesma flakiness intermitente pré-existente de `test_situacao.py`, sem relação com
>   esta versão, já registrada nas revisões anteriores).
> - Painel: **primeira tela real de Projetos** (`Projetos.tsx`, `/projetos`) - lista + criação +
>   detalhe com cronograma, equipe, orçamento e encerramento formal, substituindo o
>   `<EmConstrucao>` que estava lá desde sempre.
> **Checkboxes não marcados `[x]`** — confirmação visual da tela nova ainda pendente (mesma
> lacuna de ferramenta de navegador já registrada nos pontos de revisão anteriores).
> **Verificado em produção (2026-09-18)**: `Deploy API` (migração `f1c3d5e7a9b0` aplicada de
> verdade contra o Postgres de produção) e `Deploy Painel` verdes de primeira (commit `68a9b13`),
> `painel.asaf.org.br/version.json` confirmado ao vivo batendo esse commit.

#### v4.2 — Beneficiários e atendimento

- [ ] `Beneficiario` como papel de `Pessoa` (v1.0), com vínculo N:N a `Projeto` e papel dentro dele
      (aluno, atendido, participante de oficina) — nunca um cadastro de pessoa por tipo de projeto.
- [ ] Núcleo familiar do beneficiário (v1.7) quando o atendimento for por família, e não por
      indivíduo.
- [ ] Prontuário de atendimento com registro datado e autor — **dado potencialmente sensível**
      (saúde, vulnerabilidade social, menor de idade): visível só para a equipe do projeto,
      consentimento específico registrado (FASE 7), consulta auditada (v15.2). Tratar isso como
      dado comum seria um erro grave de LGPD.
- [ ] Frequência/participação pelo motor único de presença (v4.0).
- [ ] Encaminhamento para rede externa (CRAS, escola, posto de saúde) registrado como
      acompanhamento, sem o sistema pretender ser prontuário eletrônico de saúde.

> **Implementado em 2026-09-18, backend + painel, todos os itens acima.**
>
> - `Beneficiario` (`app/models/beneficiarios.py`) — papel satélite de `Pessoa` (v1.0), **exatamente
>   o mesmo padrão de `Associado`**: tabela própria com `id_pessoa` + linha em
>   `Papel(tipo_papel="beneficiario")` — que já era um dos exemplos citados no próprio docstring
>   de `Papel` desde a v1.0, sem consumidor até agora. Aceita pessoa nova (nome/data de nascimento
>   direto, útil pra criança sem CPF - o motivo que já justificava `Pessoa.cpf` ser nullable desde
>   sempre) ou reaproveita uma `Pessoa` já cadastrada.
> - **Núcleo familiar não ganhou modelo novo** — `DependenteFamiliar` (v1.7) já era genérico entre
>   duas `Pessoa`s desde aquela versão, reaproveitado direto (`GET
>   /api/beneficiarios/{id}/nucleo-familiar`).
> - `BeneficiarioProjeto` — vínculo N:N com papel de catálogo (`papel_beneficiario_projeto`:
>   Aluno/Atendido/Participante de oficina) e `atendimento_por_familia`. **Esta é a fronteira real
>   de visibilidade do prontuário** — nunca o beneficiário solto, sempre o vínculo com UM projeto
>   específico, porque um mesmo beneficiário pode estar em vários projetos com equipes diferentes.
> - **`RegistroAtendimento` (prontuário) protegido por uma segunda trava, além da permissão geral
>   de "projetos"**: `exigir_membro_da_equipe_do_vinculo` recusa (403) quem não está ATIVO na
>   `EquipeProjeto` (v4.1) DAQUELE projeto - testado de propósito com o próprio usuário Presidente
>   (dono do `auth_headers` de teste, permissão "projetos" plena) recebendo 403 até entrar na
>   equipe, exatamente pra provar que não existe bypass por nível. Prontuário é **imutável**
>   (nenhum endpoint de edição/exclusão existe) e **toda consulta é auditada**
>   (`CONSULTA_PRONTUARIO`, não só a escrita) - mesmo padrão já usado pelo Conselho Fiscal (v2.6)
>   pra leitura financeira sensível.
> - `Beneficiario.consentimento_lgpd_registrado`/`observacao_consentimento` são um **placeholder
>   honesto**, registrado como tal no código - FASE 7 (consentimento versionado de verdade, regra
>   especial pra menor de idade) ainda não existe, isto não finge ser esse motor.
> - Frequência/participação **sem mecanismo próprio** — usa o motor de presença (v4.0) direto,
>   `contexto_tipo="Projeto"`; `GET /api/beneficiarios-projeto/{id}/presencas` é só um filtro por
>   cima de `listar_presencas`.
> - `EncaminhamentoRedeExterna` — tipo de catálogo novo (`tipo_rede_externa`: CRAS/Escola/Posto de
>   Saúde/Conselho Tutelar/Outro), registra QUE encaminhou, nunca pretende ser prontuário
>   eletrônico da rede pública.
> - Migração `a2c4e6f8b0d1` (4 tabelas novas) validada upgrade+downgrade+upgrade contra schema
>   pré-v4.2 simulado, sem surpresa desta vez (aplicando a lição da v4.1 sobre nome de constraint).
> - 7 testes novos em `tests/test_beneficiarios.py` (pessoa nova recusa duplicidade de papel,
>   exige id_pessoa ou nome, núcleo familiar bate com `DependenteFamiliar`, vínculo valida papel
>   de catálogo e recusa duplicidade, **prontuário recusado pro Presidente até ele entrar na
>   equipe e liberado depois, com consulta auditada de verdade** - o teste mais importante desta
>   versão -, encaminhamento valida catálogo, frequência reflete o motor de presença v4.0) —
>   304/304 testes da suíte inteira passando.
> - Painel: seção "Beneficiários" nova dentro do detalhe de Projeto (`Projetos.tsx`) — cadastro
>   rápido + vínculo, e um painel de prontuário/encaminhamento por vínculo que repassa a mensagem
>   de erro da API quando quem está olhando não é da equipe (nunca decide isso sozinho no
>   frontend).
> **Checkboxes não marcados `[x]`** — confirmação visual da tela nova ainda pendente (mesma
> lacuna de ferramenta de navegador já registrada nos pontos de revisão anteriores).
> **Verificado em produção (2026-09-18)**: `Deploy API` (migração `a2c4e6f8b0d1` aplicada de
> verdade contra o Postgres de produção) e `Deploy Painel` verdes de primeira (commit `4bb1c04`),
> `painel.asaf.org.br/version.json` confirmado ao vivo batendo esse commit.

#### v4.3 — Reserva de espaço

- [ ] `Espaco` (quadra, salão, campo, sala) com capacidade, recursos disponíveis, regras de uso,
      horário de funcionamento e bloqueios (manutenção, feriado, uso institucional).
- [ ] `Reserva` (espaço, solicitante, início/fim, finalidade, status) com dois fluxos configuráveis
      por espaço — confirmado por pesquisa como padrão de mercado: **instantânea** (auto-confirmada)
      ou **solicitação + aprovação manual**.
- [ ] Conflito impedido no banco, não só na tela: restrição de exclusão por sobreposição
      (`EXCLUDE USING gist` com `tstzrange` no Postgres) — duas pessoas clicando ao mesmo tempo não
      podem reservar o mesmo horário, e validação em aplicação não garante isso sob concorrência.
- [ ] Tarifa e prioridade por perfil (associado adimplente x terceiro/avulso), com integração real
      ao financeiro: inadimplente não reserva (checado, não marcado à mão), reserva onerosa gera
      cobrança automaticamente.
- [ ] Reserva recorrente (toda terça, 19h, por 3 meses) com tratamento individual de exceções.
- [ ] Política de cancelamento com prazo e eventual cobrança de taxa; histórico de no-show por
      solicitante, com bloqueio configurável após reincidência.
- [ ] Checklist de entrega/devolução do espaço com registro de avaria — evita a discussão
      "quem quebrou" sem prova.
- [ ] Agenda pública somente-leitura no site (disponibilidade, sem expor quem reservou).

> **Implementado em 2026-09-18, backend + painel, todos os itens acima.**
>
> - `Espaco` (`app/models/espacos.py`) — tipo de catálogo, capacidade, recursos, regras,
>   horário de funcionamento, e **os dois fluxos configuráveis por espaço** confirmados pela
>   pesquisa: `exige_aprovacao=False` (instantânea) ou `True` (solicitação + aprovação manual).
> - **Conflito reaproveita o motor de agenda (v4.0) de ponta a ponta** — `Reserva` e
>   `BloqueioEspaco` viram `CompromissoAgenda` na hora de criar
>   (`app/services/agenda.py::criar_compromisso`), nunca uma checagem de sobreposição própria;
>   testado de propósito reservando durante um bloqueio de manutenção pra provar o reuso de
>   verdade, não só por inspeção do código.
> - **"Conflito impedido no banco, não só na tela"**: migração `b4d6f8a0c2e3` acrescenta uma
>   `EXCLUDE USING gist` (com `btree_gist` pra `recurso_tipo`/`id_recurso` e `tsrange` pro
>   horário) em `compromissos_agenda`, **só no Postgres** (SQLite não tem gist/range - dev/teste
>   dependem só da checagem em aplicação, documentado no código, não escondido).
>   `criar_reserva` captura `SQLAlchemyError` ao redor da chamada ao motor de agenda e converte
>   num 400 amigável - é assim que a violação da constraint (quando disparar sob concorrência
>   real em produção) não vaza como 500. **Limitação honesta registrada**: a suíte de teste roda
>   em SQLite, então não existe hoje um teste automatizado que prove a exclusão sob concorrência
>   real de duas requisições simultâneas - só a migração aplicada em Postgres garante isso; fica
>   pendente pro Ponto de Revisão desta faixa (que pede exatamente esse teste) confirmar contra
>   produção ou um Postgres local.
> - Tarifa por perfil: `Espaco.valor_reserva` + `isento_para_associado_adimplente` — reserva
>   onerosa gera `TituloFinanceiro` "A Receber" automaticamente (nunca lançado à mão);
>   inadimplente é **checado, não marcado à mão** (`Associado.status_arrolamento`, mesma
>   materialização da v1.1).
> - Recorrência (`criar_reserva_recorrente`) — **cada ocorrência é uma `Reserva` de verdade,
>   independente**, agrupada só por um `identificador_serie` opaco; "tratamento individual de
>   exceções" é isto por construção (um conflito numa semana específica nunca aborta as outras -
>   testado de propósito ocupando deliberadamente uma ocorrência do meio da série).
> - Cancelamento com taxa por prazo (`Espaco.prazo_cancelamento_horas`/`taxa_cancelamento_tardio`)
>   e no-show com bloqueio configurável por reincidência
>   (`Espaco.limite_no_show_bloqueio`, contado nunca escolhido à mão).
> - Checklist de devolução (`ChecklistDevolucaoEspaco`) — retirada e devolução com autor/data
>   próprios, avaria com descrição obrigatória quando marcada; devolução conclui a reserva.
> - Agenda pública (`GET /api/espacos/{id}/disponibilidade`) — **única rota sem autenticação**
>   deste módulo, devolve só horário ocupado, nunca quem reservou nem a finalidade (testado
>   conferindo as chaves exatas da resposta).
> - Migração `b4d6f8a0c2e3` (4 tabelas + a EXCLUDE constraint condicionada a Postgres) validada
>   upgrade+downgrade+upgrade contra schema pré-v4.3 simulado em SQLite (a parte Postgres-only não
>   pôde ser exercitada localmente - mesma limitação de ambiente já registrada em toda a sessão).
> - 12 testes novos em `tests/test_espacos.py` (tipo de catálogo, reserva instantânea confirma e
>   conflito é recusado, aprovação manual fica solicitada até decidir, recusa libera o horário
>   pra outra pessoa, inadimplente bloqueado, tarifa gerada/isenta corretamente, série recorrente
>   trata conflito individualmente, cancelamento tardio gera taxa, no-show bloqueia por
>   reincidência, checklist registra avaria e conclui a reserva, disponibilidade pública sem
>   autenticação e sem expor solicitante, bloqueio reaproveita o motor de agenda) — 316/316
>   testes da suíte inteira passando. **Achado real corrigido durante esta versão, não específico
>   dela**: `tests/test_orcamento.py::test_fluxo_de_caixa_projetado_soma_receber_pagar_e_recorrentes`
>   comparava ponto flutuante com `==` exato (`573.05 - 273.05 == 300.0` falha em binário mesmo
>   sendo matematicamente exato) - só ficou visível porque os títulos novos desta versão mudaram
>   os valores acumulados da suíte; corrigido pra `round(..., 2)`, uma fragilidade que já existia
>   e podia voltar a aparecer com qualquer versão futura que mexesse em título financeiro.
> - **Segundo achado real, mais sério, achado no primeiro deploy**: o sufixo de 4 dígitos usado
>   por `tests/test_situacao.py::_criar_associado` (helper reaproveitado por boa parte da suíte,
>   inclusive `tests/test_espacos.py` desta versão) colide por paradoxo do aniversário bem antes
>   da suíte ficar grande - `detectar_cadastro_duplicado` (v1.8) recusa (409) quando o nome
>   normalizado bate + outro sinal (aqui, o mesmo telefone hardcoded do próprio helper) também
>   bate. **Isto explica retroativamente** a flakiness intermitente de `tests/test_situacao.py`
>   já observada várias vezes em versões anteriores desta sessão, sempre em funções diferentes -
>   nunca foi um teste quebrado, era o helper compartilhado. Corrigido aumentando o sufixo pra 8
>   dígitos (commit `ba32ab1`), tornando a colisão astronomicamente improvável.
> - **Terceiro achado real, de infraestrutura, só visível ao aplicar de verdade em produção**: a
>   `EXCLUDE USING gist` exige a extensão `btree_gist`, e o Azure Database for PostgreSQL Flexible
>   Server recusa `CREATE EXTENSION` pra extensões não liberadas explicitamente no servidor
>   (`azure.extensions` estava vazio) - `NotSupportedError: extension "btree_gist" is not
>   allow-listed`. Corrigido liberando a extensão no servidor `asaf-pg-server`
>   (`az postgres flexible-server parameter set --name azure.extensions --value BTREE_GIST`,
>   aplicado sem exigir reinício - `isConfigPendingRestart: false`), depois disparando o deploy de
>   novo. **Isto não é uma alteração de código, é configuração do servidor** - se este projeto
>   algum dia precisar recriar o servidor Postgres do zero, este passo precisa ser refeito antes
>   do primeiro deploy que crie uma `EXCLUDE` constraint.
> - Painel: nova tela "Reserva de Espaço" (`Espacos.tsx`, rota `/reserva-espaco`, novo item no
>   menu) - lista de espaços + detalhe com bloqueios e reservas (aprovar/recusar/cancelar/
>   não-compareceu/checklist), reserva simples e recorrente.
> **Checkboxes não marcados `[x]`** — confirmação visual da tela nova ainda pendente (mesma
> lacuna de ferramenta de navegador já registrada nos pontos de revisão anteriores).
> **Verificado em produção (2026-09-18)**: `Deploy API` verde no commit `77a3e2d` (após a extensão
> liberada - a migração `b4d6f8a0c2e3`, incluindo a `EXCLUDE` constraint de verdade, aplicou sem
> erro contra o Postgres de produção) e `Deploy Painel` verde no mesmo commit,
> `painel.asaf.org.br/version.json` confirmado ao vivo batendo `77a3e2d`.

##### 🔍 Ponto de Revisão — FASE 4 (1/3, fecha v4.0–v4.3)

Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:

- Os motores compartilhados (v4.0 — presença, inscrição, documento, indicador) estão sendo **de fato reutilizados** por v4.1–v4.3, não reimplementados por dentro de cada sub-módulo.
- Reserva de espaço (v4.3): conflito de horário é impedido no **banco** sob concorrência — testar duas reservas simultâneas no mesmo horário/espaço.

> **Revisado em 2026-09-18.** Checklist padrão (seção 4.1, 12 itens) aplicado com evidência
> concreta:
>
> - **Item específico 1 (motores de fato reutilizados)**: confirmado por leitura direta do código
>   consumidor, não por inferência — motor de presença consumido por
>   `app/routers/beneficiarios.py:148` (`listar_presencas(db, contexto_tipo="Projeto", ...)`);
>   motor de indicador consumido por `app/services/projetos.py:14,193-197`
>   (`servico_indicadores.listar_indicadores`/`listar_medicoes`, com comentário próprio no
>   arquivo dizendo explicitamente "nunca um mecanismo próprio de indicador/orçamento duplicado
>   aqui"); motor de agenda consumido por `app/services/espacos.py:53`
>   (`agenda.criar_compromisso`), inclusive bloqueio de manutenção virando `CompromissoAgenda`.
>   Motor de inscrição e motor de documento gerado **não têm consumidor ainda dentro de
>   v4.1–v4.3** — conferido que isso é esperado, não uma lacuna: seus primeiros consumidores reais
>   (escala de voluntário autoatendida, certificado) são v4.4/v4.5, ainda não implementadas.
> - **Item específico 2 (conflito de horário impedido no banco sob concorrência)**: confirmado
>   por execução real contra o Postgres de produção, não só pela migração ter rodado sem erro. A
>   sessão inicialmente não tinha como fazer esse teste (sem Docker/Postgres local, e buscar
>   `DATABASE_URL` do Key Vault foi recusado pelo classificador de modo automático como
>   `[Credential Materialization]`) — registrado nesta revisão, o usuário então tirou a sessão do
>   modo automático especificamente para isto. Com a permissão concedida: `DATABASE-URL` lido do
>   Key Vault direto pra um arquivo local (nunca impresso no terminal), firewall do
>   `asaf-pg-server` liberado temporariamente pro IP desta máquina (regra `TesteRevisaoTemporario`,
>   removida ao final — `az postgres flexible-server firewall-rule list` confirma só as duas
>   regras originais de volta), e um script isolado (`recurso_tipo="TESTE_REVISAO_FASE4_20260918"`,
>   `id_recurso=999999999` — marcadores que não colidem com nenhum espaço/reserva real) abriu
>   **duas conexões psycopg2 de verdade em threads separadas**: a thread A insere um compromisso
>   das 10h-11h de 2099-01-01 e mantém a transação **deliberadamente aberta** por 2,5s (sem
>   commit); a thread B, 0,5s depois, tenta inserir o mesmo horário/recurso enquanto A ainda não
>   commitou. Resultado real: a thread B **bloqueou por 2,21s** (esperando o lock de A) e só então
>   recebeu `psycopg2.errors.ExclusionViolation` ("conflicting key value violates exclusion
>   constraint `excl_compromissos_agenda_sobreposicao`") — a prova de que a serialização é de
>   verdade no banco, não uma corrida que a aplicação pudesse perder (thread B não conseguiu
>   inserir "por sorte" antes de A commitar; ela ficou travada esperando e foi recusada depois).
>   Limpeza confirmada: a linha de teste de A foi removida ao final do script (`DELETE ...
>   WHERE recurso_tipo = 'TESTE_REVISAO_FASE4_20260918'`, 1 linha), a regra de firewall temporária
>   foi excluída, e o arquivo local com a credencial foi apagado — nenhum dado de teste nem
>   segredo ficou para trás.
> - **Itens 1, 3–9 do checklist padrão**: sem violação. Zero ocorrências de `float` perto de
>   dinheiro em `app/{models,services}/{motores,projetos,beneficiarios,espacos}.py`; toda escrita
>   nova audita de verdade (`motores.py`: 10 endpoints de escrita/10 `registrar_auditoria`,
>   `verificar-conflito` corretamente sem auditoria por ser só leitura; `projetos.py`: 8/8;
>   `beneficiarios.py`: 4 escritas + 1 auditoria extra na CONSULTA do prontuário, mesmo padrão do
>   Conselho Fiscal v2.6; `espacos.py`: 10/10); toda rota nova usa
>   `Depends(exigir_permissao("projetos"))`, exceto a única deliberadamente pública
>   (`GET /api/espacos/{id}/disponibilidade`, conferida que devolve só horário ocupado, nunca quem
>   reservou); `DECISOES_CONGELADAS.md` sem violação (primeira associação polimórfica do projeto,
>   decisão documentada no próprio `app/models/motores.py`, não é troca de banco/framework); scan
>   de segredo limpo no intervalo (`git log -p aebec87..HEAD`, único achado foi mensagem de erro
>   de no-show, nenhuma credencial); nada fora de escopo sem registro (43 arquivos, 6504 inserções
>   conferidas por `git diff --stat`); suíte completa **316/316 passando** (backend, rodada duas
>   vezes nesta revisão pra afastar flakiness — **achado à parte, corrigido durante esta própria
>   revisão**: o venv local desta sessão não tinha `reportlab` instalado, embora já estivesse em
>   `requirements.txt` desde a v4.0 — `pip install -r requirements.txt` resolvido, gap só do
>   ambiente de desenvolvimento local, produção já constrói a imagem do zero a cada deploy e nunca
>   teve esse problema) e **22/22 passando** (painel), `npm run typecheck`/`npm run lint` limpos
>   (só os 3 warnings pré-existentes de `react-refresh/only-export-components`).
> - **Item 10 (tela real no painel)**: confirmado que os três consumidores novos têm tela própria
>   — "Projetos" (`Projetos.tsx`, com cronograma/equipe/orçamento/encerramento/beneficiários),
>   "Reserva de Espaço" (`Espacos.tsx`, rota `/reserva-espaco`) — ambas registradas em `App.tsx` e
>   no menu (`modulos.ts`). Os motores em si (v4.0) continuam corretamente sem tela — são
>   infraestrutura consumida por outro serviço, exatamente como o próprio bloco da v4.0 registrou.
> - **Item 11 (link/arquivo abre de verdade)**: não se aplica a este intervalo — o motor de
>   documento gerado (v4.0, PDF em disco) ainda não tem consumidor/tela (ver item específico 1
>   acima), então não existe hoje nenhum link novo pra verificar.
> - **Item 12 (produção)**: `git log origin/main..HEAD` vazio; `Deploy API` verde no commit
>   `ba32ab1` (última tentativa, depois de duas falhas reais por `btree_gist` não liberado —
>   confirmado via `gh run view`, log mostrando a migração `b4d6f8a0c2e3` rodando com sucesso na
>   terceira tentativa, depois da extensão liberada no servidor); `Deploy Painel` verde no commit
>   `77a3e2d` (não roda de novo em `ba32ab1` porque esse commit só tocou
>   `tests/test_situacao.py`, nenhum arquivo do painel — comportamento esperado, não uma lacuna);
>   `painel.asaf.org.br/version.json` reconfirmado **ao vivo** nesta revisão batendo `77a3e2d`.
> **Achado de higiene, não desta revisão**: o commit `2657fa4` ("fix: corrige nome de teste citado
> na revisão FASE 3 (3/3)") mostra que a citação de nome de teste na revisão anterior estava
> errada e foi corrigida por outra sessão/passagem — confirma que o processo de auditoria cruzada
> deste documento está funcionando, registrado aqui só para o histórico.
> **Todos os 12 itens do checklist padrão confirmados, incluindo os dois específicos desta faixa
> (motores reutilizados de verdade, EXCLUDE constraint recusando escrita concorrente real).** Isto
> fecha o Ponto de Revisão FASE 4 (1/3) — segue para v4.4.
>
> **Achado real do usuário (2026-09-18), corrigido fora do ciclo de versão**: auditoria e
> eventos/reservas apareciam com hora adiantada, "marcando para o dia seguinte" perto do fim da
> noite (horário de Brasília). Causa raiz confirmada por teste direto (não por inspeção): o
> back-end grava tudo em UTC ingênuo (`datetime.utcnow()`, convenção documentada desde a v4.3),
> mas o painel (`painel/src/lib/datas.ts::formatarData`) usava `new Date(string)` sem marcar a
> string como UTC — o JavaScript, por spec, interpreta uma string `"...T..."` sem fuso como hora
> LOCAL do navegador, então um valor UTC de verdade (ex.: auditoria às 13:13 UTC = 10:13 em
> Brasília) aparecia cru como "13:13", ~3h adiantado, virando "amanhã" depois das 21h local (é
> quando o UTC já rolou pro dia seguinte). No sentido contrário, todo `<input type="datetime-local">`
> (convocação de assembleia, evento do calendário, reserva/bloqueio de espaço) manda a hora local
> digitada sem converter — o back-end trata como se já fosse UTC, o que não estraga a exibição
> desse campo especificamente (o erro se cancela na volta), mas contaminava toda comparação
> contra `datetime.utcnow()` no próprio back-end (prazo mínimo de convocação, taxa de cancelamento
> tardio de reserva, "hoje" do calendário institucional em `montar_calendario`).
> **Correção (só no painel, nenhuma mudança de back-end necessária)**: `formatarData` agora trata
> toda string `"...T..."` sem fuso explícito como UTC antes de converter pra hora local de quem
> está vendo (`comoUtc`); todo schema Zod que alimenta um `datetime-local` (`assembleiaCriarSchema`,
> `eventoCalendarioCriarSchema`, `bloqueioEspacoCriarSchema`, `reservaEspacoCriarSchema` — herdado
> por `reservaRecorrenteCriarSchema`) agora converte a hora local digitada pra UTC antes de enviar
> (`paraUtcIso`), fechando a convenção nos dois sentidos. Achado o mesmo bug duplicado por inteiro
> em `Espacos.tsx` (função local `formatarDataHora` própria, sem usar `datas.ts`) e em três lugares
> que chamavam `new Date(iso).toLocaleString/toLocaleDateString` direto (`Projetos.tsx`: prontuário
> de atendimento e encaminhamento à rede externa, ambos `datetime.utcnow()` de verdade;
> `Relatorios.tsx`: data de cada movimento do extrato de conta financeira) — todos migrados pro
> `formatarData` compartilhado. **Verificado que não é bug em todo lugar**: `data_vencimento` de
> título financeiro (`NegociacaoDivida.tsx`) e os filtros de período do Balancete/Receitas x
> Despesas (`Relatorios.tsx`, `type="date"`) são marcadores de dia-calendário, nunca um instante
> UTC de verdade — deixados como estavam, converter esses quebraria em vez de corrigir.
> **Sem risco de dado histórico**: consultado direto em produção (só leitura, `count(*)`) antes de
> decidir — `assembleias`, `eventos_calendario`, `reservas_espaco`, `bloqueios_espaco` e
> `compromissos_agenda` estavam **todos com 0 linhas**, então não existe nenhum registro antigo
> gravado sob a convenção errada pra corrigir ou migrar; a correção vale só daqui pra frente.
> Prova: teste novo `painel/src/test/datas.test.ts` (5 casos, fuso fixado em `America/Sao_Paulo`
> pro teste ser determinístico) — inclui o caso real relatado (13:13 UTC → 10:13 exibido) e a
> prova de que entrada e exibição são inversas (o que o usuário digita é o que ele vê de volta).
> 27/27 testes do painel passando, `typecheck`/`lint`/`build` limpos.

#### v4.4 — Voluntariado vinculado a projeto

- [ ] `AlocacaoVoluntario` (turno/horário, habilidades exigidas x cadastradas, horas previstas x
      realizadas), exigindo termo de adesão vigente (v1.6) como trava real.
- [ ] Escala de voluntários com autoatendimento: o voluntário se candidata a um turno pelo painel,
      o coordenador confirma; troca entre voluntários registrada.
- [ ] Registro de horas com aprovação do coordenador, alimentando o certificado (motor v4.0) e o
      score de engajamento (v11.1).
- [ ] Visibilidade estritamente contida: o voluntário enxerga a própria escala e o próprio
      histórico, nunca dado de outro voluntário/associado nem dado financeiro (garantido por RLS na
      v15.4).

> **Implementado em 2026-09-18, backend + painel, todos os itens acima.**
>
> - `AlocacaoVoluntario` (`app/models/projetos.py`) ganhou `turno_data_hora_inicio`/`_fim`,
>   `habilidades_exigidas` (CSV do catálogo `habilidade_voluntario`, mesmo padrão de
>   `Votacao.opcoes_validas`), `horas_previstas`/`horas_realizadas` e `status`
>   (`PENDENTE`/`CONFIRMADA`/`RECUSADA`/`CANCELADA`) — a trava real de termo de adesão vigente
>   (v1.6) **já existia** desde a v2.9/v4.1 em `app/services/projetos.py::alocar_voluntario`
>   (`_exigir_termo_vigente_ou_403`), reaproveitada tal e qual pela candidatura autoatendida.
>   `Pessoa.habilidades` (CSV) comparado com a habilidade exigida via
>   `app/services/voluntariado.py::comparar_habilidades` — **só informativo, nunca bloqueia** (o
>   único bloqueio real é o termo de adesão, conforme o item do plano especifica).
> - Escala com autoatendimento de verdade: `VagaEscalaVoluntario` é a vaga publicada pelo
>   coordenador (`POST /api/projetos/{id}/vagas-escala`); o voluntário se candidata pelo painel
>   (`POST /api/voluntariado/vagas/{id_vaga}/candidatar`, resolve o `Associado` do próprio usuário
>   logado — nunca aceita `id_associado` do cliente) e nasce `PENDENTE`; o coordenador do projeto
>   específico confirma ou recusa (`exigir_coordenador_do_projeto`, mesma disciplina de
>   `beneficiarios.py::exigir_membro_da_equipe_do_vinculo` — nem permissão geral de "projetos" nem
>   ser Presidente dá esse poder por padrão, só estar ATIVO como `EquipeProjeto.papel ==
>   "COORDENADOR"` **daquele** projeto). `eh_coordenador_do_projeto` já existia desde a v4.1,
>   pronta e nunca usada até agora.
> - Troca de turno (`TrocaTurnoVoluntario`) — só quem está alocado pede a troca; o substituto
>   precisa ter termo de adesão vigente também (testado recusando 403 sem termo); o coordenador
>   confirma (transferindo a alocação pro substituto) ou recusa — nunca automática, mesmo que os
>   dois voluntários já tenham combinado entre si.
> - Registro de horas (`RegistroHorasVoluntariado`, já existia desde a v1.6) ganhou `id_alocacao` +
>   `status` — horas amarradas a uma alocação de projeto nascem `PENDENTE` e só somam ao
>   `horas_realizadas` da alocação **depois** que o coordenador aprova
>   (`app/services/projetos.py::aprovar_horas_voluntariado`); horas soltas (fluxo antigo, sem
>   projeto) continuam nascendo `APROVADO` direto, porque não existe coordenador nenhum daquele
>   contexto pra aprovar. **Pendência registrada, não fingida**: o certificado em si (v4.8) e o
>   score de engajamento (v11.1) ainda não existem — esta versão entrega só o lastro real e
>   consultável que eles vão consumir quando chegarem, exatamente como a v1.6 já tinha deixado
>   documentado.
> - Visibilidade contida na aplicação (RLS de banco é v15.4, ainda não existe):
>   `/api/voluntariado/minha-escala` e `/api/voluntariado/meu-historico-horas` resolvem o
>   `Associado` a partir do usuário logado (`Depends(get_current_user)`, nunca `id_associado` do
>   cliente) — testado criando dois voluntários e confirmando que a escala de um nunca aparece pro
>   outro. O nível "Voluntário Externo" (já seedado desde a v0.1.5, nunca usado até agora) não
>   recebe **nenhuma** permissão de módulo, então todo o autoatendimento usa só
>   `Depends(get_current_user)`, igual ao padrão já estabelecido em "Minhas assembleias" (v2.5.3b).
> - Painel: nova seção "Voluntariado" dentro do detalhe do Projeto (`Projetos.tsx`) — publicar
>   vaga, confirmar/recusar candidatura, confirmar/recusar troca, aprovar/recusar horas; e nova
>   tela de autoatendimento "Meu voluntariado" (`MeuVoluntariado.tsx`, rota `/meu-voluntariado`,
>   item global fora de qualquer módulo — mesmo padrão de "Minhas assembleias"/"Meus processos
>   disciplinares") — vagas abertas com candidatura, minha escala com cancelamento/troca, meu
>   histórico de horas com registro.
> - Migração `c5e7f9b1d3a4` (`pessoas.habilidades`, tabela nova `vagas_escala_voluntario`, novas
>   colunas em `alocacoes_voluntarios` — inclui remover `horas_dedicadas`, nunca usada em nenhum
>   call site desde que foi criada na v2.9, substituída por `horas_previstas`/`horas_realizadas` —
>   tabela nova `trocas_turno_voluntario`, novas colunas em `registros_horas_voluntariado`)
>   validada upgrade+downgrade+upgrade contra schema pré-v4.4 simulado em SQLite (`git worktree`
>   no commit anterior + import de `app.main` pra registrar todos os models + `alembic stamp
>   head`).
> - 5 testes novos em `tests/test_voluntariado_escala.py` (candidatura sem termo vigente recusada
>   com 403, fluxo completo candidatura→confirmação→registro de horas→aprovação com verificação de
>   que horas pendentes não somam e horas aprovadas somam, troca de turno recusando substituto sem
>   termo e recusando confirmação por não-coordenador, "minha escala" restrita ao próprio
>   voluntário, vaga esgotada recusa nova candidatura) — 326/326 testes da suíte inteira passando.
>   27/27 testes do painel, `typecheck`/`lint`/`build` limpos em ambos.
> **Checkboxes não marcados `[x]`** — confirmação visual das telas novas ainda pendente (mesma
> lacuna de ferramenta de navegador já registrada nos pontos de revisão anteriores).
> **Achado real no primeiro deploy**: `Deploy Painel` falhou no `prettier --check` (`Projetos.tsx`/
> `MeuVoluntariado.tsx` fora do estilo) — corrigido com `prettier --write` (commit `b4a6491`), sem
> mudança de comportamento.
> **Verificado em produção (2026-09-18)**: `Deploy API` verde no commit `859d819` (migração
> `c5e7f9b1d3a4` aplicada sem erro) e `Deploy Painel` verde no commit `b4a6491` (após o fix de
> formatação), `painel.asaf.org.br/version.json` confirmado ao vivo batendo `b4a6491`.

#### v4.5 — Evento como entidade única (pontual, com inscrição)

- [ ] `Evento` (título, descrição, data/hora, local — `Espaco` da v4.3 ou endereço avulso —,
      responsável, categoria, vagas, gratuito ou pago, público ou interno) — API `/api/eventos`,
      consumida pelo site e pelo painel: **o mesmo registro**, nunca duas tabelas.
- [ ] Evento com múltiplas sessões/atividades (programação) e inscrição por sessão quando fizer
      sentido, sem exigir criar "vários eventos" para um congresso de um dia.
- [ ] Edições recorrentes ligadas entre si (a "3ª edição" conhece as anteriores) — permite
      comparação histórica no painel gerencial (v4.10).
- [ ] Site institucional (Astro/Directus) só **lê** o endpoint público — o Directus não guarda
      evento algum, só enriquece com banner/texto de chamada vinculado por `evento_id`.

> **Implementado em 2026-09-18, backend + painel, todos os itens acima (exceto o `evento_id` do
> Directus - o site Astro/Directus é outro projeto, fora deste repositório; o que cabia aqui,
> o endpoint público que ele vai consumir, está pronto e testado).**
>
> - `Evento` (`app/models/eventos.py`) — título/descrição/categoria (catálogo `tipo_evento`, já
>   seedado desde a v4.3 e sem nenhum consumidor real até agora), data/hora, local (`id_espaco`
>   da v4.3 OU `endereco_avulso` em texto), responsável, `vagas` (só metadado — a trava real de
>   limite sob concorrência é a v4.7, não inventada aqui por antecipação), `gratuito` e
>   `visibilidade` (`"Pública"`/`"Interna"`, mesma convenção de `ProjetoEvento.visibilidade`,
>   v4.1). **Um evento é um registro só** — `GET /api/eventos/{id}` (gestão, autenticado) e
>   `GET /api/publico/eventos/{id}` (leitura pública) leem a MESMA tabela, o segundo só filtra
>   `visibilidade == "Pública"` e omite campo de gestão interna (testado: evento `"Interna"`
>   devolve 404 na rota pública, nunca 403 — não revela nem que existe).
> - `SessaoEvento` — programação do evento (congresso de um dia, N atividades) sem exigir criar
>   "vários eventos"; testado cadastrando e listando.
> - Edições recorrentes: `Evento.id_edicao_anterior` liga cada nova edição à imediatamente
>   anterior; `app/services/eventos.py::listar_cadeia_edicoes` percorre a cadeia inteira (pra
>   trás E pra frente a partir de qualquer edição pedida) — testado criando 3 edições e
>   confirmando que pedir a cadeia a partir da 1ª ou da 3ª devolve a mesma lista completa,
>   ordenada cronologicamente.
> - **Inscrição reaproveita o motor genérico da v4.0** (`app/models/motores.py::Inscricao`,
>   `contexto_tipo="Evento"`/`"SessaoEvento"`) — motor que já existia desde a v4.0 sem nenhum
>   consumidor real até esta versão. Gestão de inscrição de terceiros continua no endpoint
>   genérico já existente (`/api/inscricoes/`, `app/routers/motores.py`, permissão "projetos" —
>   nada novo criado ali). O que esta versão acrescenta é o **autoatendimento**: o próprio
>   associado se inscreve (`POST /api/eventos/{id}/inscricao` e `.../sessoes/{id}/inscricao`,
>   `Depends(get_current_user)`, resolve o `Associado` do usuário logado — nunca aceita
>   `id_pessoa` do cliente) e vê só as próprias inscrições (`GET /api/eventos/minhas-inscricoes`)
>   — testado criando dois associados e confirmando que a lista de um nunca mostra a do outro.
> - **Achado real, corrigido antes de qualquer deploy**: as rotas `GET /api/eventos/{id_evento}`
>   e `GET /api/eventos/minhas-inscricoes` colidiam — o FastAPI/Starlette casa rota por ORDEM DE
>   REGISTRO, e `{id_evento}` (registrada primeiro) casava com o segmento literal
>   `"minhas-inscricoes"` antes de tentar convertê-lo pra `int` e falhar com 422, nunca chegando
>   na rota certa. Descoberto pelo próprio teste automatizado (`KeyError: 0` ao indexar um corpo
>   de erro como se fosse lista) — corrigido registrando a rota literal ANTES da parametrizada,
>   mesma regra de ordenação que qualquer framework de rota por padrão de caminho exige e que
>   nenhuma versão anterior desta sessão tinha testado o suficiente pra pisar nela até agora.
> - **Pendências registradas, não fingidas**: deduplicação por CPF e formulário público (v4.6),
>   limite de vagas sob concorrência real e cotas/inscrição em grupo (v4.7) ainda não existem —
>   esta versão entrega a entidade e o autoatendimento interno; o site institucional (Astro/
>   Directus) em si é outro projeto, fora deste repositório, e não foi tocado aqui.
> - Painel: nova tela "Eventos" (`Eventos.tsx`, rota `/eventos`, módulo com permissão "projetos")
>   — lista + criação de evento, seção de programação (sessões), seção de edições recorrentes com
>   a cadeia completa, seção de inscritos (reaproveitando o endpoint genérico de inscrição). Uma
>   tela de autoatendimento (associado se inscrevendo pelo painel, fora do módulo de gestão) foi
>   deliberadamente deixada pra quando a v4.6 chegar, já que o formulário de inscrição público é
>   o mesmo tipo de tela e construir os dois agora arriscava duplicar UI que a v4.6 ia substituir.
> - Migração `d6f8a0c2e4b6` (`eventos`, `sessoes_evento`) validada upgrade+downgrade+upgrade contra
>   schema pré-v4.5 simulado em SQLite (mesmo processo de `git worktree` + import de `app.main` +
>   `alembic stamp head` já usado nas versões anteriores).
> - 7 testes novos em `tests/test_eventos.py` (categoria inválida recusada, evento público só
>   lista/detalha visibilidade "Pública" e nunca expõe campo de gestão interna, sessões
>   cadastradas e listadas, cadeia de 3 edições consistente a partir de qualquer uma delas,
>   inscrição autoatendida no evento restrita ao próprio associado com duplicata recusada pelo
>   motor genérico, inscrição autoatendida por sessão, endpoints de gestão exigem autenticação
>   enquanto a leitura pública não) — 328/328 testes da suíte inteira passando. 27/27 testes do
>   painel, `typecheck`/`lint`/`format`/`build` limpos em ambos.
> **Checkboxes não marcados `[x]`** — confirmação visual da tela nova ainda pendente (mesma
> lacuna de ferramenta de navegador já registrada nos pontos de revisão anteriores).
> **Verificado em produção (2026-09-18)**: `Deploy API` verde no commit `081774e` (migração
> `d6f8a0c2e4b6` aplicada sem erro) e `Deploy Painel` verde no mesmo commit,
> `painel.asaf.org.br/version.json` confirmado ao vivo, e `GET https://api.asaf.org.br/api/
> publico/eventos` respondendo `[]` sem autenticação (endpoint público real em produção).

#### v4.6 — Inscrição pública com deduplicação

- [ ] Formulário de inscrição no site chama o FastAPI (não o Directus), com CPF + e-mail +
      telefone.
- [ ] Deduplicação (seção 3.5): CPF já conhecido → inscrição vinculada ao cadastro existente, sem
      pedir dado que o sistema já tem. CPF novo → "participante externo", que **nunca** vira
      associado automaticamente.
- [ ] Perguntas personalizadas por evento (texto curto/longo, seleção única/múltipla, número,
      data, arquivo), com resposta obrigatória configurável.
- [ ] Confirmação por e-mail/WhatsApp com código de check-in e possibilidade de autocancelamento
      pelo link — reduz no-show e trabalho da secretaria.
- [ ] Proteção do endpoint público: rate limiting por IP, honeypot e (só se necessário) desafio —
      sem CAPTCHA comercial pago. Consentimento LGPD explícito no formulário, com versão do texto
      registrada.

> **Implementado em 2026-09-18, backend + painel (perguntas), todos os itens acima (WhatsApp
> registrado como pendência real de infraestrutura, não fingido - ver abaixo; o formulário
> público em si vive no site institucional, outro projeto fora deste repositório).**
>
> - `POST /api/publico/eventos/{id}/inscrever-se` chama o FastAPI direto (nunca o Directus) com
>   CPF + e-mail + telefone + nome, validados de verdade (`app/validadores.py::validar_cpf`/
>   `validar_telefone_br`, os mesmos já usados no resto do sistema desde a v1.1).
> - **Deduplicação (seção 3.5)**: CPF já conhecido → `Pessoa.cpf` existente é reaproveitada (só
>   completa e-mail/telefone que estivessem vazios, nunca sobrescreve o que já tinha) — testado
>   inscrevendo o mesmo CPF em dois eventos diferentes e confirmando que só existe UMA `Pessoa`.
>   CPF novo → `Pessoa` nova com `Papel.tipo_papel="participante_externo"` (papel que já existia
>   como valor válido desde a v1.0, sem nunca ter tido consumidor real até agora) — **nunca** cria
>   `Associado`; testado confirmando que o participante externo não aparece na busca de associados.
> - `PerguntaEvento` (`app/models/eventos.py`) — texto curto/longo, seleção única/múltipla,
>   número, data, arquivo, `obrigatoria` configurável por pergunta; resposta mora em
>   `Inscricao.respostas_formulario` (JSON, chave = id da pergunta) — sem tabela própria de
>   resposta, mesmo raciocínio de `ValorCampo` genérico (v0.3.3). Pergunta obrigatória sem
>   resposta é recusada (422) antes de qualquer gravação.
> - Confirmação por e-mail (`app/services/notificacoes.py`, SMTP já existente desde a v3.2.1) com
>   código de check-in (`Inscricao.codigo_checkin`, 8 caracteres, gerado com `secrets.token_hex` -
>   lastro real pro check-in da v4.8, quando existir) e link de autocancelamento
>   (`Inscricao.token_cancelamento`, opaco - `POST /api/publico/inscricoes/{token}/cancelar`,
>   nunca aceita o `id_inscricao` sequencial, que qualquer um poderia adivinhar). **Falha de SMTP
>   nunca derruba a inscrição** - o `try/except` ao redor do envio garante isso, testado
>   implicitamente (SMTP não configurado no ambiente de teste, e a inscrição sempre volta 200).
>   **WhatsApp fica pendência real, não fingida**: depende da API oficial (Meta Cloud/BSP) da
>   v11.3, que ainda não existe - mesma decisão já registrada em `DECISOES_CONGELADAS.md` seção 7
>   desde antes desta versão.
> - Proteção do endpoint público: `TentativaAcessoPublico` (tabela nova) + `app/services/
>   protecao_publica.py::limitar_taxa_por_ip` - 5 tentativas/10 min pra inscrever-se, 10/10 min
>   pra cancelar, sem nenhuma dependência nova (mesmo raciocínio de `Usuario.tentativas_falhas`/
>   `bloqueado_ate` da v0.1, só que por IP em vez de por usuário) — testado excedendo o limite e
>   confirmando 429. Honeypot (`pagina_web`, campo que só um robô preenche) finge sucesso sem
>   gravar nada, nunca revela que foi pego. Consentimento LGPD (`ConfiguracaoInstitucional.
>   TEXTO_CONSENTIMENTO_LGPD_INSCRICAO`/`VERSAO_TEXTO_CONSENTIMENTO_LGPD_INSCRICAO`, editáveis sem
>   deploy) — a inscrição recusa (422) se a versão enviada não bater com a versão atual, e a
>   versão aceita fica gravada em `Inscricao.consentimento_lgpd_versao`, imutável mesmo se o texto
>   mudar depois. Desafio (captcha próprio) não foi necessário - rate limiting + honeypot já
>   cobrem o que a pesquisa de mercado pedia, sem CAPTCHA comercial pago.
> - **Achado real, corrigido durante esta versão**: `request.client.host` seria o IP do ingress
>   do Azure Container Apps em produção, não o do visitante de verdade - rate limiting por IP
>   ficaria inútil (todo mundo compartilhando o mesmo balde). Corrigido com `_ip_publico` (`app/
>   routers/eventos.py`), que lê `X-Forwarded-For` quando presente, só cai pro `request.client.
>   host` em dev local sem proxy no meio.
> - Painel: nova seção "Perguntas do formulário de inscrição pública" dentro do detalhe do Evento
>   (`Eventos.tsx`) - cadastro e listagem. **O formulário público (onde a resposta é de fato
>   preenchida) e o autocancelamento vivem no site institucional (Astro/Directus), outro projeto,
>   fora deste repositório** - mesma decisão de escopo já registrada na v4.5, deliberada pra não
>   duplicar UI que o site vai ter que ter de qualquer forma.
> - Migração `e8b0c2d4f6a8` (`perguntas_evento`, `tentativas_acesso_publico`, `codigo_checkin`/
>   `token_cancelamento`/`consentimento_lgpd_versao` em `inscricoes`) validada
>   upgrade+downgrade+upgrade contra schema pré-v4.6 simulado em SQLite (mesmo processo de sempre).
> - 12 testes novos em `tests/test_eventos_inscricao_publica.py` (participante externo novo,
>   CPF conhecido nunca duplica `Pessoa`, evento interno recusa inscrição pública, consentimento
>   obrigatório, versão de consentimento desatualizada recusada, CPF inválido recusado, pergunta
>   obrigatória sem resposta recusada e depois aceita, perguntas aparecem no detalhe público,
>   honeypot finge sucesso sem gravar nada, autocancelamento por token e token inválido/já usado,
>   rate limiting bloqueia a 6ª tentativa do mesmo IP) — 340/340 testes da suíte inteira passando
>   (3 testes pré-existentes tiveram a contagem de configurações institucionais seguidas
>   atualizada de 32 para 35, refletindo as 3 chaves novas desta versão). 27/27 testes do painel,
>   `typecheck`/`lint`/`format`/`build` limpos em ambos.
> **Checkboxes não marcados `[x]`** — confirmação visual da tela nova ainda pendente (mesma
> lacuna de ferramenta de navegador já registrada nos pontos de revisão anteriores).
> **Achado real em produção, corrigido no mesmo dia**: `GET /api/publico/eventos/consentimento-
> lgpd` colidia com `GET /api/publico/eventos/{id_evento}` pelo mesmo motivo já corrigido na v4.5
> (rota literal registrada DEPOIS da parametrizada) - sem teste automatizado cobrindo essa rota
> específica, só apareceu ao testar a produção de verdade. Corrigido reordenando o registro
> (commit `b243423`) e coberto por teste de regressão dedicado.
> **Verificado em produção (2026-09-18)**: `Deploy API` verde no commit `b243423` (migração
> `e8b0c2d4f6a8` aplicada sem erro) e `Deploy Painel` verde no commit `c863ff9`,
> `painel.asaf.org.br/version.json` confirmado ao vivo, e `GET https://api.asaf.org.br/api/
> publico/eventos/consentimento-lgpd` respondendo o texto/versão reais sem autenticação.

#### v4.7 — Vagas, lista de espera e inscrição em grupo

- [ ] Limite de vagas com trava real sob concorrência (controle transacional no banco, não
      contagem otimista na aplicação) — acima do limite, vira lista de espera automaticamente, com
      promoção automática na desistência e prazo para confirmar antes de passar ao próximo.
- [ ] Cotas por categoria (ex.: X vagas para associados, Y para comunidade externa).
- [ ] Inscrição em grupo (família, delegação): cada nome vira inscrição própria com código de
      check-in individual; telefone/respostas compartilhados quando fizer sentido.

> **Implementado em 2026-09-18, backend + painel, todos os itens acima.**
>
> - **Trava real sob concorrência, sem extensão de dialeto nenhuma** (ao contrário da `EXCLUDE
>   USING gist` da v4.3, Postgres-only): `app/services/vagas.py::reservar_vaga` faz um único
>   `UPDATE ... WHERE vagas_ocupadas < limite` (compare-and-swap no próprio SQL) — o SGBD nunca
>   deixa duas transações concorrentes aplicarem esse mesmo UPDATE condicionado na mesma linha ao
>   mesmo tempo sem serializar uma depois da outra, então só uma consegue quando resta 1 vaga.
>   **Testado com carga real, não só lógica**: `tests/test_eventos_vagas.py::
>   test_duas_inscricoes_simultaneas_na_ultima_vaga_so_uma_passa` dispara 4 requisições
>   concorrentes (`ThreadPoolExecutor`) pra 1 vaga só e confirma exatamente 1 "Pré-inscrito" e 3
>   "Lista de Espera" — o item específico pedido pelo Ponto de Revisão desta faixa.
>   `Evento`/`SessaoEvento.vagas` (só metadado desde a v4.5) agora é reforçado por
>   `vagas_ocupadas`, e o motor de inscrição (v4.0) ganhou `status_inicial` (decidido por quem
>   chama, nunca pelo motor - "o motor não sabe o que é vaga cheia" continua verdade).
> - **Cotas por categoria** (`CotaInscricaoEvento`, opcional por evento/sessão): quando existe
>   qualquer cota configurada, ela passa a controlar a vaga daquela categoria especificamente -
>   testado com cota de 1 ASSOCIADO + 1 COMUNIDADE_EXTERNA, confirmando que um segundo associado
>   vai pra lista de espera mesmo com a cota de comunidade externa ainda livre (cotas nunca se
>   misturam). Categoria é **derivada** (`app/services/vagas.py::categoria_da_pessoa` - tem
>   `Associado` vinculado = ASSOCIADO, senão COMUNIDADE_EXTERNA), nunca escolhida à mão por quem
>   se inscreve. Sem nenhuma cota configurada, `Evento.vagas`/`SessaoEvento.vagas` genérico vale
>   pra todo mundo, exatamente como desde a v4.5.
> - **Lista de espera com promoção automática**: `Inscricao` (motor v4.0) ganhou
>   `categoria_cota` (pra liberar/promover exatamente a mesma fonte depois), `prazo_confirmacao`
>   (só preenchido quando promovida) e `identificador_grupo`. Cancelamento (`POST /api/publico/
>   inscricoes/{token}/cancelar`, v4.6) agora libera a vaga de verdade e promove o próximo da
>   fila (FIFO por `data_inscricao`) na mesma hora, por e-mail (best-effort, nunca trava a
>   promoção); quem é promovido confirma pelo mesmo token
>   (`POST /api/publico/inscricoes/{token}/confirmar`, novo) até o prazo configurável
>   (`PRAZO_CONFIRMACAO_LISTA_ESPERA_HORAS`, editável sem deploy) - vencido sem confirmar,
>   `app/services/vagas.py::expirar_promocoes_vencidas` cancela e promove o próximo, disparado
>   a cada 15 minutos por `.github/workflows/tarefa-eventos-vagas.yml` (mesmo padrão de cron já
>   usado pela tarefa mensal financeira, v3.2.1) e também exposto pra disparo manual
>   (`POST /api/eventos/expirar-promocoes-vencidas`, permissão "projetos").
> - **Inscrição em grupo**: `InscricaoPublicaCriar.participantes_adicionais` - o pedido principal
>   é o primeiro participante, cada adicional vira sua própria `Inscricao` com seu próprio
>   `codigo_checkin`, todos compartilhando `identificador_grupo` (mesmo raciocínio de
>   `Reserva.identificador_serie`, v4.3) e telefone/e-mail/consentimento do pedido como um todo -
>   "tratamento individual": testado com 3 participantes numa vaga pra 2, confirmando que 2
>   ficam "Pré-inscrito" e 1 "Lista de Espera", nunca o grupo inteiro recusado por 1 não caber.
> - Painel: nova seção "Cotas de vagas por categoria" dentro do detalhe do Evento
>   (`Eventos.tsx`), e o cabeçalho do evento passou a mostrar vagas ocupadas/livres de verdade
>   (antes só o número declarado, sem nenhum contador real por trás).
> - Migração `f0a2c4e6b8d0` (`eventos.vagas_ocupadas`, `sessoes_evento.vagas_ocupadas`, tabela
>   nova `cotas_inscricao_evento`, `categoria_cota`/`prazo_confirmacao`/`identificador_grupo` em
>   `inscricoes`) validada upgrade+downgrade+upgrade contra schema pré-v4.7 simulado em SQLite
>   (mesmo processo de sempre).
> - 7 testes novos em `tests/test_eventos_vagas.py` (acima do limite vira lista de espera, 4
>   inscrições concorrentes numa vaga só - exatamente 1 passa -, cota por categoria independente,
>   cancelamento promove o próximo automaticamente, confirmação por token limpa o prazo,
>   expiração de promoção vencida libera e promove o próximo da fila, inscrição em grupo com
>   tratamento individual) — 348/348 testes da suíte inteira passando (3 testes pré-existentes
>   tiveram a contagem de configurações institucionais atualizada de 35 para 36, refletindo
>   `PRAZO_CONFIRMACAO_LISTA_ESPERA_HORAS`). 27/27 testes do painel, `typecheck`/`lint`/`format`/
>   `build` limpos em ambos.
> **Checkboxes não marcados `[x]`** — confirmação visual da tela nova ainda pendente (mesma
> lacuna de ferramenta de navegador já registrada nos pontos de revisão anteriores).
> **Verificado em produção (2026-09-18)**: `Deploy API` verde no commit `d941934` (migração
> `f0a2c4e6b8d0` aplicada sem erro), `Deploy Painel` verde no mesmo commit,
> `painel.asaf.org.br/version.json` confirmado ao vivo, `POST https://api.asaf.org.br/api/
> publico/eventos/1/inscrever-se` validando o corpo de verdade (não 404 de rota), e o workflow
> agendado `Tarefa Periódica (expira promoções de lista de espera vencidas)` confirmado `active`
> no GitHub (`gh workflow list`).

##### 🔍 Ponto de Revisão — FASE 4 (2/3, fecha v4.4–v4.7)

Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:

- Voluntário sem termo de adesão vigente (v1.6) realmente não é alocável em projeto — trava real, testar a tentativa.
- Limite de vagas (v4.7) segura sob concorrência (duas inscrições simultâneas na última vaga não podem ambas passar) — teste de carga simples nisso.
- Endpoint público de inscrição (v4.6) tem rate limiting e deduplicação por CPF funcionando de verdade.

> **Revisado em 2026-09-18.** Checklist padrão (seção 4.1, 12 itens) + os três itens específicos
> acima, todos aplicados com evidência concreta — **dois achados reais nesta revisão, ambos
> corrigidos na hora, não empurrados como pendência.**
>
> - **Item específico 1 (termo de adesão vigente trava candidatura)**: confirmado por chamada
>   HTTP real — `tests/test_voluntariado_escala.py::test_candidatura_sem_termo_de_adesao_vigente_e_recusada`
>   candidata um voluntário sem termo vigente (`POST /api/voluntariado/vagas/{id}/candidatar`),
>   recebe 403 com "termo de adesão" na mensagem, antes de qualquer alocação nascer.
> - **Item específico 2 (limite de vagas segura sob concorrência real)**: confirmado por teste de
>   carga de verdade, não só lógico — `tests/test_eventos_vagas.py::test_duas_inscricoes_simultaneas_na_ultima_vaga_so_uma_passa`
>   dispara 4 requisições concorrentes (`ThreadPoolExecutor`) contra 1 vaga só, confirma
>   exatamente 1 "Pré-inscrito" e 3 "Lista de Espera". A trava real é um `UPDATE ... WHERE
>   vagas_ocupadas < limite` (compare-and-swap atômico em uma única instrução SQL,
>   `app/services/vagas.py::reservar_vaga`), sem depender de extensão de dialeto (ao contrário da
>   `EXCLUDE USING gist` Postgres-only da v4.3) — funciona idêntico em SQLite (teste) e Postgres
>   (produção). **Achado real durante esta própria revisão, corrigido na hora**: rodar a suíte
>   completa duas vezes seguidas, esta mesma prova de concorrência falhou intermitentemente na
>   segunda rodada — não por bug na trava (o teste isolado sempre passava), e sim por
>   `_ip_de_teste()` (`tests/test_eventos_vagas.py` e `tests/test_eventos_inscricao_publica.py`)
>   usar só 2 dígitos hex (256 valores possíveis) pro IP fake de rate limiting, com as duas
>   suítes compartilhando a mesma rota (`inscrever-se-evento`) no mesmo banco de teste sem
>   rollback por transação — mesma categoria de colisão por paradoxo do aniversário já corrigida
>   nesta sessão pro sufixo de CPF da v4.3 (`_criar_associado`). Corrigido aumentando pro hex
>   inteiro nos dois arquivos; suíte completa rodada mais duas vezes depois do fix (349/349,
>   349/349), sem nenhuma repetição da falha.
> - **Item específico 3 (rate limiting e deduplicação por CPF reais)**: confirmado por chamada
>   HTTP real — `test_rate_limiting_por_ip_no_endpoint_publico_de_inscricao` faz 5 inscrições do
>   mesmo IP (sucesso) e confirma 429 na 6ª; `test_inscricao_publica_com_cpf_conhecido_vincula_ao_cadastro_existente`
>   inscreve o mesmo CPF em dois eventos diferentes e confirma por consulta direta ao banco que
>   existe só UMA `Pessoa`, nunca duplicada.
> - **Achado real nº 2, mais sério, corrigido durante esta revisão**: nenhuma das ações de
>   inscrição em evento gravava `AuditLog` — nem o autoatendimento autenticado
>   (`POST /api/eventos/{id}/inscricao`/`.../sessoes/{id}/inscricao`), nem a inscrição pública sem
>   login (`POST /api/publico/eventos/{id}/inscrever-se`), nem o autocancelamento/confirmação por
>   token, nem a expiração de promoção da lista de espera — violação direta do item 5 do checklist
>   padrão ("toda ação sensível grava AuditLog de verdade"), e uma quebra do próprio padrão que a
>   v4.4 já tinha estabelecido nesta mesma fase (`candidatar_se_endpoint`, autoatendimento de
>   voluntário, já auditava). **Corrigido em `app/routers/eventos.py`**: autoatendimento
>   autenticado audita com o `usuario` real; os quatro caminhos públicos (inscrever-se, cancelar,
>   confirmar, expirar promoção) auditam com `usuario=None` (mesmo padrão SISTEMA já usado pela
>   tarefa mensal financeira, v3.2.1), com o IP já capturado pelo rate limiting servindo de
>   referência de origem — inscrição em grupo grava um registro por participante (nunca só o
>   principal), mesma disciplina de "tratamento individual" do resto da v4.7. Dois testes de
>   regressão novos confirmam a entrada de auditoria de verdade no banco (não só que o endpoint
>   não quebrou): `test_inscricao_publica_grava_auditoria_mesmo_sem_login` e a asserção acrescentada
>   em `test_inscricao_autoatendida_no_evento_e_restrita_ao_proprio`.
> - **Itens 1, 3–4, 6–9 do checklist padrão**: sem violação (fora o achado nº 2 acima, já
>   corrigido). Zero `float` perto de dinheiro nos módulos do intervalo (`carga_horaria_semanal`/
>   `horas` em `voluntariado.py` são horas, não dinheiro — checado, não é violação); toda rota nova
>   usa `exigir_permissao("projetos")` ou `get_current_user`, com as únicas rotas públicas sem
>   nenhuma autenticação sendo as deliberadamente marcadas como tal (leitura de eventos públicos,
>   consentimento LGPD, inscrição pública com rate limiting) — confirmado lendo o router inteiro,
>   não só contando decorators; `DECISOES_CONGELADAS.md` sem violação; scan de segredo limpo no
>   intervalo (`git log -p 6824c87..c99ad9b` — único conteúdo sensível são referências
>   `${{ secrets.X }}` do GitHub Actions e chamadas `az keyvault secret show` com `::add-mask::`,
>   mesmo padrão já estabelecido desde a v3.2.1, mais o uso correto de `secrets.token_hex`/
>   `secrets.token_urlsafe` do Python pra gerar código de check-in e token de cancelamento); nada
>   fora de escopo sem registro (43 arquivos, 5328 inserções conferidas por `git diff --stat`);
>   suíte completa **349/349 passando** (backend, rodada três vezes nesta revisão — a
>   flakiness real do achado acima só apareceu na 2ª rodada, por isso rodar mais de uma vez
>   continua sendo o mínimo, nunca uma formalidade) e **27/27 passando** (painel),
>   `typecheck`/`lint`/`build` limpos em ambos.
> - **Item 10 (tela real no painel)**: confirmado — seção "Voluntariado" dentro do detalhe do
>   Projeto + tela de autoatendimento "Meu voluntariado" (v4.4); tela "Eventos" com programação,
>   edições recorrentes, inscritos, perguntas do formulário e cotas de vagas por categoria
>   (v4.5–v4.7) — todas registradas em `App.tsx`/`modulos.ts`. Formulário público de inscrição e
>   autocancelamento vivem no site institucional (Astro/Directus), fora deste repositório —
>   decisão de escopo já registrada nos próprios blocos de v4.6, não uma lacuna desta revisão.
> - **Item 11 (link/arquivo abre de verdade)**: não se aplica a este intervalo — nenhuma tela nova
>   de v4.4–v4.7 introduz upload/link de arquivo (certificado em PDF é v4.8, motor de documento da
>   v4.0 segue sem consumidor).
> - **Item 12 (produção)**: `git log origin/main..HEAD` vazio (antes das correções desta revisão);
>   `Deploy API` e `Deploy Painel` verdes pra todos os commits de código do intervalo (`859d819`→
>   `b4a6491` após fix de Prettier, `081774e`, `c863ff9`→`b243423` após fix de colisão de rota,
>   `d941934`) — conferido via `gh run list`, incluindo a única falha real do intervalo (`Deploy
>   Painel` em `859d819`, já corrigida no próprio ciclo da v4.4);
>   `painel.asaf.org.br/version.json?cachebust=d941934` reconfirmado **ao vivo** batendo `d941934`
>   nesta revisão; workflow agendado `Tarefa Periódica (expira promoções de lista de espera
>   vencidas)` confirmado `success` numa execução real em produção (18:54, 2026-09-18).
> **Commit desta revisão** (achados 1 e 2 corrigidos): `app/routers/eventos.py` (auditoria nos
> cinco caminhos de inscrição), `tests/test_eventos.py`/`test_eventos_inscricao_publica.py`
> (regressão de auditoria), `tests/test_eventos_vagas.py`/`test_eventos_inscricao_publica.py`
> (IP de teste com hex inteiro) — commit `df4683a`.
> **Achado real nº 3, o mais sério, achado pelo próprio `Deploy API` do commit `df4683a` (a
> confirmação em produção deste ponto de revisão, não um teste manual à parte) — corrigido na
> hora**: o CI falhou em "Rodar testes automatizados" com `KeyError: 'id_associado'` em
> `tests/test_compras.py::test_reembolso_despesa_segregacao_e_gera_titulo`, um teste que **nunca
> falhou localmente nesta revisão** (rodado 3 vezes seguidas antes do push, sempre 349/349).
> Investigado até a causa raiz, não silenciado com retry: `_criar_usuario_com_mandato`
> (`tests/test_compras.py`, reaproveitado por `test_antifraude.py`) gerava o nome com só 4 dígitos
> de sufixo do CPF (`cpf[-4:]`) **e indexava `.json()["id_associado"]` sem checar o status code**
> — quando `detectar_cadastro_duplicado` (v1.8) recusava por colisão de nome+telefone (o telefone
> de `_PAYLOAD_BASE` é uma constante fixa, `"11900000000"`, compartilhada por toda chamada), a
> resposta virava `{"detail": "..."}` e o `["id_associado"]` quebrava com `KeyError` em vez de um
> assert legível — exatamente a mesma categoria de paradoxo do aniversário já corrigida na v4.3
> pra `_criar_associado`, só que num helper diferente que aquele fix nunca tocou. **Auditoria
> preventiva no resto da suíte encontrou o mesmo padrão vulnerável (sufixo de 4 dígitos + mesmo
> telefone fixo `"11900000000"`) em mais 7 arquivos** (`test_associado_detalhe.py`,
> `test_conceder_acesso.py`, `test_dependentes.py`, `test_doacoes.py`, `test_ficha_360.py`,
> `test_filiacao.py`, `test_qualidade_cadastro.py`, `test_v1_1.py`) — nenhum tinha falhado ainda
> só por sorte, não por estarem protegidos. Todos os 8 arquivos + `test_compras.py` corrigidos
> juntos (sufixo de 8 dígitos, mesmo padrão já usado em `test_situacao.py`/`test_eventos.py`/
> `test_eventos_vagas.py`/`test_voluntariado_escala.py` desde a v4.3/v4.4), mais o `assert
> status_code == 200` que faltava em `_criar_usuario_com_mandato` pra qualquer falha futura
> aparecer legível em vez de `KeyError` genérico. Suíte completa rodada mais duas vezes depois
> deste fix (349/349, 349/349) — commit `e79de51`. **Achado de infraestrutura do próprio ciclo de
> deploy**: como o commit `e79de51` só tocou `tests/**`, e `deploy-api.yml` só dispara por
> `paths: app/**, alembic/**, ...` (nunca `tests/**`), o push sozinho não gerou nenhum novo `Deploy
> API` — o que, sem perceber, teria deixado o achado nº 2 (`df4683a`, a correção de auditoria)
> **nunca implantado**, porque o `Deploy API` de `df4683a` tinha falhado bem antes de chegar na
> migração/build. Corrigido dentro desta mesma revisão: `gh workflow run "Deploy API (FastAPI)"
> --ref main` (workflow_dispatch, já previsto no gatilho do workflow) disparado manualmente pra
> implantar o `HEAD` de verdade.
> **Verificado em produção, pós-fix**: `Deploy API` verde no commit `e79de51`
> (`gh run view 35385014891`, 349/349 passando dentro do próprio CI desta vez, nenhuma migração
> nova necessária); `GET https://api.asaf.org.br/api/publico/eventos` respondendo 200 ao vivo.
> `Deploy Painel` não disparou nesta faixa (nenhum arquivo do painel mudou em nenhum dos três
> commits desta revisão) — esperado, não uma lacuna.
> Isto fecha o Ponto de Revisão FASE 4 (2/3) — segue para v4.8.

#### v4.8 — Check-in, crachá e certificado

- [x] Check-in por código curto, QR code da inscrição ou carteirinha do associado, **sem exigir
      login de quem opera a portaria** (token de operação com escopo limitado ao evento).
- [x] Modo offline resiliente: a portaria continua registrando presença se a internet cair, com
      sincronização depois — evento acontece em quadra e salão, onde a rede falha de verdade.
- [x] Check-out opcional (para cálculo de carga horária real de curso/atividade).
- [x] Crachá e certificado em PDF a partir do registro de presença (motor v4.0), com código de
      verificação público (`/certificado/verificar/{codigo}`) que confirma autenticidade sem expor
      dado pessoal além do nome e da atividade.
- [x] Regra de elegibilidade ao certificado configurável (ex.: 75% de presença) — calculada, nunca
      concedida à mão.
- [x] **Nunca exportação de lista completa em lote** como caminho padrão (risco de vazamento
      identificado nas referências de pesquisa); exportação existe, mas com permissão própria e
      registro em auditoria (v1.3).

> **v4.8 (2026-09-30)**: token de operação da portaria persistido e revogável
> (`tokens_portaria` — diferente da carteirinha, que é um JWT puro; um QR de portaria fica exposto
> fisicamente por horas, precisa poder ser morto no meio do evento) autoriza check-in/check-out sem
> login em `app/routers/portaria.py`, fora de `/api/`. Idempotência real via
> `operacoes_portaria_idempotentes`: a fila offline do painel (`painel/src/lib/portaria-queue.ts`,
> IndexedDB via `idb`) gera a `chave_idempotencia` uma única vez por ação e nunca a regenera num
> reenvio — reconectar depois de uma queda de internet nunca duplica presença. Elegibilidade
> (`app/services/certificados.py::calcular_elegibilidade`) em três níveis — carga horária declarada
> (único nível que usa dado de check-out) → contagem de sessões → indisponível (evento sem nenhum
> dos dois critérios simplesmente **não emite certificado**, em vez de fingir um percentual sem
> sentido) —, sempre calculada, sem parâmetro de override em nenhuma função da cadeia. Crachá nunca
> exige elegibilidade (é etiqueta, não credencial); certificado gera `codigo_verificacao` opaco
> (16 hex) e passa a nomear o próprio arquivo por ele em vez do número sequencial de sempre —
> achado próprio desta versão: `/uploads/` é servido sem autenticação, e o nome sequencial de
> `DocumentoEmitido` já era enumerável (quem incrementasse o número baixaria o nome completo de
> qualquer pessoa certificada); corrigido só para os dois templates novos, documentos internos
> continuam como antes. `GET /certificado/verificar/{codigo}` devolve só
> `{nome_completo, atividade, tipo_documento, emitida_em}`, mesmo padrão de minimização de dado já
> usado por `/carteirinha/verificar/{token}` (v1.1) — testado explicitamente que CPF/e-mail/
> telefone nunca aparecem na resposta. Exportação de presença (`exportar_presencas_evento`,
> permissão própria e auditada) réplica exata do padrão de `exportar_dados_pessoais` (v1.3).
> **Achado do próprio ciclo de deploy desta versão**: `Deploy Painel` recusou o primeiro push no
> job de `format:check` (Prettier) — 4 arquivos novos/alterados não verificados localmente antes
> do push, corrigido no commit seguinte. `Deploy API` recusou o mesmo push em "Rodar testes
> automatizados": `test_antifraude.py::test_fechar_mes_bloqueia_com_divergencia_e_fecha_sem_divergencia`
> falhou com o saldo do sistema aparecendo como R$ 0,00 mesmo com lançamento do próprio dia — bug
> pré-existente e não relacionado à v4.8 em `app/services/fechamento.py::_saldo_sistema_ate_competencia`,
> que calculava o fim da competência como **meia-noite** do último dia do mês (reaproveitando
> `data_vencimento_da_competencia`, pensada pra data de vencimento, nunca pra corte de saldo) —
> qualquer lançamento feito depois da meia-noite do próprio último dia do mês (ou seja, qualquer
> lançamento feito nesse dia, na prática) ficava fora do saldo. Só nunca tinha aparecido porque
> nenhum teste tinha rodado num dia 30/31 até hoje (2026-09-30, o próprio dia deste deploy).
> Corrigido pro mesmo padrão de fim de intervalo já usado em `app/services/antifraude.py` e
> `app/services/relatorios.py` (`23:59:59`, nunca meia-noite) — commit `2495516`. Suíte completa
> rodada duas vezes depois do fix (362/362, 362/362).
> **Verificado em produção, ao vivo, nesta revisão**: `Deploy API` (`gh run view 36768930819`,
> job `build-and-deploy` verde ponta a ponta — testes, migração Alembic aplicada, build da imagem,
> atualização do Container App) e `Deploy Painel` (`gh run view 36768220783`) verdes para o commit
> que fecha a faixa (`2495516`); `GET https://api.asaf.org.br/certificado/verificar/CODIGO-INEXISTENTE`
> respondendo 404 com a mensagem esperada (prova que a rota nova e a migração — coluna
> `codigo_verificacao` — estão de fato no ar, não só no código); `GET
> https://api.asaf.org.br/api/publico/eventos` respondendo 200; todas as rotas novas (`/portaria/*`,
> `/certificado/verificar/{codigo}`, `/api/eventos/{id}/tokens-portaria`, `/elegibilidade`,
> `/elegibilidade-config`, `/crachas/{id}`, `/certificados/{id}`, `/presencas/exportar`) presentes
> no `openapi.json` de produção; `painel.asaf.org.br/version.json` confirmando o commit
> `d28792d` (último a tocar `painel/**` na faixa).
> **Pendência registrada, não fingida**: a tela da portaria (`/portaria/:token` no painel) foi
> construída deliberadamente desacoplada da sessão/autenticação do painel (só fala com os
> endpoints públicos/escopados por token) para poder ser transplantada pro site institucional
> (Astro, outro repositório) quando ele existir — por ora ela mora no painel porque o evento
> acontece antes do site estar pronto, não porque é o lugar definitivo.

#### v4.9 — Financeiro de projeto/evento

- [x] Cobrança de inscrição/uso de espaço integrada à FASE 3, com valor por faixa (associado x não
      associado x estudante), lote promocional por data, cupom e isenção justificada.
- [x] Política de reembolso por cancelamento, com prazo e percentual configuráveis, gerando
      estorno rastreável (nunca "devolução por fora").
- [x] Fechamento financeiro automático ao encerrar (inscritos, presentes, arrecadado, custos,
      resultado por centro de custo), com a mesma auditoria do restante do financeiro.

> **v4.9 (2026-09-30)**: cobrança de inscrição liga no motor genérico que já existia desde a v4.0
> mas nunca tinha consumidor automático (`Inscricao.id_titulo_cobranca`/`vincular_cobranca`) —
> faixa de preço por categoria/data reaproveita o padrão versionado de
> `CampanhaDescontoAntecipado` (v3.2.3, mensalidade); cupom é motor genérico novo
> (`contexto_tipo`/`id_contexto`, mesmo raciocínio da v4.0) já nascendo pra servir inscrição de
> evento e reserva de espaço ao mesmo tempo; isenção justificada espelha `IsencaoContribuicao`
> (motivo de catálogo + aprovador + percentual). Evento gratuito continua sem cobrar nada -
> comportamento preservado, confirmado lendo todo caminho de inscrição antes de mexer.
> **Decisão de desenho central**: reembolso por cancelamento NUNCA estorna o título original (o
> dinheiro realmente entrou) - gera um título "A Pagar" novo linkado
> (`TituloFinanceiro.id_titulo_reembolso_de`), pago pelo mesmo `POST /baixar-titulo/` de sempre,
> nunca uma devolução "por fora" - cobre 100% e reembolso parcial com o mesmo código, sem
> ramificação. Isto fechou de quebra um gap real pré-existente da v4.3: `Reserva`/`Espaco` já
> cobrava de verdade desde então, mas cancelar uma reserva paga nunca devolvia a cobrança
> original - só podia empilhar uma taxa de cancelamento tardio em cima. Fechamento financeiro do
> evento é snapshot versionado (nunca editado, mesmo raciocínio de `RelatorioFinalProjeto`,
> v3.6), reaproveitando `receitas_e_despesas_por_centro_custo` (v3.6) sem soma paralela -
> `CentroDeCusto` ganhou `id_evento` (espelha `id_projeto`, v3.1) porque `Evento` só nasceu como
> tabela própria na v4.5, depois deste modelo já existir. Tarefa periódica diária
> (`.github/workflows/tarefa-fechamento-eventos.yml`) fecha automaticamente todo evento encerrado
> sem fechamento ainda, mesmo padrão de `expirar_promocoes_vagas.py` (v4.7).
> **Achado real no próprio ciclo de migração desta versão**: validar o upgrade/downgrade contra
> um schema pré-v4.9 genuíno (gerado a partir do código real da v4.8 via `git worktree`, não uma
> simulação manual) encontrou que o Alembic exige nome explícito de constraint no modo batch do
> SQLite ao adicionar uma coluna nova com FK numa tabela existente - o Postgres de produção nunca
> precisaria disso (lá é um `ADD COLUMN` direto, sem recriar a tabela), mas o SQLite usado
> localmente/CI recria a tabela inteira por trás de `batch_alter_table` e essa recriação falha
> sem o nome. Corrigido antes de qualquer tentativa em produção, nomeando as quatro constraints
> novas (`fk_centros_de_custo_id_evento`, `fk_titulos_financeiros_id_titulo_reembolso_de`,
> `fk_eventos_id_conta_contabil_receita`, `fk_eventos_id_centro_custo`).
> **Verificado em produção, ao vivo, nesta revisão**: `Deploy API` (`gh run view 36787989467`,
> job `build-and-deploy` verde ponta a ponta - testes, migração Alembic aplicada, build da
> imagem, atualização do Container App) e `Deploy Painel` (`36787989508`) verdes para o commit
> que fecha a faixa (`dabed1a`); `GET https://api.asaf.org.br/api/eventos/1/faixas-preco` e
> `GET https://api.asaf.org.br/api/centros-custo/` respondendo 401 (autenticação exigida, não
> 500) - prova que a migração e o código novo estão de fato no ar, não só no repositório; todas
> as rotas novas presentes no `openapi.json` de produção; `painel.asaf.org.br/version.json`
> confirmando o commit `dabed1a`. Suíte completa rodada três vezes ao longo do ciclo (362/362,
> 370/370, 370/370).

#### v4.10 — Painel gerencial e avaliação

- [x] Telas de inscritos/beneficiários/reservas com busca, filtro e edição, sem exportação em lote
      como ação corriqueira.
- [x] Indicadores agregados por projeto e comparação entre edições de um mesmo evento.
- [x] Pesquisa de satisfação pós-evento (link único por inscrito, resposta anônima na exibição),
      alimentando o indicador de qualidade do evento.
- [x] Mapa de calor de ocupação de espaços — subsidia decisão real sobre horário, tarifa e
      necessidade de nova estrutura.

> **v4.10 (2026-09-30)**: última versão da FASE 4. `SecaoInscritos` (Eventos.tsx) ganhou
> busca/filtro/transição de status (o `PUT /api/inscricoes/{id}/status` já existia desde a v4.0,
> nunca tinha UI); beneficiário ganhou a primeira tela CRUZADA entre projetos
> (`painel/src/pages/Beneficiarios.tsx` — a visão aninhada dentro de um projeto, com
> prontuário/encaminhamento gateados por "equipe ativa deste projeto", continua existindo em
> `Projetos.tsx`, de propósito: identidade/consentimento é cruzável, prontuário não); reserva de
> espaço ganhou edição de horário/finalidade reexecutando a mesma checagem de conflito de agenda
> (`agenda.atualizar_compromisso`, nunca uma checagem paralela). Três permissões de exportação
> novas, uma por domínio (`exportar_inscricoes_evento`, `exportar_beneficiarios`,
> `exportar_reservas_espaco`) — nunca compartilhada, mesmo padrão já estabelecido três vezes antes
> (`exportar_dados_pessoais`, `gerenciar_checkin_evento`/`exportar_presencas_evento`).
> **Indicadores (motor da v4.0) ganhou a primeira tela de verdade**, nova seção em `Projetos.tsx` -
> até aqui só existia API, nunca UI, apesar de pronto desde o início da fase.
> **Pesquisa de satisfação** é FK explícita a `Evento` (`RespostaPesquisaSatisfacao.id_evento`),
> não motor genérico `contexto_tipo`/`id_contexto` - só há um consumidor real agora (mesmo
> raciocínio que manteve `TituloFinanceiro` com FK explícita em vez de polimórfico até cupom/
> isenção, v4.9, nascerem servindo dois consumidores ao mesmo tempo). `id_inscricao` existe só
> pra impedir convite duplicado e saber pra quem mandar o link - nunca aparece no resultado
> agregado (`calcular_resultado`), que é onde "resposta anônima na exibição" de fato se cumpre -
> provado por teste (`test_resultado_agregado_e_sempre_anonimo...`). Convite automático entra no
> mesmo ciclo diário que já fechava o financeiro do evento (v4.9,
> `fechar_eventos_encerrados_sem_fechamento`), mais um disparo manual
> (`POST /pesquisa-satisfacao/convidar`) pra quem não quiser esperar. Resultado alimenta um
> `Indicador`/`MedicaoIndicador` CALCULADO (nome "Satisfação pós-evento",
> `contexto_tipo="Evento"`) que é recriado/atualizado a cada recálculo, nunca empilhado - por isso
> não passa pelo `indicadores.registrar_medicao` de entrada manual (que recusa, de propósito,
> sobrescrever o período já medido). Duas opções de catálogo novas
> (`unidade_medida_indicador.NOTA_0_A_10`, `periodicidade_indicador.POR_EVENTO`) entraram via
> `INSERT` direto na migração (não no seed do `app/database.py`, que só roda pra catálogo NOVO e
> pularia estas duas em produção - mesmo padrão já usado na migração `5278bf9ee537`, v3.1).
> Mapa de calor de ocupação (`app/services/ocupacao_espacos.py::mapa_calor_ocupacao`) conta só
> reserva `CONFIRMADA`/`CONCLUIDA` por dia-da-semana × hora; Recharts (biblioteca de gráfico
> congelada) não tem heatmap nativo, então a visualização é uma grade de células com cor derivada
> do token `--primary` via `color-mix` (se adapta a dark mode sozinha, nunca uma escala hexadecimal
> fixa), `role="gridcell"`/`aria-label` por célula. Frontend construído por um agente em worktree
> isolado (mesmo padrão da v4.8/v4.9), revisado e integrado manualmente - nenhuma dependência nova.
>
> **Ponto de Revisão - FASE 4 (3/3 — fim, fecha v4.8–v4.10)**
>
> Checklist padrão (seção 4.1):
>
> - [x] **Item 1 (implementado e testado de fato)**: v4.8-v4.10 relidas contra o código real
>       nesta revisão (routers/services/models/migrações/testes de todas as três), não só pelo
>       texto do plano.
> - [x] **Item 2 (testes automatizados existem e passam)**: `pytest` - **384/384 passando**,
>       suíte completa rodada duas vezes nesta revisão (370/370 antes da v4.10 acrescentar os
>       testes novos: `test_pesquisa_satisfacao.py` + adições em `test_eventos.py`,
>       `test_beneficiarios.py`, `test_espacos.py`).
> - [x] **Item 3 (nenhuma regra congelada violada)**: `alembic heads` mostra uma única head
>       (`85a120a27eb7`), cadeia linear desde a v4.9. Recharts continua a única biblioteca de
>       gráfico (heat map é grade de `div`, não uma lib nova). Nenhuma dependência nova no
>       `painel/package.json` nem em `requirements.txt`. MFA do painel não foi tocado (decisão
>       congelada §3.1 permanece de pé, ver `CLAUDE.md`).
> - [x] **Item 4 (nenhum segredo exposto)**: `git status` limpo antes do commit, nenhum segredo
>       novo introduzido nos diffs revisados.
> - [x] **Item 5 (AuditLog de verdade)**: toda escrita nova grava auditoria -
>       `beneficiarios`/UPDATE, `reservas_espaco`/UPDATE, `inscricoes`/`beneficiarios`/
>       `reservas_espaco` EXPORTAR, `respostas_pesquisa_satisfacao`/CONVIDAR e RESPONDER_PUBLICO
>       (este último sem usuário, mesmo padrão SISTEMA já usado pela inscrição pública v4.6).
> - [x] **Item 6 (permissão checada no backend)**: as três permissões de exportação e a edição de
>       beneficiário/reserva são checadas via `Depends(exigir_permissao(...))` no router, nunca só
>       escondidas no front - provado por teste (403 pra quem só tem `"projetos"` sem a permissão
>       de exportação específica, nas três telas).
> - [x] **Item 7 (nada fora de escopo adiantado)**: a página pública de resposta da pesquisa de
>       satisfação (`/pesquisa-satisfacao/{token}`, sem login) foi deliberadamente NÃO construída
>       no painel - é API pronta pro site institucional (FASE 5, Astro, outro repositório)
>       consumir quando existir, mesmo raciocínio já registrado na v4.8 pra portaria.
> - [x] **Item 8 (plano atualizado)**: este bloco.
> - [x] **Item 9 (suíte completa, não só o intervalo)**: mesma suíte do item 2 - 384/384 cobre
>       FASE 0-4 inteira, nada anterior quebrou silenciosamente.
> - [x] **Item 10 (tela real no painel)**: confirmado por screen novo/alterado - `Beneficiarios.tsx`
>       (novo), `SecaoInscritos`/`SecaoEdicoes`/`SecaoPesquisaSatisfacao` (Eventos.tsx),
>       `SecaoReservas`/`SecaoMapaCalorOcupacao` (Espacos.tsx), `SecaoIndicadores` (Projetos.tsx) -
>       `npm run typecheck`/`build`/`lint`/`format:check` e a suíte E2E (10/10, `Deploy Painel`)
>       verdes contra este código real, não só a rota existindo.
> - [x] **Item 11 (link/arquivo produzido foi aberto de verdade)**: esta versão não produz nenhum
>       arquivo/documento novo pra abrir (os botões de exportar renderizam tabela em tela, nunca
>       download) - o único "link" novo (token da pesquisa de satisfação) só é clicável a partir
>       do futuro site institucional, que ainda não existe; confirmado em vez disso por uma
>       chamada HTTP real e não-destrutiva à mesma rota em produção (ver abaixo).
> - Específicos desta revisão: exportação de inscritos/beneficiários/reservas (v4.10) nunca é
>   ação corriqueira sem auditoria - confirmado acima (item 5/6) e por teste dedicado em cada uma
>   das três telas. Certificado (v4.8) só é emitido quando a elegibilidade é realmente atingida -
>   reconferido nesta revisão, `app/services/certificados.py` sem nenhuma mudança nesta faixa que
>   tocasse esse caminho, suíte de certificados permanece verde.
>
> **Verificado em produção, ao vivo, nesta revisão**: `Deploy API` (`gh run view 36794521349`,
> job `build-and-deploy` verde ponta a ponta - testes, migração Alembic `85a120a27eb7` aplicada,
> build da imagem, atualização do Container App) e `Deploy Painel` (`gh run view 36794521288`,
> incluindo a suíte E2E de acessibilidade/login/MFA, 10/10) verdes para o commit que fecha a fase
> (`a25dbfd`); `painel.asaf.org.br/version.json` confirmando esse mesmo commit; os dez endpoints
> novos desta versão (`/api/inscricoes/exportar`, `/api/beneficiarios/exportar`,
> `/api/beneficiarios/{id}` PUT, `/api/reservas-espaco/exportar`,
> `/api/espacos/ocupacao-mapa-calor`, `/api/eventos/{id}/comparacao-edicoes`,
> `/api/eventos/{id}/pesquisa-satisfacao/convidar` e `/resultado`,
> `/pesquisa-satisfacao/{token}` e `/responder`) presentes no `openapi.json` de produção; uma
> chamada real (não só de schema) a `GET /pesquisa-satisfacao/token-inexistente...` respondendo
> `404 {"detail": "Link de pesquisa de satisfação inválido."}` exatamente como o código prevê -
> prova que a rota pública nova está de fato no ar, não só no repositório.
>
> **FASE 4 fechada.** Todas as dez versões (v4.0-v4.10) concluídas, testadas e confirmadas em
> produção.

---

<a id="fase-5"></a>

### FASE 5 — Site institucional (conteúdo público)

✅ **Concluída em 2026-10-20.** O Presidente fechou os dois Pontos de Revisão (1/2 e 2/2) e decidiu os últimos itens do **Fechamento da FASE 5** (no fim desta fase). O conteúdo da fase continua neste arquivo, porque
o `CLAUDE.md` e outros blocos o citam; a mudança para o `HISTORICO.md` fica para quando a FASE 6 abrir. **A FASE 6 só abre quando o Presidente liberar.**

> O site não é folheto: é a porta de entrada de associado, voluntário, doador e beneficiário — e é
> a face pública da transparência. Tudo que é **dado** vem do FastAPI; só o que é **editorial** vem
> do Directus. Essa fronteira é o que impede o site de virar um segundo sistema.

> **O que ainda falta da FASE 5 está numa lista só: o "Fechamento da FASE 5", no fim desta fase** (organizada em 2026-10-19). Os `[ ]` e as notas "Falta" dentro das versões são o histórico; quando divergirem, vale o Fechamento.

#### v5.0 — Fundação técnica do site

- [x] Astro com geração estática + ilhas interativas, publicado no Static Web App `asaf-site` (já
      provisionado), domínio `asaf.org.br` (já configurado na v0.0).
- [x] Rebuild sob demanda: o workflow `deploy-site.yml` aceita disparo (`workflow_dispatch`) com
      token de mínimo privilégio; dado dinâmico do FastAPI (eventos, transparência) é buscado no
      cliente (ilha), para não exigir rebuild a cada inscrição.
- [x] **Flow do Directus que chama esse disparo** quando o conteúdo muda — **movido para a
      v5.1**: um Flow precisa de coleção para escutar, e as coleções só nascem na v5.3 (era v5.1). O
      receptor (workflow) já está pronto e testado; o procedimento exato está em
      [`site/README.md`](site/README.md#rebuild-quando-o-conteúdo-do-directus-muda).
      **Resolvido de outro jeito (conferido em 2026-10-19):** o fluxo `sincronizar-site.yml` roda de 15 em 15 minutos e reconstrói o site quando a API **ou** o Directus mudou (v5.3); ver a seção G do Fechamento da FASE 5.
- [x] Mesmos tokens de design do painel (v0.2.4) — identidade visual única, mantida num lugar só
      (`design/`, consumido por `painel/` e `site/`).
- [x] SEO técnico desde o início: metadados por página, Open Graph, `sitemap.xml`, `robots.txt`,
      dados estruturados de organização (`NGO`) — no ar. **`schema.org/Event`**: construtor
      (`jsonLdEvento`) pronto e testado, mas quem o usa são as páginas de evento da **v5.2** —
      hoje nenhum evento tem página própria, então ainda não há evento da ASAF na busca do Google.
- [x] Meta de performance e acessibilidade auditada no CI (antecipa a FASE 9): sem isso, "a gente
      melhora depois" nunca acontece.

> **v5.0 (2026-10-01)**: `site/` (Astro 7 + Tailwind 3 + TypeScript `strict`), `design/` (tokens
> compartilhados) e `.github/workflows/deploy-site.yml`. `asaf.org.br` deixou de ser a página
> provisória "em construção" (publicada à mão na v0.0, nunca esteve no repositório) e passou a
> servir o site real: home mínima (identidade, natureza e objetivo do Estatuto Art. 1º, áreas de
> atuação do Art. 3º, ilha de próximos eventos, chamada para o painel). A home é só o suficiente
> para ter o que publicar — **a "Home" completa e as demais páginas continuam sendo a v5.2**.
>
> **Tokens (item 3)**: extraídos do `painel/` sem mudar nada — o CSS compilado do painel saiu
> **idêntico byte a byte** (mesmo hash `index-DjBCh0k1.css`, conferido antes/depois e de novo em
> produção). Mudança em `design/` dispara o deploy do painel *e* do site.
>
> **Ilha de eventos (dado dinâmico)**: `GET /api/publico/eventos` buscado no navegador. Tudo o que
> vem da API entra no DOM por `textContent`, nunca `innerHTML` (título/descrição são texto da
> diretoria) — provado por teste que **falha** se alguém trocar por `innerHTML` (verificado por
> mutação). Datas da API são horário local sem fuso: `lib/datas.ts` fixa `America/Belem` (UTC-3),
> senão um visitante em outro fuso veria o horário errado.
>
> **Achados desta versão** (todos tratados ou registrados abaixo):
>
> - **CORS (corrigido)**: `GET /api/publico/eventos` existia desde a v4.5, mas só o painel estava
>   liberado em `app/main.py` — a ilha falharia **só no navegador** (o `curl` funcionaria). O site
>   (`https://asaf.org.br`) e o dev local (`:4321`) entraram na lista; só rotas `/api/publico/...`
>   servem a ele, o resto segue exigindo JWT. `tests/test_cors_site.py` (5 testes) — falha se a
>   origem sair da lista e se uma origem desconhecida for liberada. Produção: `CORS_ORIGINS` não
>   está definido no `asaf-api`, vale o padrão do código.
> - **Para a v5.2 (páginas de evento)**: a API pública devolve **todo** evento público, inclusive
>   os já realizados (a ilha filtra no cliente), e `Evento` **não tem campo de status/cancelamento**
>   — um evento cancelado não consegue ser representado. Decidir antes de publicar página de
>   evento. A API também não expõe o valor da inscrição (`offers` do `schema.org/Event`) nem
>   imagem; o construtor omite em vez de inventar.
> - **Dado institucional fora de propósito — RESOLVIDO em 2026-10-01 (v5.0a, abaixo)**: o usuário
>   informou e confirmou CNPJ, telefone e e-mail, e confirmou que o endereço do Estatuto não mudou.
>   Na v5.0 original só cidade/UF eram publicados, porque o Estatuto traz "sede provisória" de
>   2013 e para emendas parlamentares esses dados não podem estar errados.
> - **Identidade visual — RESOLVIDO em 2026-10-01 (v5.0a, abaixo)**: a pergunta era se a marca
>   era o azul do painel ou o azul-marinho/dourado da página provisória antiga. O usuário definiu:
>   **verde (primária), ouro (secundária), azul claro (terciária)** e enviou a logo institucional.
> - **Cabeçalhos de segurança**: o Static Web App já envia `Strict-Transport-Security` e
>   `X-Content-Type-Options` por padrão (conferido em produção). CSP e `X-Frame-Options` ficam na
>   **v5.7** (era v5.5), quando houver páginas e ilhas reais para escrever uma CSP correta.
> - **`www.asaf.org.br` não resolve** (sem registro DNS). Decidir se vale criar com redirecionamento.
> - Dark mode do site não existe (tokens `.dark` existem). Sem JavaScript, a ilha some e o
>   `<noscript>` explica (defeito achado pelo próprio teste e corrigido antes do envio).
>
> **Testado (local, duas rodadas completas)**: `pytest` **389/389**; painel lint/Prettier/`tsc`/
> Vitest/Playwright (10 e2e) verdes; site **36 testes unitários**, **22 e2e** no navegador (axe
> WCAG 2.1 A/AA em desktop e 375 px, SEO, links internos, ilha em cada estado, XSS, sem JS) e
> Lighthouse **100/100/100/100** (desempenho/acessibilidade/melhores práticas/SEO; LCP ≈ 1 s, 8 KB
> transferidos). Os portões foram verificados por mutação (imagem sem `alt` reprova o axe).
> A auditoria descobre as páginas **pelo sitemap**: página nova entra sozinha, sem editar teste.
>
> **Confirmado em produção (2026-10-01, commit `6300968`)**: workflows `Deploy API`, `Deploy Painel`
> e `Deploy Site` verdes; `asaf.org.br/version.json` **e** `painel.asaf.org.br/version.json`
> devolvendo `6300968`; `robots.txt`, `sitemap-0.xml` (só a home) e `og-padrao.png` (1200×630)
> respondendo 200; página inexistente devolve **status 404 real** com a página própria
> (`noindex`); `/_astro/*` com cache imutável e `version.json` com `no-store`. CORS ao vivo: a
> origem do site recebe `access-control-allow-origin`, uma origem desconhecida **não**. Num
> **navegador real** (Chromium) carregando `https://asaf.org.br` contra a API de produção: a ilha
> terminou em "Nenhum evento aberto no momento" (a API devolve `[]` — não há evento público
> cadastrado), **zero erro de console, zero requisição falha**. Painel em produção: mesmo CSS
> (`index-DjBCh0k1.css`), tokens aplicados; o único 401 no console é o `POST /auth/refresh` da
> checagem de sessão de visitante deslogado (comportamento já existente). Disparo manual
> (`gh workflow run deploy-site.yml`) testado ao vivo: pula os portões e publica, com o passo
> "Confirma no ar" passando — é o caminho que o Directus vai usar.
>
> **Ainda não verificado em produção**: o Flow do Directus (v5.3, era v5.1) e qualquer evento real
> aparecendo na ilha — hoje a lista é vazia, então o desenho da lista com dados reais foi
> validado só contra a API simulada (e2e) e contra o formato real do serializador, não contra um
> evento de verdade vindo do banco de produção.
>
> **v5.0a (2026-10-01) — marca, logo e dados institucionais reais**
>
> Resposta do usuário às duas pendências da v5.0, aplicada no mesmo dia. **Paleta** (tirada da
> logo, em `design/tokens.css`): primária **verde bandeira `#145238`**, secundária **amarelo ouro
> `#E3C435`**, terciária **azul claro `#5FBBE9`** — o tom exato do azul o usuário ainda vai
> informar (hoje é o azul claro da própria logo, **provisório**). Como `design/` é fonte única,
> **o painel também ficou verde**. Ouro e azul entraram como tokens de marca próprios
> (`--brand-secondary`, `--brand-tertiary`); os neutros do shadcn (`--secondary`, `--muted`)
> continuam cinza de propósito, senão toda superfície cinza do painel viraria amarela. Contraste
> WCAG **calculado** para cada combinação (texto claro sobre o verde 8,75:1; verde-escuro sobre
> ouro 9,47:1 e sobre o azul 7,57:1; no tema escuro o verde sobe para 7,4:1 sobre o fundo) — o
> axe do CI confirma no site montado.
>
> **Logo institucional em todo lugar** (pedido explícito: "vai estar em todo lugar, inclusive nas
> pesquisas"): o arquivo-mestre é o PNG 2607×2160 transparente (`design/logo/`); `npm run logos`
> (em `site/`) gera e distribui os derivados (160/640/600 px, `favicon.ico`, ícones 48/192/512,
> `apple-touch-icon`). Usada no cabeçalho e destaque do site, ícone da aba, imagem ao compartilhar
> um link (OG, refeita com a logo), **`Organization.logo` nos dados estruturados do Google**, e no
> login e cabeçalho do painel. **Não** usada ainda em documentos gerados pelo sistema
> (certificados, carteirinha) — fazer quando cada um for retrabalhado. O SVG vetorial do
> CorelDRAW **não está no repositório** (veio só no texto da conversa, não como arquivo no
> computador): para a web o derivado no tamanho certo pesa muito menos, mas impressão/ampliação
> grande pede o vetor — salvar em `design/logo/asaf-logo.svg`.
>
> **Dados institucionais publicados** (informados e confirmados pelo usuário): CNPJ
> `17.631.942/0001-70`, telefone `(94) 98412-0703`, e-mail `asaf@asaf.org.br` (o institucional já
> documentado na v3.2.1, Google Workspace) e endereço do Estatuto (Rua Paulo Afonso, 150 — Bairro
> da Paz, CEP 68515-000, Parauapebas — PA; confirmado inalterado). No rodapé (com links `tel:` e
> `mailto:`) e no JSON-LD (`taxID`, `telephone`, `email`, endereço completo). **Guardas**: o CNPJ
> tem teste de dígito verificador (`site/tests/organizacao.test.ts`, com teste do próprio teste);
> as três formas do telefone são verificadas como o mesmo número; o e2e confere que a logo
> carrega de verdade (`naturalWidth > 0`) e que cada ícone declarado responde 200 com imagem.
> Enquanto o Directus não entra, estes dados vivem em **um** lugar
> (`site/src/config/organizacao.ts`).
>
> **Defeito achado na verificação em produção (partida a frio da API) — corrigido**: logo após o
> deploy, a ilha de eventos terminou em "Não foi possível carregar os eventos agora", sem nenhum
> erro de console, e minutos depois a mesma chamada respondia em 1,1 s. O timeout de 10 s da ilha
> era curto para uma API que **escala a zero** (decisão de custo congelada) e não havia nova
> tentativa — o primeiro visitante depois de um período parado veria um erro por algo que se
> resolve sozinho. Correção: 2 tentativas de 20 s (repete só falha de rede/timeout/5xx, **nunca
> 4xx**) e um aviso "isso pode levar alguns segundos" depois de 4 s. 7 testes unitários e 2 e2e
> novos reproduzem o caso; verificado por mutação (com 1 tentativa eles reprovam).
>
> **Testado**: `pytest` 389/389; painel lint/Prettier/`tsc`/Vitest 27/Playwright 10 verdes; site
> 51 unitários, 29 e2e (axe WCAG AA com as cores novas) e Lighthouse 100/100/100/100 (LCP ≈ 1,4 s,
> 83 KB). **Em produção** (commits `79863b9` e `3502285`): site e painel nos commits certos; todos
> os arquivos da marca respondem 200 com o tipo certo; num Chromium real, hero e rodapé com
> `rgb(20, 82, 56)`, botão ouro `rgb(227, 196, 53)`, JSON-LD com CNPJ/telefone/e-mail/logo/rua/CEP,
> logos carregadas, painel com `--primary: 154.8 60.8% 20%`, zero erro de console (o 401 do painel é
> o `POST /auth/refresh` de visitante deslogado, comportamento existente).
>
> **Ainda não verificado em produção (v5.0a)**: a ilha, com a correção, diante de uma partida a
> frio **de verdade**. A causa do erro original é **hipótese**, não fato provado: sustentada por
> (a) o erro não deixou nenhuma linha no console (um timeout próprio não deixa; CORS ou HTTP de
> erro deixariam) e (b) minutos depois a mesma chamada respondia em 1,1 s. A medição com 7 min de
> ociosidade **não** reproduziu partida a frio (API em 0,83 s — leva bem mais que 7 min para
> escalar a zero). **Resultado do teste de ponta a ponta com ~25 min sem nenhuma chamada
> (2026-10-01, 11:02): NÃO reproduziu** — a API respondeu em 241 ms e a lista carregou
> normalmente. Ou seja, a hipótese de partida a frio da API **ficou enfraquecida, não
> confirmada**: a API tem `minReplicas: 0` mas não esfriou em 25 min. (O Directus, esse sim,
> teve partida a frio real, medida: `GET /server/ping` em 33 s.) A **causa do erro original
> segue desconhecida** — o que se sabe é que foi uma resposta que passou de 10 s (ou de uma
> falha sem linha no console) e que, depois, a mesma chamada passou a responder em ~1 s. A
> correção (2 tentativas de 20 s + aviso de demora) continua valendo por si: cobre qualquer
> demora ou falha passageira, qualquer que seja a origem. Se acontecer de novo, registrar a hora
> exata para cruzar com os logs do Container App. **Dado novo (mesmo dia, depois do deploy do
> Lote 1)**: a primeira chamada à API logo depois de a revisão nova subir levou **23,4 s**
> (`GET /api/publico/eventos`) — a API **tem** janelas de espera longa, o que torna a hipótese
> de partida a frio/troca de réplica plausível de novo, embora ainda não provada como causa do
> erro original; as 2 tentativas de 20 s cobrem esse caso. **PARTIDA A FRIO DA API CONFIRMADA
> (2026-10-02)**: depois de mais de meia hora parada, a primeira chamada levou **21,2 s** — já
> são duas medições de 21 a 23 s (e o Directus, 33 s). Como 20 s abortava a 1ª tentativa um
> instante antes de a API responder, o tempo por tentativa da ilha passou para **35 s**
> (`site/src/lib/eventos-dom.ts`); a 2ª tentativa fica para falha de verdade. A API continua
> `minReplicas: 0` (decisão de custo); manter 1 réplica sempre ligada elimina a espera, ao custo
> de alguns dólares por mês — decisão do usuário, não tomada.

#### v5.1 — Directus como CMS de conteúdo

> **Replanejamento (2026-10-03):** o que ficou **aberto** aqui — chave de automação, chave do plano
> gratuito, chave da conta de armazenamento, usuário de serviço + token, coleções, fluxo editorial,
> papéis de privilégio mínimo e biblioteca de mídia — **foi movido para a v5.3** (abaixo), que também
> carrega as Notícias. O que já está feito e provado nesta versão (Directus 12.4.1, isolamento do banco
> 16/16, logotipo, atalho no painel) continua valendo.

> **v5.1.0 — Pré-requisitos (2026-10-01)**: o usuário pediu acesso ao Directus para criar a conta,
> registrar a chave do plano gratuito e gerar a chave de API que o site vai usar. Levantamento
> feito no Azure e na documentação oficial; o que está pronto, o que depende do usuário e o
> **achado que bloqueia a v5.1** estão abaixo.
>
> - [x] **Endereço definitivo `cms.asaf.org.br`** (CNAME + TXT `asuid.cms` + certificado
>       gerenciado) e `PUBLIC_URL=https://cms.asaf.org.br` no Container App — confirmado: HTTPS
>       200, Studio abre. Definitivo porque a chave de licença fica amarrada ao `PUBLIC_URL`.
> - [x] **Usuário administrador do responsável** (`asaf@asaf.org.br`, papel Administrator),
>       criado e **verificado** (login 200, poder de administração 200). Senha temporária entregue
>       ao usuário na conversa; **trocar no primeiro acesso e ativar MFA** (Studio → perfil).
>       **Correção do mesmo dia (reclamação do usuário, procedente em parte)**: a senha
>       temporária era aleatória e o usuário não achou onde trocá-la — a instrução (perfil →
>       campo *Password*, confirmada na documentação) estava certa, mas não foi verificada na
>       tela e deveria ter vindo com link direto. **O administrador de instalação
>       `admin@arcadafamilia.org` não foi criado nesse dia**: é o `ADMIN_EMAIL` do Container App,
>       configurado em 2026-09-10 pela configuração inicial do projeto. **Os dois domínios
>       (esclarecimento do usuário, conferido com `az account show`)**: `arcadafamilia.org` é o
>       domínio do **tenant Microsoft/Azure** (tenant "ASSOCIACAO ARCA DA FAMILIA - ASAF"); a
>       conta master do Azure é `asaf@arcadafamilia.org` e serve **só para entrar no Azure** —
>       o registro anterior deste plano, de que esse domínio "não era da associação", **estava
>       errado**. O que **não existe** é a caixa `admin@arcadafamilia.org` (o `ADMIN_EMAIL` do
>       Directus foi inventado no provisionamento; nunca recebe e-mail). `asaf.org.br` é o domínio
>       **nacional e oficial** (site, DNS no Azure, e-mail no Google Workspace) e é com ele que
>       tudo público e toda identidade nova deve sair; o internacional é para sair de cena nos
>       próximos tempos, por custo (plano do usuário; migrar a conta master do Azure ficará para
>       uma versão própria). **Administrador `admin@arcadafamilia.org` REMOVIDO em
>       2026-10-02**: ficou suspenso (login 401, provado) até a aplicação do isolamento, quando foi
>       reativado só o tempo de autenticar e **apagado pela API do Directus** (HTTP 204), depois de
>       conferir no banco que a conta real era ativa e administradora; ao final só sobrou
>       `asaf@asaf.org.br`, ativa e administradora (conferido no banco). O `ADMIN_EMAIL` do
>       Container App já é `asaf@asaf.org.br`. **Atenção — sem administrador de reserva**: o
>       Directus não tem e-mail de recuperação (nenhuma variável `EMAIL_*`); se a conta real
>       perder a senha, a recuperação é por SQL (papel `directus_app` + hash argon2). Configurar o
>       e-mail do Directus (os segredos de SMTP já existem no Key Vault) na v5.1, junto com o
>       convite de editores. Combinado com o usuário (2026-10-01). Contexto: o domínio internacional só serve de "chefe do Azure"; no futuro o
>       login da Microsoft vai migrar para outro domínio (que pode nem ser nenhum dos dois em uso
>       hoje), e a conta master `@arcadafamilia.org` muda junto — por isso nada novo deve
>       depender dela.
> - [x] **Identidade do git trocada para `asaf@asaf.org.br`** (`.git/config` local, a pedido do
>       usuário em 2026-10-01: "a partir de hoje tem que sair no org.br"). Vale para os commits
>       novos; o histórico (147 commits como `asaf@arcadafamilia.org`) não é reescrito.
> - [x] **Chave de automação do Directus no Key Vault — BLOQUEADA pelo sistema de segurança do
>       Claude Code** (regra "escrita em cofre de segredos", 2026-10-01): a tentativa de gerar um
>       token estático para a conta real e gravá-lo em `DIRECTUS-ADMIN-TOKEN` foi negada, e não
>       foi contornada. Nada depende disso até as coleções (v5.1); opções: o usuário libera a
>       regra, ou grava o segredo pelo Portal do Azure (Cofre → Segredos → Gerar/Importar).
>       **Resolvido de outro jeito (2026-10-03, decisão do usuário; conferido em 2026-10-19):** o token de administrador fica cifrado em `CREDENCIAIS_AZURE.md` (SOPS), lido só em memória (ver a v5.3); o Key Vault não recebeu `DIRECTUS-ADMIN-TOKEN`.
> - [x] **Atalho no painel**: cartão "Editar o site" na tela inicial, visível a quem tem
>       `gerenciar_acesso` (presidência), abre o Directus em nova aba. É conveniência; quem
>       protege é o login do Directus. Papel de editor próprio (`editar_site`) nasce com os
>       papéis do Directus, abaixo.
> - [x] **Chave do plano gratuito (Open Innovation Grant) — o usuário JÁ TEM a chave, mas não há
>       onde digitá-la: a aba Settings → License NÃO existe na versão em uso.** Achado de
>       2026-10-01: o sistema de licença é da **versão 12** do Directus (licença *Monospace
>       Sustainable Core License*, MSCL); a instância roda a **11.17.4**, que não tem a aba. A 12
>       existe (12.4.1 no Docker Hub). **Atualizar para `directus/directus:12.4.1`** (imagem
>       fixada, não flutuante) é pré-requisito para ativar a chave. Conferido na documentação
>       oficial para o nosso caso (instalação nova, PostgreSQL, sem extensões, sem conteúdo):
>       (1) `IP_TRUST_PROXY` passa a `false` por padrão e atrás do proxy do Container App precisa
>       ser `true`; (2) `/server/health` passa a exigir login (o Container App não tem sondas
>       apontando para ele — conferido); (3) instâncias novas rodam no plano *core* com
>       enforcement, a chave do subsídio libera os limites e o enforcement nunca apaga dados;
>       (4) o relato de falha de migração na 12.4.1 na comunidade é de banco vindo de outro tipo
>       de base, não atinge instalação nova. Para a v5.1 em diante, a consulta de conteúdo
>       publicado muda para `?version=published` (era `?version=main`). Ativação: Studio →
>       Settings → License, **digitada pelo próprio usuário** (a chave se amarra ao
>       `PUBLIC_URL` `https://cms.asaf.org.br`, até 5 ativações).
>       **ATUALIZADO em 2026-10-01 (autorizado pelo usuário: "tem que atualizar")**: a primeira
>       tentativa foi bloqueada pelo sistema de segurança do Claude Code (regra "deploy em
>       produção", por ser versão maior sem autorização explícita) e **não foi contornada**; com a
>       autorização explícita na conversa, o Container App `asaf-directus` foi para
>       `directus/directus:12.4.1` (revisão `asaf-directus--0000002`) com
>       `IP_TRUST_PROXY=true` e `ADMIN_EMAIL=asaf@asaf.org.br`. **Verificado**: log com a
>       migração da 12 aplicada ("Null Item Versions") e `Server started`; `GET /server/ping` 200;
>       Studio abre; `GET /server/health` sem login devolve **403** (comportamento da 12); modo de
>       revisão único com 100% do tráfego na nova e a antiga desativada; dados continuam 403 para
>       visitante (associados, doações, usuários). Plano de volta: reaplicar a imagem 11.17.4
>       (as tabelas `directus_*` só tinham 2 usuários e configuração padrão — se a migração
>       impedisse a volta, recria-se do zero, e o `ADMIN_EMAIL` corrigido recria a conta real).
>       **Falta só o usuário digitar a chave em Settings → License.**
>       **Feito (conferido em 2026-10-19):** a chave foi aplicada em 2026-10-03 (`license.source = settings`, "OIG") e as 8 permissões que dependiam dela foram criadas; `verificar --producao` limpo (ver a v5.3).
> - [x] **Chave `SECRET` do Directus curta demais — CORRIGIDA em 2026-10-02** (aviso do log da
>       12): tinha **27 caracteres** (o Directus exige ≥ 32; ela assina os tokens de sessão).
>       Trocada por uma aleatória de **64 caracteres**, no Key Vault (`DIRECTUS-SECRET`) e no
>       segredo do Container App (comprimentos conferidos: 64 e 64, valores iguais, sem imprimir),
>       e a revisão foi reiniciada; o aviso **sumiu** do log. Efeito esperado: sessões abertas
>       encerradas (entrar de novo); tokens estáticos não são afetados. Feito com o usuário no modo
>       manual (a gravação de segredo é bloqueada para o Claude no modo automático).
> - [x] Nota do log da 12 (`perfil_permissao` do sistema aparecendo sem chave primária):
>       **desapareceu** do log depois do isolamento — prova indireta de que o Directus já não
>       enxerga as tabelas do sistema.
> - [x] **Isolar o Directus do banco do sistema — PRÉ-REQUISITO, antes de qualquer editor ou
>       coleção nova.** **Achado de 2026-10-01**: o Directus compartilha o Postgres e conecta com
>       o mesmo usuário poderoso da API, então `GET /collections` (com login de administrador)
>       lista **todas as tabelas do sistema** — `associados`, `doacoes`, `audit_log`,
>       `codigos_recuperacao_mfa`, `credenciais_webauthn`, `dados_bancarios_fornecedor`,
>       `usuarios`… mais de 100. Um administrador do Directus lê e edita dado de associado e
>       financeiro **sem passar pelo RBAC nem pelo `AuditLog` da API** (a DECISÃO §5.4 garante só
>       que o Directus *possui* as tabelas `directus_*`, não que *não enxerga* as outras).
>       **Hoje não há vazamento aberto**: sem login tudo devolve 403 (conferido ao vivo em
>       associados, doações, audit_log, usuários, papéis, arquivos) e o cadastro público está
>       fechado. **Estado: APLICADO E PROVADO EM PRODUÇÃO em 2026-10-02**
>       (autorizado pelo usuário, com ele no modo manual; no modo automático o classificador de
>       segurança negou a execução e isso **não foi contornado**):
>       *Desenho* (mesmo banco, mesmo servidor, **custo zero** — não é banco separado): papel
>       `directus_app` (sem superusuário/CREATEROLE/CREATEDB, senha própria de 64 caracteres) e
>       schema `directus` só dele; as 33 tabelas `directus_*` saem de `public` e vão para lá; o
>       Directus passa a `DB_USER=directus_app`, `DB_SEARCH_PATH=directus`, `DB_PASSWORD` →
>       segredo novo `dbpasswordapp` — assim ele **nem lista** as 123 tabelas do sistema. A
>       integração com o sistema continua pelos caminhos certos: o site lê evento/transparência
>       da API pública do FastAPI, e o Directus só guarda a *divulgação* ligada por `evento_id`
>       (DECISÃO §3.4/§5.4) ou lê uma VIEW de campos públicos concedida de propósito.
>       *Ferramentas versionadas*: `scripts/isolar_directus.py` (`aplicar`/`verificar`/`reverter`,
>       idempotente, transação única, verificação antes do commit) e
>       `scripts/aplicar_isolamento_directus_producao.py` (orquestra: 1. segredo → 2. banco →
>       3. configuração, e reverte o banco se o passo 3 falhar; se o passo 1 falhar, aborta com o
>       banco intocado). *Ensaio* num banco descartável do próprio servidor, **15/15
>       verificações**: o papel lê, escreve e **altera** (o que as migrações do Directus fazem) as
>       tabelas dele e cria coleções no próprio schema; é **barrado** em todas as tabelas do
>       sistema (e nem resolve os nomes); não cria tabela em `public`, papel nem banco; o
>       verificador **reprova** quando se injeta um `SELECT` indevido; aplicar duas vezes é
>       idempotente; `reverter` devolve tudo. *Pré-levantamento de produção*: 156 tabelas em
>       `public` (33 `directus_*` + 123 do sistema), todas de dono `asafadmin` — que é também o
>       usuário com que o Directus conecta —, 8 sequências, sem FK entre os dois grupos, sem
>       views/enums, sem privilégios padrão, backup de 35 dias com georredundância.
>       *Aplicação (2026-10-02)*: `scripts/aplicar_isolamento_directus_producao.py` — segredo
>       `dbpasswordapp` no Container App → banco numa transação (papel criado, **33 tabelas
>       movidas** de `public` para `directus`, verificação antes do commit) → Directus na revisão
>       `asaf-directus--0000003` com `DB_USER=directus_app`, `DB_SEARCH_PATH=directus`. A senha
>       do papel (64 caracteres) existe só no segredo `dbpasswordapp` do Container App (não foi
>       impressa nem gravada em arquivo); para rotacionar, rodar o script de novo (o papel já
>       existe, só a senha muda). *Prova em produção, conectando COMO `directus_app`*
>       (**16/16**): lê as tabelas do Directus; é **barrado** em `associados`, `doacoes`,
>       `audit_log`, `usuarios`, `credenciais_webauthn`, `codigos_recuperacao_mfa`,
>       `dados_bancarios_fornecedor` e `lancamentos_contabeis` ("permission denied"); não cria
>       tabela em `public`, papel nem banco; **não enxerga nenhuma tabela** de `public`
>       (`information_schema`); o verificador do administrador aprova; o banco mostra o Directus
>       conectado como `directus_app` e só a API como `asafadmin`. Depois: API do sistema 200 e
>       `/openapi.json` 200; Directus responde `ping` 200 e devolve 403 a visitante em
>       `associados`, `doacoes`, `users` e `collections`; site e painel 200. Reexecutável a
>       qualquer momento: `DATABASE_URL=… python scripts/isolar_directus.py verificar`. **Regra
>       daqui para a frente: coleção nova do Directus nasce no schema `directus`; para o Directus
>       ler dado do sistema, conceder SELECT em uma VIEW de campos públicos, nunca na tabela.**
> - [x] **Firewall do Postgres — duas regras para a máquina do usuário (2026-10-02)**: a internet
>       dele **alterna entre dois endereços**. `AllowAdminMachine` = `45.7.26.120` (a original) e
>       `AllowAdminMachine2` = `177.87.165.132` (criada agora). *Correção de um erro meu do dia
>       anterior*: eu havia trocado a regra original pelo segundo IP tratando o primeiro como
>       "antigo, que podia nem ser mais da associação" — era o IP dele; o banco parou de responder
>       quando a internet voltou ao primeiro. Quando o banco não responder desta máquina, conferir
>       o IP atual (`curl https://api.ipify.org`) contra
>       `az postgres flexible-server firewall-rule list -g Associacao-RG -s asaf-pg-server` e, se
>       for um terceiro endereço, criar mais uma regra (`firewall-rule create ... --server-name
>       asaf-pg-server --name <regra>`). `AllowAzureServices` (API, Directus, GitHub Actions) não
>       foi tocada (DECISÃO §5.3).
> - [x] **ACHADO GRAVE — arquivos enviados à API somem a cada deploy/reinício** (2026-10-01; **CORRIGIDO e provado em produção em 2026-10-02**): a
>       API grava foto de associado, ata e documento anexado em disco local do contêiner
>       (`uploads/fotos`, `uploads/atas`, `uploads/documentos`, ver `app/main.py`) e o Container
>       App `asaf-api` **não tem volume persistente** (`volumes: null`). O disco do contêiner é
>       descartado a cada nova revisão, reinício e quando a réplica escala a zero. **Nenhum
>       documento do projeto menciona isso.** O `ARQUITETURA.md` prevê Blob Storage para
>       "fotos, documentos anexados", mas a API **não usa Blob** (conferido: nenhuma referência a
>       Blob/Storage no código). Corrigir antes de qualquer associado depender de foto ou ata:
>       gravar no Blob (contêiner próprio, ver o item seguinte) e servir por URL assinada ou rota
>       da API. **Decisão do usuário** (é mudança de armazenamento de dado de associado).
>       **NO AR desde 2026-10-02 (commit `ed5b06d`) e ACEITO com upload real.** O usuário mandou corrigir **e travar para não voltar a acontecer**.
>       Implementado: `app/services/armazenamento.py` (Blob em produção, pela identidade gerenciada;
>       disco só em dev/teste), rota `GET /uploads/{pasta}/{nome}` (`app/routers/arquivos.py`,
>       substitui o `StaticFiles` que lia o disco efêmero), os 4 pontos de gravação (foto de
>       associado, ata assinada, comprovante, documento emitido) convertidos. Nomes **aleatórios**
>       em tudo — antes `fotos/{id}.jpg` e `atas/{id}.pdf` eram enumeráveis num diretório servido
>       sem login (risco de LGPD). Foto antiga só é apagada depois de o banco apontar para a nova;
>       ata anterior **nunca** é apagada (valor jurídico; o caminho vai para a auditoria). **Travas**:
>       (1) API rodando no Azure sem `ARMAZENAMENTO_BLOB_URL` **recusa subir** (nunca cai em silêncio
>       no disco efêmero); (2) na partida ela grava, lê e apaga uma sonda no Blob — se identidade,
>       papel ou rede falharem, a revisão nova não fica saudável e a anterior segue servindo (o erro
>       aparece no deploy, não no upload de um associado semanas depois); (3) teste de arquitetura
>       proíbe qualquer módulo de `app/` gravar em disco fora do serviço (e foi conferido que ele
>       pega o código antigo). `pytest` 432/432 duas vezes (43 testes novos, com cliente Blob falso).
>       **Desenho da nuvem**: conta **nova e privada** `stasafprivado` (GRS, sem chave de conta, sem
>       acesso público, TLS 1.2, soft delete 30 dias + versionamento), contêineres `fotos-associados`,
>       `atas`, `comprovantes`, `documentos-emitidos`; papel "Storage Blob Data Contributor" **só**
>       para a identidade da API — tudo em `infra/armazenamento-privado.sh` (idempotente).
>       **Como foi ligado e verificado em produção**: o classificador negou o script (concessão de
>       papel); o usuário liberou em modo manual. Na primeira execução o Git Bash do Windows
>       reescreveu `--scope /subscriptions/...` como caminho de arquivo (`MissingSubscription`) —
>       corrigido no script com `MSYS_NO_PATHCONV=1`. Conferido **no Azure** (não só pela mensagem do
>       script): conta `stasafprivado` Standard_GRS, TLS 1.2, `allowSharedKeyAccess=false`,
>       `allowBlobPublicAccess=false`, soft delete de blob e de contêiner 30 dias, versionamento
>       ligado, 4 contêineres sem acesso público, papel "Storage Blob Data Contributor" **só** na
>       conta nova (a identidade da API segue com apenas `AcrPull` + esse papel), `ARMAZENAMENTO_BLOB_URL`
>       na API. Só depois do papel propagar foi feito o push: `Deploy API` verde (pytest + migração +
>       build no ACR), revisão `asaf-api--0000072` **Healthy, 100% do tráfego**, imagem `ed5b06d`; o log
>       da partida mostra `armazenamento de arquivos: Azure Blob (https://stasafprivado.blob.core.windows.net)`
>       e `Application startup complete` ~2 s depois — ou seja, a **sonda de gravar/ler/apagar passou**
>       com a identidade gerenciada (se falhasse, a revisão não subiria). `GET /uploads/...` inexistente,
>       com pasta inválida e com `..%2F` → 404; `/api/publico/eventos` → 200. **Aceitação (2026-10-02)**: o
>       usuário enviou a própria foto pelo painel (única `pessoas.foto` em `/uploads`: pasta `fotos`,
>       nome aleatório de 32 hex + `.jpg`, 175.936 bytes). Sem login, só pela rota pública: antes do
>       reinício → 200 `image/jpeg`, 175.936 bytes; `az containerapp revision restart` (réplica nova,
>       disco zerado) e, depois de ociosa, escala a zero e nova partida a frio às 13:45 (o log mostra
>       Blob + `Application startup complete` em 1,3 s) → **200, mesmo conteúdo (SHA-256 idêntico)**.
>       Ou seja: o arquivo sobrevive a reinício e a escala a zero, que era exatamente o defeito. A
>       sonda de partida custou ~1–2 s na partida a frio. Antes disso, nenhum registro de produção apontava para
>       `/uploads` (0 de 0, conferido em 2026-10-01): nada se perdeu até aqui. **Fica para depois**:
>       download autenticado / URL assinada de curta duração (hoje o nome aleatório é a única
>       barreira, como já era). **"API sempre ligada" NÃO será feita** — decisão do usuário em
>       2026-10-02 (ele estimou mais de US$60/mês a mais e não quer agora; reavaliar quando houver
>       muitos associados): a partida a frio de 21–23 s permanece e a ilha de eventos do site já
>       espera 35 s.
> - [ ] **Chave da conta de armazenamento no Directus**: o Directus guarda arquivos no contêiner
>       `uploads` da conta `stasafarcadafamilia` usando a **chave da conta inteira**
>       (`STORAGE_AZURE_ACCOUNT_KEY`), que também alcança `documentos-institucionais` e qualquer
>       contêiner futuro — o mesmo tipo de excesso de privilégio do banco. Hoje a API não usa
>       essa conta, então o alcance é pequeno; passa a importar quando a API for para o Blob.
>       Correção: conta de armazenamento própria do Directus, ou SAS restrito ao contêiner
>       `uploads` em vez da chave da conta. Depende de gravar segredo.
>       **Esclarecimento ao usuário (2026-10-01) — como o armazenamento do Azure é organizado**:
>       *conta de armazenamento* (o "bloco" inteiro) → *contêineres* (as "pastas" de topo:
>       `uploads`, `documentos-institucionais`, e no futuro `fotos-associados`, `atas`,
>       `documentos-anexados`) → *blobs* (os arquivos; "subpastas" são só prefixos no nome do
>       arquivo). Guardar foto/ata/documento no Blob **resolve** o sumiço de arquivo da API
>       (o armazenamento é persistente e fora do contêiner). A **chave da conta** abre todos os
>       contêineres da mesma conta — por isso o Directus, com ela, enxerga o "bloco todo". Mas
>       não é obrigatório que ele acesse tudo: dá para entregar acesso **só a um contêiner**
>       (SAS restrito ou identidade com permissão no contêiner). Desenho proposto:
>       **duas contas** por nível de risco — uma *pública* (imagens do site e do Directus) e uma
>       *privada* (fotos de associados, atas, documentos anexados), a API com acesso à privada e
>       o Directus **só** à pública — e, dentro de cada conta, um contêiner por assunto. A
>       separação por conta é a forte; contêiner separado na mesma conta só isola de verdade se
>       o acesso for restrito por contêiner. **Decisão do usuário** antes de implementar.
> - [x] **Usuário de serviço + token estático somente-leitura** para o build do site, guardado
>       no Key Vault (`DIRECTUS-SITE-TOKEN`) — só depois das coleções de conteúdo e do papel
>       restrito. Com ele, o administrador pode ter MFA obrigatório (`enforce_tfa`) sem quebrar
>       automação.
>       **Feito na v5.3** (`criar-leitor --producao`; autoteste do token em produção). O MFA do administrador do Directus segue aberto (C2 do Fechamento da FASE 5).
> - [ ] Nota de saúde: `GET /server/health` do Directus devolve `warn` por tempo de resposta do
>       Postgres (518 ms contra limite de 150 ms) — latência do banco Burstable; acompanhar.

- [ ] Coleções: páginas institucionais, notícias, banners, galeria, depoimentos, parceiros,
      perguntas frequentes — **só conteúdo público**, nunca dado de associado/financeiro.
      **Situação (conferida em 2026-10-19): só a coleção `noticias` foi construída** (v5.3, com a ligação a projeto e a evento da v5.5). Textos de página, banners, galeria, FAQ, depoimentos e parceiros
      **não** existem no Directus; ver C6 do Fechamento da FASE 5 (decisão do Presidente).
- [x] Fluxo editorial com rascunho → revisão → publicado, agendamento de publicação e histórico de
      versão com possibilidade de reverter.
      **Feito na v5.3** (rascunho → revisão → publicado → arquivado, agendamento pela data "Publicar em", histórico de versões com reversão; o rascunho nunca chega ao site, provado ao vivo).
- [x] Papéis do Directus mapeados à realidade (editor de conteúdo x administrador), sem dar
      administrador para quem só escreve notícia.
      **Feito na v5.3:** 5 perfis (Editor de transparência, Editor de conteúdo, Redator, Colaborador de mídia, Leitor do site) criados em produção, nenhum com acesso de administrador. Restam, no
      Fechamento da FASE 5: o teste ao vivo dos demais perfis (C3) e o atalho `editar_site` (C4).
      > **Requisito do usuário (2026-10-01) — VÁRIOS perfis de acesso, desde já**: hoje só existe
      > o administrador (o próprio usuário), mas a FASE 5 e as seguintes vão ter muita gente
      > com funções diferentes, e **cada um só pode ter acesso ao que a função dele precisa**:
      > "só o editor de site, só o editor de outra coisa, só quem manda foto". Desenhar assim,
      > no Directus **e** no sistema (painel, `niveis_acesso`), e conferir a cada fase: (1)
      > **Administrador** (poucos, MFA obrigatório); (2) **Editor de conteúdo** (páginas e
      > notícias, publica); (3) **Redator** (escreve em rascunho, não publica — quem revisa
      > publica); (4) **Colaborador de mídia** (só envia imagens, sem ver nem editar texto);
      > (5) **Leitor de serviço do site** (token somente-leitura de conteúdo publicado, usado
      > no build); (6) um perfil por **tema** quando fizer sentido (ex.: transparência,
      > eventos). Regras: privilégio mínimo; permissão **no backend/papel**, nunca só esconder
      > na tela; papel de editor do Directus **sem** acesso a nenhuma tabela do sistema (depende
      > do isolamento acima); cada perfil novo entra com teste de "esta pessoa NÃO consegue
      > fazer X". No painel, o atalho "Editar o site" passa a ter permissão própria
      > (`editar_site`) em vez de reaproveitar `gerenciar_acesso`.
- [x] Biblioteca de mídia com texto alternativo **obrigatório** (acessibilidade não é opcional) e
      geração de tamanhos responsivos.
      **Feito na v5.3 para a foto da notícia (hoje o único uso):** texto alternativo e autorização de imagem obrigatórios; a foto sai em WebP de até 1280 px. Os tamanhos responsivos (`srcset`)
      ficaram como melhoria futura (seção F do Fechamento da FASE 5).

#### v5.2 — Páginas essenciais

- [x] Home, Quem Somos/História, Diretoria e Conselho (lendo os mandatos vigentes da FASE 2, nunca
      digitados de novo), Projetos (lendo os projetos públicos da FASE 4), Notícias, Agenda de
      Eventos (FastAPI), Transparência (FASE 3/12.7), Como Ajudar/Doe, Seja Voluntário, Seja
      Associado, Contato com mapa, Política de Privacidade e Termos de Uso versionados (FASE 7).
      **Conferido em 2026-10-19:** as 16 páginas existem em `site/src/pages` e respondem 200 em `asaf.org.br` (lista na seção G do Fechamento da FASE 5); o **mapa com pino** ficou adiado por
      decisão do Presidente (seção F).
      > **Pendências registradas pela v2.0/v2.1 (2026-09-15)**, já prontas para esta página
      > consumir: "Diretoria e Conselho" lê `GET /api/mandatos/?apenas_vigentes=true` (v2.1) -
      > nenhum nome de dirigente digitado à mão no site. Uma página "Estatuto" (ou seção dentro de
      > "Quem Somos") pode expor o documento vigente (`DocumentoEstatuto`, v2.0) para download -
      > hoje só existe `caminho_arquivo="ESTATUTO_ASAF.txt"` apontando pro arquivo na raiz do
      > repositório, sem rota de upload/servir arquivo dedicada ainda.
      > **v5.2 — Etapa A ✅ (2026-10-03, commit `cf21b7e`) — páginas institucionais, sem tocar no
      > backend.** No ar: `/estatuto/`, `/quem-somos/`, `/seja-associado/`, `/seja-voluntario/`,
      > `/como-ajudar/`, `/contato/`, `/transparencia/`, `/privacidade/`, `/termos/` e a **Home
      > completa**. **Regra: nada inventado** — cada bloco cita o artigo do Estatuto de onde saiu
      > (ou a regra do sistema), e o que não existe em documento nenhum não foi preenchido. O
      > **Estatuto é lido do `ESTATUTO_ASAF.txt` da raiz** (a mesma fonte do sistema) por
      > `site/src/lib/estatuto.ts`; `tests/estatuto.test.ts` prova **palavra por palavra** que nada
      > se perde, repete ou troca de ordem (8 capítulos, 35 artigos, a oração com os 4 versos) e o
      > build **falha** se o formato mudar (melhor não publicar um Estatuto truncado).
      > "Seja associado" lê as exigências/direitos/deveres dos Arts. 12–14 do próprio Estatuto.
      > Navegação numa fonte única (`config/navegacao.ts`; menu de celular em `<details>`, sem
      > JavaScript; **Transparência e Privacidade sempre no rodapé**, adiantando um item da v5.7);
      > migalhas viram `BreadcrumbList` (schema.org). Privacidade e Termos **versionados**
      > (`DOCUMENTOS_LEGAIS`, v1.0 de 2026-10-03), escritos só com o que o site/sistema fazem hoje.
      > **Achados**: (1) a revisão **visual** (fotos do site montado) pegou que o Astro/Prettier
      > **colava palavras em links** ("Acesse *aárea*") — nenhum teste de acessibilidade/SEO vê isso;
      > corrigido em 4 páginas e `e2e/texto.spec.ts` reprova se voltar (verificado por mutação);
      > (2) **mapa**: o CEP 68515-000 é um CEP único da cidade inteira e o OpenStreetMap não conhece
      > a rua — **sem pino inventado**; o botão "Abrir no Google Maps" busca pelo endereço;
      > (3) o Estatuto (Art. 33, II) cita "II Crônicas 4:9-10" mas o texto da oração é de **1**
      > Crônicas 4:10 — **a referência do livro NÃO foi publicada** até o usuário confirmar. A
      > oração em si (cláusula pétrea) está em "Quem somos".
      > **Testado (2 rodadas)**: vitest 70; Playwright 84 (axe WCAG 2.1 AA desktop e 375 px em 11
      > páginas, SEO, links, texto); Lighthouse **100/100/100/100** em Home, Quem somos, Seja
      > associado, Estatuto e Contato (3 rodadas cada; antes só a Home era medida). **Em produção**:
      > `asaf.org.br/version.json` = `cf21b7e`; as 10 páginas respondem 200, página inexistente
      > devolve 404 real, sitemap com as 10 URLs, `/estatuto/` com 35 artigos e a oração; num
      > navegador real (Chromium, desktop e 375 px) **zero erro de console e zero requisição
      > falha**, menu de celular com 6 links, ilha de eventos contra a API real terminando em
      > "vazio" (não há evento cadastrado).
      > **v5.2 — Etapa B ✅ (2026-10-03, commits `a2d9861` API e `e1ec5f3` site, mais a correção
      > de textos abaixo) — dados vivos.** **API** (`app/routers/publico.py`, sem login, só GET,
      > lista explícita de campos): `/api/publico/diretoria`, `/projetos`, `/projetos/{id}`,
      > `/assembleias`, `/assembleias/{id}`. **Privacidade testada com mutação** (`tests/test_publico.py`,
      > 11 testes; plantei CPF/e-mail/telefone/foto e provei que não saem; vazar o link ou o CPF
      > reprova): diretoria só com mandato **vigente** e só nome, cargo, órgão e datas; projeto só
      > "Pública" (interno responde o **mesmo** 404 de um id inexistente); assembleia só **convocada**.
      > **ACHADO**: o texto do edital embute o **link de acesso remoto** ("Acesso remoto: …") e
      > publicá-lo daria a sala da assembleia a qualquer pessoa — a rota **remove** esse trecho e o
      > SHA-256 é calculado sobre o texto publicado. **Site**: páginas geradas no build lendo a API
      > (`/diretoria/`, `/projetos/` + `/projetos/<id>/`, `/eventos/` + `/eventos/<id>/` com
      > `schema.org/Event`, `/transparencia/assembleias/<id>/`), URLs **só com o id** (título editado nunca
      > quebra link compartilhado). **Se a API não responde, o build FALHA** (nunca publica site sem
      > dados). O que muda depois do build resolve no navegador: vagas livres, **evento retirado do ar**
      > (API 404 → aviso na hora) e "a data já passou". **Sincronização automática**
      > (`.github/workflows/sincronizar-site.yml`, a cada 30 min na v5.2; **15 min desde a v5.3**): compara a impressão do conteúdo da API
      > com `/conteudo.json` do site no ar e só então dispara o `deploy-site.yml` (sem token novo,
      > `actions: write`); a impressão ignora vagas livres. **`test:sincronizacao` pegou um laço
      > infinito antes de chegar à produção** (um campo do mock mudava a cada chamada: o site seria
      > reconstruído para sempre). **Estado vazio** (= produção hoje: 0 eventos, projetos, dirigentes,
      > editais) tem teste próprio (`test:vazio`). Revisão visual achou o **menu quebrando em duas
      > linhas** no computador — corrigido (cabe numa linha; menu de celular até 1024 px).
      > **Testado (2 rodadas)**: pytest 457; vitest 102; Playwright 150 (axe WCAG 2.1 AA em 20 páginas
      > × 2 telas, SEO, links, texto, dados vivos, evento retirado/vagas ao vivo); estado vazio;
      > sincronização; Lighthouse 100/100/100/100 em 7 páginas. **Em produção**: API revisão
      > `asaf-api--0000079` com as 5 rotas (200 com lista vazia, 404 igual, `POST` → 405, CORS do site);
      > site `e1ec5f3`, `conteudo.json` com contagens 0; **13 páginas** limpas no axe **no site real**
      > (desktop e celular), zero erro de console; o `sincronizar-site` disparado à mão concluiu "não
      > mudou" e **não** republicou.
      >
      > **Verificação de fatos independente (2026-10-03) — um agente leu o Estatuto inteiro e todas
      > as páginas contra o texto e o código; achou o que eu havia publicado errado ou exagerado.**
      > Cada alegação grave foi conferida no código antes de corrigir. **Corrigido** (privacidade e
      > termos subiram para v1.1): (1) a Home prometia **"carteirinha digital"** no painel — **não
      > existe tela** (o código diz "sem tela ainda"); (2) "não precisa ser associado" para ser
      > voluntário era **falso na prática**: alocar em projeto **exige cadastro de Associado**
      > (`app/services/projetos.py`) — a página agora diz o que acontece hoje; (3) Art. 28 lido como
      > "**a** fonte primária" (são quatro fontes primárias; recurso público é "secundária e
      > excepcional", o que pesa em emenda parlamentar); (4) o Estatuto **determina** ("serão
      > integralmente aplicados"), e o site afirmava como fato consumado; (5) **Privacidade**
      > prometia o que o sistema não faz: eliminação automática por prazo, base legal por formulário
      > (o site nem tem formulário), consentimento de menor imposto pelo sistema, "só tratamos o que
      > você informar" (há dependentes, beneficiários, importação em lote) e não citava a publicação
      > de nome/cargo dos dirigentes; (6) evento sem endereço próprio era mostrado e declarado no
      > schema.org como **"na sede, presencial"** — o evento pode ser online; agora "a confirmar" e
      > `location` omitido; (7) "eventos realizados / já aconteceu" eram deduzidos só pela data (sem
      > status "cancelado") → "Eventos anteriores / a data já passou"; (8) "Onde atuamos" na Home
      > listava as 11 áreas do Art. 3º como atuação presente → "áreas previstas no Estatuto";
      > (9) menores: "local" no termo é opcional; horas só são aprovadas por coordenador quando
      > ligadas a projeto; o corpo do Estatuto é fiel mas os **títulos dos capítulos foram
      > padronizados** (a página agora diz isso); edital "na íntegra" removia o link remoto (dito);
      > nome/logotipo "pertencem" à associação (titularidade não verificada → "identificam").
      > **Confirmado correto**: todos os artigos citados e números (7 cargos, 3 conselheiros, 4 anos,
      > 16/18 anos, 35 artigos), as listas de exigências/direitos/deveres, as regras de voluntariado
      > (termo, menor com autorização, coordenador confirma), LGPD arts. 18/19, e que o site **não** tem
      > cookie/analítica/recurso de terceiro (código + respostas HTTP). **CNPJ 17.631.942/0001-70**:
      > dígitos corretos e a BrasilAPI confirma razão social, situação ATIVA e o endereço
      > (início de atividade na Receita 21/02/2013 × fundação 10/02/2013 do Estatuto: conceitos
      > diferentes; o site usa a do Estatuto). **Decisões que NÃO são minhas** (abertas, para o
      > usuário/diretoria): (a) hoje **voluntário não-associado não consegue ser escalado** em projeto —
      > mudar o sistema ou manter; (b) o catálogo `titulo_cargo` **não bate com o Art. 19**
      > ("Vice-Presidente" único, "Diretor de Patrimônio", "Diretor Social", "Conselho Fiscal" como
      > cargo) — **alinhar antes de cadastrar dirigentes reais**, pois o site exibe o rótulo do
      > catálogo; (c) **encarregado pelo tratamento de dados** (LGPD art. 41) e **revisão jurídica**
      > de Privacidade e Termos; (d) o que a Privacidade **não** promete mais (eliminação automática,
      > base legal por formulário, regra de menor no sistema, auditoria de consulta) é a **FASE 7** —
      > o texto só pode prometer quando o sistema fizer; (e) Estatuto Art. 33, II cita "II Crônicas"
      > (a oração é de 1 Crônicas 4:10) — **referência não publicada**; o Estatuto diz "sede
      > provisória" (o site omite "provisória", endereço confirmado pelo usuário); o Art. 34 cita um
      > "Conselho Administrativo" que o Art. 18 não lista; (f) titularidade do nome/logotipo (INPI);
      > (g) o Estatuto no site é o do sistema — confirmar que é a **versão registrada em cartório**;
      > (h) **mapa** só com coordenadas exatas (CEP único da cidade); (i) **Notícias** depende do
      > Directus (v5.3: coleções + token de serviço); (j) **inscrição em evento pelo site** (a API já
      > tem formulário, perguntas e consentimento) fica para a v5.5.
- [x] Página de cada projeto e de cada evento com URL estável e compartilhável (v5.2 etapa B).
- [x] **Publicação do edital de assembleia na área pública do site** (pendência da v2.2,
      2026-09-15): página pública `/transparencia/assembleias/<id>/` com o texto (sem o link de
      acesso remoto) e o código SHA-256 que identifica o texto publicado (v5.2 etapa B).

> **REPLANEJAMENTO DA FASE 5 — da v5.3 ao fim (2026-10-03, a pedido do usuário).** Duas coisas mudaram:
> (1) a ASAF **não recebe, mas poderá receber** emenda parlamentar e patrocínio (público ou privado) —
> o site precisa estar **pronto para receber antes** que isso aconteça (publicação em até 24 h é prazo
> de quem recebe, e site fora de conformidade pode ter repasse bloqueado); (2) o conteúdo que a diretoria
> edita (notícias, documentos, emendas, parcelas, pagamentos) passa a viver no **Directus**, para ser
> publicado **em minutos e sem programador**. Por isso entraram duas versões novas (**v5.3** Directus de
> verdade e **v5.4** Transparência e Emendas) e as antigas v5.3/v5.4/v5.5 viraram **v5.5/v5.6/v5.7**.
> O Ponto de Revisão (1/2) passa a fechar na **v5.4** (é aí que o site fica "pronto para receber").
> Itens ainda abertos da v5.1 (coleções, papéis, fluxo editorial, mídia, e-mail, token) e as **Notícias**
> da v5.2 foram **movidos para a v5.3**.
>
> **Requisitos recebidos do usuário** (arquivo `prompt-site-transparencia-emendas.md`, 2026-10-03):
> regra principal é **adaptar o site existente, não refazer** (mesma identidade visual e estrutura;
> página nova só para o que não existe). **Análise do site atual (v5.2) contra o arquivo:**
>
> | Req. | O que o arquivo pede | Hoje no site | Ação | Versão |
> | --- | --- | --- | --- | --- |
> | R1 | Link "Transparência" em destaque (menu, rodapé, Home), 1 clique | Já está no menu e no rodapé; na Home só há o cartão genérico "Contas claras" | Adaptar: cartão "Emendas parlamentares" em destaque | v5.4 |
> | R2 | Lista de todas as emendas, todos os anos, com 8 campos + situação; CSV/JSON | Não existe | **Nova** (`/transparencia/emendas/`) | v5.4 |
> | R3 | Por emenda: documentos (PDF pesquisável), parcelas, execução, pagamentos, relatórios, "última atualização" | Não existe | **Nova** (`/transparencia/emendas/<id>/`) | v5.4 |
> | R4 | Todas as parcerias com o poder público (7 campos) | Não existe | **Nova** (`/transparencia/parcerias/`) | v5.4 |
> | R5 | Documentos institucionais em PDF pesquisável | Só o Estatuto, como **texto** (HTML), sem PDF; falta ata, CNPJ, balanços, relatório anual | Adaptar `/transparencia/` + nova `/transparencia/documentos/`; **depende de documentos da diretoria** | v5.4 |
> | R6 | Diretoria com nome, cargo, mandato; sem CPF/endereço/telefone | **Já existe** (`/diretoria/`, sem dado pessoal além do nome); produção vazia | Só alinhar cargos ao Art. 19 e cadastrar dirigentes | v5.4 |
> | R7 | Contato também para pedido de informação sobre recursos públicos; prazo de resposta; link da Transparência | Contato já existe | Adaptar o texto; **prazo = decisão da diretoria**; formulário na v5.5 | v5.4 / v5.5 |
> | R8 | Projetos e "Despertai": calendário oficial do município; edições anteriores com datas, fotos, público | Projetos já existem (do sistema); Despertai não existe; não há fotos | Adaptar projetos + camada editorial no Directus; **depende de conteúdo e de documento comprobatório** | v5.4 |
> | Téc. | Atualizar sem programador | Hoje só por código | **Directus** | v5.3 |
> | Téc. | Só PDF pesquisável (OCR) | Não há PDF | Verificação automática no build | v5.4 |
> | Téc. | URLs permanentes; "Última atualização" automática | Padrão por id já existe nas páginas de dados vivos | Estender | v5.4 |
> | Téc. | Acessibilidade e celular | Já auditado no CI (axe, Lighthouse) | Manter o portão | todas |
> | Téc. | Foto de criança só com autorização | Não há foto | Campo obrigatório "autorização de imagem" | v5.3 |
> | Téc. | Site sempre no ar (comprovação) | Static Web App, sem monitor | Monitor a cada 15 min com histórico | v5.4 |
> | Téc. | `COMO-ATUALIZAR.md`; dado de exemplo marcado | Não existe | Criar; **exemplo só em teste/rascunho, nunca na produção** | v5.4 |
>
> **Base legal — pesquisada em fontes oficiais em 2026-10-03** (o usuário pediu: "use o arquivo e, se puder,
> pesquise as resoluções para uma base ainda mais sólida"). Rótulos: **[CONFERIDO POR MIM]** = li o texto
> no documento oficial; **[PESQUISA]** = relatado por um agente de pesquisa com a fonte indicada, ainda sem
> minha leitura do texto; **[NÃO CONFIRMADO]**. Isto **não substitui revisão jurídica**: é a base de que o
> desenho precisa e o que a página pública pode citar com segurança.
>
> - **IN nº 06/2025/TCMPA** (aprovada em 27/11/2025; DOE TCMPA nº 2.085, 11/12/2025, pp. 8–26) — **[CONFERIDO
>   POR MIM no PDF do Diário Oficial]**. Art. 17: a execução de **emendas parlamentares impositivas
>   municipais** por OSC (§ 2º) deve **publicar no próprio sítio, em local de destaque e fácil acesso**, os
>   valores recebidos, o nome do(a) **Proponente** (o vereador), a **íntegra do instrumento**, o **plano de
>   trabalho**, os **relatórios de execução** e a **prestação de contas**; (§ 3º) em **até 24 horas** do
>   recebimento de **cada parcela** ou de **qualquer etapa relevante** (liberação financeira, entrega de
>   bens, execução de serviços), com os documentos comprobatórios, em formato pesquisável; (§ 4º) **conta
>   corrente específica**, vedadas conta de passagem, conta compartilhada e saque em espécie (isto é da
>   diretoria/banco, não do site); (§ 5º) documentos em **PDF pesquisável (OCR)**, **vedado imagem ou
>   fotografia**. Também: o plano de trabalho deve comprovar que a OSC tem sítio de transparência (art. 16,
>   § 2º, IV, "c" — **[PESQUISA]**), e prestação de contas/relatório de gestão no sítio em 24 h
>   (arts. 22–23, **[PESQUISA]**), guarda por 5 anos (art. 24, **[PESQUISA]**).
>   **Limite de alcance:** o art. 17 trata das emendas **impositivas municipais**; o art. 48 estende "no que
>   couber" às federais/estaduais executadas por municípios; **patrocínio privado não é alcançado** (a
>   transparência dele é boa prática, não obrigação desta norma).
> - **Lei 13.019/2014, art. 11 e parágrafo único** — **[CONFERIDO POR MIM no texto compilado do Planalto]**,
>   redação vigente (Lei 13.204/2015): a OSC divulga "na internet e em locais visíveis de suas sedes"
>   **todas as parcerias** com a administração pública;
>   parágrafo único: data de assinatura, instrumento e órgão; nome da OSC e CNPJ; objeto; valor total e
>   liberado; situação da prestação de contas; **remuneração da equipe paga com a parceria e funções** (não
>   exige nome nem CPF). Art. 10 é do poder público. Cuidado: art. 47 § 4º e art. 33, IV, "b" foram
>   revogados **[PESQUISA]**. Os itens I–VI do parágrafo único conferem com a lista do arquivo do usuário.
> - **STF, ADPF 854** (e ADPFs 850/851/1014) — **[PESQUISA]**: ONGs executoras de emenda (qualquer
>   modalidade) respeitam transparência e rastreabilidade (CF art. 163-A + Lei 13.019 art. 69); 23/10/2025:
>   estados e municípios seguem o modelo federal, fiscalizado pelos tribunais de contas; as ordens a ONGs
>   foram dirigidas a entidades específicas. **15/01/2026: vedadas emendas a entidades com cônjuge,
>   companheiro ou parente até o 3º grau do parlamentar indicante, ou assessor dele, nos quadros diretivo
>   ou administrativo** — **alerta para a diretoria** conferir a composição da diretoria; **[NÃO CONFIRMADO]**
>   se vale para emenda municipal — mas o **art. 29 da lei de Parauapebas já exige declaração de que não há
>   parente até o 2º grau de vereador/prefeito/secretário na diretoria**. O site **não decide** isso.
> - **Lei Municipal nº 5.574/2025 de Parauapebas (8/7/2025)** — **[CONFERIDO POR MIM no texto integral que o
>   usuário enviou, 47 páginas, 2026-10-03]**. A sede da ASAF é em Parauapebas, então ela vale direto. Dispõe
>   sobre o regime das parcerias entre o Município e as OSCs (adapta a Lei 13.019). O que importa ao site e
>   à diretoria: **art. 5º, § 1º** — a OSC divulga **no seu sítio e nas sedes**, **da celebração até 180 dias
>   após a prestação de contas final**, as informações do art. 11 da Lei 13.019; **art. 10, § 5º** — emenda
>   parlamentar à LOA: parceria **sem chamamento**, pela **indicação da OSC na própria emenda**, observados
>   os arts. 29, 33 e 34 da Lei 13.019; **art. 27-A** — **prazo para receber proposta de parceria vinda de
>   emenda municipal: até 30 de junho de cada ano** (2025: 30 de agosto); **art. 28** — documentos que a OSC
>   apresenta (estatuto registrado, certidão de existência jurídica, **ata de eleição e posse**, CNPJ ativo há
>   1 ano, experiência prévia, certidões federal/FGTS/trabalhista/municipal, **certidão de registro no
>   SISPPAR**, relação nominal dos dirigentes com endereço, RG e CPF — **entregue à Prefeitura, nunca
>   publicada**, comprovante de endereço, declarações); § 4º: comunicar mudança de diretoria em até 30 dias
>   úteis; **art. 29** — declaração de que **nenhum dirigente é membro de Poder (inclui prefeito, vice,
>   secretários municipais e vereadores) nem parente até o 2º grau** de quem for, e que recursos não pagam
>   essas pessoas (**isto torna concreto o alerta da diretoria abaixo**); **art. 42** — pagamento por TED,
>   DOC, débito, Pix ou boleto, com nota fiscal e CNPJ/CPF do fornecedor; **art. 43, § 4º** — **ampla
>   transparência, também na plataforma, dos valores pagos de forma individualizada à equipe, com cargos e
>   valores** (a lei não exige nome); **art. 60** — rol de documentos da prestação de contas (inclui
>   **relatório fotográfico em arquivo digital**) e **art. 62** — prestação parcial em até **30 dias** do fim
>   de cada parcela e final em até **90 dias** do fim da vigência; **art. 68** — resultado: **contas
>   regulares / regulares com ressalvas / irregulares**; **art. 71** — análise em até **150 dias**;
>   **art. 64** — guarda dos originais por **10 anos**; **art. 83, I** — **apoio ou patrocínio não é
>   "parceria" para esta lei** (patrocínio privado segue legislação própria). A Prefeitura mantém o
>   **SISPPAR** (Sistema de Gerenciamento de Parcerias) e o canal de denúncias (art. 36, § 2º).
> - **Outras** (**[PESQUISA]**): LAI (Lei 12.527/2011, art. 2º, e parágrafo único) alcança entidade
>   privada sem fins lucrativos "no que couber" e só quanto à parcela dos recursos públicos e sua
>   destinação; Decreto 7.724/2012, art. 63 e Decreto 8.726/2016, art. 80 (só parcerias federais;
>   publicar até 180 dias após a prestação final); EC 105/2019 (transferência especial não exige convênio).
>   **LGPD**: não há regra expressa sobre CPF; omitir CPF/endereço/telefone pessoal vem do princípio da
>   necessidade (arts. 6º, I e III) — **decisão de desenho**, não regra textual.
>
> **Tarefas da diretoria que a lei municipal cria (fora do site, mas que o plano deve lembrar):** (a) **cadastrar a
> ASAF no SISPPAR** e obter a **certidão de registro** (art. 28, X); (b) abrir **conta corrente específica** para
> cada parceria (IN 06, art. 17, § 4º); (c) calendário: **proposta de emenda municipal até 30 de junho** (art. 27-A);
> (d) **comunicar mudança de diretoria em 30 dias úteis** (art. 28, § 4º) — a Diretoria do site precisa estar
> sempre em dia; (e) preparar as **declarações do art. 29** e conferir a composição da diretoria; (f) guardar os
> originais por **10 anos** (art. 64).
>
> **O que isso muda no desenho:** (1) o gatilho das **24 horas** é por **parcela** e por **etapa relevante**
> (liberação, entrega de bens, execução de serviço) — o modelo da v5.4 tem `parcelas` e `etapas_execucao`
> com data; (2) **"nome do Proponente"** = campo `vereador_autor` (já previsto); (3) **PDF pesquisável**
> é regra expressa, o build recusa PDF só-imagem; (4) o link da Transparência precisa estar em **local de
> destaque** (já está no menu, rodapé e vai à Home); (5) texto público seguro, só com o que foi conferido
> (a ser validado juridicamente): *"A ASAF divulga neste site as parcerias que firmar com o poder público
> (instrumento, objeto, valores e situação da prestação de contas). Atualmente a associação não recebe
> recursos de emendas parlamentares. Caso venha a recebê-los, publicará aqui o instrumento, o plano de
> trabalho, os valores recebidos e a prestação de contas, nos termos das normas aplicáveis."* — junto do
> texto de estado vazio que o usuário ditou.

##### Decisão de arquitetura — quem é a fonte de cada informação (usuário, 2026-10-03)

> **Pergunta do usuário:** "isso vai ser usado no sistema? Precisa estar só no Directus ou tem que vir do sistema
> de gestão da ASAF? Se o sistema precisa do dado (um ofício, uma ata), ele não pode ficar exclusivo do
> Directus; o site tem que puxar do sistema e organizar sozinho. O Directus existe para ser o **editor do
> site** (já existe pronto, de código aberto; não vamos criar editor de site). Ata tem RG e CPF, que não pode
> ficar exposto, e PDF não dá para editar. Tem que ficar tudo integrado."
>
> **Resposta (análise de 2026-10-03, olhando o que o sistema já tem):** o usuário tem razão, e **é o que o
> próprio plano já mandava** (v12.7: "tudo gerado do próprio dado do sistema, **nunca digitado duas vezes**";
> v12.1: execução da parceria ligada a centro de custo; v13.3: "gestão documental com classificação de sigilo").
> O primeiro desenho da v5.4 (emendas, parcelas, pagamentos e documentos **dentro do Directus**) contrariava
> isso e já constava nos riscos como "duas fontes para o dinheiro". **Foi corrigido.** O que o sistema já tem e
> serve de base: `Ata` (com `arquivo_documento_assinado`, protocolo de cartório), `DocumentoEstatuto` (versão
> registrada), `DocumentoAnexo`, `DocumentoEmitido`, centros de custo e livro-caixa (FASE 3), `PrestacaoDeContas`
> (anual, texto), armazenamento privado no Azure (`app/services/armazenamento.py`) e as rotas públicas da v5.2.
> **O que ainda não existe:** uma **biblioteca de documentos** com sigilo/versão pública (hoje cada tipo de
> arquivo tem seu campo solto) e o módulo de **parcerias/emendas**.
>
> | Informação | Fonte da verdade | Como chega ao site |
> | --- | --- | --- |
> | Estatuto, atas (inclui eleição), certidões, CNPJ, balanços, relatório anual, conselhos | **SISTEMA** (módulo Documentos, v5.4a) | só a **versão pública aprovada**, via API pública |
> | Diretoria e Conselho, projetos, eventos, editais de assembleia | **SISTEMA** (já pronto, v5.2) | API pública (já funciona) |
> | Emendas, parcerias, parcelas, pagamentos, etapas, relatórios, prestação de contas | **SISTEMA** (módulo Parcerias, v5.4a; dinheiro vem do livro-caixa por centro de custo) | API pública → páginas de Transparência |
> | Doações e campanhas | **SISTEMA** | API pública |
> | Notícias, textos de página, banners da Home, galeria, FAQ, depoimentos, logos de parceiros, texto e fotos do Despertai | **DIRECTUS** (editor do site) | lido no build (v5.3) |
> | Imagens do site | **DIRECTUS** (mídia, com texto alternativo e autorização de imagem) | copiadas no build |
>
> **Regra para decidir o que é de quem:** se o sistema **usa**, **audita** ou **precisa provar** a informação (ofício,
> ata, certidão, dinheiro), a fonte é o **sistema** e o site só **mostra** uma cópia aprovada; se é só
> conteúdo do site (notícia, foto, texto), é do **Directus**. O Directus **nunca** guarda documento oficial.
> Consequência já aplicada: a coleção `documentos` e as pastas de documentos criadas no Directus de produção
> **foram removidas** (estavam vazias — nenhum arquivo havia sido enviado) e o perfil "Editor de transparência"
> do Directus deixou de existir (ele passa a ser perfil do **sistema**).
>
> **Dado pessoal em documento (RG, CPF, endereço — ata de eleição, termo de fomento, relação de dirigentes):**
> (1) cada documento tem **classificação** — *Pública*, *Interna* ou *Restrita*; só *Pública* pode ir ao site;
> (2) o **original** (com tudo) fica em armazenamento **privado**, com **download só autenticado e por permissão**
> (a rota atual `/uploads/…` protege só por nome aleatório: **não serve para original sensível**); (3) como PDF
> não se edita, quem publica sobe ao lado a **versão pública** (com os dados pessoais cobertos de verdade) e
> **só ela** vai ao site; (4) um **verificador automático** extrai o texto da versão pública e **recusa**
> CPF, RG e telefone/e-mail pessoal, PDF só-imagem (a IN 06 veda) e versão idêntica ao original — uma tarja
> desenhada por cima **não apaga o texto**, por isso se confere o texto extraído, não o desenho; (5) nada vai ao ar
> sem **aprovação de outra pessoa** (v12.7) e fica registrado quem enviou, quem aprovou e o SHA-256 do que foi
> publicado; (6) "retirar do site" existe e preserva o histórico.
>
> **Decisões que dependem da diretoria:** quem aprova publicação (Presidente? Secretário?); classificação
> padrão por tipo de documento; se o nome do dirigente aparece na versão pública da ata de eleição (a lei
> municipal pede ao órgão público a relação **com** RG e CPF — isso é entrega à Prefeitura, **não** publicação).

#### v5.3 — Directus de verdade: o EDITOR do site (junta o que faltava da v5.1 e as Notícias da v5.2)

> **Escopo corrigido em 2026-10-03:** o Directus é **só o editor do site** (notícias, textos, banners, fotos, FAQ,
> Despertai editorial). Documento oficial, emenda e dinheiro são do **sistema** (ver a decisão de arquitetura acima e
> a v5.4a).

> **Como o Claude entra no Directus (decisão do usuário, 2026-10-03):** o usuário **não vai colar token
> nem rodar script** ("não entendi nada, tenho medo"). O arquivo de credenciais criptografado e o Key
> Vault existem justamente para o Claude buscar e usar o que precisa. O Directus já tem a conta de
> administrador (`asaf@asaf.org.br`) com a senha guardada no Key Vault (`DIRECTUS-ADMIN-PASSWORD`):
> `scripts/directus_configurar.py aplicar --producao` faz o login com ela **em memória** (nada é impresso
> nem gravado) e monta tudo. **Limite real:** o sistema de segurança do Claude Code barra, no modo
> automático, ler credencial ("Credential Exploration") — **mesmo com o usuário tendo dito que pode**; a
> forma de liberar é o usuário trocar para o **modo manual** e aprovar o comando quando a tela perguntar
> (como já foi feito antes). O Claude não contorna a barreira nem lê o arquivo SOPS por outro caminho.
> Se a senha do Key Vault já não for a atual (o usuário pode ter trocado no Studio), o caminho
> alternativo é um token estático gerado no próprio Studio — decisão nova a combinar com ele.
>
> **Decisão do usuário (2026-10-03, última palavra): o token fica GUARDADO DE FORMA PERMANENTE no arquivo de
> credenciais cifrado (`CREDENCIAIS_AZURE.md`, SOPS/age)**, "para não buscar token a cada atualização, daqui a um
> mês, dois meses": o Claude precisa ter o acesso para fazer o serviço inteiro. Fluxo adotado: (1) **uma vez**: o
> arquivo é decifrado no lugar (`sops -d -i`), o usuário cola `DIRECTUS_TOKEN=...` no fim dele, o Claude usa e
> **cifra de novo na hora** (`sops -e -i`); (2) **dali em diante**: `scripts/directus_configurar.py ... --producao`
> lê esse arquivo **cifrado, decifrando só na memória** (`sops -d` com a saída capturada; nada em disco, nada na
> tela; só a linha `DIRECTUS_TOKEN=` é usada) — o arquivo **não precisa ficar aberto** nunca mais. Os testes
> garantem isso (comando exato `sops -d`, arquivo intacto byte a byte, nenhum arquivo temporário, nada
> impresso) e que **nenhum teste toca os arquivos reais**. O token é de **administrador** (poder total sobre o
> Directus): fica cifrado; revogar e trocar quando a diretoria mudar ou se houver suspeita de vazamento. No
> modo automático o Claude Code barra esse acesso (filtro "Credential Exploration"); funcionou depois que o
> usuário escolheu esta opção explicitamente. O arquivo `.env.directus` (alternativa descartável) continua
> suportado, mas não é o caminho principal.
>
> **Resultado da 1ª tentativa (2026-10-03, com o "pode rodar" do usuário):** `aplicar --producao` leu a
> senha do Key Vault **sem bloqueio** (nada impresso), mas o Directus recusou o login (**HTTP 401**): a senha
> guardada já não é a atual (o usuário a trocou no Studio) — ou há MFA. **Não repeti** (tentativa repetida
> pode travar a conta). **Caminho adotado:** o usuário gera um **token estático temporário** no Studio
> (Usuários → o próprio usuário → rodapé "Admin Options" → campo **Token** → ícone de chave → copiar → Salvar)
> e cola em `.env.directus` (arquivo na raiz, **fora do Git** — `.env.*` está no `.gitignore`; só tem esse
> token, não o arquivo SOPS das credenciais do Azure, que **não precisa ser decifrado**). O script lê esse
> arquivo sozinho. O token é **revogado e o arquivo apagado ao fim da v5.3**. O campo do Token foi
> conferido por captura de tela num Directus 12.4.1 local; o passo de gerar o valor **não** pôde ser
> automatizado na captura (a tela do usuário pode estar em português).

- [x] **Licença do Directus**: o usuário **já digitou a chave** (Open Innovation Grant) e o Directus está
      funcionando (2026-10-03). **Fato descoberto ao testar numa cópia local (Directus 12.4.1 sem
      licença):** no Directus 12 a **regra de permissão personalizada** — filtro por linha ("só o que
      está publicado", "só o que é meu"), validação, predefinição e lista de campos — é recurso
      **licenciado** (`custom_permission_rules_enabled`); sem licença só há "pode tudo / nada" por coleção.
      Os perfis Redator e Leitor do site dependem dessas regras. **A confirmar em produção** que a licença
      do usuário inclui o recurso; o script avisa se não incluir e não finge.
- [x] **`scripts/directus_configurar.py`** + `scripts/directus_modelo.py` (v5.3, 2026-10-03):
      idempotente, só **acrescenta** (nunca apaga coleção, campo ou dado), nunca imprime segredo; `aplicar`
      e `verificar` (só leitura; exit 1 se algo fugir do modelo; reprova coleção de negócio no Directus).
      **Testado de verdade** contra um Directus 12.4.1 real e descartável (Node 22, SQLite): pastas,
      coleções, campos, relações, políticas, papéis e permissões criados, 2ª execução sem mudar nada; 22
      testes novos (privilégio mínimo do modelo + script contra um Directus falso, com mutação). Falta só
      rodar **em produção** (depende da liberação acima).
- [x] **Área "Documentos" no Directus — CRIADA e depois RETIRADA (2026-10-03):** o usuário pediu um lugar para
      enviar os documentos, o script criou pastas e a coleção `documentos`; ao ver o resultado ("só coloca aqui,
      perdeu organização") e ao pensar na integração, o usuário decidiu que **documento oficial é do sistema**
      (ver a decisão de arquitetura). Coleção, 6 pastas e o perfil "Editor de transparência" foram **removidos do
      Directus de produção** (estavam vazios; o script só remove o que está vazio). **Nenhum arquivo deve ser
      enviado ao Directus como documento oficial** — a biblioteca certa é o módulo Documentos do sistema (v5.4a).
- [x] **`aplicar --producao` rodado em 2026-10-03** (token do administrador lido em memória do
      `CREDENCIAIS_AZURE.md`, que voltou a ficar cifrado em seguida). **Criado no Directus de produção**: 8 pastas
      (Documentos institucionais + 4 subpastas, Emendas e parcerias, Fotos de eventos e projetos, Notícias),
      coleções `documentos` e `noticias` (com relação ao arquivo/imagem), 5 perfis (Editor de transparência, Editor
      de conteúdo, Redator, Colaborador de mídia, Leitor do site) e as permissões que **não** dependem de licença.
      **Provas:** `GET /items/documentos`, `/items/noticias` e `/folders` **sem token = 403**; `verificar --producao`
      não acha coleção fora do modelo nem perfil com acesso de administrador; só reclama de **8 permissões** que
      dependem de regra personalizada. **(Resolvido no mesmo dia: o usuário aplicou a chave — `license.source = settings`, "OIG" — e as 8 permissões foram criadas; `verificar --producao` limpo.)** Antes disso, **pendente por LICENÇA:** `/server/info` em produção mostra
      `license.source = null` (plano **Core**; a chave do Open Innovation Grant **não está aplicada**, ao contrário
      do que se supunha) — sem ela, Redator (só rascunho, só o dele), Leitor do site (só publicado) e a leitura
      própria de arquivos do Colaborador de mídia **não podem ser configurados**. Quando o usuário aplicar a chave
      (Studio → Configurações (engrenagem) → **License**, opção "I have a license key"), basta rodar `aplicar
      --producao` de novo (idempotente) e conferir `verificar --producao` limpo. Enquanto isso, a conta do site
      **não deve ser criada** (sem a regra "só publicado" ela leria rascunho). Observação: com 5 perfis com acesso ao
      Studio o plano Core pode ter limite de assentos — conferir após a licença.

- [x] **Papéis de privilégio mínimo** (requisito de 2026-10-01, acima) — **no ar em 2026-10-03**: Editor de conteúdo
      (notícias, publica), Redator (rascunho, só o dele, não publica nem apaga), Colaborador de mídia (só envia foto) e
      Leitor do site (só lê o publicado); o "Editor de transparência" saiu do Directus (virou perfil do sistema, v5.4a).
      Provado no modelo (testes de privilégio mínimo) e **ao vivo para o Leitor** (item da conta de serviço abaixo).
      **Falta:** teste ao vivo dos demais perfis com usuários de teste, e o atalho "Editar o site" do painel com
      permissão própria (`editar_site`).
- [x] **Fluxo editorial** rascunho → revisão → publicado (+ arquivado), **agendamento** pela data "Publicar em" e
      **histórico de versões** com reversão (ligado na coleção). **Rascunho nunca aparece no site: provado ao vivo**
      (notícia de teste em rascunho e outra agendada para o futuro **não** chegaram ao leitor do site) e no e2e.
- [x] **Foto da notícia**: texto alternativo **obrigatório** e **"autorização de imagem"** confirmada — a notícia com
      foto que descumpre **não é publicada** (validação do build, `scripts/lib/directus.mjs`; as condições do
      formulário só valem na tela). Provado ao vivo (notícia de teste com foto sem autorização foi recusada com
      aviso). Foto copiada do Directus no build, em WebP de até 1280 px; **tamanhos responsivos (srcset)** ficam
      como melhoria futura.
- [ ] **E-mail do Directus** (SMTP com `asaf@asaf.org.br`, segredos já no Key Vault): convite de editores
      e recuperação de senha; **administrador de reserva** (hoje só existe um e a recuperação é por SQL).
- [ ] **MFA obrigatório** para administrador.
- [x] **Conta de serviço do site** (`leitor-do-site@asaf.org.br`, perfil Leitor do site): criada por
      `directus_configurar.py criar-leitor --producao`; token aleatório **nunca impresso**, gravado no Key Vault
      (`DIRECTUS-SITE-TOKEN`) por arquivo temporário apagado. **Autoteste do próprio token em produção:** lê
      notícias; **não** cria notícia (403); **não** lista usuários. (Leitura pública sem token foi descartada:
      a foto exige permissão.)
- [x] **Site lê o Directus no build** (token do leitor, só publicado), com a mesma política da API (3 tentativas ×
      60 s; 401/403 derrubam na hora; falha derruba o build e o site no ar não muda). Sem token o build **falha** nos
      workflows de publicação (`DIRECTUS_OBRIGATORIO=1`). `conteudo.json` inclui as notícias e a **sincronização roda
      a cada 15 min** cobrindo API **e** Directus (login OIDC no Azure para ler o token no Key Vault; sem ele a
      comparação falha, nunca conclui "nada mudou"), com **proteção contra laço de falha**: se as 3 últimas
      publicações falharam, para e avisa. Testes: 129 unitários, 180 e2e, estado vazio e sincronização (incluindo
      "só o Directus mudou" e "token recusado").
- [x] **Notícias** (pendência da v5.2): `/noticias/`, `/noticias/<slug>/`, `schema.org/NewsArticle`, prévia certa no
      WhatsApp (foto própria, medidas e texto alternativo no Open Graph), feed RSS `/noticias/feed.xml`, "Últimas
      notícias" na Home e link no rodapé; texto do editor limpo (`sanitize-html`). **Falta:** uma notícia poder se
      ligar a uma emenda ou projeto (depende da v5.4).
- [x] **Organização do Studio (crítica do usuário, 2026-10-03: "só coloca aqui, perdeu organização")**: o Editor agora é
      **todo em português**, com o nome "ASAF — Editor do site", a cor da marca e uma nota na tela de entrada; o
      formulário da notícia tem **seções** (Conteúdo → Foto da notícia → Publicação → Histórico recolhido), rótulos e
      dicas em português, e a lista tem **atalhos** (Todas as notícias, Para revisar, Rascunhos, No ar). Conferido por
      captura de tela num Directus 12.4.1 local; aplicado em produção; a 2ª rodada não muda nada.
- [x] **`COMO-ATUALIZAR.md`** (primeira versão, 2026-10-03): como publicar notícia no Editor, regras da foto, prazo, o
      que fazer quando não aparece. Cresce na v5.4b com documentos e emendas.
- [x] **v5.3 — ENTREGA 2026-10-03 (parte do site), commit `652069c`, verificada AO VIVO:** `asaf.org.br/version.json` =
      `652069c`; `/noticias/` 200 com o estado vazio ("Ainda não há notícias publicadas"); `/noticias/feed.xml` 200 e
      RSS válido sem itens; `/conteudo.json` conta `noticias: 0`; o sitemap traz `/noticias/`; a Home **não** mostra o
      bloco de notícias enquanto não há; todas as páginas anunciam o feed. **Deploy Site** verde (job de qualidade: 180
      e2e, Lighthouse; job de publicação com o token do Directus lido do Key Vault). **Sincronização real em CI**
      (disparo manual): login OIDC no Azure → token do Key Vault → comparação sistema + Directus **verdes**; "republica"
      corretamente pulado (nada mudou). **Teste ponta a ponta com o Directus de produção** (4 notícias + 1 foto de
      teste, depois apagadas: 0 e 0): só a válida chegou ao site; o rascunho e a agendada nem chegaram ao leitor; a
      de foto sem autorização foi recusada com aviso; a foto veio em WebP; o token **não** aparece no HTML gerado. As
      anotações amarelas de "Notícia NÃO publicada" apareceram no resumo do job em CI (com o mock).
      **Ainda aberto na v5.3:** SMTP do Directus (convite e recuperação de senha), administrador de reserva, MFA do
      administrador, teste ao vivo dos demais perfis com usuários de teste, e a verificação `isolar_directus.py
      verificar` (16/16) — exige a conexão do banco, que não foi aberta neste ciclo.
- [x] **Verificação em produção**: `isolar_directus.py verificar` (16/16) + nenhuma coleção fora do
      schema `directus` + `GET /items/…` sem token = 403 + rascunho ausente do site + token de serviço
      não consegue escrever.
      **Conferido (2026-10-08 e 2026-10-19):** `isolar_directus.py verificar` na produção, só leitura, "o Directus não alcança nenhuma tabela do sistema" (2026-10-08, bloco do Ponto 1/2); `directus_configurar.py
      verificar --producao` "conforme o modelo"; em 2026-10-19, `GET cms.asaf.org.br/items/paginas` e `/items/noticias` sem token = **403** e `server/ping` 200; rascunho fora do site e token só de leitura
      provados pelos testes do modelo e do site e pelo autoteste do token.

#### v5.4 — Transparência e Emendas Parlamentares (o site "pronto para receber") — fonte da verdade no SISTEMA

> Refeita em 2026-10-03 pela decisão de arquitetura acima: **a v5.4a constrói o dado no sistema; a v5.4b o mostra
> no site.** Antecipa, só no **núcleo** que a transparência exige, itens das fases 12/13 (v12.1 parcerias, v12.6
> biblioteca de documentos, v12.7 portal de transparência, v13.3 gestão documental) — o resto dessas versões
> continua onde está. Nenhuma dessas partes mexe em dinheiro/voto/LGPD sem os portões de teste de sempre.

##### v5.4a — No sistema (painel + API)

- [x] **Módulo Documentos** (biblioteca institucional): tipo (estatuto, ata, certidão, CNPJ, balanço, relatório
      anual, inscrição em conselho, termo de fomento, plano de trabalho, aditivo, prestação de contas, outro),
      título, descrição, data, **versão** e "vigente", **validade** (certidão com alerta de vencimento),
      **classificação** (Pública / Interna / Restrita), **vínculo** (ata, estatuto, parceria/emenda, projeto,
      evento), **arquivo original** (armazenamento privado, **download autenticado e por permissão**, nunca pela
      rota pública `/uploads`), **versão pública** (arquivo separado) e texto extraído (busca).
- [x] **Proteção de dado pessoal**: verificador automático da versão pública (texto extraído **sem** CPF, RG,
      telefone/e-mail pessoal; **com** camada de texto — PDF só-imagem é recusado; diferente do original) +
      **aprovação de publicação por outra pessoa** (rascunho → em revisão → aprovado → no site; quem enviou
      não aprova), registro de quem enviou/aprovou/retirou e **SHA-256 do que foi publicado**; "retirar do
      site" preservando o histórico.
- [x] **Atas e Estatuto ligados**: `Ata.arquivo_documento_assinado` e `DocumentoEstatuto.caminho_arquivo`
      passam a ser documentos da biblioteca, **sem perder nenhum arquivo já enviado** (migração com teste).
- [x] **Tela do painel bem organizada** (crítica do usuário à biblioteca crua do Directus: "só coloca aqui, perdeu
      organização"): lista **agrupada por tipo**, filtros (tipo, ano, situação, no site), pré-visualização, selo
      "No site / Não publicado / Em revisão", alerta de vencimento, **envio em duas etapas** (original +
      versão pública) com o **resultado da verificação na tela**, e histórico de versões.
- [x] **Perfis do sistema**: gerir documentos; ver restritos; **aprovar publicação** (perfil novo, mínimo).
      O que era "Editor de transparência" do Directus vira perfil **do sistema** (`niveis_acesso`).
- [x] **Módulo Parcerias e emendas** (núcleo da v12.1, **sem** ativar o módulo todo): parceria/emenda (ano, nº da
      emenda, ID único, **proponente = vereador**, valor, objeto, secretaria concedente, nº do Termo de Fomento,
      vigência, situação), **parcelas**, **etapas de execução** (data, local, público, fotos com autorização),
      **relatórios e prestação de contas** (situação **regulares / com ressalvas / irregulares**, data prevista,
      data de apresentação, prazo de análise de 150 dias — Lei 13.019 art. 11, V; lei municipal arts. 62, 68, 71) e
      **documentos ligados** (pelo módulo Documentos).
- [x] **Dinheiro vem do livro-caixa**, não digitado de novo: cada parceria tem **centro de custo exclusivo**
      (FASE 3); pagamentos e recebimentos publicados **são** os lançamentos desse centro (fornecedor, CNPJ,
      descrição, valor, data; **equipe paga = função + valor individualizado, sem nome nem CPF** — lei municipal
      art. 43, § 4º e Lei 13.019 art. 11, VI; **a validar juridicamente**). **Consistência:** soma das parcelas ≤
      valor da emenda; pagamentos ≤ recebido; "aprovada" só com relatório. Violação = erro com o nome do registro.
- [x] **API pública** `/api/publico/transparencia/...` (só o que foi **aprovado**; para documento, **só a versão
      pública**; campos explícitos, nada interno — mesmo cuidado das rotas da v5.2) e entrada no
      `conteudo.json` para a sincronização republicar o site quando mudar.
- [x] **Testes**: matriz de permissões; original **nunca** aparece na API pública; documento Interno/Restrito
      nunca é publicado; verificador pega CPF/RG/telefone e PDF só-imagem; aprovação por outra pessoa;
      download do original exige login e permissão; migração de atas preserva os arquivos.

> **v5.4a — feito e verificado ao vivo (2026-10-04).** Commits `2f2a45b` (documentos), `594364a` (tela de Documentos),
> `0fc7fb3` + `3c5c2b2` (Parcerias e emendas: API + painel), `d2a39f3` (atas ligadas), `eaa6f46` (correções da conferência
> de fatos). **Provas:** Deploy API verde em todos; o log da produção mostra `Running upgrade a7c1e9d3f0b2 -> b5e2d8f1a436`
> (a anterior, de Documentos, `c3f8a1d07b94 -> a7c1e9d3f0b2`); `painel.asaf.org.br/version.json` bateu o commit e o *bundle*
> publicado contém as telas; `GET /api/publico/transparencia/parcerias` e `/documentos` → 200 `[]`; detalhe inexistente
> → 404; `GET /api/parcerias` sem login → 401; 19 rotas de parcerias no `openapi.json`; `/uploads/atas/<nome>` e
> `/uploads/documentos-originais/<nome>` → **404** (a ata assinada, que tem RG/CPF, deixou de ser pública). **Testes:**
> backend 680 passaram em duas passadas seguidas (inclui a migração `b5e2d8f1a436` comparada, tabela a tabela, com os
> modelos), painel 150 (vitest, inclui a renderização das telas completas com axe) + 10 e2e, lint/formatação/tipos limpos. **Não** foi feito login no painel (MFA intocado):
> perfis e permissões foram provados pelos testes de matriz.
>
> **O que mudou em relação ao plano (decisões a registrar):**
>
> - **Fotos das etapas** (com autorização de imagem) **ficaram para a v5.4b**: precisam de um caminho próprio que confira a
>   autorização; a etapa hoje tem data, local, público atendido e descrição.
> - **Estatuto:** `DocumentoEstatuto.caminho_arquivo` é só um nome de referência (`ESTATUTO_ASAF.txt`), **não há arquivo a
>   migrar**; o PDF registrado em cartório entra pelo módulo Documentos (tipo *Estatuto*, classificação *Pública*) quando a
>   diretoria o enviar. **Atas:** o documento assinado é agora um documento *Restrito* privado, o caminho guardado na ata é o
>   do download autenticado e as atas antigas (se houver) são **copiadas** para a biblioteca na inicialização
>   (idempotente, o arquivo antigo não é apagado; testado).
> - **Movimentos do livro-caixa precisam ser classificados** (texto público, tipo de pagamento, função da equipe) antes da
>   publicação: sem isso a aprovação fica travada. O texto público passa pelo mesmo verificador de dado pessoal; **nome de
>   pessoa o sistema não detecta** (depende de quem classifica e de quem aprova). Fornecedor com CPF na razão social (MEI) é
>   recusado.
> - **Quem aprova:** o sistema exige a permissão `aprovar_publicacao` (Presidente e Secretário a recebem pelo cargo) e que o
>   aprovador **não seja quem criou nem quem enviou**. A página pública **não** afirma o cargo de quem aprovou.
> - **RESOLVIDO em 2026-10-04 (decisão do presidente, por voz):** (1) aprova **qualquer um dos dois — Presidente ou Secretário —
>   porque tem que ser rápido** (como está implementado: um deles, nunca quem criou ou enviou); (2) **depois de aprovado, editar vai
>   ao site sem nova aprovação** ("não vai ter tantas mudanças"; fica na trilha de auditoria). *Texto de quando estava em aberto:*
> - **Em aberto, para a diretoria decidir:** (1) o Presidente disse *"os dois podem aprovar, tanto o presidente como o
>   secretário"* — foi implementado **um deles (outro que não quem enviou)**; se for **os dois juntos**, é uma mudança
>   pequena; (2) hoje, **depois de aprovada**, uma edição ou um movimento novo vai ao site **sem nova aprovação** (fica na
>   trilha de auditoria); se a diretoria quiser nova aprovação a cada mudança, o custo é a página sair do ar enquanto espera.
> - **Conferência independente de fatos (agente) das páginas novas:** achou 4 frases imprecisas e 3 riscos reais, todos
>   **corrigidos antes de publicar** (ver v5.4b).

##### v5.4b — No site (páginas geradas a partir da API do sistema)

- [x] **Páginas** (adaptando as existentes): `/transparencia/` vira o **hub** (estatuto, diretoria, editais,
      emendas, parcerias, documentos, contato para pedido de informação);
      `/transparencia/emendas/` (todos os anos, filtro por ano e situação, **nunca apaga ano anterior**);
      `/transparencia/emendas/<id>/` (valores, parcelas, pagamentos, etapas, documentos, relatórios e
      **"Última atualização" automática**); `/transparencia/parcerias/`;
      `/transparencia/documentos/` (**organizada por tipo e ano**, com busca; só versões públicas aprovadas);
      **dados abertos** `/transparencia/dados/emendas.csv` e `.json`.
- [x] **PDFs em URL permanente** (`/arquivos/transparencia/<id>-<slug>.pdf`), copiados no build — o site não
      depende de o sistema estar acordado (partida a frio de ~21–35 s) e o PDF **continua pesquisável**
      (conferido de novo no build). Conferir o limite de tamanho do Static Web App antes de crescer.
- [x] **Destaque na Home**: cartão "Emendas parlamentares" (o link "Transparência" já está no menu e no rodapé). *Feito como link em destaque no cartão "Contas claras" da Home e no rodapé (não como um cartão só dele).*
- [x] **Estado vazio honesto** (texto dado pelo usuário): "A associação ainda não recebeu recursos de emendas
      parlamentares. Esta página será atualizada em até 24 horas após qualquer recebimento." **Dado de exemplo
      NÃO vai à produção** (site de OSC que busca financiamento não exibe registro falso): "EXEMPLO – substituir"
      só em teste/rascunho, e o e2e prova que nenhum exemplo aparece no build de produção.
- [x] **Prazo de 24 h**: aprovou no painel → sincronização ≤ 15 min + build ≈ 5 min; **alerta** se o site no ar
      estiver defasado do sistema por mais de 2 h (`sincronizar-site.yml` guarda o instante da diferença num cache
      e abre/fecha o aviso; a lógica foi **executada em bash de verdade** nos testes). *Nada manual: ninguém roda comando.*
- [x] **Contato (R7)**: a página ganha o texto "serve também para pedidos de informação sobre os recursos
      públicos recebidos", link a partir da Transparência e **prazo de resposta — valor a definir pela
      diretoria** (não será inventado). O formulário do pedido vem na v5.5.
- [x] **Projetos e Despertai (R8)** — *decisão de 2026-10-04: o Despertai é um **projeto** do sistema marcado como destaque, cada
      edição é um **evento** ligado a ele; relatórios = documentos ligados; fotos com autorização; notícias do Directus
      ligadas pelo número. **No ar** (ver o bloco "v5.4b — terceiro lote" abaixo). **Depende da diretoria:** criar o projeto no painel
      (Pública + "em destaque") com o texto real; sem projeto a Home e `/projetos/` ficam como eram.* Texto original do item: projeto "Pública" do sistema já tem página; a **camada editorial**
      (texto, edições anteriores com data/local/público e fotos com autorização) fica no **Directus**, e a
      informação do **calendário oficial do município só é publicada com o documento que a comprove**
      (número da lei/decreto — esse documento entra pelo módulo Documentos).
- [x] **`COMO-ATUALIZAR.md`** para a diretoria, em português simples, agora sobre o **painel**: enviar documento
      (original + versão pública), o que o verificador recusa e por quê, aprovar publicação, regra das 24 h,
      **autorização de imagem**; e a parte do Directus (notícias, fotos).
- [x] **Site sempre no ar (comprovação)**: monitor a cada 15 min (`monitorar-site.yml`: confere site, painel e API
      **de fora**; aviso no GitHub na 2ª rodada com falha, fecha sozinho). *Fica como decisão de custo, não feita:* teste
      de disponibilidade do Application Insights.
- [x] **Cargos da diretoria alinhados ao Art. 19** (pré-requisito para publicar dirigentes reais): o catálogo
      `titulo_cargo` hoje tem "Vice-Presidente" único, "Diretor de Patrimônio", "Diretor Social" e "Conselho
      Fiscal" como cargo; passa a ter Presidente, 1º/2º Vice-Presidente, 1º/2º Secretário, 1º/2º Tesoureiro e
      Conselheiro Fiscal, **preservando as permissões que cada cargo concede** (migração + testes).
- [x] **Verificação de fatos independente** (regra de 2026-10-03) em todas as páginas novas, antes de dar por pronto.

> **v5.4b — páginas no ar e verificadas (2026-10-04, commit `eaa6f46`; correção do painel `a19ca54`).** Páginas:
> `/transparencia/` (hub com os quatro caminhos e os documentos aprovados), `/transparencia/emendas/` (+ `/<id>/`),
> `/transparencia/parcerias/` (+ `/<id>/`), `/transparencia/documentos/` (por tipo e ano, com busca) e
> `/transparencia/dados/` (CSV e JSON de emendas e de parcerias). Cada peça (lista, detalhe, tabela rolável com foco no
> teclado) é um **componente solto** em `site/src/components/transparencia/`: quem for redesenhar a **aparência** da Transparência
> pode reaproveitar (só visual; o **conteúdo é 100% automático** — criou o relatório, aprovou, vai ao site — e **ninguém roda comando**).
> **PDF:** copiado no build para `/arquivos/transparencia/<id>-<título>.pdf`; o build **só aceita** o arquivo que for PDF e
> cujo **SHA-256** for o que a API declara como aprovado (qualquer diferença derruba o build). Importante: o build
> **não refaz** a leitura da camada de texto; essa conferência é a do sistema, na aprovação (e o SHA-256 amarra o arquivo
> aprovado ao publicado). **O limite de tamanho do Static Web App ainda precisa ser conferido antes de os PDFs crescerem.**
> **Estado vazio:** o `test:vazio` prova, no build contra a API sem nada cadastrado, o texto do presidente palavra por
> palavra, **nenhuma** página de emenda/parceria, **nenhum** PDF e **a palavra "EXEMPLO" em nenhum arquivo** (o mock marca todo
> dado de teste com ela). **Provas ao vivo e de CI:** ver o bloco "Verificado ao vivo" logo abaixo. **Conferência independente
> de fatos** (agente que não escreveu as páginas): 4 frases imprecisas e 3 riscos reais, **todos corrigidos antes de publicar** —
> "nada é apagado" (retirar do site é possível) → "os anos anteriores continuam nesta página"; "Saldo em conta" → "Saldo
> (recebido menos pago)" (não é extrato bancário); "aprovada pelo Presidente ou pelo Secretário" → "por uma pessoa autorizada,
> diferente de quem cadastrou e enviou" (o sistema confere a permissão, não o cargo); "recente… será completada em breve" →
> "ainda não detalhado" (o sistema não promete prazo de classificação); "dados pessoais são cobertos" → "conferida para não
> trazer CPF, RG, e-mail ou celular" (recusa, não cobre); exemplo de CSV com casas decimais fixas era falso; **razão social
> de fornecedor com CPF (MEI) agora é recusada**; **título e descrição de documento** passam pelo verificador de dado pessoal;
> **"Última atualização" agora acompanha o livro-caixa** (antes só o cadastro); data de aprovação do documento no dia de Belém.
>
> **Em aberto quando a v5.4b foi publicada (o segundo lote, logo abaixo, resolveu tudo isto, exceto o Despertai e o que está dito lá):**
>
> - **Prazo de 24 h:** a sincronização (a cada 15 min) + o build (≈5 min) estão no ar, mas o **alerta de defasagem do site
>   por mais de 2 h NÃO existe**, e o "até 24 horas" do estado vazio depende de **dois passos humanos** (lançar e classificar
>   o recebimento; para a **primeira** emenda, outra pessoa aprovar). Desenho do alerta: guardar o instante em que a
>   diferença apareceu (a execução do workflow é sem memória) e falhar a rodada depois de 2 h.
> - **Monitor de disponibilidade** (`monitorar-site.yml`), **Despertai / projetos (R8)**, **cargos da diretoria × Art. 19** e
>   **fotos das etapas com autorização de imagem**.
> - **Nome de pessoa em texto livre** (descrição pública, objeto, etapa) o sistema **não** detecta: depende de quem escreve e
>   de quem aprova (o `COMO-ATUALIZAR.md` avisa).
>
> **Verificado ao vivo (2026-10-04):** `asaf.org.br/version.json` = `eaa6f46` (Deploy Site verde: formato, tipos, 153 testes
> unitários, **247 e2e** com axe desktop e celular em todas as páginas, SEO, estado vazio, sincronização e **Lighthouse CI** em 13
> URLs, incluindo as novas); `/transparencia/`, `/emendas/`, `/parcerias/`, `/documentos/`, `/dados/`, `emendas.csv` (só o
> cabeçalho), `emendas.json` (`[]`), `parcerias.csv`, `conteudo.json` (contagem zero, inclui `parcerias` e `documentos`) →
> 200; `/transparencia/emendas/` traz o estado vazio com o texto do presidente e **não contém "EXEMPLO"**;
> `/arquivos/transparencia/…` → 404 (nenhum PDF sem documento aprovado); o Contato traz o parágrafo de pedido de
> informação, sem prazo. A **sincronização** disparada à mão depois do deploy terminou verde **sem** disparar novo deploy
> (a impressão digital nova — com parcerias e documentos — bate com a do site: não há laço de reconstrução). Painel
> `version.json` = `a19ca54`. **O que NÃO foi visto ao vivo:** nenhuma emenda/documento real foi cadastrada (não há dado
> de exemplo em produção, de propósito), então a página de detalhe, o PDF permanente e o CSV com linhas só foram provados
> no build de teste (e2e) contra a API simulada, que reproduz o formato da API real (a API real é testada à parte, 70 testes).
>
> **v5.4b — segundo lote, NO AR e verificado (2026-10-04; commits `a921164` e `db03536`).** Pedido do presidente: "não pode
> ficar nada para depois". Entregue: (1) **documento público em PDF OU TEXTO** (o Estatuto: PDF de cartório com assinaturas
> = original interno; texto transcrito = página do site; mesma conferência de dado pessoal, o build só aceita o texto cujo
> SHA-256 é o aprovado); (2) **cargos do Art. 19** (7) e **Art. 24** (3) no catálogo e em `/diretoria/`, vagos para irem sendo
> preenchidos pelo registro do mandato (nenhum nome digitado no site); (3) **fotos das etapas com autorização de imagem**
> (só entram com a autorização confirmada e a descrição; a imagem é **regravada** sem GPS/aparelho, com a rotação aplicada,
> até 2000 px, JPEG; arquivo privado; apagar tira do site e do armazenamento); (4) **monitor de disponibilidade** e
> **alerta de site defasado >2 h**; (5) **trava de tamanho** do site (plano gratuito do Azure: 250 MB e 15.000 arquivos;
> avisa a 60%, **para a publicação a 85%**). *Provas:* backend **741 testes ×2**, painel 156 ×2 (+lint, tipos, build, e2e),
> site vitest ×2, estado vazio, sincronização, e2e 252 + 65 de acessibilidade, **Lighthouse 39/39**. **Ao vivo:**
> `painel.asaf.org.br/version.json` = `a921164`; `asaf.org.br/version.json` = `db03536`; as 4 rotas novas no `openapi.json`;
> `/api/publico/transparencia/documentos` → 200 (a coluna nova existe em produção: a migração rodou); `/diretoria/` mostra os
> dois órgãos com os **10 cargos** ("Ocupante ainda não publicado": o site não afirma que o cargo está vago); `monitorar-site.yml` e `sincronizar-site.yml` disparados à mão terminaram **verdes**
> (os passos de alerta, corretamente, "pulados": nada atrasado); log do deploy: "Tamanho do site (dist): 0.8 MB de 250 MB (0%)
> e 43 de 15000 arquivos". **Falha minha, pega pelo CI:** o primeiro envio (`a921164`) foi barrado no `astro check` por um erro de
> tipo num teste — o erro estava no resumo da minha própria verificação, que li só pelo fim. Nada foi publicado errado (a
> publicação do site é depois dos portões); corrigido em `db03536`. **O que NÃO foi visto ao vivo:** foto de etapa real e
> Estatuto em texto (não há dado em produção, de propósito; a diretoria sobe o documento) e a abertura real de um aviso no
> GitHub (provada só executando o script em bash nos testes).
>
> **v5.4b — terceiro lote (R8): Despertai e o contexto do evento — NO AR (2026-10-04/05; commits `df5f917` e `c06f861`).**
> *Atenção à numeração: nos comentários do código, nas mensagens de commit e no nome da migração `a7d2f4c8b931` este trabalho aparece
> como "v5.5" por engano meu. A **v5.5 do plano é outra** (Formulários públicos, fila única e módulo de eventos) e ainda NÃO começou.*
> Modelagem: o Despertai é um
> **projeto** do sistema marcado como destaque; cada edição é um **evento** ligado a ele; os relatórios são **documentos** ligados
> ao evento/projeto (aprovados por outra pessoa, como todo documento); as fotos do evento só entram com **autorização de imagem**;
> as notícias do Directus se ligam pelo **número** (`projeto_id`, `evento_id`). Entregue: (1) **editar projeto e evento** (antes só
> se criavam) com conferência de dado pessoal no texto que vai ao site; (2) projeto **em destaque** (só Público) e evento ligado ao
> projeto (a nova edição segue no mesmo projeto); (3) **fotos do evento** (mesmas regras das fotos de etapa; pasta privada
> `fotos-eventos`); (4) documento do tipo **relatório de evento ou de projeto**; (5) **página do projeto** (edições, relatórios,
> fotos, notícias), **página do evento** (projeto, outras edições, relatório, fotos, notícias), **destaque na Home** e link na página
> da notícia — **só aparece o que já foi liberado** (evento Público, relatório Aprovado, foto com autorização; projeto ou evento
> Interno nunca, nem por quem está ligado a ele); (6) no painel, a seção **Contexto do evento/projeto** e o atalho para escrever
> a notícia no editor do site. O site é **tolerante a API antiga** (publicar o site antes da API nova não quebra; provado por um
> build contra a "API antiga"). **Defeito antigo achado e corrigido:** criar projeto ou evento deixando um campo opcional em
> branco mandava `0`/texto vazio e a API recusava. *Provas:* backend **796 testes ×2**; painel lint, tipos, build, 234 ×2 e 10 e2e;
> site vitest ×2, estado vazio (inclui a API antiga), sincronização, e2e 338 + 81 de acessibilidade na repetição, **Lighthouse**.
> **Ao vivo:** `painel` e `asaf.org.br/version.json` = `df5f917`, depois o site `c06f861`; log do deploy: `Running upgrade
> f5c1d9e7a283 -> a7d2f4c8b931`; `openapi.json` com os `PUT` de projeto e evento, as rotas de fotos e a rota pública da foto;
> `/api/publico/projetos` → 200 `[]`; sem login: `PUT` de projeto 401, fotos 401; foto pública inexistente 404; a Home **não tem**
> a seção de destaque (nenhum projeto cadastrado, de propósito); a sincronização disparada à mão depois do deploy **não**
> republicou (sem laço de reconstrução). **Directus de produção:** os 3 campos novos da coleção `noticias` foram acrescentados
> (`directus_configurar.py aplicar --producao`; `verificar --producao` = conforme).
>
> **Intercorrência (registrada para ninguém achar que passou liso):** o portão do `Deploy Site` **barrou** o primeiro envio às
> 00:01 UTC: o teste de sincronização reprovou porque as datas do dado de TESTE são relativas ao dia de hoje e a **meia-noite
> UTC caiu entre o build e o teste** (não era a API de produção). A sincronização, ao ver o conteúdo novo da API, disparou um
> `Deploy Site` manual (que pula os portões, por desenho) com o mesmo código já testado; a correção (`c06f861`: o dado de teste
> passa a usar um dia de referência fixo, com teste simulando a virada do dia) passou em **todos** os portões e o site foi
> republicado. Antes, no lote anterior, outro erro (de tipo, num teste) também foi barrado pelo CI e corrigido.
>
> **Verificação independente de fatos do R8/Despertai (agente que não escreveu o código; 14 achados, todos tratados e NO AR em `68b55e0`:
> backend 801 testes + painel 234 + site 245 e e2e das páginas novas, verdes aqui, e a suíte completa de novo no CI de cada parte;
> `painel` e `asaf.org.br/version.json` = `68b55e0`; `/diretoria/` mostra "Ocupante ainda não publicado" nos 10 cargos):** (1) o prazo
> "em até 25 minutos" **não é garantido** — o agendador do GitHub atrasa (houve intervalos de horas entre rodadas): o texto passou
> a "normalmente 15 a 30 minutos; às vezes atrasa; passou de 2 h o sistema avisa"; (2) o alerta de "site atrás do sistema há mais
> de 2 h" **não saía** quando as 3 últimas publicações tinham falhado (os passos seguintes eram pulados): agora rodam com
> `!cancelled()` (só se a comparação rodou) e há teste; (3) a trava de tamanho **não abre Issue** (só aviso/erro na publicação): o
> guia dizia que sim; (4) o guia dizia "vago" e o site diz "Ocupante ainda não publicado" (de propósito: a diretoria pode estar
> empossada e não registrada); (5) a conferência de dado pessoal tinha furos: título da **nova edição** e **sessões** da
> programação (agora conferidos); (6) "apagar a foto: sai do armazenamento" era forte demais — o Azure mantém **cópia de segurança
> por 30 dias** (apagamento reversível e versionamento, `infra/armazenamento-privado.sh`), a falha ao apagar era **engolida**
> (agora aparece e a foto continua cadastrada) e o **comentário escondido do JPEG** passava para o arquivo novo (agora removido,
> com teste); (7) o rótulo "Próxima edição" na Home vira "Próximo evento" (o projeto pode ter reuniões; sem JavaScript o primeiro
> evento pode ser passado, mas a data sempre aparece); o destaque **não olha a situação do projeto** (a diretoria desmarca); (8)
> relatório aprovado ligado a evento/projeto **Interno** continua na Transparência, mas a API **não revela mais a ligação**;
> foto de evento vai ao site assim que o evento é Público, **sem segunda pessoa conferir** (dito no guia e no painel);
> (9) "o sistema recusa CPF, RG…" virou "barra os padrões de…" (RG solto passa; nome e endereço não são detectados); (10)–(14)
> redação: legenda x descrição da foto, nomes reais dos botões, o Despertai como decisão da diretoria (não como fato), 6
> notícias/12 fotos na página do projeto, e-mail só com notificação ligada. **Ainda é limite conhecido:** não há regra de ciclo de
> vida para apagar de vez as versões antigas no Azure antes de 30 dias, e o prazo real do site depende do agendador do GitHub.
>
> **O que NÃO foi visto ao vivo, e o que depende da diretoria:** nenhum projeto/evento/foto/relatório **real** existe em
> produção (de propósito: nada de exemplo), então a página do projeto, a do evento, o destaque na Home e a foto só foram provados no
> build de teste contra a API simulada (a API real é testada à parte, 796 testes) e por rotas vazias ao vivo. **Falta a diretoria:**
> criar o projeto **Despertai** no painel (Pública + "em destaque") **com o texto real** (nada foi inventado sobre ele), e
> cadastrar a edição como evento ligado a ele. O calendário oficial do município só entra no site **com o documento que o
> comprove**.


#### v5.4c a v5.4g — Conferência AO VIVO na homologação, uma versão por fase (decisão do presidente, 2026-10-05)

> **Por que existem.** Das FASES 0 a 4 (e da FASE 5 até a v5.4b) os pontos foram "confirmados em produção" por pipeline verde,
> versão no ar e rotas vazias. **Nenhum ponto foi usado de verdade, com dado, numa tela.** A produção não pode receber dado de teste
> (a auditoria não apaga: o próprio banco recusa), então a conferência real só pode ser feita na **homologação**
> (`HOMOLOGACAO.md`: `hml-painel`, `hml-api`, `hml-site`, banco `asaf_hml` que pode ser apagado e recriado). Cada versão abaixo remete
> a **uma fase** e tem um único trabalho: **usar de verdade, ao vivo, tudo que aquela fase construiu** — cadastrar, editar, aprovar,
> errar de propósito, ver na Auditoria, abrir o link/arquivo/foto que a tela oferece (itens 10 e 11 do checklist da seção 4.1) — e
> deixar tudo pronto para quando o Ponto de Revisão abrir. Nada aqui é "mais um teste simulado": é o sistema publicado, com o
> navegador de verdade, como o usuário vai usá-lo.
>
> **Como cada item é dado como feito** (vale para as cinco versões): (1) a ação foi feita **na tela** do `hml-painel` (ou no
> `hml-site`), não por chamada direta à API; (2) há **print** da tela antes e depois, guardado como artefato do fluxo; (3) a ação
> apareceu na **Auditoria** com quem fez e quando (item 5 do checklist); (4) o que a tela oferece para abrir (foto, ata, PDF, link)
> foi **aberto de fato**; (5) o erro que o sistema tem de recusar (CPF inválido, duplicado, permissão faltando, quem criou aprovando
> o próprio documento) foi **provocado** e a recusa vista; (6) achou defeito: corrige ali, republica na homologação e **refaz o
> item** — defeito achado não vira pendência. Quem recomeça do zero usa `resetar_banco` + `popular` (só o banco de teste).
> **Usuários de teste** (CPFs inventados, no `HOMOLOGACAO.md`): Presidente (tudo), 1º Secretário (documentos e aprovação), 1º
> Tesoureiro (financeiro e parcerias) — cada papel só enxerga o que o cargo permite, e isso também é conferido.

#### v5.4c — FASE 0 e FASE 1 ao vivo: identidade, painel e associados

- [x] **Alicerce da conferência** (único item que não vem de uma fase): fluxo do GitHub `testar-homologacao.yml` (manual, só contra
      `hml-*`, nunca contra a produção) que abre um navegador de verdade, entra com os usuários de teste lendo as senhas do cofre
      (**ninguém digita nem cria senha**), executa o roteiro da versão e guarda prints/vídeo/relatório como artefato; e o
      `deploy-homologacao.yml` ganha a opção de publicar **uma branch** (não só a `main`), para a regra da v5.5 em diante.
      **Acesso (decidido pelo presidente em 2026-10-05):** a homologação fica **sem segundo passo (MFA)** — nada real entra lá e o MFA já é
      provado na produção e pela suíte; o robô e as pessoas entram só com CPF e senha. O roteiro `popular` desliga a exigência **só no banco
      `asaf_hml`** (confere o nome do banco antes de gravar e recusa qualquer outro; teste prova). O MFA de **produção** não se mexe
      (`DECISOES_CONGELADAS.md` §3.1). O presidente também entra na homologação para testar à vontade (lançar, desfazer, aprovar).
      *(Primeira tentativa, ainda no modo automático, foi barrada pela trava de segurança do Claude Code e nada foi contornado; o
      presidente passou ao modo manual e repetiu a ordem no chat.)*
      **Provado (2026-10-06):** o robô (`testar-homologacao.yml` + `painel/e2e-hml/`) rodou dezenas de vezes na homologação publicada;
      sem trace e com a entrada "boxed", a varredura de senha nos resultados nunca achou nada; o reinício do banco de teste foi exercitado de
      ponta a ponta duas vezes. **Ainda NÃO provado:** publicar uma **branch** (`ref`) na homologação — está implementado e coberto por teste do
      YAML, mas só será exercitado com uma branch de verdade na v5.5.
- [x] **FASE 0 — entrar e sair:** login por CPF e senha, saída, sessão que expira (volta ao login), tela proibida (403 amigável), menu
      que muda conforme o nível, "ver como" outro nível (v0.2.9), faixa **AMBIENTE DE TESTE** sempre visível, **Configurações**
      (catálogos) editando e a opção nova aparecendo no cadastro, **Auditoria** mostrando tudo o que foi feito nesta versão.
      **Provado ao vivo, pela tela, com print de cada passo:** entrada com CPF e senha **sem** segundo passo; CPF inválido e senha errada
      recusados; sair, rota protegida sem sessão e **sessão que acaba** (sem o cookie volta ao login); Secretário vê documentos/associados
      e não vê financeiro (e digitar o endereço também é negado), Tesoureiro vê financeiro e parcerias e não vê documentos; "ver como"
      Associado (faixa "somente leitura", menu sem os módulos de gestão, "Encerrar" devolve o menu completo); faixa AMBIENTE DE TESTE em todas
      as telas; Configurações: opção nova de **estado civil** aparece no cadastro e **some ao desativar**; Auditoria lista cada ação feita.
- [x] **FASE 1 / 2.5.1 — associados:** cadastrar pela tela (CPF inválido recusado; CPF repetido recusado **na hora**, não depois), editar,
      subir foto e **abri-la**, filiação (da intenção ao efetivo), licença / desligamento / retorno, ficha 360º e linha do tempo,
      família e núcleo doméstico, voluntário e empregado, importar e exportar CSV, qualidade da base (pendências do cadastro).
      **Provado ao vivo, pela tela, com print:** cadastro (CPF inválido, CPF repetido, nome vazio e **cadastro parecido** recusados; o Secretário
      não tem como forçar e o Presidente força, ficando na Auditoria); lista e filtro; edição que **continua lá depois de recarregar**; **foto
      que sobe e ABRE** (a imagem carrega e responde 200); ficha 360 e linha do tempo; cargos (registrar posse, encerrar); família (recusa,
      adicionar, remover); situação (licença, desligamento com confirmação, **anonimizar antes do prazo recusado**, readmissão, histórico com o
      dia certo); propostas de filiação (entram pela rota pública, recusa sem motivo barrada, só aprova depois de conferir, abre o cadastro
      criado); **qualidade da base** (o sistema acha o par duplicado, recusa nome errado e dois associados, **mescla de verdade** um associado
      com uma pessoa sem cadastro, ignora da fila); vínculos (termo de voluntário com recusa da autorização do responsável, registro e **renovação
      que sobe a versão**, funcionário, e-mail suspeito indo para a fila); completude do cadastro **subindo** ao preencher; situação guardada ×
      calculada; **importar** CSV (linha boa criada, CPF inválido e repetida barrados) e **exportar** (o CSV baixado tem as colunas escolhidas e o
      total bate; o Secretário não vê o botão; a Auditoria registra); redefinir o segundo passo (só quem gerencia o acesso, com confirmação e
      Auditoria); recadastramento ("Confirmo que meus dados estão corretos" + Auditoria); gráficos abrem com dados.
- [x] **Achados da conferência ao vivo (2026-10-05 e 06).** O robô (`painel/e2e-hml/v5.4c-*.spec.ts`) rodou várias vezes na homologação; o
      que ele achou, e a leitura do código que ele provocou (marcado: **[corrigido]** já feito e provado, **[aberto]** falta fazer):
      1. **[corrigido]** o menu e as rotas do painel só enxergavam as permissões do **nível**, não as do **cargo** em mandato: o Secretário
         e o Tesoureiro de teste entravam e viam "Nenhum módulo disponível", embora o servidor os autorizasse. `/auth/me` agora soma as do
         mandato (nunca no "ver como"). Provado ao vivo (os dois passam a ver o que o cargo dá); teste reprova sem a correção.
      2. **[corrigido]** v1.4 marcada concluída **sem tela**: licença, desligamento, readmissão, histórico e anonimização. Nova aba
         "Situação" na ficha do associado (desligar pede confirmação mostrando as consequências).
      3. **[corrigido]** v1.2 marcada concluída **sem tela**: propostas de filiação. Nova página "Propostas de filiação" (conferir, recusar
         com motivo, aprovar e efetivar; só o Presidente força cadastro parecido).
      4. **[corrigido]** a mensagem de CPF inválido saía como "Value error, CPF inválido…" (jargão do Pydantic).
      5. **[corrigido]** licença e desligamento de 05/10 apareciam como **04/10**: o servidor guarda um *dia* (meia-noite sem fuso) e o painel
         o convertia como instante UTC. **Classe de defeito a caçar nas v5.4d–f** (toda data só-dia exibida como instante).
      6. **[SEGURANÇA — corrigido; estava em produção desde o protótipo]** ao chamar **cada rota sem login** (varredura automática), 7 rotas
         antigas mexiam em dado de associado **sem exigir login**, só com o número do associado (sequencial): `PUT /api/meu-perfil/{id}`
         (trocar e-mail, telefone e endereço de qualquer um), `POST /associados-master/` (cadastrar associado direto, sem proposta nem
         conferência), `GET /api/associados/busca-simples` (nome e fim do CPF de **todos**), `GET /api/associados/{id}/carteirinha` (gerar
         carteirinha **válida** de qualquer um), `GET/POST /api/associados/{id}/dependentes` (ler e criar vínculos de família),
         `/categoria-calculada` e `/completude`, e `POST /setup-cerebro/`. Agora exigem login e a permissão `associados` (ou ser o próprio
         dono da ficha); o autoatendimento passou a gravar auditoria. **Sem evidência de abuso, mas também sem como saber:** essas rotas não
         deixavam rastro. Trava permanente: `tests/test_rotas_sem_login.py` chama todas as rotas sem login e exige que as abertas sejam
         exatamente a lista das públicas de propósito.
      7. **[corrigido]** ler e gravar os **valores de campo personalizado** de qualquer registro estava aberto a qualquer logado (até um
         associado comum); agora vale a permissão do módulo dono da entidade.
      8. **[corrigido, infra]** o 1º reinício real da homologação falhou (esquema `public` de banco novo no Azure é do `azure_pg_admin`) e o
         papel de teste tem limite de 5 conexões (a API usava até 15): `entregar_esquema_public` e pool 3+1. Publicar uma branch na
         homologação já é possível (`ref`).
      9. **[corrigido]** funcionalidades da FASE 1 marcadas como concluídas **sem tela**, todas agora com tela, teste de tela (axe incluso) e
         roteiro do robô: qualidade da base (duplicidade, fila de revisão, mesclar, ignorar, higienizar telefones), termo de voluntário e
         funcionário (v1.6), e-mail suspeito, completude, situação calculada, recadastramento, **exportação de associados** (v1.3, permissão própria
         e auditada — a função do cliente existia e nenhuma tela a usava), redefinir o segundo passo. **Trava permanente:** `tests/test_rotas_com_tela.py`
         exige que toda rota do servidor tenha chamada no painel ou conste ali com a versão do plano que a resolve (a lista só pode encolher).
      10. **[corrigido — erro que só o Postgres real mostrou]** **mesclar duas pessoas nunca funcionou em produção**: o servidor apagava a
          pessoa absorvida enquanto a fila de revisão (de onde a mesclagem sempre parte), inscrições, presenças, beneficiários, documentos
          emitidos e isenções ainda apontavam para ela; no Postgres isso é violação de chave estrangeira (erro 500; na tela, "Failed to fetch"). O
          SQLite dos testes **não confere chave estrangeira**, por isso passava. Corrigido (toda referência a `pessoas` sem regra própria passa
          a apontar para quem fica; conflito que não dá para juntar devolve 409 explicando, não 500) e **a suíte agora liga a conferência de chave
          estrangeira no SQLite**: os 861 testes seguem verdes, então não há outro caso exercitado.
      11. **[corrigido]** o formulário do **termo de voluntário não tinha o campo da autorização do responsável**, que o servidor exige quando a
          pessoa é menor **ou quando a data de nascimento falta** (não dá para provar a maioridade); quem tentasse ficava travado.
      12. **[corrigido]** o formulário de **novo associado** não oferecia "Cadastrar mesmo assim" ao Presidente quando o servidor barra cadastro
          parecido (só a caixa de propostas oferecia).
      13. **[corrigido]** dois cadastros duplicados costumam ter o **mesmo nome**: a fila agora diz quem é associado (e a matrícula) e quem é só uma pessoa.
      14. **[aberto, decisão de produto]** o CPF aparece sem máscara no cabeçalho da ficha; "Recadastramento pendente" já no cadastro recém
          criado; existem **dois** modelos de cargo (o "Histórico de cargos" livre da ficha × os Mandatos da Governança) — avaliar na v5.4d.
      15. **[aberto → v5.4g]** o cartão "Editar o site" do painel de teste abre o Directus de **produção** (Directus de teste previsto).
      16. **[aberto]** `/api/associados/busca-simples` e `PUT /api/meu-perfil/{id}` são **legados duplicados** (o painel usa a lista de
          associados e `/auth/perfil`), agora protegidos; a decisão é **removê-los** (ainda são usados por testes antigos).
      17. **[observação]** "Ver como" usa uma janela de confirmação **nativa do navegador** (`window.confirm`) em vez do diálogo do painel
          (inconsistente com o resto; funciona).
      18. **[corrigido, com dívida registrada]** acessibilidade: o inventário do robô achou **183 campos sem nome para leitor de tela** em
          telas que já existiam (o `<label>` ficava solto ao lado, sem `for`). Corrigido com `aria-label` nas telas que a conferência tocou e
          com o componente `AssociarRotulos` (rede de segurança no painel inteiro: liga o rótulo solto ao campo seguinte; teste de unidade e
          teste de tela com axe). **Dívida:** trocar, aos poucos, o rótulo solto por `<Label htmlFor>` nas telas antigas (a rede cobre enquanto isso).
      **Resultado:** o roteiro v5.4c rodou **29 de 29 cenários verdes** na homologação (artefato `conferencia-homologacao-v5.4c` do GitHub, com
      print e vídeo de cada passo; fica guardado 30 dias).
      **Produção (por leitura, sem dado de teste):** a correção da mesclagem passou nos testes **no Postgres real** do pipeline e foi para o ar
      (o primeiro envio falhou no CI só por uma afirmação de teste que só vale no SQLite; corrigido o teste, não o pipeline); as rotas que
      estavam abertas respondem **401**; a versão do painel no ar bate com o commit.

#### v5.4d — FASE 2 e FASE 2.5 ao vivo: governança

- [x] **Diretoria e Conselho Fiscal:** nomear, encerrar e renovar mandato; **cargos do Art. 19 (7) e do Art. 24 (3)**; o menu e as
      permissões do usuário **mudam sozinhos** quando o cargo muda (Secretário passa a ver documentos).
      **Na homologação (roteiro `v5.4d-04-mandatos`, 7 de 7):** a diretoria (7 cargos) e o Conselho Fiscal (3) semeados aparecem com situação e
      datas (15/01/2026, não 14/01); o Secretário abre e lê Mandatos e o Tesoureiro é barrado; tudo vazio, associado não escolhido, **cargo já
      ocupado**, **Conselho Fiscal completo (3 de 3)** e fim antes do início são **recusados**; **encerrar o mandato do Tesoureiro tira o
      Financeiro e a Parceria dele ao vivo e registrar de novo devolve** (a segunda aba que tenta encerrar o já encerrado recebe a recusa uma
      vez só); conflito de interesse declarado (as duas faltas aparecem), com a data de hoje, e encerrado; tudo na Auditoria.
- [x] **Assembleia de ponta a ponta:** criar, convocar (edital), habilitar quem pode votar, abrir a sessão, chamada (presença,
      autochamada, justificativa de falta), votação com o motor de votos (quórum e empate), encerrar, ata com **anexo que abre**,
      deliberação com efeito, "Minhas Assembleias" visto como associado comum.
      **Na homologação (roteiros `v5.4d-03` e `v5.4d-05`, todos verdes):** assembleia sem ordem do dia recusada; criada vira rascunho; convocar
      gera o edital; sessão com código de chamada; credenciar, **sair e voltar**; votação **barrada sem quórum** (Art. 6º); quórum atingido,
      **quem não está na sala não vota**, voto repetido recusado, apuração com hash de integridade, ocorrência, encerrar item e sessão;
      justificativas (vazia e curta recusadas; **rejeitar exige motivo**); "vendo como Associado" (somente leitura) recusa a chamada e a
      justificativa; autochamada com código vazio, errado, certo e a segunda tentativa recusada; correção de presença depois do fim; **ata gerada do
      registro** (presença, votação, ocorrência), segunda geração recusada, relato salvo; **documento oficial anexado** (formato ruim e "PDF"
      falso recusados), **baixado de volta com status 200 e o mesmo conteúdo**, protocolo com o dia certo, troca do anexo; deliberações (campo
      vazio, ano, parecer do Conselho Fiscal recusados), conclusão com certidão e revogação; eleição (cria o mandato; cargo ocupado recusado) e
      reforma de estatuto (a pendência fica visível); ata travada e **retificada, com a original ainda alcançável**; petições de convocação
      (propor, aderir, segunda adesão recusada, converter antes do quórum recusado, **o Tesoureiro também propõe e adere**).
- [x] **Conselho Fiscal com poder real:** consulta ao financeiro que **grava a consulta na Auditoria**; fila de questionamentos
      (conselheiro pergunta, tesouraria responde, histórico fica); **parecer** (favorável, com ressalva, contrário) — e a
      deliberação de "aprovação de contas" **só pode ser criada com o parecer do ano**. Depois: **disciplina** (abrir, defesa,
      decisão), **dissolução** (art. 61 do Código Civil: só simulada — nada irreversível) e **calendário institucional**.
      **Na homologação (roteiros `v5.4d-06` e `v5.4d-07`, 16 e 4 cenários verdes), o que já está provado:** a consulta do Conselho Fiscal ao
      financeiro e ao razão aparece na Auditoria com quem viu (e a do Tesoureiro também; o Secretário é barrado); a fila de questionamentos
      recusa o Presidente e a pergunta vazia; "vendo como Conselho Fiscal" recusa o parecer com a explicação (e não mais "sem conexão"); parecer com
      campo faltando e do Presidente recusados; **disciplina**: abrir (dados faltando recusados), prazo de defesa, decidir e manifestar antes da
      defesa recusados, o acusado entra pela própria conta, só vê o dele, defesa curta recusada, apresenta a defesa e **não vê as etapas de quem
      julga**, o Secretário se manifesta uma vez e repetir é recusado, decidir sem quórum recusado, o Presidente (sem mandato) não se manifesta,
      confidencialidade (404 para quem não é parte); **dissolução** (nada irreversível): motivo curto recusado, só a etapa 1, vincular deliberação
      inexistente recusado, **cancelar pede confirmação** e vira Cancelado; **calendário**: campos faltando recusados, evento do meio-dia e o das
      22h30 de Belém no dia certo, fim antes do início recusado, o Tesoureiro vê o evento sem o botão de agendar; **Regras do Estatuto**: lista,
      valor impossível e igual ao atual recusados no campo, **reforma de verdade com confirmação, histórico das duas vigências e Auditoria**, e o
      valor devolvido ao de origem; **Deliberações pendentes** abre para a Diretoria e leva à ata.
      **Provado ao vivo com gente com cargo (roteiro `v5.4d-08`, 7 de 7; usuários de teste novos: Presidente do cargo, 1º e 2º Vice-Presidente e
      Conselheiro Fiscal, com as senhas no cofre `HML-USUARIOS`):** o **conselheiro (pelo cargo no Conselho Fiscal) emite o parecer** (texto vazio e
      ano 2012 recusados; o válido entra na lista e na Auditoria com o nome dele); ele **pergunta sobre um lançamento** (pergunta vazia recusada), a
      **tesouraria responde** (resposta vazia recusada) e o questionamento passa a Respondido; com o parecer do ano emitido, a deliberação de
      **"aprovação de contas" daquele ano é aceita** (sem parecer era recusada); **disciplina**: a Presidente abre dois processos contra o
      Tesoureiro, ele apresenta a defesa nos dois, quatro diretores se manifestam, **com um voto a menos que o quórum a decisão é recusada** e, com o
      quórum, o processo é **decidido (advertência) e a Auditoria registra**; a eliminação decidida **fica aguardando a assembleia**, que a
      recusa (justificativa obrigatória), e **nada irreversível acontece** (o Tesoureiro continua associado e com o menu do cargo).
- [x] Lista de **achados** corrigidos e refeitos; prints.
- [x] **Achados da conferência ao vivo (2026-10-06).** Os roteiros `painel/e2e-hml/v5.4d-0*.spec.ts` (assembleia de ponta a
      ponta, mandatos, ata/petições/minhas assembleias, Conselho Fiscal/disciplina/dissolução/calendário) e a leitura do código que eles
      provocaram acharam o que segue. **[provado]** = corrigido e refeito ao vivo na homologação; **[corrigido]** = corrigido com teste,
      falta refazer ao vivo no próximo ciclo; **[aberto]** = fica registrado com o motivo.
      1. **[provado]** chamada da sessão: quem registrava saída **não tinha como voltar** ("já foi credenciado") e a tela o continuava listando
         em "Presentes (1)" enquanto o quórum dizia 0 / 44. Agora a volta reabre o mesmo credenciamento (auditada como REENTRADA), e a tela separa
         "Presentes" de "Saíram" com "Registrar retorno".
      2. **[provado]** `votar` só conferia a lista de habilitados: quem nunca fez a chamada, ou já tinha saído, **votava**. Agora exige estar
         presente (credenciado e sem saída, o mesmo critério do quórum).
      3. **[provado]** a recusa do servidor aparecia **duas vezes** em 70 formulários (o formulário já a mostra e a tela repetia). Removidos
         os 70 blocos; trava permanente em `painel/src/test/erro-duplicado.test.ts` (por componente).
      4. **[provado]** **regra do estatuto sem validação**: o servidor aceitava qualquer texto como quórum, e "abc" ou "2/0" derrubaria a
         apuração de quórum (e a abertura de toda votação) até alguém reformar de novo. Agora recusa por tipo (fração, número, sim/nao, meses da
         AGO) antes de virar a regra vigente.
      5. **[provado]** **dois Presidentes ao mesmo tempo**: o servidor dava posse a quantos pedissem no mesmo cargo, e as permissões do cargo
         somavam. Agora: um titular por cargo (Art. 19) e três conselheiros fiscais (Art. 24, parâmetro `VAGAS_CONSELHO_FISCAL`), com a vacância
         liberando a vaga no mesmo instante e o sucessor podendo tomar posse quando o mandato acaba. Posse em 29/02 que caía em ano não bissexto
         dava erro 500.
      6. **[provado]** **ninguém conseguia emitir parecer do Conselho Fiscal pela tela**: só o *nível* contava, não o cargo em mandato; sem
         parecer, a deliberação de "aprovação de contas" nunca podia ser criada. Agora vale também o mandato vigente no órgão (nunca no "ver como").
      7. **[provado]** o **acusado que é diretor** podia decidir, homologar e ver a apuração do próprio processo disciplinar; e via os botões.
      8. **[provado, segurança]** a lista e o detalhe dos **processos de dissolução** (com o motivo) eram legíveis por **qualquer usuário
         logado**; agora exigem `governanca`.
      9. **[provado]** calendário: reunião das 22h30 em Belém aparecia no **dia seguinte** (o dia vinha de UTC; agora vem do fuso da associação,
         `FUSO_HORARIO`); fim antes do início era aceito; data passada era aceita e nunca aparecia; **não havia como remover** um evento (agora há,
         com confirmação e na Auditoria).
      10. **[provado]** mandatos: datas só-dia apareciam um dia antes em Belém (15/01 → 14/01); o aviso de vacância sem substituto (Art. 26) **nunca
          aparecia** (o bloco fechava antes); mensagem de erro repetida; "Carregando…" aparecendo como "nenhum mandato"; o alerta
          `/api/mandatos/vencendo` não tinha tela (agora há "Mandatos vencendo").
      11. **[provado]** ata: o que falta fazer depois de concluir uma deliberação (cartório, reforma de estatuto) **sumia** com o painel; erro do
          ano em "aprovação de contas" não aparecia; "Gerar ata" recusado deixava a **página em branco**; data de protocolo um dia antes; depois
          de **retificar**, a tela mostrava uma das duas atas ao acaso (agora a mais recente, com as versões navegáveis e `?ata=`); **certidão** saía
          de deliberação pendente ou revogada; o texto do rascunho nunca refletia presença corrigida depois (novo "Atualizar o texto").
      12. **[provado]** justificativa de falta: rejeitar sem dizer o motivo (o associado não sabia por quê); justificar estando presente;
          "Lançar em nome" oferecido com a assembleia já encerrada (o servidor sempre recusa); quem teve a falta justificada e compareceu não
          conseguia bater presença.
      13. **[provado]** petição de convocação: a tela diz que qualquer associado propõe e adere, mas a rota ficava dentro de Governança (associado
          comum caía em "acesso negado"). Agora há a rota `/peticoes-de-convocacao` e o item no menu de todos.
      14. **[provado]** telas que faltavam (rotas do servidor desde a v2.x sem nenhuma tela): **Regras do Estatuto** (lista, histórico e reforma,
          com validação e confirmação), **Deliberações pendentes** (cross-assembleia) e **Mandatos vencendo**. As três rotas genéricas
          `/api/agenda/*` (sem uso humano; o motor continua nos serviços de espaços) foram **removidas**.
      15. **[provado]** dissolução: cancelar, destinar o patrimônio e a baixa cadastral agora pedem confirmação; erros de campo não
          apareciam; processo inexistente deixava "Carregando…" para sempre (o mesmo em disciplina). Campos sem nome para leitor de tela em
          disciplina, dissolução, Conselho Fiscal, ata, eleição e calendário ganharam `aria-label`. O seletor de tamanho de página da Auditoria
          mostrava "10 / página" com 25 linhas.
      16. **[aberto]** a dissolução **não tem modo simulado** (o plano pedia "só simulada"): as etapas são reais, agora com confirmação e na
          Auditoria. Os parâmetros `QUORUM_DISSOLUICAO_*` existem no estatuto mas **nenhum código os lê**. Decidir com o presidente.
      17. **[provado]** o robô não tinha login de **conselheiro fiscal** nem de diretores suficientes para o quórum de decisão da disciplina (só
          Presidente, Secretário e Tesoureiro): parecer, questionamento e decisão só são provados pela recusa. Ampliar o roteiro de
          `popular_homologacao.py` (com as senhas no cofre) na próxima rodada.
      18. **[aberto]** campos do formulário de **título financeiro** sem nome acessível (`Titulos.tsx`): entra na varredura da v5.4e.
      19. **[aberto, decisão de produto]** um mesmo associado pode ter vários pareceres do Conselho Fiscal no mesmo ano; questionamento respondido
          não reabre; `gerar_ata` aceita assembleia ainda "Em andamento" (só a tela exige "Realizada"; o rascunho agora pode ser atualizado);
          aderente converter petição em assembleia depois do prazo do Art. 10 vive numa rota de Governança.
      20. **[provado, estava em produção desde a v0.2.9]** **a recusa de escrita no modo "ver como" chegava ao navegador sem os cabeçalhos de
          CORS**: o intermediário que a gera ficava por fora do CORS, o navegador escondia a resposta (o painel e a API ficam em endereços
          diferentes) e a tela dizia **"Sem conexão com o servidor"** em vez de "somente leitura". Achado quando o roteiro tentou emitir um parecer
          "vendo como Conselho Fiscal". Agora o CORS é o mais externo; teste em `tests/test_ver_como_somente_leitura.py`.
      21. **[provado]** formulários que recusavam o envio **em silêncio**: a recusa de um campo (por exemplo, um select obrigatório sem lugar
          para o erro, como "associado" na declaração de conflito) não aparecia em lugar nenhum. O `FormShell` agora lista, no alto do formulário, as
          recusas que nenhum campo mostra (sem repetir as que já aparecem no campo); vale para todas as telas.
      **Resultado na homologação:** o roteiro completo `v5.4d` (abertura de todas as telas de governança, assembleia de ponta a ponta,
      mandatos, ata/petições/minhas assembleias, Conselho Fiscal/disciplina/dissolução/calendário, Regras do Estatuto, Deliberações pendentes,
      parecer e decisão da disciplina) tem **76 cenários, todos verdes**: a última bateria completa (com o banco de teste recriado do zero) deu 70
      de 71 por um seletor do roteiro `v5.4d-08`, corrigido, e o `v5.4d-08` refeito deu **7 de 7** (artefatos `conferencia-homologacao-v5.4d*` do GitHub, com print e vídeo de cada passo).
      **Em produção (por leitura, sem dado de teste):** `painel.asaf.org.br/version.json` = `c326585` (o último commit do painel); a API no ar é a do
      `e6d4471` (o último commit do servidor, com a correção do CORS), e o servidor de produção responde ao preflight com
      `access-control-allow-origin: https://painel.asaf.org.br`; as rotas novas e as protegidas respondem **401** sem login
      (`/api/estatuto/regras`, `/api/deliberacoes/pendentes`, `/api/processos-dissolucao/`, `/api/mandatos/vencendo`,
      `DELETE /api/eventos-calendario/1`) e as rotas genéricas removidas (`/api/agenda/compromissos`) respondem **404**.

#### v5.4e — FASE 3 ao vivo: financeiro

- [x] **Base contábil:** exercício, plano de contas, centros de custo, contas financeiras; lançamento em partida dobrada que **não fecha
      é recusado**; lançamento **não se apaga** (estorno), e o razão contábil bate com o livro-caixa.
      **Na homologação (roteiro `v5.4e-01`, 17 de 17, o do fechamento do exercício rodado à parte):** plano de contas (campos vazios, código
      repetido, **pai circular**, trocar tipo/código de conta com filhas ou movimento, excluir conta usada: tudo recusado em português); centros
      de custo (inativar, destinação restrita, remanejamento recusado); contas financeiras só de conta Ativo; baixa e transferência em partida
      dobrada com os valores ao centavo; **estorno** como outro lançamento com as partidas invertidas e os saldos voltando; **exercício fechado
      bloqueia lançamento e não reabre**; tudo na Auditoria. **Em produção (só leitura):** `version.json` no commit publicado e as rotas novas
      respondendo 401 sem login.
- [x] **Receita:** planos de contribuição, gerar cobranças em bloco, baixa de título, inadimplência como processo (negociação de dívida),
      desconto por pagamento antecipado, doações e **recibo que abre**.
      **Na homologação (roteiro `v5.4e-02`, 27 de 29):** plano e reajuste (valores impossíveis recusados), campanha de desconto, isenção de 40%
      e 100%, **cobrança em lote** (prévia linha a linha ao centavo, segunda confirmação não duplica, quem pagou o bloco não é cobrado de novo),
      **baixa parcial, pagamento a maior virando crédito do associado**, **negociação de dívida** (3 parcelas de R$ 50,17 / 50,17 / 50,16),
      doação em dinheiro com **recibo numerado que abre**, anônima, recorrente e em bens, conciliação por extrato (OFX/CSV) e fechamento do mês.
      **Fora do fechamento (abertos, não são defeito desta fase):** o Pix precisa da chave da instituição, que ainda não tem tela (módulo
      Instituição, a criar), e uma sondagem que falha às vezes porque a lista de Títulos ainda não pagina.
- [x] **Despesa com segregação de funções:** compra, conta a pagar (recorrentes), reembolso; **quem criou não aprova** (Tesoureiro prepara,
      Presidente aprova); alçadas de aprovação; fornecedores; conciliação bancária.
      **Na homologação (roteiro `v5.4e-03`, 12 de 12):** fornecedor (CNPJ curto, só letras, repetido e **dígito errado** recusados), alçadas,
      compra simples, **cotações** (duas do mesmo fornecedor valem uma), **dupla assinatura**, **delegação** (só quem delega registra),
      **conflito de interesse**, **reembolso** (o beneficiário não aprova o próprio), contas a pagar recorrentes, e quem não tem o Financeiro é
      barrado em todas as telas.
- [x] **Orçamento e fluxo de caixa, relatórios e prestação de contas, controles antifraude** (alerta dispara de verdade).
      **Na homologação (roteiros `v5.4e-01` e `v5.4e-04`, 16 de 16):** orçamento por conta e centro (o "Estourado" só vale para despesa; receita
      acima do previsto é "Meta atingida"), fluxo de caixa que fecha mês a mês, reserva de contingência; **alertas do Conselho Fiscal** (fornecedor
      novo, perto do teto, troca de dados bancários, estornos) que disparam com as ações do roteiro e somem quando a causa some; balancete,
      receitas x despesas, por projeto e extrato conferidos ao centavo; **prestação de contas** com versões que não mudam.
- [x] Os **valores** vistos nas telas conferem **centavo a centavo** com o que foi lançado; lista de achados corrigidos e prints.
      **Achados corrigidos nesta fase (todos provados na homologação antes de ir para a produção):** campo opcional em branco virava `0`; mês 13,
      centro de custo, fornecedor e conta inexistentes davam erro 500; um erro 500 aparecia como "sem conexão"; delegação de aprovação podia ser
      registrada por outra pessoa; baixa de título renegociado era aceita; beneficiário aprovava o próprio reembolso; orçamento de receita saía
      "Estourado"; relatórios mostravam "sem movimento" quando a consulta falhava; dinheiro com ponto decimal nas mensagens e recibos; o Tesoureiro
      não conseguia escolher o associado; CNPJ sem dígito verificador era aceito; Início do Financeiro era uma página de obra (agora é o retrato
      do dia). **Em produção (só leitura):** commit `1a537d2`; nenhum dado de teste foi criado lá.
      **Pendências que nasceram aqui e seguem registradas (não bloqueiam o fechamento):** paginação da lista de Títulos; módulo **Instituição**
      (dados da instituição, inclusive a chave Pix); decisões sobre compra, reembolso e Conselho Fiscal (listadas ao Presidente na conversa).

#### v5.4f — FASE 4 ao vivo: projetos, reserva de espaço e eventos

- [x] **Projeto:** criar, editar, publicar no site (aprovação), **em destaque**, beneficiários e atendimento, voluntariado vinculado.
      **Na homologação (roteiro `v5.4f-01`, 22 de 22):** quem não tem a permissão de Projetos é barrado (tela e servidor); criar e editar recusam
      o que falta e **dado pessoal em texto público**; publicar no site e **destaque** (vários destaques convivem; o site acompanha); cronograma,
      equipe (coordenador), indicadores com meta; beneficiário com e sem consentimento LGPD; **prontuário só para a equipe do projeto**;
      voluntariado de ponta a ponta (termo, candidatura, confirmação só pelo coordenador, troca de turno, horas); relatório final versionado.
      **Ressalva:** o projeto Público é publicado na hora, **sem uma etapa de aprovação por outra pessoa** (documentos e parcerias têm): decisão
      do Presidente (listada na conversa).
- [x] **Reserva de espaço:** reservar, **conflito de horário recusado**, cancelar, calendário do espaço.
      **Na homologação (roteiro `v5.4f-02`, 16 de 16):** espaço (nome repetido, prazo e percentual impossíveis recusados), tarifa com cobrança e
      isenção, **todas as sobreposições de horário recusadas**, reserva no passado recusada, cancelar dentro e **fora do prazo (a taxa aparece
      para quem cancela)**, aprovação, recorrente, bloqueio, checklist, exportação e mapa de calor na hora de Belém.
- [x] **Evento:** criar ligado a um projeto, programação em sessões, inscrição **pelo site** (CPF repetido não duplica), vagas, **lista de
      espera que anda quando alguém cancela**, inscrição em grupo, check-in com crachá/QR, certificado **que abre**, financeiro do evento,
      painel gerencial.
      **Na homologação (roteiros `v5.4f-02` e `v5.4f-03`, 16 de 16 cada):** evento ligado ao projeto, sessões, **cancelar um inscrito libera a
      vaga e promove o primeiro da fila**, duplicidade recusada sem gastar vaga, **inscrição pública em grupo** (3 pessoas, um título de R$ 87,65
      cada), cobrança e reembolso configuráveis, **crachá com QR**, portaria sem login (check-in e check-out, recusas), **certificado** (só quem
      esteve presente, abre com o nome), documentos emitidos, fechamento do evento e exportações com Auditoria. (CPF repetido pelo site: provado
      na suíte automática; ao vivo, pelo painel.)
- [x] **Despertai e o contexto do evento:** página do projeto no `hml-site` (fotos, edições, relatórios aprovados, notícias vinculadas),
      destaque na Home, página do evento com o projeto de origem, foto de evento, **relatório de evento aprovado** na Transparência;
      dado pessoal digitado no texto público é **barrado**. **Na homologação (2026-10-08):** `v5.4g-04`, 9 de 9, pelo painel: o projeto Público em destaque
      (CPF e e-mail no texto público barrados sem gravar; destaque em projeto Interno recusado; vários destaques convivem), a 1ª edição e a nova edição no mesmo
      projeto, sessão, um evento Interno também ligado, a foto do evento (sem a autorização de imagem é recusada; com ela entra e o JPEG servido ao público é
      regravado, sem GPS, aparelho nem comentário, com o mesmo SHA-256 que a API declara), o relatório cadastrado pelo Secretário e aprovado pelo Presidente (antes
      de aprovado não aparece; depois aparece no evento, no projeto e na Transparência com o vínculo), a API pública sem nenhum campo de gestão, o Interno
      que nunca aparece (virar Interno tira tudo do ar e voltar a Público devolve) e a Auditoria com a contagem exata. Depois de reconstruir o site de teste,
      `v5.4g-05`, 6 de 6, abrindo o `hml-site` como visitante: a Home destaca o Despertai e não mostra o Interno; a página do projeto traz as edições, o relatório e
      a foto (carregada); a página da 1ª edição traz o projeto de origem, a outra edição, o relatório e a foto. Fica de fora: **notícias vinculadas** (o site de
      teste não tem notícias; o editor é um só, o de produção, e ainda não há conteúdo).
- [x] Lista de **achados** corrigidos e refeitos; prints do painel e do site.
      **Achados corrigidos (todos provados na homologação antes da produção):** vaga gasta por inscrição recusada; cancelar pelo painel não
      liberava a vaga; configurações do evento aceitavam 150% e prazo negativo; sessão de evento com hora com fuso derrubava o servidor (refeita
      e provada); troca de turno com a própria pessoa; cobrança não paga ficava "Pendente" depois de cancelar a reserva; relatório final dizia que
      o motor de beneficiários "não existe"; datas só-dia apareciam um dia antes; horas de voluntariado sem rastro na Auditoria; erros de ação
      sem aviso na tela (espaços e voluntariado). **Em produção (só leitura):** commit `1a537d2`.
      **Pendências que nasceram aqui:** telas que faltam (inscrição no evento pelo painel, núcleo familiar do beneficiário, alocar voluntário);
      fluxo de **filiação com aprovações** e as notificações aos sócios ativos.

#### v5.4g — FASE 5 ao vivo (v5.0 a v5.4b): site e Transparência

- [x] **Todas as páginas do `hml-site`** abertas e conferidas (links, imagens, acessibilidade, `noindex`, faixa de teste): início, a associação,
      diretoria (Art. 19), projetos, eventos, notícias (a de teste não tem — o editor é um só), contato, privacidade, termos, transparência.
      **Na homologação (2026-10-08):** `v5.4g-01`, 5 de 5, num navegador de verdade sobre o `sitemap-0.xml` publicado (as 38 páginas, incluindo as de cada evento,
      projeto, assembleia, documento e emenda): todas abrem (200), têm um `h1` só, a faixa AMBIENTE DE TESTE e o `noindex`, passam no axe (WCAG 2.1 A e AA e
      boas práticas) sem nenhuma violação, nenhuma imagem quebrada nem erro na página; no celular (390 px) nenhuma vaza para o lado; todo link interno responde 200
      e os e-mails e telefones estão no formato certo; uma página inexistente cai na 404 do site (com a faixa) e o `robots.txt` proíbe tudo. Repetido depois das
      correções de texto (item abaixo): 5 de 5.
- [x] **Documentos:** Secretário prepara (original PDF + versão pública em texto), Presidente **aprova** (quem enviou **não** aprova o próprio);
      o **original nunca** sai pela API pública nem por `/uploads`; PDF só-imagem recusado; documento **Interno/Restrito** não aparece;
      retirar uma publicação e ver sair do site. **Na homologação (2026-10-08):** `v5.4g-02`, 7 de 7, pela tela e conferindo a API pública: o Secretário cadastra um
      documento Restrito com o original em PDF (que traz um CPF de mentira) e o original fica só na área privada; a versão pública é recusada com CPF, e-mail e
      celular (o achado volta **mascarado**, sem gravar nada), com PDF que traz CPF, com **tarja preta só desenhada por cima** do CPF (o texto continua lá e o
      verificador o lê), com PDF **só imagem** e com arquivo que não é PDF; o texto limpo é aceito; quem enviou para revisão não vê o botão de aprovar e a API
      recusa (403, "Quem criou ou enviou o documento…"); o Presidente aprova; a API pública mostra o texto e **nenhuma** menção ao original, não serve o PDF
      (404) e nenhum endereço de `/uploads` o serve; o original só baixa autenticado (o arquivo baixado é byte a byte o enviado) e o download fica na Auditoria;
      documento Interno e documento em rascunho nunca aparecem (404 no detalhe); retirar pede o motivo (curto demais é recusado) e o documento sai da API
      pública, com o histórico preservado. No `hml-site` reconstruído (`v5.4g-05`): a Transparência lista o aprovado e nenhum retirado, Interno ou rascunho, e a
      página do documento mostra o texto aprovado sem CPF.
- [x] **Parcerias e emendas:** cadastrar, parcelas, etapas **com foto**, movimentos classificados, relatório, publicação aprovada por segunda
      pessoa; o **valor mostrado no site bate** com o livro-caixa do centro de custo; edição depois de aprovada vai direto (decisão de 2026-10-04).
      **Na homologação (2026-10-08):** `v5.4g-03`, 8 de 8, pelas telas (Parcerias e o Financeiro): cadastro (formulário vazio, objeto com e-mail, valor e ano
      inválidos e identificador repetido recusados; nasce rascunho, com centro de custo próprio e fora da API pública); parcelas (a soma nunca passa do valor),
      etapas, relatório de prestação de contas e situação, cada regra recusando o errado; fotos da etapa (sem autorização, sem descrição, com CPF na descrição e
      arquivo que não é imagem recusados; a foto boa abre só com login e fica fora do público até aprovar); o dinheiro entra **só pelo livro-caixa** (1 receita e 2
      despesas lançadas no centro de custo da parceria) e a Razão e o relatório por centro de custo mostram os mesmos valores; cada movimento é classificado por uma
      pessoa (equipe só com a função, sem nome nem CPF) e sem classificar a publicação trava; o Tesoureiro envia e **não aprova** (a tela não oferece o botão e a
      API recusa, tanto por falta da permissão quanto por ser quem enviou), o Presidente e o Secretário aprovam; a API pública bate com o relatório por centro de
      custo, o resumo e a soma dos itens; nunca traz CPF, e-mail, celular, o nome do oficineiro nem o nome interno do centro de custo; a foto pública é a
      regravada; **editar depois de aprovada vai direto ao site** (e receita nova muda `recebido` na hora, ficando "em classificação" até alguém classificar);
      retirar tira da API; quem não tem a permissão é barrado na tela e na API (403) e a Auditoria cresce exatamente 24 (mais 2 recusas de aprovação na tabela
      `recusas`). No `hml-site` reconstruído (`v5.4g-05`): a emenda aparece com os **mesmos** valor da parceria, recebido, pago e saldo da API (que vêm do
      livro-caixa), e a parceria retirada não aparece. Fica de fora: o pagamento a fornecedor (razão social e CNPJ no site), que depende de fornecedor semeado.
- [x] **Vigilantes e avisos** (monitor do site, alerta de 2 h, trava de tamanho) conferidos **sem** apontá-los para a homologação (custo).
      **Conferido (2026-10-08), sem tocar na homologação:** o monitor e a sincronização do site, disparados à mão, terminaram verdes, e as últimas 60 execuções de
      cada um (agendadas) estão todas verdes, sem nenhum aviso aberto no GitHub; os scripts de **alerta** dos dois são EXECUTADOS pela suíte (bash de verdade:
      site atrás do sistema por mais de 2 horas vira alerta, menos que isso não, e o registro zera quando o site alcança o sistema; o monitor lista o que não
      respondeu), 12 testes; a **trava de tamanho** tem 8 testes (aviso a 60%, erro que para a publicação a 85%) e hoje o site tem 1,2 MB dos 250 MB; um teste novo
      garante que nenhum dos três (nem a trava) aponta para a homologação.
- [x] **Checklist do Ponto de Revisão FASE 5 (1/2) executado inteiro na homologação**, item a item, com o resultado registrado ali.
      **Andamento (2026-10-08):** feito e provado: (a) **Directus isolado** — `isolar_directus.py verificar` na PRODUÇÃO (só leitura): "o Directus não alcança nenhuma
      tabela do sistema", e `directus_configurar.py verificar --producao`: "conforme o modelo" (só coleções editoriais, nenhuma de negócio) — o que também prova
      "uma fonte só"; (b) **SEO e acessibilidade rodando no CI** (todo deploy do site passa por axe, Lighthouse e e2e: o último, verde) e agora também sobre as 38
      páginas do `hml-site` com dado real; (c) **rascunho não vaza, perfis do Directus e token de serviço só de leitura** — 45 testes do modelo do Directus e os do
      site (só publica o "publicado" com data vencida); (d) **nenhum PDF só imagem publicado**, **nenhum dado de exemplo na produção** (o `conteudo.json` de
      produção tem 0 eventos, 0 projetos, 0 dirigentes, 0 documentos) e **consistência de valores** (`v5.4g-03` e `v5.4g-05`); (e) **dado pessoal**: o original
      nunca sai, a tarja só desenhada não engana, Interno/Restrito não aparece, quem enviou não aprova (`v5.4g-02`); (f) **verificação independente de fatos** (um
      agente que não escreveu os textos) dos textos públicos mudados desde 03/10: 14 achados, dos quais corrigi e provei (privacidade 1.3, aviso do formulário na
      versão 2, frases de documento e de parceria, idade "18 anos ou mais", mensagem de e-mail em português) e **deixei para decisão do Presidente** os dois textos
      que são palavras dele: "A associação ainda não recebeu recursos de emendas parlamentares" (hoje sai de uma lista vazia, não de um fato) e "atualizada em até
      24 horas após qualquer recebimento" (depende de alguém lançar e aprovar). **Decisões do Presidente (2026-10-09), em resposta ao que faltava:** (1) **o Estatuto do site É a versão do cartório**, idêntica; só faltam as assinaturas do
      Presidente, do advogado e do Secretário, que não precisam estar no site, e o item está fechado; (2) **revisão jurídica**: a associação não contrata advogado e o
      Presidente deu os textos de Transparência, Privacidade e Termos por válidos como estão ("podemos dar por real o que foi feito"), **sem leitura de advogado**,
      e o registro fica assim, sem fingir que houve revisão jurídica; o que continua em aberto é **nomear o encarregado de dados** (LGPD, art. 41), pré-requisito da
      v5.5, e eu pergunto a ele quando a v5.5 abrir; (3) **os dois textos das emendas ficam como estão** ("A associação ainda não recebeu recursos de emendas
      parlamentares" e "atualizada em até 24 horas após qualquer recebimento"): conferido no código que a frase só aparece enquanto **não há emenda publicada** e some
      sozinha na primeira, e que a sincronização do site roda de 15 em 15 minutos (o normal é 15 a 30 minutos), então as 24 horas são uma promessa que o sistema
      cumpre com folga; (4) **dados reais da diretoria**: só o Presidente está cadastrado, e hoje `GET /api/publico/diretoria` devolve `[]` (a página diz que a
      composição atual ainda não foi publicada e explica a composição prevista no Estatuto). A diretoria aparece no site **quando houver mandato vigente registrado** (painel, tela Mandatos): o nome entra na
      API, a sincronização reconstrói o site sozinha e a página se preenche, sem ninguém mexer no site. O mesmo vale para a Instituição (CNPJ real, telefone,
      e-mail, horário e redes marcados "vai para o site"): na v5.4h o site passa a lê-la. **Na homologação isso é simulado**: a população de teste tem 10 mandatos
      (7 da Diretoria Executiva e 3 do Conselho Fiscal) e uma Instituição com CNPJ válido, telefone e horário, e o roteiro `v5.4h-13` confere o `hml-site`.
      **Estado em 2026-10-09:** a v5.4h está **fechada** (paginação de Associados e Razão e o site lendo a Instituição, os dois em produção) e todos os itens da
      lista abaixo estão conferidos, com as decisões do Presidente registradas acima (os cargos já estão alinhados ao Art. 19 e a página da Diretoria foi conferida
      no `hml-site` com os 10 mandatos de teste, sem CPF, e-mail nem telefone de dirigente). **Resta uma única pendência, que não se pode executar ainda:** a
      **conferência da diretoria contra a vedação do STF de 15/01/2026** (parentes de parlamentar), porque só há uma pessoa cadastrada; ela passa a ser **condição
      para lançar os mandatos reais** (o nome aparece no site em até cerca de 30 minutos depois do lançamento). Por isso este item fica aberto, e fica a decisão do
      Presidente de abrir a v5.5 com ele pendente.
      **Fechado em 2026-10-20, por decisão do Presidente:** a conferência contra a vedação do STF **não é feita pelo sistema nem pela IA**: é feita por ele e pela diretoria, com a composição real, que ainda não pode ser
      cadastrada (o sistema ainda não está pronto para receber essas pessoas). O Ponto (1/2) fica **fechado** e a conferência fica registrada, **sem ser dada por feita**, como condição para lançar os mandatos reais
      (seção D, item 2 do Fechamento da FASE 5): antes de cadastrar a Diretoria e o Conselho Fiscal reais, quem os cadastra confere cada nome contra a vedação.

##### Regra de trabalho a partir da v5.5 — a homologação é o portão (decisão do presidente, 2026-10-05)

> "A partir da v5.5, tudo vai ser feito teste a teste. Não vai ter mais processos internos, teste simulado. Literalmente é real. A IA vai
> testar na homologação, de fato. Se tiver certo lá, aí sim ela manda para o real."

Para **cada versão** (v5.5 em diante), nesta ordem — pular um passo é descumprir o plano:

1. **Implementar numa branch** (não na `main`) e passar a suíte completa local; a suíte continua existindo como rede de segurança, mas
   **deixa de ser o portão**.
2. **Publicar a branch na homologação** (`deploy-homologacao.yml` com a branch escolhida; migração e dados rodam primeiro lá,
   com o banco de teste, antes de qualquer coisa na produção).
3. **Conferir ao vivo na homologação** tudo que a versão entrega, pelas telas, no formato das versões v5.4c–g (ação na tela + print +
   Auditoria + abrir o que a tela oferece + provocar o erro que deve ser recusado). Defeito achado: corrige na branch, republica,
   **refaz o item**.
4. **Só com tudo conferido, ir para a `main`** (isso dispara a produção), acompanhar o pipeline e **confirmar em produção por leitura**
   (`version.json`, rota nova só com `GET`) — **produção nunca recebe dado de teste**.
5. Registrar no bloco da versão o que foi visto **na homologação** e o que foi confirmado **em produção**, em linhas separadas.

Mudança que não toca tela nem regra (documento, ajuste de pipeline) segue o fluxo curto do `CLAUDE.md`.


#### v5.4h — Lacunas achadas ao vivo (telas e módulos que faltam; decisões do Presidente em 2026-10-07)

Tudo aqui é construído (não é "decidir se faz"), na ordem abaixo, cada item pelo caminho de sempre: branch → homologação → robô → só então a
`main`. As decisões do Presidente (voz, 2026-10-07; Estatuto em `ESTATUTO_ASAF.txt`) estão resumidas em cada item.

- [x] **Títulos com filtros e paginação.** Título = cada **entrada** (a receber) ou **saída** (a pagar). A tela passa a filtrar por **mês**
      (filtro principal), intervalo de datas, **entradas ou saídas** (uma página para cada), situação, categoria e texto; lista paginada.
      **Na homologação (2026-10-07):** o robô (`v5.4h-01`, 5 de 5) lançou 31 saídas e 3 entradas em meses de 2088 e conferiu: o mês filtra; 31
      títulos são 2 páginas de 25 (a segunda com os 6 que sobram); Entradas e Saídas em páginas próprias; busca por texto; tipo, situação e
      categoria combinando; "Todo o período" tirando o mês; os filtros guardados no endereço; o Secretário barrado. A regressão na pilha final
      ficou verde (e-01 13, e-02 29, e-03 12, e-04 16, f-01 22, f-02 16, f-03 16). **Em produção (2026-10-08):** commit `66642bd` no
      `version.json`; Deploy API e Deploy Painel verdes; `GET /api/titulos/resumo` responde 401 sem login.
- [x] **Paginação nas outras listas que crescem** (Associados, Razão Contábil, Auditoria): o mesmo padrão dos Títulos. A Auditoria já era paginada no servidor;
      Associados e Razão passaram a ser (25 por página, total vindo do servidor, busca e filtros feitos no banco).
      **Na homologação (2026-10-09):** `v5.4h-12`, 4 de 4: Associados (a primeira página traz 25 e o total vem do servidor; a seguinte traz outros nomes; a busca
      acha pelo nome, fica no endereço e some ao apagar; situação e categoria filtram de verdade) e Razão Contábil (os 25 mais novos, o total e o saldo vêm do
      servidor; a busca acha pelo número e pelo histórico e diz quando não acha). Regressão das telas que usam as duas listas, todas verdes: `v5.4c-fase0` 6,
      `v5.4c-fase1` 24, `v5.4d-06` 16, `v5.4e-01` 16 (1 teste, o do fechamento do exercício, só roda no fim da bateria), `v5.4e-02` 29, `v5.4e-03` 12,
      `v5.4e-04` 16, `v5.4f-01` 22, `v5.4g-03` 8 e `v5.4h-04` 4. **Achados do robô, corrigidos e refeitos:** (1) buscar um número grande (o da rodada de testes,
      13 dígitos) também comparava com a matrícula e com o número do lançamento, que são inteiros de 32 bits no Postgres, e dava erro lá sem aparecer no SQLite dos
      testes (auxiliar `app/services/busca.py`; o teste compila a consulta como o Postgres a recebe e falha sem a correção); (2) três roteiros liam a tabela antes
      de ela refiltrar ou contavam as linhas da tela (agora ela mostra 25 por página): passaram a esperar o resultado e a ler o total que a tela informa.
      **Em produção (2026-10-09):** commit `aa89969` no `version.json` do painel; Deploy API e Deploy Painel verdes; `GET /api/associados/resumo`,
      `GET /api/associados/?pagina=1` e `GET /api/livro-caixa/?pagina=1` respondem 401 sem login e a rota nova consta no `openapi.json`.
- [x] **Módulo "Instituição" no painel:** cadastro de tudo da instituição (nome, CNPJ, endereço, contatos, redes, logo, chave Pix, textos
      institucionais), cada campo marcado **"vai para o site"** ou **"só interno"**; o site passa a ler de lá.
      **Na homologação (2026-10-07):** `v5.4h-02`, 5 de 5: os campos por grupo com a marca "aparece no site" ou "só interno"; salvar grava e
      continua gravado ao recarregar; a marca decide o que a rota pública entrega (some e volta na hora); CNPJ inválido, e-mail sem arroba, cor
      fora do formato e nome do Pix longo são recusados em português com o nome do campo (não a chave técnica) e não deixam rastro; o CNPJ
      válido grava e as alterações aparecem na Auditoria; o Secretário não vê o módulo nem entra pelo endereço. **Em produção (2026-10-08):**
      `GET /api/instituicao/` responde 401 sem login; `GET /api/publico/instituicao` responde 200 só com os campos marcados e preenchidos.
      **Atenção:** o CNPJ de produção ainda é o de exemplo (`00.000.000/0001-00`) e está marcado para o site: a diretoria precisa preencher o
      real na tela Instituição **antes** de o site passar a ler de lá.
- [x] **O site lê a Instituição:** os dados da Instituição marcados "vai para o site" (`/api/publico/instituicao`) passam a valer no site, **só o que está
      preenchido E válido**: CNPJ com dígitos que conferem, e-mail, telefone brasileiro, horário de atendimento e endereço de Instagram/Facebook de verdade (qualquer
      outro destino é descartado). O que está vazio ou inválido cai no texto fixo do Estatuto, então o CNPJ de exemplo da produção (`00.000.000/0001-00`) nunca
      vai ao ar e um campo apagado não deixa buraco. Nome, endereço da sede e apresentação ficam sempre os do Estatuto. Contato, rodapé, Privacidade, Termos,
      Transparência e os dados estruturados do Google usam os dados sobrepostos; o contato ganha horário e redes e o rodapé ganha as redes. A rota ausente (API
      antiga) não derruba o build, e a Instituição entra na impressão digital do conteúdo: a diretoria muda um dado e a sincronização (15 em 15 minutos)
      reconstrói o site sozinha. O site **não usa** Pix nem dados bancários (por padrão são internos).
      **Testes:** função pura (validadores e sobreposição), leitura tolerante e impressão digital (vitest), build com a Instituição preenchida (`npm run
      test:instituicao`, passo novo do CI do site), contato com a API antiga e o estado de hoje no navegador (CNPJ de exemplo ignorado); 356 testes de navegador
      e a suíte unitária do site verdes. Defeito achado no caminho: um `await` dentro do HTML do layout não compila (o `astro check` não pega; o build, sim).
      **Na homologação (2026-10-09):** `v5.4h-13` preenche a Instituição pela tela com valores fixos e válidos e a rota pública entrega exatamente isso; a
      homologação é publicada de novo (o site de teste lê a API no build) e `v5.4h-14` abre o `hml-site` como visitante: o contato mostra CNPJ, telefone, e-mail,
      horário e as duas redes (com `rel="noopener noreferrer"`) no lugar dos dados fixos; o rodapé mostra o e-mail e as redes; Privacidade, Termos e Transparência
      mostram o e-mail e o CNPJ novos e nenhum fixo; o CNPJ de exemplo não aparece em página nenhuma; o JSON-LD traz o CNPJ, o e-mail e as redes; e a página da
      **Diretoria** lista os 10 mandatos do sistema (7 da Diretoria Executiva e 3 do Conselho Fiscal) na seção do próprio órgão, sem CPF, e-mail ou telefone de
      dirigente. Regressão no `hml-site`: `v5.4g-01` 5 de 5 (axe, celular, links internos), `v5.4g-05` 6 de 6, `v5.4h-10` 5 de 5 (formulário de filiação do site).
      Achado do robô: o `v5.4h-02` alterna o CNPJ de propósito, então o roteiro do site passou a preparar os próprios dados (`v5.4h-13`) em vez de depender dele.
      **Em produção (2026-10-09):** commit `325f2e4` no `version.json` do site; Deploy Site verde (inclusive o passo novo, axe e Lighthouse); contato, Privacidade
      e Transparência seguem com o CNPJ, o telefone e o e-mail do Estatuto, nenhuma página mostra o CNPJ de exemplo, o contato não tem bloco de horário nem de
      redes (a Instituição de produção ainda não tem esses dados) e a sincronização disparada à mão respondeu "o site voltou a bater com o sistema" (nenhuma
      reconstrução em ciclo). **Quando a diretoria preencher a Instituição real** (CNPJ, telefone, e-mail, horário, redes, marcados "vai para o site"), o site
      passa a mostrar em até cerca de 30 minutos, sem ninguém mexer nele.
- [x] **Auditoria financeira (Conselho Fiscal):** o Conselho **não opera** o Financeiro, **audita**. Página própria: escolhe o **mês**, vê todas
      as entradas e saídas já consolidadas, abre cada título (comprovantes e informações) e **aprova, reprova ou manda ressalva**; a ressalva
      volta ao Tesoureiro, que corrige e submete de novo; dá para aprovar **tudo de uma vez, um por um ou por categoria**; **título aprovado pelo
      Conselho não pode mais ser alterado**. Tudo na Auditoria. (Estatuto Art. 24: fiscalizar toda a movimentação financeira e contábil.)
      **Regra decidida (Presidente, 2026-10-07/08):** o título é aprovado e travado quando a **maioria** do Conselho (2 de 3) aprova; quem
      discorda tem de dizer por quê (explicação obrigatória, sempre visível). **Na homologação (2026-10-07):** `v5.4h-03`, 8 de 8, com os três
      conselheiros de teste: o resumo do mês; aprovar um por um; ressalva e reprovação só seguem com a explicação (10 letras) e suspendem o
      título; a tesouraria responde no próprio cartão e isso libera; o 2º conselheiro completa a maioria e o título fica **Aprovado e travado**
      (só oferece "Reabrir auditoria"); aprovar em lote vale para um mês e pula suspensos, travados e os já aprovados por quem aprova; o 3º
      conselheiro reabre com explicação e as aprovações antigas deixam de valer (o histórico fica); o Secretário é barrado; a Auditoria do
      sistema guarda as 7 ações. Título aprovado também não é estornado nem renegociado enquanto estiver travado (testes do servidor).
      **Em produção (2026-10-08):** migração `b8e4c1a7d205` aplicada pelo pipeline; `GET /api/conselho-fiscal/auditoria-financeira/` e
      `POST .../aprovar-em-lote` respondem 401 sem login.
- [x] **Auditoria financeira: a discordância não trava a maioria.** Hoje uma ressalva ou reprovação com pergunta aberta ainda suspende o
      título mesmo com 2 aprovações. Decisão do Presidente (2026-10-08): com a maioria o título aprova; o motivo de quem discordou fica
      destacado no cartão e na Auditoria.
      **Na homologação (2026-10-08):** `v5.4h-03` refeito, 8 de 8: com a maioria (2 de 3) o título aprova e trava mesmo com ressalva aberta; o 3º
      conselheiro registra a reprovação de um título já aprovado e o motivo aparece em destaque no cartão ("Discordância de ...") e no resumo ("N
      com discordância"), sem derrubar a aprovação; quem ainda não votou continua podendo votar num título aprovado, quem já votou só reabre; a
      Auditoria do sistema guarda as 8 ações. **Em produção (2026-10-08):** commit `40df78e` no `version.json`, Deploy API e Painel verdes,
      `GET /api/conselho-fiscal/auditoria-financeira/` responde 401 sem login.
- [x] **Saídas, reembolso e dupla assinatura:** a saída é lançada com a **nota fiscal anexa** e uma **categoria** (o **reembolso é uma categoria
      de saída**, com as mesmas regras; entradas também têm categorias). **Dupla assinatura Presidente + 1º Tesoureiro** (Estatuto Art. 21, II).
      **Sem exigência de cotação/orçamento no dia a dia** (a regra de 2 cotações sai); orçamento só em **emenda parlamentar**, como documento
      anexado na parceria. **Prazos e alertas:** data da despesa e data do lançamento sempre registradas; alerta de lançamento tardio e de
      assinatura parada (lembrete ao outro assinante; delegação já existe), para a associação não perder prazo nem ter multa.
      **Decisão do Presidente (2026-10-08, vale mais que o texto acima):** o sistema é só o **registro** das entradas e saídas que **já
      aconteceram no mundo real**. A dupla assinatura é do banco (quem faz o Pix já tem a aprovação da outra parte): **não há fila de
      "aguardando assinatura" nem a mesma burocracia dentro do sistema**. A saída entra como fato consumado, com nota fiscal anexa, categoria
      (reembolso incluso), data da despesa, data do pagamento, forma de pagamento e quem lançou; o controle é a **Auditoria financeira do
      Conselho Fiscal**, depois do fato. A compra com alçada, cotação e delegação (v3.3) continua existindo, mas **não é o caminho do dia a dia**.
      O que falta construir: o formulário único "Registrar saída" (lança e baixa de uma vez) e o alerta de lançamento tardio.
      **Na homologação (2026-10-08):** `v5.4h-08`, 5 de 5: o caminho do dia a dia (Financeiro, Saídas, "Registrar saída (já paga)"); o
      formulário vazio lista o que falta; data no futuro é recusada pelo servidor e não deixa saída nem rastro; a saída entra **já Paga**, com
      categoria, nota fiscal e comprovante, e aparece em Saídas com o link da nota (o arquivo abre e é o enviado); saída lançada 20 dias depois
      do pagamento avisa "lançamento tardio"; o reembolso é a mesma saída com um associado como quem recebeu; o Conselheiro Fiscal abre a nota e o
      comprovante no cartão da Auditoria financeira e vê o aviso de lançamento tardio; a Auditoria do sistema guarda as 3 saídas; o Secretário é
      barrado na tela e na API. Se a baixa é recusada (conta errada, exercício fechado) o título criado para ela é desfeito. Regressão verde:
      Títulos 5/5, Auditoria financeira 8/8, receita (e-02) 29/29, despesa (e-03) 12/12. **Em produção (2026-10-08):** commit `1bfc17f` no
      `version.json`, Deploy API e Painel verdes (migração `c4f9a1e6b270`, coluna `nota_fiscal` do título), `POST /api/saidas/registrar` responde
      401 sem login e consta no `openapi.json`. A dupla assinatura **não virou etapa do sistema** (decisão do Presidente de 08/10: o sistema é só
      o registro); a compra com alçada e cotação (v3.3) segue existindo fora do dia a dia.
- [x] **Lançamento tardio entre os alertas do Conselho Fiscal, com o limite ajustável:** a saída registrada que foi lançada mais de N dias depois do
      **pagamento** (a conta é da data do pagamento, não da despesa) entra no relatório de exceção mensal (Relatórios, "Padrões suspeitos") como
      `LANCAMENTO_TARDIO`, além de continuar marcada no cartão da Auditoria financeira e na Auditoria do sistema. O limite é a configuração
      `DIAS_ALERTA_LANCAMENTO_TARDIO` (padrão 5) e vale igual nos três lugares; nasceu a tela **Regras do sistema** (`/regras`, só quem administra o acesso),
      que lista as configurações da categoria "regras" (limites e prazos), salva cada uma e deixa a mudança na Auditoria com o valor antes e depois.
      **Na homologação (2026-10-08):** `v5.4h-11`, 3 de 3 (a tela lista as regras sem dado institucional; o limite muda para 7, continua 7 ao recarregar e
      vale no servidor; valor que não é número é recusado com 422 em português e nada muda; as mudanças ficam na Auditoria; o Secretário é barrado na
      tela e na API); `v5.4h-08`, 6 de 6 (o relatório de exceção do mês lista a saída lançada 20 dias depois do pagamento, com o texto certo, e não lista
      a em dia nem o reembolso); regressão verde: Auditoria financeira (h-03 8/8) e relatórios e antifraude (e-04 16/16). No servidor, 1005 testes verdes
      (6 novos do lançamento tardio, entre eles "a data que conta é a do pagamento" e "o limite configurado vale igual no registro, no cartão e no
      relatório"); no painel, 3 testes da tela de regras. **Em produção (2026-10-08):** commit `0678f0e`, Deploy API verde e Deploy Painel verde (o teste
      de ponta a ponta do "ver como" falhou duas vezes seguidas no CI sem relação com a mudança e passou ao rodar de novo, e passa local: fica de olho
      como instável, sem esconder); `version.json` bate; o pacote do painel traz "Regras do sistema"; `/api/configuracoes/` e
      `/api/antifraude/padroes-suspeitos` respondem 401 sem login. A produção não recebeu dado de teste.
- [x] **Filiação: os 3 sócios, o aviso no painel e a análise da Diretoria (Estatuto Art. 12):** o pedido precisa ser **proposto por 3 sócios**
      (qualquer sócio ativo e apto pode propor) e passar pela **análise da Diretoria Executiva**; os sócios ativos **recebem a notificação
      no painel** (sino) para propor ou recusar, com o motivo; sem prazo — sem resposta, o pedido fica pendente; aprovado, entra no livro de
      associados com a matrícula. **Como funciona:** `GET /api/filiacao/para-propor` mostra ao sócio só nome e idade (CPF, e-mail e telefone são
      da Diretoria); `POST /api/filiacao/propostas/{id}/propor` registra "Propõe" ou "Recusa" (recusar pede ao menos 5 letras de motivo); a
      Diretoria vê quem propôs e quem recusou e **não consegue aprovar com menos de 3** (400 com a conta de quantos faltam); apto é "Ativo - Em
      Dia" ou "Em Experiência"; o sino é `/api/minhas-notificacoes/` (lista, marcar uma ou todas como lidas). **Na homologação (2026-10-08):**
      `v5.4h-09`, 5 de 5 (o pedido chega pela rota pública e o sócio é avisado no sino, abre o aviso e propõe; um segundo propõe e um terceiro
      recusa com o motivo, e o motivo curto demais é barrado na tela; a Diretoria vê os dois lados e não aprova com 2 de 3; o terceiro propõe e
      a aprovação entra com a matrícula; o pedido decidido sai da lista dos sócios e a Auditoria guarda as 4 decisões); regressão verde:
      filiação e cadastros (`v5.4c-fase1`, 24 de 24, com o roteiro antigo adaptado: sem os 3 sócios a aprovação fica travada), relatórios e
      antifraude (e-04 16/16), projetos e voluntariado (f-01 22/22) e base contábil e orçamento (e-01 16/16); o povoamento em volume da homologação passou a fazer 3
      sócios proporem antes de aprovar (teste próprio). **Em produção (2026-10-08):** commit `4f195b7`, Deploy API e Painel verdes;
      `version.json` bate; `GET /api/filiacao/para-propor` e `GET /api/minhas-notificacoes/` respondem 401 sem login e as rotas novas estão no
      `openapi.json`; a produção não recebeu nenhum dado de teste.
- [x] **Filiação: formulário público no site:** o pedido sai de `/seja-associado/` (hoje o site só lê) e cai na caixa da Diretoria. **Como funciona:**
      a página pede nome, CPF, data de nascimento e e-mail ou telefone, valida na hora (CPF, idade, contato) e mostra o aviso de privacidade (versão 1) com a
      caixa de aceite; de 16 a 17 anos aparece a declaração de que os pais ou responsáveis autorizaram (o papel é conferido pela Diretoria: o cartão do pedido
      mostra a idade, o aceite e essa declaração); abaixo de 16 não se filia (Estatuto, Art. 12). O servidor repete todas as regras em `POST
      /api/filiacao/propor`: data de nascimento e aceite do aviso (com a versão que a pessoa viu) obrigatórios, ao menos um contato, limite de 10 pedidos por IP
      por hora, campo escondido que descarta robôs em silêncio, a mesma frase para "já é associado" e "já tem pedido" (ninguém de fora descobre se um CPF é
      de sócio) e o envio na Auditoria (`PROPOSTA_PUBLICA`, com o IP). Migração `e7c3d9a4b158` (aceite, versão e declaração no pedido). A Política de
      Privacidade passou à versão 1.2 e descreve o formulário. **Na homologação (2026-10-08):** `v5.4h-10`, 5 de 5, preenchendo o formulário do site de teste
      (formulário em branco recusado com o resumo e o foco no primeiro campo; CPF que não confere, menor de 16 anos e sem contato recusados na página; pedido
      certo atravessa a API de outra origem e a página confirma; o mesmo CPF de novo é recusado com a frase única; de 16 a 17 anos a página pede a declaração
      dos pais e só então aceita; a Diretoria vê idade, aceite do aviso e a declaração; o sócio vê o candidato só com nome e idade, sem CPF, e-mail nem
      telefone; a Auditoria guarda os envios; o robô que preenche o campo escondido recebe sucesso e não deixa pedido); regressão verde: `v5.4h-09` 5/5 e
      `v5.4c-fase1` 24/24. No servidor, 1000 testes verdes; no site, 26 testes novos, 10 de ponta a ponta do formulário e a suíte de acessibilidade inteira (inclui
      o formulário com erros e com a declaração dos pais, no computador e no celular). **Em produção (2026-10-08):** commit `078344c`; Deploy API, Painel e Site
      verdes (o do site com acessibilidade e Lighthouse); `version.json` bate; `asaf.org.br/seja-associado/` traz o formulário apontando para `api.asaf.org.br`; a
      Política de Privacidade mostra a versão 1.2; o preflight de CORS de `https://asaf.org.br` para `POST /api/filiacao/propor` responde 200 liberando o POST; o
      `openapi.json` mostra o corpo novo (nascimento obrigatório); `GET /api/filiacao/propostas` segue 401. Nenhum pedido de teste foi enviado à produção.
- [x] **Telas que faltam:** inscrição no evento pelo painel (secretaria inscrevendo alguém); **núcleo familiar** do beneficiário;
      **alocar voluntário** direto num turno.
      **Na homologação (2026-10-07):** `v5.4h-06` inscrição pela secretaria, 4 de 4 (com 1 vaga: o primeiro fica Pré-inscrito, o segundo vai
      para a Lista de Espera; a mesma pessoa de novo é recusada sem rastro; 2 inscrições na Auditoria; Secretário barrado na tela e na API; a
      rota nova passa pelo controle de vagas, ao contrário da genérica `/api/inscricoes/`); `v5.4h-04` alocar voluntário direto num turno, 4
      de 4 (formulário vazio diz o que falta; sem termo vigente é recusado em português; com termo entra na escala, continua ao recarregar e
      fica na Auditoria; Secretário barrado); `v5.4h-05` núcleo familiar do beneficiário, 3 de 3 (a mãe vê o filho, o filho vê a mãe, sem
      vínculo diz onde cadastrar). **Em produção (2026-10-08):** `POST /api/eventos/{id}/inscrever-associado`,
      `GET /api/projetos/{id}/alocacoes` e `GET /api/beneficiarios/{id}/nucleo-familiar` respondem 401 sem login.
- [x] **Rastro de recusas:** recusa de aprovação/assinatura também fica na Auditoria.
      **Como funciona:** um tratador de erro do servidor (`app/recusas.py`, ligado em `app/main.py`) grava na Auditoria (tabela `recusas`, ação
      `RECUSA_APROVACAO`) quem tentou, a rota, o resultado (400, 403 ou 409) e o motivo, nas 25 rotas de aprovação, reprovação, assinatura,
      homologação e confirmação; 404, 401 e o que não é aprovação não gravam; se o registro falhar, a recusa sai igual para quem tentou. **Na
      homologação (2026-10-08):** o roteiro das compras (e-03, 12 de 12) confere que o Tesoureiro tentando aprovar a própria compra aparece em
      `recusas` com o nome dele, enquanto as tabelas das compras seguem só com o que deu certo; regressão verde nas telas que recusam aprovação:
      despesa (e-03), relatórios e antifraude (e-04 16/16), projetos e voluntariado (f-01 22/22), atas (d-05 16/16), disciplina (d-08 7/7) e
      registrar saída (h-08 5/5). **Em produção (2026-10-08):** commit `27e963c`, Deploy API verde; não há rota nova (é comportamento): a rota de
      aprovação sem login segue 401 (que, por desenho, não grava recusa: não há quem tenha tentado). O efeito só se vê com login e foi provado
      na homologação; a produção nunca recebe dado de teste.
- [x] **Carga, limite por IP e réplicas em dia de evento (decisão: manter páginas estáticas e deixar "vivo" o que é dinâmico):** a API aguenta a multidão de
      um dia de evento e não estoura as vagas. **Teste de carga** (`scripts/teste_de_carga_hml.py`, fluxo manual `Testar Carga da Homologação`, recusa qualquer
      endereço que não seja o da homologação): 150 pessoas por minuto, cada uma abrindo a lista e a página do evento, levando 20 s no formulário (50 a 100
      ao mesmo tempo) e se inscrevendo de um IP próprio, num evento de 100 vagas; mais um grupo atrás do mesmo IP e 5% de cliques duplos. Reprova se houver erro
      5xx, vaga estourada, vaga vazia com gente na espera, inscrição duplicada, limite por IP falho ou p95 acima de 5 s. **O teste achou um defeito real na
      primeira rodada:** a mesma pessoa enviando duas vezes quase junto dava erro 500 (as duas passavam pela checagem do CPF antes de gravar e a segunda batia na
      restrição única do banco) e prendia uma vaga; corrigido (quem perde a corrida é recusada com "já está inscrita" e a vaga volta), com testes que forçam a
      corrida. **Na homologação (2026-10-08), depois da correção:** 150 por minuto, 100 vagas: 100 confirmadas, 80 na lista de espera, p95 da inscrição 0,52 s,
      nenhum erro, os 7 cliques duplos viraram 1 inscrição cada, o grupo do mesmo IP teve 30 aceitas e 10 barradas; **400 por minuto** (2,7 vezes a meta), 250
      vagas: 250 confirmadas, 180 na espera, p95 0,39 s, nenhum erro. A primeira chamada do dia (API dormindo) levou de 0,65 a 1,25 s nesses testes porque a API
      estava acordada; o pior caso (acordar do zero) segue sendo 10 a 30 s e é o que as réplicas abaixo evitam. **Limite por IP** da inscrição pública: de 5 para
      **30 a cada 10 minutos** (5 barrava a secretaria de uma igreja já na sexta pessoa). **Réplicas:** o fluxo `Réplicas da API em dia de evento` (a cada 3 horas)
      lê a lista pública de eventos e deixa **1 réplica mínima** da API de 24 h antes do evento até 12 h depois, e volta a 0 depois (só mexe nesse número; se não
      conseguir ler os eventos, mantém como está). Provado na homologação à mão: 0 → 1 → 0 em `asaf-api-hml`; na produção rodou em simulação e deu 0 (nenhum evento
      público agora). **Em produção (2026-10-08):** commit `667ad62`, Deploy API verde; a lista pública de eventos e o texto de consentimento respondem 200 e o
      preflight de CORS de `https://asaf.org.br` libera o POST da inscrição. Nenhuma inscrição de teste foi enviada à produção. **Falta (é da v5.5, não daqui):** o
      formulário de inscrição em evento no site e a página de cancelar a inscrição que o e-mail promete (`/cancelar-inscricao`, que hoje não existe).
      **Achado de segurança do mesmo teste (2026-10-08):** o limite por IP e o IP gravado na Auditoria usavam o PRIMEIRO item de `X-Forwarded-For`, que é do cliente:
      400 "pessoas" de uma máquina só, cada uma com um primeiro item inventado, nunca eram barradas (qualquer um burlava o limite). Agora vale o ÚLTIMO item, o que o
      ingress anotou (`app/services/protecao_publica.py::ip_publico`, usado na inscrição em evento, na pesquisa de satisfação, na portaria e na filiação). **Provado na
      homologação:** com a correção, 60 "pessoas" da mesma máquina foram limitadas a 30 (28 inscrições aceitas, 2 repetidas, 33 barradas) e o grupo do mesmo IP teve 0
      aceitas; só a API de TESTE liga `CONFIAR_NO_PRIMEIRO_IP=1` (para o teste de carga simular muita gente de uma máquina), com teste garantindo que a produção nunca
      define; com a variável, a carga normal voltou a passar (150 por minuto: 100 confirmadas, 80 na espera, p95 0,28 s). **Em produção:** commit `5b26086`, Deploy API e
      Site verdes.

##### 🔍 Ponto de Revisão — FASE 5 (1/2 — meio, fecha v5.0–v5.4)

✅ **FECHADO em 2026-10-20, por decisão do Presidente.** Tudo foi conferido na homologação (v5.4c–v5.4g); a conferência da diretoria contra a vedação do STF fica como condição para lançar os mandatos reais, feita por quem cadastra.

Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:

- **Conferência ao vivo na homologação (v5.4c–v5.4g) concluída** (decisão do presidente, 2026-10-05): cada item das cinco versões feito
  **na tela**, com print, Auditoria e recusa provocada; **nenhum defeito aberto** e nenhum item "falta conferir". Este ponto só abre
  com isso fechado — a revisão que já aconteceu sem ninguém ter visto a tela é exatamente o que esta exigência corrige.
- Directus não tem, em nenhuma coleção, dado de associado/financeiro **do sistema** — só conteúdo
  editorial e de transparência. **(Achado de 2026-10-01: era FALSO — o Directus enxergava todas as
  tabelas do sistema. Corrigido em 2026-10-02 pelo isolamento da v5.1 e provado em produção, 16/16.
  Reverificar na revisão com `DATABASE_URL=… python scripts/isolar_directus.py verificar` e conferir que
  nenhuma coleção nova nasceu fora do schema `directus`.)**
- Auditoria de SEO/acessibilidade (v5.0) está rodando de fato no CI (feito: axe em todas as páginas,
  Lighthouse, e2e).
- **Rascunho não vaza**, papel de editor **não** consegue publicar nem ver o que não é dele, token de
  serviço **não** escreve (testes).
- **Nenhum PDF só-imagem** publicado; **nenhum dado de exemplo** na produção; consistência de valores
  (parcelas, pagamentos) verificada.
- **Dado pessoal**: o **original** de um documento (ata, termo) **nunca** sai pela API pública nem pela rota
  `/uploads`; só a **versão pública aprovada** está no site; teste com um PDF de ata com CPF/RG de mentira: o
  verificador recusa, e uma tarja só desenhada por cima também (o texto continua lá). Documento *Interno*/*Restrito*
  não aparece em lugar nenhum público. Quem enviou não aprova o próprio documento.
- **Uma fonte só**: nada de documento oficial, emenda ou valor existe só no Directus (o `verificar` do Directus
  reprova coleção de negócio); o que o site mostra de dinheiro **bate** com o livro-caixa do centro de custo.
- O **Estatuto do site é a versão registrada em cartório** (o usuário confirma); cargos alinhados ao Art. 19.
- **Revisão jurídica** dos textos de Transparência, Privacidade e Termos (a base legal já foi pesquisada, ver
  acima; falta a leitura de quem é do ramo) e conferência da composição da diretoria contra a vedação do STF de
  15/01/2026 (parentes de parlamentar).
- Dado de dirigente real só depois de **cargos alinhados**; sem CPF/endereço/telefone pessoal.
- Verificação independente de fatos de todas as páginas (agente) feita e corrigida.

#### v5.5 — Formulários públicos, fila única e módulo de eventos (era a v5.3)

Dividida em quatro partes (decisão do Presidente, 2026-10-09: "parte a parte"); cada uma pelo caminho de sempre: branch → homologação → robô → só então a `main`.

- [x] **Pré-requisito resolvido (2026-10-09): encarregado pelo tratamento de dados (LGPD, art. 41) = o Presidente** (decisão dele: "somos uma associação que não tem 20 pessoas; coloca eu"),
      e a associação não contrata advogado: ele deu a Política de Privacidade por válida (aceite dele, não revisão jurídica). O texto continua sem prometer base legal por
      formulário (isso é da FASE 7). Regra geral dele para qualquer "responsável" que o plano pedir: o Presidente, ou quem tiver cargo na Diretoria Executiva ou no Conselho Fiscal;
      não existe segunda pessoa.
- [x] **v5.5a — Fila única de atendimento + formulários de contato, de pedido de informação sobre recursos públicos (R7) e de solicitação do titular de dados (LGPD).**
      **O que existe:** a tabela `atendimentos` (protocolo `ASAF-AAAA-NNNNN`, situação Novo / Em atendimento / Respondido / Encerrado, responsável, prazo), as rotas públicas
      `POST /api/publico/atendimentos` e `GET /api/publico/atendimentos/prazos`, a fila no painel (módulo **Atendimento**, permissão `atendimento`, dada ao Presidente e à Diretoria;
      cartões de resumo, filtros e busca no endereço, páginas de 25, abrir o pedido inteiro com os outros pedidos da mesma pessoa, assumir, responder e encerrar) e, no site, os três
      formulários (`/contato/`, `/transparencia/pedido-de-informacao/` e `/privacidade/solicitacao-do-titular/`), com protocolo e prazo na tela. **Prazos** (Regras do sistema, a
      diretoria muda): contato 10 dias, pedido de informação 20 (referência da Lei de Acesso à Informação, não uma obrigação confirmada para a ASAF), titular LGPD 15 (LGPD, art. 19, II).
      **Garantias:** o mesmo pedido mandado duas vezes é um protocolo só; armadilha de robô; limite por IP; aviso de privacidade com versão (1) que o servidor confere; o remetente é ligado ao
      cadastro pelo CPF (ou pelo e-mail, se for uma pessoa só) sem aparecer para quem está de fora; o CPF só vem inteiro dentro do pedido; quem atende é avisado no sino; uma rotina
      (a cada 15 minutos, no mesmo agendamento da lista de espera) avisa no sino os pedidos vencidos ou que vencem em 3 dias, no máximo uma vez por dia por pedido; cada ação fica na
      Auditoria; a resposta segue por e-mail em melhor esforço e a tela diz se não saiu. **Política de Privacidade 1.4:** nomeia o Presidente como encarregado (o nome vem do mandato
      vigente que o sistema publica; enquanto não houver, a página manda olhar a Diretoria) e descreve os formulários de atendimento.
      **Testes:** servidor 1084 de 1084 (35 do atendimento e 3 da migração, contra o modelo), painel 464, site 331 unitários e 420 de navegador; três testes de contagem exata de
      configurações passaram de 59 para 63. **Na homologação (2026-10-09):** `v5.5a-02` 7 de 7 (três pedidos chegam pela rota pública; o Presidente é avisado no sino, abre a fila e
      vê cada um com protocolo e prazo do tipo; filtros por tipo, situação e protocolo; assumir; resposta curta recusada em português e a boa registrada; o pedido com e-mail mostra o
      resultado do envio; encerrar com motivo curto recusado; o CPF do titular mascarado na lista e inteiro dentro do pedido, com os outros pedidos da mesma pessoa; a Auditoria
      cresceu exatamente 9; o Secretário não vê o módulo, é barrado na tela e a API devolve 403) e `v5.5a-01` 6 de 6 (o visitante, no `hml-site`: formulário em branco diz o que falta, sem
      aceitar o aviso não envia, protocolo e prazo do tipo na tela, CPF inválido recusado, duplo envio = um protocolo, armadilha e aviso velho recusados, os pedidos aparecem na fila
      do Presidente, e a Política 1.4 nomeia o encarregado). Regressão: `v5.4c-fase0` 6, `v5.4c-fase1` 24, `v5.4g-01` 5 (axe, celular e links nas páginas novas), `v5.4h-10` 5,
      `v5.4h-12` 4, `v5.4h-14` 2. **Achados do robô e do CI, corrigidos:** (1) escolher um filtro logo depois de digitar na busca (dentro dos 400 ms da pausa) perdia o filtro, porque
      o temporizador chamava a versão antiga de `mudar`; a tela de Associados, já em produção, tinha o mesmo padrão; corrigidas as duas, com um teste em cada (falham sem a correção);
      (2) o teste de navegador do painel de "ver como" falhava no CI e travou o deploy do painel: no CI o painel é montado apontando para a API de PRODUÇÃO, e o que o teste não simulava
      (o sino de avisos) ia para lá com um token de mentira, a produção respondia 401 e o painel deslogava; era também a causa das falhas intermitentes de antes; reproduzido localmente
      (3 de 3 falhas) e corrigido: nenhum teste do painel fala mais com a API de produção (10 de 10 sob as mesmas condições, três vezes); (3) a contagem exata de configurações.
      **Em produção (2026-10-09):** commits `32c937f` (API e site) e `d09c0b2` (painel: o deploy do painel de `32c937f` ficou parado pelo teste acima e foi refeito depois da correção); `GET
      /api/publico/atendimentos/prazos` responde 10, 20 e 15; `GET /api/atendimentos/`, `/resumo` e `/{id}` respondem 401 sem login; `POST /api/publico/atendimentos` sem corpo dá 422 (a rota
      existe e nada foi gravado: **produção não recebeu nenhum pedido de teste**); as oito rotas constam no `openapi.json`; `/contato/` tem o formulário e as duas páginas novas respondem 200; a
      Política mostra a versão 1.4 e, sem mandato de Presidente registrado, "o Presidente da ASAF (o nome consta na página Diretoria)"; a rotina de prazos rodou à mão em produção:
      "avisos criados: 0". **Fica para a v5.5b:** o e-mail de confirmação ao remetente na hora do envio (hoje a confirmação é a tela, com o protocolo e o prazo; o e-mail só sai na resposta).
- [x] **v5.5b — Voluntário pelo site e voluntário que não é associado** (decisão do usuário, 2026-10-03: "se ele se voluntaria, ele precisa conseguir").
      **O que existe:** o **voluntário é uma pessoa**: `alocacoes_voluntarios` ganhou `id_pessoa` (preenchido, na migração, a partir do associado de cada alocação que já existia;
      `id_associado` fica só quando a pessoa também é associada); a equipe aloca por `id_pessoa` (ou, como antes, por `id_associado`); o termo de adesão vigente continua sendo a trava
      real, para associado e para não associado; a lista de quem pode ser escalado (`GET /api/projetos/voluntarios-selecao`) traz os associados e as pessoas não associadas com termo; a
      escala e as candidaturas mostram o **nome** do voluntário (e "não associado"). **Pedido de voluntariado pelo site** (`/seja-voluntario/`, que deixou de dizer que a escala usa o
      cadastro de associados): cai na fila (tipo Voluntariado, prazo 10 dias, `PRAZO_DIAS_ATENDIMENTO_VOLUNTARIO`) com **data de nascimento obrigatória** (o termo de menor de 18 anos exige
      a autorização de um responsável) e CPF opcional; no painel, o cartão do pedido mostra a idade e o aviso de menor, **cadastra a pessoa como voluntária** (liga à que já tem o mesmo CPF
      e copia a data de nascimento se ela não tinha), registra o **termo de adesão** (o do menor exige a referência da autorização) e leva à escala. **E-mail de confirmação do
      recebimento** (herdado da v5.5a): quem informa e-mail recebe protocolo e prazo, só no pedido novo, em melhor esforço. **Política de Privacidade 1.5**: descreve o formulário de
      voluntariado e o e-mail de confirmação. **Testes:** servidor 1102 de 1102 (duas rodadas; 6 da escala por pessoa, 4 da migração com o estado anterior, o preenchimento, a recusa de
      alocação sem associado e o downgrade), painel 489, site 352 unitários e 443 de navegador. **Na homologação (2026-10-09):** `v5.5b-01` 4 de 4 (o visitante envia pelo site, a página
      recusa data de nascimento que falta ou no futuro e dá protocolo e prazo de 10 dias; o Presidente vê a idade, cadastra a voluntária que não é associada e registra o termo; o pedido
      do menor avisa e o termo só entra com a autorização do responsável; ela é escalada no projeto e aparece na escala como "não associado" e CONFIRMADA, e continua lá ao recarregar; a
      Auditoria guardou 4 ações de atendimento, 2 termos e 1 alocação). Regressão: `v5.4h-04` 4 (alocação direta), `v5.4f-01` 22 (projetos, equipe, candidatura, troca de turno, horas),
      `v5.5a-02` 7, `v5.5a-01` 6, `v5.4c-fase0` 6, `v5.4g-01` 5. **Achados do robô, corrigidos:** (1) o roteiro de projetos procurava a candidatura pelo texto "Associado #id", que foi trocado de
      propósito pelo nome (agora procura pelo nome); (2) quem já estava no cadastro com o mesmo CPF e sem data de nascimento seria tratada como menor de idade no termo (o servidor
      copia a data do pedido só quando a pessoa entra no cadastro DEPOIS do pedido, com teste; se o pedido já chegou ligado pelo CPF, ver o Ponto de Revisão da FASE 5 (2/2)); (3) duas falhas pontuais de acessibilidade (axe) em páginas que não mudaram, numa rodada local com a máquina ocupada, não reproduziram
      em quatro repetições. **Em produção (2026-10-09):** commit `465d6e3` no `version.json` do painel e do site; Deploy API (com a migração `a8d4f1c7e592`), Painel e Site verdes;
      `GET /api/publico/atendimentos/prazos` traz os quatro tipos; `GET /api/projetos/voluntarios-selecao` e `POST /api/atendimentos/{id}/cadastrar-voluntario` respondem 401 sem login e
      constam no `openapi.json`; `POST /api/publico/atendimentos` com corpo incompleto dá 422 (nada gravado: **produção não recebeu pedido de teste**); `/seja-voluntario/` tem o formulário e
      já não diz que a escala usa o cadastro de associados; a Política mostra a versão 1.5. **Limite conhecido:** a autocandidatura a vaga e "minha escala" no painel continuam por
      associado (quem tem login é associado); o voluntário não associado é escalado pela equipe.
- [x] **v5.5c — Inscrição em evento pelo site** (a API já tinha formulário, perguntas, consentimento, lista de espera e cancelamento por código; faltava o site).
      **O que existe:** na página do evento **gratuito**, ainda não encerrado e sem pergunta de arquivo, o **formulário de inscrição** (as perguntas do evento, o texto do consentimento
      sempre lido da API, CPF validado, até 10 pessoas na mesma inscrição); ao enviar, a própria tela mostra o **código de check-in**, a situação de cada pessoa (vaga reservada ou lista de
      espera) e o **link para cancelar**; os e-mails de inscrição e de promoção da fila trazem os links certos (`/cancelar-inscricao/?token=` e `/confirmar-inscricao/?token=`, antes o e-mail
      apontava para um endereço que não existia); as duas páginas novas ficam fora do Google (`noindex`, fora do sitemap), pedem confirmação em dois passos para cancelar e dão mensagem
      clara para link inválido; `GET /api/publico/inscricoes/{token}` devolve o resumo sem dado pessoal (limite 30 a cada 10 min por IP); evento que já aconteceu recusa inscrição (400);
      evento com valor ou com pergunta de arquivo continua "com a secretaria". **Falha antiga fechada:** quem estava na lista de espera conseguia se confirmar sozinha pelo link e furar a
      fila; agora a API recusa (400) e a página diz que ainda está na fila. **Política de Privacidade 1.6:** descreve a inscrição em evento pelo site. O endereço do site nos e-mails vem de
      `URL_BASE_SITE_PUBLICO` (configuração, depois variável de ambiente, depois `https://asaf.org.br`; a homologação define a dela no `deploy-homologacao.yml`). **Testes:** servidor 1111 de
      1111 (duas rodadas completas; 9 novos em `tests/test_inscricao_no_site.py`), site 457 unitários e 521 de navegador, 46 páginas no `build:teste`. **Na homologação (2026-10-13):**
      `v5.5c-01` 1 de 1 (cria pelo sistema de teste um evento público gratuito de 2 vagas com duas perguntas e um evento com valor) e, depois de publicar a homologação de novo, `v5.5c-02`
      7 de 7 (o formulário aparece com as perguntas e o consentimento idêntico ao da API e recusa o que falta e CPF que não confere; o evento com valor não tem formulário; uma pessoa se
      inscreve e vê vaga reservada, código e link; duas pessoas juntas: uma fica com a vaga e a outra na lista de espera, e o evento passa a dizer que as vagas acabaram; a da fila não se
      confirma sozinha; quem cancela pelo link libera a vaga, a fila anda e a promovida confirma e vê o código; link inventado dá mensagem clara e as duas páginas ficam fora do Google; a
      Auditoria guardou exatamente 3 inscrições, 1 cancelamento e 1 confirmação pelo link). Regressão: `v5.4f-02` 16, `v5.4f-03` 16, `v5.5a-02` 7, `v5.5a-01` 6, `v5.4g-01` 5,
      `v5.4c-fase0` 6, `v5.4h-10` 5. **Achados, corrigidos:** (1) a falha da fila acima, achada ao escrever o servidor (com teste que reprova sem a correção); (2) o auxiliar de print do robô
      contava como "Carregando" um aviso já escondido (`hidden`) do consentimento e reprovava o primeiro teste: era do roteiro, não do site (agora só conta o que está visível);
      (3) o roteiro da v5.5a-01 passou a aceitar qualquer versão da Política. **Em produção (2026-10-13):** commit `f47c6d9` no `version.json` do site (o painel segue em `465d6e3`: a
      mudança não tocou o painel, só os roteiros do robô); Deploy API e Deploy Site verdes (sem migração); `GET /api/publico/inscricoes/codigo-inexistente` dá 404 com a mensagem
      "Link inválido"; a rota nova (`GET /api/publico/inscricoes/{token}`; cancelar e confirmar já existiam) consta no `openapi.json`; `/cancelar-inscricao/` e `/confirmar-inscricao/` respondem 200, com `noindex, nofollow` e fora do `sitemap`; a Política
      mostra a versão 1.6 com o parágrafo da inscrição em evento; `GET /api/publico/eventos` está vazio e `/eventos/999999/` dá 404 (**produção não recebeu inscrição de teste**).
      **Limite conhecido:** o link de cancelar vale para quem o tem (vem na tela e no e-mail da inscrição).
- [x] **v5.5d — Status do evento** — Programado / Adiado / Cancelado / Realizado, com motivo — no sistema, no painel e no site (`schema.org eventStatus`), no lugar do paliativo "voltar a Interna".
      "Módulo de eventos" do usuário: este foi o ponto de entrada dele. **O que existe:** o evento tem **situação** (`Programado` de partida; `Adiado`, `Cancelado`, `Realizado`), `motivo_status`,
      `status_alterado_em` e `data_hora_inicio_anterior` (migração `b3e8c5a1d7f4`; todo evento que já existia fica `Programado`). `POST /api/eventos/{id}/status` (permissão `projetos`, Auditoria
      `STATUS_ALTERADO`): **cancelar e adiar exigem motivo** (mínimo 5 letras; em evento Público o motivo vai ao site e passa pela mesma conferência de dado pessoal do resto do texto público);
      **realizado** só depois de o evento começar e não volta atrás; **adiado ou cancelado volta** à MESMA data (retomada, enquanto a data original ainda é futura) ou com **data nova** (remarcar: guarda
      a data de antes, a programação em sessões acompanha, a duração é mantida, e quem foi promovido da fila e ainda não confirmou ganha prazo novo). **Quem estava inscrito recebe e-mail** (um por
      endereço, em melhor esforço; a inscrição NÃO é cancelada pelo sistema; o painel mostra quantos avisos saíram e quantos inscritos estão sem e-mail). **O evento parado** (cancelado, adiado ou
      realizado) não recebe inscrição por nenhuma porta (site, associado, secretaria), a vaga que abre não chama ninguém da fila, o prazo de confirmação não vence, a portaria não faz check-in e a
      pesquisa de satisfação não gera convite. **Decisão do Presidente (2026-10-15, "é o ressarcimento", Código de Defesa do Consumidor):** quem desiste pelo link de um evento CANCELADO pela ASAF recebe
      o valor INTEIRO de volta (sem a taxa de quem desiste); o painel avisa quantas inscrições pagas o evento tem (`inscricoes_com_cobranca`). **Painel:** selo da situação (sempre com texto) no detalhe e na
      lista, motivo, "Remarcado: a data anterior era…", botões conforme a situação (Adiar, Cancelar evento em dois passos, Remarcar, Voltar para a data original, Reativar, Marcar como realizado), e o
      resultado do aviso por e-mail. **Site:** aviso no topo da página do evento (cancelado, adiado, remarcado, realizado) com o motivo escrito como texto, formulário de inscrição que some e volta ao vivo
      sem reconstruir o site, selos nas listas, a Home sem evento cancelado, aviso nas páginas de cancelar e confirmar a inscrição (sem botão de confirmar em evento cancelado) e o `eventStatus` do Google
      (`EventCancelled`, `EventPostponed`, `EventRescheduled` com `previousStartDate`; `EventScheduled` no programado e no realizado). **Política de Privacidade 1.7:** diz que, se o evento for cancelado,
      adiado ou remarcado, o sistema envia aviso por e-mail a quem está inscrito. A hml ganhou, nos dados inventados, um evento em cada situação (`povoar_homologacao_volume.py`). **Testes:** servidor 1138 de
      1138 (rodadas completas; 23 novos em `tests/test_status_do_evento.py`, 3 da migração, e os da hml), painel 534 (489 antes), site 537 unitários e 584 de navegador, 50 páginas no `build:teste`; cada
      proteção foi provada quebrando o código de propósito. **Na homologação (2026-10-15):** `v5.5d-01` 1 de 1 (cria os três eventos e as inscrições), `v5.5d-02` 4 de 4 (cancelar: motivo vazio, curto e com e-mail
      são recusados, o motivo certo pede confirmação, avisa e fecha as inscrições, a API recusa inscrição nova; o site mostra o cancelamento sem formulário e a página de cancelar a inscrição avisa e não
      oferece confirmar; adiar, voltar à data original, adiar de novo e remarcar aparecem no painel, na API e no site, com as inscrições fechando e reabrindo e o formulário voltando; realizado trava antes do
      início, pede confirmação e não volta atrás), `v5.5d-04` 1 de 1 (a Auditoria guardou as 6 mudanças e a lista do painel mostra o selo de cada uma) e, depois de publicar a hml de novo, `v5.5d-03` 2 de 2
      (o HTML que o Google lê, sem JavaScript, já traz o aviso e `EventCancelled`, `EventRescheduled` com a data de antes e `EventScheduled` no realizado; a lista mostra os selos e a Home não lista o
      cancelado). Regressão: `v5.5c-02` 7, `v5.4f-02` 16, `v5.4f-03` 16, `v5.5a-02` 7, `v5.5a-01` 6, `v5.4g-01` 5 (acessibilidade de todas as páginas), `v5.4c-fase0` 6, `v5.4h-10` 5. **Achados,
      corrigidos:** (1) o evento adiado não tinha como voltar à data original (achado na revisão do painel; o servidor e o painel passaram a aceitar a retomada na mesma data, com teste); (2) um teste antigo
      do atendimento (v5.5a) sorteava o IP entre 250 e, às vezes, caía no IP que o teste do limite esgota de propósito (429 e `KeyError: 'protocolo'`): agora o IP nunca se repete e um teste trava isso;
      (3) dois erros do meu roteiro, não do produto: o teste da Auditoria procurava o evento pelo número da rodada (que muda a cada execução) e depois pela opção escondida do filtro — passou a ler o estado
      deixado pelo `v5.5d-02` (roteiro `v5.5d-04`); (4) rodar um segundo `pytest` junto com a suíte apaga a pasta temporária da primeira (21 falsos erros): nunca em paralelo. **Em produção (2026-10-15):**
      commit `74ff52f` no `version.json` do painel e do site; Deploy API (com a migração `b3e8c5a1d7f4`), Painel e Site verdes; `GET /api/publico/eventos` responde 200 (a migração rodou) e `/api/publico/eventos/999999`
      dá 404; `POST /api/eventos/1/status` sem login dá 401 e a rota e o esquema `EventoStatusAlterar` constam no `openapi.json`; a Política mostra a versão 1.7 com a frase do aviso por e-mail;
      `/eventos/`, `/cancelar-inscricao/` e `/confirmar-inscricao/` respondem 200 (**produção não recebeu evento nem inscrição de teste**). **Limites conhecidos:** (a) "Remarcado" não aparece como selo nas
      listas de edições e na página do projeto (o resumo do evento do servidor só traz a situação); (b) o reembolso de quem pagou e NÃO desiste pelo link é tratado no Financeiro (não é automático); (c) o aviso por
      e-mail depende do SMTP configurado (a hml não tem: o painel mostra "alguns e-mails não saíram").
- [x] **Conferência independente dos textos públicos de evento e da Política (2026-10-15)** — um verificador que não via a minha conclusão conferiu cada afirmação contra o código e achou o que segue; tudo
      corrigido, provado na homologação e confirmado em produção (commit `b58b746`). **Defeito real: a hora do evento no site estava 3 horas errada.** O painel e o servidor guardam a hora em UTC (quem digita
      19:00 em Belém manda 22:00Z); o site lia a hora crua como horário local de Belém e mostrava 22:00 (e mandava o horário errado ao Google). Nunca apareceu porque os robôs e o CI rodam em UTC, onde as
      duas convenções coincidem. **Provado na homologação** com um navegador no fuso de Belém (`v5.5d-05`: digitou 18:00, o site mostrava 21:00) e corrigido: o site passa a ler a data da API como UTC e a
      mostrar em Belém (`site/src/lib/datas.ts`; o `<time datetime>` e o dado do Google saem com `-03:00`), o mock da API do site escreve UTC, e os e-mails (mudança de situação, vaga que abriu) e a data do
      certificado passam a sair em horário de Belém (`app/services/fuso.py`), dizendo qual é. **Outros achados corrigidos:** trocar a data pelo "Editar evento" não avisava ninguém nem marcava "remarcado" (agora, com
      inscritos, o servidor recusa e manda usar "Remarcar"; a comparação da data com e sem fuso também deixou de dar erro 500); aumentar o limite de vagas não chamava a lista de espera (quem chegasse depois
      passava na frente: agora a fila anda na hora, na ordem); o e-mail de cancelamento de evento pago agora diz como pedir a devolução do valor inteiro; o e-mail "uma vaga abriu" mostra o prazo em horário de
      Belém (era UTC). **Textos públicos corrigidos (Política de Privacidade 1.8):** o parágrafo da inscrição em evento (o formulário nem sempre existe; o e-mail é tentativa; a lista de espera não recebe código;
      o contato do cadastro é o que recebe os avisos; o IP também fica registrado ao abrir, cancelar ou confirmar; o registro técnico aparece na Auditoria; a inscrição NÃO é cancelada pelo sistema quando o evento
      é cancelado ou adiado); o encarregado só é nomeado quando o mandato está publicado (a frase "o nome consta na página Diretoria" era falsa em produção); "as inscrições reabrem quando a nova data for
      definida" virou frase condicional; os avisos da lista de espera dizem "se uma vaga abrir" e do prazo para confirmar; evento com valor ou com arquivo não promete mais que a secretaria faz a inscrição.
      **Testes:** servidor 1144 de 1144 (duas rodadas; 6 testes novos de fuso e das duas correções, que reprovam sem elas), site 556 unitários e 749 de navegador; **na homologação** `v5.5d-05` 2, `v5.4g-04` 9,
      `v5.4f-02` 16, `v5.4f-03` 16, `v5.4h-06` 4, `v5.5a-01` 6, `v5.4h-10` 5 e `v5.4g-01` 5. **Em produção:** Deploy API e Site verdes; Política 1.8 no ar com as frases corrigidas e sem a promessa do nome;
      a política de conteúdo continua nos cabeçalhos.
      **ABERTO — decisão do Presidente (nada disto foi mexido sem ele):**
      (1) **O e-mail da API está desligado em produção.** O contêiner `asaf-api` NÃO tem as variáveis `SMTP_*` (só as rotinas agendadas do GitHub as leem do cofre `kv-asaf-arca`, onde os cinco segredos
      existem e estão ativos). Por isso NENHUM e-mail que a API manda na hora sai de verdade em produção: confirmação de inscrição, aviso de vaga, aviso de mudança de situação do evento, confirmação de
      pedido do site, resposta a pedido. A inscrição continua valendo (o envio é tentativa) e os textos públicos já dizem "tenta enviar", mas a pessoa fica sem o e-mail. Ligar é mudança de infraestrutura de
      produção que passa a mandar e-mail real: plano proposto = copiar as cinco variáveis do cofre para o contêiner como segredos (sem mostrar valores), nova revisão, e provar com um e-mail de teste ao
      endereço do Presidente; a homologação continua sem e-mail de propósito. (2) **Encarregado:** o Presidente cadastrar o próprio mandato (a Política e a página Diretoria só mostram o nome depois).
      (3) **Prazo de guarda do participante externo (LGPD):** o consentimento padrão diz "para fins de organização deste evento", mas a pessoa fica no cadastro sem prazo de eliminação; precisa de decisão
      (FASE 7). (4) Quem pagou e foi inscrito pela secretaria não tem link: a devolução dele é tratada à mão no Financeiro. (5) **Lacuna no fluxo do site:** a publicação automática de conteúdo
      (`sincronizar-site` e Directus) pula os portões de qualidade e publica o código que estiver na `main`; sugestão: recusar a publicação se a última verificação da `main` falhou.
      **Respostas do Presidente em 2026-10-15 e o que foi feito:** (1) **e-mail da API LIGADO em produção** (autorizado por ele): os cinco segredos `smtp-*` foram copiados do cofre para o contêiner `asaf-api`
      (revisão `asaf-api--0000126`, saudável, 100% do tráfego); provado com um e-mail de teste aceito pelo servidor (Google Workspace, porta 587) e, DENTRO do contêiner de produção, as cinco variáveis presentes e a
      porta de e-mail alcançável; a publicação da API só troca a imagem, então a configuração persiste; a homologação segue SEM e-mail de propósito. (2) **Nome e foto da Diretoria no site:** entra como v5.7c
      (o cadastro dos mandatos e das fotos é ato dele no painel). (3) **Prazos de guarda:** proposta com base legal na tabela de temporalidade (v5.6) e a rotina na v5.7b. (4) **Pix:** estático, sem QR dinâmico
      (v5.6 reformulada). O item (4) das "limitações" (devolução de quem foi inscrito pela secretaria) e o item (5) (lacuna do fluxo do site) seguem como estão.

#### v5.6 — Doação online (era a v5.4) — REFORMULADA em 2026-10-15 (decisão do Presidente)

**Decisão (2026-10-15):** o QR code dinâmico do Pix NÃO existe para a ASAF (é serviço pago e exige API de um banco que ela não tem) e a recorrência por Pix Automático idem. A doação online usa o **Pix
ESTÁTICO** (a chave da associação, em `CHAVE_PIX`; Pix Copia e Cola e QR code estático gerados pelo sistema) e a **confirmação é MANUAL**: o Tesoureiro confere o extrato do banco e confirma no painel; só
então nasce a doação com o recibo. O sistema nunca diz que recebeu antes disso.

- [x] **v5.6a — Doar pelo site (Pix estático) com confirmação manual.** Página de doação (a de "Como ajudar" deixa de dizer que não existe): escolhe a campanha (ou "onde for mais necessário") e o valor,
      escolhe entre **doação anônima** (o site só mostra o Pix e não guarda nada da pessoa) e **doação identificada** (nome, e-mail, CPF opcional, aviso de privacidade); a identificada vira uma
      *intenção de doação* "Aguardando confirmação" com protocolo; o painel do Tesoureiro lista as intenções, confirma quando acha o dinheiro no extrato (cria a `Doacao` e o recibo, que sai por e-mail) ou
      marca "não localizada"; intenção sem confirmação por 30 dias expira. Transparência por campanha: quanto arrecadou (só doação CONFIRMADA) e em que foi aplicado, lendo o centro de custo real (FASE 3).
  **Feito (2026-10-16):** servidor (`IntencaoDeDoacao`, migração `d5a2b8c1e7f3`, `app/services/doacao_online.py`; rotas públicas `GET /api/publico/doacao`, `GET /api/publico/doacao/pix` e
  `POST /api/publico/doacoes/intencoes`; rotas do painel `/api/intencoes-doacao/` com resumo, confirmar e não-localizada). Só a confirmação da tesouraria cria a doação (título pago, lançamento e recibo
  numerado, na mesma transação) e com o valor RECEBIDO; o recibo por e-mail é tentativa (o painel avisa se não saiu); a intenção expira em `PRAZO_DIAS_INTENCAO_DOACAO` (padrão **15** dias, não os 30 do rascunho;
  regra editável) para "Prazo vencido sem confirmação" e ainda pode ser confirmada; nada é apagado. **A página só abre com a Chave Pix preenchida E marcada "vai para o site" em Instituição** (para a chave nunca
  ser publicada sem o Presidente decidir; o Pix das cobranças já pode estar cadastrado). Painel: seção "Doações do site (Pix)" em Doações (lista, filtros, busca, confirmar com valor recebido e contas, "Pix não
  localizado", aviso de recibo que não saiu por e-mail, linha "página aberta/fechada"). Site: `/como-ajudar/doar/` (campanhas com o RECEBIDO ao vivo; Pix sem se identificar com código e QR Code desenhado no
  navegador pela biblioteca `qr` 0.7.2, sem dependências e sem serviço de terceiros; formulário de quem se identifica, com protocolo) e Política **2.0**. Os textos passaram por conferência independente de
  fatos (3 exageros e 5 incompletudes corrigidos, entre eles "você escolhe para onde vai" no Pix sem identificação, que o servidor não registra).
  **Na homologação:** robôs `v5.6a-01` 5/5 (a trava: chave só interna = doação fechada, marcada = abre; campanha sem a destinação interna; BR Code com CRC conferido de forma independente; mesmo pedido, mesmo
  protocolo; aviso no sino; confirmar no painel com recibo e aviso de que o e-mail não saiu, porque a homologação não manda e-mail; a campanha passa a contar o recebido; "Pix não localizado" não apaga;
  armadilha de robô, aviso com versão, dado errado em português, conferência só com login) e `v5.6a-02` 3/3 (página Doar do site de teste com campanha ao vivo, Pix com código e QR, formulário de quem se
  identifica visto na conferência, Política 2.0, e a página fechando sozinha ao desmarcar a chave); regressões `v5.7c-02`, `v5.4e-02` (29), `v5.5a-02` e `v5.4h-02`; suíte do servidor 1204 (2 rodadas), painel
  629, site 719 + 818 de navegador.
  **Em produção:** `main` = `2c53328`; `painel.asaf.org.br/version.json` e `asaf.org.br/version.json` = `2c53328`; `openapi.json` traz as 7 rotas; `GET /api/publico/doacao` responde `pix_disponivel:false`
  (fechada: a chave ainda não foi marcada "vai para o site"), `/api/publico/doacao/pix` = 503, `/api/intencoes-doacao/` sem login = 401; `/como-ajudar/doar/` = 200; `/privacidade/` "Versão 2.0" com o
  parágrafo da doação; a tarefa periódica disparada à mão rodou o passo novo no banco real (`intenções expiradas: 0`). Nenhuma intenção nem doação foi criada em produção.
  **Abertos:** (1) quem abre a doação é a Presidência: preencher CHAVE_PIX (e nome e cidade do Pix) e marcar "vai para o site" em Instituição; (2) "em que foi aplicado" por campanha (a Transparência lendo
  o centro de custo real) NÃO foi feito: só o RECEBIDO; (3) o pedido não confirmado e os dados de quem se identificou não eram apagados sozinhos (resolvido pela v5.7b); (4) o Pix sem se identificar não deixa registro: a
  tesouraria só o vê no extrato do banco e precisa registrá-lo à mão; (5) o e-mail do pedido e do recibo é só tentativa (o site diz isso).
- [x] **v5.6b — Conta de visitante (por e-mail + código, sem senha).** A pessoa pede um código, recebe no e-mail e entra numa área onde ficam as inscrições dela em eventos (o evento encerrado fica
      **inativo, não é apagado**, e continua consultável), os certificados e as doações com recibo. É o que dá sentido ao prazo de guarda dos dados (abaixo). Sessão curta, código de uso único e com
      limite de tentativas; a pessoa pode pedir o apagamento dos próprios dados.
  **Feito (2026-10-16):** servidor (migração `e6b3c9d2f8a4`: tabelas `codigos_de_visitante` e `sessoes_de_visitante` e a coluna `inscricoes.email_da_inscricao`; `app/services/conta_de_visitante.py`,
  `app/routers/visitante.py`): rotas públicas `POST /api/publico/visitante/codigo` e `/entrar`, e as da sessão `GET /api/visitante/minha-conta`, `POST /api/visitante/sair` e `/pedir-apagamento`. Código de
  6 números, 10 minutos, uso único, 5 tentativas (contadas de forma atômica no banco), só a impressão HMAC guardada; a resposta ao pedir o código é idêntica com ou sem vínculo (o código só é gerado e
  enviado se existe vínculo) e o 4º pedido do mesmo e-mail na hora dá 429 para qualquer e-mail; sessão de 60 minutos, só a impressão no servidor; a sessão do visitante não abre o painel e o token do
  painel não abre a conta. **O vínculo é o e-mail DIGITADO na inscrição pelo site** (coluna nova), nunca o do cadastro: a conferência independente achou que a deduplicação por CPF grava o e-mail de quem
  se inscreveu no cadastro de uma pessoa que não tinha e-mail, o que daria a conta dela a quem soubesse o CPF. A conta mostra as inscrições (o evento encerrado fica, inativo; o link secreto de cancelar ou
  confirmar só aparece quando há o que fazer), os certificados dessas inscrições (PDF e código de verificação) e os pedidos de doação (o recibo só depois da confirmação da tesouraria), sem CPF, telefone
  nem dado de outra pessoa. "Pedir a eliminação dos meus dados" abre uma solicitação de titular (eliminação) na fila de atendimento, com o prazo de 15 dias, sem apagar nada na hora. A rotina de retenção
  ganhou a limpeza técnica de 1 dia (códigos, sessões e o contador de pedidos). Site: página `/minha-conta/` (noindex, fora do sitemap, link no rodapé), sessão só no `sessionStorage` da aba, Política
  **2.2** (trecho `data-conta-visitante-politica`, com SÓ o que o código faz). Junto foi o lote 11 de atualizações (fastapi 0.143.3, pypdf 6.21.0, eslint 10.13.0, lucide-react 1.58.0).
  **Na homologação:** robôs `v5.6b-01` 6/6 (API, fila e Auditoria: resposta igual com e sem vínculo, código errado, de e-mail sem vínculo e certo, conta sem CPF nem telefone, sessões que não se cruzam
  com o painel, uso único, cinco erros queimam o código, 4º pedido = 429, pedido de eliminação visto na tela da fila e o segundo devolve o mesmo, Auditoria sem o e-mail, sair encerra) e `v5.6b-02` 4/4
  (o visitante no site de teste: e-mail, código, conta, link de cancelar aberto sem cancelar e sessão que continua ao voltar, eliminação em dois passos, sair com a sessão apagada da aba, política de
  conteúdo sem violação, Política 2.2 e rodapé); regressões `v5.5c-01` 1/1 e `v5.5c-02` 7/7 (inscrição pelo site), `v5.4h-06` 4/4, `v5.4f-03` 16/16, `v5.5a-02` 7/7, `v5.6a-01` 5/5, `v5.6a-02` 3/3,
  `v5.7b-01` 2/2, `v5.7b-02` 2/2 e `v5.7c-02` 2/2. Suíte do servidor 1262 em duas rodadas seguidas (a primeira rodada, antes das correções, reprovou 2 testes de registro: um literal de caminho no
  serviço e as rotas do visitante fora da lista de rotas sem tela do painel; corrigidos), site 744 unitários + 845 de navegador, painel 629. A conferência independente (agente separado, só leitura)
  achou defeitos reais, corrigidos e provados de novo (testes e homologação) ANTES da `main`: a contagem de tentativas não era atômica (pedidos em paralelo furavam o limite de 5), o vínculo pelo cadastro (acima) e
  frases do site que prometiam mais que o código ("enviamos" virou "tentamos enviar", o limite de pedidos é de 1 hora, o e-mail sai da tela ao sair, o pedido que já existia não promete outro e-mail).
  Defeitos dos robôs (não do produto): números fixos de conta contábil e a ordem da cadeia (a página de evento só existe no site depois de nova publicação). A máquina ficou sem memória no meio da
  cadeia (dois robôs nem foram disparados): foram rodados de novo, sozinhos.
  **Em produção:** `main` = `6eaf9da`; Deploy API, Painel e Site verdes; `painel.asaf.org.br/version.json` e `asaf.org.br/version.json` = `6eaf9da`; `openapi.json` da API traz as 5 rotas novas;
  `GET /api/visitante/minha-conta` sem sessão e com token inventado = 401; `/minha-conta/` = 200, noindex, fora do sitemap, e o rodapé da home leva a ela; `/privacidade/` em "Versão 2.2" com o trecho
  da conta e a lista dos 7 prazos; `GET /api/publico/doacao` segue com `pix_disponivel:false`; o contêiner `asaf-api` tem as variáveis `SMTP_*` e NÃO tem `VISITANTE_CODIGO_NA_RESPOSTA` (só nomes lidos);
  a tarefa periódica, disparada à mão, rodou sobre o código novo: as 7 regras em 0, "limpeza técnica (conta_de_visitante): 0" e nenhuma falha (a migração está aplicada: as tabelas novas respondem).
  Nenhum e-mail, código ou inscrição foi criado em produção.
  **Abertos:** (1) o primeiro código real só será enviado quando alguém tiver inscrição em evento ou pedido de doação com e-mail em produção (ainda não há evento público); o envio é tentativa; (2) a
  inscrição feita pela secretaria (sem e-mail digitado pelo site) NÃO aparece na conta: é decisão de segurança, dita na Política; (3) quem sabe o CPF de uma pessoa ainda pode reinscrevê-la, pelo
  formulário público, em um evento em que a inscrição dela está CANCELADA (o motor reaproveita a linha e emite novo link): é anterior à v5.6b, e agora quem fez isso também vê essa inscrição na conta
  dele; (4) trade-offs conhecidos: quem sabe o e-mail de alguém pode gastar os 3 pedidos por hora dele (bloqueio de 1 hora), dois cliques simultâneos podem abrir 2 pedidos de eliminação, e o tempo de
  resposta de "pedir código" difere alguns milissegundos entre os dois casos; (5) a Tabela de temporalidade previa "conta de visitante: 5 anos sem acesso", mas a conta não guarda dado próprio (é uma
  janela sobre a inscrição e a doação, que seguem as suas regras): a linha da tabela foi ajustada; (6) seguem sem regra de retenção as inscrições em evento, os voluntários e os certificados, e o IP da
  Auditoria.
- [x] Recibo automático por e-mail (v5.6a: ao confirmar, o sistema tenta enviar o recibo; se não sair, o painel avisa) — a área de acompanhamento das próprias doações é a conta de visitante (v5.6b, feita).
- [ ] Transparência do destino por campanha (a v5.6a entregou só o RECEBIDO por campanha na página Doar; falta o APLICADO): arrecadado e aplicado puxados do centro de custo real; **liga com a v5.4**: a campanha aparece na Transparência.
- [x] ~~PIX dinâmico com identificação automática~~ e ~~Pix Automático~~: **descartados** (sem API de banco). Só voltam se a ASAF contratar um provedor de pagamento no futuro.

##### Prazos de guarda de dados pessoais (proposta de 2026-10-15, a partir da ideia do Presidente: 5 anos, depois até 10, depois só o financeiro) — Tabela de temporalidade v1

Base: LGPD art. 15 (o tratamento termina quando a finalidade acaba) e art. 16 (a regra é eliminar; guardar só para obrigação legal, estudo anonimizado etc. — **não** vale guardar para sempre "por
cautela"), art. 18, VI (eliminação a pedido); Código Civil art. 206 (cobrança de dívida documentada: 5 anos; reparação civil: 3 anos; prazo geral: 10 anos, art. 205); Lei 13.019/2014 art. 68, parágrafo
único (a OSC guarda os originais da prestação de contas de parceria com o poder público por **10 anos**); comprovantes de receita e despesa por **5 anos** (condição da imunidade/isenção, modelo de
declaração da Receita). Não é parecer jurídico: é o raciocínio adotado; o Presidente pode ajustar os números.

| Dado | Conta a partir de | Guarda completa | Depois |
| --- | --- | --- | --- |
| Pessoa que só se inscreveu em evento ou doou (nome, CPF, e-mail, telefone, respostas do formulário) | último evento em que participou (a conta de visitante não guarda acesso) | 5 anos | anonimiza; o evento e a contagem ficam |
| Inscrições e presenças | idem | 5 anos | anonimizadas junto com a pessoa; o evento fica **inativo e consultável** |
| Certificados | emissão | 10 anos | a verificação pública continua dizendo "certificado válido", sem o nome |
| Pedidos da fila de atendimento (contato, informação, titular) | encerramento | 5 anos | apaga mensagem e contato; ficam protocolo, tipo e datas |
| Registro técnico de acesso (IP das tentativas) | data do registro | 6 meses | apaga |
| Auditoria do sistema | data da ação | 10 anos | — |
| Proposta de filiação não aprovada | decisão | 2 anos | apaga |
| Voluntário (termo de adesão e dados) | fim do voluntariado | 5 anos | anonimiza |
| Associado e dependentes | desligamento | livro de associados (nome, matrícula, datas): permanente; contato e endereço: 5 anos | apaga contato e endereço |
| Doador identificado e recibo | emissão do recibo | 10 anos | anonimiza o doador; ficam valor, data e destino (dado financeiro permanente) |
| Escrituração financeira (livro-caixa, títulos, contas) | — | permanente | — |
| Atas e Estatuto | — | permanente | — |
| Prestação de contas de parceria ou emenda | prestação de contas | 10 anos | — |
| Conta de visitante (código e sessão) | criação | 1 dia (limpeza técnica); a conta não guarda dado próprio: mostra a inscrição e a doação, que seguem as suas regras | apaga |

**Regra de honestidade:** a Política de Privacidade só passa a prometer um prazo quando a rotina que o aplica existe e está testada (item v5.7b, abaixo); até lá ela segue sem prometer eliminação automática.

#### v5.7 — Confiança, privacidade e conformidade do site (era a v5.5)

- [x] **Banner de cookies honesto** — o site não instala cookie nem fala com servidor de terceiro, então NÃO há banner (seria fingir o contrário); a Política já dizia isso. **Provado:** teste de
      navegador em cada página (nenhum cookie, nenhum armazenamento local, nenhuma origem fora do site e da API), na homologação e, por leitura, em produção (23 páginas abertas num navegador:
      nenhum cookie, nenhum terceiro, nenhum `Set-Cookie`).
- [x] **Headers de segurança** (2026-10-15) — escritos no build de CADA ambiente (integração do Astro em `astro.config.mjs` + `site/scripts/lib/cabecalhos-de-seguranca.mjs`, dentro de
      `dist/staticwebapp.config.json`; a homologação recebe a política com a API de teste e a produção com a de produção): `Content-Security-Policy` fechada (`default-src 'none'`; script e estilo só
      do próprio site; imagens e chamadas só do site e da API; `frame-ancestors 'none'`; sem `unsafe-*`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` (câmera,
      microfone, localização e pagamento desligados) e `Cross-Origin-Opener-Policy: same-origin`; o HSTS e o `Referrer-Policy` já vinham do Azure. A CSP NÃO precisou conhecer o Directus nem o Google
      Maps (o site é autocontido: a mídia entra no build e o mapa é só um link). **Achado pelo teste:** três páginas da Transparência tinham um script de 685 bytes escrito DENTRO da página (o Astro
      inlina script pequeno), que a política bloquearia; o build agora não inlina script (`assetsInlineLimit: 0`) e um teste confere que nenhuma página tem script, estilo ou `on…=""` dentro dela.
      O `astro preview` do teste de navegador manda os MESMOS cabeçalhos que o build publicou, então os 749 testes de navegador do site rodam sob a política. **Verificado:** 16 testes unitários do gerador;
      109 de navegador no arquivo novo (`e2e/seguranca.spec.ts`: política em cada página, nada de terceiro, a política realmente bloqueia o que é de fora, sem cookie); Lighthouse local nas 16 páginas da
      amostra; na homologação `v5.7-01` 5 de 5 com os cabeçalhos REAIS do Azure (cada página responde com a política da API de teste e abre sem violá-la; a agenda ao vivo funciona; embutir o site em
      outra página é recusado; `security.txt` no ar; declaração aberta e no rodapé) e regressão `v5.5a-01` 6, `v5.4h-10` 5, `v5.4g-01` 5. **Em produção (2026-10-15, commit `f26d2ee`):** o CI do site
      (axe, SEO e Lighthouse) verde; Home e página 404 trazem os cinco cabeçalhos (a política com a API de PRODUÇÃO); nenhum `Set-Cookie`; abertura das páginas públicas num navegador sem nenhuma violação.
- [x] Página "Transparência" e página "Privacidade" sempre acessíveis a partir do rodapé de qualquer página (**já feito na v5.2**).
- [x] **Declaração de acessibilidade** (`/acessibilidade/`, versão 1.0 de 2026-10-15, no rodapé e no sitemap) e `security.txt` (`/.well-known/security.txt`, RFC 9116: contato `asaf@asaf.org.br` e a
      página de Contato; validade de 330 dias, renovada a cada publicação do site). **A declaração passou por conferência independente DUAS vezes:** a 1ª achou 3 afirmações falsas ou exageradas; a 2ª, 2 falsas
      e 4 exageradas (a principal: a publicação automática de conteúdo pula os portões de qualidade e publica o código que estiver na `main`). O texto agora diz só o que se sustenta: conformidade
      parcial; verificação automática a cada mudança de CÓDIGO, com dados de exemplo; revisão manual e avaliação por pessoas ainda não feitas; limites conhecidos. O primeiro Tab → "Pular para o conteúdo"
      passou a ser testado em TODA página, e a declaração entrou na amostra do Lighthouse.
- [ ] Mapa com pino **só** com coordenadas exatas informadas pela diretoria (decisão de 2026-10-03: fica para o futuro).

- [x] **v5.7b — Rotina de retenção (LGPD, FASE 7 em fatia):** os prazos da tabela acima ficam em configuração; uma tarefa periódica anonimiza ou apaga o que venceu, registra na Auditoria só as
      contagens, e a Política de Privacidade passa a publicar os prazos que a rotina de fato aplica.
  **Feito (2026-10-16):** `app/services/retencao.py` com 7 regras, cada uma na sua transação (uma que falha não derruba as outras): tentativas de acesso aos formulários públicos, o registro do IP do
  limite por hora (183 dias, a linha é apagada), avisos do sino (365, apagados), pedidos da fila de atendimento (1825, o texto vira marcador e o nome some), propostas de filiação não aprovadas (730, sem as que têm voto recente de sócio), pedidos de doação sem confirmação
  (730), doador identificado (3650: some o vínculo com a pessoa, fica o valor para a contabilidade) e associado desligado (1825). Prazos em configuração (6 chaves novas `PRAZO_RETENCAO_*`, 71 no
  total), **com piso de 30 dias e teto de 36500**: um "0" digitado por engano não apaga ninguém (valia também para o botão manual de anonimizar, que antes obedecia ao "0"). A anonimização passou a ser
  idempotente, a apagar também o **arquivo da foto** (falha do armazenamento = 502, nada é mexido e a pessoa fica para a próxima rodada) e o **endereço**, e a pular quem tem ou já teve outro papel
  (voluntário, por exemplo). A Auditoria guarda só contagens (`RETENCAO_APLICADA`). O roteiro `scripts/aplicar_retencao_de_dados.py` sai com erro (o passo agendado fica **vermelho**) se qualquer regra
  falhar; entrou na tarefa periódica com o endereço do armazenamento de produção e na publicação da homologação. Política de Privacidade **2.1** com os 7 prazos, o que ainda NÃO tem prazo automático
  (dependentes, documentos anexados, histórico de cargos, observações internas da ficha) e o limite do que apagamos; versão do aviso da doação passou a 2.
  **Na homologação:** robôs `v5.7b-01` 2/2 (as regras na tela de Configurações e a preparação de dado recente), `v5.7b-02` 2/2 (depois de uma segunda publicação que roda a rotina de novo contra o
  banco e o armazenamento de TESTE: o dado recente segue intacto e a Política está em 2.1), e as regressões que mexem em dado pessoal: `v5.5a-02` 7/7, `v5.6a-01` 5/5, `v5.6a-02` 3/3, `v5.4h-10` 5/5,
  `v5.7c-02` 2/2 e `v5.4c-fase1` 24/24 (associados: desligar, a recusa de anonimizar antes do prazo, foto, propostas, importação, exportação, vínculos, recadastramento). Suíte do servidor 1226 em duas
  rodadas seguidas; site 719 unitários + 819 de navegador; painel formato, tipos e lint limpos. A conferência independente achou 4 defeitos de CÓDIGO (o botão manual ignorava o piso; a foto do arquivo
  não era apagada; a anonimização não era idempotente; a rotina engolia falha do armazenamento e ficava verde com o problema vivo) e erros no texto da Política: tudo corrigido e conferido de novo.
  **Em produção:** `main` = `f8bb6ae`; Deploy API e Deploy Site verdes (o painel não foi republicado: nesta versão só mudaram os robôs de teste dele, então `painel.asaf.org.br/version.json` segue em
  `2c53328`); `asaf.org.br/version.json` = `f8bb6ae`; `/privacidade/` em "Versão 2.1" com a lista de 7 prazos e a frase do limite; `GET /api/publico/doacao` segue com `pix_disponivel:false` e aviso na
  versão 2. A tarefa periódica agendada rodou SOZINHA sobre o código novo (14:35 UTC): todos os passos verdes, a retenção imprimiu as 7 regras com `0` e nenhuma falha, o que é o esperado (o sistema é
  novo e não há dado vencido); o passo da foto da Diretoria, com o armazenamento de produção, `fotos apagadas: 0; que não foi possível apagar: 0`.
  **Abertos desta versão:** (1) ainda sem regra automática: inscritos em evento, voluntários, certificados e o IP da própria Auditoria, que não tem prazo (a conta de visitante, da v5.6b, não guarda dado próprio: só a limpeza técnica de 1 dia); (2) a tabela de
  prazos é proposta minha e aguarda ajuste do Presidente (os valores estão em Configurações, com piso e teto); (3) a transparência "aplicado por campanha" da doação não foi feita; (4) a primeira
  rodada com dado vencido de verdade só vai acontecer quando houver dado vencido: a prova até lá é a da homologação.
- [x] **v5.7c — Nome e FOTO da Diretoria Executiva no site (decisão de 2026-10-15):** "a pessoa se sente representada quando vê o rosto de quem responde pela instituição". Hoje a API pública da
      diretoria nunca traz foto; passa a trazer a foto de quem **autorizou o uso da imagem** (registro da autorização no painel, como nas fotos de evento), regravada sem metadado; a página mostra nome,
      cargo, foto e período do mandato. Depende de o Presidente cadastrar os mandatos e as fotos no painel (ato dele).
  **Feito (2026-10-15):** servidor (`FotoDaDiretoria`, migração `c4f1a9d6e8b2`; só com a autorização de imagem marcada; regravada em JPEG sem Exif/GPS/comentário, até 2000 px; uma foto por pessoa; pública só
  com mandato vigente, conferido a cada pedido; apagar tira banco e arquivo; Auditoria `FOTO_ENVIADA`/`FOTO_APAGADA`; texto alternativo montado na leitura com o nome e o cargo de hoje), painel (bloco "Foto no
  site" em cada mandato vigente: enviar, trocar, apagar com confirmação), site (cartão com a foto COPIADA para o próprio site com conferência de SHA-256, ou círculo de iniciais; Presidente em destaque; Política **1.9**).
  **Na homologação:** robôs `v5.7c-01` (painel e API: recusa sem a autorização, foto sem metadado e com a impressão digital certa, troca, apagar com confirmação e 404 depois, só com login) 4 de 4 e `v5.7c-02`
  (site de teste: foto da Presidente do próprio site, iniciais de quem não tem foto, Política 1.9) 2 de 2, em três rodadas; suíte do servidor 1155 (2 rodadas), painel 551, site 589 + 763 de navegador. A conferência
  independente de fatos achou dois exageros no texto ("apagada na hora" não é literal por causa das cópias de segurança; a verificação pública da carteirinha entrega a foto do cadastro): textos corrigidos e
  provados de novo na hml.
  **Em produção:** `main` = `2c3f8be`; `painel.asaf.org.br/version.json` e `asaf.org.br/version.json` = `2c3f8be`; `openapi.json` da API traz `/api/publico/diretoria/fotos/{id_foto}`; foto inexistente = 404;
  `/privacidade/` em "Versão 1.9" com o parágrafo da foto. Produção ainda sem mandato cadastrado (`/api/publico/diretoria` = `[]`): o cadastro dos mandatos e das fotos é ato do Presidente.
  **Decisões do Presidente depois da conferência (2026-10-15 à noite):** (1) o armazenamento NÃO pode reter foto sem prazo: tem que apagar de verdade, com janela de 20 a 30 dias no máximo, declarada na Política;
  (2) a foto da Diretoria é **apagada automaticamente** quando acaba o mandato (não fica guardada); (3) a verificação pública da carteirinha por QR não pode valer por tempo indeterminado: validade curta
  (10 a 20 dias). Viram o item **v5.7d** abaixo.

- [x] **v5.7d — Apagar de verdade (decisões do Presidente, 2026-10-15 à noite):** (a) rotina que apaga sozinha a foto de quem não tem mais mandato vigente nem futuro (banco e arquivo, com Auditoria);
      (b) o armazenamento privado do Azure (`stasafprivado`, versionamento ligado, soft delete de 30 dias, sem política de ciclo de vida) passa a apagar as versões anteriores das fotos em prazo curto e
      declarado, provado primeiro na homologação; (c) o QR da carteirinha deixa de valer por 365 dias: validade curta e configurável (10 a 20 dias), também para os QR já emitidos; (d) a Política passa a
      dizer exatamente isso (versão 1.10), depois de uma conferência independente.
  **Feito (2026-10-15 à noite):** (a) `apagar_foto_se_sem_mandato` (no ato de encerrar o mandato: `POST /api/mandatos/{id}/encerrar` devolve `foto_apagada` e o painel avisa antes e depois) e
  `apagar_fotos_sem_mandato` (rotina `scripts/apagar_fotos_da_diretoria_vencidas.py`, passo do `tarefa-eventos-vagas.yml` e da publicação de teste; devolve (apagadas, falhas) e **sai com 1 se alguma foto não
  puder ser apagada**; 24 h de carência só para quem nunca teve mandato cadastrado). (b) Regra de ciclo de vida (`infra/ciclo-de-vida-das-fotos.json`: versões antigas dos contêineres `fotos-*` apagadas 1 dia
  depois de gravadas) e soft delete de blobs de 30 para **25 dias** nas duas contas (`stasafprivado` e `stasafhmlprivado`, que agora espelha a produção com versionamento e soft delete); papel de dados da
  identidade `asaf-github-actions` só no contêiner `fotos-diretoria` da produção. A 1ª atribuição foi criada com o `appId` no lugar do `objectId` (a conferência independente achou: a rotina falharia em
  silêncio); apagada a órfã e recriada com o objectId `f026eaf3-…` (**`az role assignment list` mostra o appId em `principalName`; o objectId é o `principalId`**). Máximo real da imagem depois de apagada: cerca
  de 26 a 28 dias (1 a 2 dias para a versão ficar elegível + até 1 dia até a rodada diária da Azure + 25 de soft delete); o backup do banco (35 dias) guarda só o nome do arquivo e a descrição. (c) `app/services/carteirinha.py`:
  regra `DIAS_VALIDADE_CARTEIRINHA` (padrão 15, teto 20) na emissão, na verificação pública, no credenciamento de assembleia e na portaria, também para QR já emitido (conta da data de emissão); a verificação
  deixou de entregar o endereço aberto `/uploads/...` da foto do cadastro: entrega `/carteirinha/verificar/{token}/foto`, que confere o QR a cada pedido. (d) Política **1.10**, corrigida pela conferência
  independente (2 rodadas; a 2ª sem nenhuma afirmação falsa); o tempo para a foto sair do site foi corrigido de "15 a 30 minutos" para "algumas horas" (o GitHub atrasa o agendamento: 2 a 9,5 h entre
  rodadas), também nos textos do painel. Achado de passagem e corrigido: `lancamento_tardio` e `financeiro.py` contavam os dias do pagamento ao lançamento no dia do servidor (UTC); agora no dia de Belém
  (a suíte reprovava das 21h à meia-noite de Belém).
  **Na homologação:** robôs `v5.7c-01` 4/4 (regressão da foto), `v5.7d-01` 3/3 (encerrar o mandato apaga a foto na hora, com aviso na tela e Auditoria sem nome; prepara pessoa com mandato antigo e foto; QR novo de
  15 dias e a regra na tela), `v5.7d-02` 1/1 (depois da publicação de teste, que roda a rotina contra o banco e o armazenamento de TESTE: a foto de quem ficou sem mandato SAIU, a Auditoria guardou
  `FOTO_APAGADA_AUTOMATICAMENTE` sem usuário e a foto da Presidente ficou), `v5.7c-02` 2/2 (site, Política 1.10) e `v5.4d-04` 7/7 (regressão dos mandatos); suíte do servidor 1170 (2 rodadas), painel 553,
  site 589 + 763 de navegador.
  **Em produção:** `main` = `5168dca`; `painel.asaf.org.br/version.json` e `asaf.org.br/version.json` = `5168dca`; `openapi.json` da API traz `/carteirinha/verificar/{token}/foto` e a rota responde 400 "Carteirinha
  inválida ou expirada." a um token inválido; `/privacidade/` em "Versão 1.10"; a tarefa periódica, disparada à mão em produção, rodou o passo novo com sucesso (`fotos apagadas: 0; que não foi possível
  apagar: 0`; produção ainda não tem mandato nem foto); regra de ciclo de vida, soft delete de 25 dias e papel conferidos por leitura (`az`).
  **Abertos desta versão:** (1) o efeito da regra de ciclo de vida sobre uma versão real só aparece depois que a Azure roda a política (uma vez por dia): conferir daqui a uns 2 dias na homologação com
  `az storage blob list --include v` (precisa de papel de leitura de dados); a janela de cerca de 30 dias é a da documentação da Microsoft, ainda não observada; (2) foto de cadastro de associado já emitida segue
  abrindo por `/uploads/fotos/<uuid>` a quem já tem o endereço (a verificação do QR não o entrega mais; o painel o usa): uma migração que regrave cada foto com nome novo é uma opção; (3) a foto sai do site em
  horas por causa do agendamento do GitHub: melhoria possível, a tarefa periódica disparar o deploy do site quando apagar uma foto.

- [x] **v5.7e e v5.7f** (os dois achados do Ponto de Revisão 2/2, decisões do Presidente de 2026-10-19): o texto e a situação de cada uma estão no **Fechamento da FASE 5**, no fim desta fase (itens A1 e A2), onde fica a lista única do que falta.

##### 🔍 Ponto de Revisão — FASE 5 (2/2 — fim, fecha v5.5–v5.7)

✅ **FECHADO em 2026-10-20, com o OK do Presidente** (revisão feita em 2026-10-16; os dois achados viraram a v5.7e e a v5.7f, em produção desde 2026-10-19).

Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:

- Todos os formulários públicos (v5.5) caem na mesma fila única de atendimento — testar que nenhum vira e-mail solto por fora do sistema.
- Headers de segurança (v5.7) presentes de fato na resposta HTTP do site em produção.
- Voluntário não associado consegue ser escalado; evento cancelado aparece como **cancelado** (não some).
- Verificação independente de fatos das páginas novas e alteradas.

  **Estado em 2026-10-15 (o Ponto só fecha com a v5.6):** headers de segurança presentes na resposta de produção ✔ (v5.7); formulários públicos na fila única ✔ (v5.5a/b); voluntário não associado
  escalado ✔ (v5.5b); evento cancelado aparece como cancelado ✔ (v5.5d); verificação independente de fatos feita para a declaração de acessibilidade (2 passagens) e para os textos de inscrição em evento,
  situação do evento e Política de Privacidade (ver o item da conferência, abaixo); **pendente:** v5.6 (doação online com Pix estático e conta de visitante), v5.7b (rotina de retenção) e v5.7c (foto da Diretoria).
  **Atualização de 2026-10-16:** v5.6a, v5.6b, v5.7b, v5.7c e v5.7d estão feitas e em produção; os itens do checklist acima seguem ✔ (a conta de visitante e os
  formulários passam pela mesma fila de atendimento quando é pedido de titular); falta só rodar o Ponto de Revisão (2/2) como revisão formal.

  **Revisão de 2026-10-16 (v5.5a a v5.7d: 69 commits, de `d6034d9^` até `d090e3b`) — checklist da seção 4.1.** A leitura de código e plano foi feita por um agente SEPARADO, só leitura
  (não ancorado na minha conclusão); os itens que dependem de rodar coisas (2, 4, 9, 12) foram feitos por mim. Resultado:
  1. **`[x]` implementado e testado — OK**, com um texto corrigido: o "Feito" da v5.5b dizia que a data de nascimento do pedido de voluntariado era copiada "com teste" para quem já estava no
     cadastro; na verdade só é copiada quando a pessoa entra no cadastro DEPOIS do pedido (`cadastrar_voluntario`); quando o pedido já chegou ligado pelo CPF, o servidor segue pedindo a autorização do
     responsável a quem não tem data de nascimento (seguro, mas trava um adulto até a data entrar no cadastro). Texto da v5.5b corrigido; o comportamento fica como **aberto** (abaixo). Faltava o teste da
     migração da v5.6b: criado (`tests/test_migracao_conta_de_visitante.py`).
  2. **Testes — OK:** suíte do servidor 1267 em duas rodadas seguidas; site 744 unitários + 846 de navegador; painel 629; robôs da homologação verdes (v5.5a-01 6, v5.5b-01 4, v5.5a-02 7, v5.7b-01 2,
     v5.7b-02 2, v5.6b-01 6, v5.6b-02 4, mais as regressões da v5.6b).
  3. **Decisões congeladas — OK** (nenhuma violada: banco, framework, MFA e JWT intactos; a sessão do visitante é um mecanismo à parte e não abre o painel). Ressalva baixa: o responsável padrão da fila
     é escolhido pelo NOME do nível "Presidente" (decisão do Presidente de 09/10, `app/services/atendimento.py::responsavel_padrao`); não é checagem de permissão (a fila usa `exigir_permissao`).
  4. **Segredos — OK:** varredura das 48.581 linhas adicionadas no intervalo (chave privada, AKIA, tokens do GitHub, `sk-`, `AccountKey=`, SAS, URL de banco com senha, JWT, atribuição de segredo
     longo): nenhum achado real (o único acerto é um token falso, `sessao-que-nao-existe`, dentro de um teste); o revisor também não achou segredo em texto claro nos diffs.
  5. **Auditoria — OK, com um achado corrigido:** toda rota que muda dado do intervalo grava (atendimento, doação, inscrição pública, situação do evento, foto da Diretoria, retenção, conta de
     visitante); a rotina que expira pedidos de doação NÃO gravava: agora grava `INTENCOES_DE_DOACAO_EXPIRADAS` (SISTEMA, só a contagem, e nada quando não há o que expirar). Pedir o código e sair não
     gravam, de propósito (não mudam dado pessoal).
  6. **Permissão no backend — OK:** atendimento, financeiro (doações), projetos (situação do evento, voluntários) e governança (foto) por permissão; as públicas estão em `/api/publico/` ou na lista
     `ABERTAS_DE_PROPOSITO`, cada uma com razão e limite; `/api/visitante/*` exige a sessão do visitante. **Para o Presidente decidir:** o nível "Conselho Fiscal" recebe a permissão `financeiro` por
     padrão (`app/database.py`, anterior ao intervalo), então pode confirmar doação do site, e a decisão de 07/10 diz que o Conselho tem a Auditoria própria e não opera o Financeiro.
  7. **Escopo — OK, com notas cruzadas acrescentadas:** a v5.5a, a v5.7 e a v5.7b entregaram partes de itens da FASE 7 e da v9.1 que seguiam `[ ]` sem nota; cada um ganhou a nota do que já existe e do
     que falta (encarregado, retenção como rotina real, canal único, headers, limite por IP, declaração de acessibilidade).
  8. **Plano × código — corrigido:** a v5.5c dizia "as três rotas novas" (só uma é nova: `GET /api/publico/inscricoes/{token}`), a v5.6a dizia "6 rotas" (são 7), a v5.6a ainda listava como aberto o que a
     v5.7b resolveu, a v5.6a ainda dizia que a área de doações era "da v5.6b" (feita), a v5.7b ainda listava a conta de visitante como sem regra e a tabela de temporalidade contava prazo do "último
     acesso" à conta (ela não guarda acesso).
  9. **Suíte completa — OK** (item 2).
  10/11. **Telas e links:** as telas do intervalo (Atendimento, Doações do site, foto no mandato, Regras do sistema, situação do evento, voluntário) foram usadas pelos robôs na homologação, com print,
     e o que elas oferecem para abrir (links de cancelar e confirmar, PDF do certificado, foto) foi aberto lá; em produção só se confirma por leitura (o MFA do painel está congelado, `DECISOES_CONGELADAS.md`
     §3.1). A conta do visitante é uma página do SITE, não do painel.
  12. **No ar — OK:** `main` igual ao remoto; Deploy API, Painel e Site verdes para cada commit de código; `asaf.org.br/version.json` bate com o último commit de código (`cbade9f`) e `painel.asaf.org.br/version.json` com o último que mexeu no painel (`6eaf9da`: o `cbade9f` só mudou roteiros de robô dele);
     as falhas vermelhas do dia são todas de robôs da homologação (nome de roteiro errado, ordem da cadeia, máquina sem memória), explicadas e resolvidas.
  **Específicos deste ponto:** (a) formulários na fila única — o revisor leu os 11 usos de `enviar_email` em `app/`: nenhum manda texto de visitante para a equipe (ela é avisada só pelo sino); os
  e-mails são recibos automáticos ao endereço digitado, avisos ao contato do cadastro e respostas da equipe; ✔. (b) cabeçalhos de segurança do site (CSP `default-src 'none'`, `frame-ancestors 'none'`,
  X-Frame-Options, nosniff, Permissions-Policy, COOP no build; o HSTS vem do Azure e o robô v5.7-01 o confere ao vivo) ✔. (c) voluntário não associado escalado ✔ (`test_voluntario_nao_associado.py`).
  (d) evento cancelado continua visível e marcado ✔ (`test_status_do_evento.py`, `situacao-do-evento.spec.ts`).
  **Achados da revisão corrigidos ANTES de fechar (branch → homologação → `main`, `cbade9f`):** (A1) o pedido de voluntariado era ligado, na chegada, à pessoa do cadastro com o mesmo CPF OU o mesmo
  e-mail (se fosse uma pessoa só): o painel pulava o cadastro e abria o termo no nome dela (o filho que escreve com o e-mail da mãe); agora o voluntariado só liga pelo CPF, e o e-mail único segue
  ligando os outros tipos, que só informam; (A2) a Política 2.2 dizia "não guarda dados no seu navegador", e a conta guarda a sessão no `sessionStorage`: o texto agora diz isso (e a Política continua em
  2.2: é correção do texto no mesmo dia); (A3) `infra/armazenamento-privado.sh` voltaria o soft delete dos blobs para 30 dias se alguém recriasse o armazenamento: agora diz 25, como está aplicado nas duas
  contas; (A7) a Auditoria da rotina de expirar (item 5); (A8) o aviso do formulário de voluntariado não dizia que a oferta aceita vira cadastro de voluntário (nome, CPF se informado, contato e data de
  nascimento): ganhou a frase e o aviso do atendimento passou à **versão 2** (o servidor recusa a 1); (A9) o teste da migração (item 1).
  **Abertos (o 1 e o 3 viraram a v5.7f e a v5.7e, em 2026-10-19):** (1) **solicitação de titular: a resposta vai para o e-mail digitado, sem verificar quem pede** (o CPF não é segredo): quem sabe o CPF de alguém pode
  pedir "acesso aos dados" e receber a resposta; a validação de identidade é da v7.2; até lá, quem atende confere o CPF mostrado dentro do pedido e o cadastro antes de mandar dado pessoal; (2) pedido de
  voluntariado ligado pelo CPF a quem não tem data de nascimento no cadastro continua exigindo a autorização do responsável (item 1); (3) o nível "Conselho Fiscal" com `financeiro` (item 6): decisão
  do Presidente; (4) o papel de dados do armazenamento foi conferido por leitura (`az role assignment list`): a identidade do GitHub tem "Storage Blob Data Contributor" em `fotos-associados` e em
  `fotos-diretoria` da produção e na conta inteira de teste. **Ponto de Revisão FASE 5 (2/2): REVISÃO FEITA em 2026-10-16, FECHAMENTO REABERTO em 2026-10-19:** o Presidente não autorizou o fechamento (o Ponto só fecha com o OK dele) e decidiu que os
  dois achados abertos não esperam a v7.2: viram a **v5.7e** (Conselho Fiscal audita sem operar) e a **v5.7f** (validar quem pede dado pessoal), itens A1 e A2 do **Fechamento da FASE 5** (fim desta fase). O Ponto (1/2) também segue esperando a
  conferência da diretoria contra a vedação do STF, que precisa de composição real. **Decisão de 2026-10-19 sobre dados de teste:** a homologação é para inventar dado (chave Pix, CNPJ, mandato,
  prazos, o que for preciso); nenhuma versão espera o Presidente preencher dado real, que ele cadastra depois, quando tiver tempo.

##### Decisões pendentes → onde cada uma será tratada (resposta do usuário em 2026-10-03)

> **Histórico de 2026-10-03.** O que ainda vale de tudo isto está no **Fechamento da FASE 5**, no fim desta fase.

| # | Decisão | Resposta | Onde / quando |
| --- | --- | --- | --- |
| 1 | Voluntário que não é associado | Quer que consiga se voluntariar ("outra situação") | v5.5 (refatoração do sistema); até lá a página diz a verdade |
| 2 | Cargos do sistema × Art. 19 | Sem resposta específica ("se precisa antes da revisão, tratamos") | **v5.4**, antes do Ponto de Revisão (1/2) |
| 3 | Encarregado LGPD e revisão jurídica | Idem | Revisão jurídica **antes do (1/2)**; encarregado **antes da v5.5** |
| 4 | Estatuto Art. 33, II: "II Crônicas" | **Confirmado: é I Crônicas** (o Estatuto errou) | **FEITO e verificado em produção (2026-10-03, commit `069c835`)**: nota editorial no site (a transcrição segue fiel), "I Crônicas" em Quem somos, seed e migração do sistema. Provas: `asaf.org.br/version.json` = `069c835`; `/estatuto/` traz `#nota-versiculos`; `/quem-somos/` diz "I Crônicas 4:9-10"; o log do Deploy API mostra `Running upgrade 9d4e1b7c2a60 -> c3f8a1d07b94` (a migração só troca o valor se ainda for o do seed) |
| 5 | Mapa com pino | Não agora; "fica para o futuro" | v5.7 (só com coordenadas exatas) |
| 6 | Notícias | Vai mandar o token | v5.3 |
| 7 | Inscrição em evento e "cancelado" | Será o "módulo de eventos" no futuro | v5.5 |
| — | Estatuto do site = versão registrada em cartório? "Sede provisória" omitida; Art. 34 cita "Conselho Administrativo" que o Art. 18 não lista; titularidade do logotipo (INPI) | Em aberto | O Estatuto/PDF registrado é necessário para a v5.4 (R5); o resto, backlog |

##### O que preciso do usuário (para não travar a v5.3 e a v5.4)

> **Histórico de 2026-10-03** (token, documentos e Despertai: a v5.3 e a v5.4 já foram entregues). O que ainda depende do Presidente está na seção D do **Fechamento da FASE 5**.

1. **Token** — pelo caminho seguro acima (nada de colar no chat).
2. **Documentos para a v5.4a** — **NÃO enviar ao Directus nem pelo chat**: guardar com cuidado (atas têm RG/CPF) até o
   módulo Documentos do sistema existir (v5.4a); aí entram pelo painel, original + versão pública. São eles (PDF; os
   escaneados passam por OCR antes): Estatuto registrado e alterações,
   ata de eleição da diretoria vigente, cartão CNPJ, balanços e relatório anual (quando houver),
   inscrições em conselhos municipais (quais?).
3. **Despertai** (R8): edições anteriores (datas, local, público atendido, fotos **com autorização dos
   responsáveis**) e o **documento** que comprove que integra o calendário oficial do município.
4. **Decisões**: prazo de resposta a pedidos de informação sobre recursos públicos; quem serão os
   editores e com qual papel (nomes e e-mails); se quer o teste de disponibilidade pago do Azure.

##### Riscos conhecidos deste desenho

- **Duas fontes para o dinheiro** (Directus publica; o livro-caixa da FASE 3 é a verdade contábil):
  podem divergir. Mitigação: regras de consistência no build, campo opcional `referencia_no_sistema`
  em parcelas e pagamentos e conferência mensal; a integração automática (a Transparência puxando o
  centro de custo da emenda, via view/API) fica para a FASE 12.7.
- **Directus acorda em ~34 s** e o build depende dele: mesma política da API (repetição, falha derruba o
  build, o site no ar não muda) e PDFs copiados para o site.
- **OCR**: o teste detecta PDF sem texto, mas não garante que o texto extraído esteja correto.
- **Um único administrador** no Directus até a v5.3 criar o de reserva.
- **Limite de tamanho do Static Web App** para PDFs: medir antes de crescer; plano B = contêiner Blob público.
- **Base legal**: o art. 17 da IN 06/2025/TCMPA foi conferido por mim no Diário Oficial; o resto veio de pesquisa
  (ver acima) e a **Lei Municipal 5.574/2025 segue não confirmada** — não citar no site. Revisão jurídica final
  continua sendo condição para publicar texto de lei na página.

#### 🧭 Fechamento da FASE 5 — a lista única do que falta antes de abrir a FASE 6 (organizada em 2026-10-19, a pedido do Presidente)

> **Por que existe:** a FASE 5 cresceu por versões (v5.0 a v5.7 e as v5.4c–h) e o que faltava ficou espalhado em itens `[ ]` antigos, em notas "Abertos" e "Falta". Em 2026-10-19 **cada `[ ]` da FASE 5 foi
> conferido contra o código, o plano e a produção** (leitura de `cms.asaf.org.br`, de `asaf.org.br` e dos arquivos). **Esta é a única lista que vale:** ao concluir um item, marca-se aqui **e** no bloco da
> versão dele. Nada abaixo foi decidido por mim: o que depende de decisão do Presidente está marcado **DECISÃO**. Regras da casa: uma versão por vez, na ordem; Ponto de Revisão só fecha com o OK dele;
> a FASE 6 só abre quando ele liberar.

**Resultado da conferência.** Eram 19 itens `[ ]` na FASE 5 (14 no corpo e 5 em citações). **9 só estavam sem marcar** (estão feitos; marcados agora, com a prova, na seção G); **1 foi adiado por decisão**
dele (mapa com pino, seção F); **9 continuam abertos de verdade** (A1, A2, B2, C1, C2, C6, C7, C9 e C10, abaixo). Há ainda o que estava **só escrito em notas** ("Falta", "Abertos") e nunca virou item:
B1 (o Ponto 2/2 reaberto), C3, C4, C5, C8 e C11 (achado novo de 2026-10-19).

**Atualização (2026-10-19, à noite):** a **A1 (v5.7e) e a A2 (v5.7f) estão concluídas e em produção** (registro abaixo). Por pedido do Presidente ("termina a fase 5"), seguem, uma versão por vez: a **v5.7g** (C4, C7, C11)
e depois a **v5.7h** (o que é do Directus: C1, C2, C3, C5, C9), e os itens C6 e C8 no fim.

**Atualização (2026-10-20, mais tarde): a FASE 5 está FECHADA.** O Presidente fechou os dois Pontos de Revisão (B1 e B2), deixou de lado o administrador de reserva e o MFA do Directus (C1 e C2), dispensou os testes
ao vivo dos perfis (C3) e aceitou fechar o C6 sem construir. A conferência contra a vedação do STF segue como condição para lançar os mandatos reais (D2). **A FASE 6 só abre quando ele liberar.**

**Atualização (2026-10-20, antes disso):** a **v5.7g (A3) e a v5.7h (A4) estão concluídas e em produção**. Dos itens C: **feitos** C4, C5, C7, C8, C9 e C11, e o e-mail do C1. **Sobram só atos do Presidente** (administrador
de reserva do Directus, MFA do administrador, contas de teste dos perfis: C1, C2 e C3, passo a passo no A4), **uma decisão** (C6, proposta de fechar) e o que já era dele (B1, B2 e a seção D). C10 é só acompanhamento.

##### A. Versões que faltam construir (uma por vez, nesta ordem)

- [x] **A1 — v5.7e — Auditoria como permissão SECUNDÁRIA do Financeiro (decisão do Presidente, 2026-10-19; achado do Ponto de Revisão 2/2).** "O Conselho Fiscal não opera o financeiro: ele audita." Hoje o
      nível Conselho Fiscal recebe a permissão geral `financeiro` (a que opera: confirmar doação, registrar saída, pagar título...) só para conseguir auditar. Passa a valer: cada módulo tem a permissão
      GERAL e as SECUNDÁRIAS; a primeira secundária é `financeiro_auditar` (ler o que a auditoria precisa e dar o parecer: lançamento certo ou errado, comprovante confere). O Conselho Fiscal perde o
      `financeiro` e ganha `financeiro_auditar` (mais a `auditoria` que já tem). No painel ele só vê o que audita, sem os botões de operar; o servidor recusa por trás. Uma migração tira o `financeiro` do
      nível Conselho Fiscal nos bancos que já existem. Provado na homologação com um usuário do Conselho Fiscal (vê e audita; é barrado ao tentar operar).
      **Na homologação (2026-10-19):** a branch `v57e-conselho-audita` foi publicada lá (a migração rodou primeiro no banco de TESTE). Robô `v5.7e-01`, 5 de 5, com as pessoas de teste: o Conselheiro tem
      `financeiro_auditar` e `auditoria` e **não** tem `financeiro`; no painel ele entra no Financeiro e o menu mostra **só** Conselho Fiscal, Auditoria financeira e Relatórios (sem Títulos, Registrar saída,
      Doações, Gerar Cobranças nem Compras), em Relatórios não há o botão de gerar a prestação de contas, e digitar o endereço de uma tela que opera dá "sem permissão"; o servidor responde **403** com o token
      DELE a seis operações (listar títulos, listar doações, cadastrar conta, confirmar doação, gerar a prestação, responder questionamento) e **200** a seis leituras da auditoria; o Tesoureiro segue com o módulo
      inteiro; o Secretário segue sem o módulo. **Regressão, tudo verde no código final:** `v5.4h-03` 8/8 (o Conselho decide títulos), `v5.4d-06` 16/16, `v5.4e-03` 12/12, `v5.4e-04` 16/16, `v5.4d-08` 7/7 e
      `v5.4h-08` 6/6. **Achados, corrigidos e refeitos:** (1) a página de Relatórios também lê os padrões suspeitos, os fechamentos e as contas financeiras, e o auditor era barrado: as leituras passaram a aceitar
      `financeiro` OU `financeiro_auditar` (só leituras; operar segue só com `financeiro`); (2) a delegação de aprovação do roteiro `v5.4e-03` ia para o Conselheiro, que não opera mais: passou para a 2ª Tesoureira
      (Gisele, com login de teste próprio no cofre); (3) o roteiro `v5.4e-04` agora **afirma** que o Conselheiro não gera a prestação de contas (antes era um defeito anotado); (4) o print da tela do Conselho
      Fiscal, que lista todos os títulos, estourava o navegador: o auxiliar cai para o print da parte visível (isso virou o item C11, a paginação dessa tela). **Testes locais:** servidor 1318 em duas rodadas
      seguidas, painel 640 (47 arquivos), tipos, lint e formatação limpos; testes novos do servidor, da migração e do painel.
      **Em produção (2026-10-19):** `main` = `e61bc0b`; Deploy API verde (1318 testes contra Postgres e o log mostra `Running upgrade e6b3c9d2f8a4 -> f7c4d0e3a915`, a migração que tira o `financeiro` do nível e do
      cargo Conselho Fiscal) e Deploy Painel verde; `painel.asaf.org.br/version.json` = `e61bc0b`; `asaf.org.br/version.json` segue `cbade9f` (o site não mudou); `openapi.json` da API responde. O efeito da migração
      só se lê pelo log, porque olhar o painel pede login com MFA (congelado). Nota: o Deploy API ficou cerca de 30 minutos "em andamento" sem passos na tela do GitHub e terminou sozinho com sucesso.
- [x] **A2 — v5.7f — Validar quem pede dado pessoal: a solicitação do titular (decisão do Presidente, 2026-10-19; achado do Ponto de Revisão 2/2).** Hoje a resposta vai por e-mail para o endereço digitado,
      sem conferir que quem pede é a pessoa (o CPF não é segredo). Passa a valer: (1) a resposta com dado pessoal NUNCA vai solta por e-mail: o e-mail só avisa que há resposta, e ela aparece na
      **Minha conta**, depois de a pessoa provar o e-mail com o código; (2) o sistema só deixa a equipe responder depois de a **identidade estar validada**: automaticamente, quando o e-mail digitado
      é o do cadastro daquele CPF, ou à mão, pela equipe, com um registro do que foi conferido (a Auditoria guarda quem e quando); (3) o painel mostra no pedido se a identidade está validada e como.
      Provado na homologação (pedido de quem tem cadastro, de quem não tem, e de quem digita o CPF de outra pessoa).
      **Feito (2026-10-19):** (a) a solicitação do titular exige **e-mail** (a API recusa só telefone, o formulário do site também; os outros pedidos seguem aceitando só telefone); (b) a identidade nasce
      **validada sozinha** só quando o e-mail digitado é o do cadastro de **associado** daquele CPF (e a inscrição pública nunca escreve e-mail em quem é associado, nem vale e-mail que uma inscrição pública
      digitou); nasce validada também quando o pedido é aberto **dentro da Minha conta** (o e-mail já foi provado por código); nos outros casos a equipe valida **à mão**, escrevendo o que conferiu (de 10 a
      500 letras, uma vez, só com o pedido aberto); (c) o servidor **recusa responder** sem a identidade validada (e sem e-mail); (d) a resposta **não vai por e-mail**: o e-mail só avisa (tentativa registrada em
      `resposta_enviada_por_email`) e a resposta, ou o motivo do encerramento, é lida na **Minha conta** (o pedido do titular também abre a conta, com a mesma resposta de sempre para quem tem e não tem vínculo);
      encerrar uma solicitação sem responder avisa a pessoa e o motivo aparece lá (só o escrito já sabendo disso: coluna `motivo_visivel_ao_titular`); (e) o painel mostra o cartão "Identidade de quem pediu"
      (validada sozinha, pelo código ou pela equipe, com quem e o quê) e trava a resposta até validar; (f) a Auditoria guarda quem validou, quando e como, sem o texto da nota (que a retenção apaga com o pedido);
      (g) Política **2.3** com o parágrafo `data-identidade-do-titular`; página da solicitação com a seção "Como a resposta chega até você"; migração `b9e2c5a7d014` (5 colunas, nenhuma preenchida nos
      pedidos que já existem).
      **Conferência independente (agente `opus`, só leitura) achou e corrigi antes de publicar:** (1) quem só sabia o CPF de um associado **sem e-mail no cadastro** se inscrevia num evento público com o próprio
      e-mail, a inscrição gravava esse e-mail no cadastro dele e a validação automática o aceitava (agora a inscrição não escreve contato em associado e a validação ignora e-mail digitado em inscrição pública
      da pessoa); (2) a resposta sumia da Minha conta se o pedido fosse encerrado depois de respondido; (3) pedido antigo, respondido por e-mail, aparecia como "Em andamento"; (4) o motivo de encerramento antigo
      (nota interna) podia aparecer para o dono do e-mail; (5) o aviso de encerramento não deixava registro quando o e-mail falhava; e quatro frases dos textos públicos que prometiam mais do que o código garante
      ("a ASAF só vai para quem prova", "avisamos", "ninguém lê", "encerra o pedido").
      **Na homologação (2026-10-19):** a branch `v57f-identidade-do-titular` foi publicada lá (a migração rodou no banco de TESTE). Robô `v5.7f-01`, 5 de 5: a associada de teste cadastrada **pela tela**; a API recusa
      titular sem e-mail; a dona pede com o e-mail do cadastro (nasce validada, a tela diz, a Auditoria guarda sem usuário, a equipe responde pela tela e ela lê na Minha conta); o **intruso** digita o CPF dela com o e-mail
      dele (por validar, tela e servidor travam a resposta com 400, ele não vê dado nenhum, o pedido é encerrado com o motivo e a conta da dona nem o lista); a dona pede com **outro** e-mail (a equipe valida pela tela;
      nota curta é recusada; a Auditoria guarda quem e como sem o texto; a resposta destrava e aparece lá); o pedido de eliminação aberto dentro da Minha conta já nasce validado; encerrar depois de responder mantém a
      resposta. Robô `v5.7f-02` (o `hml-site`), 4 de 4: a página explica o caminho em 3 passos e exige o e-mail, a confirmação diz que a resposta não vai por e-mail, a Minha conta mostra os três pedidos (resposta como
      TEXTO, nunca HTML; em andamento; encerrado com o motivo), Política 2.3. Regressões verdes: `v5.5a-01` 6, `v5.5a-02` 7, `v5.5b-01` 4, `v5.6b-01` 6, `v5.6b-02` 4, `v5.7b-01` 2, `v5.7b-02` 2, `v5.7c-02` 2 (os
      robôs `v5.5a-01` e `v5.5a-02` mandavam a solicitação do titular só com telefone, e `v5.7b-02`/`v5.7c-02` fixavam "Versão 2.2": ajustados). Testes: servidor 1346 em duas rodadas seguidas (28 novos, cada
      garantia confirmada por mutação), painel 660, site 747 unitários e 847 de navegador, tipos, lint e formatação limpos.
      **Em produção (2026-10-19):** `main` = `d399163` (API e painel) e `fc42046` (site). Deploy API verde (1346 testes contra Postgres e o log mostra `Running upgrade f7c4d0e3a915 -> b9e2c5a7d014`); Deploy Painel
      verde, `painel.asaf.org.br/version.json` = `d399163`; `openapi.json` da API traz `/api/atendimentos/{id_atendimento}/validar-identidade`; `asaf.org.br/version.json` = `fc42046`, com `/privacidade/` em "Versão 2.3"
      e o parágrafo novo, `/privacidade/solicitacao-do-titular/` com a seção "Como a resposta chega até você" e `/minha-conta/` com "Meus pedidos sobre dados pessoais". O primeiro Deploy Site falhou: dois testes de
      navegador **antigos** tinham corrida (um lia o protocolo da doação e o outro digitava o código antes de a página terminar; já falhavam por sorte no CI); foram corrigidos, repetidos 8 vezes sem falhar, e o
      deploy seguinte passou. Produção não recebeu nenhum dado de teste.
      **Limitações conhecidas:** a validação automática só vale para associado (quem é só participante de evento passa pela equipe, de propósito); pedidos de titular **de antes** da v5.7f aparecem na Minha conta como
      "Respondido" sem o texto (a resposta foi por e-mail) e os encerrados antigos sem o motivo; a validação à mão depende de a equipe conferir de verdade (o sistema só exige o registro do que foi conferido).

- [x] **A3 — v5.7g — As pontas do painel e da transparência (C4, C7 e C11; pedido do Presidente, 2026-10-19: "termina a fase 5").** (1) **C11:** a leitura do Conselho Fiscal (títulos e livro-caixa) é
      **paginada, com busca** (25 por página; o servidor aceita `busca`, `pagina` e `por_pagina` e devolve o total), e a tela tem "anterior/próxima" e o campo de busca: deixa de estourar com muitos títulos;
      (2) **C4:** o atalho "Editar o site" tem **permissão própria**, `editar_site` (antes usava `gerenciar_acesso`, a da Presidência); a migração `c4a8e2f6d913` a dá a todo nível e a todo cargo que já tinha
      `gerenciar_acesso` (nada some), e a secretaria ou a comunicação pode recebê-la pela tela Níveis e permissões sem ganhar poder sobre o acesso do sistema; (3) **C7:** a página **Doar** mostra, por
      campanha, o **APLICADO** (o total já gasto no centro de custo da campanha: despesas líquidas do razão, o estorno subtrai) ao lado do recebido; campanha sem centro de custo diz que o gasto dela não é
      acompanhado à parte. Só o total sai: nenhum lançamento, fornecedor ou data.
      **Na homologação (antes de ir à produção):** a branch `v57g-painel-e-transparencia` foi publicada lá (a migração rodou no banco de TESTE). Robôs `v5.7g-01` (painel), 4 de 4, e `v5.7g-02` (o `hml-site`), 1 de 1;
      regressões verdes: `v5.4e-04`, `v5.4d-06`, `v5.4d-08`, `v5.7e-01`, `v5.6a-01`, `v5.6a-02` e `v5.4c-fase0` (os roteiros `v5.4d-06`, `v5.4e-04` e `v5.6a-01` foram ajustados para a leitura paginada e
      para o aplicado). Testes locais: servidor 1363 em duas rodadas seguidas, painel 670, site 749 unitários e os de navegador; testes novos do servidor (com mutação), da migração, do painel e do site.
      **Em produção (2026-10-20):** `main` = `82119bc`; Deploy API verde (1363 testes contra Postgres e o log mostra `Running upgrade b9e2c5a7d014 -> c4a8e2f6d913`), Deploy Painel e Deploy Site verdes;
      `painel.asaf.org.br/version.json` e `asaf.org.br/version.json` = `82119bc`; o `openapi.json` da API traz `busca`, `pagina` e `por_pagina` nas leituras do Conselho Fiscal (títulos, livro-caixa e
      auditoria) e a página `/como-ajudar/doar/` traz a explicação do "aplicado". O campo `valor_aplicado` só aparece com campanha em andamento e a doação está fechada (sem campanha), então ele não pôde ser
      lido em produção; a produção não recebeu nenhum dado de teste.

- [x] **A4 — v5.7h — As pontas do Directus (C1, C5, C8 e C9; o Presidente deu a permissão em 2026-10-20: "você pode mexer nesse negócio de e-mail, chave, acrescentar esses campos, testar").** Feito no
      que cabe ao sistema; o que sobra são **atos que só o Presidente pode fazer** (administrador de reserva, MFA do administrador e contas de teste dos perfis: o passo a passo está no fim deste item e em C1, C2 e C3).
      (1) **C1, o e-mail:** o script `infra/directus-email.sh` ligou o e-mail do Directus (`asaf-directus`) ao mesmo e-mail da associação que a API já usa: os segredos `SMTP-*` do Key Vault viram segredos
      do Container App, referenciados por `secretref`, como no `asaf-api` (nenhum valor aparece no script nem no Git). A nova revisão subiu saudável; o login no servidor de e-mail foi aceito (a conexão e o
      login, sem enviar nenhuma mensagem) e um pedido de "esqueci a senha" de teste foi disparado ao endereço do administrador, para o Presidente conferir a caixa de entrada. (2) **C5, notícia ↔ emenda:** o
      campo opcional "Número da emenda" (`emenda_id`) foi acrescentado à coleção `noticias` do Directus (`aplicar --producao` criou só esse campo e `verificar --producao` diz "conforme o modelo"); no site, a
      notícia ligada mostra "Sobre a emenda …" e a página da emenda lista "Notícias sobre esta emenda"; número que não existe, de parceria que **não** é emenda ou de emenda ainda não pública **não** tira a notícia
      do ar (vai sem a ligação e o resumo do deploy avisa, em português); no painel, o alto da página da emenda mostra "Nº da emenda: N", o número que o editor digita (só as emendas; termo de fomento não mostra).
      (3) **C8, o ciclo de vida das fotos:** conferido na homologação, contando versões (`az storage blob list --include dv`): `fotos-diretoria` com 6 itens, **0 versões antigas vivas** e 5 na lixeira
      (a mais recente apagada em 2026-10-17); `fotos-associados` com 15 itens, **0 versões antigas vivas**; `fotos-eventos` e `fotos-etapas` sem histórico de versões. A regra apaga a versão antiga um dia
      depois de criada e funciona. (4) **C9, a chave da conta de armazenamento do Directus:** a conta `stasafarcadafamilia` guardava um segundo contêiner (`documentos-institucionais`) que estava vazio e sem uso
      desde que os documentos passaram para o sistema; foi removido (e tirado do `infra/provisionar.exemplo.sh`). A conta ficou só com o contêiner `uploads` (1 arquivo), de modo que a chave de conta inteira, que o
      Directus exige (o driver de armazenamento dele só aceita a chave da conta), **só alcança o que o próprio Directus guarda**. Não há mais dado do sistema ao alcance dessa chave.
      **Na homologação (antes de ir à produção):** a branch `v57h-directus-fecha-as-pontas` foi publicada lá. Robô `v5.7h-01`, 3 de 3: a emenda cadastrada **pela tela** mostra "Nº da emenda: N" igual ao do
      endereço da página, o número persiste ao reabrir e a emenda em rascunho **não** está na lista pública, e o termo de fomento cadastrado ao lado **não** mostra o número. Regressões verdes: `v5.4g-03` 8/8
      (parcerias e emendas, o módulo inteiro), `v5.4g-05` 6/6 (o site reconstruído com a emenda aprovada) e `v5.4c-fase0` 6/6. O site de teste não tem Directus (por decisão), então a notícia ligada à emenda é
      provada pelo servidor de teste do site: 761 testes unitários e a suíte inteira de navegador (uma notícia ligada à emenda mostra o link e a emenda lista a notícia; a ligação quebrada, inclusive a de um termo de fomento,
      sai sem link e sem quebrar a página; o site também constrói quando o Directus ainda não tem o campo) e o build contra a "API antiga". Testes locais: servidor 1363 em duas rodadas seguidas, painel 671,
      modelo do Directus 45, tipos e formatação limpos. O primeiro robô falhou duas vezes por defeito do próprio roteiro (cada cenário abre a própria página e precisa entrar de novo; o rótulo "Tipo" envolve
      as opções), corrigidos e refeitos; o `v5.4g-05` falhou uma vez só porque o site de teste precisava ser republicado depois de o `v5.4g-03` publicar a emenda (a ordem de sempre).
      **Em produção (2026-10-20):** `main` = `1f771d7`; Deploy Painel e Deploy Site verdes (o build do site lê o Directus pedindo o campo novo e passa); `painel.asaf.org.br/version.json` e `asaf.org.br/version.json` =
      `1f771d7`; `directus_configurar.py verificar --producao` "conforme o modelo" (com `noticias.emenda_id`). A API não mudou (nenhum arquivo dela) e a produção não recebeu nenhum dado de teste. A ligação em si
      só se vê com uma emenda aprovada e uma notícia ligada a ela, que ainda não existem em produção; o número aparece no painel de qualquer emenda.
      **O que só o Presidente faz (passo a passo, no Directus em `cms.asaf.org.br`):** (a) **administrador de reserva (C1):** Diretório de usuários → convidar → e-mail de uma pessoa de confiança → papel
      "Administrator"; o convite agora chega por e-mail; (b) **MFA do administrador (C2):** primeiro ligue o seu, em seu perfil → "Autenticação de dois fatores" (leia o QR com o aplicativo autenticador e digite o
      código); só depois, em Configurações → Políticas de acesso → "Administrator", ligue "Exigir autenticação de dois fatores" (as políticas dos editores já exigem); (c) **teste ao vivo dos perfis (C3):** convide
      uma conta de teste (um e-mail seu) para cada perfil (Redator, Colaborador de mídia, Editor de conteúdo), entre com ela e confira o que ela vê e não vê; depois apague as contas de teste. Eu não crio contas
      nem mudo configuração de segurança, nem em produção nem a pedido: é regra minha.
      **Decisão do Presidente (2026-10-20):** (a), (b) e (c) ficam de lado por enquanto (ver C1, C2 e C3). Conferiu que o e-mail de teste do Directus chegou; o pedido de teste não troca nenhuma senha (só trocaria se
      alguém clicasse no link do e-mail), e a senha do administrador segue a mesma.

##### B. Pontos de Revisão (só o Presidente fecha)

- [x] **B1 — Ponto de Revisão FASE 5 (2/2): FECHADO em 2026-10-20, com o OK do Presidente** (antes: reaberto). A revisão foi feita em 2026-10-16 (texto acima, no bloco do Ponto); o fechamento foi **reaberto em 2026-10-19** porque o Presidente não autorizou e decidiu que dois
      achados viram a v5.7e e a v5.7f. Só volta a "revisão feita, aguardando o OK do Presidente" depois de A1 e A2, e só fecha com o OK dele.
      **Fechado em 2026-10-20:** A1 e A2 estão em produção e o Presidente disse, na conversa, para fechar os pontos de revisão.
- [x] **B2 — Ponto de Revisão FASE 5 (1/2): FECHADO em 2026-10-20, por decisão do Presidente** (antes: resta uma única pendência) (todo o resto da lista foi conferido na homologação; ver o bloco do Ponto): a **conferência da diretoria contra a vedação do STF de 15/01/2026**
      (parentes de parlamentar). Só se faz com a composição real da diretoria, que ainda não está cadastrada (hoje só o Presidente). Passa a ser **condição para lançar os mandatos reais** (D2), não para continuar
      as versões. **DECISÃO:** o Presidente já decidiu abrir a v5.5 com ela pendente (2026-10-09); falta dizer se a FASE 5 pode fechar com ela registrada como condição do lançamento dos mandatos reais.
      **Decidido em 2026-10-20:** sim. O Presidente disse que a conferência é da diretoria ("quem faz é a gente"), com a composição real, que ele ainda não pode cadastrar porque o sistema não está pronto para receber
      essas pessoas, e mandou fechar. A conferência segue como **condição para lançar os mandatos reais** (D2), feita por quem cadastra; ela **não** foi dada por feita.

##### C. Itens de versões antigas que continuam abertos (a construir ou a conferir)

| # | Item | Origem | Situação em 2026-10-19 |
| --- | --- | --- | --- |
| C1 | **E-mail do Directus (SMTP)** para convite de editores e recuperação de senha, **e administrador de reserva** | v5.3 (`[ ]` na lista) | **E-mail feito na v5.7h (2026-10-20), item A4** (`infra/directus-email.sh`; revisão saudável; login no servidor de e-mail aceito). **O administrador de reserva ficou de lado por decisão do Presidente (2026-10-20: "deixa quieto por enquanto").** Risco registrado: hoje há 1 administrador; perdida a senha, recupera-se por SQL. Quando ele quiser, é convidar uma pessoa de confiança (o convite já vai por e-mail) |
| C2 | **MFA obrigatório do administrador do Directus** (`enforce_tfa`) | v5.3 (`[ ]` na lista) | **Adiado por decisão do Presidente (2026-10-20: "deixa quieto por enquanto").** É o login do **Directus**, não o do painel (o MFA do painel é decisão congelada e não muda). Lido em 2026-10-20: as políticas dos editores (Redator, Colaborador de mídia, Editor de conteúdo) **já exigem** MFA; a do Administrador não, e o único administrador ainda não ligou o dele. O token de administrador é estático, então a automação não quebra. Quando ele quiser ligar: passo a passo no A4 (mudar configuração de segurança é ato dele, não meu) |
| C3 | **Teste ao vivo dos demais perfis do Directus** (Redator, Colaborador de mídia, Editor de conteúdo, Editor de transparência) com usuários de teste | v5.3 ("Falta") | **Dispensado por decisão do Presidente (2026-10-20):** ele não vai criar contas de teste e confia no que foi construído. Só o Leitor do site foi provado ao vivo; os outros estão provados pelos testes do modelo (45) e pelo `verificar --producao` (as permissões de produção são as do modelo, inclusive MFA exigido nos três perfis de editor). O Directus local de teste não serve: a licença dele não permite regras de permissão personalizadas |
| C4 | **Atalho "Editar o site" com permissão própria `editar_site`** (hoje usa `gerenciar_acesso`) | v5.1/v5.3 ("Falta") | **Feito na v5.7g (2026-10-20), item A3:** permissão `editar_site`; a migração `c4a8e2f6d913` a deu a quem já tinha o atalho |
| C5 | **Notícia ligada a uma emenda** | v5.3 ("Falta") | **Feito na v5.7h (2026-10-20), item A4:** campo `emenda_id` no Directus, "Sobre a emenda" na notícia, "Notícias sobre esta emenda" na página da emenda e o "Nº da emenda" no painel |
| C6 | **Coleções do Directus além de Notícias**: textos de página, banners da Home, galeria, FAQ, depoimentos, parceiros | v5.1 (`[ ]` na lista) | **Fechado sem construir, por decisão do Presidente (2026-10-20: "proponho fechar sem fazer. Ok").** Só a coleção `noticias` existe (conferido em `scripts/directus_modelo.py`), e nenhuma página do site lê as outras coleções: criar a coleção sem a página que a lê seria um editor que não muda nada. Os textos das páginas estão no código do site (v5.2) e só mudam por mim, depois de conferidos contra o Estatuto e o código (regra do Presidente para texto público). Cada tema vira versão própria quando ele pedir o editor daquele texto |
| C7 | **Transparência do destino por campanha (o APLICADO)**: arrecadado e aplicado puxados do centro de custo real | v5.6a/v5.7b (`[ ]` na lista) | **Feito na v5.7g (2026-10-20), item A3:** a página Doar mostra o RECEBIDO e o APLICADO (centro de custo real) por campanha. A integração automática da Transparência segue na FASE 12.7 |
| C8 | **Conferir o efeito da regra de ciclo de vida das fotos** sobre uma versão real | v5.7d ("Abertos", 1) | **Feito na v5.7h (2026-10-20), item A4:** conferido na homologação; 0 versões antigas vivas nas fotos da Diretoria e dos associados, 5 apagadas na lixeira de 25 dias |
| C9 | **Chave da conta de armazenamento inteira no Directus** (`STORAGE_AZURE_ACCOUNT_KEY` da conta `stasafarcadafamilia`) em vez de conta própria ou SAS do contêiner `uploads` | v5.0 (citação com `[ ]`) | **Feito na v5.7h (2026-10-20), item A4:** a conta do Directus só tem o contêiner `uploads` (o vazio `documentos-institucionais` foi removido); a chave de conta inteira, que o Directus exige, só alcança o que ele mesmo guarda |
| C10 | **Acompanhar** a nota de saúde do Directus (`warn` por tempo de resposta do Postgres, banco Burstable) | v5.0 (citação com `[ ]`) | Só acompanhamento; na versão 12 o `/server/health` exige login, então é lido pelo painel do Directus |
| C11 | **Tela do Conselho Fiscal lista todos os títulos sem paginação** | achado dos robôs na v5.7e (2026-10-19) | **Feito na v5.7g (2026-10-20), item A3:** títulos e livro-caixa do Conselho Fiscal paginados, com busca |

##### D. Dado real que só o Presidente tem (não trava nenhuma versão: a homologação usa dado inventado; ele cadastra depois)

1. **Chave Pix** (e nome e cidade do Pix) e marcar "vai para o site" em Instituição: abre a doação online (hoje FECHADA).
2. **Mandatos reais** da Diretoria e do Conselho Fiscal (painel → Mandatos), depois da conferência do STF (B2), que é feita por quem cadastra, com a composição real, e não pelo sistema nem pela IA; o nome e a foto aparecem no site em cerca de 30 minutos.
3. **Dados da Instituição** (CNPJ, telefone, e-mail, horário, redes) marcados "vai para o site".
4. **Despertai**: o projeto com o texto real (nada foi inventado sobre ele), a edição como evento ligado a ele, e o documento que comprove o calendário oficial do município.
5. **Tabela de prazos de guarda** (proposta minha, em Configurações, com piso de 30 dias): ajustar se quiser.

##### E. Limitações conhecidas (consequência de uma decisão ou trade-off já escrito; sem item a construir)

- A foto de cadastro de associado já emitida segue abrindo por `/uploads/fotos/<uuid>` a quem já tem o endereço (a verificação do QR não o entrega mais); regravar cada foto com nome novo é uma opção (v5.7d).
- A foto da Diretoria apagada leva **horas** para sair do site (o GitHub atrasa o agendamento); melhoria possível: a rotina disparar a publicação do site quando apagar uma foto (v5.7d).
- Pedido de voluntariado ligado pelo CPF a quem não tem data de nascimento no cadastro continua exigindo a autorização do responsável, até a data entrar no cadastro (v5.5b).
- O Pix feito sem se identificar não deixa registro: a tesouraria o vê no extrato do banco e o registra à mão (v5.6a). O e-mail do pedido, do recibo e do código é só tentativa, e o site diz isso.
- A inscrição feita pela secretaria (sem e-mail digitado no site) não aparece na conta do visitante (decisão de segurança dita na Política); quem sabe o CPF de uma pessoa ainda pode reinscrevê-la em evento em que
  a inscrição dela está cancelada (anterior à v5.6b); e os trade-offs da conta do visitante (bloqueio de 1 hora, dois cliques abrindo 2 pedidos de eliminação) estão no bloco da v5.6b.
- O primeiro código real de conta de visitante só sai quando houver inscrição em evento ou pedido de doação com e-mail em produção (ainda não há evento público).

##### F. Adiado por decisão (não bloqueia a FASE 6) e o que é de outra fase

- **Mapa com pino** na página Contato: só com coordenadas exatas da diretoria (decisão do Presidente, 2026-10-03: "fica para o futuro").
- **Tamanhos responsivos (`srcset`) das fotos:** hoje cada foto sai num tamanho só (WebP de até 1280 px); melhoria futura.
- **FASE 7 (não é FASE 5):** regra automática de retenção para inscritos em evento, voluntários, certificados e para o IP da Auditoria (v5.7b); o restante do processo de resposta ao titular (a parte de **validar quem
  pede** é a v5.7f, A2).

##### G. Só faltava marcar (marcado agora, com a prova)

| Item que estava `[ ]` | Prova |
| --- | --- |
| Flow do Directus que dispara a publicação do site (v5.0) | Resolvido de outro jeito: o fluxo `sincronizar-site.yml` roda **de 15 em 15 minutos** e reconstrói o site quando a API **ou** o Directus mudou (v5.3, "sincronização real em CI"); o receptor de disparo continua pronto. Um Flow só adiantaria de uns 15 minutos para segundos; se o Presidente quiser publicação instantânea, vira item novo |
| Chave de automação do Directus no Key Vault (v5.0) | Resolvido de outro jeito (2026-10-03, decisão do usuário): o token de administrador fica **cifrado** em `CREDENCIAIS_AZURE.md` (SOPS), lido só em memória; `aplicar --producao` rodou assim |
| Directus 12.4.1 e licença (v5.0) | Imagem `12.4.1` no ar desde 2026-10-01; licença aplicada em 2026-10-03 (`license.source = settings`, "OIG"), as 8 permissões que dependiam dela criadas, `verificar --producao` limpo |
| Usuário de serviço e token só de leitura do site (v5.0) | `criar-leitor --producao`; token no Key Vault (`DIRECTUS-SITE-TOKEN`); autoteste em produção: lê notícias, não cria (403), não lista usuários |
| Fluxo editorial: rascunho → revisão → publicado, agendamento, histórico (v5.1) | Feito na v5.3 e provado ao vivo (rascunho e agendada não chegam ao leitor do site) |
| Papéis do Directus (v5.1) | 5 perfis criados em produção, nenhum com acesso de administrador (v5.3). Restam C3 e C4 |
| Biblioteca de mídia com texto alternativo obrigatório (v5.1) | Feito na v5.3 para a foto da notícia (único uso hoje): texto alternativo e autorização de imagem obrigatórios, foto em WebP. O `srcset` está em F |
| Páginas essenciais (v5.2) | As 16 páginas respondem 200 em `asaf.org.br` em 2026-10-19 (início, quem somos, diretoria, projetos, notícias, eventos, transparência, como ajudar, seja voluntário, seja associado, contato, privacidade, termos, estatuto, acessibilidade, minha conta); o mapa com pino está em F |
| Verificação do Directus em produção (v5.3) | `isolar_directus.py verificar` na produção, só leitura, em 2026-10-08 ("o Directus não alcança nenhuma tabela do sistema") e `directus_configurar.py verificar --producao` "conforme o modelo"; em 2026-10-19, `GET cms.asaf.org.br/items/paginas` e `/items/noticias` **sem token = 403** e `server/ping` 200; rascunho fora do site e token só de leitura: testes do modelo e do site |

##### H. Quando a FASE 5 fecha

A FASE 5 só é dada por fechada quando: **A1 e A2** estiverem em produção e provadas na homologação; **B1** tiver o OK do Presidente; **B2** tiver o destino decidido por ele; e cada item de **C** estiver
feito ou levado por decisão dele para outra fase (com a nota no lugar). **D** e **E** não bloqueiam. Só depois disso a FASE 6 (Comunicação) pode abrir, e só quando ele liberar.

✅ **FASE 5 fechada em 2026-10-20.** A1 a A4 estão em produção; B1 fechado com o OK do Presidente; B2 com o destino decidido (a conferência do STF é condição dos mandatos reais, feita por quem cadastra); cada item de C
está feito ou foi decidido por ele (C1 e C2 de lado por enquanto, C3 dispensado, C6 fechado sem construir; C10 é só acompanhamento). **A FASE 6 só abre quando ele liberar.**

---
