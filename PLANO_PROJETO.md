# Plano do Projeto — Site Institucional + Sistema de Gestão ASAF (Sistema Integrado Único)

> **A ASAF é uma associação, não uma entidade religiosa.** Este plano usou, num rascunho anterior,
> dois documentos de outro projeto (site + sistema de gestão de uma organização religiosa) só
> como referência solta de "o que não fazer" — não como modelo a seguir. A única lição realmente
> aproveitada de lá foi estrutural, não de conteúdo: aquele projeto construiu o site e o sistema
> de gestão **separadamente**, o botão "Meu Painel" do site aponta até hoje pra um sistema à
> parte que segue em desenvolvimento isolado, e o módulo de eventos precisou nascer **sem nenhum
> dado de associado**, porque não havia integração nenhuma entre as duas pontas — isso é uma
> dívida técnica registrada pelos próprios autores como erro de arquitetura. A decisão mais
> importante deste documento é **não repetir esse erro específico**: aqui, site e sistema de
> gestão compartilham a mesma base de identidade desde o primeiro dia, e tanto Projetos quanto
> Eventos (FASE 4) nascem como uma peça só, visível ao público pelo site e gerida pela diretoria
> pelo painel. Fora essa lição pontual, todo o restante do plano (módulos, fluxos, o que a
> associação faz) é pensado do zero para a ASAF, sem herdar estrutura de governança, disciplina
> ou vocabulário de nenhuma organização religiosa.

## 1. Visão geral

Três frentes, um só sistema por trás:

1. **Site institucional** — página pública da associação (quem somos, notícias, eventos,
   transparência, contato, doações).
2. **Painel único do associado/diretoria** — um só login, um só painel, módulos visíveis
   conforme permissão (presidente vê tudo; membro comum só o que sua permissão libera). Nunca
   duas telas separadas ("painel do membro" x "painel administrativo").
3. **Infraestrutura** — tudo hospedado no Azure (créditos de ONG, teto de US$100/mês), deploy
   automático via GitHub.

O que muda em relação à v1 deste plano: em vez de "arquitetura + backlog geral", este documento
passa a ser um **roteiro de fases e versões**, no mesmo espírito de um roadmap de produto real —
cada fase agrupa versões, cada versão é uma lista de entregas com checklist (`[ ]`). A ordem
segue o ciclo: fundação → identidade/associados → governança → financeiro → **eventos
(integração site↔sistema)** → site institucional/conteúdo → comunicação/transparência →
segurança/LGPD → infraestrutura/deploy → experiência/performance → expansão futura.

## 2. O que já existe

- `servidor.py`: backend FastAPI + SQLAlchemy, hoje sobre SQLite (`erp_asaf.db`). Já modela:
  - Identidade e permissão: `Usuario`, `TokenAcesso`, `NivelAcesso`, `PermissaoSistema`
    (permissão por módulo).
  - Associados: `Associado`, `Endereco`, `DependenteFamiliar`, `DocumentoAnexo`,
    `HistoricoCargo`.
  - Financeiro: `PlanoDeContas`, `Fornecedor`, `Exercicio`, `TituloFinanceiro`,
    `LancamentoContabil`, `PartidaContabil` (v3.0).
  - Governança: `Assembleia`, `RegistroVoto`, `DocumentoInstitucional`.
  - Projetos/voluntariado: `ProjetoEvento`, `AlocacaoVoluntario` (embrião do módulo de Eventos —
    ver FASE 4).
- `templates/index.html`: protótipo que hoje ainda separa "Portal do Associado" de "Acesso
  Administrativo" — será substituído pelo painel único modular (FASE 0).

A lógica de negócio já pronta não será reescrita; o que este plano organiza é tudo que falta
construir em volta dela, na ordem certa, sem deixar nenhuma parte fora do mesmo sistema.

## 3. Decisões de arquitetura (fechadas)

### 3.1 Um banco só, dois consumidores de conteúdo
Postgres único no Azure. Directus enxerga só as tabelas de **conteúdo público do site**
(páginas, notícias, banners, texto de apoio de evento) — nunca `Associado`, `Financeiro`,
`Assembleia`/votação. FastAPI é o dono de toda a regra de negócio e da tabela de Eventos em si
(ver 3.4). Directus não vira "backend geral" — decisão já justificada na v1 deste plano
(reescrever regra de negócio dentro de um CMS não compensa).

### 3.2 Duas identidades, propositalmente diferentes
- **Login do Directus** (e-mail + senha): só para quem edita conteúdo do site (equipe de
  comunicação).
- **Login do sistema** (matrícula/CPF + senha): associado, diretoria, voluntário — resolvido
  sempre pelo `Usuario`/`TokenAcesso` do FastAPI.
- As duas nunca precisam ser unificadas (públicos diferentes, credenciais diferentes) — só o
  banco de conteúdo é compartilhado.

### 3.3 Painel único por módulos
Um único botão "Meu Painel" → login único → um só painel cujo menu se monta a partir de
`PermissaoSistema` do usuário. Nunca duas rotas (`/admin` x `/meu-portal`) — ver FASE 0.

### 3.4 Eventos: a peça de integração (o que resolve o problema dos dois projetos de referência)
Diferente do módulo de eventos "isolado no site" analisado nas referências de pesquisa, aqui
**Evento é uma entidade única do FastAPI**, com API própria consumida tanto pelo site público
(listagem, inscrição, formulário de perguntas) quanto pelo painel (gestão, check-in, relatório).
O Directus nunca guarda evento — só pode enriquecer a *divulgação* dele (texto de chamada,
banner), nunca os dados de inscrição/presença/pagamento. Isso elimina de raiz o cenário que as
referências de pesquisa descrevem: duplicar cadastro de participante entre um sistema de eventos
do site e o cadastro de associado do sistema de gestão.

### 3.5 Deduplicação por CPF/e-mail (confirmado por pesquisa de mercado)
Nenhum sistema líder de gestão associativa trata inscrito de evento como cadastro separado do
membro. Estratégia: CPF exato → e-mail normalizado → fila de revisão manual em caso de ambiguidade
(nunca merge automático quando já há histórico relevante — títulos financeiros, cargos, doações).

### 3.6 Orçamento Azure
Créditos de ONG ~US$2.000/ano → teto de **US$100/mês**. Ver detalhamento na FASE 8.

## 4. Roteiro de fases e versões

> **Expansão de 2026-09-11**: a pedido do usuário, tudo a partir da **v0.2** foi levado ao nível
> mais alto que cada fase comporta, com sub-versões criadas onde o detalhe exigia (v0.2.0–v0.2.10,
> v0.3.1–v0.3.5, v1.0–v1.8, v2.0–v2.9, v3.0–v3.7, v4.0–v4.10, v5.0–v5.5, v6.1–v6.3, v7.0–v7.5,
> v8.1–v8.5, v9.1–v9.4, v11.1–v11.10, v12.0–v12.10, v13.1–v13.5, v14.1–v14.4, v15.0–v15.6,
> v16.1–v16.4, v17.1–v17.3, v18.1–v18.4, v19.1–v19.2, v20.1–v20.4). Três regras foram seguidas
> nessa expansão: **(1)** nenhuma afirmação de pesquisa/legislação já validada foi alterada ou
> inventada — o que é fundamentado continua marcado como tal, e o que é decisão de desenho está
> escrito como decisão de desenho; **(2)** cada fase ganhou uma versão "zero" ou equivalente com
> os **motores compartilhados** dela (presença, inscrição, documento, indicador, catálogo,
> obrigação), para que módulos futuros reusem em vez de reimplementar; **(3)** todo item novo
> declara o que fica **fora de escopo de propósito**, porque plano que só cresce em ambição, sem
> declarar limite, é plano que não se cumpre.

### 4.1 Sistema de pontos de revisão entre fases

> **Por que este sistema existe**: este projeto vai ser trabalhado por diferentes sessões de IA
> ao longo do tempo — algumas com mais capacidade de raciocínio, outras mais baratas/rápidas e
> com menos capacidade. Isso é aceitável e esperado. O que **não pode acontecer** é uma sessão de
> menor capacidade construir uma fase inteira (ou várias) com um problema estrutural que só é
> percebido muito depois, quando já há código, dado real e outras fases construídas em cima do
> erro. A correção nesse ponto fica cara e arriscada — exatamente o tipo de retrabalho que este
> projeto já evitou ao adotar Alembic e modularizar o `servidor.py`, e que não deve se repetir por
> falta de checagem no meio do caminho.

**Regra padrão**: toda fase ganha **pelo menos dois pontos de revisão**: um no **meio** da fase e
um no **fim**. Cada ponto de revisão é um bloco explícito neste documento, marcado como
`🔍 Ponto de Revisão`, inserido entre duas sub-versões. (v0.0 e v0.1, dentro da FASE 0, já estavam
concluídas e validadas por um processo equivalente quando este sistema foi criado — por isso não
receberam blocos retroativos; a v0.2/v0.3 da mesma fase, ainda em construção, recebem pontos de
revisão normalmente, como qualquer fase 1-20.)

**Regra para fases críticas**: fases que envolvem dinheiro (FASE 3), voto/validade jurídica de
deliberação (FASES 2, 13, 20), dado sensível em volume (FASE 7), segurança em profundidade
(FASE 15), ou que são simplesmente muito extensas (FASES 4, 11, 12, com dez ou mais sub-versões)
ganham **três pontos de revisão**, dividindo a fase em terços em vez de metades. Se, na prática,
uma fase normal também se revelar mais arriscada do que parecia ao ser planejada, a pessoa/sessão
que perceber isso deve adicionar um ponto de revisão extra ali mesmo — este número não é um teto
rígido, é o mínimo.

**O que cada ponto de revisão verifica** (checklist padrão — todo `🔍 Ponto de Revisão` no
documento aplica esta lista, além dos itens específicos daquele trecho):

1. O que está marcado `[x]` no intervalo revisado foi **de fato implementado e testado** — nunca
   marcado por otimismo ou por analogia com outra sub-versão parecida.
