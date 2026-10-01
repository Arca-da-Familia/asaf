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
      v5.1**: um Flow precisa de coleção para escutar, e as coleções só nascem na v5.1. O
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
>   **v5.5**, quando houver páginas e ilhas reais para escrever uma CSP correta.
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
> **Ainda não verificado em produção**: o Flow do Directus (v5.1) e qualquer evento real
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
> escalar a zero). Um teste de ponta a ponta no navegador com 25 min sem nenhuma chamada foi
> agendado para o mesmo dia; o resultado entra aqui quando sair.

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
      Application Insights para monitoramento.
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
