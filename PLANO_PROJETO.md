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
  - Financeiro: `PlanoDeContas`, `Fornecedor`, `TituloFinanceiro`, `TransacaoCaixa`.
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

##### v0.1.1 — Hash de senha (correção de segurança real, não cosmética)
- [ ] Trocar SHA-256 sem salt (inseguro — vulnerável a rainbow table, rápido demais pra brute
      force) por **bcrypt** (`passlib[bcrypt]` ou `bcrypt` direto — padrão da indústria, salt
      embutido, custo computacional ajustável). Nunca reverter pra hash rápido, mesmo que pareça
      "mais simples".
- [ ] `hash_senha(senha: str) -> str` e `verificar_senha(senha: str, hash: str) -> bool` em
      `app/security.py` (novo módulo, separado de `app/utils.py` que é só HTML/formatação).

##### v0.1.2 — Login por CPF + senha, com JWT de verdade (access + refresh)
- [ ] `POST /auth/login` (CPF + senha): localiza `Associado` pelo CPF → pega o `Usuario`
      vinculado (`id_usuario`) → verifica senha (bcrypt) → emite **access token JWT** (curto,
      ~30-60 min, claims: `id_usuario`, `id_associado`, `id_nivel`, `exp`) assinado com o
      `JWT_SECRET` já gerado no Key Vault — e um **refresh token opaco** (string aleatória,
      gravado em `TokenAcesso` com `data_expiracao`, ~30 dias) — a tabela já existe exatamente
      pra isso.
- [ ] `POST /auth/refresh` (refresh token) → valida contra `TokenAcesso` (existe? não expirou?)
      → emite novo access token. Rotacionar o refresh token a cada uso é mais seguro (evita reuso
      de token roubado) — avaliar se compensa a complexidade extra nesta fase.
- [ ] `POST /auth/logout` (refresh token) → apaga a linha de `TokenAcesso` (revogação real, não
      só "esquecer" o token no cliente).
- [ ] `GET /auth/me` → dados de quem está logado (nome, nível, permissões do nível) — usado pelo
      painel (FASE 0.2) pra montar o menu dinâmico.
- [ ] **Bloqueio por tentativa de força bruta** — trava por dado (não por memória do processo,
      que não sobrevive a múltiplas réplicas do Container App): campos `tentativas_falhas` e
      `bloqueado_ate` no `Usuario`, incrementado a cada senha errada, zerado no login bem
      sucedido, bloqueio temporário (ex.: 15 min) após N tentativas.

##### v0.1.3 — Autorização: dependency de permissão por rota
- [ ] `get_current_user` (dependency FastAPI): decodifica o JWT do header `Authorization`,
      carrega o `Usuario`, rejeita se expirado/inválido/usuário inativo.
- [ ] `exigir_permissao(codigo_permissao: str)` (dependency factory): verifica se o `NivelAcesso`
      do usuário atual tem aquela permissão via `perfil_permissao` — 403 se não tiver. Toda rota
      sensível (financeiro, admin, edição de associado) passa a declarar isso explicitamente,
      substituindo a ausência total de controle de acesso que existe hoje nas rotas `/admin/*`.

##### v0.1.4 — MFA (TOTP) para perfil administrativo/financeiro
Antecipado da FASE 11/v11.5 e FASE 20/v20.1 — pedido do usuário de ir ao nível mais alto possível
já nesta versão, não deixar só planejado para depois.
- [ ] `Usuario.mfa_secret` (nullable) + `Usuario.mfa_ativado` (boolean, default false).
- [ ] `POST /auth/mfa/ativar` — gera segredo TOTP (`pyotp`), devolve URI `otpauth://` (o cliente
      renderiza o QR code, sem precisar de biblioteca de imagem no backend).
- [ ] `POST /auth/mfa/confirmar` (código de 6 dígitos) — só marca `mfa_ativado=true` depois de
      confirmar que o usuário realmente configurou o app autenticador direito.
- [ ] Login com MFA ativado exige um segundo passo (`POST /auth/login/mfa`, código TOTP) antes de
      emitir o token — nunca token liberado só com senha se `mfa_ativado=true`.
- [ ] Ativação **obrigatória** só para `NivelAcesso` de Presidente/Diretoria/Financeiro (a definir
      exatamente quais, catálogo configurável) — opcional pros demais níveis.

##### v0.1.5 — Catálogo configurável de `NivelAcesso` e `PermissaoSistema`
- [ ] CRUD de `NivelAcesso` (não fixo em código) — seed inicial: Presidente, Diretoria, Conselho
      Fiscal, Associado, Voluntário Externo (nomes de exemplo, ajustável pela diretoria depois).
- [ ] CRUD de `PermissaoSistema` (catálogo de permissões existentes no sistema) e de
      `perfil_permissao` (atribuir/remover permissão de um nível) — tela de administração de
      acesso, não hardcoded.

##### v0.1.6 — `AuditLog`
- [ ] Novo model `AuditLog` (`id_log`, `id_usuario` nullable, `tabela_afetada`,
      `id_registro_afetado`, `acao` — LOGIN/CREATE/UPDATE/DELETE —, `dados_antes`/`dados_depois`
      em JSON, `timestamp`, `ip_origem`).
- [ ] Helper `registrar_auditoria(db, usuario, tabela, id_registro, acao, antes, depois)` chamado
      em toda alteração sensível — base para LGPD (FASE 7) e segregação de funções do Financeiro
      (FASE 3). Login/logout também geram entrada (`acao=LOGIN`), não só mutação de dado.

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

#### v0.2 — Painel único (substitui `templates/index.html`)
- [ ] Remover a divisão `/meu-portal` x `/admin` do protótipo atual.
- [ ] Shell de painel único (SPA React, ver seção 5) com menu montado dinamicamente a partir de
      `PermissaoSistema` do usuário logado — nenhum módulo hardcoded na navegação.
- [ ] Módulo "Meu Perfil" dentro do painel (dados cadastrais, trocar senha, meus documentos).

#### v0.3 — Base de catálogos configuráveis
- [ ] Catálogos configuráveis sem precisar mexer em código: cargos, categorias de associado,
      tipos de documento, motivos de desligamento — mesmo espírito de "catálogo configurável"
      já validado em sistemas de gestão associativa de mercado.

### FASE 1 — Associados (ciclo de vida)

#### v1.1 — Cadastro e categorias
- [ ] Cadastro completo de `Associado` (dados pessoais, endereço, dependentes, documentos) —
      já modelado, só falta tela/API completa no painel único.
- [ ] Categorias de associado calculadas (não marcação manual): ativo, inadimplente, em
      integração/experiência, desligado — a partir de dados reais (tempo de casa, pagamento em
      dia), nunca campo editável à mão.
- [ ] Carteirinha digital (QR code na SPA) — item citado como padrão em todo fornecedor nacional
      de sistema de associação pesquisado; nasce como QR code antes de virar app nativo.

#### v1.2 — Importação e exportação
- [ ] Importação de planilha (Excel/CSV) de associados existentes, com tela de revisão de
      duplicidade por CPF exato e por similaridade de nome — parsing no navegador (sem subir
      arquivo bruto pro servidor).
- [ ] Exportação de rol de associados com seleção de colunas.

#### v1.3 — Desligamento e histórico
- [ ] Registro de causas de desligamento (pedido, inadimplência, exclusão) — catálogo fechado,
      nunca texto livre solto.
- [ ] Linha do tempo do associado (histórico de cargos, documentos, participação em eventos —
      integra direto com a FASE 4).

#### v1.4 — Pessoas além do associado: voluntário e empregado (confirmado por pesquisa legal)
Distinção jurídica real, não só de rótulo: voluntário (Lei 9.608/1998) nunca gera vínculo
empregatício; empregado CLT tem outro regime inteiro (eSocial, ponto, folha). Misturar os dois
como "a mesma pessoa com um campo a mais" seria errado — o sistema precisa tratá-los como dois
modos distintos dentro do mesmo cadastro de pessoa física.
- [ ] `TermoAdesaoVoluntario` (atividade, carga horária, local, vigência) — documento formal
      exigido pela Lei 9.608/1998, gerido por pessoa/projeto (integra com a alocação de
      voluntário da FASE 4).