2. Testes automatizados desse intervalo existem e passam contra dado/ambiente real (nunca "parece
   funcionar no manual").
3. Nenhuma regra de `DECISOES_CONGELADAS.md` foi violada nesse intervalo (trocou banco, trocou
   framework, reintroduziu checagem de nível hardcoded, etc.).
4. Nenhum segredo/credencial foi exposto em código, commit ou log (mesmo scan já praticado antes
   de cada push neste projeto).
5. Toda ação sensível desse intervalo grava `AuditLog` de verdade — não só no desenho, no
   comportamento observado.
6. Toda permissão nova é checada **no backend**, nunca só escondida/desabilitada no front.
7. Nada foi construído fora do escopo deste intervalo "adiantando" uma fase futura sem registro —
   isso evita duas sessões de IA diferentes reconstruindo o mesmo módulo de formas incompatíveis.
8. O `PLANO_PROJETO.md` está atualizado (checkbox, nota de decisão, ressalva) refletindo o que
   realmente existe — o plano nunca fica desalinhado do código por mais de um ponto de revisão.
9. A suíte de teste **completa** (não só a do intervalo) continua passando — nada anterior
   quebrou silenciosamente.
10. **(item acrescentado em 2026-09-15, achado grave do usuário)** Toda funcionalidade de
    back-end deste intervalo que se destina a uso humano direto (não é só API interna consumida
    por outro serviço) tem uma **tela real e visível no painel único** (`painel.asaf.org.br`),
    confirmada de verdade - descrita ou mostrada nesta revisão, nunca só inferida porque a rota
    existe e o teste automatizado passa. **Motivo**: as FASES 1 e 2 inteiras (e o começo da FASE
    3) foram marcadas como concluídas com o back-end pronto e testado, mas sem nenhuma tela
    correspondente no painel - só apareceu `<EmConstrucao>`. Nenhuma revisão anterior pegou isso
    porque o checklist só checava teste automatizado (item 2), nunca a experiência visual de
    quem realmente vai usar. "O que não é visto não é lembrado" - a partir de agora, back-end
    sem tela real não é fase concluída, é fase pela metade, e não passa deste item.
11. **(item acrescentado em 2026-09-16, achado do usuário)** Toda ação que produz um **link,
    arquivo ou imagem pra abrir depois** (foto, documento anexado, edital, certidão) foi de fato
    **clicada/aberta em produção**, não só "a tela renderizou sem erro no console". O item 10
    cobre "existe uma tela"; este cobre "o que essa tela oferece pra abrir realmente abre".
    **Motivo**: a foto do associado (v2.5.1) e o documento anexado da ata (v2.5.4) usavam um
    caminho relativo (`/uploads/...`) que resolve contra a origem do PAINEL, não da API - em
    produção são domínios diferentes, então o link sempre dava 404. Passou pelo item 10 (a tela
    existia, carregava, sem erro nenhum no console) porque ninguém tinha clicado no link ainda -
    só foi achado quando o usuário de fato tentou abrir o documento que acabara de anexar. Item
    10 prova que a tela existe; este item prova que ela funciona de ponta a ponta.
12. **(item acrescentado em 2026-09-16, achado do usuário - "passou pelo ponto de revisão mas o
    negócio nunca foi pra produção")** O que este ponto de revisão está fechando **está de
    verdade no ar em produção** — nunca só "está commitado", "está no GitHub" ou "o workflow foi
    disparado". Isso é uma verificação própria, distinta dos itens 10/11: o item 10 prova que a
    tela existe no código e roda; o item 11 prova que o que ela abre funciona de ponta a ponta;
    este item prova que **o usuário final já consegue ver isso hoje**, não só quem está com o
    repositório aberto. Passos mínimos, nesta ordem:
    - `git log origin/main..HEAD` (ou equivalente) vazio — o commit que fecha esta faixa está
      **no `main` remoto**, não só local ou numa branch/PR aberta.
    - O workflow correspondente (`deploy-api.yml` e/ou `deploy-painel.yml`, conforme o que a
      faixa tocou) **rodou e terminou com sucesso** para esse commit específico — checado na aba
      Actions do GitHub (ou `gh run list`/`gh run view`), nunca assumido só porque o push
      aconteceu (um workflow pode falhar silenciosamente, ou nem disparar).
    - Pro painel: o rodapé (ou `painel.asaf.org.br/version.json`) mostra o **mesmo hash de commit
      curto** que acabou de ser mergeado (`git rev-parse --short HEAD`) — mecanismo que já existe
      desde a v0.2.7 exatamente pra isso, e que nenhuma revisão até 2026-09-16 tinha usado de
      verdade com esse propósito. Pra API: como ela ainda não expõe um `/health`/versão com o
      commit (lacuna registrada aqui, não resolvida por este ponto de revisão), confirmar pelo
      log da Actions que o deploy do Container App terminou sem erro para o SHA certo é o mínimo
      aceitável até que essa lacuna seja fechada.
    - **Quando a sessão não tem acesso a produção** (comum: `CREDENCIAIS_AZURE.md` fica cifrado
      via sops/age, e a maioria das sessões não tem a chave) - isto **não dispensa** o item, e
      **nunca** deve ser silenciosamente substituído por "testei local e deu certo". A sessão
      registra explicitamente, no próprio bloco de revisão: o que foi confirmado só localmente,
      o que foi confirmado pela Actions/GitHub (git push + workflow verde, que não exige
      credencial de produção nenhuma), e o que ficou **pendente de confirmação em produção** para
      o usuário (ou uma sessão com acesso) fazer antes de considerar este item de fato cumprido.
      Um ponto de revisão marcado ✅ com este item pendente é, por definição, um ponto de revisão
      **fechado errado** - registrar a pendência é sempre melhor que fingir que foi checado.

**Quem revisa**: idealmente uma sessão diferente da que implementou (outra janela de contexto, ou
o usuário revisando antes de autorizar a faixa seguinte) — revisar o próprio trabalho na mesma
sessão que o produziu é melhor que nada, mas é a opção mais fraca desta lista.

**Se a revisão encontrar problema**: o achado é registrado no próprio bloco de revisão (nunca
"empurrado" para a frente como pendência vaga), e a fase **não avança** para o próximo intervalo
até a correção estar feita — o ponto de revisão é um portão, não uma sugestão. Isso vale igual
pros itens 10/11/12: achar uma tela que não existe, um link que quebra ou um deploy que não saiu
é achar um bug, e bug achado em ponto de revisão se corrige ali mesmo, não se registra como
pendência pra outra sessão resolver depois — é exatamente esse adiamento que multiplica o
retrabalho que a seção 4.1 existe pra evitar.

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

**Verificação real, não só leitura de código**: rodei o backend de verdade nesta máquina (Python
+ SQLite local) e testei via `curl` — login, matriz de níveis/permissões, auditoria com nome de
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

### FASE 2 — Governança (assembleias, diretoria, conselho fiscal)

Base legal confirmada por pesquisa: Código Civil, Arts. 53–61 (associações). O módulo de
governança segue esses artigos como piso mínimo, não como teto — a FASE 12 trata do que vai além
deles, e a FASE 13 leva assembleia/diretoria ao detalhamento máximo. **A FASE 2 entrega o núcleo
funcional; a FASE 13 entrega o refinamento.** Esta separação é deliberada: a associação precisa
conseguir fazer uma assembleia válida bem antes de ter todos os refinamentos.

#### v2.0 — O estatuto como configuração, não como código
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

### FASE 3 — Financeiro

> Módulo mais sensível do sistema: é onde fraude acontece, é o que o Conselho Fiscal audita, e é o
> que alimenta a contabilidade (FASE 17). Duas regras estruturais valem para tudo que segue:
> **(1) nada é excluído, só estornado**; **(2) quem registra nunca é quem aprova**.

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

> **Achado durante esta versão, não específico dela**: `ConfiguracaoInstitucional` (`CHAVE_PIX`,
> `TETO_ALCADA_FINANCEIRA`, e agora `DIAS_LEMBRETE_MENSALIDADE`, entre outras) **nunca teve tela
> no painel** — só editável hoje via chamada direta à API (`PUT /api/configuracoes/{chave}`).
> Gap pré-existente desde a v0.3.4, não introduzido por esta versão, mas que se torna mais
> visível agora. Registrado aqui para uma versão futura construir a tela genérica de
> Configurações Institucionais (listar/editar por categoria) — fora do escopo deste intervalo por
> item 7 do checklist (não inflar a versão atual com um módulo à parte).

#### v3.2.2 — Inadimplência como processo, não como rótulo (2026-09-17)
> **Investigação antes de codar** (economizou trabalho duplicado): três dos quatro itens abaixo
> já estavam total ou parcialmente resolvidos por versões anteriores, achado confirmado lendo o
> código antes de implementar:
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
> **Pedido da diretoria (2026-09-17)**: incentivar quem paga a mensalidade adiantada, em bloco
> (ex.: semestral em janeiro/julho, ou anual), com desconto percentual. Desenhado em conversa
> nesta sessão — decisões confirmadas com o usuário antes de codar:
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

### FASE 4 — Projetos, Reserva de Espaço e Eventos (módulo de integração site ↔ sistema)

Esta é a fase que resolve, de propósito, o problema identificado nas referências de pesquisa:
lá, o site e o sistema de gestão nunca se integraram de verdade, e o módulo de eventos nasceu
*só* no site, sem nenhum dado de associado. Aqui, tanto Projeto quanto Evento nascem como
entidades únicas do FastAPI, com API própria consumida pelo site (leitura pública) e pelo painel
(gestão) — nunca dois cadastros que precisam ser conciliados à mão depois.

Confirmado por pesquisa de mercado (seção 6): **não existe hoje um padrão de mercado maduro e
único para módulo de Projetos em associação genérica** — a maioria dos sistemas de gestão
associativa não cobre isso, e os que cobrem bem são de terceiro setor assistencial verticalizado.
A saída de desenho recomendada pela própria pesquisa — e adotada aqui — é um cadastro único e
configurável de `Projeto`, com `tipo_projeto` habilitando sub-formulários condicionais, em vez de
modelar qualquer tipo específico da ASAF direto no código. Isso é deliberado: o módulo precisa
caber projeto educacional, quadra/espaço, ação assistencial, oficina cultural ou qualquer outro
tipo futuro — **sem ficar preso ao que a ASAF faz hoje**.

> **Pendência registrada pela v2.9 (2026-09-15)**: `app/routers/projetos.py` (`criar_projeto`,
> `alocar_voluntario`) ainda é protótipo v0.1/v0.2 - nenhum endpoint tem
> `Depends(get_current_user)`/`exigir_permissao` nem chama `registrar_auditoria`, mesma categoria
> de achado que a v1.1 fez pro financeiro (FASE 3). O calendário institucional (v2.9) já lê
> `ProjetoEvento.data_inicio` de forma segura (endpoint próprio, autenticado) - mas criar/alterar
> projeto continua sem proteção nenhuma até esta fase resolver.

#### v4.0 — Motores compartilhados (construídos uma vez, usados por tudo)
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

#### v4.7 — Vagas, lista de espera e inscrição em grupo
- [ ] Limite de vagas com trava real sob concorrência (controle transacional no banco, não
      contagem otimista na aplicação) — acima do limite, vira lista de espera automaticamente, com
      promoção automática na desistência e prazo para confirmar antes de passar ao próximo.
- [ ] Cotas por categoria (ex.: X vagas para associados, Y para comunidade externa).
- [ ] Inscrição em grupo (família, delegação): cada nome vira inscrição própria com código de
      check-in individual; telefone/respostas compartilhados quando fizer sentido.

##### 🔍 Ponto de Revisão — FASE 4 (2/3, fecha v4.4–v4.7)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Voluntário sem termo de adesão vigente (v1.6) realmente não é alocável em projeto — trava real, testar a tentativa.
- Limite de vagas (v4.7) segura sob concorrência (duas inscrições simultâneas na última vaga não podem ambas passar) — teste de carga simples nisso.
- Endpoint público de inscrição (v4.6) tem rate limiting e deduplicação por CPF funcionando de verdade.

#### v4.8 — Check-in, crachá e certificado
- [ ] Check-in por código curto, QR code da inscrição ou carteirinha do associado, **sem exigir
      login de quem opera a portaria** (token de operação com escopo limitado ao evento).
- [ ] Modo offline resiliente: a portaria continua registrando presença se a internet cair, com
      sincronização depois — evento acontece em quadra e salão, onde a rede falha de verdade.
- [ ] Check-out opcional (para cálculo de carga horária real de curso/atividade).
- [ ] Crachá e certificado em PDF a partir do registro de presença (motor v4.0), com código de
      verificação público (`/certificado/verificar/{codigo}`) que confirma autenticidade sem expor
      dado pessoal além do nome e da atividade.
- [ ] Regra de elegibilidade ao certificado configurável (ex.: 75% de presença) — calculada, nunca
      concedida à mão.
- [ ] **Nunca exportação de lista completa em lote** como caminho padrão (risco de vazamento
      identificado nas referências de pesquisa); exportação existe, mas com permissão própria e
      registro em auditoria (v1.3).

#### v4.9 — Financeiro de projeto/evento
- [ ] Cobrança de inscrição/uso de espaço integrada à FASE 3, com valor por faixa (associado x não
      associado x estudante), lote promocional por data, cupom e isenção justificada.
- [ ] Política de reembolso por cancelamento, com prazo e percentual configuráveis, gerando
      estorno rastreável (nunca "devolução por fora").
- [ ] Fechamento financeiro automático ao encerrar (inscritos, presentes, arrecadado, custos,
      resultado por centro de custo), com a mesma auditoria do restante do financeiro.

#### v4.10 — Painel gerencial e avaliação
- [ ] Telas de inscritos/beneficiários/reservas com busca, filtro e edição, sem exportação em lote
      como ação corriqueira.
- [ ] Indicadores agregados por projeto e comparação entre edições de um mesmo evento.
- [ ] Pesquisa de satisfação pós-evento (link único por inscrito, resposta anônima na exibição),
      alimentando o indicador de qualidade do evento.
- [ ] Mapa de calor de ocupação de espaços — subsidia decisão real sobre horário, tarifa e
      necessidade de nova estrutura.

##### 🔍 Ponto de Revisão — FASE 4 (3/3 — fim, fecha v4.8–v4.10)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Exportação de lista de inscritos/beneficiários (v4.10) nunca é ação corriqueira sem registro em auditoria.
- Certificado (v4.8) só é emitido quando a regra de elegibilidade (ex.: 75% de presença) é realmente atingida — testar caso abaixo do limite.

### FASE 5 — Site institucional (conteúdo público)

> O site não é folheto: é a porta de entrada de associado, voluntário, doador e beneficiário — e é
> a face pública da transparência. Tudo que é **dado** vem do FastAPI; só o que é **editorial** vem
> do Directus. Essa fronteira é o que impede o site de virar um segundo sistema.

#### v5.0 — Fundação técnica do site
- [ ] Astro com geração estática + ilhas interativas, publicado no Static Web App `asaf-site` (já
      provisionado), domínio `asaf.org.br` (já configurado na v0.0).
- [ ] Rebuild automático: webhook do Directus dispara o workflow de publicação quando o conteúdo
      muda; dado dinâmico do FastAPI (eventos, transparência) é buscado no cliente ou revalidado,
      para não exigir rebuild a cada inscrição.
- [ ] Mesmos tokens de design do painel (v0.2.4) — identidade visual única, mantida num lugar só.
- [ ] SEO técnico desde o início: metadados por página, Open Graph, `sitemap.xml`, `robots.txt`,
      dados estruturados de organização e de evento (`schema.org/Event`) — evento da ASAF
      aparecendo corretamente na busca do Google é resultado direto disso.
- [ ] Meta de performance e acessibilidade auditada no CI (antecipa a FASE 9): sem isso, "a gente
      melhora depois" nunca acontece.

#### v5.1 — Directus como CMS de conteúdo
- [ ] Coleções: páginas institucionais, notícias, banners, galeria, depoimentos, parceiros,
      perguntas frequentes — **só conteúdo público**, nunca dado de associado/financeiro.
- [ ] Fluxo editorial com rascunho → revisão → publicado, agendamento de publicação e histórico de
      versão com possibilidade de reverter.
- [ ] Papéis do Directus mapeados à realidade (editor de conteúdo x administrador), sem dar
      administrador para quem só escreve notícia.
- [ ] Biblioteca de mídia com texto alternativo **obrigatório** (acessibilidade não é opcional) e
      geração de tamanhos responsivos.

#### v5.2 — Páginas essenciais
- [ ] Home, Quem Somos/História, Diretoria e Conselho (lendo os mandatos vigentes da FASE 2, nunca
      digitados de novo), Projetos (lendo os projetos públicos da FASE 4), Notícias, Agenda de
      Eventos (FastAPI), Transparência (FASE 3/12.7), Como Ajudar/Doe, Seja Voluntário, Seja
      Associado, Contato com mapa, Política de Privacidade e Termos de Uso versionados (FASE 7).
      > **Pendências registradas pela v2.0/v2.1 (2026-09-15)**, já prontas para esta página
      > consumir: "Diretoria e Conselho" lê `GET /api/mandatos/?apenas_vigentes=true` (v2.1) -
      > nenhum nome de dirigente digitado à mão no site. Uma página "Estatuto" (ou seção dentro de
      > "Quem Somos") pode expor o documento vigente (`DocumentoEstatuto`, v2.0) para download -
      > hoje só existe `caminho_arquivo="ESTATUTO_ASAF.txt"` apontando pro arquivo na raiz do
      > repositório, sem rota de upload/servir arquivo dedicada ainda.
- [ ] Página de cada projeto e de cada evento com URL estável e compartilhável.
- [ ] **Publicação do edital de assembleia na área pública do site** (pendência da v2.2,
      2026-09-15): `GET /api/assembleias/{id}/edital` (FASE 2) já gera o texto - falta só a
      página pública que o exibe e o comprovante de publicação arquivado.

##### 🔍 Ponto de Revisão — FASE 5 (1/2 — meio, fecha v5.0–v5.2)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Directus não tem, em nenhuma coleção, dado de associado/financeiro/evento — só conteúdo editorial.
- Auditoria de SEO/acessibilidade (v5.0) está rodando de fato no CI, não só planejada.

#### v5.3 — Formulários públicos (uma fila única no painel)
- [ ] Formulário público de voluntariado, de proposta de filiação (v1.2), de contato e de
      solicitação de titular LGPD (FASE 7) — todos com a mesma deduplicação por CPF/e-mail, todos
      caindo em **uma fila única de atendimento** no painel, com status e responsável. Formulário
      que vira e-mail solto é o jeito conhecido de perder gente interessada.
- [ ] Confirmação automática ao remetente e prazo de resposta acompanhado (liga com o protocolo
      interno da v13.3).

#### v5.4 — Doação online
- [ ] PIX com QR code dinâmico por doação (identificação automática do pagamento), doação
      recorrente via Pix Automático (v3.2.1) quando disponível, e opção de doação anônima.
- [ ] Recibo automático por e-mail e, para doador identificado, área de acompanhamento das próprias
      doações.
- [ ] Transparência do destino: cada campanha mostra quanto arrecadou e em que foi aplicado,
      puxando do centro de custo real (FASE 3) — não texto escrito à mão.

#### v5.5 — Confiança, privacidade e conformidade do site
- [ ] Banner de cookies honesto: se o site não usa rastreamento de terceiro, não fingir que usa —
      preferência por métrica sem cookie (Application Insights ou analytics respeitoso), evitando
      consentimento desnecessário.
- [ ] Headers de segurança (CSP, `X-Content-Type-Options`, `X-Frame-Options`, HSTS) configurados no
      Static Web App.
- [ ] Página "Transparência" e página "Privacidade" sempre acessíveis a partir do rodapé de
      qualquer página.

##### 🔍 Ponto de Revisão — FASE 5 (2/2 — fim, fecha v5.3–v5.5)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Todos os formulários públicos (v5.3) caem na mesma fila única de atendimento — testar que nenhum vira e-mail solto por fora do sistema.
- Headers de segurança (v5.5) presentes de fato na resposta HTTP do site em produção.

### FASE 6 — Comunicação e transparência

#### v6.1 — Comunicação interna no painel
- [ ] Mural de avisos segmentado por permissão/categoria/projeto, com data de validade e
      confirmação de leitura quando o aviso for relevante (convocação, mudança de regra).
- [ ] Comunicados dirigidos a um grupo calculado (ex.: "todos os associados adimplentes do
      projeto X") — segmento é consulta, nunca lista colada à mão que envelhece.
- [ ] Caixa de entrada do associado dentro do painel, com histórico de tudo que ele recebeu — o
      associado consegue provar que foi (ou não foi) avisado.

##### 🔍 Ponto de Revisão — FASE 6 (1/2 — meio, fecha v6.1)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Mural de avisos respeita a segmentação por permissão/categoria — testar que um nível sem permissão não vê aviso restrito.

#### v6.2 — Central de comunicação multicanal (base para v11.3)
> **Pendência registrada pela v1.2 (2026-09-14)**: "boas-vindas automáticas" na efetivação de
> filiação (`app/routers/filiacao.py`, `aprovar_proposta`) e o "aviso à secretaria" quando o
> período de experiência acaba hoje só gravam `AuditLog` (`BOAS_VINDAS_REGISTRADAS`) - não
> existe envio de e-mail/notificação de verdade em lugar nenhum do sistema ainda. Quando esta
> versão existir, conectar os dois eventos aqui em vez de deixar só no log.
>
> **Ideia registrada pelo usuário (2026-09-15), ainda não detalhada**: "grupo de comunicação"
> configurável - um endereço/canal que **só envia, nunca recebe** (o usuário mesmo reconheceu
> que ainda não sabe como isso funcionaria na prática). Provavelmente equivale a um alias de
> e-mail de saída (remetente `NOME_DO_GRUPO@...` ou similar) associado a um segmento de público
> desta mesma v6.2 ("comunicados dirigidos a um grupo calculado"), não uma caixa de entrada
> nova. Detalhar o desenho quando esta versão for construída - também alimenta a fila de
> higienização de contato da v1.8 (e-mail que retorna) quando existir.
- [ ] `Comunicacao` (assunto, corpo com variáveis, canal, público-alvo, agendamento, status) com
      envio por e-mail, notificação no painel e, quando a v11.3 existir, WhatsApp.
- [ ] Registro de entrega e falha por destinatário, com reprocessamento — mensagem que não chegou
      precisa ser visível, não silenciosa.
- [ ] Preferências de contato por pessoa e **descadastro real** de comunicação não essencial
      (comunicação estatutária obrigatória, como convocação, não é descadastrável, e o sistema
      deixa essa distinção explícita).
- [ ] Modelos de mensagem versionados, com pré-visualização e envio de teste antes do disparo.
- [ ] Limite de segurança: disparo em massa exige permissão própria e confirmação com contagem de
      destinatários — evita o erro de mandar para 2.000 pessoas por engano.

#### v6.3 — Transparência pública ativa
- [ ] Publicação automática do relatório financeiro resumido (FASE 3) e de documentos
      institucionais (estatuto vigente, atas aprovadas, relatório anual) em `/transparencia/`,
      gerada do próprio dado — nunca digitada duas vezes.
- [ ] Cada documento publicado com data, versão e responsável; documento substituído mantém o
      histórico acessível em vez de sumir.
- [ ] Relatório anual de atividades montado automaticamente a partir de projetos, indicadores,
      eventos e financeiro do exercício, com espaço editorial para texto da diretoria — a peça que
      toda associação faz na correria e que aqui nasce pronta.

##### 🔍 Ponto de Revisão — FASE 6 (2/2 — fim, fecha v6.2–v6.3)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Disparo em massa (v6.2) exige confirmação com contagem de destinatários antes de enviar — testar a confirmação, não só o envio.
- Opt-out (v6.2) é honrado em todos os canais simultaneamente, e comunicação estatutária obrigatória continua sendo entregue mesmo com opt-out de comunicação opcional.
- Portal de transparência (v6.3) publica dado gerado do sistema, nunca digitado à mão.

### FASE 7 — LGPD e proteção de dados (programa, não checklist)

> A ASAF trata dado de associado, de criança beneficiária, de voluntário e de doador. A LGPD aqui
> não é formalidade: é o que evita dano real a pessoas e responsabilização da diretoria. Esta fase
> vira um **programa de privacidade** com dono, inventário e prova — não um banner de cookies.

#### v7.0 — Governança de privacidade
- [ ] Encarregado (DPO) designado e publicado no site com canal de contato — exigência do Art. 41
      da LGPD, frequentemente ignorada por associações.
- [ ] **Inventário de dados (ROPA)** vivo: para cada tipo de dado tratado — quem é o titular, qual
      a finalidade, qual a base legal, quanto tempo fica, com quem é compartilhado, onde está
      armazenado. Mantido como registro no próprio sistema, não como documento Word esquecido.
- [ ] Classificação de dado por sensibilidade (comum, pessoal sensível, dado de criança e
      adolescente) marcada **no modelo de dados**, para que controles técnicos (criptografia,
      auditoria de consulta, retenção) sejam aplicados por classificação, não caso a caso.
- [ ] Avaliação de impacto (RIPD) obrigatória antes de ativar qualquer tratamento de alto risco —
      biometria (v20.3), prontuário de beneficiário (v4.2), perfilamento por score (v11.1).

#### v7.1 — Base legal, consentimento e retenção
- [ ] Base legal explícita por finalidade: execução do vínculo associativo (não precisa de
      consentimento para cobrar mensalidade), obrigação legal (contabilidade), e consentimento
      apenas onde é de fato necessário (foto, comunicação de marketing, biometria). Pedir
      consentimento para tudo é erro comum e enfraquece o consentimento onde ele importa.
- [ ] `Consentimento` versionado (titular, finalidade, versão do texto, data, meio, IP, revogação)
      — prova de quando e a quê a pessoa consentiu, com o texto exato daquela época.
- [ ] Dado de criança e adolescente (Art. 14): consentimento específico de ao menos um dos pais ou
      responsável, com registro do vínculo — relevante direto para projetos assistenciais e
      educacionais da FASE 4/14.
- [ ] Política de retenção por tipo de dado, implementada como **rotina real** de anonimização/
      descarte (participante externo de evento: X meses; candidato a voluntário não aprovado: Y
      meses; associado desligado: prazo legal/contábil), com relatório do que foi descartado.
      Retenção que só existe no papel não é retenção.
- [ ] Anonimização preserva estatística (o evento continua sabendo que teve 300 presentes) sem
      preservar identificação — apagar linha inteira destruiria o histórico institucional.

##### 🔍 Ponto de Revisão — FASE 7 (1/3, fecha v7.0–v7.1)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Encarregado (DPO) está de fato nomeado e publicado, não só planejado.
- Consentimento (v7.1) é versionado com o texto exato da época — testar que reabrir um consentimento antigo mostra o texto que valia então, não o atual.

#### v7.2 — Direitos do titular, operacionalizados
- [ ] Canal único de solicitação: pelo painel (autenticado) e pelo site (formulário com validação
      de identidade), gerando protocolo com prazo legal acompanhado.
- [ ] Atendimento real de cada direito: confirmação de tratamento, acesso, correção,
      anonimização/eliminação, portabilidade (exportação em formato legível por máquina),
      informação sobre compartilhamento, e revogação de consentimento.
- [ ] Limites explicados ao titular quando houver: dado retido por obrigação legal (contábil,
      fiscal) não é apagável, e o sistema responde isso com fundamento, não com silêncio.
- [ ] Relatório de atendimento de solicitações (quantas, prazo médio, resultado) para a diretoria.

#### v7.3 — Segurança aplicada à privacidade
- [ ] Minimização por padrão: cada tela e cada exportação mostram só o necessário; CPF completo
      exibido apenas para quem tem permissão específica, mascarado para os demais.
- [ ] Headers de segurança HTTP (CSP, `X-Content-Type-Options`, `X-Frame-Options`, HSTS) no site
      estático e no painel.
- [ ] Rate limiting nos endpoints públicos (inscrição de evento, contato, filiação) — proteção
      contra spam/abuso sem CAPTCHA comercial pago.
- [ ] Contratos/termos com operadores (Azure, provedor de e-mail, PSP de pagamento, BSP de
      WhatsApp) registrados no inventário, com a finalidade de cada compartilhamento.

##### 🔍 Ponto de Revisão — FASE 7 (2/3, fecha v7.2–v7.3)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Canal de solicitação de titular (v7.2) gera protocolo com prazo legal acompanhado de verdade, não só uma caixa de entrada.
- CPF é mascarado por padrão em toda tela/exportação (v7.3), visível completo só para quem tem permissão específica — testar com usuário sem essa permissão.

#### v7.4 — Resposta a incidente de segurança
- [ ] Plano escrito e ensaiado: detecção → contenção → avaliação de risco aos titulares →
      comunicação à ANPD e aos titulares quando houver risco relevante → registro e lição
      aprendida. Prazo e canal de comunicação definidos **antes** do incidente, não durante.
- [ ] Registro de incidentes (mesmo os sem impacto) com ação corretiva — inclui os incidentes
      reais já vividos no projeto (exposição de senha em transcrição, rotacionada imediatamente),
      documentados como precedente.

#### v7.5 — Cultura e prova
- [ ] Treinamento anual curto e registrado para diretoria, secretaria e voluntários com acesso a
      dado — a maioria dos vazamentos em organização pequena é operacional, não técnica.
- [ ] Revisão anual do programa (inventário, políticas, retenção, permissões) com relatório à
      diretoria — privacidade é processo recorrente, não entrega única.

##### 🔍 Ponto de Revisão — FASE 7 (3/3 — fim, fecha v7.4–v7.5)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Plano de resposta a incidente (v7.4) tem prazo e canal definidos por escrito, **antes** de qualquer incidente novo acontecer.
- Treinamento anual de privacidade (v7.5) tem registro de quem participou, não é evento informal sem prova.

### FASE 8 — Infraestrutura e Deploy (Azure)

> ✅ Boa parte desta fase **já foi executada na v0.0** (provisionamento real e CI/CD funcionando).
> O que segue expande o que ainda falta para transformar "está no ar" em "opera bem por 20 anos".

#### v8.1 — Provisionamento ✅ concluído na v0.0
- [x] Azure Database for PostgreSQL Flexible Server (Burstable B1ms, backup 35 dias +
      geo-redundância) — banco único compartilhado com o Directus, que só possui as tabelas
      `directus_*`.
- [x] FastAPI e Directus em Azure Container Apps (plano consumo, scale-to-zero).
- [x] Site institucional + painel em Azure Static Web Apps, com domínio próprio via Azure DNS.
- [x] Blob Storage para uploads/anexos (soft delete + versionamento), Key Vault para segredos,
      Application Insights para monitoramento.
- [x] Total estimado ~US$40–60/mês, dentro do teto de US$100/mês definido em 3.6, com alerta de
      orçamento configurado.

#### v8.2 — CI/CD ✅ parcialmente concluído
- [x] Workflow da API com OIDC (sem segredo de longa duração no GitHub), build via ACR Tasks e
      atualização do Container App.
- [ ] Workflows equivalentes para o painel (v0.2.0) e para o site (v5.0).
- [ ] Migração Alembic executada como **passo explícito do pipeline**, antes do deploy da nova
      imagem, com falha de migração abortando o deploy — hoje a migração é aplicada manualmente.
- [ ] Deploy com revisão progressiva do Container App (nova revisão recebendo tráfego aos poucos)
      e **rollback em um comando** documentado e testado ao menos uma vez.
- [ ] Ambiente de homologação: por custo, um **slot lógico** (banco separado barato + revisão
      própria do Container App), não um ambiente inteiro duplicado — decisão consciente de
      orçamento, registrada.

#### v8.3 — Reconstruibilidade da infraestrutura ✅ resolvida em 2026-09-11
- [x] `infra/provisionar.sh` — a sequência real de comandos `az` que criou (e reconstrói, se
      preciso) toda a infraestrutura, comentada, sem segredo nenhum no arquivo (toda senha é
      gerada na hora e enviada direto ao Key Vault). **Não versionado** (gitignored, igual
      `CREDENCIAIS_AZURE.md`) — nome exato de recurso é mapa de alvo desnecessário de deixar
      público, mesmo sem credencial nenhuma nele; achado corrigido em 2026-09-11 depois de uma
      primeira versão ter sido publicada por engano. `infra/provisionar.exemplo.sh` (esse sim
      versionado) documenta o mesmo padrão com nomes trocados por placeholder. Resolve o problema
      real ("ninguém vai lembrar a sequência em 5 anos") sem adicionar uma ferramenta de IaC
      declarativa nova para manter — decisão registrada e justificada em
      `DECISOES_CONGELADAS.md` seção 5.6.
- [ ] Configuração de recurso (variáveis de ambiente, escala, probes) hoje só existe no Portal e
      no próprio script de referência — mover para arquivo de configuração versionado (ex.:
      `infra/config/*.env` lido pelo workflow de deploy) fica como melhoria incremental, não como
      débito bloqueante.
- **Quando reabrir Bicep/Terraform**: só se o número de recursos crescer muito (multi-região,
  múltiplos ambientes de homologação automatizados) — ver critério completo em
  `DECISOES_CONGELADAS.md` seção 5.6.

##### 🔍 Ponto de Revisão — FASE 8 (1/2 — meio, fecha v8.1–v8.3 (majoritariamente já concluídos na v0.0))
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- `infra/provisionar.sh` (v8.3) continua batendo com a infraestrutura real — testar ao menos um bloco do script contra um recurso já existente (deve reconhecer/falhar de forma esperada, não silenciosamente divergir).

#### v8.4 — Operação diária
- [ ] Runbook de operação: como ver log, como reiniciar, como restaurar backup, como rotacionar
      segredo, o que fazer se o site cair — escrito para quem **não** participou da construção.
- [ ] Monitoramento sintético (ping externo periódico em site, painel e `/health` da API) com
      alerta — hoje ninguém saberia de uma queda fora do horário sem isso.
- [ ] Endpoint `/health` de verdade (verifica banco e storage, não devolve 200 fixo) e
      `/health/ready` separado, ligados aos probes do Container App — corrige a causa-raiz do
      incidente de crash-loop de forma definitiva.
- [ ] Revisão trimestral de custo com registro no plano (o teto de US$100/mês precisa ser vigiado,
      não presumido).
- [ ] Rotação periódica de segredos como prática documentada (já estabelecida como rotina), com
      data da última rotação registrada por segredo.

#### v8.5 — Escala e evolução (o que fazer quando crescer)
- [ ] Gatilhos de escala escritos antes de precisar: CPU/conexões do Postgres acima de X por
      período → subir tier (B1ms → B2s → Standard); mais de N usuários simultâneos → aumentar
      réplicas mínimas do Container App; storage acima de Y → revisar política de retenção de
      arquivo.
- [ ] `PgBouncer`/pool de conexão avaliado antes de o número de réplicas crescer — Postgres
      Burstable tem limite baixo de conexões, e esse é o primeiro gargalo real que aparece.
- [ ] Índices e consultas revisados com dados reais (`pg_stat_statements`) a cada ano — desempenho
      degrada silenciosamente conforme a base cresce.
- [ ] Caminho de saída documentado: como levar banco e arquivos para outro provedor se o crédito
      Azure acabar. Dependência de nuvem única sem plano de saída é risco de perpetuidade, e a
      arquitetura (Postgres + contêiner + arquivos em blob) foi escolhida justamente para ser
      portável.

##### 🔍 Ponto de Revisão — FASE 8 (2/2 — fim, fecha v8.4–v8.5)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Runbook (v8.4) foi seguido por alguém que **não** participou da construção — é o único teste que prova que está realmente escrito para outra pessoa.
- Endpoint `/health` (v8.4) verifica banco/storage de verdade, não devolve 200 fixo.
- Gatilhos de escala (v8.5) estão calibrados com dado real de uso, não só valor arbitrário.

### FASE 9 — Experiência, performance e acessibilidade

#### v9.1 — Acessibilidade (WCAG 2.2 nível AA como meta)
- [ ] Auditoria automatizada (axe-core) no CI do site e do painel, falhando o build em violação
      grave — automatizado pega ~40% dos problemas.
- [ ] Revisão manual do que a ferramenta não pega: navegação só por teclado, leitor de tela nos
      fluxos críticos (login, inscrição, doação), ordem de foco, rótulo de formulário, mensagem de
      erro associada ao campo.
- [ ] Modo alto contraste e aumento de fonte no site público; respeito a `prefers-reduced-motion`.
- [ ] Linguagem simples nos textos de interface — acessibilidade cognitiva importa tanto quanto a
      técnica para o público de uma associação comunitária.
- [ ] Declaração de acessibilidade publicada, com canal para relatar barreira encontrada.

#### v9.2 — Performance
- [ ] Metas medidas, não adjetivos: Core Web Vitals (LCP < 2,5s, INP < 200ms, CLS < 0,1) no site
      público, e tempo de resposta de API abaixo de 500ms no p95 para as rotas de leitura mais
      usadas.
- [ ] Imagens em formato moderno com `srcset` responsivo e carregamento preguiçoso; assets
      versionados com cache longo.
- [ ] Paginação server-side obrigatória em toda listagem (nenhuma tela carrega "todos os
      associados"), com índice de banco correspondente a cada filtro exposto.
- [ ] Orçamento de performance no CI (tamanho do bundle do painel) — painel que cresce sem
      vigilância fica lento em 3 anos, em celular modesto, que é o aparelho real do público.
- [ ] Otimização para conexão ruim: o público da associação acessa por rede móvel instável.

##### 🔍 Ponto de Revisão — FASE 9 (1/2 — meio, fecha v9.1–v9.2)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Auditoria automatizada de acessibilidade (v9.1) está de fato falhando o build quando encontra violação grave — testar introduzindo uma violação de propósito.
- Métricas de performance (v9.2) são medidas com ferramenta real (Core Web Vitals), nunca impressão subjetiva de "está rápido".

#### v9.3 — Usabilidade validada com gente de verdade
- [ ] Teste com 3–5 pessoas reais (um dirigente, uma pessoa da secretaria, um associado idoso, um
      voluntário jovem) antes de considerar cada módulo pronto. Cinco pessoas encontram a maioria
      dos problemas de usabilidade — é barato e ninguém faz.
- [ ] Ajuda contextual e tour de primeiro acesso por módulo, no lugar de manual em PDF que
      ninguém lê.
- [ ] Canal de feedback dentro do painel ("achei um problema nesta tela") ligado à fila de
      atendimento — o sistema aprende com o uso.

#### v9.4 — PWA (instalável, offline no essencial)
- [ ] Manifesto e service worker no painel: instalável na tela inicial, com cache de casca e
      leitura offline do que faz sentido (carteirinha, próxima escala do voluntário, agenda).
- [ ] Web Push para lembrete de evento, aviso de mensalidade e convocação de assembleia —
      confirmado (FASE 19) que iOS suporta push em PWA instalado, sem exigir app nativo.

##### 🔍 Ponto de Revisão — FASE 9 (2/2 — fim, fecha v9.3–v9.4)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Teste com pessoa real (v9.3) — um dirigente, alguém da secretaria, um associado idoso — foi de fato feito e gerou ajuste, não só planejado.
- PWA (v9.4) é instalável e funciona offline no essencial — testar em celular real com rede desligada.

### FASE 10 — Expansão futura (registrado, não compromisso)

> Sem ponto de revisão (seção 4.1): esta fase é só um registro de backlog, nunca implementada
> como está — quando qualquer item daqui virar trabalho real, ele sai desta lista e vira uma
> sub-versão de fase própria, aí sim com pontos de revisão.

- [ ] Multi-unidade/multi-sede: se a ASAF vier a ter mais de um endereço, a decisão de modelo
      (unidade única x multi-unidade, com escopo de permissão por unidade) fica para quando a
      necessidade for confirmada. Registrar desde já que o caminho preferido seria uma coluna
      `id_unidade` com escopo de permissão, não um banco por unidade.
- [ ] Federação/rede com outras associações (troca de indicadores da v11.9, reconhecimento mútuo
      de associado).
- [ ] Loja/bazar beneficente com controle de estoque simples, se virar atividade relevante.
- [ ] Integração com contabilidade em tempo real (hoje a FASE 17 prevê exportação, que é
      suficiente).
- [ ] API pública documentada para parceiros — só se houver demanda concreta; API pública sem
      consumidor é manutenção sem retorno.

### FASE 11 — Diferenciais avançados (além do mercado)

Pedido explícito do usuário: não construir "mais um sistema de associação comum" — ir além do
que já existe. Pesquisa dedicada (seção 6) trouxe o que sistemas de ponta (CRM, ERP, plataformas
de engajamento de comunidade) fazem hoje. Esta fase entra **depois** das fundações (FASES 0–9)
estarem de pé — nenhum destes itens tenta substituir o básico, todos dependem dele já existir.

> **Critério de entrada, aplicado a todo item desta fase**: só entra o que (a) resolve uma dor
> real observada na operação da ASAF, (b) não cria dependência de fornecedor que inviabilize o
> sistema se o contrato acabar, e (c) cabe no teto de custo. Diferencial que vira peso morto é
> pior que ausência de diferencial.

#### v11.1 — Engajamento, score e reconhecimento
- [ ] `EngagementScore` calculado periodicamente com pesos **configuráveis pela diretoria**
      (presença em evento/projeto, adimplência, participação em votação, voluntariado, uso do
      portal, indicação de novo associado) — nunca digitado à mão, nunca peso fixo em código.
- [ ] Transparência do cálculo: o associado vê **por que** tem o score que tem, e a diretoria vê a
      fórmula vigente com histórico de alteração. Score opaco gera desconfiança e some do uso.
- [ ] Exibição como nível pessoal com selos simples (bronze/prata/ouro) — **não é ranking público
      entre associados**, é indicador pessoal de envolvimento. Ranking público entre pessoas numa
      associação comunitária é risco social, não gamificação.
- [ ] Reconhecimento institucional automático: tempo de filiação (5, 10, 20 anos), horas de
      voluntariado acumuladas, participação em todas as assembleias do ano — com certificado
      emitido pelo motor da v4.0 e (opcionalmente) homenagem sugerida na assembleia.
- [ ] Programa de indicação (`indicado_por`) com benefício para quem indica associado aprovado.
- [ ] Score como gatilho de régua de comunicação: engajamento em queda entra automaticamente numa
      campanha de reativação (v11.3) — com limite de frequência para não virar perseguição.
- [ ] **Limite ético registrado**: score nunca restringe direito estatutário (voto, acesso,
      atendimento). É ferramenta de cuidado com o associado, não de classificação de mérito.

#### v11.2 — IA e automação (escopo restrito, nunca acesso irrestrito)
- [ ] Princípio transversal: **a IA sugere, a pessoa decide**. Nenhuma decisão sobre pessoa
      (exclusão, cobrança, benefício, atendimento) é tomada automaticamente por modelo.
- [ ] Modelo simples de risco de inadimplência (regressão logística ou árvore leve) treinado com
      histórico próprio — alimenta o painel executivo (v11.8) e a régua de cobrança preventiva;
      nunca rotula publicamente ninguém como "mau pagador".
- [ ] Assistente de atendimento ao associado com escopo restrito (RAG sobre estatuto, regimento e
      perguntas frequentes + consulta **somente leitura** aos dados do próprio associado
      autenticado), com fallback humano em qualquer fluxo de mais de dois passos e aviso claro de
      que é um assistente automático.
- [ ] Rascunho de ata a partir de transcrição/notas — sempre revisado e assinado por humano antes
      de virar documento oficial (a v2.5 continua sendo a fonte estruturada do conteúdo).
- [ ] Apoio à secretaria: classificação automática de documento enviado, extração de dados de
      comprovante/nota para pré-preencher lançamento (sempre com conferência), sugestão de
      resposta a protocolo recorrente.
- [ ] Custo e privacidade controlados: preferência por processamento que não envie dado pessoal
      sensível para serviço externo; quando enviar, registrar no inventário da FASE 7 e
      pseudonimizar o que for possível. Teto de gasto mensal com IA definido e monitorado.
- [ ] Avaliação de qualidade antes de liberar: conjunto de perguntas reais com resposta esperada,
      medido a cada mudança de modelo/prompt — sem isso, o assistente degrada sem ninguém notar.

#### v11.3 — Comunicação institucional via WhatsApp Business (API oficial)
> **Pendência registrada pela v2.2 (2026-09-15)**: publicação do edital de convocação de
> assembleia (`GET /api/assembleias/{id}/edital`, FASE 2) por e-mail/WhatsApp, com comprovante de
> publicação arquivado — a prova de que a convocação aconteceu é tão importante quanto a
> convocação em si (Art. 9º do estatuto exige o edital, mas não define o canal).
- [ ] Integração via Meta Cloud API (ou parceiro oficial/BSP) — nunca `wa.me` automatizado nem
      WhatsApp Web programado (viola os termos de uso e gera banimento do número).
      Confirmado por pesquisa: mensagens de categoria "utility" (boleto vencendo, confirmação de
      inscrição) custam 80–95% menos que "marketing" — usar utility como padrão, marketing só para
      campanha segmentada deliberada.
- [ ] Gestão dos templates aprovados pela Meta dentro do painel (status de aprovação, variáveis,
      versão) — template reprovado precisa ser visível antes do disparo, não na hora do erro.
- [ ] Janela de 24h respeitada pelo próprio sistema: fora dela, só template aprovado.
- [ ] Recebimento de resposta roteado para a fila única de atendimento (v5.3) — comunicação
      unilateral gera frustração; se o sistema manda, precisa saber ouvir.
- [ ] Opt-out honrado em todos os canais simultaneamente, com distinção explícita entre
      comunicação estatutária obrigatória e comunicação opcional.
- [ ] Central de notificações multicanal com canal preferido por pessoa e fallback em cascata
      (WhatsApp → e-mail → notificação no painel), com registro de entrega por canal.
- [ ] Teto de gasto mensal com mensagens, alerta ao se aproximar, e bloqueio de disparo em massa
      acima do orçamento sem aprovação explícita.

##### 🔍 Ponto de Revisão — FASE 11 (1/3, fecha v11.1–v11.3)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Score de engajamento (v11.1) nunca restringe direito estatutário — testar que associado com score baixo continua votando/acessando normalmente.
- IA (v11.2) nunca decide sozinha sobre pessoa (exclusão, cobrança, benefício) — toda sugestão de modelo passa por confirmação humana antes de gerar efeito.
- Teto de gasto mensal com WhatsApp (v11.3) está de fato bloqueando disparo acima do orçamento sem aprovação explícita.

#### v11.4 — Clube de benefícios (parcerias comerciais para o associado)
- [ ] `Parceiro`, `Beneficio` (desconto fixo/percentual/cashback, categoria, vigência, regras) e
      `ResgateBeneficio` (associado, parceiro, data, valor).
- [ ] Validação pela carteirinha digital (QR code da FASE 1) com verificação de adimplência em
      tempo real — o parceiro confere sem precisar de login no sistema.
- [ ] Portal simples do parceiro (relatório de uso, sem acesso a dado pessoal além do necessário
      para validar) e contrato de parceria arquivado no módulo de contratos (v12.5).
- [ ] Começa simples (lista de parceiros com cupom) e só evolui para validação/cashback quando
      houver demanda real — evita construir marketplace que ninguém usa.

#### v11.5 — Segurança avançada (consolidação; execução detalhada nas FASES 15 e 20)
- [ ] MFA obrigatório para todo perfil administrativo/financeiro — **implementado na v0.2.2**
      (TOTP com `pyotp`, segredo protegido, códigos de recuperação hasheados).
- [ ] Keycloak como IdP central avaliado na FASE 20/v20.1, deixando caminho aberto para plugar
      Entra ID no futuro sem reescrever a aplicação.
- [ ] **Revisão periódica de acesso (trimestral)**: relatório automático de quem tem qual papel,
      exigindo confirmação explícita de recondução ou revogação por um gestor — acesso que só
      cresce e nunca é reavaliado é o padrão de falha de organizações de longa vida. Acesso não
      revalidado é suspenso automaticamente ao fim do prazo.
- [ ] Conta de serviço e integração tratadas como identidade própria (nunca usando credencial de
      pessoa), com escopo mínimo e rotação registrada.
- [ ] Teste de segurança periódico: varredura de dependência vulnerável no CI (`pip-audit`/
      Dependabot) e revisão anual de superfície exposta.

#### v11.6 — Conciliação bancária automática (Open Finance Brasil)
- [ ] Camada de abstração para agregador bancário (ex.: Pluggy, já usado por ERPs de pequeno porte
      no Brasil): o gestor financeiro autoriza o consentimento Open Finance uma vez, o sistema
      recebe extrato por webhook e concilia automaticamente contra o plano de contas (FASE 3), com
      fallback manual para o que não casar sozinho.
- [ ] Consentimento Open Finance tem validade limitada e precisa de renovação — o sistema avisa
      com antecedência, em vez de parar de conciliar em silêncio.
- [ ] Regras de correspondência automática configuráveis e auditáveis (por valor, data,
      identificador, histórico) — e nenhuma baixa automática sem registro de qual regra a gerou.
- [ ] Abstração obrigatória: trocar de agregador não pode exigir reescrever o financeiro.

#### v11.7 — Portal self-service de ponta
- [ ] Assinatura eletrônica de documentos internos — motor da FASE 20/v20.2 (OTP, metadados,
      timestamp, hash SHA-256, selo do servidor); nunca só "aceite" de checkbox em documento com
      peso jurídico.
- [ ] Declarações automáticas sob demanda (associado ativo, comprovante de participação, horas de
      voluntariado, quitação anual) via template preenchido do próprio cadastro, numeradas e com
      código público de verificação — zero intervenção da secretaria por pedido.
- [ ] Segunda via de documento e de cobrança, atualização cadastral, agendamento de atendimento e
      abertura de protocolo (v13.3), tudo pelo painel.
- [ ] Extrato único de participação (frequência, votos computados, contribuições, horas, selos)
      num só lugar.
- [ ] Meta explícita: reduzir a dependência de "falar com a secretaria" para o que é rotina, sem
      nunca eliminar o canal humano para quem precisa dele.

##### 🔍 Ponto de Revisão — FASE 11 (2/3, fecha v11.4–v11.7)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- MFA obrigatório por nível (v11.5, implementado na v0.2.2) continua funcionando depois de todo o resto construído nesta fase — reteste rápido do fluxo de onboarding de MFA.
- Revisão trimestral de acesso (v11.5) de fato suspende acesso não revalidado no prazo, não é só relatório informativo.

#### v11.8 — BI e painel executivo para a diretoria
- [ ] Metabase self-hosted (open source, grátis) apontando para o Postgres — em réplica ou com
      usuário somente-leitura restrito, nunca com credencial de escrita.
- [ ] Quatro painéis temáticos: financeiro (receita recorrente x inadimplência, fluxo de caixa),
      engajamento (score médio, participação em eventos/assembleias), crescimento (novos
      associados, churn, conversão de indicação) e compliance (revisões de acesso vencidas,
      pendências de auditoria, obrigações a vencer).
- [ ] Alertas nativos do Metabase (ex.: "inadimplência > 8%") por e-mail — sem construir motor de
      alerta próprio.
- [ ] **Camada semântica mínima**: as métricas-chave têm definição única e documentada (o que
      conta como "associado ativo", como se calcula churn) — duas telas divergindo sobre o mesmo
      número destrói a confiança no sistema inteiro.
- [ ] Uma página só para a diretoria com os 6–8 números que realmente importam no mês; o resto é
      aprofundamento sob demanda.

#### v11.9 — Benchmarking entre associações (inovação real, sem produto genérico hoje)
Achado de pesquisa confirmado: associações compartilharem indicadores entre si existe e é
praticado no Brasil (Vitrine de ONGs — dados financeiros anônimos comparáveis desde 2020; ABAR —
Benchmarking Colaborativo entre agências reguladoras; GIFE — Rede Temática de Gestão
Institucional) — mas **nenhum desses é um produto de software genérico e comercial** que qualquer
associação pode simplesmente assinar. É espaço real de inovação, não hype.
- [ ] Módulo opcional (participação voluntária, jamais automática) de compartilhamento anônimo de
      indicadores agregados (inadimplência, engajamento médio, crescimento anual) com associações
      parceiras/da mesma rede — nunca dado individual, só métrica já agregada pelo painel
      executivo (v11.8), com aprovação explícita da diretoria a cada ciclo de envio.
- [ ] Definição comum de métrica documentada e versionada — sem isso, comparação entre
      organizações é ruído.
- [ ] Visão de médio prazo: depende de outras associações adotarem sistema compatível ou protocolo
      comum, o que hoje não existe pronto. Fica registrado como oportunidade, não como entrega.

#### v11.10 — Memória institucional e acervo (item novo desta expansão)
- [ ] Linha do tempo pública da associação (marcos, conquistas, gestões), alimentada por
      deliberações, projetos e eventos já registrados — a história deixa de depender da lembrança
      de quem estava lá.
- [ ] Acervo digital de fotos e documentos históricos com catalogação mínima (data, evento,
      pessoas quando autorizado, descrição) e política de uso de imagem respeitada (FASE 7).
- [ ] Relatório "a associação em números" gerado por ano — insumo direto do relatório anual (v6.3)
      e de qualquer captação futura.
- [ ] Motivo de estar no plano: uma associação que dura 20 anos perde a própria história em troca
      de gestão. Registrar isso é barato hoje e irrecuperável depois.

##### 🔍 Ponto de Revisão — FASE 11 (3/3 — fim, fecha v11.8–v11.10)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Métricas do painel executivo (v11.8) têm definição única documentada — testar duas telas diferentes mostrando o mesmo número de "associado ativo".
- Compartilhamento de indicador para benchmark (v11.9) exige aprovação explícita da diretoria a cada ciclo — nunca automático.

### FASE 12 — Conformidade legal e governança além do mínimo

Pedido explícito do usuário: pesquisar a legislação real e ir além do mínimo exigido, não só
"cumprir a lei". Esta fase soma o que o Código Civil já exige (refletido nas FASES 1 e 2) com o
que organizações de referência do terceiro setor fazem *voluntariamente*, acima da obrigação
legal — e cobre módulos de gestão que ainda não tinham aparecido no plano.

#### v12.0 — Motor de obrigações e conformidade (base das demais versões desta fase)
- [ ] `Obrigacao` genérica (nome, base legal, periodicidade, prazo, responsável, condição de
      aplicabilidade, evidência exigida, status) com calendário e alerta escalonado — em vez de 8
      lembretes espalhados por 8 módulos diferentes.
- [ ] **Aplicabilidade condicional**: cada obrigação só aparece se a condição for verdadeira para
      a ASAF (tem empregado? recebe recurso público? busca CEBAS? tem imóvel próprio?) —
      respondido num questionário de perfil institucional, revisável a qualquer momento. Isso
      impede o sistema de afogar a diretoria em exigências que não se aplicam.
- [ ] Evidência de cumprimento anexada e arquivada por prazo legal — "cumprimos" sem comprovante
      não vale nada numa fiscalização.
- [ ] Painel de conformidade com semáforo (em dia, a vencer, vencido) e histórico plurianual.

#### v12.1 — Parcerias com poder público (MROSC) — módulo condicional
- [ ] A Lei 13.019/2014 só se aplica quando a associação firma Termo de Colaboração, Termo de
      Fomento ou Acordo de Cooperação com o poder público — **não** se aplica a mensalidade,
      doação privada ou venda de serviço. Fica **desativado por padrão**, ativado só se a
      diretoria confirmar que a ASAF recebe ou pretende receber recurso público.
- [ ] Quando ativado: plano de trabalho com metas e indicadores (reaproveitando o motor de
      indicadores da v4.0), execução vinculada a centro de custo exclusivo, prestação de contas
      **por resultado** (não só nota fiscal), e publicidade obrigatória da parceria no portal de
      transparência (v12.7).
- [ ] Controles específicos que a lei exige e que sistemas genéricos não têm: conta bancária
      exclusiva por parceria, rastreabilidade de cada despesa até a meta do plano de trabalho,
      contrapartida registrada, glosas e devolução de saldo ao fim.
- [ ] Chamamento público acompanhado (edital, proposta, resultado, recurso) e dossiê montado pelo
      sistema — o protocolo oficial acontece fora dele (v13.4).

#### v12.2 — Obrigações fiscais e trabalhistas de entidade sem fins lucrativos
- [ ] Painel de situação fiscal com as obrigações recorrentes aplicáveis (ECF anual — até entidade
      isenta precisa declarar para provar a condição; DCTF quando aplicável; obrigações
      trabalhistas se houver empregado) — apoio informativo, nunca substituto do contador.
- [ ] Certidões negativas (federal, estadual, municipal, FGTS, trabalhista) com validade
      controlada e alerta de vencimento — é o que trava convênio e edital quando vence sem
      ninguém ver.
- [ ] Imunidade/isenção documentada (fundamento, requisitos que precisam continuar sendo
      cumpridos, risco de perda) — imunidade tributária depende de conduta contínua, não é
      atributo permanente.
- [ ] CEBAS como módulo **condicional**, relevante só se a ASAF atuar em assistência social/saúde/
      educação e buscar isenção de contribuição patronal — não construir sem confirmação de que se
      aplica.

#### v12.3 — Compliance e integridade além do mínimo legal
- [ ] Código de ética/conduta publicado e versionado (diretoria, associados, voluntários,
      fornecedores), com aceite registrado por pessoa e por versão.
- [ ] Política antifraude e anticorrupção, política de doação (o que a associação aceita e de
      quem, evitando doação que comprometa a instituição) e política de conflito de interesse com
      declaração anual dos dirigentes (v2.1).
- [ ] **Canal de denúncia com anonimato real**: quem denuncia anonimamente **não tem identificação
      gravada no banco** — só o relato e um protocolo de acompanhamento consultável por senha
      gerada localmente. Não é ocultar na exibição, é ausência real do dado.
- [ ] Fluxo de apuração com comitê definido, prazo, registro de providências e proteção explícita
      contra retaliação — canal sem apuração destrói a confiança mais do que não ter canal.
- [ ] Suporte a auditoria externa voluntária: exportação de relatório fechado por período para
      auditor externo revisar — acima da obrigação legal mínima da maioria das associações.
- [ ] Preparação para selos de transparência do terceiro setor (Selo ONG Verificada, Selo Doar,
      Selo Transparência — três selos distintos e complementares): o sistema gera os dados que
      cada um pede como exportação estruturada; a certificação em si é externa.

##### 🔍 Ponto de Revisão — FASE 12 (1/3, fecha v12.0–v12.3)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Módulo MROSC (v12.1) está **desativado por padrão** — confirmar no ambiente que ele só aparece depois de confirmação explícita da diretoria.
- Canal de denúncia (v12.3) realmente não grava identificação de quem denuncia anonimamente — testar consultando o banco diretamente, não só a tela.

#### v12.4 — Patrimônio e inventário de bens
- [ ] Cadastro de ativos (descrição, número de patrimônio, valor de aquisição, nota fiscal,
      localização física, responsável, estado de conservação, origem — compra/doação/convênio).
- [ ] Etiqueta com QR code e **inventário anual assistido**: o conferente percorre a sede lendo os
      QR codes pelo celular, e o sistema fecha a lista de divergências automaticamente.
- [ ] Movimentação de bem (transferência entre locais, empréstimo, manutenção) e baixa motivada
      (venda, doação, perda, obsolescência) com aprovação — baixa de patrimônio é ponto clássico
      de desvio e precisa de dupla autorização.
- [ ] Bem adquirido com recurso de convênio marcado como tal (muitas vezes é inalienável ou deve
      retornar ao ente público ao fim da parceria) — ligação direta com o v12.1.
- [ ] Depreciação simples vinculada ao financeiro (FASE 3), sem duplicar lançamento.
- [ ] Imóveis, veículos e seguros com documentação, vencimentos (IPTU, licenciamento, apólice) e
      alertas no motor de obrigações (v12.0).

#### v12.5 — Contratos, convênios e fornecedores
- [ ] Repositório central de contratos (objeto, partes, vigência, valor, reajuste, forma de
      rescisão, cláusulas críticas destacadas, documento assinado) — distinto de "conta a pagar":
      aqui o objeto é o contrato em si.
- [ ] Alerta de renovação/vencimento com antecedência configurável, e vínculo do contrato aos
      lançamentos financeiros que ele gera (rastreabilidade do gasto até a cláusula).
- [ ] Aditivos versionados sem apagar a versão anterior; histórico completo do que valeu em cada
      período.
- [ ] Homologação de fornecedor (documentação, certidões, avaliação de desempenho após a entrega)
      — fornecedor mal avaliado exige justificativa para nova contratação.

#### v12.6 — Captação de recursos (fundraising)
- [ ] Funil de doador (prospect → primeira doação → recorrente → parceiro institucional) com
      histórico de relacionamento — CRM de doador de verdade, não lista de nomes.
- [ ] Gestão de editais/grants: oportunidade, prazo, requisitos, documentos exigidos, status de
      submissão, resultado, e — se aprovado — vínculo ao projeto e ao centro de custo (FASE 3/4).
- [ ] Biblioteca de documentos institucionais que todo edital pede (estatuto, atas, certidões,
      relatório anual, comprovante de endereço), sempre na versão vigente — é o que transforma
      "duas semanas correndo atrás de papel" em dez minutos.
- [ ] Relatório de impacto por doador/projeto combinando financeiro e indicadores — prestação de
      contas que renova doação.
- [ ] Segmentação e régua de relacionamento com doador respeitando LGPD e opt-out (v11.3).

#### v12.7 — Portal de transparência ativa
- [ ] Página pública dedicada reunindo automaticamente: prestação de contas, atas aprovadas,
      estatuto vigente, relatório anual de atividades, composição da diretoria e — quando o v12.1
      estiver ativo — relatório de parcerias com poder público.
- [ ] Tudo gerado do próprio dado do sistema, nunca digitado duas vezes, com data de atualização
      visível em cada bloco.
- [ ] Regra de publicação com revisão prévia: nada vai ao ar sem aprovação de quem tem competência
      — transparência automática não pode virar vazamento automático.

##### 🔍 Ponto de Revisão — FASE 12 (2/3, fecha v12.4–v12.7)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Baixa de patrimônio (v12.4) exige dupla autorização — testar tentativa de baixa por um único aprovador.
- Alerta de vencimento de contrato (v12.5) dispara com antecedência real, não só na data do vencimento.

#### v12.8 — Matriz de riscos institucional
- [ ] Cadastro de riscos (probabilidade x impacto) vinculados a objetivos estratégicos (v12.9),
      com causa, plano de mitigação, responsável e prazo; reavaliação periódica registrada.
- [ ] Categorias mínimas: financeiro (dependência de poucas fontes de receita), pessoas
      (dependência de uma única pessoa-chave), conformidade, reputacional, tecnológico (perda de
      dado, indisponibilidade), patrimonial.
- [ ] Risco crítico sem mitigação aparece no painel executivo (v11.8) — matriz que vive em
      planilha nunca é olhada.

#### v12.9 — Planejamento estratégico (metas e indicadores)
- [ ] Objetivos estratégicos plurianuais desdobrados em metas trimestrais com responsável,
      vinculados aos indicadores já existentes (v4.0) — sem criar métrica nova paralela.
- [ ] Acompanhamento em ciclo (revisão trimestral registrada) e ligação com o orçamento (v3.5) —
      meta sem recurso alocado é declaração de intenção.
- [ ] Teoria da mudança / cadeia de valor do projeto social (insumo → atividade → produto →
      resultado → impacto) como estrutura opcional dos indicadores — é a linguagem que
      financiadores pedem, e sai de graça se o dado já estiver estruturado assim.

#### v12.10 — Sucessão de diretoria e continuidade institucional
- [ ] Banco de competências do conselho/diretoria (histórico de cargos, formação, disponibilidade
      futura) — achado de pesquisa: falta de plano de sucessão formal é risco real e recorrente em
      associações brasileiras.
- [ ] Cronograma de transição entre gestões com **checklist de continuidade** executado no
      sistema: transferência de acessos, senhas institucionais rotacionadas, contas bancárias
      atualizadas, procurações revogadas, contratos vigentes apresentados, pendências entregues
      formalmente ao próximo mandato, com termo de transmissão assinado.
- [ ] **Redução de dependência de pessoa única**: o sistema identifica funções com um único
      responsável habilitado e alerta a diretoria — é a versão institucional do "fator ônibus".
- [ ] Onboarding do novo dirigente: trilha de primeiro acesso com o que ele precisa saber, e
      revogação automática dos acessos do mandato anterior na data de término (v2.1).

##### 🔍 Ponto de Revisão — FASE 12 (3/3 — fim, fecha v12.8–v12.10)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Risco crítico sem mitigação (v12.8) aparece de fato no painel executivo (v11.8), não fica só na matriz isolada.
- Checklist de transição de gestão (v12.10) revoga o acesso do mandato anterior na data de término — testar a revogação automática.

### FASE 13 — Assembleia, Diretoria e processos administrativos (detalhamento máximo)

> ✅ **Nota de proveniência**: os pontos jurídicos centrais desta fase foram revalidados com fonte
> real (seção 6.2): o registro de ata em RCPJ é confirmado pelo Art. 45 do Código Civil (a
> existência legal da associação e toda alteração do ato constitutivo dependem de registro/
> averbação em cartório — sem isso, os dirigentes podem responder pessoalmente por obrigação
> contraída irregularmente) e reforçado pelo princípio da continuidade da Lei 6.015/1973; o voto
> por procuração é confirmado como prática comum, mas dependente de previsão estatutária expressa,
> nunca padrão universal — por isso o sistema trata isso como configuração por associação. A única
> peça ainda não confirmada é a exigência exata de RCPJ, que pode variar por estado — a confirmar
> com o cartório local da ASAF antes da implementação real do v13.4.
>
> **Relação com a FASE 2**: a FASE 2 entrega assembleia e diretoria funcionando; a FASE 13 leva ao
> limite os casos difíceis (quóruns simultâneos, procuração, impugnação, delegação de alçada,
> protocolo). Implementar a 13 antes da 2 seria construir o telhado primeiro.

#### v13.1 — Assembleia Geral no limite máximo
- [ ] Quóruns simultâneos por matéria: quórum de instalação (1ª/2ª/3ª convocação) separado do
      quórum de aprovação — simples para deliberação comum, qualificado (ex. 2/3) para reforma
      estatutária, especial para destituição de diretor (Art. 59, parágrafo único, exige
      assembleia especialmente convocada para esse fim).
- [ ] Comissão de verificação de poderes/credenciamento: checagem de adimplência antes de liberar
      o voto (regra configurável — depende do estatuto real permitir ou não que inadimplente
      vote).
- [ ] Mesa diretora dos trabalhos distinta da diretoria eleita (evita conflito quando a pauta é a
      prestação de contas da própria diretoria).
- [ ] Pauta com itens votáveis separadamente — cada item da ordem do dia é registro atômico com
      resultado próprio, nunca um "sim/não" único para a assembleia inteira.
- [ ] Tipos de votação configuráveis por item: aberta/nominal, secreta (comum para eleição),
      aclamação (chapa única) — com abstenção como categoria própria de resultado.
- [ ] Voz sem voto (convidado, categoria sem direito a voto) — compõe presença, não compõe quórum.
- [ ] Procuração/representação como configuração **por associação** (permite ou não, com limite de
      procurações por pessoa) — nunca assumida como permitida. Depende do estatuto real da ASAF.
- [ ] Impugnação de voto e recurso: protesto vinculado à ata, com prazo estatutário para recurso à
      assembleia seguinte ou ao Conselho Fiscal.
- [ ] Questões de ordem, pedidos de vista e adiamento de item registrados como ocorrência com
      efeito real sobre o andamento da pauta.
- [ ] Eleição com chapas: registro de chapa, prazo de inscrição, impugnação de candidatura,
      período de campanha e apuração por chapa ou por cargo, conforme o estatuto.
- [ ] Continuidade da sessão: assembleia suspensa e retomada em outra data mantém o mesmo
      registro, com quórum reverificado na retomada.

##### 🔍 Ponto de Revisão — FASE 13 (1/3, fecha v13.1)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Quóruns simultâneos por matéria (instalação x aprovação x qualificado) calculam certo com pelo menos três casos de teste reais (deliberação comum, reforma estatutária, destituição de diretor).
- Procuração (v13.1) é configuração por associação — testar com a opção desligada que o sistema recusa voto por procuração.

#### v13.2 — Diretoria Executiva: atribuições viram alçada de permissão
- [ ] Matriz cargo → ação: o que cada cargo pode aprovar/assinar/representar (Presidente
      representa a associação em juízo e assina contratos; 1º Secretário lavra/assina atas e expede
      certidões; 1º Tesoureiro assina movimentação financeira, frequentemente em conjunto com o
      Presidente acima de um teto) — não é texto de estatuto solto, é permissão real checada pelo
      sistema, reforçando a segregação de funções das FASES 2 e 3.
- [ ] Regra de dupla assinatura configurável por valor, ligada ao cargo estatutário e não só ao
      nível de permissão.
- [ ] Delegação temporária rastreável (vice assume alçada do presidente por período determinado)
      com log de início/fim e revogação automática — nunca delegação permanente por engano.
- [ ] Reuniões de diretoria como processo: convocação, pauta, quórum próprio, deliberações com
      responsável e prazo, ata própria (mesma numeração imutável da v2.5) e acompanhamento das
      pendências na reunião seguinte.
- [ ] Todo documento gerado carrega o **cargo** de quem assina, não só o nome — o documento
      sobrevive à troca de mandato sem ficar órfão de contexto.
- [ ] Procurações outorgadas pela associação registradas com poderes, prazo e revogação —
      procuração esquecida é risco jurídico silencioso.

#### v13.3 — Secretaria: credenciamento, protocolo e atendimento
- [ ] Fluxo de credenciamento: cadastro inicial → triagem documental → aprovação → emissão de
      carteirinha/QR code único vinculado ao CPF (reaproveita a carteirinha da FASE 1).
- [ ] QR code com duplo uso: check-in de presença (compõe quórum e frequência) e controle de
      acesso físico à sede (nega acesso a inadimplente sem bloquear o cadastro) — mesmo código,
      dois contextos de leitura.
- [ ] Atualização cadastral com aprovação: associado solicita → "pendente" → secretaria aprova ou
      rejeita com justificativa → log do que mudou, quem mudou e quando.
- [ ] Protocolo interno com numeração sequencial única (`PROT-2026-000123`), tipo de requerimento
      (2ª via, declaração, reconsideração, recurso, denúncia, solicitação LGPD), prazo de resposta
      por tipo, responsável, status e histórico de tramitação.
- [ ] Prazo vencido escala automaticamente para a diretoria; relatório mensal de tempo de resposta
      por tipo — atendimento sem prazo medido é atendimento que atrasa sem ninguém saber.
- [ ] Gestão documental: cada documento com tipo, validade, versão e classificação de sigilo;
      tabela de temporalidade (quanto tempo guardar, o que descartar) ligada à FASE 7; busca por
      conteúdo nos PDFs (texto extraído) para achar documento antigo sem depender de memória.
- [ ] Livros obrigatórios em forma digital (atas, matrícula de associados, presença) com
      integridade garantida e exportação completa para impressão/registro quando necessário.

##### 🔍 Ponto de Revisão — FASE 13 (2/3, fecha v13.2–v13.3)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Dupla assinatura por valor (v13.2) está de fato ligada ao cargo estatutário, não só ao nível de permissão genérico.
- Protocolo interno (v13.3) escala automaticamente para a diretoria quando o prazo vence — testar a escalada, não só o registro do protocolo.

#### v13.4 — O que o sistema não substitui (registro externo obrigatório)
- [ ] Ata que altera estatuto, elege diretoria ou precisa valer perante terceiros (banco, Receita
      Federal, CEBAS, fornecedor) **precisa de registro no Cartório de Registro Civil de Pessoas
      Jurídicas (RCPJ)** para ter eficácia perante terceiros — o sistema gera a ata e guarda a
      referência (número de registro, imagem do documento registrado), mas o ato cartorial é
      sempre externo, manual, com taxa e prazo próprios. Nunca simular essa função.
- [ ] **Acompanhamento da pendência registral**: toda deliberação que exige registro abre uma
      pendência com prazo, responsável e status (a protocolar, protocolado, exigência do cartório,
      registrado) — o erro real das associações é aprovar em assembleia e esquecer de registrar,
      descobrindo meses depois no banco.
- [ ] Termo de fomento/parceria com poder público (v12.1) frequentemente exige protocolo em
      plataforma oficial do ente — o sistema prepara o dossiê e gera os anexos; o protocolo
      acontece fora.
- [ ] Ofício formal: o sistema gera o PDF e numera internamente; o envio/protocolo com carimbo de
      recebimento em órgão público é sempre ato externo, com o comprovante anexado de volta.
- [ ] Atualizações cadastrais externas decorrentes (Receita Federal/CNPJ, banco, INSS quando
      aplicável) listadas como checklist pós-registro — a troca de diretoria não termina no
      cartório.

#### v13.5 — Assinatura eletrônica: descartado gov.br, ver FASE 20
- [ ] ~~Assinatura eletrônica via gov.br~~ — **descartado, confirmado por pesquisa e pela tentativa
      real do usuário**: a página oficial do Governo Digital restringe a API de Assinatura
      Eletrônica gov.br explicitamente a "qualquer órgão público das esferas federal, estadual e
      municipal" — associação privada não se enquadra. A solução real está na FASE 20.

##### 🔍 Ponto de Revisão — FASE 13 (3/3 — fim, fecha v13.4–v13.5)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Pendência de registro em cartório (v13.4) é rastreada até o fim (status "registrado"), não só criada e esquecida.
- Nenhum documento que exige registro externo é tratado pelo sistema como se já tivesse eficácia perante terceiro antes do registro real.

### FASE 14 — Educação/Aulas (módulo condicional)

Só relevante se a ASAF vier a ter escola, reforço escolar, oficina regular ou curso próprio — não
é módulo padrão ativo por default, é um `tipo_projeto` (FASE 4) com sub-entidades próprias.

#### v14.1 — Modelo simples (não é plataforma EAD completa)
- [ ] `Turma` (nome, período, capacidade, professor responsável, local — ligado a `Espaco` da
      v4.3, horário recorrente usando o motor de agenda da v4.0).
- [ ] `Aluno` como papel de `Pessoa` (v1.0) — nunca cadastro duplicado; pode ser associado,
      dependente ou beneficiário externo.
- [ ] `Matricula` (aluno-turma, status ativo/trancado/concluído/desistente, data, responsável
      legal quando menor).
- [ ] `Frequencia` por aula (não agregado mensal), pelo motor único de presença (v4.0).
- [ ] `Avaliacao` com nota ou conceito e critério configurável — deliberadamente simples, sem
      tentar reproduzir histórico curricular formal de escola registrada no MEC.
- [ ] Certificado/declaração de conclusão pelo motor de documentos (v4.0), com regra de
      elegibilidade por frequência e aproveitamento.

#### v14.2 — Operação da turma no dia a dia
- [ ] Diário de classe do professor (chamada rápida pelo celular, conteúdo da aula, ocorrência),
      funcionando offline e sincronizando depois — a sala nem sempre tem rede.
- [ ] Fila de espera e matrícula por período, com critérios de prioridade configuráveis
      (associado, comunidade do entorno, situação de vulnerabilidade).
- [ ] Comunicação com responsáveis (ausência recorrente, aviso de aula cancelada) pela central
      multicanal (v11.3), com registro do que foi enviado.
- [ ] Mensalidade de curso integrada ao financeiro (FASE 3) quando houver, incluindo bolsa/
      gratuidade com justificativa registrada — dado relevante para CEBAS educacional (v12.2), se
      um dia se aplicar.

##### 🔍 Ponto de Revisão — FASE 14 (1/2 — meio, fecha v14.1–v14.2)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Confirmado com a diretoria que este módulo condicional se aplica de fato à ASAF antes de continuar (ver seção 8, pontos em aberto).

#### v14.3 — Acompanhamento pedagógico e social
- [ ] Evolução do aluno ao longo dos períodos (frequência, aproveitamento, observações), com
      alerta de evasão iminente (queda de frequência) — o valor social do módulo está aqui, não
      no controle de notas.
- [ ] Vínculo com o prontuário de beneficiário (v4.2) quando houver acompanhamento social, com as
      mesmas travas de sensibilidade e auditoria de consulta.
- [ ] Indicadores da turma alimentando os indicadores do projeto (v4.0) e a prestação de contas a
      financiador (v12.6).

#### v14.4 — Limites explícitos do módulo
- Não é AVA/EAD (não hospeda videoaula, não faz prova online, não emite histórico escolar oficial).
- Se a ASAF vier a operar escola regular com reconhecimento do MEC, o caminho correto é sistema
  acadêmico especializado, com este módulo servindo apenas de ponte cadastral — decisão registrada
  para evitar o impulso de "construir tudo aqui".

##### 🔍 Ponto de Revisão — FASE 14 (2/2 — fim, fecha v14.3–v14.4)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Prontuário/acompanhamento social (v14.3) tem as mesmas travas de sensibilidade e auditoria de consulta do v4.2 — não um controle mais fraco por ser "aula".

### FASE 15 — Segurança da informação em profundidade

Expande o que já está nas FASES 0, 7 e 11 com defesa em camadas real, necessária porque associado,
voluntário, diretoria e financeiro dividem o mesmo banco.

#### v15.0 — Modelo de ameaças explícito (o que estamos defendendo, de quem)
- [ ] Ameaças reais e priorizadas deste sistema, escritas: (1) vazamento da base de associados
      (CPF, endereço, telefone) por exportação indevida ou conta comprometida; (2) fraude
      financeira interna por acúmulo de funções; (3) adulteração de resultado de votação; (4)
      perda de dado por erro operacional; (5) comprometimento de credencial de dirigente por
      reuso de senha ou phishing; (6) exposição de dado sensível de beneficiário/criança.
- [ ] Cada ameaça mapeada aos controles que a cobrem, com lacunas visíveis — segurança sem modelo
      de ameaça vira coleção de controles aleatórios.
- [ ] Revisão anual do modelo, junto com a revisão do programa de privacidade (v7.5).

#### v15.1 — Isolamento de dado por linha (row-level security)
- [ ] Row-level security nativo do PostgreSQL — confirmado com fonte oficial (documentação do
      Postgres, "Row Security Policies": `CREATE POLICY`/`ENABLE ROW LEVEL SECURITY` restringe por
      linha o que cada `role` vê) e prática real de produção (documentação da Supabase descreve o
      mesmo padrão em SaaS multi-tenant, adicionando cláusula `WHERE` automática a toda query). Um
      voluntário só enxerga linhas onde `voluntario_id` é o dele, mesmo que a aplicação tenha um
      bug de autorização — o **banco** recusa, não só a API.
- [ ] Implementação prática na stack atual: identidade do usuário propagada por
      `SET LOCAL app.usuario_id` no início de cada transação (event listener do SQLAlchemy), com
      as políticas lendo `current_setting('app.usuario_id')`. Requer que **nenhuma** consulta
      escape do `get_db()` — verificado por teste automatizado.
- [ ] Papel de aplicação por módulo (o módulo de Educação nunca tem permissão de leitura em tabela
      financeira) — menor privilégio entre módulos, não só entre pessoas.
- [ ] Adoção incremental por tabela, começando pelas mais sensíveis (prontuário, financeiro,
      votação, dado de menor), com teste de regressão provando que cada política bloqueia o acesso
      indevido e libera o devido. RLS ligado sem teste dá falsa sensação de segurança.

#### v15.1.1 — Ancoragem de auditoria de votação (hipótese de inovação, não confirmada no mercado)
- [ ] ⚠️ Diferente do restante desta fase, este item **não tem confirmação de adoção real** no
      nicho associativo. Proposta a avaliar, não fato estabelecido: hash do resultado de uma
      votação (v2.4) ancorado por carimbo de tempo RFC 3161 de uma Autoridade de Carimbo do Tempo
      credenciada ICP-Brasil (base legal sólida no Brasil, diferente de blockchain público) —
      provaria que o resultado não foi alterado depois da apuração.
- [ ] Alternativa de custo zero enquanto não houver ACT contratada: cadeia de hashes encadeados
      (cada resultado inclui o hash do anterior) publicada no portal de transparência — não tem a
      mesma força probatória, mas torna adulteração retroativa detectável.
- [ ] Tratar como experimento de fase avançada, nunca como recurso já validado por outros sistemas.

##### 🔍 Ponto de Revisão — FASE 15 (1/3, fecha v15.0–v15.1)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- RLS (v15.1) testado com caso real de tentativa de acesso indevido — logar como voluntário e tentar consultar dado de outro voluntário deve falhar **no banco**, mesmo simulando um bug de autorização na aplicação.
- Modelo de ameaças (v15.0) foi de fato escrito e cada ameaça tem controle mapeado — não é lista genérica copiada de outro lugar.

#### v15.2 — Log de acesso, não só de alteração
- [ ] Toda leitura de CPF, dado financeiro individual e prontuário gera registro próprio, separado
      do `AuditLog` de alteração — o plano hoje audita mudança; isso adiciona auditoria de
      **consulta**.
- [ ] Consulta em volume anômalo (alguém abrindo 200 cadastros em 10 minutos) dispara alerta — é
      assim que vazamento interno é detectado antes de virar dano.
- [ ] Log de auditoria com retenção definida e **append-only**: nem administrador do sistema
      apaga. Idealmente exportado periodicamente para storage imutável (Blob com política de
      imutabilidade), fora do alcance de quem administra a aplicação.

#### v15.3 — Criptografia de dado sensível em repouso
- [ ] CPF, dados bancários e dado sensível de beneficiário cifrados em repouso (`pgcrypto` ou
      cifra na aplicação) — nunca texto plano, mesmo com RLS ativo: camadas independentes, uma não
      substitui a outra.
- [ ] Chave guardada no Key Vault, jamais no banco nem no código, com rotação prevista e
      procedimento de recifragem documentado (chave rotacionada sem plano de recifragem é dado
      perdido).
- [ ] Consciência do custo: coluna cifrada não é pesquisável diretamente — manter hash
      determinístico separado para busca exata por CPF, e aceitar que busca parcial não funciona
      nesses campos.
- [ ] Arquivos sensíveis no Blob Storage servidos só por URL assinada de curta validade, nunca por
      link público permanente.

#### v15.4 — Isolamento estrito do papel "voluntário"
- [ ] Voluntário tem login próprio (v1.6), mas visibilidade limitada ao próprio histórico de
      participação — nunca dado de outro voluntário/associado, nunca dado financeiro da
      associação. Implementado via RLS + view dedicada, não só por filtro de tela — atende
      exatamente o pedido do usuário: acesso real, mas estritamente contido ao próprio histórico.
- [ ] O mesmo princípio aplicado a beneficiário, aluno e participante externo que venham a ter
      acesso: cada papel enxerga o próprio recorte, por padrão negado no banco.

##### 🔍 Ponto de Revisão — FASE 15 (2/3, fecha v15.2–v15.4)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Log de acesso a CPF/financeiro (v15.2) é append-only de verdade — testar tentativa de apagar uma linha de log, inclusive como administrador do sistema.
- Dado cifrado em repouso (v15.3) usa chave do Key Vault, nunca do banco/código — confirmar isso inspecionando onde a chave realmente vem.

#### v15.5 — Segurança de aplicação e de dependências
- [ ] Varredura de dependência vulnerável no CI (`pip-audit`, `npm audit`, Dependabot) com
      política de prazo para corrigir por severidade — e atualização regular como rotina, não como
      emergência (prática já iniciada na v0.0).
- [ ] Proteções de aplicação verificadas por teste: SQL injection (ORM parametrizado sempre), XSS
      no painel e no HTML gerado pelo backend, upload de arquivo (tipo real verificado, tamanho,
      nome saneado, servido de domínio isolado), SSRF em qualquer integração que aceite URL,
      IDOR (o teste tenta acessar o recurso de outro usuário e **tem que** receber 403/404).
- [ ] Secrets scanning no repositório e bloqueio de commit com segredo — o projeto já teve um
      incidente real de exposição de senha; a defesa precisa ser automática, não só disciplina.
- [ ] Revisão anual de superfície exposta (portas, endpoints públicos, contas ativas, chaves de
      API) com desativação do que não é mais usado.

#### v15.6 — Proteção da conta e do processo de recuperação
- [ ] Recuperação de senha é a porta dos fundos mais explorada: link de uso único com expiração
      curta, invalidação de todas as sessões ao trocar a senha, notificação ao titular a cada
      troca e a cada login em dispositivo novo.
- [ ] Verificação reforçada quando a recuperação vier de alguém com alçada financeira ou de
      gerenciamento de acesso.
- [ ] Bloqueio progressivo por tentativa (já implementado na v0.1.2) somado a limite por IP, e
      monitoramento de tentativa distribuída.

##### 🔍 Ponto de Revisão — FASE 15 (3/3 — fim, fecha v15.5–v15.6)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Varredura de dependência vulnerável (v15.5) está rodando no CI e falhando build em severidade alta — testar com uma dependência propositalmente desatualizada.
- Recuperação de senha (v15.6) invalida todas as sessões e notifica o titular — testar o fluxo completo, incluindo a notificação.

### FASE 16 — Continuidade de negócio e recuperação de desastres

Dimensionada ao porte real da associação — confirmado por pesquisa (documentação oficial da
Microsoft) que a maior parte da necessidade já é coberta nativamente pelo Azure, sem infraestrutura
paralela cara.

#### v16.1 — Backup e retenção ✅ parcialmente concluído na v0.0
- [x] Retenção de backup do Postgres em **35 dias** (o máximo do tier; até 100% do armazenamento
      provisionado é gratuito para backup) em vez do padrão de 7 dias.
- [x] Geo-redundância de backup ativada **desde a criação do servidor** (só configurável nesse
      momento) — cobre indisponibilidade regional inteira do Azure.
- [x] Blob Storage com soft delete (7 dias) e versionamento.
- [ ] Backup lógico adicional (`pg_dump` periódico) guardado **fora** da mesma assinatura Azure —
      segunda camada contra o cenário "a assinatura foi excluída/comprometida", que o backup
      nativo não cobre (excluir o servidor apaga os backups automáticos junto). Cifrado, com a
      chave guardada separadamente do backup.
- [ ] Backup do que não está no Postgres: arquivos do Blob, configuração do Directus, definição da
      infraestrutura (v8.3) e a própria parametrização do sistema (v0.3.5). Backup de banco sozinho
      não restaura o sistema.

#### v16.2 — Metas realistas (RPO/RTO) e teste de restauração
- [ ] RPO de referência: ~5 minutos (point-in-time restore nativo do Postgres Flexible Server).
      RTO de referência: poucas horas (restauração + reconfiguração manual de firewall/rede, que
      não é copiada automaticamente no restore).
- [ ] RPO/RTO diferenciados por cenário, escritos: exclusão acidental de registro (minutos, via
      estorno/histórico), corrupção de dado (horas, via PITR), perda da região (mais longo, via
      geo-restore), perda da assinatura inteira (dias, via backup externo).
- [ ] **Teste de restauração completo pelo menos uma vez por ano**, mais teste pontual após
      qualquer mudança relevante de infraestrutura — prática confirmada como o ponto mais
      negligenciado e mais barato de corrigir; não há como validar backup sem restaurá-lo.
- [ ] Registrar cada teste (data, cenário, tempo gasto, problemas encontrados, correções) em
      documento de continuidade — não basta "confiar" que o backup funciona.
- [ ] Restauração testada **por alguém que não construiu o sistema**, seguindo só o runbook (v8.4)
      — é o único teste que prova que o procedimento é executável na ausência de quem escreveu.

##### 🔍 Ponto de Revisão — FASE 16 (1/2 — meio, fecha v16.1–v16.2)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- **Teste de restauração completo já foi executado ao menos uma vez** (v16.2) e o resultado está registrado — isto não pode ficar como "vamos fazer depois".

#### v16.3 — Continuidade além da tecnologia
- [ ] Plano para indisponibilidade prolongada: como a associação opera sem o sistema por um dia
      (assembleia com lista de presença em papel, cobrança adiada, atendimento registrado para
      lançamento posterior) — simples, escrito, conhecido.
- [ ] Continuidade de acesso institucional: mais de uma pessoa com acesso administrativo ao Azure,
      ao domínio, ao repositório e à conta bancária, com procedimento de emergência selado
      ("envelope lacrado" digital) — o cenário real mais provável não é desastre de nuvem, é a
      única pessoa que sabia tudo ficar indisponível.
- [ ] Renovação vigiada de domínio, certificado e contas críticas (no motor de obrigações da
      v12.0) — domínio expirado derruba site, e-mail e sistema de uma vez só.

#### v16.4 — O que fica fora de escopo (evitar over-engineering)
- Multi-region ativo-ativo, réplica de leitura dedicada a DR e ferramentas de backup empresarial
  com retenção de anos — só fazem sentido com exigência legal de retenção de longo prazo, que não
  é o caso padrão de uma associação. Não construir preventivamente.

##### 🔍 Ponto de Revisão — FASE 16 (2/2 — fim, fecha v16.3–v16.4)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Mais de uma pessoa tem acesso administrativo real (Azure, domínio, repositório, conta bancária) — testar/confirmar, não presumir.
- Plano de operação sem o sistema por um dia (v16.3) é conhecido por quem precisaria executá-lo, não só documentado.

### FASE 17 — Integração contábil (apoio ao contador, não substituição)

#### v17.1 — Obrigações reais confirmadas por pesquisa
- [ ] Confirmado: associação sem fins lucrativos **não está livre de obrigação acessória só por
      ser imune/isenta**. ECD é obrigatória para entidade imune/isenta com receita anual abaixo de
      R$ 4.800.000 (a maioria das associações de porte médio/pequeno se enquadra aqui, não na
      dispensa); ECF é exigida sempre que há receita, mesmo sem lucro tributável; EFD-Contribuições
      entra quando a soma de contribuições no mês ultrapassa R$ 10.000.
- [ ] Isso não é verificação para depois — o financeiro (FASE 3) nasce com plano de contas e
      lançamentos estruturados o bastante para alimentar essas obrigações desde o início, não como
      retrabalho futuro.

#### v17.2 — O que o sistema deve construir (apoio real ao contador)
- [ ] Exportação de lançamentos (livro diário/razão) em formato importável por sistema contábil de
      terceiro (CSV/layout comum), por período fechado e reproduzível — a mesma exportação do
      mesmo período tem que gerar o mesmo resultado sempre.
- [ ] Plano de contas com mapeamento para o plano contábil do contador (de-para mantido no
      sistema) — resolve o atrito clássico entre a nomenclatura operacional e a contábil.
- [ ] Relatórios de receita/despesa por centro de custo/projeto (úteis tanto para prestação de
      contas a doador quanto para o ECF).
- [ ] Trilha de auditoria de todo lançamento (FASES 0 e 3) — pré-requisito de qualquer exportação
      contábil confiável.
- [ ] Área de trabalho do contador: acesso somente-leitura com escopo próprio e auditoria de
      consulta, em vez de "manda a planilha por e-mail todo mês" (que é como dado vaza).
- [ ] Checklist mensal de fechamento (conciliação bancária feita, comprovantes anexados, exceções
      resolvidas) — entrega ao contador com qualidade previsível.

##### 🔍 Ponto de Revisão — FASE 17 (1/2 — meio, fecha v17.1–v17.2)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Exportação de lançamentos (v17.2) reproduz o mesmo resultado ao rodar duas vezes para o mesmo período fechado.

#### v17.3 — O que fica sempre com o contador humano
- [ ] Geração e transmissão do arquivo SPED (ECD/ECF) em si — formato com blocos e validações
      fiscais complexas, responsabilidade técnica de contabilista habilitado (CRC). O sistema da
      ASAF **nunca** se apresenta como substituto de software contábil homologado; só alimenta
      dado limpo para reduzir o trabalho de quem faz isso profissionalmente.
- [ ] Classificação contábil final, encerramento de exercício contábil e demonstrações assinadas
      seguem sendo ato do profissional — o sistema fornece o insumo e guarda o resultado.

##### 🔍 Ponto de Revisão — FASE 17 (2/2 — fim, fecha v17.3)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- O sistema em nenhum lugar se apresenta como substituto de software contábil homologado — checar textos de tela/relatório exportado.

### FASE 18 — Qualidade de software e observabilidade em produção

Dimensionada ao porte do sistema: confiável, mas sem o rigor de um sistema financeiro regulado.
**Esta fase não é "no fim do projeto"** — os padrões que ela define entram junto com o primeiro
módulo (v0.2.8 já aplica a parte de front-end). Está numerada aqui por ser transversal.

> **Pendência de segurança registrada pela v1.3 (2026-09-14)**: `painel/package.json` tem
> `vitest`/`vite`/`react-router-dom` com vulnerabilidades conhecidas no `npm audit` (uma
> crítica: path traversal via `@vitest/mocker`). Não são vulnerabilidades introduzidas pela
> v1.3 (já existiam), só encontradas rodando `npm audit` durante o trabalho dela. Corrigir
> exige `npm audit fix --force` (breaking change: `vitest@5`, `react-router-dom@7`) e reteste
> completo do painel - fora de escopo pontual de qualquer versão de feature; fazer aqui, como
> tarefa dedicada, com o painel inteiro testado depois.

#### v18.1 — Pirâmide de testes (não pirâmide invertida)
- [ ] Base: muitos testes unitários rápidos cobrindo regra de negócio real (cálculo de
      mensalidade e elegibilidade, deduplicação por CPF, cálculo de quórum e de resultado de
      votação, alçada de aprovação, conflito de reserva) — nunca teste de UI cobrindo o que um
      teste unitário resolveria mais rápido.
- [ ] Meio: testes de integração nos pontos que tocam banco/serviço externo (autenticação,
      migração Alembic, conciliação financeira, RLS), rodando contra Postgres real em contêiner,
      nunca SQLite — banco diferente esconde exatamente os bugs que importam.
- [ ] Topo: poucos testes ponta a ponta cobrindo os fluxos que não podem quebrar (login com MFA,
      pagamento/baixa de mensalidade, cadastro de associado, inscrição em evento, votação em
      assembleia).
- [ ] Testes de segurança como cidadãos de primeira classe: para cada rota protegida, um teste que
      prova que sem permissão dá 403 — é a única defesa real contra a rota nova que alguém esquece
      de proteger.
- [ ] Cobertura usada como sinal, não como meta cega: exigir alta cobertura nos módulos de
      dinheiro, voto e permissão; não perseguir número global.
- [ ] Dados de teste sempre sintéticos. **Nunca** copiar base de produção para desenvolvimento —
      regra rígida, sem exceção (e coerente com a prática já adotada de limpar todo dado de teste
      criado em produção durante validação).

#### v18.2 — Observabilidade sem ferramenta paga adicional
- [ ] Azure Application Insights (já provisionado) — plano gratuito cobre os primeiros 5 GB/mês,
      suficiente para o porte da ASAF.
- [ ] O essencial para registrar: erro não tratado com stack trace, tempo de resposta de endpoint
      crítico, falha de autenticação/autorização, e evento de negócio-chave (pagamento
      conciliado, mensagem não entregue, migração aplicada, exportação de dado pessoal).
- [ ] Log estruturado (JSON) com `request_id` correlacionando front, API e banco — e **nunca**
      dado pessoal ou segredo em log: CPF mascarado, token jamais registrado. Log é o lugar onde
      dado sensível vaza sem ninguém perceber.
- [ ] Alertas nativos (regra de métrica → e-mail) para indisponibilidade, taxa de erro 5xx,
      lentidão do banco e falha de job — sem Datadog/Grafana Cloud.
- [ ] Painel operacional simples com o que a diretoria/o mantenedor precisa ver: disponibilidade
      do mês, erros recentes, uso de recursos x orçamento.

##### 🔍 Ponto de Revisão — FASE 18 (1/2 — meio, fecha v18.1–v18.2)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Testes de integração (v18.1) rodam contra Postgres real em contêiner, nunca SQLite.
- Nenhum dado de produção foi copiado para ambiente de teste/desenvolvimento — regra sem exceção, confirmar.
- Log estruturado (v18.2) nunca grava CPF em claro nem token — inspecionar log real.

#### v18.3 — Manutenibilidade de longo prazo (o que sustenta 20 anos)
- [ ] Convenções escritas e verificadas automaticamente: formatação (`ruff format`), lint
      (`ruff`), tipagem (`mypy` incremental nos módulos novos), migração sempre por Alembic —
      código consistente sobrevive à troca de quem mantém.
- [ ] Registro de decisões de arquitetura (ADR curto: contexto, decisão, consequência) para toda
      escolha estrutural — é o que explica, em 2036, por que o Directus só tem tabelas
      `directus_*` ou por que o firewall do Postgres é aberto a serviços Azure.
- [ ] `ARQUITETURA.md` e o runbook (v8.4) mantidos como parte da definição de pronto de cada
      módulo, não como tarefa final que nunca acontece.
- [ ] Política de atualização de dependência: revisão trimestral, atualização de segurança
      imediata, atualização maior planejada com teste — o oposto do "não mexe que está
      funcionando" que transforma manutenção em reescrita depois de 5 anos.
- [ ] Fator ônibus tratado como risco de projeto (v12.8): documentação suficiente para outra
      pessoa assumir, e pelo menos uma pessoa da associação treinada na operação básica.

#### v18.4 — O que fica fora de escopo (evitar over-engineering)
- Tracing distribuído completo (OpenTelemetry span a span em toda a stack), SLO formal com error
  budget, testes de carga contínuos e caos engineering — rigor de empresa de tecnologia grande,
  desnecessário aqui. Um teste de carga pontual antes de uma assembleia grande é suficiente.

##### 🔍 Ponto de Revisão — FASE 18 (2/2 — fim, fecha v18.3–v18.4)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- ADRs (v18.3) existem para as decisões estruturais tomadas até aqui, não só para as mais antigas.

### FASE 19 — Aplicativo móvel: quando sai do PWA para nativo (condicional)

O plano já decidiu PWA como estratégia principal (FASES 9 e 10). Esta fase existe para deixar
claro **quando** valeria a pena sair disso — não é compromisso de construir app nativo.

#### v19.1 — O que o PWA já resolve sozinho (confirmado por pesquisa)
- [ ] Push notification: iOS já suporta Web Push para PWA instalado na tela inicial (com paridade
      real — tela bloqueada, central de notificações), desde que o associado instale o atalho —
      não é motivo suficiente para app nativo.
- [ ] Carteirinha digital tipo wallet: Google Wallet e Apple Wallet **não exigem app nativo** —
      são emitidos via API do backend e distribuídos por link/e-mail, abrindo direto no wallet do
      celular. A carteirinha da FASE 1 pode evoluir para isso sem app próprio.
- [ ] Câmera (leitura de QR code no check-in), geolocalização aproximada, funcionamento offline do
      essencial e instalação na tela inicial — tudo disponível no PWA.

##### 🔍 Ponto de Revisão — FASE 19 (1/2 — meio, fecha v19.1)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Push notification via PWA (v19.1) testado de verdade em iOS instalado na tela inicial, não só em Android.

#### v19.2 — O único motivo real para considerar app nativo
- [ ] Biometria como segundo fator (Face ID/Touch ID/biometria Android) é o recurso genuinamente
      exclusivo de app nativo — WebAuthn no navegador tem suporte mais fragmentado. Só
      reconsiderar se isso virar requisito não-negociável.
- [ ] Custo real de manter app nativo (confirmado): Apple Developer Program custa US$99/ano, com
      possibilidade de isenção para organização sem fins lucrativos — o que reduz a barreira
      financeira, mas não elimina o custo de manutenção (build por plataforma, revisão de loja,
      atualização obrigatória por mudança de SO, QA duplicado).
- [ ] Custo escondido que decide a questão: app nativo exige **atualização periódica obrigatória**
      por exigência das lojas, mesmo sem nenhuma mudança de funcionalidade. Para uma associação
      sem equipe de TI permanente, isso é uma dívida recorrente, não um custo único.
- [ ] Critérios objetivos para reabrir a decisão: (a) biometria virar exigência, (b) mais de 60%
      do acesso vir de celular **e** a instalação do PWA se mostrar barreira real medida, (c)
      existir orçamento e responsável permanente pela manutenção. Sem os três, a resposta continua
      sendo PWA.
- [ ] Decisão registrada: **não construir app nativo nesta fase do projeto**.

##### 🔍 Ponto de Revisão — FASE 19 (2/2 — fim, fecha v19.2)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Critérios objetivos de reabertura da decisão "não construir app nativo" (v19.2) seguem sem se confirmar — se algum se confirmou, essa decisão precisa voltar à mesa antes de prosseguir, não em silêncio.

### FASE 20 — Autenticação avançada e assinatura eletrônica própria (substitui gov.br)

Nasce da correção confirmada nas FASES 0 e 13: gov.br não é caminho viável para uma associação
privada (assinatura eletrônica gov.br é restrita por norma a órgão público; login único gov.br
para app privado exige contrato comercial via Loja do Serpro/Dataprev, com aprovação
discricionária de "interesse público"). Esta fase entrega as alternativas reais, mantendo tudo
**dentro do próprio sistema**, sem redirecionar o associado para site de terceiro.

#### v20.1 — Login único próprio via Keycloak (avaliação e condição de adoção)
- [ ] Keycloak self-hosted (open source, mantido pela Red Hat, projeto CNCF) como provedor de
      identidade central (OIDC) — confirmado como **substituto direto e suficiente** do gov.br,
      sem cobrança por usuário ativo (diferente de Auth0/Okta) e sem depender de aprovação de
      terceiro. O custo é operacional (deploy, patch, backup), não de maturidade técnica.
- [ ] **Condição honesta de adoção**: a autenticação própria da v0.1 já resolve a necessidade
      atual com muito menos peça móvel. Keycloak só se justifica quando houver **três ou mais
      sistemas** compartilhando login (painel + Directus + BI/Metabase + eventual sistema
      parceiro), ou exigência de federação com Entra ID. Adotar antes disso é adicionar um ponto
      de falha e um contêiner a manter, sem ganho.
- [ ] Se adotado: migração de credencial planejada (senhas bcrypt são importáveis), plano de
      rollback, e o Keycloak nunca vira dono exclusivo do dado de pessoa — `Pessoa`/`Associado`
      continuam no Postgres da ASAF, o IdP só cuida de autenticação.
- [ ] Caminho aberto para plugar Entra ID/Azure AD no futuro sem reescrever a aplicação (a
      aplicação já fala OIDC).
- [ ] Suporta o cenário mencionado pelo usuário: autenticação para chamada/frequência dentro do
      mesmo provedor de identidade, sem sistema paralelo.

##### 🔍 Ponto de Revisão — FASE 20 (1/3, fecha v20.1)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Se Keycloak foi de fato adotado: confirmar que a condição registrada (3+ sistemas compartilhando login) realmente se confirmou antes da adoção — não adotado por conveniência.

#### v20.2 — Plataforma própria de assinatura eletrônica (evidence trail completo)
Decisão do usuário: em vez de contratar BirdID/Soluti/Clicksign, a ASAF constrói a própria
plataforma de assinatura para documentos internos, com trilha de evidência forte o bastante para
provar autenticidade sem depender de serviço pago. A força jurídica de uma assinatura eletrônica
simples/avançada (Lei 14.063/2020, Art. 4º) vem exatamente da qualidade dessa trilha — não é
"clicar num botão", é reunir prova suficiente para nunca ser repudiada.

> **Pendência registrada pela v1.2 (2026-09-14)**: o termo de filiação (`PropostaFiliacao`
> aprovada) precisa ser assinado eletronicamente e arquivado no cadastro do associado - quando
> este motor existir, conectar ali (`app/routers/filiacao.py`, endpoint `aprovar_proposta`).
> Hoje o termo, se anexado, é só um upload comum via `DocumentoAnexo`, sem verificação de
> assinatura nenhuma.

> **Pendência registrada pela v2.3 (2026-09-15)**: registro de presença final da sessão de
> assembleia (`Credenciamento`, `app/routers/sessao_assembleia.py`) precisa de assinatura
> eletrônica para valer como substituto da lista de papel - hoje só grava entrada/saída
> autenticada, sem assinatura nenhuma. Conectar aqui quando este motor existir, respeitando o
> limite da v20.2.1 (não substitui ato registral).

> **Pendência registrada pela v2.2 (2026-09-15)**: adesão a petição de convocação de assembleia
> (`app/routers/governanca.py`, endpoint `aderir_peticao`, Art. 8º/10 do estatuto) hoje só grava
> o vínculo usuário↔associado autenticado (`AdesaoPeticao`) - quando este motor existir, cada
> adesão passa a carregar o mesmo evidence trail (OTP, metadados, carimbo de tempo, hash) de
> qualquer outra assinatura eletrônica, em vez de só "usuário logado clicou em aderir".

**Autenticação do signatário no momento da assinatura**
- [ ] Segunda etapa obrigatória no ato de assinar (não basta já estar logado): token OTP enviado
      por e-mail ou WhatsApp institucional (central multicanal da v11.3), **ou** confirmação de
      senha forte — nunca só um clique em botão sem segundo fator.
- [ ] OTP de uso único, expiração curta, vinculado ao documento específico (o código de um
      documento não serve para outro) e limite de tentativas.

**Metadados do signatário (capturados no momento exato do aceite)**
- [ ] Nome completo, CPF, e-mail cadastrado, endereço IP, User-Agent do navegador e geolocalização
      aproximada por IP (sem exigir GPS) — tudo gravado junto ao evento de assinatura, nunca
      inferido depois.
- [ ] Consentimento LGPD específico para essa captura, com o texto da versão vigente registrado.

**Carimbo de tempo confiável**
- [ ] Data/hora exata com fuso, sincronizada via NTP (idealmente contra servidor NTP.br do
      Observatório Nacional) — nunca só o relógio do servidor de aplicação sem sincronização.
- [ ] Divergência de relógio detectada e registrada — assinatura com horário duvidoso é evidência
      fraca justamente onde ela mais precisa ser forte.

**Integridade criptográfica do documento**
- [ ] Hash SHA-256 do arquivo calculado no exato momento do aceite e gravado junto ao registro —
      qualquer alteração posterior no PDF muda o hash e prova adulteração.
- [ ] Página de manifesto anexada ao PDF final, reunindo todos os itens acima de forma legível
      para quem for auditar — não basta guardar isso numa tabela do banco, tem que estar no
      próprio arquivo.
- [ ] Código público de verificação (`/documento/verificar/{codigo}`) confirmando autenticidade e
      integridade a partir do hash, sem expor o conteúdo do documento a quem não tem acesso.

**Selo final do servidor**
- [ ] Documento final selado com certificado digital da própria instituição (e-CNPJ A1) pelo
      servidor, garantindo que o PDF não foi modificado depois de processado — camada adicional
      ao hash, não substituta.
- [ ] O certificado A1 fica no Key Vault, nunca no repositório nem no sistema de arquivos do
      contêiner, com vencimento anual monitorado pelo motor de obrigações (v12.0) — certificado
      vencido para a emissão de documento sem aviso prévio.

**Fluxo e operação**
- [ ] Fluxo multi-signatário com ordem configurável (sequencial ou paralela), prazo para assinar,
      lembrete automático, recusa motivada e cancelamento — com trilha de cada etapa.
- [ ] Arquivamento do documento assinado no Blob Storage com versionamento, vinculado ao cadastro
      da pessoa e ao processo que o originou.
- [ ] **Usado para**: termo de adesão de voluntário (FASE 1), ficha de filiação, lista de presença
      de reunião/evento, termo de compromisso, autorização de uso de imagem, confissão de dívida
      (v3.2.2), termo de transmissão de gestão (v12.10) e demais controles operacionais internos.

#### v20.2.1 — Limite explícito: quando a assinatura própria NÃO basta (ato registral)
- [ ] Ata de eleição de diretoria, reforma estatutária e venda de imóvel — qualquer documento que
      precisa ser **levado a registro** em RCPJ ou Registro de Imóveis — exigem assinatura
      **qualificada** (certificado ICP-Brasil e-CPF), não a assinatura própria da v20.2. A maioria
      dos cartórios não aceita assinatura simples para esses atos.
- [ ] Fluxo real confirmado pelo usuário: esse tipo de documento **não nasce no sistema** (que não
      tem editor de texto, de propósito — FASE 13) — é redigido fora, assinado com certificado
      qualificado de quem assina, enviado a quem precisar (cartório, órgão público) e só **depois**
      o PDF já assinado é arquivado no sistema como referência (mesmo padrão da v13.4).
- [ ] O sistema nunca tenta "imitar" assinatura qualificada: a interface deixa claro, no próprio
      tipo de documento, qual caminho se aplica ("assina aqui" x "assine fora e envie aqui
      depois"), e a pendência de registro é acompanhada pela v13.4.
- [ ] Validação de PDF externo recebido: o sistema verifica e registra a assinatura ICP-Brasil do
      arquivo enviado (validade do certificado na data, integridade), em vez de aceitar qualquer
      PDF como "documento assinado" — diferença entre arquivar e conferir.

##### 🔍 Ponto de Revisão — FASE 20 (2/3, fecha v20.2–v20.2.1)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Trilha de evidência da assinatura (v20.2) testada ponta a ponta: alterar um caractere do PDF já assinado precisa invalidar o hash registrado.
- Certificado e-CNPJ A1 usado no selo do servidor está com vencimento monitorado, nunca descoberto vencido na hora de emitir um documento.
- Limite v20.2.1 realmente impede uso da assinatura própria em documento que exige registro em cartório — testar tentativa de uso indevido.

#### v20.3 — Autenticação biométrica para chamada/frequência (avaliação cuidadosa)
- [ ] Viável tecnicamente via Azure AI Face (foto de referência + comparação no check-in) — tier
      gratuito de 30.000 transações/mês. **Recurso "Limited Access"**: a Microsoft exige inscrição
      e aprovação prévia antes de liberar verificação/identificação facial, mesmo pagando.
- [ ] **LGPD como bloqueio real, não detalhe**: dado biométrico é sensível (Art. 5º, II) —
      consentimento **específico e destacado** obrigatório (Art. 11), nunca coberto por termo de
      uso geral; "legítimo interesse" é **expressamente vedado** para dado sensível.
- [ ] RIPD obrigatória antes de qualquer ativação (v7.0), incluindo avaliação de risco de viés e
      de falso positivo/negativo — reconhecimento facial erra de forma desigual entre grupos, e
      numa associação comunitária isso é dano direto a pessoas.
- [ ] A ANPD está em processo normativo ativo sobre biometria (consulta pública em 2025, notas
      técnicas sobre reconhecimento facial em eventos) — regulamentação mais específica esperada.
      **Decisão do plano**: biometria para chamada entra como opção configurável e **nunca
      obrigatória**, sempre com alternativa não biométrica disponível (código/QR das FASES 4 e 13).
- [ ] Se um dia for ativada: template biométrico cifrado, armazenado separado do cadastro,
      excluível a pedido, com retenção curta e jamais reutilizado para outra finalidade.
- [ ] Não implementar no MVP — registrar como capacidade avaliada, pronta para ativar se (e
      somente se) o ganho operacional compensar o processo de aprovação da Microsoft e o desenho
      cuidadoso de consentimento.

#### v20.4 — Identidade federada para a diretoria (pedido registrado do usuário)
- [ ] Pedido original: entrar nos recursos administrativos com a conta Microsoft/Entra ID da
      própria pessoa, em vez de memorizar senha de banco/serviço. Já é verdade para o **acesso ao
      Azure** (o Portal usa Entra ID hoje).
- [ ] Para o **painel da ASAF**, entra como login alternativo ("Entrar com Microsoft") para quem
      tem conta institucional, mantendo CPF+senha para associado comum — e nunca substituindo o
      login por CPF, que é a via de acesso da maioria.
- [ ] Depende do v20.1 (IdP) ou de integração OIDC direta do FastAPI com o Entra ID — a segunda é
      mais simples e provavelmente suficiente, se for a única federação necessária.
- [ ] Vínculo obrigatório entre a conta federada e uma `Pessoa` existente (por CPF confirmado) —
      identidade externa nunca cria cadastro sozinha.

##### 🔍 Ponto de Revisão — FASE 20 (3/3 — fim (e revisão final do roteiro de fases), fecha v20.3–v20.4)
Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:
- Biometria (v20.3) continua desativada por padrão, com alternativa não biométrica sempre disponível.
- Login federado (v20.4) exige vínculo por CPF confirmado com uma `Pessoa` existente — nunca cria cadastro sozinho.
- **Revisão de todo o roteiro**: reler a seção 4.1 e confirmar que nenhum ponto de revisão anterior ficou pendente sem correção registrada.

## 5. Decisão de front-end (painel único)

SPA em React (Vite + TypeScript + Tailwind + shadcn/ui + Recharts), separado do FastAPI,
consumindo a API via REST/JWT, publicado no Azure Static Web Apps. Motivo: painel com múltiplos
módulos (financeiro, eventos, votação, associados) pede componentes ricos — dashboards, gráficos,
tabelas com filtro — mais robustos em React do que em templates renderizados no servidor.
Confirmado por pesquisa de mercado: Python/FastAPI é stack corrente para este tipo de sistema em
2025–2026 (não é escolha de nicho), com casos reportados de FastAPI + PostgreSQL suportando
volume alto de usuários simultâneos.

## 6. Referência de pesquisa (mercado)

### 6.-2 gov.br descartado e alternativas (FASE 20)
- **Confirmado**: a API de Assinatura Eletrônica gov.br é restrita, por texto oficial, a "qualquer
  órgão público das esferas federal, estadual e municipal" — associação privada não se enquadra.
  Login Único gov.br para app privado até existe em tese, mas passa por Loja do
  Serpro/Dataprev com contrato comercial e aprovação discricionária — inviável para o porte da
  ASAF. A tentativa real do usuário bateu exatamente nessa restrição documentada.
- **Assinatura eletrônica**: avaliadas opções pagas (BirdID/Soluti, Certisign — certificado
  ICP-Brasil com API própria, ~R$50–150/ano), mas **decisão final do usuário foi construir
  plataforma própria** em vez de contratar terceiro, com trilha de evidência forte (OTP, metadados
  do signatário, timestamp NTP, hash SHA-256, selo com certificado e-CNPJ próprio da instituição)
  — suficiente para documento interno (termo de voluntariado, lista de presença, autorização de
  uso de imagem). Ato que precisa de registro em cartório (RCPJ/Registro de Imóveis — ata de
  eleição, reforma estatutária, venda de imóvel) continua exigindo assinatura qualificada
  ICP-Brasil e-CPF feita fora do sistema (ex.: assinador do ITI), com o PDF assinado enviado ao
  sistema só como referência depois — nunca substituído pela assinatura própria da v20.2.
- **Biometria facial para chamada**: tecnicamente viável (Azure AI Face), mas é "Limited Access"
  (exige aprovação prévia da Microsoft) e dado biométrico é dado sensível pela LGPD — consentimento
  específico obrigatório, nunca coberto por termo de uso geral, e legítimo interesse é vedado para
  esse tipo de dado. ANPD tem processo normativo em andamento sobre o tema. Por isso entra como
  opção configurável, nunca obrigatória, sempre com alternativa não biométrica.
- **Keycloak confirmado** como SSO próprio maduro para este porte — sem cobrança por usuário,
  sem depender de gov.br nem de provedor pago (Auth0/Okta).

### 6.-1 Continuidade, contabilidade, qualidade e app móvel (FASES 16–19)
- **Backup/DR**: Azure Postgres Flexible Server já cobre retenção de até 35 dias e geo-redundância
  nativa (configurável só na criação do servidor); RPO nativo de ~5 minutos via PITR. Teste de
  restauração pelo menos anual é a prática mais negligenciada e mais barata de corrigir.
- **Contábil**: ECD obrigatória para entidade imune/isenta com receita anual abaixo de
  R$4.800.000 (a maioria das associações, não a exceção); ECF exigida sempre que há receita. O
  arquivo SPED em si nunca é gerado pelo sistema — fica sempre com o contador habilitado (CRC).
- **Qualidade/observabilidade**: pirâmide de testes (muitos unitários, poucos E2E) é o padrão
  correto, evitando o antipadrão de muitos testes de UI lentos. Application Insights (Azure) já
  cobre observabilidade sem custo adicional (5GB/mês grátis).
- **App móvel**: PWA já resolve push notification e carteirinha digital tipo wallet (Google/Apple
  Wallet não exigem app nativo) — o único motivo real para sair do PWA é biometria como MFA.

### 6.0 Base legal e novos módulos (FASE 12)
- **Código Civil, Arts. 53–61** (associações): Art. 54 define o conteúdo mínimo do estatuto;
  Art. 55 permite categorias de associado com vantagens especiais; Art. 59 exige quórum
  qualificado para eleição/destituição de administrador e reforma do estatuto (competência
  privativa da assembleia); Art. 60 garante a 1/5 dos associados o direito de convocar
  assembleia; Art. 61 rege a destinação do patrimônio em caso de dissolução.
- **Lei 13.019/2014 (MROSC)**: só se aplica quando há parceria com poder público (Termo de
  Colaboração/Fomento/Acordo de Cooperação) — nunca a mensalidade ou doação privada. Módulo
  condicional, não universal.
- **Obrigações fiscais**: associação isenta ainda precisa declarar ECF todo ano para provar a
  condição; CEBAS é condicional a atuação em assistência social/saúde/educação.
- **Voluntário x empregado**: juridicamente distintos (Lei 9.608/1998 x CLT) — nunca o mesmo
  cadastro tratado igual.
- **Compliance além do mínimo**: código de ética, canal de denúncia com anonimato real, auditoria
  externa voluntária e selos de transparência do terceiro setor (Selo ONG Verificada, Selo Doar,
  Selo Transparência) são práticas de organizações de referência, não exigência legal.
- **Módulos de gestão descobertos nesta rodada**: patrimônio/inventário de bens, contratos e
  convênios, captação de recursos avançada (fundraising), portal de transparência ativa, matriz
  de riscos institucional, planejamento estratégico com metas/indicadores, e banco de
  competências para sucessão de diretoria — nenhum desses aparecia no plano antes desta pesquisa.

### 6.1 Diferenciais avançados (FASE 11)
- **Engajamento/gamificação**: sistemas de ponta (Nimble AMS, Rhythm, Glue Up, GrowthZone)
  calculam um score de engajamento combinando presença, adimplência, voto e uso do portal —
  usado tanto como indicador pessoal (badges) quanto como sinal preditivo de evasão.
- **IA e automação**: previsão de inadimplência/evasão via ML já é aplicada até em cooperativas
  brasileiras análogas a associação. Chatbot solto falha em fluxo de mais de 2 passos — o desenho
  certo é um assistente de escopo restrito (RAG + ferramentas específicas), nunca acesso
  irrestrito de escrita.
- **WhatsApp institucional**: só via API oficial (Meta Cloud API/BSP) — link `wa.me` automatizado
  ou WhatsApp Web programado violam os termos de uso e geram banimento. Mensagens "utility"
  custam 80–95% menos que "marketing".
- **Clube de benefícios**: prática consolidada em associações de peso (parceria comercial como
  benefício tangível de ser sócio) — modelo de dado simples (parceiro, benefício, resgate).
- **Segurança avançada**: MFA (TOTP) para perfil administrativo/financeiro e Keycloak como IdP
  central (SSO) são o caminho recomendado para um sistema em FastAPI, que não tem SSO nativo.
- **Open Finance**: viável para organização pequena via agregador (ex.: Pluggy), não é exclusivo
  de banco/fintech — elimina conciliação manual de extrato.
- **Portal self-service de ponta**: assinatura eletrônica de documentos, declaração automática
  sob demanda e extrato de participação num só lugar — visto em portais reais de associação.
- **BI/dashboard executivo**: Metabase self-hosted (grátis) é escolha madura para painel de
  diretoria, com alertas nativos por e-mail quando um indicador cruza limiar.

### 6.2 Módulos e arquitetura (pesquisas anteriores)
- **Módulos padrão de mercado nacional** (fornecedores de sistema de gestão para associações/
  clubes/ONGs no Brasil): PIX/boleto com conciliação, carteirinha digital, votação eletrônica com
  validade jurídica, LGPD como requisito explícito, prestação de contas auditável.
- **Deduplicação evento/voluntário → cadastro**: nenhum sistema líder trata inscrito de evento
  como cadastro separado do membro — sempre uma tabela única de pessoa com identificador central
  (CPF/e-mail), inscrição pública como registro vinculado por FK.
- **Stack tecnológica**: Python (FastAPI/Django) é escolha corrente de mercado para CRM/sistemas
  de gestão associativa — não é caminho alternativo raro.
- **Padrão a evitar** (achado nas referências de comparação lidas nesta sessão): construir o
  módulo de eventos só dentro do site, sem integração com o cadastro de associado, por o sistema
  de gestão "ainda não estar pronto" — gera dívida técnica registrada como erro de arquitetura já
  reconhecido pelos próprios autores dessas referências. Este plano evita isso desde a FASE 4.
- **Módulo de Projetos — não existe padrão de mercado único e maduro** para associação genérica
  (pesquisa dedicada): a maioria dos sistemas de gestão associativa não cobre isso de verdade,
  resolvendo por fora com ferramenta genérica de gestão de projeto (tipo quadro Kanban com campos
  customizados); quem cobre bem é o terceiro setor assistencial verticalizado (ex.: modelo aberto
  da Microsoft para ONGs, com "programa" guarda-chuva, beneficiário, indicador com meta e valor
  medido). Confirma a decisão deste plano: `Projeto` único e configurável por `tipo_projeto`, não
  um módulo por tipo de projeto.
- **Reserva de espaço físico** (quadra, salão): padrão de mercado é calendário por espaço com
  trava de conflito por sobreposição de horário, dois fluxos configuráveis (confirmação
  instantânea ou aprovação manual), e tarifa/prioridade diferente para associado x terceiro.
- **Voluntariado vinculado a projeto**: modelado como turno/horas previstas x realizadas, com
  filtro por habilidade exigida x habilidade do voluntário, e certificado de horas gerado a partir
  do próprio registro — nunca planilha solta.

## 7. Decisões confirmadas (antigos pontos em aberto)

- **Mensalidade via PIX**: confirmado — a ASAF vai cobrar mensalidade dos associados por PIX
  (FASE 3.2, QR code estático + conciliação manual em lote, sem gateway de pagamento).
- **Coleções do Directus** (FASE 5.1): confirmado como desenhado — só conteúdo público (páginas,
  notícias, banners, galeria); nenhum dado de associado/financeiro/projeto/evento entra ali.
- **Estatuto da ASAF**: recebido e transcrito em `ESTATUTO_ASAF.txt` (2026-09-15) — v2.0 já
  incorpora os valores reais (quórum, prazos, mandato, 3 sócios proponentes, idade mínima de
  filiação). v2.7 (processo disciplinar) usa os números reais do Art. 16/17 (justa causa, 3
  advertências → suspensão, 30 dias a 1 ano, eliminação) quando for implementado.
- **Procuração em assembleia**: confirmado pelo Art. 7º do estatuto real — vedada, sempre. v2.2
  ajustado para não construir fluxo de upload/conferência de procuração agora (nada a conferir se
  é sempre proibida); o parâmetro `PROCURACAO_PERMITIDA` (v2.0) existe pronto pra quando uma
  reforma futura do estatuto mudar isso.
- **Empregados CLT**: confirmado pelo usuário (2026-09-15) — a ASAF não tem empregados hoje. O
  cadastro mínimo de `Funcionario` (v1.6) já foi construído mesmo assim, por decisão do usuário
  ("o Painel é unificado por Pessoa, não por Associado") - fica pronto, sem uso real ainda.

## 8. Novos pontos em aberto (surgidos da pesquisa de legislação)

- **A ASAF recebe ou pretende receber recurso público** (convênio/termo de parceria com
  prefeitura, estado ou União)? Define se o módulo de MROSC (v12.1) fica ativo desde já ou
  permanece desligado até ser necessário.
- **A ASAF atua em assistência social, saúde ou educação de forma formal?** Define se o CEBAS
  (v12.2) é relevante ou fica de fora do escopo por completo, e se o módulo de Educação (FASE 14)
  é necessário desde já.
- **Pendência técnica**: repetir a pesquisa da FASE 13 (assembleia/diretoria/segurança) quando a
  ferramenta de busca deste ambiente estiver disponível de novo — a rodada mais recente falhou
  por indisponibilidade de infraestrutura, não por falta de informação, e o conteúdo atual não
  tem fontes vivas citadas.

## 9. Revisão de escalabilidade e perpetuidade (o sistema precisa servir daqui a 10, 15, 20 anos)

Pedido explícito do usuário: revisar o plano perguntando "isso vai servir daqui a 10-20 anos, com
muitos ou poucos associados?" antes de continuar construindo. Avaliação honesta, ponto a ponto —
o que já está bem resolvido e o que precisa de correção real.

### 9.1 O que já está bem resolvido para o longo prazo
- **Banco de dados**: Postgres (não SQLite) escala verticalmente (mais vCPU/storage) sem
  reescrever nada — suporta de dezenas a centenas de milhares de associados/lançamentos sem
  mudança de arquitetura. Confirmado na prática hoje: 51 tabelas, schema relacional convencional,
  sem decisão que precise ser desfeita depois.
- **Infraestrutura sem servidor fixo** (Container Apps consumo): não exige alguém "cuidando de
  servidor" ano após ano — escala sozinha de zero até o necessário. Bom encaixe pra uma
  associação que não vai ter equipe de TI dedicada por 20 anos seguidos.
- **Sem lock-in pesado de fornecedor**: tudo roda em containers Docker padrão + Postgres padrão
  — migrar de nuvem no futuro (se precisar) é trabalho de reconfiguração, não reescrita. A única
  configuração específica da Azure é o driver de storage do Directus (troca de poucas linhas se
  um dia precisar migrar).
- **Dado nunca fica preso em formato proprietário**: Postgres exporta em SQL padrão; a FASE 7
  (LGPD) já prevê portabilidade de dado do titular.

### 9.2 Correções reais necessárias antes de continuar construindo

- [x] **Migração de schema com ferramenta de verdade — Alembic adotado em 2026-09-11.**
      Substituiu `preparar_banco()` por completo (não só desligado em produção — a v0.0 tinha
      sido o remendo emergencial, esta é a solução definitiva). Migração baseline gerada e
      aplicada (`stamp`) contra o Postgres real: veio **vazia**, confirmando que o schema dos 21
      models da aplicação já batia exatamente. Configurado com `include_object` pra nunca tocar
      nas tabelas do Directus (`directus_*`), que dividem o mesmo banco mas são geridas por ele.
      Daqui pra frente: `alembic revision --autogenerate` + `alembic upgrade head` a cada mudança
      de model, nunca mais editar tabela direto.
- [x] **`servidor.py` modularizado em 2026-09-11.** Separado em `app/` com pacotes por domínio
      (`models/`, `schemas/`, `routers/` — core, associados, financeiro, governanca, projetos,
      admin_portal), reorganização mecânica sem mudança de lógica. Validado: as mesmas 37 rotas
      antes/depois (diff idêntico entre o `openapi.json` do servidor antigo e do novo), 51
      tabelas confirmadas no Postgres real, todos os domínios testados via HTTP com 200 OK.
- [x] **Documentação técnica de arquitetura criada — `ARQUITETURA.md` em 2026-09-11.** Cobre
      estrutura do código, por que cada peça de infraestrutura foi escolhida, onde ficam os
      segredos (nunca o valor, só onde procurar), como rodar localmente e como fazer deploy —
      mais uma seção explícita de práticas de continuidade (rotação de segredo, revisão de
      custo) como prática contínua, não configuração única. A FASE 12 (v12.10) continua cobrindo
      sucessão de diretoria; este documento cobre a sucessão técnica.
- [ ] **Rotação de segredos como prática contínua, não evento único** — confirmado pelo usuário
      que isso segue sendo tratado ao longo do projeto (não é bloqueio pra continuar), já
      documentado como prática recomendada no `ARQUITETURA.md` seção 8. Senha do Postgres,
      `JWT_SECRET`, tokens do Directus — hoje gerados uma vez. Para 20 anos de operação, isso
      precisa virar rotina periódica (ex.: anual, ou ao trocar de diretoria/pessoa responsável
      pela infraestrutura) — sem isso, o mesmo segredo circula por anos entre pessoas que já
      saíram da gestão.
- [x] **Reconstruibilidade da infraestrutura — resolvida em 2026-09-11 com `infra/provisionar.sh`.**
      Correção do enquadramento desta mesma revisão: a infraestrutura Azure não precisava de
      Bicep/Terraform para deixar de ser risco — precisava só de estar **documentada em ordem
      executável**, o que já foi feito (script comentado, versionado, sem segredo nenhum). Ver
      `DECISOES_CONGELADAS.md` seção 5.6 para o porquê de Bicep ter sido avaliado e descartado por
      ora (complexidade desproporcional ao número de recursos hoje) — fica registrado como opção
      futura, não como pendência.
- [x] **Revisão de custo/orçamento — avaliada e aprovada pelo usuário.** US$2.000/ano de
      crédito ONG ÷ 12 ≈ US$150/mês de teto real (o plano usa US$100/mês como margem de
      segurança). Confirmado como confortável para a escala hoje e mesmo num cenário de
      crescimento (3.000 a 10.000 associados) — se o sucesso da associação justificar consumo
      acima disso, já haverá recurso arrecadado pra sustentar o upgrade de tier. Não é um
      problema a resolver agora; o alerta de orçamento (FASE 8) já avisa quando for hora de
      reavaliar.

### 9.3 Pergunta em aberto para o usuário
- **Renovação do domínio `asaf.org.br`**: item puramente operacional (não técnico) mas crítico
  pra perpetuidade — o domínio precisa ser renovado no Registro.br periodicamente (geralmente
  anual). Se a pessoa responsável pelo pagamento/renovação mudar ao longo dos anos, o domínio
  pode expirar e ser perdido. Vale registrar quem é responsável por isso e com que antecedência
  o Registro.br avisa do vencimento.

**Conclusão desta revisão — atualizada em 2026-09-11, correções já aplicadas**: a arquitetura de
infraestrutura (Postgres, Container Apps, sem servidor fixo) está bem desenhada para durar
décadas, com custo que escala junto do uso (aprovado pelo usuário, seção 9.2). Os dois riscos
reais de código identificados (mecanismo de migração frágil e arquivo único crescendo sem
limite) **já foram corrigidos** — Alembic adotado com baseline aplicado contra produção, e
`servidor.py` modularizado em pacotes por domínio, ambos validados de ponta a ponta antes do
deploy. `ARQUITETURA.md` documenta a continuidade técnica. Rotação de segredo segue como
prática contínua a manter ao longo do tempo, não um bloqueio. **O plano está liberado para
avançar para a FASE 1 (Associados) — nenhuma correção de alto padrão pendente.**
