# Decisões congeladas — o que não se discute mais

> Este arquivo existe para resolver um problema real que apareceu na conversa deste projeto:
> depois de trocar SQLite por Postgres, `servidor.py` por `app/`, e `preparar_banco()` por
> Alembic, ficou difícil distinguir "isso foi retrabalho por erro" de "isso é o processo normal
> de amadurecer uma fundação antes de construir em cima". **Não é a mesma coisa, e este documento
> existe para nunca mais deixar essa dúvida no ar.**
>
> Regra de uso deste arquivo: qualquer proposta futura (minha ou de outra pessoa) de trocar algo
> listado aqui como **congelado** precisa vir com um motivo concreto e grave — não "achei melhor"
> nem "ferramenta nova apareceu". Se aparecer essa proposta, a primeira pergunta é "isso está na
> lista de congelados? por quê?" — e a resposta correta, na maioria das vezes, é não mexer.
>
> Este arquivo não é o plano do projeto (isso é `PLANO_PROJETO.md`) nem o guia de arquitetura
> (isso é `ARQUITETURA.md`). É a lista curta e específica do que já foi decidido de forma
> definitiva, com o motivo, para nunca precisar reabrir a discussão.

## Como usar este arquivo

Cada decisão abaixo tem três partes: **o que foi decidido**, **por que está congelado** (o custo
real de mudar depois) e **o que ainda é livre dentro dessa decisão** (para deixar claro que
congelar a fundação não significa proibir evolução — significa não trocar a fundação).

Ao final há uma seção **"O que NÃO está congelado"** — igualmente importante, porque lista
explicitamente o que continua sendo opção em aberto, para não criar a impressão de que tudo virou
pedra.

---

## 1. Dados e persistência

### 1.1 Banco de dados relacional: PostgreSQL
- **Decidido**: Azure Database for PostgreSQL Flexible Server é o único banco de dados do
  sistema, compartilhado entre o FastAPI e o Directus.
- **Por que está congelado**: já é o segundo banco do projeto (veio de SQLite). Trocar de novo
  significaria reescrever toda a camada de acesso a dado, todas as migrações Alembic e todo o
  desenho de RLS previsto na FASE 15. Postgres escala de dezenas a centenas de milhares de
  registros sem mudança de arquitetura — não existe cenário de crescimento da ASAF nos próximos
  10-20 anos que justifique trocar.
- **Livre dentro disso**: subir de tier (Burstable → General Purpose), ajustar índices, adicionar
  réplica de leitura, usar extensões (`pgcrypto`, `pg_stat_statements`).

### 1.2 ORM e tipos numéricos
- **Decidido**: SQLAlchemy 2.x (estilo declarativo moderno) como único ORM. Todo valor monetário
  é `Numeric`/`Decimal`, nunca `float`.
- **Por que está congelado**: trocar de ORM depois de dezenas de modelos escritos é reescrita
  completa da camada de dados. `float` para dinheiro é um erro que só aparece tarde (arredondamento
  acumulado) e é doloroso de corrigir depois que já existe histórico financeiro real.
- **Livre dentro disso**: uso de SQL puro (`text()`) para consultas de relatório complexas onde o
  ORM atrapalha.

### 1.3 Migração de schema: Alembic
- **Decidido**: toda alteração de schema passa por `alembic revision --autogenerate` +
  `alembic upgrade head`. Nunca mais alteração manual de tabela em produção.
- **Por que está congelado**: é a correção que resolveu o mecanismo frágil anterior
  (`preparar_banco()`, que já causou um incidente de crash-loop em produção). Voltar atrás
  reintroduziria exatamente o problema que já foi corrigido.
- **Livre dentro disso**: nada — este é o único item desta lista sem ressalva. Todo o resto do
  plano (FASES 1 a 20) assume Alembic como dado.

### 1.4 Modelo de pessoa: `Pessoa` como raiz com papéis (v1.0)
- **Decidido**: uma pessoa física é um único registro `Pessoa` (CPF único), com papéis (associado,
  voluntário, beneficiário, aluno, participante externo, funcionário) vinculados por N:N, nunca
  cadastros separados por papel.
- **Por que está congelado**: é a decisão que evita duplicidade de cadastro para sempre — mudar
  isso depois de existirem dados reais é uma migração de dado arriscada e cara (a mesma classe de
  trabalho que já foi feita uma vez ao unificar `Associado` com `Usuario`).
- **Livre dentro disso**: quais papéis existem, quais atributos cada papel carrega.