- [ ] Se a ASAF tiver (ou vier a ter) empregados CLT: módulo de folha/ponto eletrônico/eSocial
      fica **fora do escopo deste sistema** por padrão — recomenda-se integrar com um sistema de
      folha de pagamento especializado já existente no mercado, em vez de reconstruir isso aqui.
      Confirmar com a diretoria se a ASAF tem empregados antes de decidir se vale a pena um
      módulo próprio ou só uma integração.

### FASE 2 — Governança (assembleias, diretoria, conselho fiscal)

Base legal confirmada por pesquisa: Código Civil, Arts. 53–61 (associações). O módulo de
governança segue esses artigos como piso mínimo, não como teto — a FASE 12 trata do que vai além
deles.

#### v2.1 — Diretoria e Conselho Fiscal
- [ ] Cadastro de cargos (Presidente, Vice, Secretário, Tesoureiro, Conselho Fiscal) com mandato
      e prazo — vencimento calculado na leitura, nunca job/cron.
- [ ] Segregação de funções desde já prevista aqui (quem lança financeiro não é quem aprova —
      preparação para a FASE 3, princípio confirmado por pesquisa de mercado como proteção nº1
      contra fraude em associações).
- [ ] Categorias de associado com vantagens especiais (Art. 55 do Código Civil admite
      expressamente) — catálogo configurável, não hardcoded (ex.: contribuinte, benemérito,
      honorário — a definir conforme o estatuto real da ASAF).

#### v2.2 — Assembleias e votação
- [ ] Convocação de assembleia (edital, pauta, prazo mínimo de antecedência configurável).
- [ ] **Convocação por petição de associados** (Art. 60 do Código Civil: 1/5 dos associados tem
      direito de convocar assembleia) — fluxo de coleta de assinatura/adesão digital até atingir
      o quórum de petição, disparando a convocação formal automaticamente.
- [ ] Lista de votantes calculada (associados em dia, sem restrição disciplinar) — nunca marcação
      manual.
- [ ] **Quórum diferenciado por tipo de deliberação** (Art. 59: eleição/destituição de
      administrador e reforma do estatuto são competência privativa da assembleia, com quórum
      qualificado definido em estatuto) — o motor de votação precisa suportar mais de um tipo de
      quórum configurável, não um valor único fixo para toda votação.
- [ ] Votação eletrônica com validade jurídica (voto auditável, mas secreto na exibição pública —
      identificador único por voto, apuração em tempo real). Confirmado por pesquisa como item de
      baseline no mercado nacional de sistemas de associação (usado até por grandes clubes).
- [ ] Ata gerada a partir do resultado (documento, não texto livre solto) — **livro de atas
      digital** com trilha de auditoria (nunca editável depois de assinado/publicado).

#### v2.3 — Disciplina (se aplicável ao estatuto da ASAF)
- [ ] Processo administrativo simples (abertura, defesa, decisão), com suspensão automática de
      direitos de voto durante o processo — a confirmar com o estatuto real da associação antes
      de detalhar esta versão (depende de texto normativo que ainda não foi lido nesta conversa).

#### v2.4 — Destinação patrimonial em caso de dissolução (Art. 61 do Código Civil)
- [ ] Campo estatutário formal: entidade de fins não econômicos designada para receber o
      patrimônio remanescente em caso de dissolução (ou regra de deliberação pelos associados, se
      o estatuto for silente) — registro de referência, não uma funcionalidade operacional do
      dia a dia, mas precisa existir documentado no sistema, ligado ao módulo de patrimônio da
      FASE 12.

### FASE 3 — Financeiro

#### v3.1 — Plano de contas e caixa
- [ ] `PlanoDeContas` hierárquico configurável (já modelado) — tela própria dentro de
      Financeiro, não misturado em catálogo genérico.
- [ ] Lançamentos de entrada/saída com numeração sequencial (equivalente ao "termo nº" de um
      talão físico) — nunca exclusão real, só cancelamento motivado, preservando a numeração.

#### v3.2 — Cobrança de mensalidade (PIX/boleto)
- [ ] Cadastro de mensalidade por associado, com geração de cobrança PIX (QR code estático,
      copia-e-cola) — confirmado por pesquisa como baseline de mercado nacional (PIX/boleto com
      conciliação, diferente do mercado internacional que resolve só via cartão).
- [ ] Conciliação manual em lote (marcar várias cobranças como pagas de uma vez a partir de um
      extrato), sem exigir gateway de pagamento algum — mesmo caminho pragmático já usado em
      sistemas de associação/igreja de referência que evitam processar pagamento diretamente.

#### v3.2.1 — Evolução real: Pix Automático (confirmado, lançado oficialmente em jun/2025)
- [ ] Migrar a cobrança recorrente de mensalidade do PIX estático (v3.2, associado precisa colar
      o código todo mês) para **Pix Automático** — recorrência nativa do Banco Central (Resolução
      BCB nº 402/506), onde o associado autoriza a cobrança **uma única vez** direto no app do
      banco dele, e a associação dispara as cobranças nas datas programadas depois, sem gateway
      de terceiro nem taxa de intermediário.
- [ ] Exige integração direta com uma instituição financeira/PSP habilitado ao Pix Automático (a
      associação não se conecta direto ao Banco Central) — escolher o banco/fintech parceiro é
      pré-requisito antes de implementar.
- [ ] Reduz inadimplência por esquecimento (maior valor real deste item) — v3.2 (PIX estático)
      continua existindo como alternativa para quem preferir pagar avulso, sem autorizar
      recorrência.

#### v3.3 — Contas a pagar e segregação de funções
- [ ] Cadastro de fornecedores com verificação de CPF/CNPJ duplicado.
- [ ] **Validação automática de situação cadastral do fornecedor via API pública gratuita**
      (confirmado: serviço "Minha Receita", reorganiza dado público da Receita Federal sem
      CAPTCHA) — antes de aprovar um pagamento, o sistema consulta automaticamente se o CNPJ do
      fornecedor está ativo, sem precisar de login manual no site da Receita. Sem SLA garantido
      pelo serviço gratuito — considerar fallback para a API oficial de dados abertos de CNPJ da
      Receita Federal em uso crítico.
- [ ] Fluxo solicitação → aprovação (por alçada de valor) → pagamento — quem solicita nunca
      aprova a própria solicitação (checado no próprio endpoint, não só por convenção).

#### v3.4 — Relatórios e prestação de contas
- [ ] Relatório de prestação de contas em formato público (resumo, sem dado individual de
      associado) para publicar em `/transparencia/` no site institucional (FASE 5) — puxado do
      mesmo dado do FastAPI, nunca digitado duas vezes.

### FASE 4 — Projetos, Reserva de Espaço e Eventos (módulo de integração site ↔ sistema)

Esta é a fase que resolve, de propósito, o problema identificado nas referências de pesquisa:
lá, o site e o sistema de gestão nunca se integraram de verdade, e o módulo de eventos nasceu
*só* no site, sem nenhum dado de associado. Aqui, tanto Projeto quanto Evento nascem como
entidades únicas do FastAPI, com API própria consumida pelo site (leitura pública) e pelo painel
(gestão) — nunca dois cadastros que precisam ser conciliados à mão depois.

Confirmado por pesquisa de mercado (seção 6): **não existe hoje um padrão de mercado maduro e
único para módulo de Projetos em associação genérica** — a maioria dos sistemas de gestão
associativa não cobre isso (é resolvido por fora, com ferramenta genérica de projeto), e os
sistemas que cobrem bem são de terceiro setor assistencial verticalizado. A saída de desenho
recomendada pela própria pesquisa — e adotada aqui — é um cadastro único e configurável de
`Projeto`, com um campo `tipo_projeto` que habilita sub-formulários condicionais, em vez de
modelar qualquer tipo específico de projeto da ASAF direto no código. Isso é deliberado: o
módulo precisa caber projeto educacional, quadra/espaço, ação assistencial, oficina cultural ou
qualquer outro tipo que a associação venha a ter — **sem ficar preso ao que a ASAF faz hoje**.

