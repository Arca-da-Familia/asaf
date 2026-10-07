# Plano do Projeto — Site Institucional + Sistema de Gestão ASAF (Sistema Integrado Único)

> **Histórico separado (2026-09-30)**: o registro completo (checklist original + confirmação em produção) de cada fase/versão já concluída mora em [`HISTORICO.md`](HISTORICO.md) — este arquivo ficou muito grande (passou de 6.600 linhas) misturando o que falta fazer com o que já foi feito há meses. Este arquivo agora é só o roteiro do que falta construir, com um pequeno resumo marcado ✅ onde uma fase (ou parte dela) já foi entregue.
>
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
> v0.3.1–v0.3.5, v1.0–v1.8, v2.0–v2.9, v3.0–v3.7, v4.0–v4.10, v5.0–v5.7, v6.1–v6.3, v7.0–v7.5,
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

✅ **Concluída.** Todo o conteúdo desta fase (checklist original e confirmação em produção de cada versão) foi movido para [`HISTORICO.md`](HISTORICO.md#fase-0) para manter este arquivo focado no que falta construir.

### FASE 1 — Associados (ciclo de vida completo da pessoa na associação)

✅ **Concluída.** Todo o conteúdo desta fase (checklist original e confirmação em produção de cada versão) foi movido para [`HISTORICO.md`](HISTORICO.md#fase-1) para manter este arquivo focado no que falta construir.

### FASE 2 — Governança (assembleias, diretoria, conselho fiscal)

✅ **Concluída.** Todo o conteúdo desta fase (checklist original e confirmação em produção de cada versão) foi movido para [`HISTORICO.md`](HISTORICO.md#fase-2) para manter este arquivo focado no que falta construir.

### FASE 2.5 — Painel (telas reais para Associados, Governança e Financeiro)

✅ **Concluída.** Todo o conteúdo desta fase (checklist original e confirmação em produção de cada versão) foi movido para [`HISTORICO.md`](HISTORICO.md#fase-25) para manter este arquivo focado no que falta construir.

### FASE 3 — Financeiro

✅ **Concluída.** Todo o conteúdo desta fase (checklist original e confirmação em produção de cada versão) foi movido para [`HISTORICO.md`](HISTORICO.md#fase-3) para manter este arquivo focado no que falta construir.

### FASE 4 — Projetos, Reserva de Espaço e Eventos (módulo de integração site ↔ sistema)

✅ **Concluída.** Todo o conteúdo desta fase (checklist original, confirmação em produção de cada versão v4.0–v4.10 e o Ponto de Revisão de fechamento) foi movido para [`HISTORICO.md`](HISTORICO.md#fase-4-v40-v49) para manter este arquivo focado no que falta construir.

### FASE 5 — Site institucional (conteúdo público)

> O site não é folheto: é a porta de entrada de associado, voluntário, doador e beneficiário — e é
> a face pública da transparência. Tudo que é **dado** vem do FastAPI; só o que é **editorial** vem
> do Directus. Essa fronteira é o que impede o site de virar um segundo sistema.

#### v5.0 — Fundação técnica do site

- [x] Astro com geração estática + ilhas interativas, publicado no Static Web App `asaf-site` (já
      provisionado), domínio `asaf.org.br` (já configurado na v0.0).
- [x] Rebuild sob demanda: o workflow `deploy-site.yml` aceita disparo (`workflow_dispatch`) com
      token de mínimo privilégio; dado dinâmico do FastAPI (eventos, transparência) é buscado no
      cliente (ilha), para não exigir rebuild a cada inscrição.
- [ ] **Flow do Directus que chama esse disparo** quando o conteúdo muda — **movido para a
      v5.1**: um Flow precisa de coleção para escutar, e as coleções só nascem na v5.3 (era v5.1). O
      receptor (workflow) já está pronto e testado; o procedimento exato está em
      [`site/README.md`](site/README.md#rebuild-quando-o-conteúdo-do-directus-muda).
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
> - [ ] **Chave de automação do Directus no Key Vault — BLOQUEADA pelo sistema de segurança do
>       Claude Code** (regra "escrita em cofre de segredos", 2026-10-01): a tentativa de gerar um
>       token estático para a conta real e gravá-lo em `DIRECTUS-ADMIN-TOKEN` foi negada, e não
>       foi contornada. Nada depende disso até as coleções (v5.1); opções: o usuário libera a
>       regra, ou grava o segredo pelo Portal do Azure (Cofre → Segredos → Gerar/Importar).
> - [x] **Atalho no painel**: cartão "Editar o site" na tela inicial, visível a quem tem
>       `gerenciar_acesso` (presidência), abre o Directus em nova aba. É conveniência; quem
>       protege é o login do Directus. Papel de editor próprio (`editar_site`) nasce com os
>       papéis do Directus, abaixo.
> - [ ] **Chave do plano gratuito (Open Innovation Grant) — o usuário JÁ TEM a chave, mas não há
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
> - [ ] **Usuário de serviço + token estático somente-leitura** para o build do site, guardado
>       no Key Vault (`DIRECTUS-SITE-TOKEN`) — só depois das coleções de conteúdo e do papel
>       restrito. Com ele, o administrador pode ter MFA obrigatório (`enforce_tfa`) sem quebrar
>       automação.
> - [ ] Nota de saúde: `GET /server/health` do Directus devolve `warn` por tempo de resposta do
>       Postgres (518 ms contra limite de 150 ms) — latência do banco Burstable; acompanhar.

- [ ] Coleções: páginas institucionais, notícias, banners, galeria, depoimentos, parceiros,
      perguntas frequentes — **só conteúdo público**, nunca dado de associado/financeiro.
- [ ] Fluxo editorial com rascunho → revisão → publicado, agendamento de publicação e histórico de
      versão com possibilidade de reverter.
- [ ] Papéis do Directus mapeados à realidade (editor de conteúdo x administrador), sem dar
      administrador para quem só escreve notícia.
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
- [ ] **Verificação em produção**: `isolar_directus.py verificar` (16/16) + nenhuma coleção fora do
      schema `directus` + `GET /items/…` sem token = 403 + rascunho ausente do site + token de serviço
      não consegue escrever.

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
- [ ] **Despertai e o contexto do evento:** página do projeto no `hml-site` (fotos, edições, relatórios aprovados, notícias vinculadas),
      destaque na Home, página do evento com o projeto de origem, foto de evento, **relatório de evento aprovado** na Transparência;
      dado pessoal digitado no texto público é **barrado**. *(Falta conferir ao vivo no `hml-site`: entra junto com a v5.4g, que olha o site.)*
- [x] Lista de **achados** corrigidos e refeitos; prints do painel e do site.
      **Achados corrigidos (todos provados na homologação antes da produção):** vaga gasta por inscrição recusada; cancelar pelo painel não
      liberava a vaga; configurações do evento aceitavam 150% e prazo negativo; sessão de evento com hora com fuso derrubava o servidor (refeita
      e provada); troca de turno com a própria pessoa; cobrança não paga ficava "Pendente" depois de cancelar a reserva; relatório final dizia que
      o motor de beneficiários "não existe"; datas só-dia apareciam um dia antes; horas de voluntariado sem rastro na Auditoria; erros de ação
      sem aviso na tela (espaços e voluntariado). **Em produção (só leitura):** commit `1a537d2`.
      **Pendências que nasceram aqui:** telas que faltam (inscrição no evento pelo painel, núcleo familiar do beneficiário, alocar voluntário);
      fluxo de **filiação com aprovações** e as notificações aos sócios ativos.

#### v5.4g — FASE 5 ao vivo (v5.0 a v5.4b): site e Transparência

- [ ] **Todas as páginas do `hml-site`** abertas e conferidas (links, imagens, acessibilidade, `noindex`, faixa de teste): início, a associação,
      diretoria (Art. 19), projetos, eventos, notícias (a de teste não tem — o editor é um só), contato, privacidade, termos, transparência.
- [ ] **Documentos:** Secretário prepara (original PDF + versão pública em texto), Presidente **aprova** (quem enviou **não** aprova o próprio);
      o **original nunca** sai pela API pública nem por `/uploads`; PDF só-imagem recusado; documento **Interno/Restrito** não aparece;
      retirar uma publicação e ver sair do site.
- [ ] **Parcerias e emendas:** cadastrar, parcelas, etapas **com foto**, movimentos classificados, relatório, publicação aprovada por segunda
      pessoa; o **valor mostrado no site bate** com o livro-caixa do centro de custo; edição depois de aprovada vai direto (decisão de 2026-10-04).
- [ ] **Vigilantes e avisos** (monitor do site, alerta de 2 h, trava de tamanho) conferidos **sem** apontá-los para a homologação (custo).
- [ ] **Checklist do Ponto de Revisão FASE 5 (1/2) executado inteiro na homologação**, item a item, com o resultado registrado ali.

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


##### 🔍 Ponto de Revisão — FASE 5 (1/2 — meio, fecha v5.0–v5.4)

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

- [ ] **Pré-requisito**: encarregado pelo tratamento de dados designado (LGPD, art. 41) e Política de
      Privacidade revisada juridicamente — o texto só pode prometer base legal por formulário quando o
      sistema registrar isso (FASE 7).
- [ ] Formulário público de voluntariado, de proposta de filiação (v1.2), de contato, de solicitação de
      titular LGPD (FASE 7) **e de pedido de informação sobre recursos públicos (R7)** — todos com a
      mesma deduplicação por CPF/e-mail, todos caindo em **uma fila única de atendimento** no painel,
      com status, responsável e **prazo**. Formulário que vira e-mail solto é o jeito conhecido de perder
      gente interessada.
- [ ] Confirmação automática ao remetente e prazo de resposta acompanhado (liga com o protocolo interno
      da v13.3).
- [ ] **Voluntário que não é associado** (decisão do usuário, 2026-10-03: "se ele se voluntaria, ele
      precisa conseguir"): hoje a alocação em projeto **exige cadastro de Associado**
      (`AlocacaoVoluntario.id_associado`); passa a apontar para `Pessoa`, com migração e testes, e a
      página `/seja-voluntario/` é atualizada (até lá ela diz o que acontece hoje).
- [ ] **Inscrição em evento pelo site** (a API já tem formulário, perguntas, consentimento e lista de
      espera) e **status do evento** — Programado / **Cancelado** / Adiado / Realizado, com motivo —
      no sistema, no painel e no site (`schema.org eventStatus`), no lugar do paliativo "voltar a
      Interna". "Módulo de eventos" do usuário: este é o ponto de entrada dele.

#### v5.6 — Doação online (era a v5.4)

- [ ] PIX com QR code dinâmico por doação (identificação automática do pagamento), doação
      recorrente via Pix Automático (v3.2.1) quando disponível, e opção de doação anônima.
- [ ] Recibo automático por e-mail e, para doador identificado, área de acompanhamento das próprias
      doações.
- [ ] Transparência do destino: cada campanha mostra quanto arrecadou e em que foi aplicado,
      puxando do centro de custo real (FASE 3) — não texto escrito à mão. **Liga com a v5.4**: a
      campanha aparece na Transparência.

#### v5.7 — Confiança, privacidade e conformidade do site (era a v5.5)

- [ ] Banner de cookies honesto: se o site não usa rastreamento de terceiro, não fingir que usa —
      preferência por métrica sem cookie (Application Insights ou analytics respeitoso), evitando
      consentimento desnecessário. (Hoje o site **não** instala cookie; a Política de Privacidade já diz
      isso.)
- [ ] Headers de segurança (CSP, `X-Content-Type-Options`, `X-Frame-Options`, HSTS) configurados no
      Static Web App — a CSP precisa conhecer o Directus (imagens/arquivos), as ilhas e o Google Maps.
- [ ] Página "Transparência" e página "Privacidade" sempre acessíveis a partir do rodapé de
      qualquer página (**já feito na v5.2**).
- [ ] **Declaração de acessibilidade** do site e `security.txt`; mapa com pino **só** com coordenadas
      exatas informadas pela diretoria (decisão de 2026-10-03: fica para o futuro).

##### 🔍 Ponto de Revisão — FASE 5 (2/2 — fim, fecha v5.5–v5.7)

Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:

- Todos os formulários públicos (v5.5) caem na mesma fila única de atendimento — testar que nenhum vira e-mail solto por fora do sistema.
- Headers de segurança (v5.7) presentes de fato na resposta HTTP do site em produção.
- Voluntário não associado consegue ser escalado; evento cancelado aparece como **cancelado** (não some).
- Verificação independente de fatos das páginas novas e alteradas.

##### Decisões pendentes → onde cada uma será tratada (resposta do usuário em 2026-10-03)

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

#### v5.4h — Lacunas achadas ao vivo (telas e módulos que faltam; decisões do Presidente em 2026-10-07)

Tudo aqui é construído (não é "decidir se faz"), na ordem abaixo, cada item pelo caminho de sempre: branch → homologação → robô → só então a
`main`. As decisões do Presidente (voz, 2026-10-07; Estatuto em `ESTATUTO_ASAF.txt`) estão resumidas em cada item.

- [ ] **Títulos com filtros e paginação.** Título = cada **entrada** (a receber) ou **saída** (a pagar). A tela passa a filtrar por **mês**
      (filtro principal), intervalo de datas, **entradas ou saídas** (uma página para cada), situação, categoria e texto; lista paginada.
      Depois, o mesmo nas outras listas que crescem (Associados, Razão Contábil, Auditoria).
- [ ] **Módulo "Instituição" no painel:** cadastro de tudo da instituição (nome, CNPJ, endereço, contatos, redes, logo, chave Pix, textos
      institucionais), cada campo marcado **"vai para o site"** ou **"só interno"**; o site passa a ler de lá.
- [ ] **Auditoria financeira (Conselho Fiscal):** o Conselho **não opera** o Financeiro, **audita**. Página própria: escolhe o **mês**, vê todas
      as entradas e saídas já consolidadas, abre cada título (comprovantes e informações) e **aprova, reprova ou manda ressalva**; a ressalva
      volta ao Tesoureiro, que corrige e submete de novo; dá para aprovar **tudo de uma vez, um por um ou por categoria**; **título aprovado pelo
      Conselho não pode mais ser alterado**. Tudo na Auditoria. (Estatuto Art. 24: fiscalizar toda a movimentação financeira e contábil.)
- [ ] **Saídas, reembolso e dupla assinatura:** a saída é lançada com a **nota fiscal anexa** e uma **categoria** (o **reembolso é uma categoria
      de saída**, com as mesmas regras; entradas também têm categorias). **Dupla assinatura Presidente + 1º Tesoureiro** (Estatuto Art. 21, II).
      **Sem exigência de cotação/orçamento no dia a dia** (a regra de 2 cotações sai); orçamento só em **emenda parlamentar**, como documento
      anexado na parceria. **Prazos e alertas:** data da despesa e data do lançamento sempre registradas; alerta de lançamento tardio e de
      assinatura parada (lembrete ao outro assinante; delegação já existe), para a associação não perder prazo nem ter multa.
- [ ] **Filiação de ponta a ponta (Estatuto Art. 12):** formulário público; o pedido precisa ser **proposto por 3 sócios** (qualquer sócio ativo
      e apto pode propor) e passar pela **análise da Diretoria Executiva**; os sócios ativos **recebem a notificação no painel** para propor ou
      recusar; sem prazo — sem resposta, o pedido fica pendente; aprovado, entra no livro de associados com a matrícula.
- [ ] **Telas que faltam:** inscrição no evento pelo painel (secretaria inscrevendo alguém); **núcleo familiar** do beneficiário;
      **alocar voluntário** direto num turno.
- [ ] **Rastro de recusas:** recusa de aprovação/assinatura também fica na Auditoria.
- [ ] **Site e carga (decisão: manter páginas estáticas e deixar "vivo" o que é dinâmico):** inscrição em evento, voluntário e filiação passam
      pela API, que não pode travar nem estourar o limite de vagas. **Meta:** ~150 pessoas por minuto (50 a 100 preenchendo ao mesmo tempo) sem
      travar; teste de carga na homologação; réplicas da API sobem em dia de evento (sem servidor ligado 24 h); limite de inscrições por IP revisto
      (hoje 5 a cada 10 minutos, o que barra muita gente atrás do mesmo provedor).

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
>
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
      Application Insights para monitoramento. *(Correção de 2026-10-02: a conta de Blob existia,
      mas a API **não a usava** — gravava em disco efêmero. Ver o "ACHADO GRAVE" da v5.1; a API passa
      a usar uma conta privada própria, `stasafprivado`.)*
- [x] Total estimado ~US$40–60/mês, dentro do teto de US$100/mês definido em 3.6, com alerta de
      orçamento configurado.

#### v8.2 — CI/CD ✅ parcialmente concluído

- [x] Workflow da API com OIDC (sem segredo de longa duração no GitHub), build via ACR Tasks e
      atualização do Container App.
- [x] Workflows equivalentes para o painel (v0.2.0) e para o site (v5.0).
      > `deploy-painel.yml` (desde a v0.2.0) e `deploy-site.yml` (v5.0, 2026-10-01) existem e rodam
      > verdes em produção; ambos com portões de qualidade antes do deploy, e o do site confere
      > sozinho que `asaf.org.br/version.json` mostra o commit publicado.
- [ ] Migração Alembic executada como **passo explícito do pipeline**, antes do deploy da nova
      imagem, com falha de migração abortando o deploy — hoje a migração é aplicada manualmente.
- [ ] Deploy com revisão progressiva do Container App (nova revisão recebendo tráfego aos poucos)
      e **rollback em um comando** documentado e testado ao menos uma vez.
- [x] Ambiente de homologação: por custo, um **slot lógico** (banco separado barato + revisão
      própria do Container App), não um ambiente inteiro duplicado — decisão consciente de
      orçamento, registrada. **Feito em 2026-10-05** (`HOMOLOGACAO.md`): banco `asaf_hml` no servidor existente (papel próprio, 5
      conexões), API `hml-api` (Container App que escala a zero, 1 réplica no máximo), painel `hml-painel` e site `hml-site` (Static
      Web Apps Free), armazenamento LRS próprio, segredos `HML-*` no cofre, faixa "AMBIENTE DE TESTE" + `noindex`, MFA **ligado**.
      Motivo (decisão do presidente): a auditoria da produção não apaga (o próprio banco recusa), então **nenhum dado de teste entra na
      produção**; o teste real é feito aqui e o banco de teste pode ser apagado por inteiro (`resetar_banco`). Publica-se só à mão
      (`deploy-homologacao.yml`). Custo estimado US$ 1 a 5 por mês, dentro do crédito de organização sem fins lucrativos da
      assinatura (US$ 2.000, válido de 05/02/2026 a 05/02/2027; renovação NÃO confirmada). Orçamento mensal criado na assinatura.
      Provas: 3 execuções do fluxo (as duas primeiras falharam por motivos reais e foram corrigidas: a identidade do GitHub não pode
      escrever no cofre — mantido só leitura — e o roteiro não achava o pacote `app`), terceira verde nas 4 partes; a API de teste
      serve 10 cargos, 1 projeto em destaque com 2 edições e 3 fotos, 2 documentos aprovados e 1 emenda; o site de teste mostra a
      faixa, o destaque na Home, a página do projeto e `robots.txt` bloqueando tudo; o site e o painel de produção continuam sem a faixa
      (`test:vazio` prova). **Falta:** conferir as telas de gestão da homologação ao vivo, que agora é o trabalho das versões
      **v5.4c a v5.4g** (uma por fase, antes do Ponto de Revisão FASE 5 (1/2)); a pendência de como o robô entra está na v5.4c.

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
>
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
- [ ] Recebimento de resposta roteado para a fila única de atendimento (v5.5) — comunicação
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

> **Núcleo antecipado na v5.4a (2026-10-03):** parceria/emenda, parcelas, etapas, relatórios e centro de custo exclusivo,
> necessários para a transparência de emenda. O resto desta versão (plano de trabalho com indicadores, chamamento
> acompanhado, glosas, dossiê) continua aqui.

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

> **Núcleo antecipado na v5.4a/b (2026-10-03):** documentos com versão pública, aprovação de publicação e páginas de
> Transparência geradas do sistema. Aqui ficam os blocos restantes (prestação de contas anual, relatório de atividades).

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
- [x] **Política de atualização — SUBSTITUÍDA em 2026-10-01 pela regra permanente do usuário
      ("tudo na última versão", ver `CLAUDE.md`)**: nada de revisão trimestral; atualiza-se
      **sempre**, no fluxo normal (suíte completa 2x → push → CI → produção), preferindo
      pré-lançamento quando for mais novo que a estável. É o oposto do "não mexe que está
      funcionando" que transforma manutenção em reescrita depois de 5 anos.
- [ ] **Atualização contínua — inventário de 2026-10-01 e lotes** (cada lote é testado e
      publicado sozinho; majors vêm um de cada vez para o culpado de uma quebra ser óbvio):
      - **Directus**: 11.17.4 → **12.4.1** ✅ (feito e verificado, ver v5.1.0).
      - **Lote 1 ✅ FEITO e confirmado em produção (2026-10-01, commit `443f24e`)** (seguro —
        mesma versão-maior + plataforma): pacotes do painel dentro das
        faixas (36 atualizados, ex.: TanStack Query 5.104, prettier 3.9.9); `fastapi` 0.142.2,
        `uvicorn` 0.54.0, `PyJWT` 2.15.1, `webauthn` 3.0.1; **Python 3.12 → 3.14** na imagem
        Docker e no CI (o venv local de teste já era 3.14.7 — testávamos numa versão e rodávamos
        noutra); **Node 22 → 26** no CI (testado localmente: tipos, testes, builds e e2e do site
        sob Node 26); ações `setup-node`/`setup-python`/`upload-artifact` v4/v5 → **v7**.
        **Verificado**: `pytest` 389/389 duas vezes no Python 3.14; painel lint/Prettier/`tsc`/
        Vitest 31/e2e 10 (Node 22 e 26); site 51 unitários + 29 e2e (Node 22 e 26) + Lighthouse
        sob Node 26; os três workflows verdes (a imagem da API foi construída no ACR com
        Python 3.14); API em produção na revisão `asaf-api--0000070` saudável: 342 rotas no
        OpenAPI, `/api/publico/eventos` 200, CORS do site intacto; tarefa agendada disparada à
        mão rodou no **CPython 3.14.7** contra o banco de produção (sucesso).
      - **Lote 2 ✅ FEITO e confirmado em produção (2026-10-01, commit `6bb45b3`)** (majors do
        front, um por vez, por um agente em cópia isolada e conferido por mim): React 18 → 19.3,
        Vite 5 → 8.3, `@vitejs/plugin-react` 4 → 6, Vitest 2 → 5, **Tailwind 3 → 4.3** (CSS-first,
        plugin do Vite; `design/theme.css` substitui `tailwind-preset.js`; sem `tailwind.config.js`
        nem `postcss.config.js`), Zod 3 → 4.6 (+ `@hookform/resolvers` 5), React Router 6 →
        **`react-router` 8.4** (o `react-router-dom` parou na 7.18), Recharts 2 → 3.10,
        TanStack Table 8 → 9.2 (`DataTable` reescrito), `lucide-react` 0.468 → 1.49,
        `tailwind-merge` 3, `jsdom` 25 → 30, `jest-axe` 11, `jest-dom` 7, `@types/node` 26,
        `globals` 17, ESLint 9 → 10, `eslint-plugin-react-hooks` 7, `prettier-plugin-astro` 1.1.
        **TypeScript — resolvido em 2026-10-02 (o usuário pediu para tentar de novo)**: no
        Lote 2 ficou na 6.0.3 porque `typescript-eslint` (peer `<6.1.0`) e `@astrojs/check` (peer
        `^5 || ^6`) não aceitam a 7. A equipe do `typescript-eslint` respondeu nos pedidos de
        suporte (#12518, #12720) que **a causa é o TypeScript 7 ainda não ter API** (virá na 7.1;
        `typescript@next` é `7.1.0-dev`) e que o caminho é rodar a 7 **lado a lado** com a 6,
        igual ao guia da Microsoft. Adotado assim nos dois projetos: `"@typescript/native":
        "npm:typescript@^7.0.2"` (`tsc` = **7.0.2**, usado no `typecheck` e no `build` do painel e
        no `typecheck` do site) e `"typescript": "npm:@typescript/typescript6@^6.0.2"` (a API que
        `typescript-eslint` e `astro check` ainda exigem; binário `tsc6`). Pré-lançamentos
        conferidos: a `canary` do `typescript-eslint` segue em `<6.1.0` e as betas do
        `@astrojs/check` são mais antigas que a estável — nada a adotar. **Reavaliar a cada
        lote**: quando `typescript-eslint` e `@astrojs/check` aceitarem a 7.1, o apelido
        `typescript` deixa de ser necessário. Lockfiles com os binários de Linux (CI) e
        `npm ci --dry-run` de Linux conferidos.
        **Verificação**: o agente mediu a geometria de **53 telas do painel** (5.909 elementos)
        antes/depois do Tailwind 4 e achou 839 elementos com caixa diferente — `space-y-N` do 4 é
        margem *inferior* com especificidade zero, desalinhava os ~70 formulários; foi corrigido
        com o utilitário `v3-space-y-*` (a regra do 3, byte a byte) e a diferença final é **0**;
        site 0,000% de pixels diferentes. Eu rodei as suítes completas duas vezes sobre o código
        já reposicionado no `main`: painel 52 testes + 10 e2e e site 51 + 29 e2e + Lighthouse
        100/100/100/100, sob Node 22 e Node 26; `npm ci` do CI (Linux x64) confere nos dois;
        workflows verdes; em produção, versões `6bb45b3`, as mesmas cores do site e do painel em
        tema claro e escuro, ilha de eventos funcionando, zero erro de console. **Notas**: o
        `npm outdated` esconde majors cujo `engines` exclui o Node local — rodar sob Node 26
        (`npx -y node@26`) e conferir com `npm view <pacote> dist-tags.latest`; o bundle do painel
        cresceu ~15% (JS 1.400 → 1.540 kB; code-splitting fica para depois); `v3-space-y-*` é uma
        muleta de compatibilidade (código novo: `gap-*`); `shadow-card` do site sempre foi uma
        sombra branca invisível (o Tailwind 3 resolvia o conflito de nome assim) — **LIGADA em
        2026-10-02 por decisão do usuário** ("se vai ligar, tem que deixar ligada"; sombra suave
        de cartão em camada dupla, só no site); as mensagens
        padrão do zod seguem em inglês (`z.config(z.locales.pt())` traduz).
        **Achados de acessibilidade que o agente trouxe e foram corrigidos no mesmo dia**:
        (1) o cabeçalho do `DataTable` era *sempre* um `<button>` — a caixa "Selecionar todos" ficava
        dentro de um botão e coluna de cabeçalho vazio virava botão sem nome; agora só colunas que
        ordenam têm botão, ícones são decorativos e o `<th>` informa `aria-sort` (2 testes novos,
        que reprovam no código antigo); (2) **contraste do vermelho**: botão destrutivo com 3,6:1 e,
        no **tema escuro, texto de erro com 2,0:1** (praticamente invisível) — corrigido em
        `design/tokens.css` e travado por `painel/src/test/tokens-contraste.test.ts`, que lê a fonte
        única e calcula **15 pares texto/fundo nos dois temas** (o axe do painel roda em jsdom e não
        mede contraste; o primeiro rodar achou exatamente 5 pares reprovados, todos de vermelho).
      - **Lote 3 ✅ FEITO e confirmado em produção (2026-10-02, commit `4c6a8f0`)** (majors do
        back, um pacote por vez): **SQLAlchemy 2.0.52 → 2.1.2**, **ReportLab 4.2.5 → 5.0.1**,
        **`qrcode` 7.4.2 → 8.2**, **Alembic 1.19.2 → 1.20.0**; Starlette 1.6 → 1.7 (vem pelo
        FastAPI, não fixado). Nenhum pré-lançamento mais novo que a estável.
        **PDF/QR conferidos pela saída, não só pelo teste**: tirei uma "fotografia de antes" do
        gerador REAL do sistema (`_gerar_pdf`, com e sem QR, com acentos e quebra de linha) e
        comparei a cada pacote com um rasterizador de PDF (PyMuPDF) e um leitor de QR (OpenCV):
        qrcode 8.2 → mesma matriz 41×41 e PNG pixel a pixel igual; ReportLab 5.0.1 → mesma página
        A4, mesmo texto extraído, mesmas fontes, **0 pixels diferentes** a 150 dpi, e o **QR dentro
        do PDF decodifica para a URL de verificação**. (O comparador foi validado antes contra si
        mesmo.) **SQLAlchemy 2.1.2** lido contra o **Postgres de produção, em conexão read-only**:
        114 modelos consultados com todas as colunas, 0 falhas, `alembic current` = head.
        **ACHADOS** (a validação num Postgres de verdade era o que faltava — a suíte inteira rodava só
        em SQLite, que não impõe chave estrangeira nem ordem de DDL):
        (1) **o único problema do 2.1 em si**: o `DATABASE_URL` de produção é `postgresql://` puro, e
        no 2.1 isso passou a significar **psycopg 3** (não instalado) — a API **não subiria** em
        produção e o `alembic upgrade head` do CI quebraria, com os 432 testes em SQLite verdes.
        Corrigido com `app/url_banco.py` (driver explícito `postgresql+psycopg2` em
        `app/database.py` e `alembic/env.py`), com teste que reproduz o erro real. Trocar para o
        psycopg 3 de propósito fica como decisão à parte (muda o binding de parâmetros num banco
        com dado de dinheiro/voto; agora existe a suíte em Postgres como rede de segurança para
        tentar);
        (2) **antigo, escondido**: `app/models/__init__.py` não importava
        `importacao/filiacao/situacao/voluntariado/qualidade_cadastro`, então o **Alembic não
        enxergava essas tabelas** e `alembic check` quebrava — o autogenerate as "apagaria" (aviso
        que o próprio `alembic/env.py` já trazia). O pacote agora importa todo módulo sozinho
        (`tests/test_modelos_registrados.py`);
        (3) **antigo**: `create_all` **quebrava em qualquer Postgres novo** (FK de
        `plano_de_contas.codigo_contabil_pai` para si mesma dentro do `CREATE TABLE`, antes do
        índice único existir) — invisível em produção (schema nasceu em etapas) e fatal para
        ambiente novo ou **recuperação de desastre**. `use_alter=True` com o nome que já existe em
        produção (conferido no banco: zero diferença), travado por `tests/test_ddl_postgres.py`
        (simula o DDL do Postgres sem banco; falha sem a correção);
        (4) **defeito real de produção**: "desfazer lote de importação" apagava a `pessoa` com o
        `associado` ainda no banco (sessão `autoflush=False` + `DELETE` em massa imediato) →
        `ForeignKeyViolation`/500 **sempre que o lote tivesse associados** — nunca funcionou em
        Postgres. `db.flush()` antes;
        (5) **real**: vincular cobrança a inscrição não conferia se o título existe → 500 em vez de
        404; agora 404 claro (e o teste que usava `id_titulo=999` inexistente passou a criar um
        título de verdade).
        **Mudança de processo**: o `Deploy API` agora roda a suíte inteira **contra um Postgres 16
        descartável** (serviço do GitHub Actions) e confere `alembic check` limpo **antes** de
        tocar na produção — era o que teria pegado (1), (3), (4) e (5) lá atrás. `tests/conftest.py`
        aceita `ASAF_TESTE_DATABASE_URL`; sem ela segue em SQLite (rápido, local).
        `.github/workflows/validar-postgres.yml` roda a mesma suíte numa **matriz SQLAlchemy
        2.0.52 × 2.1.2** em branch `validar/**` (sem deploy): resultado **444/444 nas duas** — é a
        ferramenta para comparar versão antiga × nova em lotes futuros.
        **Fatos que ficaram sem registro e agora estão**: (a) o histórico do Alembic **não recria o
        banco do zero** (a 1ª migração, `baseline: schema existente`, é vazia; o modo offline
        `--sql` também não funciona porque migrações inspecionam a conexão) — o banco novo nasce
        de `preparar_banco()` e é carimbado no head; (b) **13 diferenças antigas modelos × banco
        real** achadas pelo `alembic check` num banco de produção: **10 índices** que os modelos
        declaram e o banco não tem (`ix_associados_numero_matricula`, `ix_associados_id_pessoa`,
        `ix_aprovacoes_compra_id_solicitacao`, `ix_cotacoes_compra_id_solicitacao`,
        `ix_dados_bancarios_fornecedor_id_fornecedor`, `ix_dependentes_familiares_id_pessoa_titular`
        e `_vinculada`, `ix_doacoes_numero_recibo`, `ix_catalogos_chave`,
        `ix_opcoes_catalogo_codigo`) e **3 unicidades** que o banco guarda como constraint e os
        modelos como índice único (equivalentes). Sem efeito funcional hoje (387 linhas no total);
        a correção é uma migração de índices — **pendente, sem pressa**, a decidir com o usuário.
        **Verificado em produção**: `Deploy API` verde (schema+`alembic check`+444 testes em
        Postgres → migração contra a produção com o `postgresql://` puro → build no ACR → deploy);
        o log do build no ACR mostra `sqlalchemy==2.1.2`, `reportlab==5.0.1`, `qrcode==8.2` na
        imagem; revisão `asaf-api--0000073` **Healthy, 100% do tráfego**, imagem `4c6a8f0`;
        `/api/publico/eventos` 200 (lê o banco com o 2.1), OpenAPI com os mesmos 342 caminhos, e a
        foto do usuário no Blob segue idêntica (SHA-256) depois do deploy novo.
      - **Seguimento do Lote 3 ✅ FEITO e confirmado em produção (2026-10-02, commits `8a1a9bd` e
        `3e540f1`) — por pedido do usuário ("só tem eu de associado cadastrado", então sem risco de
        dado)**: (1) **driver trocado para o psycopg 3** (`psycopg[binary]==3.3.6`,
        `postgresql+psycopg`; o psycopg2 saiu do `requirements.txt`, do venv e do código —
        `scripts/isolar_directus.py` convertido, e `tests/test_url_banco.py` proíbe voltar a
        importá-lo). Provado antes de chegar à produção: suíte inteira (445) em **Postgres 16 e 18**
        reais no CI e leitura do banco de produção (121 modelos, 0 falhas, conexão read-only) com o
        driver novo; depois, em produção: imagem com `psycopg==3.3.6`, revisão
        `asaf-api--0000075` Healthy, partida no Blob, `/api/publico/eventos` 200,
        `scripts/isolar_directus.py verificar` OK ("o Directus não alcança nenhuma tabela do
        sistema"). (2) **Divergências modelo × banco zeradas.** **CORREÇÃO do que registrei acima:** o
        inventário de "13 diferenças" estava **incompleto** (meu script só contava índices e
        unicidades); o total real era **20**: os 7 índices que faltavam (migração
        `9d4e1b7c2a60`, `if_not_exists`, aplicada em produção pelo `Deploy API`; 7 de 7 conferidos em
        `pg_indexes`), as 3 unicidades (o banco as tem como constraints `uq_*` — foi o **modelo**
        alinhado ao banco, sem recriar nada, já que 35 chaves estrangeiras apontam para
        `associados`) e **7 colunas `NOT NULL` no banco que o modelo aceitava nulas**
        (`catalogos.chave`, `centros_de_custo.codigo`, `definicoes_campo.entidade`/`tipo`,
        `opcoes_catalogo.codigo`, `usuarios.senha_provisoria`, `valores_campo.id_registro`;
        só os modelos mudaram, o banco já impunha a regra). Resultado em produção:
        `alembic check` → **"No new upgrade operations detected"** e `compare_metadata`
        sem filtro → **0**. (3) `.github/workflows/validar-postgres.yml` virou matriz **Postgres
        16 × 18**, simula o schema de produção (sem os 7 índices), prova que o `alembic check`
        **enxerga** a falta (verifiquei que um passo anterior falhava pelo motivo errado e o
        corrigi), aplica a migração, repete (idempotência), faz downgrade/upgrade e roda a suíte.
      - **Conferência geral de versões, a pedido do usuário (2026-10-02, depois dos Lotes 1–4)** —
        levantamento NOVO contra as fontes oficiais, não de memória. **Na versão mais nova (estável)**:
        Postgres **18.6** (a mais nova da linha 18; servidor Azure `Ready`), Directus **12.4.1** (a
        `latest` do Docker Hub; sem pré-lançamento mais novo), Node **26.10.0** (a mais nova da linha
        26), Python **3.14** (a imagem `python:3.14-slim` é reconstruída a cada deploy e pega a
        3.14.8, atual), as 6 ações do GitHub (`checkout`/`setup-node`/`setup-python`/`upload-artifact`
        v7, `azure/login` v3, `static-web-apps-deploy` v1 — todas na maior mais nova), todos os
        pacotes do site, e os pacotes Python fixados (FastAPI 0.142.2, SQLAlchemy 2.1.2, psycopg
        3.3.6, Alembic 1.20.0, ReportLab 5.0.1, qrcode 8.2 etc.). **Achado na conferência, corrigido
        agora**: 2 pacotes do painel com correção nova (`@tanstack/react-query` 5.104.0 → 5.104.1,
        `lucide-react` 1.49.0 → 1.50.0) e o `httpx` 0.28.1, que é a linha antiga — trocado pelo
        sucessor oficial **`httpx2` 2.13.1** (feito pela equipe do Pydantic; o Starlette já avisava
        "install httpx2 instead"; usado na consulta de CEP e na validação de CNPJ de fornecedor).
        **Pré-lançamentos mais novos que a estável, NÃO adotados (motivo concreto, regra 2/3 do
        `CLAUDE.md`)**: (1) **Pydantic 2.14.0b2** (beta) — testei: 446/446 duas vezes; o Claude Code
        **bloqueou fixá-lo no `requirements.txt`** ("código não confiável") e eu não contornei;
        **decisão do usuário (2026-10-02): beta não é preocupação, só informação** — fica no 2.13.5
        estável, sem pendência. (2) **Python 3.15 em RC** (a final ainda não
        saiu; `python:3.15-slim` não existe, só `3.15-rc-slim`) — as rodas (pacotes prontos)
        existem para 10 dos 12 pacotes compilados testados, mas **`httptools` e `pyyaml`
        (vêm do `uvicorn[standard]`) não têm roda para a 3.15** e a imagem `slim` não tem
        compilador: bloqueado até saírem; reavaliar quando a 3.15 final e essas rodas existirem.
        (3) `httpx` 1.0.dev6 — não é a linha nova (a nova é o `httpx2`). **Transitivos** (cbor2,
        cryptography, greenlet, idna, Mako, python-dotenv, watchfiles, pydantic_core): não são
        fixados; a imagem Docker os resolve na versão mais nova a cada build. **Fica para
        acompanhar**: TypeScript 7.1 (quando `typescript-eslint`/`@astrojs/check` aceitarem).
      - **Lote 4 ✅ FEITO e confirmado em produção (2026-10-02): PostgreSQL 16.15 → 18.6.**
        O usuário colocou o Claude Code em modo manual e aprovou o comando (em modo automático o
        classificador o havia negado como "perigoso" — ver o parágrafo "PREPARADO" abaixo, mantido
        como histórico). `az postgres flexible-server upgrade -g Associacao-RG -n asaf-pg-server
        --version 18 --yes`: servidor em `UpgradingMajorVersion` de 18:09 a 18:26 UTC (**~17 min fora
        do ar**), voltou `Ready` na 18. **Provas**: (1) **impressão digital** de todas as tabelas
        (schemas `public` e `directus`; contagem + hash do conteúdo calculados no servidor) **idêntica
        em 156 de 156 tabelas, 549 linhas, antes (16.15) e depois (18.6)** — nenhum dado perdido nem
        alterado; (2) `show server_version` = **18.6**, SKU/disco/backup de 35 dias com
        geo-redundância e as 3 regras de firewall **preservados**; (3) `btree_gist` atualizado de 1.7
        para **1.8** (a exclusão de conflito de agenda continua presente), conexão com **TLS 1.3**;
        (4) `alembic current` = head e **`alembic check` limpo**, 121 modelos lidos com psycopg 3 e
        SQLAlchemy 2.1.2, 0 falhas; (5) `scripts/isolar_directus.py verificar` OK; (6) **Directus**
        reiniciou após o upgrade ("Database already initialized, skipping install", "Server started")
        e, numa consulta ao banco provocada por mim (`/assets/<inexistente>`), aparece conectado como
        **`directus_app`** (9 conexões), separado de `asafadmin`; (7) API: partida a frio de 23 s
        e `/api/publico/eventos` 200, site e painel 200; (8) a tarefa agendada de 15 em 15 min teve
        **uma única falha (18:16 UTC, dentro da janela)** e rodou com sucesso nas seguintes (18:45,
        19:12, 19:32) — ou seja, também conecta no 18 com o driver novo. **Depois do upgrade**:
        `ANALYZE` (as 156 tabelas estavam sem estatísticas, como esperado após upgrade maior; agora 0),
        o portão de testes do `Deploy API` passou para **`postgres:18`** (casa com a produção),
        `validar-postgres.yml` ficou com matriz `["18"]` (acrescentar a versão nova antes do próximo
        salto) e `infra/provisionar.exemplo.sh` cria servidor novo já na 18. **Fatos**: backup sob
        demanda **não existe em servidor Burstable** (a rede de segurança foi a restauração a
        qualquer ponto no tempo + o rollback automático do upgrade, sem precisar de nenhum dos dois).
        **Parágrafo histórico — o que estava "PREPARADO" antes da execução:** (servidor
        `asaf-pg-server`, Standard_B1ms)
        `asaf-pg-server`, Standard_B1ms) — upgrade maior de banco com dado real de associado e
        financeiro: exige backup/ponto de restauração confirmado, checagem de compatibilidade
        (inclusive do Directus) e **autorização explícita** na hora.
        **⏸ PREPARADO E PROVADO, FALTA EXECUTAR (2026-10-02) — o classificador do Claude Code
        bloqueou o `az postgres flexible-server upgrade` como "perigoso" (sem explicação);
        conforme a regra 4 do `CLAUDE.md`, parei e não contornei.** O usuário autorizou o upgrade na
        conversa ("se você conseguir fazer automaticamente... atualize para a versão 18") e disse que
        o que for manual fica para a próxima janela. O que já está pronto: (a) **pré-validação do
        Azure** (`--validate-only`) com **21 de 21 regras aprovadas** (extensões, objetos
        dependentes, dono dos objetos, encoding, replicação, transações preparadas, caminho de
        atualização das extensões — `btree_gist 1.7` é a única além do `plpgsql`); (b) o **app inteiro
        provado em Postgres 18.6** no CI (445 testes + schema + `alembic check` + migração de índices,
        com psycopg 3 e SQLAlchemy 2.1.2); (c) **`pool_pre_ping` já em produção**, para a API se
        recuperar sozinha das conexões derrubadas quando o servidor reiniciar; (d) **impressão
        digital** de todas as tabelas (156 tabelas, 549 linhas, hash do conteúdo calculado no
        servidor; `pytest`-like: duas leituras idênticas) guardada para comparar depois com
        `impressao_digital.py … comparar`; (e) estado do servidor: 16.15, `Ready`, B1ms, 32 GB, backup
        de 35 dias com geo-redundância, 22 backups automáticos (o mais recente de ~22 h antes),
        sem réplica, sem HA, 0 slots de replicação. **Backup sob demanda NÃO existe em servidor
        Burstable** (`CustomerOnDemandBackupCannotBePerformedOnBurstableServer`, verificado): a rede
        de segurança é a restauração a qualquer ponto no tempo (de 2026-09-10 até agora) + o
        rollback automático do próprio upgrade. **Para executar** (dura alguns minutos; API e
        Directus ficam sem banco nesse intervalo): `az postgres flexible-server upgrade -g
        Associacao-RG -n asaf-pg-server --version 18 --yes`; depois conferir `show server_version`
        = 18.x, a impressão digital, `/api/publico/eventos`, o Directus (`/server/ping`),
        `scripts/isolar_directus.py verificar` e `alembic check`; por fim trocar `image:
        postgres:16` para `postgres:18` em `.github/workflows/deploy-api.yml` (o portão do CI precisa
        casar com a produção) e rodar `ANALYZE`. A tarefa agendada de 15 em 15 min
        (`tarefa-eventos-vagas.yml`) vai falhar ao conectar durante a janela (o classificador também
        negou pausá-la; é inofensivo: falha antes de tocar em qualquer dado).
      - **Node local atualizado em 2026-10-02**: 22.12.0 → **26.10.0** (a mesma do CI), pelo
        `nvm` para Windows (`nvm install 26.10.0` e `nvm use 26.10.0`; `npm` 11.19.1). Zero
        avisos `EBADENGINE`; o `npm outdated` sob Node 26 mostrou só um patch de `@types/node`
        (26.6.3 → 26.6.4, aplicado). Suítes completas rodadas sob o Node 26 como padrão. As
        versões 24.19.0 e 20.20.2 seguem instaladas no `nvm` (candidatas a remoção).
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
>
> **Pendência registrada pela v2.3 (2026-09-15)**: registro de presença final da sessão de
> assembleia (`Credenciamento`, `app/routers/sessao_assembleia.py`) precisa de assinatura
> eletrônica para valer como substituto da lista de papel - hoje só grava entrada/saída
> autenticada, sem assinatura nenhuma. Conectar aqui quando este motor existir, respeitando o
> limite da v20.2.1 (não substitui ato registral).
>
> **Pendência registrada pela v2.2 (2026-09-15)**: adesão a petição de convocação de assembleia
> (`app/routers/governanca.py`, endpoint `aderir_peticao`, Art. 8º/10 do estatuto) hoje só grava
> o vínculo usuário↔associado autenticado (`AdesaoPeticao`) - quando este motor existir, cada
> adesão passa a carregar o mesmo evidence trail (OTP, metadados, carimbo de tempo, hash) de
> qualquer outra assinatura eletrônica, em vez de só "usuário logado clicou em aderir".

##### Autenticação do signatário no momento da assinatura

- [ ] Segunda etapa obrigatória no ato de assinar (não basta já estar logado): token OTP enviado
      por e-mail ou WhatsApp institucional (central multicanal da v11.3), **ou** confirmação de
      senha forte — nunca só um clique em botão sem segundo fator.
- [ ] OTP de uso único, expiração curta, vinculado ao documento específico (o código de um
      documento não serve para outro) e limite de tentativas.

##### Metadados do signatário (capturados no momento exato do aceite)

- [ ] Nome completo, CPF, e-mail cadastrado, endereço IP, User-Agent do navegador e geolocalização
      aproximada por IP (sem exigir GPS) — tudo gravado junto ao evento de assinatura, nunca
      inferido depois.
- [ ] Consentimento LGPD específico para essa captura, com o texto da versão vigente registrado.

##### Carimbo de tempo confiável

- [ ] Data/hora exata com fuso, sincronizada via NTP (idealmente contra servidor NTP.br do
      Observatório Nacional) — nunca só o relógio do servidor de aplicação sem sincronização.
- [ ] Divergência de relógio detectada e registrada — assinatura com horário duvidoso é evidência
      fraca justamente onde ela mais precisa ser forte.

##### Integridade criptográfica do documento

- [ ] Hash SHA-256 do arquivo calculado no exato momento do aceite e gravado junto ao registro —
      qualquer alteração posterior no PDF muda o hash e prova adulteração.
- [ ] Página de manifesto anexada ao PDF final, reunindo todos os itens acima de forma legível
      para quem for auditar — não basta guardar isso numa tabela do banco, tem que estar no
      próprio arquivo.
- [ ] Código público de verificação (`/documento/verificar/{codigo}`) confirmando autenticidade e
      integridade a partir do hash, sem expor o conteúdo do documento a quem não tem acesso.

##### Selo final do servidor

- [ ] Documento final selado com certificado digital da própria instituição (e-CNPJ A1) pelo
      servidor, garantindo que o PDF não foi modificado depois de processado — camada adicional
      ao hash, não substituta.
- [ ] O certificado A1 fica no Key Vault, nunca no repositório nem no sistema de arquivos do
      contêiner, com vencimento anual monitorado pelo motor de obrigações (v12.0) — certificado
      vencido para a emissão de documento sem aviso prévio.

##### Fluxo e operação

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