### 1.5 Catálogo genérico e campos personalizados (v0.3)
- **Decidido**: valor que a diretoria pode querer mudar sem programador (categoria, motivo,
  tipo) vive em `Catalogo`/`OpcaoCatalogo` com código estável separado do rótulo — nunca
  `enum` fixo em código para esse tipo de dado.
- **Por que está congelado**: é o mecanismo que impede que "a associação quer uma categoria nova"
  vire chamado de suporte técnico pelos próximos 20 anos.
- **Livre dentro disso**: quais catálogos existem e o que cada um contém.

---

## 2. Backend e API

### 2.1 Framework: FastAPI + Pydantic v2
- **Decidido**: API única em FastAPI, servida por Uvicorn, validação por Pydantic v2.
- **Por que está congelado**: é a base de 37+ rotas já em produção. Confirmado por pesquisa de
  mercado como stack corrente para este tipo de sistema, com casos reportados de bom desempenho
  em volume alto. Trocar de framework é reescrever a API inteira.
- **Livre dentro disso**: versão específica de cada dependência (atualização contínua, já é
  prática estabelecida).

### 2.2 Organização do código: pacote `app/` por domínio
- **Decidido**: `app/models/`, `app/schemas/`, `app/routers/` organizados por domínio de negócio
  (core, associados, financeiro, governanca, projetos, admin_portal), cada módulo novo das FASES
  1-20 segue o mesmo padrão.
- **Por que está congelado**: é a correção que já saiu do monólito de 3400 linhas. Voltar a
  concentrar tudo em um arquivo só reintroduz o problema resolvido.
- **Livre dentro disso**: como cada domínio se subdivide internamente conforme cresce (ex.: separar
  `financeiro/lancamentos.py` de `financeiro/cobranca.py` quando o arquivo crescer demais).

### 2.3 Versão do Python e imagem base
- **Decidido**: `python:3.12-slim` como imagem base do contêiner (fixada no `Dockerfile`).
- **Por que está congelado**: a versão exata do Python é o que garante que "funciona na minha
  máquina" e "funciona em produção" sejam a mesma coisa. Trocar a versão maior do Python é decisão
  deliberada de upgrade, não acidente de ambiente.
- **Livre dentro disso**: atualização de versão de patch (3.12.x) a qualquer momento; upgrade de
  versão maior (3.12 → 3.13+) como manutenção planejada e testada, não como mudança de fundação.

---

## 3. Autenticação e permissão (v0.1)

### 3.1 Mecanismo de autenticação: JWT + refresh opaco + bcrypt + TOTP
- **Decidido**: login por CPF+senha (bcrypt), access token JWT (HS256, curto), refresh token
  opaco guardado em `TokenAcesso`, MFA por TOTP (`pyotp`) com códigos de recuperação.
- **Por que está congelado**: é o módulo mais testado do sistema até agora (bloqueio por força
  bruta, revogação de sessão, MFA ponta a ponta, tudo validado contra produção). Trocar o
  mecanismo de autenticação depois que já existem sessões e usuários reais é a categoria de
  mudança mais arriscada que existe em um sistema em produção.
- **Livre dentro disso**: adotar Keycloak como IdP central **se e somente se** surgir a condição
  registrada na v20.1 (três ou mais sistemas compartilhando login) — nesse caso, a migração de
  senha (hash bcrypt é importável) já está prevista, e o Postgres da ASAF continua dono do dado de
  pessoa; o IdP só cuida de autenticação. Adicionar login federado (Entra ID, v20.4) como via
  alternativa, nunca substituindo o login por CPF.

### 3.2 Modelo de permissão: RBAC por nível (`NivelAcesso`/`PermissaoSistema`)
- **Decidido**: permissão é atribuída a um nível de acesso (catálogo configurável), nunca
  verificada por `if (nivel == "Presidente")` espalhado pelo código — sempre via
  `exigir_permissao(codigo)`.
- **Por que está congelado**: é o que permite o menu do painel (v0.2.3) e toda autorização futura
  ser genérica. Reintroduzir checagem de nível hardcoded quebra esse contrato em qualquer lugar
  que apareça.
- **Livre dentro disso**: quais níveis existem e quais permissões cada um tem (já é catálogo
  editável, v0.1.5); adicionar permissão contextual por RLS (v15.1) como camada extra, não
  substituta.

---

## 4. Frontend

### 4.1 Framework do painel: React (Vite + TypeScript strict)
- **Decidido**: SPA em React, Vite, TypeScript em modo `strict`, Tailwind + shadcn/ui + TanStack
  Query + React Router.