#### v4.1 — Projeto como entidade única e configurável
- [ ] Tabela `Projeto` (nome, descrição, `tipo_projeto` — catálogo configurável, não enum fixo —,
      responsável, cronograma com marcos/tarefas, status) — API própria (`/api/projetos`).
- [ ] Catálogo `TipoProjeto` configurável pela diretoria (ex.: Educacional, Espaço/Infraestrutura,
      Assistencial, Cultural/Oficina, Capacitação — mas nenhum desses fica fixo em código, são só
      sementes iniciais de exemplo).
- [ ] Cada `TipoProjeto` liga um conjunto de sub-módulos opcionais (ver v4.2–v4.4) — o formulário
      de cadastro de projeto muda conforme o tipo escolhido, sem precisar de deploy novo para
      adicionar um tipo.
- [ ] `Indicador` por projeto (nome, valor-base, meta, valores medidos ao longo do tempo) —
      genérico o bastante para "frequência de aluno" ou "famílias atendidas/mês", sem fórmula fixa.

#### v4.2 — Beneficiários vinculados a projeto
- [ ] Tabela `Beneficiario` (pessoa física, pode ou não ser `Associado` — mesma deduplicação por
      CPF/e-mail da seção 3.5) com vínculo N:N a `Projeto` e papel dentro dele (aluno, atendido,
      participante de oficina) — nunca um cadastro de pessoa por tipo de projeto.
- [ ] Frequência/participação registrada por projeto (data, presença), reaproveitando o mesmo
      mecanismo de check-in que os Eventos vão usar (v4.6) — um só motor de presença, não um por
      tipo de projeto.

#### v4.3 — Reserva de espaço (sub-módulo do tipo "Infraestrutura")
- [ ] Tabela `Espaco` (quadra, salão, campo, sala) com regra própria de conflito por sobreposição
      de horário.
- [ ] `Reserva` (espaço, solicitante, data/hora início-fim, status) com dois fluxos configuráveis
      por espaço — confirmado por pesquisa como padrão de mercado: **instantânea** (auto-
      confirmada) ou **solicitação + aprovação manual** pela diretoria.
- [ ] Diferenciação de tarifa/prioridade por perfil do solicitante (associado adimplente x
      terceiro/avulso) — associado inadimplente não reserva, checado contra o Financeiro (FASE 3),
      não por marcação manual.

#### v4.4 — Voluntariado vinculado a projeto
- [ ] `AlocacaoVoluntario` (já existe embrião no `servidor.py`) — turno/horário, habilidades
      exigidas pelo projeto x habilidades cadastradas do voluntário, horas previstas x realizadas.
- [ ] Certificado de horas de voluntariado gerado a partir do próprio registro de alocação (nome,
      projeto, período, horas cumpridas) — mesmo motor de geração de certificado do módulo de
      Eventos (v4.8), não duplicado.

#### v4.5 — Evento como entidade única (distinto de Projeto: pontual, com inscrição)
- [ ] Tabela `Evento` (título, descrição, data/hora, local — pode referenciar um `Espaco` da v4.3
      ou ser avulso —, responsável, categoria, vagas) — API própria (`/api/eventos`), consumida
      tanto pelo site quanto pelo painel.
- [ ] Endpoint público de listagem (site institucional) e endpoint autenticado de gestão
      (painel) — **o mesmo registro**, nunca duas tabelas.
- [ ] Site institucional (Astro/Directus) só *lê* o endpoint público do FastAPI para exibir
      eventos — Directus não guarda evento algum, só pode enriquecer com banner/texto de chamada
      vinculado por `evento_id` de referência.

#### v4.6 — Inscrição pública com deduplicação
- [ ] Formulário de inscrição no site chama o FastAPI (não o Directus) com CPF + e-mail +
      telefone.
- [ ] Deduplicação (seção 3.5): CPF já é `Associado`/`Beneficiario` conhecido → inscrição
      vinculada ao cadastro existente, sem pedir dado que o sistema já tem. CPF novo → registro de
      "participante externo", nunca vira `Associado` automaticamente.
- [ ] Perguntas de inscrição personalizadas por evento (texto curto, texto longo, seleção única/
      múltipla, número, data) — cada evento define as próprias perguntas, sem campo fixo além de
      nome/telefone/CPF.

#### v4.7 — Vagas, lista de espera e inscrição em grupo
- [ ] Limite de vagas com trava real (não só informativo) — acima do limite, inscrição vira lista
      de espera automaticamente, com promoção automática quando alguém desiste ou o limite
      aumenta.
- [ ] Inscrição em grupo (família, delegação) — cada nome vira uma inscrição própria (código de
      check-in individual), telefone/respostas compartilhados pelo grupo quando fizer sentido.

#### v4.8 — Check-in, crachá e certificado (motor único, reaproveitado por Projeto e Evento)
- [ ] Check-in por código curto (gerado na inscrição/alocação) ou por QR code — sem exigir login
      de quem opera a portaria.
- [ ] Emissão de crachá e certificado em PDF a partir do mesmo registro de presença — nunca
      planilha solta ou exportação de lista completa em lote (risco de vazamento identificado nas
      referências de pesquisa).

#### v4.9 — Financeiro de projeto/evento
- [ ] Cobrança de inscrição/uso de espaço integrada ao módulo financeiro (FASE 3) — valor por
      faixa (ex.: "associado" x "não associado"), conciliação manual, sem gateway de pagamento.
- [ ] Fechamento financeiro (relatório automático: inscritos/beneficiários, presentes, valor
      arrecadado) ao encerrar o projeto/evento — mesma lógica de auditoria do restante do
      financeiro.

#### v4.10 — Painel gerencial (projetos, espaços e eventos)
- [ ] Tela de inscritos/beneficiários/reservas: busca, filtros, edição, sem exportação de dado
      pessoal em lote.
- [ ] Indicadores agregados por projeto (evolução do `Indicador` da v4.1, comparação entre
      edições de um mesmo evento) — nunca lista individual exposta fora do painel autenticado.

### FASE 5 — Site institucional (conteúdo público)

#### v5.1 — Directus como CMS de conteúdo
- [ ] Coleções: páginas institucionais, notícias, banners, galeria — só conteúdo público, nunca
      dado de associado/financeiro/evento em si (eventos são lidos do FastAPI, ver FASE 4).
- [ ] Site construído em Astro (ou stack equivalente definida na implementação), consumindo a API
      pública do FastAPI para eventos e a API do Directus para conteúdo editorial.

#### v5.2 — Páginas essenciais
- [ ] Home, Quem Somos/História, Notícias, Eventos (lendo do FastAPI), Transparência (lendo o
      relatório da v3.4), Contato, Doações.

#### v5.3 — Formulário de voluntariado
- [ ] Formulário público de interesse em voluntariado — mesma lógica de deduplicação da FASE 4
      (não cria associado novo, só um registro de interesse vinculado por CPF/e-mail quando já
      existir cadastro).

### FASE 6 — Comunicação e transparência

#### v6.1 — Comunicação interna
- [ ] Avisos/comunicados no painel, visíveis por nível de permissão.

#### v6.2 — Transparência pública
- [ ] Publicação automática do relatório financeiro resumido (v3.4) e de documentos institucionais
      (estatuto, atas de assembleia) em `/transparencia/`.

### FASE 7 — LGPD e Segurança

#### v7.1 — Consentimento e retenção
- [ ] Consentimento explícito para dado sensível (foto, dado de menor de idade se houver).
- [ ] Política de retenção documentada por tipo de dado (associado ativo, inscrito de evento
      externo, voluntário) — nunca "guardar tudo para sempre" sem justificativa registrada.

#### v7.2 — Direitos do titular
- [ ] Canal de solicitação de acesso/exclusão/retificação pelo próprio painel (associado) e pelo
      site (não associado, via formulário de contato com assunto específico).

#### v7.3 — Segurança de infraestrutura
- [ ] Headers de segurança HTTP (CSP, `X-Content-Type-Options`, `X-Frame-Options`) no site
      estático.