- **Por que está congelado**: é a decisão de fundação da v0.2, que vira base de todos os módulos
  de negócio das FASES 1-20 (menu dinâmico por permissão, componentes reaproveitáveis, cliente
  HTTP único). Trocar de framework de front depois de módulos construídos é reescrever a
  experiência inteira do usuário administrativo.
- **Livre dentro disso**: quais bibliotecas de componente/gráfico específicas se usa por cima
  dessa base (hoje: shadcn/ui, Recharts); trocar uma peça pontual é aceitável, trocar o framework
  inteiro não.

### 4.2 Autenticação no cliente: token em memória + refresh em cookie `HttpOnly`
- **Decidido** (v0.2.1): access token nunca em `localStorage`; refresh token em cookie
  `HttpOnly`+`Secure`+`SameSite=Strict`.
- **Por que está congelado**: é controle de segurança contra XSS que precisa ser certo desde o
  primeiro módulo — mudar depois significa auditar todo código de front escrito entre a decisão
  errada e a correção.
- **Livre dentro disso**: detalhe de implementação do interceptor de renovação.

### 4.3 Perpetuidade do painel: zero dependência paga ou SaaS por usuário
- **Decidido** (v0.2.0): nenhum componente de UI vem de biblioteca paga nem de SaaS com
  licença por usuário. Tudo que entra no painel precisa continuar funcionando se a associação
  parar de pagar qualquer coisa — o custo do painel é só o Static Web App (dentro do crédito
  nonprofit).
- **Por que está congelado**: o painel é a casca que os módulos das FASES 1–20 vão habitar por
  10–20 anos. Uma dependência de UI paga (grid, chart, editor) com licença por usuário vira
  custo recorrente e risco de lock-in no meio do caminho — trocar depois é refazer componente já
  espalhado.
- **Livre dentro disso**: a lista concreta de bibliotecas open-source (hoje: React, Vite,
  TypeScript, Tailwind, shadcn/ui, Recharts, TanStack Query, React Router, Lucide). Adicionar uma
  biblioteca nova é aceitável desde que gratuita, open-source e sem contador por usuário.

---

## 5. Infraestrutura e deploy

### 5.1 Provedor de nuvem: Azure
- **Decidido**: toda a infraestrutura roda em Azure (Container Apps, Static Web Apps, PostgreSQL
  Flexible Server, Blob Storage, Key Vault, Application Insights, DNS).
- **Por que está congelado**: crédito de nonprofit já concedido e em uso (~US$2.000/ano), toda a
  automação de CI/CD e DNS já aponta para cá. Trocar de provedor de nuvem é o tipo de migração
  mais cara que existe — mas note a mitigação abaixo.
- **Livre dentro disso / mitigação de risco**: a escolha técnica por Postgres padrão + contêiner
  Docker padrão (em vez de serviços proprietários específicos da Azure) é deliberada — significa
  que, **se um dia for necessário**, migrar de nuvem é trabalho de reconfiguração de
  infraestrutura, não de reescrita de aplicação. Isso é tratado como plano de contingência, nunca
  como plano de ação.

### 5.2 Hospedagem de contêiner: Azure Container Apps (plano consumo)
- **Decidido**: API e Directus rodam em Container Apps, escala a zero quando ociosos.
- **Por que está congelado**: já resolveu o problema real de "sem equipe de TI dedicada cuidando
  de servidor" — é a peça que permite a ASAF não ter alguém de plantão para infraestrutura.
- **Livre dentro disso**: número de réplicas mínimas/máximas, quando ativar VNET+NAT Gateway (só
  se um dia for necessário IP de saída fixo — não é o caso hoje, ver a nota sobre firewall do
  Postgres abaixo).

### 5.3 Firewall do Postgres: `AllowAzureServices` + IP administrativo
- **Decidido**: a regra de firewall do Postgres é `AllowAzureServices` (permite tráfego de
  qualquer serviço Azure) mais o IP da máquina administrativa — **não** uma lista restrita de IPs
  de Container Apps.
- **Por que está congelado**: já foi tentado restringir e quebrou a produção em 2026-09-11 — o
  `staticIp` do ambiente Container Apps é só de **entrada**, não de saída, e o plano Consumo não
  tem IP de saída fixo sem VNET+NAT Gateway (fora do orçamento). Este é o item mais explícito da
  lista: **não tentar restringir de novo** sem antes provisionar VNET+NAT Gateway como projeto
  separado, com orçamento próprio.
- **Livre dentro disso**: nada, até que a decisão de adotar VNET+NAT Gateway seja tomada
  deliberadamente (o que hoje não está planejado em nenhuma fase).