- [ ] Rate limiting nos endpoints públicos (inscrição de evento, contato) — proteção contra spam/
      abuso sem exigir captcha comercial pago.

### FASE 8 — Infraestrutura e Deploy (Azure)

#### v8.1 — Provisionamento
- [ ] Azure Database for PostgreSQL Flexible Server (Burstable B1ms, ~US$15/mês) — banco único.
- [ ] FastAPI em Azure Container Apps (plano consumo, ~US$10–20/mês).
- [ ] Directus em Azure Container Apps (plano consumo, ~US$10–20/mês).
- [ ] Site institucional + painel (SPA) em Azure Static Web Apps (grátis).
- [ ] Blob Storage para uploads/anexos (~US$1–5/mês).
- [ ] Key Vault para segredos, Application Insights para monitoramento (grátis/baixo custo).
- [ ] Total estimado: ~US$40–60/mês, dentro do teto de US$100/mês definido em 3.6.

#### v8.2 — CI/CD
- [ ] GitHub Actions: workflow separado para API (FastAPI), Directus e front-ends (site + painel),
      cada um publicando no respectivo serviço Azure via OIDC (sem segredo de longa duração salvo
      no GitHub).
- [ ] Ambiente de homologação antes de produção para os três componentes.

### FASE 9 — Experiência, performance e acessibilidade

#### v9.1 — Acessibilidade (WCAG)
- [ ] Auditoria automatizada (axe-core ou equivalente) no site institucional e no painel.
- [ ] Modo alto contraste / aumento de fonte no site público.

#### v9.2 — Performance
- [ ] `srcset` responsivo para imagens de capa/galeria.
- [ ] Cache de longo prazo para assets versionados do build.

### FASE 10 — Expansão futura (registrado, não compromisso)

- [ ] App instalável (PWA) para o painel do associado.
- [ ] Notificação push para lembrete de evento/mensalidade.
- [ ] Segunda unidade/sede da associação, se a ASAF vier a ter mais de um endereço — decisão de
      modelo de dado (unidade única vs. multi-unidade) fica para quando essa necessidade for
      confirmada, não antes.

### FASE 11 — Diferenciais avançados (além do mercado)

Pedido explícito do usuário: não construir "mais um sistema de associação comum" — ir além do
que já existe. Pesquisa dedicada (seção 6) trouxe o que sistemas de ponta (CRM, ERP, plataformas
de engajamento de comunidade) fazem hoje. Esta fase entra **depois** das fundações (FASE 0–9)
estarem de pé — nenhum destes itens tenta substituir o básico, todos dependem dele já existir.

#### v11.1 — Engajamento, score e gamificação
- [ ] `EngagementScore` calculado por job periódico (peso configurável: presença em evento/
      projeto, adimplência, participação em votação, uso do portal, indicação de novo associado)
      — nunca digitado à mão.
- [ ] Exibição ao associado como "nível" com badges simples (ex.: bronze/prata/ouro) — não é
      ranking público entre associados, é indicador pessoal de envolvimento.
- [ ] Programa de indicação (`referred_by` no cadastro) com benefício (desconto ou pontos) para
      quem indica um novo associado aprovado.
- [ ] Score usado como gatilho de régua de comunicação: associado com engajamento em queda entra
      automaticamente numa campanha de reativação (v11.3).

#### v11.2 — IA e automação (com escopo restrito, nunca acesso irrestrito)
- [ ] Modelo simples de risco de inadimplência (regressão logística/XGBoost leve) treinado com
      histórico de pagamento + engajamento — alimenta o painel executivo (v11.8), não decide
      nada sozinho.
- [ ] Assistente de atendimento ao associado com escopo restrito (RAG sobre estatuto/regimento +
      ferramentas de consulta aos próprios dados do associado autenticado) — nunca com permissão
      de escrita irrestrita; fallback para atendimento humano em qualquer fluxo de mais de 2
      passos.
- [ ] Rascunho automático de ata de assembleia a partir de transcrição/notas — sempre revisado e
      assinado por humano antes de virar documento oficial.

#### v11.3 — Comunicação institucional via WhatsApp Business (API oficial)
- [ ] Integração via Meta Cloud API (ou parceiro oficial/BSP) — nunca `wa.me` automatizado nem
      WhatsApp Web programado (viola os termos de uso e gera banimento do número).
      Confirmado por pesquisa: mensagens de categoria "utility" (boleto vencendo, confirmação de
      inscrição) custam 80–95% menos que "marketing" — usar utility como padrão, marketing só
      para campanha segmentada deliberada.
- [ ] Central de notificações multicanal (`notification`, canal preferido por associado: e-mail,
      push web, WhatsApp) com fallback em cascata se um canal falhar.

#### v11.4 — Clube de benefícios (parcerias comerciais para o associado)
- [ ] `Parceiro`, `Beneficio` (tipo: desconto fixo/percentual/cashback, categoria, vigência),
      `ResgateBeneficio` (associado, parceiro, data, valor).
- [ ] Validação do benefício via carteirinha digital (QR code já existente da FASE 1) — começa
      simples (lista de parceiros com cupom) e evolui para validação/cashback conforme a demanda
      real aparecer.

#### v11.5 — Segurança avançada (MFA e SSO)
- [ ] MFA obrigatório (TOTP, biblioteca `pyotp`) para todo perfil administrativo/financeiro do
      painel — segredo criptografado em repouso, códigos de backup hasheados.
- [ ] Avaliar Keycloak como IdP central (OIDC/SAML) para SSO entre os módulos internos, deixando
      caminho aberto para plugar Azure AD/Entra ID no futuro sem reescrever a aplicação.
- [ ] Revisão periódica de acesso (trimestral): relatório automático de quem tem qual papel,
      exigindo confirmação explícita de recondução ou revogação por um gestor — nunca acesso que
      só cresce e nunca é reavaliado.

#### v11.6 — Conciliação bancária automática (Open Finance Brasil)
- [ ] Camada de abstração para agregador bancário (ex.: Pluggy, já usado por ERPs de pequeno
      porte no Brasil) — associado/gestor financeiro autoriza o consentimento Open Finance uma
      vez, o sistema recebe extrato via webhook e concilia automaticamente contra o plano de
      contas (FASE 3), com fallback manual para o que não casar sozinho.

#### v11.7 — Portal self-service de ponta
- [ ] Assinatura eletrônica de documentos internos — ver FASE 20 (plataforma própria com trilha
      de evidência: OTP, metadados, timestamp, hash SHA-256, selo do servidor) — nunca só "aceite"
      de checkbox para documento com peso jurídico.
- [ ] Declarações automáticas geradas sob demanda (declaração de associado ativo, comprovante de
      participação) via template preenchido a partir do próprio cadastro — sem intervenção manual
      da secretaria para cada pedido.
- [ ] Extrato de participação no painel do associado (frequência em eventos/projetos, votos,
      pontos de engajamento acumulados) num só lugar.

#### v11.8 — BI e painel executivo para a diretoria
- [ ] Metabase self-hosted (open source, grátis) apontando para o Postgres (ou réplica read-only)
      — sem depender de ferramenta paga de BI.
- [ ] 4 dashboards temáticos: financeiro (receita recorrente x inadimplência, fluxo de caixa),
      engajamento (score médio, participação em eventos/assembleias), crescimento (novos
      associados, churn, conversão de indicação) e compliance (revisões de acesso vencidas,
      pendência de auditoria).
- [ ] Alertas nativos do Metabase (ex.: "inadimplência > 8%") notificando a diretoria por e-mail —
      sem precisar construir motor de alerta próprio.

#### v11.9 — Benchmarking entre associações (espaço de diferenciação real, sem produto genérico hoje)
Achado de pesquisa confirmado: o conceito de associações compartilharem indicadores entre si
existe e é praticado no Brasil (Vitrine de ONGs — dados financeiros anônimos comparáveis desde
2020; ABAR — Benchmarking Colaborativo entre agências reguladoras; GIFE — Rede Temática de Gestão
Institucional) — mas **nenhum desses é um produto de software genérico e comercial** que qualquer
associação pode simplesmente assinar. É um espaço real de inovação, não hype.
- [ ] Módulo opcional (participação voluntária, nunca automática) de compartilhamento anônimo de
      indicadores agregados (ex.: taxa de inadimplência, engajamento médio, crescimento anual)
      com outras associações parceiras/da mesma rede/federação, para benchmark comparativo — nunca
      dado individual de associado, só métrica agregada já calculada pelo painel executivo
      (v11.8).
- [ ] Fica como visão de médio prazo (não faz parte da fundação do sistema) — depende de outras
      associações também adotarem um sistema compatível ou um protocolo comum de troca de dado,
      o que hoje não existe pronto no mercado.

### FASE 12 — Conformidade legal e governança além do mínimo

Pedido explícito do usuário: pesquisar a legislação real e ir além do mínimo exigido, não só
"cumprir a lei". Esta fase soma o que o Código Civil já exige (refletido nas FASES 1 e 2) com o
que organizações de referência do terceiro setor fazem *voluntariamente*, acima da obrigação
legal — e cobre módulos de gestão que ainda não tinham aparecido no plano.

#### v12.1 — Ativação condicional do módulo de parcerias com poder público (MROSC)
- [ ] A Lei 13.019/2014 só se aplica quando a associação firma Termo de Colaboração, Termo de
      Fomento ou Acordo de Cooperação com o poder público — **não** se aplica a mensalidade de
      associado, doação privada ou venda de serviço. Este submódulo fica **desativado por
      padrão** e só aparece no painel se a diretoria confirmar que a ASAF recebe/pretende receber
      recurso público.
- [ ] Quando ativado: plano de trabalho com metas e indicadores, prestação de contas por
      resultado (não só nota fiscal), publicidade obrigatória da parceria — distinto do módulo
      financeiro genérico (FASE 3), que continua sendo o financeiro do dia a dia.

#### v12.2 — Obrigações fiscais de entidade sem fins lucrativos
- [ ] Painel de situação fiscal: lembrete de obrigações acessórias recorrentes (ECF anual — até
      isenta precisa declarar para provar a condição —, DCTF quando aplicável) — apoio
      informativo, não substitui contador.
- [ ] CEBAS tratado como módulo **condicional**, só relevante se a ASAF atuar em assistência
      social/saúde/educação e buscar isenção de contribuição patronal — não construir isso sem
      confirmação de que se aplica à ASAF.

#### v12.3 — Compliance além do mínimo legal
- [ ] Código de ética/conduta publicado e versionado (diretoria, associados, voluntários,
      fornecedores) — aceite registrado por pessoa, com trilha de auditoria de qual versão cada
      um aceitou (mesmo padrão de "termo com versão" já usado em outros pontos do plano).
- [ ] Canal de denúncia (whistleblowing) com opção de anonimato real — quem denuncia
      anonimamente nunca tem identificação gravada no banco, só o relato e o protocolo de
      acompanhamento (não é redação condicional de exibição, é ausência real do dado).
- [ ] Suporte a auditoria externa voluntária: exportação de relatório fechado por período para
      um auditor externo revisar — vai além da obrigação legal mínima (que não exige auditoria
      externa para a maioria das associações).
- [ ] Preparação para selos de transparência do terceiro setor (Selo ONG Verificada, Selo Doar,
      Selo Transparência — três selos distintos e complementares) — o sistema gera os dados que
      esses selos pedem (prestação de contas, governança, dados abertos) como exportação
      estruturada, não uma certificação em si.

#### v12.4 — Patrimônio e inventário de bens
- [ ] Cadastro de ativos fixos da associação (bem, valor, localização física, data de aquisição),
      com etiqueta/QR code para conferência de inventário anual — módulo novo, identificado só
      nesta pesquisa, ausente do plano anterior.
- [ ] Vínculo com o financeiro (FASE 3) para depreciação simples, sem duplicar lançamento.

#### v12.5 — Contratos e convênios
- [ ] Repositório central de contratos/convênios (fornecedor, parceiro, poder público) com
      vigência, alerta de renovação e cláusulas críticas destacadas — distinto de "conta a pagar"
      (FASE 3): aqui o objeto é o contrato em si, não o lançamento financeiro que ele gera.

#### v12.6 — Captação de recursos (fundraising avançado)
- [ ] Além da doação simples via PIX (já prevista): funil de doador (quem doou, quando, quanto,
      recorrência), gestão de editais/grants (prazo, valor, status de submissão), relatório de
      impacto por doador — combinando dado do financeiro com dado de projeto/indicador (FASE 4).

#### v12.7 — Portal de transparência ativa
- [ ] Página pública dedicada (site institucional, FASE 5) reunindo automaticamente: prestação de
      contas, atas de assembleia, estatuto vigente, e — quando o v12.1 estiver ativo — relatório
      de parcerias com poder público. Gerado a partir do próprio dado do sistema, nunca digitado
      duas vezes.

#### v12.8 — Matriz de riscos institucional
- [ ] Cadastro de riscos (probabilidade x impacto) vinculados a objetivos estratégicos (v12.9),
      com plano de mitigação e responsável — ferramenta de gestão para a diretoria, não um
      processo burocrático solto.

#### v12.9 — Planejamento estratégico (metas e indicadores)
- [ ] Combinação simples de visão de longo prazo (objetivos estratégicos plurianuais) com metas
      trimestrais de execução — vinculado aos indicadores de projeto já existentes (FASE 4) e ao
      painel executivo (FASE 11, v11.8), para não duplicar métrica.

#### v12.10 — Sucessão de diretoria e continuidade institucional
- [ ] Banco de competências do conselho/diretoria (histórico de cargos, formação, disponibilidade
      futura) — achado de pesquisa: falta de plano de sucessão formal é um risco real e recorrente
      em associações brasileiras. Cronograma de transição entre gestões, com checklist de
      continuidade (acesso ao sistema, documentos, contratos vigentes) entregue formalmente ao
      próximo mandato.

### FASE 13 — Assembleia, Diretoria e processos administrativos (detalhamento máximo)

> ✅ **Nota de proveniência atualizada**: os pontos jurídicos centrais desta fase foram
> revalidados com fonte real numa rodada de pesquisa seguinte (seção 6.2): o registro de ata em
> RCPJ é confirmado pelo Art. 45 do Código Civil (a existência legal da associação e toda
> alteração do ato constitutivo dependem de registro/averbação em cartório — sem isso, os
> dirigentes podem responder pessoalmente por obrigação contraída irregularmente) e reforçado
> pelo princípio da continuidade da Lei 6.015/1973; o voto por procuração é confirmado como
> prática comum, mas dependente de previsão estatutária expressa, nunca padrão universal — por
> isso o sistema trata isso como configuração por associação, nunca valor fixo. A única peça
> ainda não confirmada é a exigência exata de RCPJ que pode variar por estado — a confirmar com
> o cartório local da ASAF antes da implementação real do v13.4.

#### v13.1 — Assembleia Geral no limite máximo
- [ ] Quóruns simultâneos por matéria: quórum de instalação (1ª/2ª/3ª convocação) separado do
      quórum de aprovação — simples para deliberação comum, qualificado (ex. 2/3) para reforma
      estatutária, quórum especial para destituição de diretor (Art. 59, parágrafo único, exige
      assembleia especialmente convocada para esse fim).
- [ ] Comissão de verificação de poderes/credenciamento: checagem de adimplência antes de liberar
      o voto (regra configurável, não travada em código — depende do estatuto real permitir ou
      não associado inadimplente votar).
- [ ] Mesa diretora dos trabalhos distinta da diretoria eleita (evita conflito quando a pauta é a
      prestação de contas da própria diretoria).
- [ ] Pauta com itens votáveis separadamente — cada item da ordem do dia é um registro atômico
      com resultado próprio, nunca um "sim/não" único pra assembleia inteira.
- [ ] Tipos de votação configuráveis por item de pauta: aberta/nominal, secreta (comum para
      eleição de cargos), aclamação (chapa única) — com abstenção como categoria própria de
      resultado, nunca ausência de registro.
- [ ] Voz sem voto (convidado, categoria de associado sem direito a voto) — compõe presença mas
      não compõe quórum.