### 5.4 CMS de conteúdo público: Directus, banco compartilhado
- **Decidido**: Directus roda no mesmo Postgres do FastAPI, mas só possui e só pode alterar
  tabelas `directus_*` (garantido pelo filtro `include_object` no Alembic).
- **Por que está congelado**: é a decisão que evita "dois sistemas que nunca se integram" — o
  problema identificado nas referências de pesquisa do início do projeto. Separar o banco do
  Directus depois quebraria a leitura de conteúdo editorial vinculado por `evento_id`/`projeto_id`
  (FASE 4/5).
- **Livre dentro disso**: quais coleções o Directus gerencia (sempre só conteúdo público).

### 5.5 CI/CD: GitHub Actions + OIDC, sem segredo de longa duração
- **Decidido**: deploy automatizado via GitHub Actions, autenticação no Azure por OIDC (Service
  Principal com credencial federada), nunca senha/chave de longa duração salva como GitHub
  Secret.
- **Por que está congelado**: é prática de segurança de referência (nenhuma credencial para
  vazar, mesmo que o repositório seja público) e já está funcionando ponta a ponta.
- **Livre dentro disso**: quantos workflows existem (hoje só a API; painel e site ainda vão
  ganhar o próprio, v8.2), o que cada um builda e publica.

### 5.6 Infraestrutura versionada como script, não Bicep/Terraform
- **Decidido**: a reconstrução da infraestrutura é documentada em `infra/provisionar.sh` — um
  script comentado, não uma ferramenta declarativa de IaC. **Não versionado neste repositório
  público** (mesmo tratamento de `CREDENCIAIS_AZURE.md`): mesmo sem senha nenhuma, o nome exato de
  cada recurso é um mapa de alvo desnecessário de deixar público. Fica só localmente, com quem
  administra a infraestrutura. A versão pública, `infra/provisionar.exemplo.sh`, tem o mesmo
  conteúdo com os nomes de recurso trocados por placeholder — documenta o padrão sem expor o mapa
  real.
- **Por que esta é uma decisão consciente, não uma pendência**: Bicep/Terraform dariam
  idempotência e um "plano antes de aplicar", mas custam uma ferramenta nova para alguém aprender
  e manter, para um número de recursos que hoje cabe inteiro num único script legível. Para o
  porte da ASAF, isso seria complexidade sem retorno proporcional — o script resolve o problema
  real ("dá para reconstruir sem depender de memória") sem esse custo.
- **Quando reabrir esta decisão**: se o número de recursos crescer muito (ex.: infraestrutura
  multi-região, múltiplos ambientes de homologação automatizados) ou se a equipe técnica que
  mantém o projeto crescer a ponto de precisar de revisão de infraestrutura em pull request antes
  de aplicar. Nenhum dos dois é o cenário de hoje.

### 5.7 Repositório público, licença restritiva
- **Decidido**: o repositório `Arca-da-Familia/asaf` é público (necessário para uso gratuito de
  integrações Azure/GitHub Actions), protegido por uma licença de todos os direitos reservados —
  uso restrito a entidades sem fins lucrativos com autorização expressa da associação.
- **Por que está congelado**: mudar a visibilidade do repositório ou a licença depois que
  colaboradores externos e integrações já dependem do estado atual exige reavaliar todo o acesso
  de novo.
- **Livre dentro disso**: quem tem acesso de escrita ao repositório.

### 5.8 Teto de orçamento: US$100/mês
- **Decidido**: teto operacional de US$100/mês (dentro do crédito nonprofit de ~US$2.000/ano),
  aprovado explicitamente pelo usuário mesmo em cenário de milhares de associados.
- **Por que está congelado**: é o número contra o qual toda escolha de tier/SKU nas FASES 8 e 16
  foi calibrada.
- **Livre dentro disso**: revisão trimestral de custo real (v8.4) pode propor ajuste do teto para
  cima se o crescimento da associação justificar — isso é evolução prevista, não quebra da
  decisão.

---

## 6. Segurança e conformidade (posições já resolvidas por pesquisa)

### 6.1 gov.br descartado como provedor de login/assinatura
- **Decidido**: gov.br não é usado nem para login único nem para assinatura eletrônica.
- **Por que está congelado**: confirmado por fonte oficial (a API de assinatura é restrita por
  norma a órgão público) e por tentativa real do usuário (login único para app privado exige
  contrato comercial via Loja do Serpro/Dataprev, com aprovação discricionária). Não é questão de
  tentar de novo com configuração diferente — é inviável por desenho para uma associação privada.
- **Livre dentro disso**: nenhuma — mudança aqui só faria sentido se a própria política pública do
  gov.br mudasse (fora do controle do projeto).

### 6.2 Assinatura eletrônica própria (v20.2) para documento interno; ICP-Brasil só para ato registral
- **Decidido**: documento interno (termo de voluntariado, ficha, presença) usa a plataforma
  própria de assinatura (OTP + metadados + timestamp + hash SHA-256 + selo e-CNPJ). Documento que
  precisa ir a registro em cartório (ata de eleição, reforma estatutária) exige assinatura
  qualificada ICP-Brasil, sempre externa ao sistema.
- **Por que está congelado**: é a linha divisória definida com o usuário depois de pesquisa
  específica — misturar as duas coisas (tentar "imitar" assinatura qualificada, ou exigir
  ICP-Brasil para tudo) foi descartado nos dois sentidos.
- **Livre dentro disso**: quais tipos de documento entram em cada categoria, conforme a lista
  crescer.

### 6.3 Estratégia de app: PWA, não nativo
- **Decidido**: o painel evolui para PWA instalável (v9.4); aplicativo nativo só entra em
  discussão se biometria virar exigência não-negociável.
- **Por que está congelado**: evita o custo recorrente de manter dois builds nativos (revisão de
  loja, atualização obrigatória por SO) sem ganho real hoje — PWA já cobre push, instalação e
  carteirinha tipo wallet.
- **Livre dentro disso**: reabrir a decisão é explicitamente previsto (v19.2) se os critérios
  objetivos ali listados se confirmarem.

---

## 7. O que NÃO está congelado (deliberadamente em aberto)

Para não passar a impressão de que tudo virou pedra — isto aqui continua sendo decisão a tomar
quando a necessidade real aparecer, nunca antes:

- **Keycloak/SSO central** (v20.1) — só entra com 3+ sistemas compartilhando login.
- **Row-level security** (v15.1) — adoção incremental, tabela por tabela, conforme o dado
  sensível que ela protege for construído.
- **Reconhecimento biométrico** (v20.3) — avaliado, não implementado; depende de aprovação da
  Microsoft e desenho de consentimento específico.
- **Bicep/Terraform** (ver 5.6) — reavaliar só se a infraestrutura crescer muito.
- **Open Finance/conciliação bancária automática** (v11.6) — depende de escolha de agregador
  quando a demanda for real.
- **Multi-unidade/multi-sede** (FASE 10) — modelo de dado só decidido quando a ASAF de fato tiver
  mais de um endereço.
- **App nativo** (v19.2) — critério objetivo de reabertura já escrito, não é "nunca", é "não
  agora".
- **Provedor de agregador WhatsApp Business (BSP)** — qual parceiro específico usar (v11.3) é
  escolha comercial a fazer no momento da implementação, não hoje.
- **Qual PSP para Pix Automático** (v3.2.1) — escolha de banco/fintech parceiro no momento da
  implementação daquela versão.
- **Provedor de envio de e-mail** (recuperação de senha "esqueci minha senha", achado
  2026-09-15) — hoje não existe nenhum serviço de e-mail transacional integrado; escolher
  provedor (ex.: Azure Communication Services, SendGrid) quando esse fluxo for implementado.

---

## 8. Ferramentas e integrações já fixadas para o resto do projeto

Lista de referência rápida — o que evitar reabrir como "qual ferramenta usar" quando a fase
correspondente chegar, porque já foi decidido:

| Necessidade | Ferramenta fixada | Fase que usa |
|---|---|---|
| Migração de schema | Alembic | Todas |
| Testes de backend | pytest + httpx | v18.1 |
| Testes de frontend | Vitest + Testing Library + Playwright | v0.2.8 |
| Lint/formatação Python | ruff | v18.3 |
| Lint/formatação TypeScript | ESLint + Prettier | v0.2.0 |
| Observabilidade | Azure Application Insights | v18.2 |
| BI/painel executivo | Metabase (self-hosted) | v11.8 |
| WhatsApp institucional | Meta Cloud API (ou BSP oficial) | v11.3 |
| Cobrança recorrente | PIX estático → Pix Automático | v3.2/v3.2.1 |
| Verificação de CNPJ | API "Minha Receita" + fallback Receita Federal | v3.3 |
| Reconhecimento de rosto (se ativado) | Azure AI Face | v20.3 |
| Varredura de dependência vulnerável | `pip-audit` / Dependabot | v15.5 |
| Vault de segredos | Azure Key Vault | Todas |

Se, ao longo da implementação de qualquer fase, ficar claro que falta uma ferramenta/conector
aqui, o lugar certo para registrar a decisão (fixando-a) é esta tabela — não uma escolha implícita
enterrada dentro do código de uma fase específica.