- [ ] Procuração/representação: campo de configuração **por associação** (permite ou não voto por
      procuração) — nunca assumir que é permitido; muitos estatutos vedam para preservar o
      caráter pessoal do voto. Depende do estatuto real da ASAF (ver seção 8).
- [ ] Impugnação de voto e recurso: registro de protesto vinculado à ata, com prazo estatutário
      para recurso à assembleia seguinte ou ao Conselho Fiscal.

#### v13.2 — Diretoria Executiva: atribuições viram alçada de permissão
- [ ] Matriz cargo → ação: o que cada cargo pode aprovar/assinar/representar (Presidente
      representa a associação em juízo e assina contratos; 1º Secretário lavra/assina atas e
      expede certidões; 1º Tesoureiro assina movimentação financeira, frequentemente em conjunto
      com o Presidente acima de um teto de valor) — isso não é texto de estatuto solto, é
      permissão real checada pelo sistema (reforça a segregação de funções da FASE 2/3).
- [ ] Regra de dupla assinatura configurável (valor-limite acima do qual dois aprovadores
      distintos são obrigatórios) — já prevista genericamente na FASE 3 (alçada por valor);
      aqui fica explicitamente ligada ao cargo estatutário, não só ao nível de permissão.
- [ ] Delegação temporária rastreável (ex.: vice-presidente assume alçada do presidente por
      período determinado) — com log de início/fim, nunca delegação permanente por engano.
- [ ] Todo documento gerado pelo sistema carrega o **cargo** de quem assina, não só o nome —
      documento sobrevive à troca de mandato sem ficar órfão de contexto.

#### v13.3 — Secretaria: credenciamento, QR code e protocolo interno
- [ ] Fluxo de credenciamento: cadastro inicial → triagem documental pela secretaria → aprovação
      → emissão de carteirinha/QR code único vinculado ao CPF — reaproveita a carteirinha digital
      já prevista na FASE 1.
- [ ] QR code com duplo uso: check-in de presença em assembleia (compõe quórum e frequência) e
      controle de acesso físico à sede (nega acesso a inadimplente sem bloquear o cadastro em
      si) — mesmo QR code, dois contextos de leitura.
- [ ] Atualização cadastral com aprovação: associado solicita alteração → estado "pendente" →
      secretaria aprova/rejeita com justificativa → log de quem alterou o quê e quando (auditoria
      da mudança, não só o valor final).
- [ ] Protocolo interno de requerimento: numeração sequencial única (ex.: `PROT-2026-000123`),
      tipo (2ª via de documento, declaração de vínculo, reconsideração de decisão, recurso), prazo
      de resposta configurável por tipo, status (recebido/em análise/respondido/arquivado).

#### v13.4 — O que o sistema não substitui (registro externo obrigatório)
- [ ] Ata que altera estatuto, elege diretoria ou precisa valer perante terceiros (banco, Receita
      Federal, CEBAS, fornecedor) **precisa de registro no Cartório de Registro Civil de Pessoas
      Jurídicas (RCPJ)** para ter eficácia perante terceiros — o sistema gera a ata e guarda a
      referência (número de registro, imagem do documento registrado), mas o ato cartorial em si
      é sempre externo, manual, com taxa e prazo próprios. Nunca simular essa função.
- [ ] Termo de fomento/parceria com poder público (quando o v12.1/MROSC estiver ativo) muitas
      vezes exige protocolo em plataforma oficial do ente público — o sistema prepara o dossiê e
      gera os anexos, o protocolo oficial acontece fora dele.
- [ ] Ofício formal: o sistema gera o PDF e numera internamente; o envio/protocolo com carimbo de
      recebimento em órgão público é sempre ato externo.

#### v13.5 — Assinatura eletrônica: descartado gov.br, ver FASE 20
- [ ] ~~Assinatura eletrônica via gov.br~~ — **descartado, confirmado por pesquisa e pela
      tentativa real do usuário**: a página oficial do Governo Digital restringe a API de
      Assinatura Eletrônica gov.br explicitamente a "qualquer órgão público das esferas federal,
      estadual e municipal" — associação privada não se enquadra, ponto final, não é questão de
      burocracia extra. A solução real (certificado ICP-Brasil em nuvem, mesma validade jurídica)
      está detalhada na FASE 20.

### FASE 14 — Educação/Aulas (módulo condicional)

Só relevante se a ASAF vier a ter escola, reforço escolar ou curso próprio — não é módulo padrão
ativo por default, é mais um `tipo_projeto` (FASE 4) com sub-entidades próprias.

#### v14.1 — Modelo simples (não é plataforma EAD completa)
- [ ] `Turma` (nome, período, capacidade, professor responsável).
- [ ] `Aluno` (pode ou não ser associado/beneficiário já cadastrado — nunca cadastro duplicado,
      mesma deduplicação por CPF da seção 3.5).
- [ ] `Matricula` (vínculo aluno-turma, status ativo/trancado/concluído).
- [ ] `Frequencia` (registro por aula, não só um agregado mensal) — reaproveita o mesmo motor de
      check-in de presença da FASE 4.
- [ ] `Avaliacao` (nota ou conceito, critério configurável) — deliberadamente simples, sem tentar
      reproduzir histórico curricular formal de escola registrada no MEC.

### FASE 15 — Segurança da informação em profundidade

Expande o que já estava na FASE 11 (v11.5, MFA/SSO) com defesa em camadas real, necessária porque
associado, voluntário, diretoria e financeiro dividem o mesmo banco.

#### v15.1 — Isolamento de dado por linha (row-level security)
- [ ] Row-level security nativo do PostgreSQL — confirmado com fonte oficial (documentação do
      Postgres, seção "Row Security Policies": `CREATE POLICY`/`ENABLE ROW LEVEL SECURITY`
      restringe por linha o que cada `role` vê, complementando os grants de tabela) e prática
      real de produção (documentação da Supabase descreve o mesmo padrão em SaaS multi-tenant,
      com `auth.uid()` adicionando uma cláusula `WHERE` automática a toda query). Um voluntário
      só enxerga linhas onde `voluntario_id = usuário atual`, mesmo que a aplicação tenha um bug
      de autorização — o **banco** recusa a consulta, não só a API.
- [ ] Papel de aplicação por módulo (o módulo de Educação nunca tem permissão de leitura em
      tabela financeira) — menor privilégio entre módulos, não só entre pessoas.

#### v15.1.1 — Ancoragem de auditoria de votação (hipótese de inovação, não confirmada no mercado)
- [ ] ⚠️ Diferente do restante desta fase, este item **não tem confirmação de adoção real** no
      nicho associativo (pesquisa dedicada não achou fonte verificável de uso). Proposta a
      avaliar, não fato estabelecido: hash do resultado de uma votação de assembleia (FASE 13)
      ancorado por carimbo de tempo RFC 3161 de uma Autoridade de Carimbo do Tempo credenciada
      ICP-Brasil (que tem base legal sólida no Brasil, diferente de blockchain público) — provaria
      que o resultado não foi alterado depois da apuração. Tratar como experimento de fase
      avançada, nunca como recurso já validado por outros sistemas.

#### v15.2 — Log de acesso, não só de alteração
- [ ] Toda leitura de CPF/dado financeiro sensível gera registro de auditoria próprio, separado
      do log de alteração já previsto (`AuditLog`, FASE 0) — hoje o plano só audita mudança; isso
      adiciona auditoria de **consulta**.

#### v15.3 — Criptografia de dado sensível em repouso
- [ ] CPF e dados bancários cifrados em repouso (`pgcrypto` ou coluna cifrada na aplicação) —
      nunca texto plano, mesmo com row-level security já ativo (camadas independentes, uma não
      substitui a outra).

#### v15.4 — Isolamento estrito do papel "voluntário"
- [ ] Voluntário tem login próprio (v1.4), mas visibilidade limitada ao próprio histórico de
      participação — nunca dado de outro voluntário/associado, nunca dado financeiro da
      associação. Implementado via row-level security + view dedicada ao papel voluntário, não só
      por filtro de tela — reforça exatamente o pedido do usuário: "o voluntário não é associado,
      mas tem que ter acesso pra saber onde se voluntariou" — acesso real, mas estritamente
      contido ao próprio histórico.

### FASE 16 — Continuidade de negócio e recuperação de desastres

Dimensionada ao porte real da associação — confirmado por pesquisa (documentação oficial da
Microsoft) que a maior parte da necessidade já é coberta nativamente pelo Azure, sem precisar de
infraestrutura paralela cara.

#### v16.1 — Backup e retenção
- [ ] Retenção de backup do Postgres em **35 dias** (o máximo do tier, custo desprezível — até
      100% do armazenamento provisionado é gratuito para backup) em vez do padrão de 7 dias.
- [ ] Geo-redundância de backup ativada **desde a criação do servidor** (só pode ser configurada
      nesse momento, não depois) — cobre indisponibilidade regional inteira do Azure.
- [ ] Backup lógico adicional (`pg_dump` periódico) guardado **fora** da mesma assinatura Azure
      (storage account separado ou repositório externo) — segunda camada de proteção contra o
      cenário "a assinatura inteira foi excluída/comprometida", que o backup nativo não cobre
      (confirmado: excluir o servidor apaga os backups automáticos junto).

#### v16.2 — Metas realistas (RPO/RTO) e teste de restauração
- [ ] RPO de referência: ~5 minutos (nativo do point-in-time restore do Postgres Flexible
      Server). RTO de referência: poucas horas (tempo de restauração + reconfiguração manual de
      firewall/rede, que não é copiada automaticamente no restore).
- [ ] **Teste de restauração completo pelo menos uma vez por ano**, mais teste pontual após
      qualquer mudança relevante de infraestrutura (upgrade, migração de storage) — prática
      confirmada como o ponto mais negligenciado e mais barato de corrigir; não há como validar
      backup sem de fato restaurá-lo.
- [ ] Registrar cada teste de restauração (data, resultado, tempo gasto) em documento de
      continuidade — não é suficiente "confiar" que o backup funciona.

#### v16.3 — O que fica fora de escopo (evitar over-engineering)
- [ ] Multi-region ativo-ativo, réplica de leitura dedicada a disaster recovery, e ferramentas de
      backup de nível empresarial com retenção de anos — só fazem sentido se houver exigência
      legal de retenção de longo prazo, o que não é o caso padrão de uma associação. Não construir
      preventivamente.

### FASE 17 — Integração contábil (apoio ao contador, não substituição)

#### v17.1 — Obrigações reais confirmadas por pesquisa
- [ ] Confirmado: associação sem fins lucrativos **não está livre de obrigação acessória só por
      ser imune/isenta**. ECD (Escrituração Contábil Digital) é obrigatória para entidade
      imune/isenta com receita anual abaixo de R$ 4.800.000 (a maioria das associações de porte
      médio/pequeno se enquadra aqui, não na dispensa); ECF é exigida sempre que há receita, mesmo
      sem lucro tributável; EFD-Contribuições entra quando a soma de contribuições no mês
      ultrapassa R$ 10.000.
- [ ] Isso não é opcional de verificar depois — o financeiro (FASE 3) precisa nascer com plano de
      contas e lançamentos estruturados o bastante para alimentar essas obrigações desde o início,
      não como retrabalho futuro.

#### v17.2 — O que o sistema deve construir (apoio real ao contador)
- [ ] Exportação de lançamentos contábeis (livro diário/razão) em formato importável por sistema
      contábil de terceiro (CSV/layout comum) — reduz retrabalho manual do contador terceirizado.
- [ ] Relatórios de receita/despesa por centro de custo/projeto (útil tanto para prestação de
      contas a doador quanto para o próprio ECF).
- [ ] Trilha de auditoria de todo lançamento (já prevista na FASE 0/3) — pré-requisito para
      qualquer exportação contábil confiável.

#### v17.3 — O que fica sempre com o contador humano (nunca automatizado pelo sistema)
- [ ] Geração e transmissão do arquivo SPED (ECD/ECF) em si — formato com blocos e validações
      fiscais complexas, responsabilidade técnica de contabilista habilitado (CRC). O sistema da
      ASAF **nunca** se apresenta como substituto de software contábil homologado — só alimenta
      dado limpo para reduzir o trabalho de quem já faz isso profissionalmente.

### FASE 18 — Qualidade de software e observabilidade em produção

Dimensionada ao porte do sistema: confiável, mas sem o rigor de um sistema financeiro regulado.

#### v18.1 — Pirâmide de testes (não pirâmide invertida)
- [ ] Base: muitos testes unitários rápidos cobrindo regra de negócio real (cálculo de
      mensalidade/elegibilidade, deduplicação por CPF, cálculo de quórum) — nunca testes de UI
      cobrindo o que um teste unitário resolveria mais rápido.
- [ ] Meio: testes de integração moderados para os pontos que tocam banco/serviço externo
      (autenticação, conciliação financeira).
- [ ] Topo: poucos testes ponta a ponta cobrindo só os 3-5 fluxos que não podem quebrar (login,
      pagamento de mensalidade, cadastro de associado, inscrição em evento, votação).

#### v18.2 — Observabilidade sem ferramenta paga adicional
- [ ] Azure Application Insights (já previsto na FASE 8) — plano gratuito cobre os primeiros 5
      GB/mês de log, suficiente para o porte da ASAF sem custo adicional.
- [ ] O essencial para logar: erro não tratado com stack trace, tempo de resposta de endpoint
      crítico, falha de autenticação/autorização, e evento de negócio-chave (pagamento
      processado, e-mail/WhatsApp não entregue).
- [ ] Alertas nativos do Application Insights (regra de métrica → e-mail) — sem precisar de
      Datadog/Grafana Cloud ou stack de observabilidade paralela.

#### v18.3 — O que fica fora de escopo (evitar over-engineering)
- [ ] Tracing distribuído completo (OpenTelemetry span-by-span em toda a stack) e SLO formal com
      error budget — nível de rigor de empresa de tecnologia grande, não necessário aqui.

### FASE 19 — Aplicativo móvel: quando sai do PWA para nativo (condicional)

O plano já decidiu PWA como estratégia principal (FASE 9/10). Esta fase existe só para deixar
claro **quando** valeria a pena sair disso — não é compromisso de construir app nativo agora.

#### v19.1 — O que o PWA já resolve sozinho (confirmado por pesquisa)
- [ ] Push notification: iOS já suporta Web Push para PWA instalado na tela inicial (com
      paridade real — tela bloqueada, central de notificações), desde que o associado instale o
      atalho — não é motivo suficiente para app nativo.
- [ ] Carteirinha digital tipo wallet: tanto Google Wallet quanto Apple Wallet **não exigem app
      nativo** — são emitidos via API do backend e distribuídos por link/e-mail, abrindo direto
      no wallet do celular. A carteirinha (já prevista na FASE 1) pode evoluir para isso sem
      nunca precisar de app próprio.

#### v19.2 — O único motivo real para considerar app nativo
- [ ] Biometria como segundo fator de autenticação (Face ID/Touch ID/biometria Android) é o
      recurso genuinamente exclusivo de app nativo — WebAuthn no navegador tem suporte mais
      fragmentado. Só reconsiderar app nativo se isso virar requisito não-negociável.
- [ ] Custo real de manter app nativo (confirmado): Apple Developer Program custa US$99/ano, mas
      organização sem fins lucrativos pode solicitar isenção — o que reduz a barreira financeira,
      mas não elimina o custo de manutenção (build separado por plataforma, ciclo de revisão de
      loja, atualização obrigatória por mudança de SO, QA duplicado).
- [ ] Decisão registrada: **não construir app nativo nesta fase do projeto** — reavaliar só se
      biometria virar necessidade real e não apenas "seria legal ter".

### FASE 20 — Autenticação avançada e assinatura eletrônica própria (substitui gov.br)

Nasce da correção confirmada nas FASES 0 e 13: gov.br não é caminho viável para uma associação
privada (assinatura eletrônica gov.br é restrita por norma a órgão público; login único gov.br
para app privado exige contrato comercial via Loja do Serpro/Dataprev, com aprovação
discricionária de "interesse público" — inviável para o porte da ASAF). Esta fase entrega as
alternativas reais, mantendo tudo **dentro do próprio sistema**, sem redirecionar o associado para
site de terceiro.

#### v20.1 — Login único próprio via Keycloak (confirmado como maduro para este porte)
- [ ] Keycloak self-hosted (open source, mantido pela Red Hat, projeto CNCF) como provedor de
      identidade central (OIDC) para todos os módulos do sistema — já citado na FASE 11 (v11.5)
      como caminho de SSO/MFA; esta versão o confirma como **substituto direto e suficiente** do
      gov.br, sem cobrança por usuário ativo (diferente de Auth0/Okta) e sem depender de
      aprovação de terceiro. O custo é operacional (deploy, patch, backup por conta da própria
      equipe), não de maturidade técnica — aceitável para o porte do projeto.
- [ ] Suporta o cenário mencionado pelo usuário: autenticação para chamada/frequência (voluntário
      ou associado autenticado antes de registrar presença), tudo dentro do mesmo provedor de
      identidade, sem sistema paralelo.

#### v20.2 — Plataforma própria de assinatura eletrônica (evidence trail completo, sem provedor terceiro pago)
Decisão do usuário: em vez de assinar contrato com BirdID/Soluti/Clicksign, a ASAF constrói sua
própria plataforma de assinatura para documentos internos, com trilha de evidência forte o
bastante para provar autenticidade sem depender de serviço pago de terceiro. A força jurídica de
uma assinatura eletrônica simples/avançada (Lei 14.063/2020, Art. 4º) vem exatamente da qualidade
dessa trilha — não é "clicar num botão", é reunir prova suficiente para nunca ser repudiada.

**Autenticação do signatário no momento da assinatura**
- [ ] Segunda etapa obrigatória no ato de assinar (não basta já estar logado): token OTP enviado
      por e-mail ou WhatsApp institucional (reaproveita a central de notificações multicanal já
      prevista na FASE 11/v11.3), **ou** confirmação de senha forte do usuário logado — nunca só
      um clique em botão sem segundo fator.

**Metadados do signatário (capturados no momento exato do aceite)**
- [ ] Nome completo, CPF, e-mail cadastrado (institucional ou pessoal), endereço IP, User-Agent
      do navegador e geolocalização aproximada (por IP, sem exigir permissão de GPS do
      dispositivo) — tudo gravado junto ao evento de assinatura, nunca inferido depois.

**Carimbo de tempo confiável**
- [ ] Data/hora exata com fuso horário, sincronizada via NTP (idealmente contra um servidor NTP.br
      do Observatório Nacional) — nunca confiar só no relógio do servidor de aplicação sem
      sincronização, que pode divergir.

**Integridade criptográfica do documento**
- [ ] Hash SHA-256 do arquivo calculado no exato momento do aceite e gravado junto ao registro de
      assinatura — qualquer alteração posterior no PDF (mesmo um caractere) muda o hash e invalida
      a correspondência, provando adulteração.
- [ ] Página de manifesto/autenticação anexada ao PDF final, reunindo todos os itens acima
      (metadados, timestamp, hash) de forma legível para quem for auditar o documento depois — não
      basta guardar isso só numa tabela do banco, tem que estar no próprio arquivo.

**Selo final do servidor**
- [ ] O documento final é selado com certificado digital da própria instituição (e-CNPJ em
      arquivo A1) pelo servidor, garantindo que o PDF não foi modificado depois de processado —
      camada adicional além do hash SHA-256, não substituta dele.

**Usado para**: termo de adesão de voluntário (FASE 1), ficha de filiação, lista de presença de
reunião/evento, termo de compromisso, autorização de uso de imagem, e demais controles
operacionais internos — a lista completa de "onde a solução própria funciona muito bem".

#### v20.2.1 — Limite explícito: quando a assinatura própria NÃO basta (ato registral)
- [ ] Ata de eleição de diretoria, reforma estatutária e venda de imóvel — qualquer documento que
      precisa ser **levado a registro** em Cartório de Registro Civil de Pessoas Jurídicas (RCPJ)
      ou Registro de Imóveis — exigem assinatura **qualificada** (certificado ICP-Brasil e-CPF),
      não a assinatura própria da v20.2. A maioria dos cartórios não aceita assinatura simples
      para esses atos.
- [ ] Fluxo real confirmado pelo usuário: esse tipo de documento **não nasce no sistema** (o
      sistema não tem editor de texto, de propósito — ver FASE 13) — é redigido fora, assinado com
      certificado qualificado próprio de quem assina (ex.: presidente assina como presidente, via
      assinador ICP-Brasil como o do ITI), enviado a quem precisar (cartório, órgão público), e só
      **depois**, se fizer sentido arquivar no sistema, o PDF já assinado é enviado como referência
      (mesmo padrão já estabelecido na FASE 13/v13.4 — o sistema guarda a referência, nunca
      substitui o ato externo).
- [ ] O sistema nunca tenta "imitar" assinatura qualificada para esses casos — a interface deixa
      claro, no próprio tipo de documento, qual caminho se aplica (assinatura própria vs. "assine
      fora e envie aqui depois").

#### v20.3 — Autenticação biométrica para chamada/frequência (avaliação cuidadosa, não implementação imediata)
- [ ] Viável tecnicamente via Azure AI Face (cadastro de foto de referência + comparação no
      check-in) — tier gratuito de 30.000 transações/mês, tier pago baixo custo acima disso.
      **Recurso "Limited Access"**: a Microsoft exige inscrição e aprovação prévia antes de
      liberar as funções de verificação/identificação facial, mesmo pagando — não é ativação
      imediata.
- [ ] **LGPD tratada como bloqueio real, não detalhe**: dado biométrico é dado sensível (Art. 5º,
      II) — consentimento **específico e destacado** obrigatório (Art. 11), nunca coberto pelo
      termo de uso geral; a base legal de "legítimo interesse" (mais simples, usada em dado comum)
      é **expressamente vedada** para dado sensível — sempre precisa de consentimento explícito
      separado.
- [ ] A ANPD está em processo normativo ativo sobre biometria (consulta pública em 2025, notas
      técnicas específicas sobre reconhecimento facial em eventos) — regulamentação mais específica
      esperada, ainda não fechada. **Decisão do plano**: reconhecimento facial para chamada entra
      como opção configurável e **nunca obrigatória** — sempre com alternativa de check-in não
      biométrico disponível (código/QR já previsto na FASE 4/13), tanto por exigência de bom senso
      de proteção de dados quanto por já ser a orientação que a própria ANPD está sinalizando.
- [ ] Não implementar no MVP — registrar como capacidade avaliada e pronta para ativar quando (e
      se) a associação decidir que o ganho operacional compensa o processo de aprovação da
      Microsoft e o desenho cuidadoso de consentimento específico.

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
- **Estatuto da ASAF** (FASE 2.3, processo disciplinar): segue como item a detalhar quando o
  texto normativo real da associação for compartilhado nesta conversa — até lá, o módulo de
  governança (FASE 2) permanece genérico o suficiente para não travar o restante do plano.

## 8. Novos pontos em aberto (surgidos da pesquisa de legislação)

- **A ASAF recebe ou pretende receber recurso público** (convênio/termo de parceria com
  prefeitura, estado ou União)? Define se o módulo de MROSC (v12.1) fica ativo desde já ou
  permanece desligado até ser necessário.
- **A ASAF tem ou terá empregados registrados em CLT**, além de voluntários? Define se o "modo
  empregado" da v1.4 precisa de módulo próprio ou só de uma integração com sistema de folha de
  pagamento externo especializado.
- **A ASAF atua em assistência social, saúde ou educação de forma formal?** Define se o CEBAS
  (v12.2) é relevante ou fica de fora do escopo por completo, e se o módulo de Educação (FASE 14)
  é necessário desde já.
- **O estatuto da ASAF permite voto por procuração em assembleia?** (v13.1) — muitos estatutos
  vedam isso de propósito; não assumir nenhuma das duas opções sem o texto real.
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
