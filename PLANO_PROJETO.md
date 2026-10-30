# Plano do Projeto — Site Institucional + Sistema de Gestão ASAF (Sistema Integrado Único)

> **Histórico separado (2026-09-30)**: o registro completo (checklist original + confirmação em produção) de cada fase/versão já concluída mora em [`HISTORICO.md`](HISTORICO.md) (a FASE 5 foi para lá em 2026-10-20, quando fechou) — este arquivo ficou muito grande (passou de 6.600 linhas) misturando o que falta fazer com o que já foi feito há meses. Este arquivo agora é só o roteiro do que falta construir, com um pequeno resumo marcado ✅ onde uma fase (ou parte dela) já foi entregue.
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

### 4.2 Regra de trabalho: a homologação é o portão (decisão do Presidente, 2026-10-05; vale da v5.5 em diante)

> Trazida para cá em 2026-10-20, quando a FASE 5 foi para o `HISTORICO.md`: é regra de todas as fases seguintes, não registro da v5.4. O texto é o original.

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

✅ **Concluída em 2026-10-20** (os dois Pontos de Revisão fechados pelo Presidente). Todo o conteúdo desta fase (checklist de cada versão, o que foi visto na homologação, a confirmação em produção, os
dois Pontos de Revisão e o "Fechamento da FASE 5") foi movido, sem alteração, para [`HISTORICO.md`](HISTORICO.md#fase-5). Aqui fica só o resumo e o que continua valendo depois dela.

> **Fronteira que continua valendo:** no site, tudo que é **dado** vem do sistema (FastAPI); só o que é **editorial** (as notícias) vem do Directus. Documento, emenda e dinheiro têm o sistema como
> fonte da verdade.

| Versão | O que entregou |
| --- | --- |
| v5.0 | Fundação do site: Astro estático em `asaf.org.br`, os mesmos tokens de design do painel, SEO técnico (sitemap, Open Graph, dados estruturados) |
| v5.1 | Directus como editor de conteúdo (`cms.asaf.org.br`), isolado das tabelas do sistema |
| v5.2 | As 16 páginas essenciais (início, quem somos, diretoria, projetos, notícias, eventos, transparência, como ajudar, seja voluntário, seja associado, contato, privacidade, termos, estatuto, acessibilidade, minha conta) |
| v5.3 | O editor de verdade: Notícias no Directus, 5 perfis sem acesso de administrador, rascunho → revisão → publicado; o site se republica sozinho (de 15 em 15 minutos) quando a API ou o Directus mudam |
| v5.4a–b | Transparência e emendas parlamentares com o **sistema** como fonte: documentos e parcerias no painel, páginas do site geradas a partir da API |
| v5.4c–g | Conferência ao vivo, na homologação, de tudo que as FASES 0 a 5 tinham construído (robô Playwright, uma versão por fase) |
| v5.4h | Lacunas achadas ao vivo: títulos com filtro por mês e paginação, módulo Instituição (e o site lendo dele), Auditoria financeira do Conselho Fiscal, saídas com nota fiscal e dupla assinatura, filiação com os 3 sócios e formulário público, telas que faltavam, carga em dia de evento |
| v5.5a–d | Fila única de atendimento e formulários públicos (contato, pedido de informação, titular de dados); voluntário que não é associado; inscrição em evento pelo site; situação do evento (programado, adiado, cancelado, realizado) |
| v5.6a–b | Doação pelo site com Pix estático e confirmação manual; conta de visitante por e-mail + código |
| v5.7 | Cabeçalhos de segurança (CSP fechada), `security.txt`, declaração de acessibilidade; o site não usa cookie nem terceiro (por isso não tem banner) |
| v5.7b–d | Rotina de retenção (LGPD; prazos em Configurações); nome e foto da Diretoria no site; apagar de verdade (foto de quem saiu do mandato, versões antigas no armazenamento) |
| v5.7e–h | Conselho Fiscal audita sem operar (`financeiro_auditar`); validação da identidade de quem pede dado pessoal; leitura do Conselho paginada, permissão `editar_site`, "aplicado" por campanha na página Doar; e-mail do Directus e notícia ligada a emenda |

#### O que continua valendo depois da FASE 5

**Dado real que só o Presidente tem** (não trava nenhuma versão; a homologação usa dado inventado; ele cadastra depois):

1. **Chave Pix** (e nome e cidade do Pix) marcada "vai para o site" em Instituição: abre a doação online (hoje FECHADA).
2. **Mandatos reais** da Diretoria e do Conselho Fiscal (painel → Mandatos). **Condição:** antes, a conferência da diretoria contra a vedação do STF de 15/01/2026 (parentes de parlamentar), feita pela
   própria diretoria com a composição real (decisão do Presidente, 2026-10-20). O nome e a foto aparecem no site em cerca de 30 minutos.
3. **Dados da Instituição** (CNPJ, telefone, e-mail, horário, redes) marcados "vai para o site".
4. **Despertai**: o projeto com o texto real, a edição como evento ligado a ele e o documento que comprove o calendário oficial do município.
5. **Tabela de prazos de guarda** (proposta em Configurações, piso de 30 dias): ajustar se quiser. A tabela e o raciocínio legal estão no bloco da v5.6 do `HISTORICO.md` ("Tabela de temporalidade v1").

**Deixado de lado por decisão do Presidente (2026-10-20):** administrador de reserva e MFA do administrador do **Directus** (há 1 administrador; perdida a senha, recupera-se pelo banco); teste ao vivo dos
perfis do Directus com contas de teste (dispensado); outras coleções do Directus além de Notícias (textos de página, banners, galeria, FAQ, depoimentos, parceiros): cada uma vira versão própria só quando
ele pedir o editor daquele texto. A nota de saúde do Directus (`warn` por tempo de resposta do Postgres Burstable) é só acompanhamento.

**Limitações conhecidas** (consequência de decisão ou trade-off já registrado; nenhuma é item a construir):

- A foto de cadastro de associado já emitida segue abrindo por `/uploads/fotos/<uuid>` a quem já tem o endereço; a foto da Diretoria apagada leva **horas** para sair do site (o GitHub atrasa o agendamento).
- Pedido de voluntariado ligado pelo CPF a quem não tem data de nascimento no cadastro continua exigindo a autorização do responsável.
- O Pix feito sem se identificar não deixa registro (a tesouraria o vê no extrato e registra à mão); o e-mail do pedido, do recibo e do código é só tentativa, e o site diz isso.
- A inscrição feita pela secretaria não aparece na conta do visitante; a validação automática da identidade do titular só vale para associado (o resto passa pela equipe, de propósito).

**Adiado ou de outra fase:** mapa com pino na página Contato (só com coordenadas exatas da diretoria); tamanhos responsivos (`srcset`) das fotos; **FASE 7:** regra automática de retenção para inscritos em
evento, voluntários, certificados e o IP da Auditoria.

### FASE 6 — Comunicação e transparência

> ✅ **FASE 6 FECHADA em 2026-10-23, com o OK do Presidente** (os dois Pontos de Revisão fechados: 1/2 em 20/10 e 2/2 em 23/10). Tudo em produção (`c229176`). A FASE 7 só
> começa quando ele liberar.

#### v6.1 — Comunicação interna no painel

> **Decisões do Presidente (2026-10-20), ao liberar a FASE 6:** (1) quem publica são o **Presidente e os Secretários**: permissão nova `comunicar`, por padrão no nível Presidente e nos cargos
> Presidente, 1º e 2º Secretário (os outros recebem pela tela Níveis e permissões); (2) o associado **sem acesso ao painel** tem o aviso guardado no nome dele (aparece quando ganhar acesso) e o
> relatório de leitura diz "sem acesso ao painel: não foi avisado"; e-mail e WhatsApp são da v6.2; (3) a prova de leitura fica pelo **prazo da lei**, que ele me deixou escolher: **5 anos depois de o
> aviso vencer** (Código Civil art. 206: 3 anos para reparação civil e 5 para cobrança; o prazo geral de 10 anos do art. 205 só vale sem prazo específico; LGPD art. 16 manda eliminar quando a finalidade
> acaba). Depois disso some a lista de quem recebeu, leu e confirmou; o aviso (texto, autor, data, grupo e os totais) fica, como a ata, e a confirmação continua na Auditoria (que não tem prazo automático). O prazo fica em Configurações (piso de 30 dias) e entra na Política de Privacidade.

**Desenho.** Um **aviso** tem título, texto (só texto, nunca HTML), categoria (catálogo `categoria_aviso`: Geral, Convocação, Mudança de regra, Projeto, Evento, Financeiro; editável), **válido até**
e, quando importa, **pede confirmação** ("Li e estou ciente"). O **público é uma regra, nunca uma lista colada**, de três tipos: (a) **associados** (não desligados) filtrados por situação (ex.: "em
dia", calculada na hora pelo financeiro, não o rótulo guardado) e categoria (filtrar pela situação revela dado financeiro e de disciplina: exige também `associados` ou `financeiro`, e quem só tem `comunicar` vê só os totais de um aviso assim); (b) **quem tem uma permissão** (pelo nível ou pelo cargo em mandato vigente, igual ao servidor decide o acesso); (c) **equipe
e/ou voluntários de um projeto** (o voluntário que não é associado não tem acesso ao painel e fica para a v6.2), com o mesmo filtro de situação ("os associados em dia do projeto X"). Ao publicar, o
sistema calcula o grupo e **guarda quem estava nele naquele momento** (é a prova); a regra fica guardada junto, e "incluir quem entrou no grupo depois" acrescenta os novos sem tirar ninguém.

- [x] **Permissão e catálogo:** `comunicar` (módulo `comunicacao`) e o catálogo `categoria_aviso`; migração que dá `comunicar` a quem tem `gerenciar_acesso` (a Presidência) e aos cargos Presidente, 1º e 2º
      Secretário nos bancos que já existem.
- [x] **Publicar com contagem:** a tela mostra **quantas pessoas** vão receber e quem são (quem não tem acesso ao painel aparece marcado) antes de publicar; o servidor só publica se o total
      confirmado for o mesmo que ele calcula na hora (o grupo mudou → pede para conferir de novo) e recusa grupo vazio, validade no passado e texto vazio. Publicar avisa no sino quem tem acesso.
- [x] **Mural** na página Início: os avisos vigentes para a pessoa, os que pedem confirmação e ainda não foram confirmados primeiro. Quem não está no grupo não vê o aviso (nem pelo endereço: 404).
- [x] **Meus avisos** (caixa de entrada, no menu pessoal): tudo que a pessoa recebeu, inclusive vencidos e retirados (com o motivo); abrir marca como lido; "Li e estou ciente" grava a data e vai para a
      Auditoria.
- [x] **Módulo Comunicação** (permissão `comunicar`): lista dos avisos com os totais (destinatários, sem acesso, lidos, confirmados), o **relatório de leitura** de cada um (quem leu, quem confirmou,
      quem não tem acesso), incluir quem entrou no grupo depois, e **retirar** o aviso com motivo (sai do mural, fica no histórico de quem recebeu). Publicar, incluir, retirar e confirmar vão para a Auditoria.
- [x] **Prazo de guarda** `PRAZO_RETENCAO_LEITURA_DE_AVISOS_DIAS` (1825) na rotina de retenção, contado do fim da validade (ou da retirada); Política de Privacidade com o item novo.
- [x] **Na homologação:** robô `v6.1-01` pelas telas (publicar com a contagem, mural, abrir, confirmar, relatório, retirar, Auditoria; e o que tem de ser recusado: quem não tem `comunicar` não publica,
      quem não está no grupo não abre, total errado é recusado).

**Fora de escopo de propósito:** e-mail, WhatsApp, agendamento, modelos e descadastro (v6.2); anexos no aviso; editar aviso publicado (corrige-se retirando e publicando outro: a prova não muda por baixo).

✅ **v6.1 concluída (2026-10-20).**

**Conferência independente (agente `opus`, só leitura) achou 11 pontos, todos corrigidos antes de publicar e reconferidos pelo mesmo agente:** (1) desfazer um lote de importação dava erro 500 se um associado do
lote já tivesse recebido aviso (agora recusa com o motivo: a lista é a prova); (2) quem tivesse SÓ `comunicar` conseguia listar os inadimplentes pelo filtro de situação (agora o filtro por situação exige
também `associados` ou `financeiro`, e quem só comunica vê só os totais de um aviso assim); (3) a resposta de "Conferir" que chegasse depois de a pessoa mudar o grupo habilitava o publicar com a contagem
velha (agora a conferência só vale para o MESMO grupo, e o que se publica é o grupo conferido); (4) abrir um aviso no modo "ver como" gravava a leitura; (5) comentário errado na migração; (6) o grupo
fazia várias consultas por pessoa (agora a situação de todos sai de uma consulta só, `calcular_categorias`, com teste que a compara com `calcular_categoria`); (7) dava para retirar aviso já vencido;
(8) o relatório dizia "não foi avisado" a quem ganhou acesso depois; (9) o voluntário alocado como pessoa que depois se associou ficava fora do grupo; (10) a Política chamava o sino de "painel da
equipe" (o sino agora também avisa o associado); (11) o fim do mural na retenção não era a meia-noite de Belém. Também: o teste que confere as pendências de tela passou a procurar a versão no plano
OU no histórico (quebrou com a ida da FASE 5 para o `HISTORICO.md`; corrigido na `main`, `977f8f6`).
**Testes locais:** servidor 1388 em duas rodadas seguidas (25 testes novos; cada proteção nova confirmada por mutação), painel 690 (19 novos), site 761 unitários e 865 de navegador, tipos, lint e
formatação limpos; a migração subiu, desceu e subiu de novo num banco descartável com o `alembic check` limpo.
**Na homologação (2026-10-20):** a branch `v61-comunicacao-interna` foi publicada lá e a migração rodou no banco de TESTE (`Running upgrade c4a8e2f6d913 -> e5b1d7a3c820`). Robô `v6.1-01`, 5 de 5: o
**Secretário** (que tem `comunicar` pelo CARGO de 1º Secretário) confere "associados em dia" (a tela diz quantos não têm acesso ao painel e mostra os nomes), troca o grupo (a contagem some e o
publicar trava), escolhe "quem tem `financeiro_auditar`" (o Conselho Fiscal), publica com o número de pessoas no botão e na confirmação, e o servidor recusa um total errado (409) sem gravar nada; o
**Tesoureiro** (sem `comunicar`) não vê o módulo, o endereço dá "sem permissão", o servidor responde 403 à lista, ao relatório e a retirar, e, fora do grupo, abrir o aviso dá 404; o **Conselheiro**
vê o aviso no sino e no mural com "Pede a sua confirmação", abre, confirma ("Li e estou ciente") e vê a confirmação em Meus avisos; o relatório mostra que ele leu e confirmou, "incluir quem entrou
depois" não acha ninguém, retirar recusa motivo curto e retira com o motivo; a **Auditoria**, lida pelo Presidente, tem uma entrada de publicação, uma de confirmação e uma de retirada, cada uma com
quem fez; e o Conselheiro vê o aviso retirado, com o motivo, fora do mural e sem o botão de confirmar. Na 1ª rodada o roteiro falhou por defeito dele mesmo (dois links "Meus avisos" na página do
aviso), corrigido e refeito. Regressões verdes: `v5.7f-02` 4/4 (a Política no site de teste), `v5.4c-fase0` 6/6, `v5.4h-09` 5/5 (o sino da filiação) e `v5.4c-fase1` 24/24.
**Em produção (2026-10-20):** `main` = `aa3c08c`; Deploy API verde (1388 testes contra Postgres e o log mostra `Running upgrade c4a8e2f6d913 -> e5b1d7a3c820`), Deploy Painel e Deploy Site verdes;
`painel.asaf.org.br/version.json` e `asaf.org.br/version.json` = `aa3c08c`; o `openapi.json` da API traz as 9 rotas novas (`/api/avisos/...` e `/api/meus-avisos/...`) e `GET /api/meus-avisos/` sem
login responde 401; `/privacidade/` diz "Versão 2.4 · em vigor desde 20 de outubro de 2026" e traz o item do mural. Nenhum aviso foi publicado em produção (a produção não recebe dado de teste).
**Limitações conhecidas:** o grupo por permissão confere a permissão de cada usuário ativo um a um (aceitável para centenas); o semeador repõe `comunicar` ao nível Presidente a cada partida, como faz
com as outras permissões padrão (tirar só pelo nível não dura; o caminho é o cargo); o voluntário que não é associado não tem acesso ao painel e só será alcançado pelo e-mail da v6.2.

##### 🔍 Ponto de Revisão — FASE 6 (1/2 — meio, fecha v6.1)

✅ **FECHADO em 2026-10-20, com o OK do Presidente** ("está ok, e já pode seguir para a próxima versão, a 6.2"). A revisão e a correção dos achados estão abaixo.

Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:

- Mural de avisos respeita a segmentação por permissão/categoria — testar que um nível sem permissão não vê aviso restrito.

**Revisão feita em 2026-10-20 — aguardando o OK do Presidente para fechar** (o Ponto só fecha com o OK dele). Intervalo: `4f61730..8bb4d25` (a v6.1 e os ajustes dela). A leitura de código e
plano foi feita por um agente SEPARADO, só leitura (não ancorado na minha conclusão); o que depende de rodar coisas (itens 2, 4, 9, 11 e 12) foi feito por mim. Resultado do checklist da seção 4.1:
1. **`[x]` implementado e testado — OK**, com um achado: a recusa de TEXTO vazio, que o plano anuncia, não tinha teste (só o título vazio): teste acrescentado.
2. **Testes — OK:** servidor 1388 em duas rodadas seguidas e no CI contra Postgres (`aa3c08c`); painel 690; site 761 unitários e 865 de navegador; robô `v6.1-01` 5/5 na homologação e as regressões
   `v5.7f-02`, `v5.4c-fase0`, `v5.4h-09` e `v5.4c-fase1` verdes. Depois dos achados desta revisão: ver o fim deste bloco.
3. **Decisões congeladas — OK:** toda checagem de acesso usa `exigir_permissao`/`usuario_tem_permissao` (nenhum `if nivel ==`), tabela nova por Alembic com `upgrade` e `downgrade`, categoria do aviso
   é catálogo, nada mudou em JWT, MFA ou no token do painel.
4. **Segredos — OK:** varredura das 4.180 linhas acrescentadas no intervalo (chave privada, AKIA, tokens do GitHub, `sk-`, `AccountKey=`, SAS, URL de banco com senha, JWT, atribuição de segredo
   longo): nenhum achado.
5. **Auditoria — OK no código**, com um achado de prova: `AVISO_DESTINATARIOS_INCLUIDOS` não era conferido por teste (o robô inclui zero, e zero não grava): o teste agora confere a entrada com a
   quantidade e que incluir ninguém não grava. Publicar, retirar e confirmar já eram conferidos (teste e robô). Abrir não grava na Auditoria de propósito (a data fica na linha do destinatário).
6. **Permissão no servidor — OK:** as 7 rotas do módulo pedem `comunicar` (403 provado em todas, e no robô com o token do Tesoureiro), o filtro por situação pede também `associados` ou `financeiro`,
   e as 3 rotas de "Meus avisos" pedem login e devolvem 404 a quem não está no grupo. Observação, sem achado: quem tivesse SÓ `comunicar` veria, na prévia sem filtro, a lista de nomes do grupo;
   hoje todo cargo com `comunicar` já tem `associados`.
7. **Escopo — OK:** nada de e-mail, WhatsApp, agendamento, modelos ou descadastro (v6.2); a trava do "desfazer lote" e a regra de retenção são consequência da v6.1 e estão registradas.
8. **Plano × código — 3 achados, corrigidos:** o registro da v6.1 dizia "35 testes novos" (eram 25); a FASE 7 (v7.1) ainda dizia "7 regras" de retenção (são 8); e a v6.2 descrevia como futuro o
   que a v6.1 já fez (notificação no painel, público calculado, confirmação com contagem) e ainda dizia que "não existe envio de e-mail/notificação de verdade em lugar nenhum do sistema": ganhou as
   marcas `[parcial, v6.1]` e o aviso "reaproveitar, não reconstruir" o motor de público da v6.1.
9. **Suíte completa — OK** (item 2).
10. **Tela real — OK**, com um achado: cada rota tem a tela que a usa (Novo aviso, Avisos publicados, relatório, Mural no Início, Meus avisos, o aviso); o catálogo `categoria_aviso` aparecia em
    Configurações sob o código cru "comunicar": agora aparece como "Comunicação" (com teste de painel).
11. **O que a tela oferece para abrir foi aberto — OK, com o robô reforçado:** o `v6.1-01` agora abre o aviso CLICANDO no link do sino e o relatório clicando na lista de avisos publicados (antes ele via o
    link do sino e entrava pelo mural; o relatório era aberto pelo endereço); rodado de novo na homologação: 5/5 (`8bb4d25`). O mural e a lista de "Meus avisos" já eram clicados.
12. **No ar — OK:** `main` igual ao remoto; Deploy API, Painel e Site verdes para `aa3c08c` (o último commit de código; os seguintes são só do plano e do robô, que não publicam nada);
    `painel.asaf.org.br/version.json` e `asaf.org.br/version.json` = `aa3c08c`; a API de produção tem as 9 rotas novas e a migração `e5b1d7a3c820` aplicada (log do Deploy API).
**Específico deste ponto (segmentação):** provado pelo robô (o Tesoureiro, fora do grupo "quem tem `financeiro_auditar`", não vê o aviso no mural e recebe 404 pela tela e pela API) e pelos testes do servidor
para grupo de projeto, por situação e, depois do achado do revisor (só o grupo de projeto era provado no servidor), também para **grupo por permissão** (a Diretoria vê, o associado não vê e recebe 404) e
**grupo por categoria** (o Fundador recebe, o Efetivo não vê e recebe 404); cada proteção confirmada por mutação.
**Correção dos achados (2026-10-20):** branch `ponto-fase6-rotulo-comunicacao` → homologação (o robô `v6.1-01`, agora também abrindo Configurações e vendo o grupo "Comunicação" com a
"Categoria de aviso", 5/5) → `main`. Servidor 1390 em duas rodadas seguidas (2 testes novos e 2 reforçados, cada um confirmado por mutação), painel 691. **Em produção:** `main` = `ff1e3d3`;
Deploy Painel verde e `painel.asaf.org.br/version.json` = `ff1e3d3` (o código publicado já traz o rótulo "Comunicação"); a API não mudou (segue `aa3c08c`: a correção só tocou o painel e os testes).
**Fechado com o OK do Presidente em 2026-10-20.**

#### v6.2 — Central de comunicação multicanal (base para v11.3)
>
> **Pendência registrada pela v1.2 (2026-09-14)**: "boas-vindas automáticas" na efetivação de
> filiação (`app/routers/filiacao.py`, `aprovar_proposta`) e o "aviso à secretaria" quando o
> período de experiência acaba hoje só gravam `AuditLog` (`BOAS_VINDAS_REGISTRADAS`). Quando esta
> versão existir, conectar os dois eventos aqui em vez de deixar só no log. **(Atualizado em 2026-10-20, Ponto de Revisão FASE 6 1/2:**
> a frase antiga "não existe envio de e-mail/notificação de verdade em lugar nenhum do sistema" deixou de valer: já existem o sino do
> painel (v5.4h), o e-mail da API (ligado em produção em 2026-10-15) e o mural de avisos (v6.1); as boas-vindas é que seguem só no log.)
>
> **O que a v6.1 já entregou e esta versão reaproveita (não reconstruir):** o canal "painel" (mural, Meus avisos, sino), o motor de
> público (`app/services/comunicacao.py`: a REGRA do grupo guardada no aviso, `resolver_publico` calculando o grupo de hoje, a lista
> gravada como prova em `avisos_destinatarios`), a permissão própria `comunicar` e a confirmação com a contagem conferida (409 se o
> grupo mudou). O e-mail e o WhatsApp entram como canais novos sobre o MESMO público e a MESMA prova.
>
> **Ideia registrada pelo usuário (2026-09-15), ainda não detalhada**: "grupo de comunicação"
> configurável - um endereço/canal que **só envia, nunca recebe** (o usuário mesmo reconheceu
> que ainda não sabe como isso funcionaria na prática). Provavelmente equivale a um alias de
> e-mail de saída (remetente `NOME_DO_GRUPO@...` ou similar) associado a um segmento de público
> desta mesma v6.2 ("comunicados dirigidos a um grupo calculado"), não uma caixa de entrada
> nova. Detalhar o desenho quando esta versão for construída - também alimenta a fila de
> higienização de contato da v1.8 (e-mail que retorna) quando existir.

> **Decisões do Presidente (2026-10-20), ao liberar a v6.2:** (1) o aviso vai **também por e-mail quando quem publica escolhe** (a caixa vem marcada nas categorias obrigatórias); o
> painel recebe sempre; (2) **obrigatórias** (a pessoa não pode pedir para parar de receber) são **só Convocação e Mudança de regra**; lembrete de mensalidade e aviso de evento inscrito a pessoa pode
> desligar; o e-mail que a própria pessoa pediu (código de acesso, recibo, resposta de atendimento, confirmação de inscrição) é resposta, não comunicação, e não entra no descadastro; (3) o remetente
> continua **asaf@asaf.org.br** (as respostas caem na caixa da associação). **Fato conferido:** a conta Google Workspace, pelo caminho que o sistema usa (smtp.gmail.com com senha de app), envia até
> **2.000 mensagens por dia** (ajuda do Google: support.google.com/a/answer/166852 e /176600); o sistema fica num teto configurável abaixo disso, para sobrar para os e-mails automáticos.
> **Achado ao levantar o que existe:** os lembretes de mensalidade (v3.2.1) só rodam na tarefa MENSAL (dia 1º), então "N dias antes" e "N dias de atraso" só saem quando a data cai no dia 1º, e uma
> falha de e-mail derruba o lote inteiro: corrigido na v6.2d.

Em quatro partes, uma por vez (cada uma: branch → homologação → `main`):

##### v6.2a — O aviso também por e-mail, com registro de entrega por pessoa

- [x] Ao publicar, a caixa **"Também por e-mail"** (marcada por padrão em Convocação e Mudança de regra; a categoria ganha a marca `obrigatoria` no catálogo); a conferência do grupo diz quantos
      **têm e-mail** e quantos não têm.
- [x] **Registro de entrega por pessoa e por canal** (`entregas_de_aviso`): na fila, enviado (com a hora), falhou (com o motivo, sem o endereço) ou sem e-mail no cadastro. O endereço não é guardado:
      é lido do cadastro na hora de enviar. A lista some junto com a prova de leitura (o mesmo prazo de 5 anos).
- [x] **Envio em lotes pela tarefa de 15 em 15 minutos** (nunca dentro do clique de publicar), com uma conexão por lote, um teto por rodada e um **teto diário configurável** (padrão 1.500, abaixo das
      2.000 do Google); falha passageira volta para a fila (até 3 tentativas); recusa definitiva do endereço (ex.: caixa inexistente) não tenta de novo e manda o contato para a fila de higienização da
      v1.8 (e-mail suspeito); estourar o limite do Google para o lote e deixa o resto para depois.
- [x] **Relatório de leitura com a coluna do e-mail** e o botão **"Reenviar os que falharam"** (volta para a fila, vai para a Auditoria); retirar o aviso cancela o que ainda estava na fila; incluir quem
      entrou no grupo depois também põe o e-mail dessas pessoas na fila.
- [x] O e-mail leva o texto do aviso, quem publicou e o link para abrir no painel (quem tem acesso confirma a leitura lá); o endereço do painel fica em configuração (`URL_BASE_PAINEL`).
- [x] **Na homologação:** o ambiente de teste não tem e-mail (decisão de 2026-10-05: nada sai para gente inventada); o robô prova a fila, o relatório e o reenvio, e o envio em si é provado pelos testes
      do servidor contra um servidor de e-mail simulado. A produção é conferida por leitura (a rodada da tarefa no GitHub mostra quantos saíram).

✅ **v6.2a concluída (2026-10-20/21).**

**Como ficou (além do desenho acima):** cada entrega é **pega por uma rodada só** antes de sair (troca condicional `Na fila` → `Enviando` no banco, e o fluxo do GitHub com `concurrency`): duas rodadas
juntas nunca mandam o mesmo e-mail duas vezes, e o aviso retirado no meio da rodada não sai mais; a entrega que ficou `Enviando` por mais de 1 hora (a rodada caiu no meio) vira "Falhou" dizendo que pode ter
saído ou não. As categorias obrigatórias saem primeiro. A regra do e-mail é uma só (o de contato do cadastro; sem ele, o do login de um usuário ativo), na conferência e no envio; endereço fora do ASCII
conta como "sem e-mail". Param a rodada: o limite diário do Google (5.4.5, a entrega volta sem gastar tentativa), a queda da conexão ou o 421, e a recusa do REMETENTE (configuração: o passo fica vermelho);
o servidor pedindo para esperar no remetente (4xx) para sem alarme. A recusa de UMA pessoa não para a rodada. O motivo da falha é uma frase em português com o código do servidor, sem endereço. **"Enviado"
quer dizer que saiu do e-mail da ASAF:** o Google recusa na hora só caixa inexistente do próprio Google; a devolução que chega depois, de outros provedores, cai na caixa asaf@asaf.org.br e não é lida pelo
sistema (a tela diz isso; ler essas devoluções fica para uma versão futura, se o Presidente quiser).
**Conferência independente (agente `opus`, só leitura) achou 16 pontos, todos corrigidos e reconferidos pelo mesmo agente:** os dois médios eram (1) a primeira recusa de um destinatário parava a rodada
inteira (o `SMTPRecipientsRefused` herda de `OSError`; um aviso para 300 pessoas levaria horas) e (2) duas rodadas ao mesmo tempo mandariam o e-mail em dobro; os outros: retirada no meio da rodada, recusa
do remetente tratada como culpa da pessoa (e mandando contatos para a higienização), 421 cobrando tentativa da pessoa seguinte, endereço com acento quebrando a conversa com o servidor, regra do e-mail
diferente entre os tipos de grupo, higienização do contato quando a recusa era do login, aviso vencido ainda enviando, fila sem prioridade, motivo cru na tela, "Só no painel" falso em aviso antigo, a
tarefa rodando antes da migração, e detalhes de texto e desempenho.
**Testes locais:** servidor 1417 em duas rodadas seguidas (27 testes novos do envio, cada garantia confirmada por mutação), painel 696, tipos, lint e formatação limpos; a migração subiu, desceu e subiu de
novo num banco descartável com o `alembic check` limpo.
**Na homologação (2026-10-20):** a branch `v62a-aviso-por-email` foi publicada lá (`Running upgrade e5b1d7a3c820 -> a7c3e9f1b246` no banco de TESTE). A homologação não tem servidor de e-mail (de propósito):
o robô `v6.2a-01`, 4 de 4, provou pelas telas que a Convocação vem com "Também por e-mail" marcada, a conferência diz quantos têm e-mail, o relatório mostra a coluna do e-mail com todos "Na fila" e
nenhum "Enviado", o diálogo de publicar diz que também sai por e-mail, retirar cancela o que estava na fila, um aviso Geral sai só no painel (sem a coluna), quem não tem `comunicar` recebe 403 ao reenviar,
e a Auditoria guarda `"por_email": true`. O envio em si (enviado, falha, limite, tetos, rodadas simultâneas) é provado pelos testes do servidor contra um servidor de e-mail simulado. Regressões verdes:
`v6.1-01` 5/5, `v5.4c-fase0` 6/6 e `v5.4h-09` 5/5.
**Em produção (2026-10-20/21):** `main` = `0754d14`; Deploy API verde (1417 testes contra Postgres e o log mostra `Running upgrade e5b1d7a3c820 -> a7c3e9f1b246`) e Deploy Painel verde;
`painel.asaf.org.br/version.json` = `0754d14`; o `openapi.json` traz `/api/avisos/{id_aviso}/reenviar-emails` e o `POST` sem login responde 401; a tarefa periódica já rodou o passo novo em produção,
verde, com `{'enviados': 0, ...}` (ainda não há aviso marcado para e-mail). Nenhum e-mail de teste saiu em produção.

##### v6.2b — Preferências de contato e descadastro de verdade

- [x] Cada e-mail de comunicação **não obrigatória** (aviso não obrigatório, lembrete de mensalidade, aviso de evento inscrito) leva o link **"Não quero mais receber este tipo de e-mail"** e o cabeçalho
      `List-Unsubscribe`; o link abre uma página do site que confirma e grava a preferência (link assinado, sem guardar senha nem token).
- [x] O associado vê e muda as preferências em **Meu Perfil**; a convocação e a mudança de regra **não** se desligam, e a tela diz por quê.
- [x] O envio respeita a preferência em todos os canais e mostra "não recebe por escolha da pessoa" no relatório; Política de Privacidade com o descadastro.

**Como ficou decidido ao construir (2026-10-21):** o aviso de evento vai UMA vez por endereço (família inscrita junta), então a escolha vale para o ENDEREÇO: se alguém que usa
aquele endereço desligou, o endereço não recebe (senão quem desligou continuaria recebendo pelo link de outra pessoa da família). O aviso de vaga aberta na lista de espera
continua chegando a todos (é a única chance de confirmar a vaga). Quem é anonimizado pela rotina de guarda (associado desligado) tem a escolha apagada junto. O usuário só de
equipe, sem cadastro de pessoa, não tem preferência (recebe os avisos não obrigatórios sem o link).

✅ **v6.2b concluída (2026-10-21).**

**Como ficou:** o link do fim de cada e-mail que se pode desligar é `<pessoa>.<tipo>.<assinatura>` (HMAC com o segredo do servidor, prefixo próprio): não guarda token, não serve para outra
pessoa nem para outro tipo, e tudo que está errado recebe o mesmo 404 (a página não revela se a pessoa existe nem dado dela). As rotas públicas têm limite por IP; o mesmo link deixa voltar a receber;
cada mudança vai para a Auditoria (pelo link, sem usuário e com o IP; pelo painel, com o usuário), e repetir a mesma escolha não grava de novo. O e-mail que se pode desligar leva também o cabeçalho
`List-Unsubscribe` (o botão "cancelar inscrição" dos programas de e-mail); o obrigatório diz que é obrigatório. Na homologação (sem e-mail), e só ali, o painel entrega à própria pessoa o link dela, para o
robô provar a página do site.
**Conferência independente (agente `opus`, só leitura) achou 13 pontos, todos corrigidos:** o alto era que o valor "Não recebe por escolha da pessoa" (32 letras) não cabia na coluna de 30 do banco: no Postgres
a publicação daria erro (os testes locais em SQLite não pegavam; agora é "Desligou por escolha" e um teste confere o tamanho de cada valor); os médios: a família que divide o endereço recebia o aviso de
evento pelo link de outra pessoa (agora a escolha vale para o endereço) e a Política prometia o link em e-mails que não o têm (o de vaga aberta e o enviado a quem não tem cadastro); os outros: textos públicos
("quem é associado escolhe no Meu Perfil" valia só para quem tem acesso ao painel; "chegam a todos os associados"; "o botão abaixo"), a primeira letra do rótulo, a contagem na tela da situação do evento e
na conferência, a anonimização do desligado passando a apagar a escolha (LGPD), dois cliques ao mesmo tempo, a mensagem do limite por IP e a limpeza do robô se ele falhar no meio.
**Testes locais:** servidor 1431 em duas rodadas seguidas (14 testes novos, cada garantia confirmada por mutação), painel 699, site 766 unitários e 870 de navegador, tipos, lint e formatação limpos; a
migração subiu, desceu e subiu de novo num banco descartável com o `alembic check` limpo.
**Na homologação (2026-10-21):** a branch `v62b-descadastro` foi publicada lá (`Running upgrade a7c3e9f1b246 -> b8d4f0a2c357` no banco de TESTE). Robô `v6.2b-01`, 4 de 4: o **Conselheiro** vê em
Meu Perfil > E-mails da ASAF as três escolhas (sem a convocação nem a mudança de regra, e a tela diz por quê) e desliga os avisos; o **Secretário** publica para o Conselho Fiscal um aviso Geral e uma
Convocação, os dois por e-mail: a conferência diz que alguém desligou, e no relatório o conselheiro aparece "Desligou por escolha" no Geral e "Na fila" na Convocação; o link do conselheiro abre a página
do SITE DE TESTE, que diz que ele não recebe mais, e ele volta a receber por ela (o Meu Perfil mostra de volta); um link adulterado é recusado pela página e pela API (404); a Auditoria guarda a mudança pelo
painel (com o usuário) e a pelo link (sem usuário). Na 1ª rodada o robô achou um defeito de tela: a caixa só mudava depois da resposta do servidor; agora muda no clique e volta se o servidor recusar
(corrigido e refeito). Regressões verdes: `v6.2a-01` 4/4, `v6.1-01` 5/5, a cadeia `v5.5d` inteira na ordem certa (01, nova publicação, 02, nova publicação, 03, 04, 05: 8 testes), `v5.7f-02` 4/4
e `v5.4c-fase0` 6/6.
**Em produção (2026-10-21):** `main` = `895d70a`; Deploy API verde (1431 testes contra Postgres e o log mostra `Running upgrade a7c3e9f1b246 -> b8d4f0a2c357`), Deploy Painel e Deploy Site verdes;
`painel.asaf.org.br/version.json` e `asaf.org.br/version.json` = `895d70a`; `GET /api/publico/descadastro` com um link adulterado responde 404 "Link inválido ou incompleto." e
`/api/minhas-preferencias-de-comunicacao/` sem login responde 401; `/descadastrar/` responde 200 com `noindex` e fica fora do `sitemap-0.xml`; `/privacidade/` diz "Versão 2.5 · em vigor desde 21 de
outubro de 2026" e traz o parágrafo `data-emails-da-asaf`. Nenhuma preferência de teste foi gravada em produção.

##### v6.2c — Modelos de mensagem, pré-visualização, envio de teste e agendamento

- [x] Modelos versionados com variáveis (`{primeiro_nome}`, `{nome}`), pré-visualização com uma pessoa real do grupo e **envio de teste** para o próprio e-mail antes do disparo.
- [x] **Publicar depois** (data e hora): quem publica escolhe; a tela diz com franqueza que a tarefa do GitHub pode atrasar (de minutos a horas).

**Como ficou decidido ao construir (2026-10-21):** as variáveis valem só no TEXTO (o título aparece igual para todos no sino e nas listas); quem recebe vê o próprio nome no painel
e no e-mail, e o relatório mostra o texto como foi escrito. O modelo é versionado por grupo (editar cria a versão nova e desativa a anterior; arquivar tira da lista sem apagar) e o
aviso guarda a versão usada. O envio de teste vai só para o e-mail de quem publica (o de contato; sem ele, o do login), marcado "[TESTE]", com até 10 por hora. O agendado é
publicado na primeira rodada da tarefa periódica depois da hora (entre 5 minutos e 90 dias à frente), com o grupo recalculado naquela hora; se o autor perdeu `comunicar`, se a
validade passou ou se ninguém está mais no grupo, é cancelado com o motivo. Na homologação (que não tem tarefa agendada) a rotina roda a cada nova publicação de teste, como as
rotinas de foto e de guarda.

✅ **v6.2c concluída (2026-10-21).**

**Conferência independente (agente `opus`, só leitura), todos os pontos corrigidos e cada garantia confirmada por mutação:** o risco de o mesmo agendado sair duas vezes (a rotina agora
toma o agendamento com uma troca condicional antes de publicar, e uma falha depois de publicar não o devolve à fila); cancelar ao mesmo tempo que a rotina publica (o cancelamento só vale se ainda
está "Agendado"); a lista de publicados e cancelados começando pelo mais novo; a prévia de quem não tem cadastro usava o e-mail como nome (agora "associado(a)"); o "também por e-mail" do modelo
sobrepondo a escolha de quem publica; prévia velha depois de mudar o texto; duas versões iguais do mesmo modelo (agora barradas pelo banco); o autor avisado no sino quando o sistema cancela o
agendado; o nome da chave estrangeira; uma dica de tela com a palavra "título" que confundia a busca do robô pelo campo; e textos.
**Testes locais:** servidor 1451 em duas rodadas seguidas (20 testes novos), painel 705, tipos, lint e formatação limpos; a migração subiu, desceu e subiu de novo num banco descartável.
**Na homologação (2026-10-21):** a branch `v62c-modelos-e-agendamento` foi publicada lá (`Running upgrade b8d4f0a2c357 -> c9e5a1b3d468` no banco de TESTE). Robô `v6.2c-01`, 2 de 2: o
**Secretário** cria um modelo com `{primeiro_nome}` e o edita (a versão 2 entra em uso e a 1 fica no histórico); no Novo aviso começa do modelo, pré-visualiza (o texto chega com o primeiro nome
de uma pessoa do Conselho Fiscal) e pede o envio de teste, que a homologação RECUSA com a explicação (não tem servidor de e-mail; o envio em si é provado pelos testes do servidor); agenda um
aviso para dali a 7 minutos e um segundo, que cancela com motivo; o servidor recusa agendar para dali a 1 minuto e recusa variável que não existe. Nova publicação da homologação: a rotina
publicou o agendado (`{'publicados': 1, 'cancelados': 0, 'falhas': 0}`). Robô `v6.2c-02`, 3 de 3: em Agendados aparece "Publicado" com o link do aviso, o relatório diz o modelo e a versão
usada, o **Conselheiro** lê o texto com o PRÓPRIO primeiro nome e a Auditoria guarda a publicação pelo sistema (o aviso de teste é retirado no fim). Regressões verdes: `v6.2b-01` 4/4,
`v6.2a-01` 4/4 e `v6.1-01` 5/5.
**Em produção (2026-10-21):** `main` = `24f0f05`; Deploy API verde (1451 testes contra Postgres; o log mostra `Running upgrade b8d4f0a2c357 -> c9e5a1b3d468`) e Deploy Painel verde;
`painel.asaf.org.br/version.json` = `24f0f05`; o `openapi.json` traz `/api/modelos-de-aviso/`, `/api/avisos-agendados/`, `/api/avisos/pre-visualizar` e `/api/avisos/enviar-teste`, e
`GET /api/modelos-de-aviso/` e `GET /api/avisos-agendados/` sem login respondem 401. Nenhum modelo nem agendamento de teste foi gravado em produção.

##### v6.2d — Os automáticos

- [x] **Boas-vindas** ao associado aceito (aviso no painel e e-mail), no lugar do registro só na Auditoria (pendência da v1.2).
- [x] **Aviso à secretaria** (sino) quando acaba o período de experiência de um associado.
- [x] **Lembretes de mensalidade** na tarefa diária, com o registro de entrega e sem derrubar o lote por uma falha (o achado acima).

✅ **v6.2d concluída (2026-10-21).**

**Como ficou:** na aprovação da filiação sai o e-mail de boas-vindas (matrícula e fim do período de experiência; melhor esforço: a falha do e-mail nunca desfaz a aprovação); a
Auditoria guarda o resultado (`BOAS_VINDAS_ENVIADAS`: enviado, sem e-mail, falhou, sem servidor de e-mail), nunca o endereço, e o log da API também não. Quando a secretaria libera o acesso,
o primeiro aviso do sino é "Bem-vindo(a) ao painel da ASAF" (o título serve também ao associado antigo que só agora ganhou acesso). O fim da experiência: a rotina de 15 minutos recalcula
quem passou do prazo, e a SAÍDA de "Em Experiência" com o prazo vencido avisa no sino quem tem `associados` (pelo nível ou pelo cargo) no mesmo commit da situação nova, venha da rotina ou de
um lançamento financeiro: o aviso nunca se perde e sai uma vez por pessoa (quem entrou de licença no meio da experiência não recebe aviso de fim). Os lembretes de mensalidade saem de uma tarefa
diária própria (`tarefa-diaria-lembretes.yml`, 09:00 de Belém; a tarefa mensal ficou só com a cobrança e as contas a pagar): o "hoje" é o dia de Belém; uma rodada perdida é recuperada (até 2
dias, menos o "vence hoje", cujo texto ficaria errado) e o texto do atraso conta os dias de verdade; um lembrete por título por rodada (degrau de atraso só de 1 dia ou mais) e nunca um atraso
menor depois de um maior; um e-mail que falha não derruba o lote (sai no dia seguinte, dentro da tolerância), o endereço que o servidor diz não existir vai para a fila de higienização da v1.8,
e só a falha da conta ou da conexão para a rodada (a pausa pedida pelo servidor para sem alarme); a rodada fica na Auditoria (`LEMBRETES_DO_DIA`, sem endereço). O endereço segue a regra única dos
e-mails do sistema (endereço com acento não é tentado). A Política de Privacidade não muda: as boas-vindas são "a resposta a um pedido" (a filiação), que ela já lista entre os e-mails que não se desligam.
**Conferência independente (agente `opus`, só leitura), todos os pontos corrigidos:** os médios eram o endereço indo para o log da API quando as boas-vindas falhavam (o texto da recusa do servidor
traz o destinatário) e um endereço com acento que pararia a rodada diária por até 3 dias, deixando sem lembrete os títulos depois dele; os outros: um teste que quebraria no Postgres, o robô que
filmaria a senha provisória (a tela "Conceder acesso" a mostra em texto: o roteiro roda sem vídeo e sem print automático), a pausa do servidor deixando a tarefa vermelha, o aviso de fim de
experiência que se perdia se um lançamento financeiro recalculasse a situação antes da rotina (agora sai na própria transição, no mesmo commit), o endereço inexistente fora da higienização, um
comentário antigo ("não existe cron") e código repetido. **Testes locais:** servidor 1470 em duas rodadas seguidas (19 testes novos; corrigido no Ponto de Revisão FASE 6 2/2, antes dizia 21); 22 mutações, cada uma pega pelo seu teste.
**Achado no caminho (vira correção própria, a seguir):** a tela "Conceder acesso" diz que o associado "será obrigado a trocar a senha no primeiro login", mas o painel não obriga.
**Na homologação (2026-10-21):** a branch `v62d-automaticos` foi publicada lá (cada publicação roda a rotina do fim da experiência e, antes dela e só no `asaf_hml`, um roteiro que faz passar
os 90 dias do candidato do robô). Na 1ª rodada o robô achou um defeito dele mesmo (procurava a situação na tela errada; ela fica na aba Situação), corrigido e refeito. Robô `v6.2d-01`, 2 de 2: um
candidato pede a filiação, o Presidente confere, três sócios propõem e o Presidente aprova pela tela; a Auditoria guarda as boas-vindas ("sem servidor de e-mail": a homologação não tem, e o envio em
si é provado pelos testes do servidor) sem o endereço; o Presidente libera o acesso pela tela, o novo associado entra pela primeira vez e o sino diz "Bem-vindo(a) ao painel da ASAF". Nova
publicação (`{'fim_de_experiencia': 1}`). Robô `v6.2d-02`, 1 de 1: o sino do Presidente avisa "Fim do período de experiência: matrícula nº …", o link abre o cadastro, a aba Situação mostra a
situação nova e a Auditoria guarda a mudança pelo sistema, com "Em Experiência" antes. Regressões verdes: `v5.4c-fase1` 24/24 (a filiação inteira), `v6.2a-01` 4/4, `v6.2b-01` 4/4 e `v6.1-01` 5/5.
**Em produção (2026-10-21):** `main` = `a7ca7d6`; Deploy API verde (1470 testes contra Postgres; a imagem `asaf-api:a7ca7d6…` em execução; não há migração nesta versão nem mudança de tela, então
o painel continua no `24f0f05`); a API responde; a "Tarefa Diária (lembretes de mensalidade por e-mail)" está registrada e ativa (primeira rodada no agendamento de 22/10, 09:00 de Belém) e a
"Tarefa Mensal" passou a ser só "cobrança do mês + contas a pagar recorrentes". Nada de teste foi gravado em produção.
**A rotina em produção (22/10):** a tarefa periódica de 15 minutos rodou VERDE com os passos novos da v6.2c e da v6.2d (`[fim-de-experiencia] {'fim_de_experiencia': 0}` e
`[publicar-avisos-agendados] {'publicados': 0, ...}`: ainda não há experiência vencida nem aviso agendado em produção).

##### Correção do achado da v6.2d + "Esqueci a minha senha" (pedido do Presidente)

- [x] **A troca obrigatória da senha provisória.** A tela "Conceder acesso" prometia que o associado seria "obrigado a trocar a senha no primeiro login", mas o painel ignorava a
  marca `senha_provisoria`. Agora o `/auth/me` a informa e a guarda `RequireSenhaDefinitiva` leva o painel inteiro à tela "Troque a sua senha" (antes do MFA obrigatório; quem chega lá sem
  a senha provisória volta ao início); a senha nova não pode ser igual à atual. Na homologação, as contas de teste do cofre (cuja senha não é provisória) ficam marcadas com a senha
  definitiva por um roteiro que só roda no `asaf_hml`.
- [x] **"Esqueci a minha senha"** (pedido do Presidente em 21/10: "manda um e-mail para ela com um código e ele vai colocar esse código e troca a senha"): na tela de entrar, o CPF pede um
  código de 6 números que vai ao e-mail de acesso ao painel (sem ele, ao de contato); vale 10 minutos, serve uma vez e aceita 5 tentativas (contadas antes de conferir, de forma atômica). A
  resposta é a mesma, no conteúdo e no tempo, exista ou não a conta (procurar a conta, gerar o código e enviar o e-mail ficam para depois da resposta). Limites por IP, por CPF, por conta (6
  códigos e 10 tentativas em 24 h, somando os códigos: pedir código novo não dá palpites novos; o teto fica na Auditoria) e do sistema (300 por dia, para não esgotar a cota do Google). A
  troca é um commit só: código gasto, senha nova, fim da senha provisória e do bloqueio por senha errada, sessões encerradas (nenhuma se renova; o acesso já aberto vale até 45 minutos) e
  Auditoria (`SENHA_TROCADA_PELO_CODIGO`, com o IP, sem o e-mail); a pessoa recebe o aviso de senha trocada; o MFA continua exigido no próximo login. Na homologação (sem e-mail) o código
  aparece na tela, e só para conta fora do cofre e sem permissão do sistema (os CPFs das contas de teste estão no repositório). Migração `d3f6b2c8e571`; Política de Privacidade **2.6**.

**Achados no caminho, corrigidos junto:** ao concluir a ativação do MFA, o painel podia voltar para ela (lia a cópia de 30 s do `/auth/me`); essa cópia sobrevivia a sair e entrar com
outra conta na mesma aba (agora sair e entrar apagam tudo); o Meu Perfil pedia 10 caracteres (a regra do sistema é 8 desde a v3.0.1); senha com mais de 72 bytes dava erro 500 (o bcrypt
não aceita; agora é recusada com mensagem, em todos os caminhos).
**Conferência independente (agente `opus`, só leitura), duas, todos os pontos corrigidos:** na troca obrigatória, o alto era o próprio defeito da cópia velha do `/auth/me` (o robô cairia
nele); no "Esqueci a minha senha", os altos eram que, na homologação, qualquer pessoa trocaria a senha do Presidente de teste (o código voltava na resposta e o CPF é público no
repositório) e um teste existente das rotas sem login que reprovaria a publicação; os médios: palpites sem teto por conta, e-mail em massa contra a cota diária, senha longa dando 500,
o tempo da resposta revelando quem tem conta; os baixos: textos das sessões, transação única, segredo ausente, Política, testes. A reconferência achou os 11 resolvidos.
**Risco que fica registrado:** o servidor não recusa as rotas para quem ainda tem senha provisória (a obrigação é do painel, como a do MFA pendente); não foi possível contar, só lendo, quantos
usuários de produção ainda têm a senha provisória (o banco só aceita conexão de dentro do Azure, e eu não abro o firewall); com o "Esqueci a minha senha", quem esqueceu a provisória não
fica preso.
**Testes locais:** servidor 1494 em duas rodadas seguidas; painel 716; site 766 unitários e 867 de navegador (corrigido no Ponto FASE 6 2/2: antes dizia 870); 23 mutações, 22 pegas (a que escapa é uma conferência que o banco também faz).
**Na homologação (21–22/10):** a branch `correcao-senha-provisoria` foi publicada lá (`Running upgrade c9e5a1b3d468 -> d3f6b2c8e571`; 9 contas do cofre marcadas com a senha definitiva).
Robô `v6.2d-01`, 2 de 2: o associado novo entra com a senha provisória, o painel o OBRIGA a trocar (nem o endereço direto abre outra tela), a senha atual errada é recusada e, trocada, o
sino dá as boas-vindas. Robô `v6.2d-03`, 2 de 2 (na 1ª rodada o robô achou defeito dele mesmo: a faixa de ambiente de teste também é um aviso na tela; corrigido): pela tela de entrar,
"Esqueci a minha senha", o código errado é recusado, o certo troca a senha e a pessoa entra com a nova; o mesmo código não serve de novo, um CPF sem conta recebe a mesma resposta e a
Auditoria guarda a troca. Regressões verdes: `v6.2d-02` 1/1, `v5.4c-fase0` 6/6, `v5.4c-fase1` 24/24, `v5.4h-03` 8/8, `v6.1-01` 5/5, `v6.2a-01` 4/4, `v6.2b-01` 4/4 e `v6.2c-01` 2/2.
**Em produção (22/10):** `main` = `b4beb6b`; Deploy API verde (1494 testes contra Postgres; `Running upgrade c9e5a1b3d468 -> d3f6b2c8e571`) e Deploy Painel verde (`version.json` =
`b4beb6b`); o `openapi.json` traz `/auth/senha/esqueci` e `/auth/senha/trocar-com-codigo`; `/auth/me` sem login responde 401; `painel.asaf.org.br/esqueci-a-senha` abre. A publicação do
site reprovou duas vezes por testes que ainda esperavam a Política 2.5 (a rodada local tinha reaproveitado um servidor de pré-visualização antigo; lição: rodar o e2e do site sem reaproveitar
servidor): corrigidos e publicada, `asaf.org.br/version.json` = `879c4d3` e `/privacidade/` diz "Versão 2.6 · em vigor desde 21 de outubro de 2026" com o parágrafo `data-esqueci-a-senha`.
Nenhum código nem senha de teste foi gerado em produção.

**Fora de escopo de propósito:** WhatsApp (v11.3), e-mail com HTML e imagens (texto simples chega melhor e não cai no lixo eletrônico), leitura do e-mail ("abriu ou não": exige pixel de rastreio,
que a Política não promete e a LGPD desaconselha), o endereço só de envio (o Presidente escolheu asaf@asaf.org.br).

#### v6.3 — Transparência pública ativa

- [x] Publicação automática do relatório financeiro resumido (FASE 3) e de documentos
      institucionais (estatuto vigente, atas aprovadas, relatório anual) em `/transparencia/`,
      gerada do próprio dado — nunca digitada duas vezes.
- [x] Cada documento publicado com data, versão e responsável; documento substituído mantém o
      histórico acessível em vez de sumir.
- [x] Relatório anual de atividades montado automaticamente a partir de projetos, indicadores,
      eventos e financeiro do exercício, com espaço editorial para texto da diretoria — a peça que
      toda associação faz na correria e que aqui nasce pronta.

> **Os três itens acima foram feitos nas partes v6.3a, v6.3b e v6.3c (abaixo, com o que foi visto na homologação e confirmado em produção).**
>
> **Decisões do Presidente (2026-10-22), ao liberar a v6.3** (e pedir o Ponto de Revisão FASE 6 2/2 logo em seguida): (1) as **contas do ano** só vão ao site **depois de a Assembleia
> aprovar** (a deliberação de aprovação de contas) e de o Presidente ou o Secretário confirmar a publicação; resumo sem nome de ninguém, com o parecer do Conselho Fiscal; (2) as **atas** vão ao
> site **em TEXTO, nunca o PDF** ("risco de dados"): parte-se do texto da ata, o verificador reconhece o dado pessoal, ele é retirado e só o necessário vai ao público, com aprovação do
> Presidente ou do Secretário (no sistema toda ata é de Assembleia: não há ata de reunião da Diretoria); (3) o **responsável** de cada documento publicado é o **cargo e o nome** de quem
> aprovou; (4) o **relatório anual**: o sistema monta os números do ano, a secretaria (permissão Documentos) escreve a apresentação e o Presidente ou o Secretário (outra pessoa) aprova.
> **O que já existia (levantamento de 22/10):** as páginas da Transparência (emendas, parcerias, documentos aprovados por tipo e ano, editais de assembleia, dados abertos), o módulo
> Documentos (tipos ESTATUTO, ATA, BALANCO, RELATORIO_ANUAL; versão pública em PDF ou TEXTO com o verificador de dado pessoal; aprovação por outra pessoa; versões em `grupo_versao`), a
> prestação de contas por exercício (texto interno, sem publicação), o relatório final de projeto e o fechamento de evento (números sem nome). O Estatuto do site continua sendo a
> transcrição do registro em cartório (decisão de 09/10). Em três partes, uma por vez (cada uma: branch → homologação → `main`):

##### v6.3a — Documentos com responsável e histórico; atas em texto

- [x] Cada documento publicado mostra **quem aprovou (nome e cargo) e quando**; a versão substituída continua no site, ligada à que a substituiu (o histórico de versões na página do
  documento). A retirada (documento publicado por engano) continua tirando do site.
- [x] **Publicar uma ata no site em texto:** a partir da ata assinada, o sistema abre um documento público em TEXTO já com o texto da ata para a pessoa retirar o dado pessoal (o verificador
  aponta e bloqueia); só sai com a aprovação do Presidente ou do Secretário.

**O que foi feito:** a API pública de documentos passa a trazer `aprovado_por` (nome e cargo de quem aprovou, só se a pessoa tinha mandato vigente no dia da aprovação; nome apagado pela
anonimização não aparece) e `grupo_versao`; o site mostra "Aprovado para publicação por …, em …" em cada documento e guarda as versões anteriores sob "Versões anteriores", cada uma com a
sua página ("Esta é a versão 1, substituída pela versão 2"). Na tela da ata assinada, "Publicar no site (em texto)" abre um documento Público em TEXTO ligado à ata, já preenchido com o
texto da ata e o relato da secretaria (ou com o texto da última versão publicada); a ata nunca vai em PDF (todas as portas de PDF e de "usar o original" fecham para o tipo Ata, inclusive
pela edição e pela criação direta), a ata retificada não vai ao site e o verificador recusa o dado pessoal. Achado no caminho: baixar um original com acento no nome dava erro 500 (corrigido).
**Conferência independente (agente `opus`, só leitura), duas:** 12 achados na primeira (os altos: portas para o PDF da ata e o nome de quem não era da Diretoria no "aprovado por"),
2 na reconferência (a ata podia virar Pública pela edição; documento ligado a ata pela criação direta); todos corrigidos.
**Na homologação (22/10):** branch `v63a-documentos-e-atas`. O robô `v6.3a-01` achou dois defeitos DELE na primeira e na segunda rodada (escolhia uma ata de assembleia ainda em andamento,
e depois a homologação não tinha nenhuma ata assinada de assembleia realizada: o povoamento assinava a ata com a sessão aberta, também corrigido); com o robô montando a sua assembleia
pelas rotas de verdade, 2 de 2: a ata assinada abre o documento com o texto, sem opção de PDF, o CPF é recusado (mascarado), o Secretário aprova e o público vê quem aprovou; a correção
vira a versão 2 e a 1 continua publicada no mesmo grupo. Depois de publicar a homologação, `v6.3a-02` 1 de 1 (o site de teste mostra a ata em texto, quem aprovou e as versões);
regressões `v5.4g-02` 7/7, `v5.4d-05` 16/16, `v5.4g-05` 6/6 e `v5.4g-01` 5/5.
**Em produção (22/10):** `main` = `7902c1a` (código) e `38bef2c` (teste do site); Deploy API verde (1507 testes contra Postgres; sem migração) e Deploy Painel verde (`version.json` =
`7902c1a`); o `openapi.json` traz `/api/atas/{id_ata}/publicar-no-site` e a rota sem login responde 401. A publicação do site reprovou uma vez: um teste clicava no link do PDF e o
navegador sem janela do CI baixa o PDF em vez de abri-lo (localmente passou porque usei o Chromium completo; lição: rodar o e2e do site com o navegador do CI). Corrigido (confere o link e
o arquivo) e publicado: `asaf.org.br/version.json` = `38bef2c`. Em produção ainda não há documento publicado, então a linha "Aprovado para publicação por" aparece quando o primeiro for
aprovado. Nada de teste foi criado em produção.

##### v6.3b — As contas do exercício no site

- [x] Depois da deliberação de aprovação das contas do exercício, o sistema monta o resumo (receitas e despesas por grupo, resultado, parecer do Conselho Fiscal, data da aprovação em
  Assembleia) como documento público gerado do dado, sem digitação, e ele só sai com a confirmação do Presidente ou do Secretário; página das contas por exercício na Transparência.

**O que foi feito:** em Documentos, o bloco "Contas do exercício para o site" (permissão Documentos) monta o documento das contas (tipo Balanço, Público, em TEXTO, com os números
também em JSON para o site montar as tabelas): receitas e despesas por conta, totais, resultado, o parecer de cada conselheiro (o último de cada um até a deliberação, sem nome) e a
data da Assembleia. Só com a deliberação de aprovação de contas daquele ano numa ata assinada de assembleia REALIZADA DEPOIS do fim do exercício (ano parcial nunca vai a público), e
isso é conferido de novo ao enviar para revisão e ao aprovar (a deliberação pode ter sido revogada no meio). Os números são os dos lançamentos registrados ATÉ a Assembleia (nova coluna
`lancamentos_contabeis.registrado_em`, migração `e8a2c4f6b913`): um lançamento de competência retroativa registrado depois não muda o que foi aprovado, e o painel avisa quantos há.
O texto é o gerado (nada de texto colado, PDF, edição ou "Criar nova versão" pela biblioteca: a versão nova só pela tela de origem, com confirmação; a publicada continua no ar até a nova
ser aprovada); dado pessoal no parecer recusa a geração sem deixar rascunho e mostra o achado mascarado. A publicação segue o fluxo de sempre (aprovação de outra pessoa). No site,
`/transparencia/contas/` por exercício (tabelas acessíveis, parecer com data, quem aprovou, ligação ao texto), cartão na Transparência e link no rodapé. Achado no caminho e corrigido:
a ata imprimia a hora da convocação em UTC (3 horas a mais); como a ata agora vai ao site em texto, passou a sair a hora de Belém.
**Conferência independente (agente `opus`, só leitura), duas:** 11 achados na primeira (os altos: "Criar nova versão" tirava as contas do site e aceitava texto à mão; a recusa por dado
pessoal deixava rascunho órfão; os médios: números recalculados na hora em vez dos aprovados, só o último parecer, data da assinatura no lugar da Assembleia, botão "Abrir" que gerava
versão nova), 8 na reconferência (o mais sério: a data da Assembleia é gravada em UTC, e eu tinha suposto hora local; também a falta de nova conferência na aprovação e de exigir
Assembleia depois do fim do ano); todos corrigidos. 16 mutações das travas, 16 pegas pelos testes.
**Na homologação (22/10):** branch `v63b-contas-no-site` publicada (`Running upgrade d3f6b2c8e571 -> e8a2c4f6b913`). Robô `v6.3b-01` 1 de 1: o Tesoureiro registra uma receita de
competência de 2025, o Conselheiro dá o parecer, o Presidente registra a aprovação numa Assembleia realizada e assinada, o Secretário prepara pela tela (o documento é gerado, sem campo
de texto nem de arquivo, e sem "Criar nova versão"), o Presidente aprova e a API pública traz as contas de 2025 com a receita do robô e o mesmo resultado do texto. Depois de publicar a
homologação, `v6.3b-02` 1 de 1 (o site de teste mostra receitas, despesas e resultado iguais aos da API, os pareceres e a ligação ao texto; o cartão na Transparência). Regressões:
`v6.3a-01` 2/2, `v5.4d-05` 16/16 e `v5.4g-02` 7/7.
**Em produção (22/10):** `main` = `5318c62`; Deploy API verde (1521 testes contra Postgres; `Running upgrade d3f6b2c8e571 -> e8a2c4f6b913`), Deploy Painel e Deploy Site verdes
(`version.json` = `5318c62` nos dois); o `openapi.json` traz `/api/prestacoes-de-contas/{ano}/no-site` e `/publicar-no-site` (sem login: 401); `/api/publico/transparencia/contas`
responde `[]` e `asaf.org.br/transparencia/contas/` mostra "Nenhuma prestação de contas publicada ainda". Nada de teste foi criado em produção; as primeiras contas vão ao site quando a
Assembleia aprovar as de 2025 e o Presidente ou o Secretário confirmar.

##### v6.3c — Relatório anual de atividades

- [x] Os números do ano montados pelo sistema (projetos, eventos realizados com inscritos e presentes, beneficiários, horas de voluntariado, indicadores, as contas do exercício) mais a
  apresentação escrita pela secretaria; aprovação do Presidente ou do Secretário; página do relatório anual por ano na Transparência.

**O que foi feito:** em Documentos, o bloco "Relatório anual de atividades" (permissão Documentos) monta o relatório de um ano ENCERRADO em que o sistema já era usado (o
primeiro registro da Auditoria): um ano anterior ao sistema sairia com zeros que não correspondem à realidade e é recusado; no ano em que o sistema começou, o texto diz a partir de
quando os números contam. Os números, sem nome de ninguém: projetos PÚBLICOS do ano com a situação de hoje (o interno não aparece nem na contagem; suspenso não conta; concluído e
cancelado pelo fim previsto, porque o sistema não guarda a data real do fim), eventos PÚBLICOS que aconteceram (marcados como realizados ou com presença registrada) com inscrições
confirmadas e presenças (pessoas distintas, somando as sessões; a presença pela leitura na entrada ou pela marcação na inscrição), beneficiários ATENDIDOS no ano e atendimentos,
horas de voluntariado APROVADAS e quantos voluntários, associados com vínculo em 31/12, o último valor do ano dos indicadores ATIVOS dos projetos públicos e, se já publicadas, as
contas do exercício (v6.3b). Toda contagem de pessoas abaixo de 5 vira "menos de 5". A única parte escrita é a apresentação, no próprio documento: conferida pelo verificador de dado
pessoal (recusa mascarada), obrigatória para ir à revisão; quem a escreveu não aprova (nem a versão nova com o mesmo texto), e a Auditoria guarda quem escreveu e o SHA-256 do texto,
gravada ANTES do texto. O documento é gerado como as contas (sem texto colado, PDF ou versão nova pela biblioteca). No site, `/transparencia/relatorio-anual/` por ano (apresentação,
números, eventos, indicadores, contas, ligação ao texto), cartão na Transparência e link no rodapé.
**Conferência independente (agente `opus`, só leitura), duas:** na primeira, 1 alto (zeros falsos de ano anterior ao sistema), 4 médios (beneficiários acumulados em vez de
atendidos no ano, quem escreve aprovava o próprio texto, projetos e indicadores mal recortados) e baixos (presença marcada na inscrição não contava, evento que não aconteceu
contava, contagens pequenas por evento, textos do site, painel); na reconferência, nenhum alto, 1 médio (os robôs não provocavam as recusas) e baixos (Auditoria na mesma
transação, mensagem da apresentação, desempate do indicador, projeto sem fim previsto, aviso de "não salva"); todos corrigidos. 15 mutações das travas, 15 pegas.
**Na homologação (22/10):** como a homologação nasceu em 2026, um roteiro só-de-teste grava lá um início de uso fictício em 02/01/2025 (`scripts/hml_inicio_do_sistema.py`, passo
no `deploy-homologacao.yml`; recusa qualquer banco que não seja o de teste). Robô `v6.3c-01`, 1 de 1 (na 1ª rodada o robô achou defeito dele: a página mostra duas áreas de
conferência): o ano corrente e o anterior ao sistema (2024) são recusados na tela; o Secretário monta 2025; a apresentação com CPF é recusada mascarada; o Presidente escreve a boa;
o Secretário envia; o Presidente (que escreveu) não tem o botão de aprovar e a API recusa (403); a Auditoria tem a linha com o SHA-256; a Presidente do cargo aprova e a API pública
traz o relatório com a apresentação. Depois de publicar a homologação, `v6.3c-02` 1 de 1 (o site de teste mostra a apresentação, os números e liga ao texto; o cartão na Transparência).
**Em produção (23/10):** `main` = `c229176` (a v6.3c e as correções do Ponto juntas, mescladas depois de provadas na homologação); Deploy API verde (1534 testes contra Postgres; sem migração), Deploy Painel e Deploy Site verdes (`version.json` = `c229176` nos dois); o `openapi.json` traz `/api/relatorios-anuais/{ano}/no-site`, `/preparar` e `/apresentacao` (sem login: 401); `/api/publico/transparencia/relatorios-anuais` responde `[]` e `asaf.org.br/transparencia/relatorio-anual/` mostra "Nenhum relatório anual publicado ainda". Em produção o primeiro relatório possível é o de 2026, a partir de 01/01/2027 (o sistema começou a ser usado em 2026). Nada de teste foi criado em produção.

##### 🔍 Ponto de Revisão — FASE 6 (2/2 — fim, fecha v6.2–v6.3)

✅ **FECHADO em 2026-10-23, com o OK do Presidente** ("sim", depois de ler o resumo da revisão e decidir que balanço de anos anteriores fica de fora). A revisão e a correção dos achados
estão abaixo.

Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:

- Disparo em massa (v6.2) exige confirmação com contagem de destinatários antes de enviar — testar a confirmação, não só o envio.
- Opt-out (v6.2) é honrado em todos os canais simultaneamente, e comunicação estatutária obrigatória continua sendo entregue mesmo com opt-out de comunicação opcional.
- Portal de transparência (v6.3) publica dado gerado do sistema, nunca digitado à mão.

**Revisão feita em 2026-10-22 — aguardando o OK do Presidente para fechar** (o Ponto só fecha com o OK dele). Intervalo: `1332e7f..c229176` (v6.2a–d, a correção da senha provisória
e o "Esqueci a minha senha", v6.3a–c). A leitura de código e plano foi feita por um agente SEPARADO, só leitura (não ancorado na minha conclusão); o que depende de rodar coisas foi
feito por mim. Resultado do checklist da seção 4.1:
1. **`[x]` implementado e testado — OK, com 1 achado médio corrigido:** o plano dizia que "todas as portas de PDF fecham para a Ata", mas um documento de outro tipo, Público, com
   PDF, podia virar Ata depois e ir ao site em PDF. Agora virar Ata com PDF é recusado e o envio e a aprovação recusam qualquer Ata que não esteja em texto (teste). Duas contagens do
   plano corrigidas (v6.2d: 19 testes novos, não 21; correção da senha: 867 testes de navegador, não 870).
2. **Testes — OK:** servidor 1534 em duas rodadas seguidas (e no CI contra Postgres); painel 729; site 770 unitários e 918 de navegador (rodados com o navegador SEM JANELA do CI);
   na homologação, os robôs de cada versão e as regressões (ver os registros das v6.3a–c e o fim deste bloco). Uma falha intermitente vista hoje no servidor
   (`test_padroes_suspeitos_detecta_pagamento_apos_troca_de_dados_bancarios`, 1 em 4 rodadas completas, passa sozinha 6 de 6) é de código que o intervalo não tocou: fica registrada
   para investigar.
3. **Decisões congeladas — OK**, com 1 achado baixo corrigido: o `DECISOES_CONGELADAS.md` ainda tratava o provedor de e-mail como decisão em aberto; agora está fixado na tabela da
   seção 8 (SMTP da conta Google Workspace, asaf@asaf.org.br).
4. **Segredos — OK:** varredura das 14.742 linhas acrescentadas no intervalo (chave privada, AKIA, tokens do GitHub, `sk-`, `AccountKey=`, SAS, URL de banco com senha, JWT,
   atribuição de segredo longo): nenhum achado (só dois falsos positivos de configuração com a palavra "chave").
5. **Auditoria — OK**, com 2 achados baixos corrigidos: o pedido do código do "Esqueci a minha senha" passou a ficar na Auditoria (a conta, sem o e-mail nem o código: pedidos
   repetidos aparecem antes do teto) e a edição de opção de catálogo guarda os metadados no "antes".
6. **Permissão no servidor — OK** (comunicação pede `comunicar`; contas, relatório e ata para o site pedem `documentos`; a aprovação pede `aprovar_publicacao`; as rotas públicas de
   descadastro e de senha têm link assinado ou limite por IP).
7. **Escopo — OK**, com 2 anotações: a v15.6 ganhou a marca `[parcial]` (o "Esqueci a minha senha" já faz parte dela) e a v12.7 diz que a prestação de contas e o relatório anual
   já existem (v6.3b/c), para ninguém reconstruí-los.
8. **Plano × código — OK** depois das correções acima; os três itens-pai da v6.3 foram marcados como feitos pelas v6.3a/b/c.
9. **Suíte completa — OK** (item 2).
10. **Tela real — OK:** Novo aviso (pré-visualização, teste, agendar), Agendados, Modelos, relatório de leitura com e-mail e reenviar, "E-mails da ASAF" no Meu Perfil, descadastro no
    site, "Esqueci a minha senha", "Troque a sua senha", "Publicar no site (em texto)" na Ata, "Contas do exercício para o site" e "Relatório anual de atividades" em Documentos.
11. **O que a tela oferece para abrir foi aberto — OK:** os robôs abrem o documento publicado pelo link do site (contas, relatório anual e ata em texto), o aviso pelo sino e o
    relatório pela lista.
12. **No ar — OK:** ver o fim deste bloco.

**Específico deste ponto:**
- **Disparo em massa com contagem confirmada — tinha 2 lacunas (médio), corrigidas:** o "publicar já" e o "agendar" já exigiam o total conferido (testes do servidor e do painel;
  faltava o teste do 409 ao agendar, acrescentado). Mas (a) o aviso AGENDADO era publicado na hora com o grupo recalculado sem limite (conferido para 5, podia sair para 300): agora,
  se o grupo cresceu desde a conferência, ele NÃO sai, fica cancelado com o motivo e quem agendou é avisado no sino (quem saiu do grupo simplesmente não recebe); e (b) "Incluir quem
  entrou no grupo depois" incluía e mandava e-mail num clique: agora a tela mostra antes quantos entraram (e quantos recebem por e-mail) e o servidor só inclui com o total conferido.
- **Descadastro em todos os canais e obrigatórias entregues — OK nos testes, com 1 achado médio corrigido:** quem desligou recebe a Convocação e a Mudança de regra (sem link de sair) e
  não recebe as outras, também quando desliga depois de publicado; lembretes e avisos de evento respeitam a escolha; o sino e o mural recebem sempre (decisão do Presidente). O achado:
  o que era "obrigatório" vinha de uma marca no catálogo que quem tem `comunicar` edita; agora as obrigatórias são fixas no código (só Convocação e Mudança de regra), com teste de que
  mudar a marca no catálogo não muda nada.
- **Transparência só com dado do sistema — contas e relatório OK, com 2 achados médios corrigidos:** (a) a biblioteca deixava publicar um Balanço ou um Relatório anual montado à mão
  (por fora da aprovação em Assembleia e dos números do sistema): agora esses dois tipos só vão ao site gerados pelo sistema; (b) o texto sugerido da ata trazia a lista de presença
  com o nome e a hora de cada associado (o verificador não reconhece nomes): agora sai com a contagem, e quem aprova vê o texto da ata assinada para comparar (nenhuma deliberação pode
  mudar). As partes escritas que vão a público são exceções decididas pelo Presidente: o parecer do Conselho Fiscal (texto do próprio Conselho), a apresentação do relatório anual e o
  texto da ata, todos pelo verificador de dado pessoal e com a aprovação de outra pessoa.
- Baixo corrigido: quem escreveu a apresentação também não aprova a versão nova que leva o MESMO texto.

**Riscos que ficam registrados (aceitos, com o motivo):** os totais de inscrições e presenças do relatório anual permitem deduzir o número de um evento público pequeno (que aparece
como "menos de 5"): são eventos públicos, sem nome de ninguém; um projeto concluído com atraso ou antes do previsto pode cair no ano vizinho (o sistema não guarda a data real do fim).
**Decisão do Presidente (23/10/2026), sobre balanços de anos anteriores:** ficam de fora do site, sem exceção. Nas palavras dele: "não é bom mexer com anos anteriores"; a ASAF começa
"literalmente do ano zero": o saldo anterior entra no sistema como lançamento de abertura e, daí em diante, só vai ao site o que nasce no sistema (a regra "Balanço e Relatório anual só
gerados" fica como está).
**Testes das correções:** servidor 1534 em duas rodadas seguidas; painel 729; 10 mutações das correções, 10 pegas.
**Na homologação (22/10):** branch `ponto-fase6-2` (a v6.3c e as correções juntas). Robô `v6.3-ponto-01`, 1 de 1 (nas duas primeiras rodadas o robô achou defeitos dele: o endereço de
criar projeto e associados desligados que não contam no grupo; agora ele monta o grupo pela conferência do próprio sistema): o "Incluir quem entrou depois" mostra "1 pessoa entrou"
antes de incluir e o servidor recusa um total errado; um aviso é agendado para 2 pessoas e o grupo passa a 3; o Balanço digitado à mão é recusado no envio. Depois de publicar a
homologação com a hora já passada, `v6.3-ponto-02` 1 de 1: o agendado não saiu, aparece cancelado com "O grupo cresceu desde a conferência" e o aviso chegou ao sino de quem agendou.
Regressões verdes: `v6.3c-01/02`, `v6.3b-01/02`, `v5.4g-02` 7/7, `v6.3a-01` 2/2, `v6.1-01` 5/5 (o "Incluir" com a tela nova) e `v5.4d-05` 16/16.
**Rotina diária em produção:** a "Tarefa Diária (lembretes de mensalidade por e-mail)" rodou pela primeira vez em 22/10 (agendada para 12:00 UTC, o GitHub a disparou às 16:51 UTC):
verde, "enviados: 0, falhas: 0".
**No ar (23/10):** as correções estão em produção junto com a v6.3c (`c229176`, ver o registro da v6.3c): o `openapi.json` traz `/api/avisos/{id_aviso}/novos` (sem login: 401). (O Ponto foi fechado pelo Presidente em 23/10: ver o topo deste bloco.)

### FASE 7 — LGPD e proteção de dados (programa, não checklist)

> A ASAF trata dado de associado, de criança beneficiária, de voluntário e de doador. A LGPD aqui
> não é formalidade: é o que evita dano real a pessoas e responsabilização da diretoria. Esta fase
> vira um **programa de privacidade** com dono, inventário e prova — não um banner de cookies.

#### v7.0 — Governança de privacidade

- [ ] Encarregado (DPO) designado e publicado no site com canal de contato — exigência do Art. 41 **[parcial: v5.5a pôs o encarregado (o Presidente, decisão de 09/10) e o canal na Política; a v7.0a fez o ato formal, o substituto e o destaque em todas as páginas do site. Fecha quando o Presidente cadastrar o mandato (o nome aparece no site) e anexar o ato assinado]**
      da LGPD, frequentemente ignorada por associações.
- [x] **Inventário de dados (ROPA)** vivo **[v7.0c]**: para cada tipo de dado tratado — quem é o titular, qual
      a finalidade, qual a base legal, quanto tempo fica, com quem é compartilhado, onde está
      armazenado. Mantido como registro no próprio sistema, não como documento Word esquecido.
- [x] Classificação de dado por sensibilidade **[v7.0b]** (comum, pessoal sensível, dado de criança e
      adolescente) marcada **no modelo de dados**, para que controles técnicos (criptografia,
      auditoria de consulta, retenção) sejam aplicados por classificação, não caso a caso.
- [x] Avaliação de impacto (RIPD) obrigatória antes de ativar qualquer tratamento de alto risco —
      biometria (v20.3), prontuário de beneficiário (v4.2), perfilamento por score (v11.1) **[v7.0d; a aprovação real é ato do Presidente, quando o sistema estiver pronto]**.

> **A FASE 7 foi liberada pelo Presidente em 2026-10-23** ("comece já pela versão 7.0, governança de privacidade").
> **O que já existia (levantamento de 23/10):** a Política de Privacidade (versão 2.6) nomeia o Presidente como encarregado e dá o canal (o e-mail da Instituição e o formulário do
> titular); o nome só aparece quando o mandato vigente de Presidente está cadastrado (em produção, `/api/publico/diretoria` ainda devolve `[]`: o nome não aparece hoje). Não existe ato
> formal de designação, nem substituto, nem inventário, nem marca de sensibilidade nos dados (a única é a classificação Pública/Interna/Restrita dos documentos institucionais, por
> documento). O **prontuário de beneficiário** (v4.2, `RegistroAtendimento.relato`, texto livre que pode ter dado de saúde de criança) **já está ligado** sem relatório de impacto;
> biometria (v20.3) e score (v11.1) não existem.
> **O que a norma pede, conferido no texto oficial (Resolução CD/ANPD nº 18/2024, regulamento do encarregado):** art. 3º — a indicação do encarregado é feita por **ato formal**
> ("documento escrito, datado e assinado") do qual constem as formas de atuação e as atividades, apresentado à ANPD quando ela pedir; art. 4º — nas ausências, impedimentos e vacâncias, a
> função é exercida por **substituto formalmente designado**; art. 8º e 9º — identidade (no mínimo o **nome completo**) e contato divulgados e mantidos atualizados, "em local de destaque
> e de fácil acesso" no site; art. 15 e 16 — as atividades (receber reclamações dos titulares e comunicações da ANPD, orientar a equipe, assistir no registro das operações, no relatório de
> impacto e no registro de incidentes); art. 19, § 1º, II, e art. 20 e 21 — **conflito de interesse** quando o encarregado também toma as decisões estratégicas sobre o tratamento (é o
> caso do Presidente): o encarregado o declara e o controlador adota providência. A **Resolução CD/ANPD nº 2/2022** (agentes de pequeno porte, que inclui pessoa jurídica de direito privado
> sem fins lucrativos) dispensa a indicação do encarregado (art. 11; basta um canal com o titular, e a indicação voluntária "será considerada política de boas práticas e governança"),
> permite o **registro simplificado** das operações (art. 9º; a ANPD publicou um modelo em 2023: contato do agente, categorias de titulares, dados tratados, compartilhamento, medidas de
> segurança, período de armazenamento, finalidade e base legal, observações) e dá **prazo em dobro** para responder ao titular (art. 14), mas **não vale para tratamento de alto risco**
> (art. 3º e 4º: pelo menos um critério geral — larga escala ou afetar significativamente direitos — **e** um específico — tecnologia nova, vigilância, decisão só automatizada, **dado
> sensível ou de criança, adolescente ou idoso**). O substituto vem do Estatuto: o **1º Vice-Presidente** (art. 21, parágrafo único: os Vice-Presidentes substituem o Presidente em suas
> faltas e impedimentos), e na falta dele o 2º. Decisão do Presidente já registrada (2026-10-09): o encarregado é o Presidente; não se pergunta de novo.
> Em quatro partes, uma por vez (cada uma: branch → homologação → `main`):

##### v7.0a — O encarregado com ato formal, substituto e destaque no site

- [x] **Permissões** (módulo Privacidade no painel): `privacidade` (ver o encarregado, o substituto e os atos, abrir o PDF e baixar a cópia assinada) para quem tem `gerenciar_acesso`
      (a Presidência) e para os cargos Presidente e 1º e 2º Vice-Presidente; `privacidade_gerir` (gerar o ato e registrar a cópia assinada) **só** para a Presidência e o cargo de
      Presidente (privilégio mínimo, achado da conferência independente: o Vice-Presidente vê, mas não troca o ato que o Presidente assinou).
- [x] **Ato de designação gerado pelo sistema** (Resolução 18, art. 3º e 4º): os nomes do Presidente e do Vice-Presidente saem dos **mandatos vigentes**, contados pelo dia de Belém
      (sem o mandato de Presidente o sistema recusa e diz onde cadastrar); o texto traz a ASAF como controladora, o encarregado e o substituto pelo nome e cargo (o 1º Vice-Presidente; o
      2º na falta dele), os canais (e-mail da Instituição e o formulário do titular), as atividades do art. 15 (I a IV, como estão na Resolução) e as do art. 16, e o **conflito de
      interesse** declarado (art. 19, § 1º, II) com a **medida** do art. 21, parágrafo único, II: a reclamação de titular ou a comunicação da ANPD que questione decisão do próprio
      Presidente é encaminhada ao substituto, que a examina e responde. Sai em PDF para imprimir; o texto fica guardado como foi gerado (é a prova do que se assinou). **Anexar a cópia
      assinada** (PDF, JPG ou PNG, no armazenamento privado; quem e quando, com Auditoria) torna o ato vigente e o anterior fica "Substituído"; gerar outro descarta o que não foi assinado.
- [x] **Avisos no painel:** sem mandato de Presidente; sem ato assinado; ato aguardando assinatura; ato que nomeia outra pessoa (o mandato mudou); substituto diferente do Vice-Presidente
      de hoje; sem Vice-Presidente (com texto próprio quando o ato vigente nomeia alguém que saiu do cargo).
- [x] **Site:** o link "Encarregado de dados" no rodapé de **todas** as páginas leva à seção do encarregado na Política (`/privacidade/#encarregado`); a Política 2.7 diz que o Estatuto
      (art. 21, parágrafo único) atribui a substituição aos Vice-Presidentes e, com o mandato publicado, quem é o Vice-Presidente hoje. Ela **não** diz que o ato está assinado (depende
      do Presidente).
- [x] **Na homologação:** robô pelas telas (gerar o ato, abrir o PDF, registrar a assinatura, Auditoria; recusas: quem não tem `privacidade` não vê o módulo nem pelo endereço; o
      Vice-Presidente vê mas não gera; arquivo que não é PDF de verdade; segunda cópia num ato que já vale) e o site de teste com o link no rodapé e os nomes. O ato sem mandato de
      Presidente é recusado pela suíte (encerrar o mandato da Presidente de teste quebraria os outros roteiros).

✅ **v7.0a concluída (2026-10-23).**

**Conferência independente (agente, só leitura) achou 10 pontos e, na reconferência, mais 7; todos corrigidos antes de publicar:** (1) na tela, o arquivo escolhido para um ato podia ser
registrado como a assinatura do ato gerado depois (faltava a `key` do quadro; teste novo confirmado por mutação); (2) a cláusula de conflito de interesse admitia o conflito sem adotar a
providência que o art. 21 exige e citava uma "revisão anual" que ainda não existe; (3) o texto dizia que o **Estatuto** põe o 1º Vice-Presidente antes do 2º — o Estatuto não põe ordem
(é designação do ato); (4) os Vice-Presidentes podiam trocar o ato assinado do Presidente (permissão dividida); (5) dois cliques ao mesmo tempo davam erro 500 ou podiam deixar dois atos
aguardando ou vigentes (trava de linha e **índice único parcial** no banco: no máximo um aguardando e um vigente; o que escapar vira 409); (6) o ato prometia protocolo para o pedido que
chega por e-mail (só o do formulário vira protocolo); (7) os incisos do art. 15 estavam fora de ordem e parafraseados; (8) um aviso dizia "designa só pelo cargo" de um ato que nomeia
alguém; (9) pelo relógio UTC, das 21h às 24h de Belém, o mandato de amanhã já contava (o ato sairia datado antes do mandato que cita) — agora conta pelo dia de Belém, no início e no fim;
(10) a tela não relia a situação depois de uma recusa; e, na reconferência: a medida do conflito dependia de o Vice ver a fila do atendimento (agora o encarregado encaminha), a Política
afirmava uma designação que só o ato assinado cria (agora diz só o fato do Estatuto e quem é o Vice-Presidente), o arquivo gravado ficava órfão se a gravação falhasse, textos para quem só vê.
**Pipeline:** o fluxo `validar-postgres.yml` estava quebrado desde a v5.4a (o passo dos "7 índices" de 02/10 reaplicava migrações sobre tabelas já criadas); trocado por um passo que desce e
sobe a migração mais nova no Postgres com o `alembic check` limpo.
**Testes locais:** servidor 1551 em duas rodadas seguidas (17 testes novos do encarregado; as proteções do substituto, da permissão de gerir e do dia de Belém confirmadas por mutação) e
1551 contra Postgres 18 no `validar-postgres.yml` (a migração desceu e subiu duas vezes com o `alembic check` limpo); painel 736 (7 novos), tipos, lint e formatação limpos; site 923 de
navegador em duas rodadas com o código final (rodapé em quatro páginas, a seção do encarregado com o nome e o Vice-Presidente; o mock ganhou um 2º Vice-Presidente), estados vazios
(sem Diretoria publicada a Política mantém a seção e não inventa substituto), Instituição, sincronização e tamanho; a migração subiu, desceu e subiu num banco descartável com o
`alembic check` limpo.
**Na homologação (2026-10-23):** a branch `v70a-encarregado` foi publicada lá e a migração rodou no banco de TESTE (`Running upgrade e8a2c4f6b913 -> 56d7ae211884`). Robô `v7.0a-02` 1/1:
no site de teste o rodapé de três páginas leva à seção do encarregado, com o nome da Presidente de teste e do 1º Vice-Presidente que a API publica, e a Política 2.7. Robô `v7.0a-01` 4/4
(3ª rodada): o **Tesoureiro** não vê o módulo, o endereço dá "sem permissão" e o servidor responde 403 a ver, gerar e anexar; o **1º Vice-Presidente** (pelo cargo) vê a Presidente como
encarregada e ele mesmo como substituto, mas não tem gerar nem anexar e o servidor recusa gerar (403); a **Presidente do cargo** gera o Ato nº 3 (o nº 2, da rodada anterior, estava vigente e
o nº 1 tinha ficado descartado), lê o texto com os nomes, abre o PDF (200, `application/pdf`, começa com `%PDF-`), o arquivo com nome de
PDF que não é PDF é recusado, anexa a cópia assinada e o ato passa a vigente; baixa a cópia de volta (os mesmos bytes); o servidor recusa outra cópia num ato que já vale (409); o histórico
mostra Vigente, Substituído e Descartado; a **Auditoria**, lida pelo Presidente, tem a geração, a assinatura e o download, cada um com quem fez. As duas primeiras rodadas falharam por
defeito do roteiro (o corpo do PDF já consumido pelo painel não era legível para o robô; na 2ª, o número do ato lido do quadro antigo antes da troca), corrigidos e refeitos. Regressões
verdes: `v5.7c-02` 2/2 (a Diretoria e a Política no site de teste) e `v5.4c-fase0` 6/6.
**Em produção (2026-10-23):** `main` = `f0fcfd0`; Deploy API verde (1551 testes contra Postgres; `Running upgrade e8a2c4f6b913 -> 56d7ae211884`), Deploy Painel e Deploy Site verdes;
`painel.asaf.org.br/version.json` e `asaf.org.br/version.json` = `f0fcfd0`; o `openapi.json` traz as 4 rotas `/api/privacidade/encarregado...` e `GET /api/privacidade/encarregado` sem
login responde 401; `asaf.org.br/privacidade/` diz "Versão 2.7 · em vigor desde 23 de outubro de 2026", tem a seção `#encarregado` e a frase do Estatuto, sem nome de Vice-Presidente (a
produção ainda não tem mandato cadastrado); a página inicial tem o link "Encarregado de dados" no rodapé. Nenhum ato foi gerado em produção.
**O que depende do Presidente (atos dele, em produção):** (1) cadastrar o próprio mandato de Presidente e o do 1º Vice-Presidente em Governança > Mandatos — sem isso o site não mostra o
nome do encarregado (a Resolução 18, art. 9º, § 1º, pede o nome completo) e o ato não pode ser gerado; (2) em Privacidade > Encarregado, gerar o ato, ler o item 5 (a medida contra o
conflito de interesse), imprimir, assinar (ele e o 1º Vice-Presidente, ciente) e anexar a cópia assinada.
**Riscos aceitos (registro):** o encarregado acumula a Presidência (conflito de interesse do art. 19, § 1º, II, declarado no ato, com a medida do item 5; decisão do Presidente de
2026-10-09); a permissão pelo cargo segue o relógio UTC do resto do sistema (3 horas de diferença na troca de mandato), enquanto o encarregado mostrado conta pelo dia de Belém.

**Fora de escopo de propósito:** assinatura eletrônica (assina-se no papel, como as atas); enviar o ato à ANPD (só se apresenta quando ela pedir).

##### v7.0b — Classificação dos dados por sensibilidade, no próprio modelo

- [x] Cada coluna com dado de pessoa marcada **no modelo** (`Column.info["lgpd"]`, escrito a partir de um **mapa único**, `app/classificacao_de_dados.py`) como **pessoal**,
      **pessoal sensível** (LGPD art. 5º, II, e art. 11; com a ação de Auditoria que a LEITURA grava), pessoal de **texto livre que pode ter dado sensível**, ou pessoal do
      **andamento** (situação, datas, consentimento: visível na Auditoria, é a prova do que mudou); cada tabela com os **titulares** (das chaves estrangeiras e do mapa) e a marca
      **pode ter criança ou adolescente** (art. 14; explícita ou derivada, um nível, pela chave estrangeira). `inventario_do_modelo()` lê tudo do modelo (é a base da v7.0c).
      Sensíveis hoje: o prontuário do beneficiário, o encaminhamento à rede externa (posto de saúde, CRAS, Conselho Tutelar) e o motivo da mudança de situação (licença por saúde).
- [x] **Testes que travam o esquecimento:** coluna cujo nome indica dado de pessoa — inclusive os nomes de dado sensível (saúde, raça, religião, deficiência, alergia, biometria...)
      — sem classificação reprova; nas tabelas centrais de pessoa, nas que podem ter criança e nas que têm dado sensível, **toda** coluna tem de estar classificada (ali o nome não
      basta); nome citado no mapa que não existe mais no modelo reprova.
- [x] **Controles por classificação, não caso a caso:** (1) a Auditoria não grava o valor de coluna sensível nem o de coluna pessoal de tabela que pode ter criança (fica a chave, para
      se saber o que mudou; o andamento continua visível); (2) a anonimização do desligado cobre toda coluna pessoal da pessoa (o teste compara com a classificação) — passaram a
      ser apagados também as **habilidades** cadastradas e o **motivo e o documento de referência** das mudanças de situação; (3) toda coluna sensível declara a leitura auditada e o
      teste confere a rota de cada uma — a classificação mostrou que **a leitura dos encaminhamentos e do histórico de situação não era auditada** (agora é:
      `CONSULTA_ENCAMINHAMENTOS`, `CONSULTA_HISTORICO_SITUACAO`; o prontuário já era).

✅ **v7.0b concluída (2026-10-23).**

**Conferência independente (agente, só leitura) achou 12 pontos e, na reconferência, mais 4; todos corrigidos antes de publicar:** o motivo da licença ("Motivo: SAUDE") também ia para
a **linha do tempo** da pessoa, que a ficha 360 mostra sem auditar, e nem a anonimização o apagava (saiu do texto; a migração `6f679ca3b6bd` limpou as linhas já gravadas; a
anonimização apaga o motivo e o documento de referência); o desligamento gravava o motivo na Auditoria (o catálogo é editável); os **campos personalizados** de beneficiário (por
exemplo, a alergia de uma criança) iam com o valor para a Auditoria (agora só quais campos mudaram) e a **mesclagem** gravava o nome da pessoa absorvida; o detector de nomes não
reconhecia os nomes de dado sensível (`saude`, `raca`, `deficiencia`...) e a regra ficou mais forte (toda coluna das tabelas centrais, de criança e de dado sensível); tabelas que podem
ter criança não estavam marcadas (fotos de eventos e de etapas, presença, linha do tempo, inscrição, respostas da pesquisa) — a marca passou a ser derivada pela chave estrangeira;
colunas pessoais sem classificação (o texto do certificado emitido, a defesa e a decisão do processo disciplinar, o corpo da ata, o erro do envio de e-mail, que traz o endereço); a
Política dizia "quem tem ou já teve outro papel não é incluído" (o código só pula quem ainda tem outro papel ATIVO, e só na rotina automática) e não citava a linha do tempo entre o que
não tem prazo; e, na reconferência, colunas de andamento (o consentimento do responsável registrado, a situação da inscrição) que ficavam escondidas na Auditoria — justamente a prova.
**Testes locais:** servidor 1573 em duas rodadas seguidas (22 testes novos da classificação; a máscara da Auditoria, a leitura auditada dos encaminhamentos e as habilidades na anonimização
confirmadas por mutação) e 1573 contra Postgres 18 no `validar-postgres.yml` (a migração nova desceu e subiu duas vezes com o `alembic check` limpo); site 923 de navegador em duas
rodadas (Política 2.8), estados vazios, Instituição, sincronização e tamanho; painel sem mudança de tela nesta versão (só o roteiro do robô).
**Na homologação (2026-10-23):** a branch `v70b-classificacao` foi publicada lá e a migração rodou no banco de TESTE (`Running upgrade 56d7ae211884 -> 6f679ca3b6bd`). Robô `v7.0b-01`
2/2: o **Presidente** cadastra uma associada pela tela, abre a aba Situação e registra uma licença por motivo de **Saúde** — o histórico mostra "Licença — Saúde"; a Auditoria tem a
licença registrada **sem** o motivo e a leitura do histórico de situação com quem leu (também na tela da Auditoria); um encaminhamento ao **posto de saúde**: quem é da equipe lê, a
Auditoria guarda o registro com a rede escondida ("[omitido: dado pessoal sensível]") e a leitura da lista com quem leu. Regressões verdes: `v7.0a-01` 4/4, `v5.4f-01` 22/22 (projetos,
beneficiários, prontuário e encaminhamento pelas telas) e `v5.4c-fase1` 24/24 (cadastro, situação, família, mesclagem) — na 1ª rodada deste o teste da mesclagem falhou por um motivo
alheio à versão (a tela de Qualidade da base mostrou primeiro os itens que rodadas antigas do robô deixaram na fila; a busca tinha achado os novos) e passou na 2ª: intermitente, registrado.
**Em produção (2026-10-23):** `main` = `4e8217d`; Deploy API verde (a suíte contra Postgres e `Running upgrade 56d7ae211884 -> 6f679ca3b6bd`) e Deploy Site verde (o painel não mudou e segue em `f0fcfd0`); `asaf.org.br/version.json` = `4e8217d`; `asaf.org.br/privacidade/` diz "Versão 2.8 · em vigor desde 23 de outubro de 2026" e lista as habilidades e, nas mudanças de situação, o motivo e o documento de referência entre o que a anonimização apaga; as rotas de leitura agora auditadas respondem 401 sem login. Nenhum dado foi criado em produção.
**Riscos aceitos (registro):** o associado pode ter 16 ou 17 anos (Estatuto, art. 12) e é adolescente (LGPD, art. 14): o inventário diz isso, mas a máscara da Auditoria **não** se
liga no cadastro de associado (o que muda na ficha de um associado é prestação de contas da gestão); a marca derivada de criança esconde na Auditoria também o dado de adultos nas
tabelas marcadas (a presença, a linha do tempo, a inscrição); a leitura do histórico de situação grava uma linha na Auditoria a cada vez que a aba é aberta, mesmo sem motivo sensível.

**Fora de escopo de propósito:** criptografia por coluna (FASE 15, v15.x); mascarar CPF nas telas (v7.3).

##### v7.0c — Inventário de dados (registro das operações de tratamento) vivo no sistema

- [x] Cada **atividade de tratamento** (15, em `app/services/inventario.py`) com as seções do modelo simplificado da ANPD: o controlador e o encarregado no cabeçalho;
      titulares, dados pessoais, sensíveis e de criança (lidos do modelo, da classificação da v7.0b); finalidade; base legal (as hipóteses dos arts. 7º e 11 com o texto da
      Lei nº 13.709/2018 conferido no Planalto, como **proposta do sistema até o encarregado marcar que conferiu**; o art. 14 aparece como **requisito** — melhor interesse,
      Enunciado CD/ANPD nº 1/2023 —, não como base); com quem é compartilhado (Microsoft Azure, GitHub, Google Workspace: o que cada um faz e onde); onde fica guardado
      (Brasil, região Brazil South, com uma cópia das cópias de segurança e uma réplica dos arquivos privados na região par **South Central US, nos Estados Unidos** —
      conferido na documentação da Microsoft; o site publicado por serviço registrado na Central US); medidas de segurança; e o **prazo de guarda lido da regra de
      retenção em vigor** (ou "sem rotina automática de eliminação ainda", dito com todas as letras). O Directus (editor do site) entra como atividade própria, com os
      dados que ficam fora do modelo deste sistema.
- [x] **Vivo de verdade:** as tabelas de cada atividade vêm da classificação, e a suíte reprova tabela com dado pessoal que nenhuma atividade cobre (a tela também mostra, se
      acontecer); outros testes conferem com o código **quais rotinas do GitHub** rodam (os fluxos `tarefa-*.yml`) e **quais módulos mandam e-mail** — a atividade tocada
      tem de citar o GitHub ou o Google. O que é fato (tabelas, dados, operadores, onde, prazo) vem do código; o que é decisão (finalidade, base legal, medidas,
      observações e "base legal conferida") o encarregado ajusta: cada gravação é uma **versão nova** (guarda o ajuste e o texto inteiro que valia), com o histórico,
      a Auditoria e a conferência da versão de partida (quem salva sobre uma versão velha recebe "recarregue"); a conferência da base legal vale só para as bases
      conferidas. Ver: `privacidade`; ajustar: `privacidade_gerir` (só o Presidente).
- [x] **Exportar** o inventário em planilha (CSV que abre no Excel, protegida contra fórmula) e em PDF, para apresentar à ANPD quando pedido (com Auditoria).

**Fora de escopo de propósito:** consentimento e retenção por finalidade (v7.1); contratos com operadores (v7.3) — aqui só o registro de com quem se compartilha.

✅ **v7.0c concluída (2026-10-23).**

**Conferência independente (agente, só leitura) achou 25 pontos em três rodadas; todos corrigidos antes de publicar.** Os mais sérios: o texto das medidas de segurança dizia
"banco sem acesso público" (há firewall com lista de permissões, mas o banco é alcançável) e iria para a ANPD; faltava o GitHub onde ele age (a limpeza diária do visitante, a
montagem do site com fotos e nomes, a rotina mensal dos fornecedores, as migrações) e o Directus, que guarda nome, e-mail e IP de quem edita; o art. 14 aparecia como base
legal; as respostas por e-mail e a doação "sem dado pessoal" estavam ditas além do que o código faz; a versão "congelava" a proposta do sistema (agora guarda só o
ajuste); duas pessoas salvando ao mesmo tempo davam erro 500 e uma tela aberta podia apagar a versão de outra pessoa sem aviso; a planilha executava texto começando por
"="; o histórico mostrava as versões antigas misturadas com a proposta de hoje; o cabeçalho podia juntar um nome a um ato que nomeia outra pessoa.
**Política 2.9:** o inventário mostrou que a Política não nomeava os prestadores nem dizia que parte do tratamento acontece fora do Brasil: o parágrafo novo diz isso (o
mecanismo da transferência internacional, LGPD art. 33, fica para a v7.3).
**Pipeline:** os portões pegaram mais dois (o teste "toda rota tem tela" não reconhecia o endereço montado na tela; o parágrafo novo da Política tinha o e-mail fixo em vez do da
Instituição) — corrigidos.
**Testes locais:** servidor 1593 em duas rodadas seguidas (testes novos do inventário; a conferência presa às bases, os nomes do ato no cabeçalho e a versão de partida da tela
confirmados por mutação) e 1593 contra Postgres 18 (`validar-postgres.yml`, a migração desce e sobe com o `alembic check` limpo); painel 740 em duas rodadas, tipos, lint e
formatação limpos; site 924 de navegador em duas rodadas, estados vazios, Instituição, sincronização e tamanho.
**Na homologação (2026-10-23):** a branch `v70c-inventario` foi publicada e a migração rodou no banco de TESTE (`Running upgrade 6f679ca3b6bd -> 30a03a70ba56`). Robô
`v7.0c-01` 3/3: a **Presidente do cargo** abre Privacidade > Inventário de dados; o atendimento social a beneficiários mostra "Dado sensível", "Pode ter criança ou
adolescente" e "Sem rotina automática de eliminação ainda"; o cadastro mostra o prazo do associado desligado e as cópias nos Estados Unidos; "O que falta" conta as bases
ainda como proposta; nos Fornecedores, tirar todas as bases é recusado, e a finalidade nova com a base conferida vira versão nova, com o histórico; a planilha baixa com as
seções e o PDF abre; o **1º Vice-Presidente** vê, não tem "Ajustar" e o servidor recusa (403); a **Auditoria** tem o ajuste e as exportações, com quem fez. Regressões verdes:
`v7.0a-01` 4/4, `v7.0b-01` 2/2 e `v7.0a-02` 1/1 (este falhou por fixar a versão 2.7 da Política; o robô passou a conferir a versão em vigor). O GitHub devolveu erro 500 ao
disparar dois robôs uma vez (falha do GitHub; disparados de novo).
**Em produção (2026-10-23):** `main` = `d8fabe9`; Deploy API verde (a suíte contra Postgres e `Running upgrade 6f679ca3b6bd -> 30a03a70ba56`), Deploy Painel e Deploy Site verdes; `painel.asaf.org.br/version.json` e `asaf.org.br/version.json` = `d8fabe9`; o `openapi.json` traz as 5 rotas do inventário e `GET /api/privacidade/inventario` sem login responde 401; `asaf.org.br/privacidade/` diz "Versão 2.9 · em vigor desde 23 de outubro de 2026" e que parte do tratamento acontece fora do Brasil. Nenhum ajuste foi feito no inventário de produção (a base legal fica como proposta até o encarregado conferir, quando o sistema estiver pronto).

##### v7.0d — Relatório de impacto (RIPD) obrigatório antes do alto risco

- [x] Lista de **tratamentos de alto risco** no código (prontuário de beneficiário — já ligado; biometria — v20.3; score de engajamento — v11.1) e o **relatório de impacto** de cada um no
      painel: descrição, necessidade e proporcionalidade, riscos aos titulares, medidas, parecer do encarregado e aprovação, com versões.
- [x] **Portão no servidor:** sem relatório aprovado o tratamento não roda (gravar no prontuário passa a ser recusado com o motivo); o sistema já traz o rascunho do relatório do prontuário
      montado a partir do inventário para o Presidente revisar e aprovar. A v11.1 e a v20.3 chamam o mesmo portão.
- [x] **Na produção:** o prontuário fica travado até o Presidente aprovar o relatório (ato dele no painel); o painel avisa isso na tela do prontuário.

**Fora de escopo de propósito:** enviar o relatório à ANPD (só quando ela pedir, LGPD art. 38).

✅ **v7.0d concluída (2026-10-23).**

**O que foi feito:** `app/services/relatorio_de_impacto.py` lista os 3 tratamentos de alto risco (o atendimento social — prontuário e encaminhamentos de beneficiários —, ligado;
a biometria, v20.3, e a pontuação de engajamento, v11.1, como "ainda não existe no sistema"). O relatório tem 7 seções (descrição, dados, metodologia, necessidade e
proporcionalidade, riscos, medidas, parecer do encarregado), cada gravação numa **versão** (Rascunho → Aprovado; a aprovada anterior, ou a suspensa, vira Substituído), com a
Auditoria. O sistema monta a **proposta** do rascunho a partir do inventário (v7.0c) e do que o código faz (cada afirmação conferida com o código, por teste); o parecer fica em
branco, para o encarregado. **O portão no servidor:** sem relatório aprovado, gravar relato no prontuário e registrar encaminhamento são recusados (409, com o motivo); a leitura do
que já existe continua (auditada); um rascunho novo não fecha o que está aprovado; **suspender** (com o motivo) fecha os novos registros até aprovar de novo. Ver:
`privacidade`; escrever, aprovar e suspender: `privacidade_gerir` (o Presidente). A tela do prontuário pergunta "está liberado?" (`/api/relatorios-de-impacto/{codigo}/liberado`,
qualquer pessoa logada, sem dado) e avisa quando está fechado. O PDF mostra o texto que vale (aprovado; senão o suspenso com a data e o motivo; senão o rascunho).
**Conferência independente (agente, só leitura) achou defeitos reais; todos corrigidos antes de publicar.** Os mais sérios: o rascunho afirmava coisas que o código não faz (relato
"curto", consentimento "registrado" — o campo existe mas não é exigido —, ninguém de fora da equipe lê — quem tem a permissão Projetos pode se pôr na equipe, o que fica na
Auditoria); revisar um relatório aprovado partia da proposta do sistema, não do texto aprovado; aprovar com o formulário aberto aprovava o texto velho; duas pessoas
salvando ao mesmo tempo: a segunda apagava a primeira sem aviso (agora recebe "recarregue", e salvar e aprovar travam a linha); depois de aprovar ou suspender, a tela do
prontuário mostrava o estado velho; o PDF de um relatório suspenso mostrava o rascunho.
**Testes locais:** servidor 1601 em duas rodadas seguidas e 1601 contra Postgres 18 (`validar-postgres.yml`, a migração `13948ce981ad` desce e sobe com o `alembic check` limpo);
painel 745 em duas rodadas, tipos, lint e formatação limpos.
**Na homologação (2026-10-23):** a branch `v70d-relatorio-de-impacto` foi publicada lá (`c65b60d`) e a migração rodou no banco de TESTE. Robô `v7.0d-01` 3/3: o **1º
Vice-Presidente** vê Privacidade > Relatório de impacto, sem os botões de escrever, aprovar e suspender, e o servidor recusa (403); a **Presidente do cargo** suspende o
atendimento social com o motivo ("Novos registros fechados"), a biometria aparece como "Ainda não existe no sistema (v20.3)"; num projeto onde ela é da equipe, a tela do
prontuário avisa que está fechado e não oferece o registro, e o servidor recusa gravar (409, "relatório de impacto"); ela escreve o rascunho, aprovar sem o parecer do
encarregado é recusado, com o parecer aprova ("Liberado"), o PDF abre e o prontuário grava de novo; a **Auditoria** tem a suspensão, o rascunho e a aprovação desta rodada,
feitos por ela. Regressões verdes: `v5.4f` 54/54 (projetos e beneficiários), `v7.0a` 5/5, `v7.0b` 2/2, `v7.0c` 3/3. (O primeiro disparo da publicação saiu da branch em vez da
`main` e o Azure recusou o login; disparado de novo pela `main` com `ref` = a branch.)
**Em produção (2026-10-23):** `main` = `c65b60d`; Deploy API verde (1601 contra Postgres e `Running upgrade 30a03a70ba56 -> 13948ce981ad`) e Deploy Painel verde;
`painel.asaf.org.br/version.json` = `c65b60d`; o `openapi.json` traz as 6 rotas do relatório de impacto, e `GET /api/privacidade/relatorios-de-impacto` e `GET
/api/relatorios-de-impacto/ATENDIMENTO_SOCIAL/liberado` sem login respondem 401. **Na produção não há relatório aprovado:** gravar no prontuário e registrar encaminhamento ficam
fechados até o Presidente revisar o rascunho, escrever o parecer e aprovar (Privacidade > Relatório de impacto) — ato dele, para quando o sistema estiver pronto (decisão de 23/10).

#### v7.1 — Base legal, consentimento e retenção

- [x] **[v7.0c (a base de cada atividade no inventário) e v7.1a (aviso onde a base não é o consentimento; consentimento só para foto e atendimento social)]**
      Base legal explícita por finalidade: execução do vínculo associativo (não precisa de
      consentimento para cobrar mensalidade), obrigação legal (contabilidade), e consentimento
      apenas onde é de fato necessário (foto, comunicação de marketing, biometria). Pedir
      consentimento para tudo é erro comum e enfraquece o consentimento onde ele importa.
- [x] **[v7.1a–c; a versão gravada é a da data da assinatura e os textos têm trava no banco desde o Ponto de Revisão (1/3)]**
      `Consentimento` versionado (titular, finalidade, versão do texto, data, meio, IP, revogação)
      — prova de quando e a quê a pessoa consentiu, com o texto exato daquela época.
- [x] **[v7.1b (termo de imagem) e v7.1c (atendimento social: o responsável com nome e vínculo; aos 18 anos, o termo da própria pessoa)]**
      Dado de criança e adolescente (Art. 14): consentimento específico de ao menos um dos pais ou
      responsável, com registro do vínculo — relevante direto para projetos assistenciais e
      educacionais da FASE 4/14.
- [x] **[v5.7b (7 regras), v6.1 (a 8ª), v7.1b (a prova dos consentimentos) e v7.1d (inscrições e presenças, participante externo, voluntário, certificado e
      Auditoria: 14 regras)]** Política de retenção por tipo de dado, implementada como **rotina real** de anonimização/
      descarte (participante externo de evento: X meses; candidato a voluntário não aprovado: Y
      meses; associado desligado: prazo legal/contábil), com relatório do que foi descartado.
      Retenção que só existe no papel não é retenção.
- [x] **[v7.1d: nenhuma linha de inscrição, presença, hora, certificado ou Auditoria é apagada; sai a pessoa]**
      Anonimização preserva estatística (o evento continua sabendo que teve 300 presentes) sem
      preservar identificação — apagar linha inteira destruiria o histórico institucional.

> **Levantamento de 27/10 (o que já existia):** cada formulário do site que recebe dado pessoal (inscrição em evento, filiação, contato, pedido de informação, solicitação do
> titular, voluntariado, doação, conta de visitante) guardava só o NÚMERO da versão do aviso aceito; o texto ficava no código do site e mudava sem rastro no sistema. A
> inscrição em evento pedia "consentimento" ("autorizo o uso dos meus dados", texto editável em Regras do sistema), embora a base seja o próprio pedido de inscrição
> (art. 7º, V). O aviso da filiação dizia que o pedido recusado "fica guardado", mas desde a v5.7b ele é apagado 2 anos depois. Consentimento de verdade (foto, dado
> sensível) existe só como uma marca (foto: "autorização confirmada" + termo anexo opcional; beneficiário: `consentimento_lgpd_registrado`, sem exigir). Prazos que faltam
> (tabela de temporalidade de 15/10): inscrições e presenças 5 anos, voluntário 5 anos depois do fim, certificado 10 anos, Auditoria 10 anos.
> Em quatro partes, uma por vez (cada uma: branch → homologação → `main`):

##### v7.1a — Os avisos de privacidade com versão e a base legal de cada formulário

- [x] **Catálogo dos textos** (`app/textos_de_privacidade.py`): cada formulário (ponto de coleta) com a base legal, a atividade do inventário, se é AVISO ou CONSENTIMENTO e
      TODAS as versões com o texto exato (as antigas reconstituídas do histórico do código do site), o que a caixa dizia e se era consentimento naquela versão. A tabela
      `textos_de_privacidade` grava cada versão ao subir e nunca a reescreve; a suíte prende a impressão (SHA-256) de cada versão publicada: mudar um texto exige versão nova.
- [x] **Consentimento só onde ele é a base:** a inscrição em evento passa a mostrar um AVISO (versão 2, art. 7º, V), com o que o sistema faz de fato (inscrição em grupo,
      cadastro de participantes, e-mails, presença, certificado, pesquisa de satisfação, IP na Auditoria), e a caixa "Li o aviso de privacidade."; o texto deixa de ser
      configuração editável (texto editável sem versão quebrava a prova do que a pessoa leu). Filiação versão 3: o prazo de guarda que a rotina aplica. Política 2.10.
- [x] **Reabrir o aviso que a pessoa leu:** "Ler o aviso desta versão" na fila de atendimento e nas propostas de filiação mostra o texto da versão aceita, não o de
      hoje (pedido do Ponto de Revisão FASE 7, 1/3); Privacidade > Avisos de privacidade mostra cada formulário, a base e as versões. O site mostra os avisos a partir do
      mesmo catálogo (arquivo gerado, conferido pela suíte).

✅ **v7.1a concluída (2026-10-27).**

**Conferência independente (agente, só leitura) conferiu palavra por palavra as versões antigas contra o histórico do site (todas certas) e achou 10 pontos; corrigidos
antes de publicar.** Os mais sérios: a Política ainda chamava a inscrição de "consentimento" e dava à doação a base "consentimento" (Política 2.10: pedido de inscrição e de
doação, art. 7º, V, e a escrituração, art. 7º, II; o inventário tirou o consentimento da doação); a migração podia gravar um texto editado com o mesmo número da versão 2
nova (agora ela PARA antes de criar qualquer coisa, com a mensagem do que fazer); o aviso novo da inscrição não dizia da inscrição em grupo (dados de outras pessoas,
inclusive crianças), do cadastro de participantes, da pesquisa de satisfação nem do IP na Auditoria; a filiação 3 dizia o prazo como fixo (é configurável: "hoje, 2 anos");
pedidos de Minha conta de antes da v5.7f eram ligados ao aviso errado; cada versão passou a guardar o tipo e a caixa que a pessoa viu (a 1 da inscrição era
consentimento, "Li e aceito."); as duas configurações antigas só saem quando a API nova sobe (a antiga ainda as lê durante a publicação); fins de linha; link com barra
invertida; duas réplicas subindo juntas.
**Testes locais:** servidor 1612 em três rodadas (a última sobre a árvore final, já com a correção da fila) e 1612 contra Postgres 18 (a migração `5b2d7e9c41f0` desce e
sobe); painel 747 em duas rodadas, tipos, lint e formatação limpos; site 778 de unidade e 924 de navegador em duas rodadas, estados vazios, Instituição e sincronização.
**Na homologação (2026-10-27):** a branch `v71a-textos-de-privacidade` foi publicada e a migração rodou no banco de TESTE (`Running upgrade 13948ce981ad -> 5b2d7e9c41f0`).
Robô `v7.1a-01` 4/4: a **Presidente do cargo** vê Privacidade > Avisos de privacidade (a inscrição como aviso, art. 7º, V; a versão 1 com o "autorizo"; a filiação 2 com
"ficam guardados" e a 3 com o prazo); o **site de teste** mostra o aviso da filiação versão 3 com o link da Política e a caixa "Li o aviso de privacidade.", o do voluntariado
e o da conta de visitante; um pedido de filiação feito pelo site chega ao painel com a versão 3 e "Ler o aviso desta versão" mostra o texto dela; o aviso antigo (versão 2)
reaberto traz o texto daquela época; o **Tesoureiro** lê um aviso, mas não a lista (403). Regressões verdes: `v5.4h-10` 5, `v5.5a-01` 6, `v5.5b-01` 4, `v5.6a-02` 3,
`v5.7f-02` 4, `v7.0c` 3, `v7.0a` 5, `v5.5c-01` 1 + `v5.5c-02` 7 (o 02 depende do 01 e de publicar de novo; o robô passou a comparar o aviso sem depender da quebra entre
parágrafos) e `v5.6b` 10 (o 02 esperava 7 prazos na Política, mas a v6.1 tinha posto o 8º: defeito antigo do robô, corrigido).
**Em produção (2026-10-27):** `main` = `a76b980`; Deploy API verde (1612 contra Postgres e `Running upgrade 13948ce981ad -> 5b2d7e9c41f0`), Deploy Painel e Deploy Site
verdes; `painel.asaf.org.br/version.json` e `asaf.org.br/version.json` = `a76b980`; `GET /api/publico/eventos/consentimento-lgpd` responde a versão 2, a caixa "Li o aviso
de privacidade." e os parágrafos; as duas rotas novas sem login respondem 401; `asaf.org.br/privacidade/` diz "Versão 2.10 · em vigor desde 27 de outubro de 2026" e
`asaf.org.br/seja-associado/` mostra o "Aviso de privacidade (versão 3)".

##### v7.1b — Consentimento versionado onde ele é a base (foto)

- [x] `Consentimento` (titular, finalidade, versão do texto, data, meio, IP, quem registrou, revogação) para a foto da Diretoria e as fotos de evento e de parceria; revogar
      tira a foto do site e do armazenamento.

✅ **v7.1b concluída (2026-10-27).**

**O que foi feito:** os TERMOS de autorização de uso de imagem entraram no catálogo dos textos (`app/textos_de_privacidade.py`): o da Diretoria e o das atividades (eventos,
projetos e parcerias), cada um com versão; a versão 1 de cada é a DECLARAÇÃO que quem enviava a foto marcava no painel (antes não havia termo do sistema), reconstituída do
código. O painel mostra o termo em vigor e gera o PDF para imprimir e assinar. Cada foto agora só entra com quem assinou, como (termo em papel guardado pela secretaria, ou
digitalizado na biblioteca de Documentos, com o número), a **data da assinatura** e a versão do termo; o servidor recusa a versão velha ("recarregue") e nada fica pela
metade. A tabela `consentimentos` guarda a prova (migração `7c4e1a9d2b63`, que registrou as fotos já existentes como "declaração antiga"); apagar a foto ENCERRA o
consentimento — revogado (a pessoa retirou a autorização, com o motivo, que vai no corpo do pedido e não no endereço), apagado (foto errada, trocada, etapa apagada) ou fim
do prazo (o mandato da Diretoria acabou e o sistema apagou a foto sozinho). A prova encerrada fica 5 anos e depois a rotina de retenção a apaga (regra nova
`PRAZO_RETENCAO_CONSENTIMENTOS_DIAS`). Privacidade > Consentimentos lista tudo com busca pelo nome de quem assinou (quem revoga a autorização de atividade tem de ter TODAS as
fotos em que aparece apagadas) e páginas; quem só lê a parceria não vê o nome de quem assinou. Inventário: atividade nova "Prova dos consentimentos e das revogações"; a
Transparência ganhou a base do consentimento (fotos de parceria). **Política 2.11:** o parágrafo das fotos das atividades (que faltava), o do registro dos consentimentos, o
prazo da prova e a revogação pela secretaria ou pela solicitação do titular.
**Conferência independente (agente, só leitura) achou 17 pontos; todos corrigidos antes de publicar** (o termo é o que a pessoa assina): revogar valia só para uma foto
(o termo diz "as fotos em que eu apareço"); o motivo da revogação ia no endereço e cairia no registro de acesso do servidor; a data gravada era a do envio, não a da
assinatura; o art. 14, § 1º citado também para adolescente (agora: criança — um dos pais ou o responsável; adolescente — assina junto, em parágrafo próprio); a Política
não falava das fotos de atividade nem do registro; a prova ficava para sempre; a cópia de segurança de 30 dias, o "na hora" e o mandato "vigente ou marcado" no termo; quem
apagou a etapa; o nome para quem só lê; paginação; o apagar com "revogado" já marcado; duas trocas da mesma foto ao mesmo tempo (500).
**Testes locais:** servidor 1623 em três rodadas e 1623 contra Postgres 18 (a migração desce e sobe); painel 750 em duas rodadas, tipos, lint e formatação limpos; site 778 de
unidade e 924 de navegador em duas rodadas, estados vazios, Instituição e sincronização.
**Na homologação (2026-10-27):** a branch `v71b-consentimento-de-foto` (`33c6503`) foi publicada e a migração rodou no banco de TESTE (`Running upgrade 5b2d7e9c41f0 ->
7c4e1a9d2b63`). Robô `v7.1b-01` 3/3: o **Presidente** abre um evento e envia uma foto com o termo em vigor (o PDF abre; sem quem autorizou e com a versão velha do termo é
recusado), a foto aparece com "Autorizado por … · termo versão 2"; apaga dizendo que a pessoa retirou a autorização, com o motivo, e Privacidade > Consentimentos mostra o
consentimento **revogado**, com o motivo, e reabre o termo assinado; o **Tesoureiro** lê o termo, mas não a lista (403). Regressões verdes com o formulário novo:
`v5.4g-03` 8 (parcerias), `v5.4g-04` 9 (fotos do evento), `v5.7c-01` 4 (foto da Diretoria), `v5.7d-01` 3 (apagar de verdade), `v7.1a` 4, `v7.0c` 3.
**Em produção (2026-10-27):** `main` = `33c6503`; Deploy API verde (1623 contra Postgres e `Running upgrade 5b2d7e9c41f0 -> 7c4e1a9d2b63`), Deploy Painel e Deploy Site
verdes; `painel.asaf.org.br/version.json` e `asaf.org.br/version.json` = `33c6503`; o `openapi.json` traz as 3 rotas novas e, sem login, a lista e o termo respondem 401;
`asaf.org.br/privacidade/` diz "Versão 2.11 · em vigor desde 27 de outubro de 2026" e tem o parágrafo do registro dos consentimentos. Nenhuma foto foi enviada na produção
(fotos reais com termo assinado são para quando o sistema estiver pronto, decisão de 23/10).

##### v7.1c — Criança e adolescente: o consentimento de um dos pais ou do responsável

- [x] No beneficiário, o consentimento do responsável (com o vínculo registrado) passa a ser exigido para registrar atendimento (fecha o risco que o relatório de impacto
      da v7.0d aponta).
- [x] O voluntário adolescente e a filiação de 16 a 17 anos **ficam fora, com o motivo**: ali a base legal não é o consentimento (é o pedido da própria pessoa e o
      termo de adesão, LGPD art. 7º, V), e a autorização dos pais é ato da vida civil, não consentimento da LGPD: a filiação de 16 a 17 anos já exige a
      declaração da autorização (Estatuto, Art. 12; `app/services/filiacao_publica.py`) e o pedido de voluntariado guarda o nascimento para a secretaria
      colher a autorização no termo de adesão (`app/models/atendimento.py`). O art. 14, § 1º (um dos pais consente) é da criança, e nem filiação nem
      voluntariado aceitam criança.

✅ **v7.1c concluída (2026-10-28).**

**O que foi feito:** o atendimento social (prontuário e encaminhamentos à rede) passou a exigir o **termo de consentimento assinado**, registrado no sistema
com a versão: o termo novo "Consentimento para o atendimento social" entrou no catálogo (versão 2; a versão 1 é a marca antiga "Consentimento LGPD registrado",
reconstituída), com o PDF para imprimir e assinar. Na tela **Beneficiários**, cada pessoa tem o bloco **Consentimento**: quem consentiu (a própria pessoa ou um
dos pais / o responsável, com o nome e o vínculo), como o termo foi entregue, a data da assinatura; registrar de novo **substitui** o vigente; **revogar** pede
confirmação e fecha os registros novos (o que já existe fica, só para a equipe). A idade vale **na data da assinatura** e o nascimento passou a ser obrigatório
para registrar: quem tinha menos de 18 anos só consente por um dos pais ou o responsável legal; o adulto, por si (ou pelo responsável legal, se há curatela);
corrigir o nascimento para menor encerra o consentimento dado sozinho ("invalidado"). O prontuário no projeto avisa antes ("sem consentimento") e o servidor
recusa (409). A marca antiga virou prova (migração `9d1b6c3e5f27`, "declaração antiga"), mas **não abre** o prontuário. Privacidade > Consentimentos acha também
pelo nome do responsável e mostra quem consentiu pela criança. Inventário e relatório de impacto atualizados. **Política 2.12:** o parágrafo do atendimento
social, o registro dos consentimentos cobrindo as pessoas atendidas e o prazo da prova.
**Conferência independente (agente, só leitura) achou 9 defeitos e 6 suspeitas; todos tratados antes de publicar:** criança sem nascimento "consentia sozinha";
a idade era a de hoje, não a da assinatura; a marca antiga abria o prontuário sem termo nem responsável; o termo, a Política e a tela prometiam apagar o que
já foi registrado, o que o sistema ainda não faz (agora dizem que a eliminação se **pede** pela solicitação do titular; a ferramenta entra na v7.1d); rótulos de
foto ("a foto foi apagada") no consentimento do beneficiário; a tela não se atualizava depois de registrar; a busca não achava o responsável; a Política e o
inventário falavam só de foto; mensagens de "imagem"; corrida que reescrevia a prova da revogação (agora a linha é travada); adulto consentido pela "mãe";
"assim que o pedido é registrado" (agora: a retirada registrada no sistema); o campo "Projeto" do termo; a anotação da marca antiga sumida; o aviso antigo
dizendo que a pessoa marcou a caixa que a equipe marcava (vale também para as fotos da v7.1b).
**Testes locais:** servidor 1635 em duas rodadas (e 1629 antes da revisão) e 1635 contra Postgres 18 (a migração desce e sobe); painel 758 em duas rodadas, tipos,
lint e formatação limpos; site 778 de unidade e 924 de navegador, estados vazios. A validação em Postgres achou um defeito da v7.1b: o povoamento da
homologação mandava a data da assinatura pelo dia UTC (depois das 21h de Belém já é "amanhã" e o servidor recusa) — corrigido com o fuso do sistema, e o
robô `v5.7d-01` também.
**Na homologação (2026-10-28):** a branch `v71c-consentimento-do-responsavel` foi publicada e a migração rodou no banco de TESTE (`Running upgrade 7c4e1a9d2b63 ->
9d1b6c3e5f27`). Robô `v7.1c-01` 3/3: o **Presidente** monta um projeto com uma **criança** de 10 anos; o prontuário avisa "sem consentimento" e não abre; no
bloco Consentimento a própria criança não pode consentir, sem o nome e sem o vínculo do responsável é recusado, com a **mãe** entra ("dado por … (Mãe)", termo
versão 2) e o prontuário grava; a rota recusa a própria criança (400) e o PDF abre; Privacidade > Consentimentos mostra quem consentiu pela criança e reabre
o termo; a mãe revoga (com confirmação e motivo): o prontuário avisa, o atendimento já feito continua e a rota recusa o novo (409); a Auditoria guarda o
registro e a revogação. O robô pegou um defeito real: digitar a busca e abrir o bloco antes de a busca responder desmontava o bloco e perdia o que estava sendo
preenchido (agora a lista anterior fica enquanto a nova carrega). Regressões verdes: `v5.4f-01` 22 (o cadastro pelo projeto sem a marca, o prontuário fechado
sem o termo e aberto com ele, registrar e revogar na tela Beneficiários), `v7.0d-01` 3, `v7.0b-01` 2, `v5.4h-05` 3, `v7.1b-01` 3, `v7.1a-01` 4, `v7.0c-01` 3,
`v5.7d-01` e `v5.7d-02` (o `v5.7d-01` registrava sempre o mesmo mandato antigo e a 4ª rodada encheu as 3 vagas do cargo naquele período: agora cada rodada usa
um dia só dela).
**Em produção (2026-10-28):** `main` = `fda51f3`; Deploy API verde (1635 contra Postgres e `Running upgrade 7c4e1a9d2b63 -> 9d1b6c3e5f27`), Deploy Painel e Deploy Site
verdes; `painel.asaf.org.br/version.json` e `asaf.org.br/version.json` = `fda51f3`; o `openapi.json` traz as 2 rotas novas e, sem login, registrar o consentimento
e o termo da tela respondem 401; `asaf.org.br/privacidade/` diz "Versão 2.12 · em vigor desde 27 de outubro de 2026" e tem o parágrafo do atendimento social e o
registro dos consentimentos cobrindo as pessoas atendidas. Nenhum consentimento foi registrado na produção (pessoas e termos reais são para quando o sistema
estiver pronto, decisão de 23/10).

##### v7.1d — Os prazos que faltam, com anonimização que preserva a estatística

- [x] Inscrições e presenças (5 anos), voluntário (5 anos depois do fim), certificado (10 anos: a verificação pública continua dizendo "válido", sem o nome) e Auditoria
      (10 anos), anonimizando a pessoa e mantendo as contagens.
- [x] A eliminação do prontuário a pedido (v7.1c): quem revogou o consentimento do atendimento social e pede a eliminação pela solicitação do titular tem o
      que já foi registrado apagado ou anonimizado (por vínculo), com a Auditoria; hoje o termo e a Política só dizem que se pode **pedir**.
- [x] **Feito em 2026-10-28, com a autorização do Presidente (conferido por leitura: `az role assignment list` mostra "Storage Blob Data Contributor" em
      `fotos-diretoria`, `fotos-associados` e `documentos-emitidos`):** dar à identidade da rotina do GitHub (`asaf-github-actions`, objectId `f026eaf3-…`) o papel
      "Storage Blob Data Contributor" **só** no contêiner `documentos-emitidos` da produção (`stasafprivado`), como já tem em `fotos-diretoria` e `fotos-associados`.
      Sem ele, a regra do certificado não consegue apagar o PDF e fica vermelha **quando houver o primeiro certificado com 10 anos** (ou antes, se o prazo for
      reduzido); hoje não há nenhum, então nada falha. O sistema de segurança do Claude Code bloqueou a concessão (2026-10-28): só com o OK expresso dele.

✅ **v7.1d concluída (2026-10-28).**

**O que foi feito:** os prazos que faltavam da Tabela de temporalidade entraram na rotina de guarda (`app/services/retencao_participacao.py`), sempre **anonimizando a
pessoa e mantendo as contagens** (nenhuma linha de inscrição, presença, hora, certificado ou Auditoria é apagada): **inscrição e presença** (5 anos depois do evento,
contado pela última sessão: saem as respostas, o e-mail, o QR, o código do cancelamento e o comentário da pesquisa de todo inscrito); **quem só se inscreveu em evento**
(5 anos depois do último evento: o papel acaba e, sem outro vínculo — associado, beneficiário, funcionário, familiar/dependente, papel ativo ou inscrição que ainda não
venceu —, o nome, o CPF e o contato saem; vale também para quem se inscreveu pelo CPF sem ganhar o papel); **voluntário** (5 anos depois do fim do último termo: saem as
referências e o texto livre, o papel acaba — antes ele ficava ativo para sempre e travava a anonimização do associado desligado que tinha sido voluntário); **certificado
e crachá** (10 anos: o arquivo sai do armazenamento, que é pasta pública, e o nome sai; a verificação pública continua dizendo que é válido e passou a mostrar o nome
IMPRESSO, não o do cadastro de hoje); **Auditoria** (10 anos, com piso de 5: saem quem fez, o IP e os valores; a trava do banco contra apagar continua). Cinco regras
novas em Configurações. **Eliminação do prontuário a pedido** (bloco Consentimento, só para o encarregado — `privacidade_gerir`): com o consentimento retirado e o
protocolo de uma solicitação do titular **desta pessoa** (ou do responsável registrado), com a identidade validada e não encerrada; apaga os relatos e as descrições,
ficam datas e tipos; Auditoria `PRONTUARIO_ELIMINADO`. A tela Documentos emitidos diz "PDF apagado pelo prazo de guarda". Inventário e relatório de impacto
atualizados. **Política 2.13:** cinco prazos novos (a lista tem 14), a Auditoria e o IP deixam de dizer "sem prazo", a eliminação do atendimento social a pedido.
Também o **lote 15** (`@hookform/resolvers` 6.0.2, `lucide-react` 1.63.0, `react-router` 8.5.1, `pytest` 9.2.0; o site já estava todo em dia).
**Conferência independente (agente, só leitura) achou 4 defeitos e 6 suspeitas; tratados antes de publicar:** a anonimização apagava quem tinha inscrição futura
(pelo CPF, sem o papel) e familiares/dependentes; o comentário da pesquisa de quem foi inscrito pelo painel nunca saía; a entrada antiga de teste da Auditoria mudaria o
início do relatório anual da homologação; a regra do certificado pegava qualquer documento do evento; o protocolo de outra pessoa (ou já encerrado) destravava a
eliminação; o fim do evento ignorava as sessões; quem se inscreveu sem o papel nunca vencia; o piso da Auditoria. A suspeita da permissão do armazenamento se
confirmou por leitura (item pendente acima).
**Testes locais:** servidor 1657 em duas rodadas (17 testes novos) e 1657 contra Postgres 18; painel 759, tipos, lint e formatação; site 778 de unidade e 924 de
navegador, estados vazios.
**Na homologação (2026-10-28):** a publicação de teste passou a **semear dado antigo inventado** antes da rotina (só no banco e no armazenamento de TESTE:
`scripts/hml_dados_antigos_da_retencao.py`, passo novo no fluxo) e a rotina agiu de verdade, em Postgres e no armazenamento da Azure (inscrições 2, voluntário 1,
participante 1, certificado 1 — o PDF saiu do armazenamento —, Auditoria 1). Robô `v7.1d-01` 2/2: o evento de 6 anos continua com a inscrição e a presença, com a
pessoa "removida"; o voluntário ficou com as horas, sem o texto; o certificado de 11 anos é válido sem o nome e a tela diz que o PDF foi apagado; a Auditoria antiga
ficou sem quem e sem IP; as 5 regras estão em Configurações; e o **encarregado elimina o prontuário pela tela** com o protocolo de uma solicitação do titular enviada
pelo site e validada: o relato some e o atendimento continua contado. Regressões verdes: `v7.1c-01` 3, `v5.4f-03` 16 (certificado e check-in), `v5.6b-02` 4,
`v6.3c-01` 1 e `v6.3c-02` 1, `v7.0c-01` 3, `v5.7b-01` 2 e `v5.7b-02` 2 (este robô exigia que a rotina não aplicasse nada e contava 7 prazos na Política: agora confere
que o dado recente fica intacto e que só as regras do dado antigo semeado agiram, e os 14 prazos).
**Em produção (2026-10-28):** `main` = `977d299` (código) e `819da56` (fluxo do painel); Deploy API verde (1657 contra Postgres; sem migração: as 5 regras
novas nascem pelas configurações do sistema) e Deploy Site verde; o Deploy Painel falhou só pela formatação de um robô (`format:check`) e o disparo manual pulava a
publicação: o robô foi formatado e o fluxo do painel passou a publicar também no disparo manual na `main`. `painel.asaf.org.br/version.json` = `819da56` e
`asaf.org.br/version.json` = `977d299`; o `openapi.json` traz a rota de eliminação do prontuário, que sem login responde 401; a verificação de certificado com código
inexistente responde 404; `asaf.org.br/privacidade/` diz "Versão 2.13 · em vigor desde 28 de outubro de 2026", com os prazos do certificado e da Auditoria ("Este prazo não
fica abaixo de 5 anos"). Nenhum dado foi criado na produção; a rotina de guarda de produção não tem hoje nada com 5 ou 10 anos.

##### 🔍 Ponto de Revisão — FASE 7 (1/3, fecha v7.0–v7.1)

✅ **FECHADO em 2026-10-28, com o OK do Presidente** ("ok", depois de ler o resumo da revisão; o papel de dados do certificado foi concedido antes, com a autorização
dele). Fica registrada a única pendência, que depende de ato dele e não de código: o NOME do encarregado e o ato assinado entram com o cadastro real da Diretoria.

Antes de seguir adiante: aplicar o checklist padrão da seção 4.1 e conferir especificamente:

- Encarregado (DPO) está de fato nomeado e publicado, não só planejado.
- Consentimento (v7.1) é versionado com o texto exato da época — testar que reabrir um consentimento antigo mostra o texto que valia então, não o atual.

**Revisão feita em 2026-10-28** (o Ponto só fecha com o OK do Presidente: dado no mesmo dia). Intervalo: `921a7dd^..04ffd4e` (v7.0a–d, v7.1a–d, lotes
11–15 e as correções desta revisão). A leitura de código e plano foi feita por um agente SEPARADO, só leitura (não ancorado na minha conclusão); o que depende de rodar
coisas foi feito por mim. Resultado do checklist da seção 4.1:
1. **`[x]` implementado e testado — OK** (as contagens dos blocos ✅ batem com o código: rotas, testes e as 14 regras da rotina de guarda).
2. **Testes — OK:** servidor 1664 em duas rodadas e 1664 contra Postgres 18 (a migração nova desce e sobe); painel 760; site 778 de unidade e 924 de navegador, estados
   vazios; na homologação, os robôs da v7.1 e as regressões (fim deste bloco). A validação em Postgres achou que a trava nova recusa com outra classe de erro lá (o teste
   passou a aceitar as duas).
3. **Decisões congeladas — OK**, com 1 achado baixo corrigido: o `DECISOES_CONGELADAS.md` ainda dizia `python:3.12-slim` (está em 3.15 desde o lote 12, autorizado).
4. **Segredos — OK:** varredura das 15.674 linhas acrescentadas no intervalo (chave privada, AKIA, tokens do GitHub, `sk-`, `AccountKey=`, SAS, URL de banco com senha, JWT,
   atribuição de segredo longo): nenhum achado.
5. **Auditoria — OK**, com 2 achados baixos corrigidos: a leitura da lista de consentimentos (nomes de crianças atendidas e dos responsáveis) passou a gravar
   `CONSULTA_CONSENTIMENTOS` (os filtros e o total; a busca, que é um nome, não); a correção do nascimento que invalida o consentimento aparece no UPDATE do beneficiário.
6. **Permissão no servidor — OK** (`privacidade` para ver, `privacidade_gerir` para gerar, ajustar, aprovar, suspender e eliminar o prontuário, `projetos` para o
   consentimento do beneficiário; os 403 têm teste).
7. **Escopo — OK**, com 2 anotações: a v7.2 ganhou a marca `[parcial]` (a revogação e a eliminação do prontuário a pedido já existem) e a v7.3 ganhou o item da
   transferência internacional (art. 33), que a v7.0c tinha prometido sem item.
8. **Plano × código — OK** depois das correções: os itens-pai da v7.1 foram marcados `[x]` com as versões que os fizeram (o da retenção com a ressalva do contêiner
   do certificado); o inventário passou a dizer que a prova dos consentimentos tem também beneficiários e responsáveis como titulares.
9. **Suíte completa — OK** (item 2).
10. **Tela real — OK:** Privacidade > Encarregado, Inventário, Relatório de impacto, Avisos e Consentimentos; o termo no envio de foto (eventos, parcerias, Diretoria); o
    bloco Consentimento do beneficiário (registrar, revogar, eliminar o prontuário); o aviso no prontuário; "Ler o aviso desta versão" no atendimento, na filiação e,
    desde esta revisão, na inscrição do evento e no pedido de doação; "PDF apagado" em Documentos emitidos; os prazos em Configurações.
11. **O que a tela oferece para abrir foi aberto — OK:** os robôs abrem o PDF do termo e o do ato, o aviso de cada versão e o certificado pela verificação pública.
12. **No ar — OK:** `main` = `04ffd4e`; Deploy API (1664 contra Postgres e `Running upgrade 9d1b6c3e5f27 -> a3c5e7f9b1d2`), Deploy Painel e Deploy Site verdes;
    `painel.asaf.org.br/version.json` e `asaf.org.br/version.json` = `04ffd4e`; `asaf.org.br/privacidade/` diz "Versão 2.14 · em vigor desde 28 de outubro de 2026".

**Específico deste ponto:**
- **Encarregado nomeado e publicado — PENDENTE de ato do Presidente, não de código.** O sistema gera o ato com os nomes dos mandatos, imprime, recebe a cópia
  assinada e publica; o site já diz, em todas as páginas, que o encarregado é o Presidente da ASAF, com o e-mail e o formulário do titular. **Falta o NOME**
  (Resolução CD/ANPD 18/2024, art. 9º), que aparece sozinho quando o mandato do Presidente estiver cadastrado, e o ato assinado. Pela decisão de 23/10 (cadastro
  real só com o sistema pronto), fica como **risco aceito** até lá; o item da v7.0 continua `[ ]` e é o primeiro passo do cadastro real.
- **Consentimento com o texto exato da época — OK, com 2 achados médios corrigidos:** o mecanismo (textos com impressão SHA-256 gravados por versão, lidos do banco,
  nunca reescritos) já tinha teste; a revisão achou que (a) a versão gravada podia não ser a assinada: agora a data da assinatura tem de caber na vigência da versão
  (um termo não é assinado antes de existir nem depois de outro o substituir) e (b) a prova do consentimento do atendimento social seria apagada em 5 anos enquanto o
  prontuário ficava: agora ela fica enquanto houver relato ou encaminhamento. Também: **trava no banco** contra alterar ou apagar um texto gravado (migração
  `a3c5e7f9b1d2`, também no Postgres) e **aos 18 anos** o consentimento dado pelo responsável deixa de abrir o atendimento (a própria pessoa assina; o da curatela de
  um adulto continua) — risco que o agente apontou. **Prova pela tela:** robô `v7.1-ponto-01` 1/1 na homologação (Privacidade > Consentimentos > um consentimento da
  versão 1 > "Ler o aviso desta versão" mostra o texto da versão 1, "hoje vale a versão 2" e que quem marcava a caixa era a equipe; o da versão 2 mostra o termo
  assinado). **Política 2.14.**
- **Robôs na homologação (branch `ponto-fase7-revisao-1`, migração `a3c5e7f9b1d2` aplicada no banco de teste):** `v7.1-ponto-01` 1, `v7.1c-01` 3, `v7.1d-01` 2,
  `v7.1a-01` 4, `v7.1b-01` 3, `v5.4f-01` 22, `v5.4f-03` 16 (pegou que o aviso novo na linha do inscrito entrava antes da situação: virou um bloco próprio), `v5.6a-01` 5,
  `v5.6a-02` 3, `v7.0c-01` 3.
- **Pendência de infraestrutura resolvida (2026-10-28):** o papel de dados da identidade do GitHub no contêiner `documentos-emitidos` (item da v7.1d) foi dado com a
  autorização do Presidente e conferido por leitura; a regra do certificado consegue apagar o PDF quando o prazo chegar.

#### v7.2 — Direitos do titular, operacionalizados

> **Levantamento de 2026-10-28** (agente só leitura, depois do Ponto 1/3). **Já existe:** a fila da solicitação do titular (subtipos do art. 18, prazo de 15 dias,
> responsável = Presidente, identidade validada antes de responder — v5.5a/v5.7f), a resposta em texto lida na Minha conta, a conta de visitante (o que a pessoa fez
> pelo site e o pedido de eliminação), a revogação do consentimento (v7.1b/c) e a eliminação do prontuário a pedido (v7.1d). **Falta:** (1) nenhuma busca reúne os dados
> de UMA pessoa em todas as tabelas (a equipe responderia de memória); (2) nenhum arquivo legível por máquina para a portabilidade; (3) a eliminação a pedido de
> associado, participante, doador ou voluntário (só existe a do prontuário e as da rotina, presas ao prazo); (4) o associado logado não tem como pedir pelo painel;
> (5) o resultado de cada pedido não é registrado de forma contável (só texto livre) e não há relatório; (6) não há subtipos "consequência de não consentir" e
> "oposição"; a regra do prazo não tem teto. **Partes propostas:** v7.2a fila completa (subtipos que faltam, resultado com fundamento escolhido de lista, teto de 15
> dias, atalhos do pedido para a ficha, o prontuário e os consentimentos); v7.2b relatório dos dados de uma pessoa (guiado pela classificação de dados e pelo
> inventário: o dado, a finalidade, a base legal, com quem é compartilhado e o prazo; leitura de dado sensível na Auditoria); v7.2c entrega ao titular (PDF legível +
> arquivo para a portabilidade, pela Minha conta, com validade curta); v7.2d eliminação a pedido (mostra antes o que sai e o que fica, com o fundamento de cada
> retido); v7.2e pedido pelo painel (Meu Perfil); v7.2f relatório de atendimento das solicitações; v7.2g textos (Política e avisos). **Decisões pedidas ao Presidente
> em 28/10** (com a minha recomendação): quem gera o relatório, formato e canal de entrega, o que entra, como a eliminação é decidida, bloqueio, lista do que é
> retido por lei (inclusive as atas), associado ativo que pede eliminação, prazo, pedido feito por responsável, pedido sobre o próprio Presidente, escopo da
> portabilidade e destino do relatório de atendimento.
>
> **Decisões do Presidente (2026-10-28, "aprovo" às 12 recomendações):** (1) o relatório dos dados de uma pessoa só pelo encarregado (`privacidade_gerir`); (2) PDF
> legível + arquivo para a portabilidade, pela Minha conta, válidos 15 dias (em mãos, o encarregado imprime); (3) entra todo dado pessoal dela, inclusive anotações
> da equipe e histórico, sem a Auditoria; (4) eliminação a pedido sempre decidida pelo encarregado, vendo antes o que sai e o que fica e por quê; (5) sem bloqueio;
> (6) nunca apagado por lei: financeiro e recibos, atas e votações, livro de associados (nome e matrícula), prova dos consentimentos pelo prazo dela; (7) associado
> ativo: explicar que os dados servem ao vínculo; desligado: anonimização na hora, a pedido; (8) 15 dias para tudo, contados do pedido, confirmação simples na hora,
> regra do prazo com teto de 15; (9) pai ou mãe pede pelo filho menor, com o documento do vínculo conferido e registrado; (10) pedido sobre o próprio Presidente:
> responde o 1º Vice-Presidente; (11) portabilidade: o que a pessoa forneceu + o que é dela no financeiro; (12) relatório de atendimento: tela para a Diretoria +
> resumo no relatório anual.

> **Levantamento da v7.2d (2026-10-29, agente só leitura) e decisões pedidas ao Presidente** (com a minha recomendação). Já existe: a anonimização do associado
> desligado (pela rotina, depois do prazo), a da pessoa sem vínculo (participante, voluntário encerrado), a eliminação do prontuário a pedido (v7.1d) e o pedido de
> eliminação pela Minha conta (que hoje só entra na fila; ninguém apaga nada automaticamente). Nenhuma linha de pessoa pode ser apagada (35 chaves apontam para o
> associado): tudo é anonimizado campo a campo. O que as decisões de 28/10 ainda não dizem: (A) pedido feito pela Minha conta (identidade só pelo código do e-mail):
> elimina só o que foi feito com aquele e-mail, nunca o cadastro; (B) quem ainda tem outro vínculo vivo (voluntário com termo vigente, atendido em projeto,
> funcionário, membro com mandato): o cadastro fica enquanto durar o vínculo, explicando qual, e sai o resto; (C) inscrições e presenças em eventos que já
> passaram: a pessoa é anonimizada e as contagens ficam (como na rotina de 5 anos), e o certificado emitido perde o arquivo e o nome; (D) pedidos antigos pelo site:
> texto e contatos apagados; o próprio pedido de eliminação fica como prova até a rotina de 5 anos; (E) intenção de doação sem recibo: contatos apagados (a doação
> confirmada e o recibo ficam); (F) a conta de acesso ao painel de quem foi desligado perde o e-mail; a foto da Diretoria de quem não tem mais mandato e os
> documentos anexados ao cadastro são apagados; (G) a execução em dois passos — prévia do que sai e do que fica, com o fundamento de cada coisa que fica, a marca
> "conferi" e o botão — com o protocolo na Auditoria; a resposta à pessoa continua escrita pelo encarregado, já com o resultado e o fundamento sugeridos.
>
> **Decisões do Presidente (2026-10-29, "aprovo" às recomendações A a G, depois de explicadas em linguagem simples).**

✅ **v7.2a concluída (2026-10-28) — a fila do titular completa.** O formulário do site ganhou os dois direitos que faltavam (saber a consequência de não
consentir; oposição) e o rótulo da eliminação deixou de oferecer "bloqueio" (decisão 5). O prazo da solicitação do titular não passa de 15 dias, mesmo que a
regra seja mudada (a regra diz isso). Ao responder, a equipe registra o **resultado** (atendido, em parte, não atendido) e, se não atendido por inteiro, o
**fundamento** escolhido de uma lista (escrituração financeira, atas e votações, livro de associados, prova do consentimento, vínculo ativo, identidade não
confirmada, outro), que a pessoa lê na Minha conta junto da resposta; encerrar sem resposta fica registrado como tal (migração `b0227d30a6a9`). Ao validar a
identidade, marca-se o pedido feito por um dos pais ou pelo responsável (decisão 9). A **confirmação simples sai na hora** quando a identidade já nasce validada
(decisão 8), num e-mail só, como qualquer pedido, e fica na Auditoria como resposta do sistema. O pedido sobre os dados do **próprio Presidente** fica com o 1º
Vice-Presidente que tem acesso à fila (o 2º na falta), e **ninguém atende pedido sobre os próprios dados** (decisão 10). O pedido no painel tem atalhos para a
ficha do associado, o beneficiário e os consentimentos da pessoa (só para quem pode abrir). **Política 2.15.**
**Conferência independente (agente, só leitura) achou 12 defeitos e 4 suspeitas; tratados antes de publicar:** o resultado era exigido antes da identidade (o
robô da v5.7f quebraria); a confirmação na hora não ia para a Auditoria, mandava dois e-mails contraditórios e — pelo tempo do envio — deixaria descobrir se
alguém é associado; o duplo clique abria outro protocolo; o pedido sobre o Presidente podia cair em quem não atende (ou voltar a ele) e ele ainda podia assumi-lo;
o atalho do beneficiário não filtrava; o rótulo "o motivo foi dito à pessoa" era falso em pedidos antigos; o teto do prazo era silencioso; a Auditoria não guardava
o responsável nem o resultado do encerramento; duas citações de lei (atas e livro de associados) trocadas pelo Estatuto; a Política não falava da oposição nem do
resultado guardado.
**Testes locais:** servidor 1673 em duas rodadas e 1673 contra Postgres 18; painel 761; site 778 de unidade e 924 de navegador, estados vazios.
**Na homologação (2026-10-28):** migração aplicada no banco de TESTE (`Running upgrade a3c5e7f9b1d2 -> b0227d30a6a9`). Robô `v7.2a-01` 3/3: o site mostra os dois
direitos novos; a associada pede a confirmação e ela sai na hora ("Sim…"), com o resultado e o atalho para a ficha na tela; a mãe pede a eliminação pelo filho: a
equipe valida marcando o responsável, o painel exige o resultado e o fundamento, o cartão mostra os dois, a Auditoria guarda, e a Minha conta da mãe mostra o
resultado e o fundamento. Regressões verdes: `v5.7f-01` 5, `v5.5a-01` 6, `v5.5a-02` 7, `v5.6b-01` 6, `v5.6b-02` 4.
**Em produção (2026-10-28):** `main` = `e6bda58`; Deploy API (1673 contra Postgres e `Running upgrade a3c5e7f9b1d2 -> b0227d30a6a9`), Deploy Painel e Deploy Site
verdes; `painel.asaf.org.br/version.json` e `asaf.org.br/version.json` = `e6bda58`; `asaf.org.br/privacidade/` diz "Versão 2.15" e lista a oposição; o formulário
`asaf.org.br/privacidade/solicitacao-do-titular/` tem os dois direitos novos. Nenhum pedido foi feito na produção.

✅ **v7.2b concluída (2026-10-29) — o relatório dos dados de uma pessoa.** Em Privacidade > **Dados de uma pessoa**, o encarregado busca pelo nome, CPF ou
e-mail e gera, tabela por tabela, tudo o que o sistema guarda sobre a pessoa (cadastro, associado, beneficiário, prontuário, consentimentos, inscrições, doações,
pedidos, campos personalizados…), cada parte com a atividade do inventário: para que serve, a base legal (marcada "proposta" enquanto o encarregado não conferir),
com quem é compartilhado e por quanto tempo (decisões 1 e 3). Ficam de fora a Auditoria e os segredos (senha, segundo passo, códigos); o dado de outra pessoa só
entra pelo que é da titular — cada ligação entre tabelas e a pessoa está numa lista revisada e testada. Tabela com mais de 500 registros avisa que foi cortada. Só
quem tem `privacidade_gerir` gera — ou quem responde a solicitação dela (o 1º Vice, no pedido sobre o Presidente), pelo atalho do próprio pedido; cada leitura
fica na Auditoria (`CONSULTA_RELATORIO_DO_TITULAR`, sem os valores, com as tabelas que têm dado sensível). Até a v7.2c, o encarregado imprime. Sem migração.
**Conferência independente (agente, só leitura) achou defeitos reais, tratados antes de publicar** — o mais grave: o hash da senha e o segredo do segundo passo
de quem usa o painel apareceriam no relatório; também ligações que traziam dado de outra pessoa (conselheiro, sócio proponente, substituto de turno) e tabelas
onde a pessoa estava só pelo e-mail ou pelo CPF.
**Testes locais:** servidor 1683 em duas rodadas e 1683 contra Postgres 18; painel 763.
**Na homologação (2026-10-28):** robô `v7.2b-01` 2/2: o Presidente monta uma beneficiária inventada (termo e atendimento), gera o relatório pela tela e vê o
cadastro, o consentimento e o prontuário com o relato, cada um com para que serve, base legal e compartilhamento; a Auditoria não aparece; a leitura fica na
Auditoria sem o nome; o Tesoureiro recebe 403. Regressões verdes: `v7.2a-01` 3, `v7.1a-01` 4, `v7.0c-01` 3.
**Em produção (2026-10-29):** `main` = `508e460`; Deploy API (1683 contra Postgres) e Deploy Painel (763) verdes; `painel.asaf.org.br/version.json` = `508e460`;
`/api/privacidade/titulares` e `/api/privacidade/titulares/relatorio` no `openapi.json`; o relatório sem login responde 401. Nenhum relatório foi gerado na
produção.

✅ **v7.2c concluída (2026-10-29) — a entrega do relatório ao titular pela Minha conta.** No pedido do titular (acesso, portabilidade, confirmação ou
compartilhamento), com a identidade validada, o encarregado (ou quem responde o pedido em aberto) abre "Conferir e liberar o relatório": o relatório da pessoa,
montado pelo próprio pedido, e ali marca "conferi" e **libera ESTE** relatório. A liberação leva a impressão do que estava na tela e o servidor recusa (409) se algo
entrou ou saiu desde a conferência; a cópia fica congelada (nada anotado depois entra). Por **15 dias**, a pessoa entra na Minha conta do site (código mandado ao
e-mail do pedido) e baixa o **PDF** (o relatório inteiro, com para que serve, base legal, compartilhamento e prazo de cada parte) e o **arquivo para levar a outro
serviço** (JSON, decisão 11: o que ela forneceu — cadastro, contatos, formulários, pedidos, consentimentos — e o que é dela no financeiro; ficam fora o que a
equipe registrou, como o prontuário, e os atos de governança, como votos; tudo isso está no PDF). Cada liberação e cada download ficam na Auditoria (sem
valores). Vencido o prazo, a limpeza da rotina de retenção (a cada 15 minutos) apaga a cópia e ficam só as datas; a anonimização do associado e a eliminação do
prontuário apagam também a cópia ainda vigente. Nenhum arquivo é guardado no armazenamento (os dois são gerados da cópia na hora do download), e não foi
preciso permissão nova no Azure. Tabela `entregas_ao_titular` (migração `12f16313d972`), classificada (o conteúdo como sensível, leitura auditada) e no
inventário (atividade "Pedidos pelo site e direitos do titular", com o prazo de 15 dias). O pedido feito pelo responsável sem ligação ao cadastro não libera (o
e-mail é de quem pediu); ninguém libera o relatório dos próprios dados (nem pelo CPF ou pelo e-mail, sem ligação ao cadastro).
**Conferência independente (agente, só leitura) achou 11 defeitos; tratados antes de publicar.** O mais grave: quem "plantasse" o próprio e-mail no cadastro de
outra pessoa (inscrevendo-se num evento com o CPF dela) e pedisse pela Minha conta receberia o relatório inteiro dela — agora, com a identidade provada só pelo
código do e-mail, o relatório traz só o que foi feito com aquele e-mail, nunca o cadastro ligado (para o cadastro, a identidade vem do cadastro de associado ou é
conferida à mão). Também: a cópia não era garantidamente a conferida (agora a impressão e o 409); o e-mail usado pela família trazia pedidos e inscrições do
irmão (agora a linha que diz ser de outra pessoa do cadastro, ou de outro CPF, não entra — vale também para o relatório da v7.2b); a pré-visualização dizia a quem
não podia que o pedido existia; a trava "sobre os próprios dados" se contornava sem ligação ao cadastro; texto com cara de data derrubava o PDF; palavra enorme
saía da página; a cópia sobrevivia à eliminação; o arquivo cortado não avisava; o site dizia só o dia do prazo (agora com a hora); o download não dizia
"baixando…" nem "baixado" ao leitor de tela.
**Testes locais:** servidor 1698 em duas rodadas e 1698 contra Postgres 18; painel 771 (duas rodadas); site 779 de unidade e 925 de navegador.
**Na homologação (2026-10-29):** migração aplicada no banco de TESTE (`Running upgrade b0227d30a6a9 -> 12f16313d972`). Robô `v7.2c-01` 3/3: uma associada
inventada pede acesso pelo site; o Presidente abre o pedido, segue "Conferir e liberar", o botão espera a marca "conferi", libera e o cartão do pedido mostra até
quando vale; a liberação está na Auditoria sem o nome; no SITE de homologação ela entra na Minha conta com o código e baixa o PDF (`%PDF`) e o arquivo (com o
nome e o CPF dela, sem o prontuário); os dois downloads estão na Auditoria; outra pessoa (outro e-mail) recebe 404 no protocolo dela, sem sessão 401, e o
Tesoureiro recebe 403 ao liberar. Regressões verdes: `v7.2b-01` 2, `v7.2a-01` 3, `v5.7f-01` 5, `v5.7f-02` 4 (o robô passou a mandar o resultado, exigido desde
a v7.2a), `v5.6b-01` 6, `v5.6b-02` 4, `v7.1d-01` 2.
**Em produção (2026-10-29):** `main` = `3de6476`; Deploy API (1698 contra Postgres e `Running upgrade b0227d30a6a9 -> 12f16313d972`), Deploy Painel (771) e
Deploy Site verdes; `painel.asaf.org.br/version.json` e `asaf.org.br/version.json` = `3de6476`; as rotas novas
`/api/privacidade/titulares/entregas/{id_atendimento}` e `/api/visitante/pedidos/{protocolo}/relatorio` estão no `openapi.json` e respondem 401 sem login/sessão;
a página `asaf.org.br/minha-conta/` tem o bloco do relatório. Nenhum relatório foi liberado na produção.

✅ **v7.2d concluída (2026-10-29) — a eliminação a pedido.** No pedido de eliminação com a identidade validada, o encarregado (no pedido sobre o próprio
Presidente, quem o responde) abre "Ver o que sai e o que fica": a prévia é o relatório da pessoa, montado pelo pedido como na entrega, com o destino de cada
parte — o que **sai** (escolhido no banco só entre as linhas que são dela) e o que **fica**, com o fundamento (financeiro e recibos; atas, votações e mandatos;
nome e matrícula no livro de associados; a prova dos consentimentos; o termo do voluntário; o registro trabalhista; o vínculo vivo). Depois de marcar "conferi",
"Eliminar o que pode sair"; o servidor confere que nada mudou nem venceu desde a prévia (409). Decisões A a G (29/10): pedido feito pela Minha conta (só o código
do e-mail) nunca tira o cadastro; vínculo vivo — associado no quadro, mandato vigente ou futuro, termo de voluntário em vigor, atendimento em projeto, quem
trabalhou na associação, família de associado, evento que ainda vai acontecer, débito em aberto, desligamento com data futura — segura o cadastro e sai o resto;
evento que já passou: a pessoa sai e a contagem fica, certificado e crachá perdem arquivo e nome; pedidos antigos pelo site perdem texto e contatos (o pedido de
eliminação e os de titular já atendidos ficam como prova); intenção de doação vencida sai (a confirmada e a que espera o Pix ficam); proposta de filiação que não
virou filiação sai; o desligado é anonimizado na hora (ficam nome e matrícula) e perde a conta do painel (e-mail, segundo passo, sessões e chaves), os documentos
anexados e a foto da Diretoria; quem não é associado perde também o nome. A Auditoria guarda o protocolo, o que sai e o que fica ANTES de mexer, e a etapa que
falhou, se falhar (cada etapa é gravada; a prévia seguinte mostra o que falta). O resultado e o fundamento sugeridos vão para o formulário de resposta. Sem
migração. Um teste reprova tabela nova do relatório sem destino decidido.
**Conferência independente (agente, só leitura, com testes de sondagem) achou 12 defeitos; tratados antes de publicar.** Os mais graves: o ex-funcionário
perderia nome e CPF (a lei trabalhista manda guardar); pelo e-mail da família sairiam o pedido, a inscrição e a intenção de doação do irmão; o desligamento com
data futura apagava arquivos e parava no meio; o crachá de evento futuro e documentos genéricos perdiam o arquivo; a prévia não cobria o tempo que passa (um
mandato que vence); a segunda execução prometia de novo; o resultado sugerido dizia "atendido" com dado restando; falha no meio deixava estado parcial sem
Auditoria; o pedido sobre o Presidente ficava sem quem decidisse; a proposta de filiação recusada ficava com fundamento falso; o termo do voluntário (prova da Lei
9.608) perdia a referência; a conta do painel guardava o segundo passo e as sessões.
**Testes locais:** servidor 1714 em duas rodadas e 1714 contra Postgres 18; painel 775 (duas rodadas).
**Na homologação (2026-10-29):** robô `v7.2d-01` 2/2: uma pessoa do site com um pedido antigo encerrado pede a eliminação pela Minha conta; o Presidente abre o
pedido, vê o pedido antigo saindo e "Este pedido de eliminação" ficando, o botão espera o "conferi", elimina, o formulário de resposta já vem com "Atendido em
parte", o pedido antigo ficou "(apagado a pedido do titular)" sem o e-mail, e a Auditoria tem o protocolo sem o texto; uma associada ativa pede: a prévia diz
que ela está no quadro de associados, nada pode sair e o botão não age; o Tesoureiro recebe 403 na prévia. Regressões verdes: `v7.2c-01` 3, `v7.2b-01` 2,
`v7.2a-01` 3, `v5.7f-01` 5, `v5.6b-02` 4, `v7.1d-01` 2.
**Em produção (2026-10-29):** `main` = `f206d75`; Deploy API (1714 contra Postgres) e Deploy Painel (775) verdes; `painel.asaf.org.br/version.json` =
`f206d75`; `/api/privacidade/titulares/eliminacoes/{id_atendimento}` no `openapi.json`, respondendo 401 sem login (GET e POST). Nada foi eliminado na produção.
✅ **v7.2e concluída (2026-10-29) — o pedido sobre os próprios dados feito pelo painel.** Em Meu perfil > **Meus dados pessoais** (a aba só aparece para quem
tem cadastro de associado ligado à conta), a pessoa escolhe o direito, explica, lê o aviso de privacidade e envia; o pedido sai ligado ao cadastro dela e entra na
mesma fila, com o mesmo prazo, o mesmo responsável (o pedido sobre o Presidente vai para o 1º Vice) e a mesma confirmação simples na hora. A resposta, o
resultado e o fundamento aparecem ali, e o relatório liberado pelo encarregado (v7.2c) é baixado ali mesmo. A identidade nasce validada só quando a conta tem o
segundo passo ligado e a senha definitiva; sem isso, a equipe confere à mão (a tela avisa a pessoa). O pedido feito pelo painel não aparece na Minha conta do
site, e os e-mails só avisam que há novidade e mandam ler no painel. Limite de 5 pedidos por dia por pessoa. O cartão do encarregado diz onde a pessoa baixa.
Sem migração (a identidade nova "PAINEL" cabe na coluna que já existe).
**Conferência independente (agente, só leitura) achou 8 defeitos e 3 suspeitas; tratados antes de publicar.** Os mais graves: a identidade "do painel" era
tratada como forte, mas o servidor não exige o segundo passo do associado comum e quem digitou a senha provisória entraria no lugar dele (e poderia pedir a
eliminação); a regra "e-mail do cadastro de associado" validava sozinha também no painel; o pedido feito pelo painel podia ser lido e baixado pela Minha conta
por quem usa o mesmo e-mail (a família); o painel mostrava pedidos feitos pelo site por outra pessoa ligada ao cadastro; o cadastro sem e-mail deixava o pedido
sem como ser respondido; os textos (e-mails, PDF, cartão do encarregado) diziam "Minha conta" para o pedido do painel; não havia limite de pedidos.
**Testes locais:** servidor 1723 em duas rodadas e 1723 contra Postgres 18; painel 779 (duas rodadas).
**Na homologação (2026-10-29):** robô `v7.2e-01` 3/3: a Secretária abre Meus dados pessoais, a tela recusa o envio sem escolher o direito, ela pede o acesso e
recebe o protocolo, o prazo e o aviso de que a equipe vai conferir a identidade (na homologação o segundo passo está desligado: a entrada não prova a
identidade, como deve ser); o Presidente acha o pedido, confere a identidade, o cartão diz que a pessoa baixa no painel, ele confere e libera o relatório; a
Auditoria guarda quem pediu; a Secretária baixa o PDF pelo próprio painel. Regressões verdes: `v7.2d-01` 2, `v7.2c-01` 3, `v7.2a-01` 3, `v5.7f-01` 5,
`v5.7f-02` 4, `v5.6b-02` 4.
**Em produção (2026-10-29):** `main` = `2cf9362`; Deploy API (1723 contra Postgres) e Deploy Painel verdes; `painel.asaf.org.br/version.json` = `2cf9362`;
`/api/meus-pedidos-do-titular` e `/api/meus-pedidos-do-titular/{protocolo}/relatorio` no `openapi.json`, respondendo 401 sem login. Nenhum pedido foi feito na
produção.
✅ **v7.2f concluída (2026-10-29) — o relatório de atendimento.** Em Privacidade > **Relatório de atendimento** (permissão `privacidade`, a Diretoria), os
pedidos sobre dados pessoais do ano: quantos, de que direito, por que canal (formulário do site, Minha conta, painel), com que resultado e fundamento,
respondidos no prazo e fora dele, em andamento já vencidos, o tempo médio de resposta, os relatórios entregues e as eliminações feitas (contando pedidos: liberar
de novo ou terminar uma eliminação que parou não conta duas vezes, e a que parou e não terminou não conta). O ano é o de Belém, dado pelo servidor. O **relatório
anual** passa a trazer o resumo (decisão 12): o total e, só quando nada fica entre 1 e 4 (nem por subtração), os resultados e o prazo; o tempo médio só com 5
respostas ou mais; a página do relatório anual no site o mostra (o relatório publicado antes continua igual). Só contagens, sem nome. Sem migração.
**Conferência independente (agente, só leitura) achou 7 defeitos; tratados antes de publicar:** eliminação e relatório contados em dobro; no relatório público
dava para descobrir um "menos de 5" por subtração (o próprio exemplo de teste vazava); a tela usava o ano do navegador (em 31/12, das 21h às 24h, abriria num ano
que a API recusa); o canal mudava sozinho depois da rotina de guarda; o pedido encerrado sem resposta aparecia como respondido.
**Testes locais:** servidor 1729 em duas rodadas e 1729 contra Postgres 18; painel 781 (duas rodadas); site 779 de unidade e os de navegador da Transparência.
**Na homologação (2026-10-29):** robô `v7.2f-01` 2/2: o robô faz um pedido pelo site; o Presidente abre o Relatório de atendimento, a tela abre no ano de Belém
com o mesmo total que a API dá, mostra o canal "Formulário do site" e o direito "Acessar os dados", e troca para o ano anterior; o Tesoureiro recebe 403.
Regressões verdes: `v7.2e-01` 3, `v7.2d-01` 2.
**Em produção (2026-10-29):** `main` = `340f074`; Deploy API (1729 contra Postgres), Deploy Painel e Deploy Site (926 de navegador) verdes;
`painel.asaf.org.br/version.json` e `asaf.org.br/version.json` = `340f074`; `/api/privacidade/solicitacoes-do-titular/relatorio` no `openapi.json`, 401 sem login.

✅ **v7.2g concluída (2026-10-29) — os textos da v7.2 e o reforço da identidade na eliminação.** A **Política de Privacidade 2.16** diz como o pedido é
atendido: os canais (o formulário; a Minha conta, que pede a eliminação do que foi feito com o e-mail; o painel do associado), como a identidade é confirmada
(e que, para eliminar o cadastro, a confirmação pelo e-mail não basta), o relatório para baixar por 15 dias com o arquivo para levar a outro serviço, a
eliminação (o que fica e por quê, o que acontece com o evento que já passou) e o total de pedidos no relatório anual; na lista de prazos, a cópia do relatório
entregue (15 dias, fixa). Cada frase foi conferida contra o código por um verificador independente, que achou 5 frases falsas e 4 imprecisas na primeira
redação (corrigidas). **Correção da v7.2d** que essa conferência revelou: quem soubesse o CPF e o e-mail de um ex-associado conseguiria, pelo formulário, um
pedido com a identidade "validada" e a eliminação do cadastro dele; agora a identidade automática (o e-mail do cadastro, ou o código do e-mail) só elimina o
que foi feito com aquele e-mail, e a equipe pode REFORÇAR a identidade por outro meio no próprio pedido (o painel oferece) para tirar o cadastro. No relatório
anual, o prazo também não se descobre pelos pedidos que faltam responder.
**Testes locais:** servidor 1731 em duas rodadas e 1731 contra Postgres 18; painel 782 (duas rodadas); site 779 de unidade e 925 de navegador.
**Na homologação (2026-10-29):** robô `v7.2g-01` 2/2: o site de homologação mostra a Política 2.16 com os parágrafos novos; uma associada pede a eliminação
pelo site com o CPF e o e-mail do cadastro, a prévia diz que o cadastro ligado ao e-mail não sai, o Presidente reforça a identidade e a prévia passa a mostrar
o vínculo dela (nada foi eliminado). Regressões verdes: `v7.2d-01` 2 (ajustado à regra nova), `v5.7f-01` 5, `v5.7f-02` 4.
**Em produção (2026-10-29):** `main` = `9bb3684`; Deploy API (1731 contra Postgres), Deploy Painel e Deploy Site (927 de navegador) verdes;
`painel.asaf.org.br/version.json` e `asaf.org.br/version.json` = `9bb3684`; `asaf.org.br/privacidade/` diz "Versão 2.16" e tem os quatro parágrafos novos.

- [x] **[v5.5a e v5.6b: o formulário do site (fila única, protocolo e prazo) e a Minha conta; v5.7f: a validação de identidade; v7.2e: o pedido pelo painel (Meu perfil > Meus dados pessoais)]** Canal único de solicitação: pelo painel (autenticado) e pelo site (formulário com validação
      de identidade), gerando protocolo com prazo legal acompanhado.
- [x] **[v7.1b–d: revogação do consentimento e eliminação do prontuário; v7.2a: confirmação simples na hora; v7.2b: o relatório de acesso (com finalidade,
      base legal, compartilhamento e prazo); v7.2c: a entrega pela Minha conta (PDF + arquivo da portabilidade, 15 dias); v7.2d: a eliminação a pedido; a
      correção é feita no próprio cadastro]** Atendimento real de cada direito: confirmação de tratamento, acesso, correção,
      anonimização/eliminação, portabilidade (exportação em formato legível por máquina),
      informação sobre compartilhamento, e revogação de consentimento.
- [x] **[v7.2a: a resposta registra o resultado e, se não atendida por inteiro, o fundamento escolhido de uma lista, que a pessoa lê na Minha conta]**
      Limites explicados ao titular quando houver: dado retido por obrigação legal (contábil,
      fiscal) não é apagável, e o sistema responde isso com fundamento, não com silêncio.
- [x] **[v7.2f: Privacidade > Relatório de atendimento, e o resumo no relatório anual]** Relatório de atendimento de solicitações (quantas, prazo médio, resultado) para a diretoria.

#### v7.3 — Segurança aplicada à privacidade

> **Levantamento (2026-10-29, agente só leitura) e decisões do Presidente (29/10, "aprovo" às duas recomendações).** Hoje o CPF sai inteiro em 6 rotas
> (lista e ficha de associados, propostas de filiação, pedido do atendimento, doações e doações do site) e em 9 telas, com 4 jeitos diferentes de mascarar; o
> painel e a API não têm cabeçalhos de segurança; o inventário não diz o mecanismo do art. 33 nem os termos de cada prestador, e faltam dois serviços de
> consulta (o de CEP e o de CNPJ). **Decisão 1 (CPF):** nas listas sempre escondido (`***.***.***-NN`, um formato só) para todos; na ficha o completo só
> aparece por clique em "Mostrar o CPF", registrado na Auditoria, e só para quem tem tarefa que precisa dele: o Presidente, os Secretários (cadastro e
> filiação), os Tesoureiros (o recibo de doação leva o CPF do doador) e quem atende a solicitação do titular (conferir a identidade); Vice-Presidentes e
> Conselho Fiscal veem sempre escondido; a busca por CPF continua no servidor. **Decisão 2 (art. 33):** a base é a das cláusulas-padrão de proteção de dados
> que cada provedor oferece nos termos aceitos ao criar a conta; o documento de cada um (nome, link, data) vai ao inventário e à Política, sem advogado.
> Partes: v7.3a o CPF; v7.3b os cabeçalhos do painel e da API; v7.3c a transferência internacional e os termos dos operadores (Política 2.17); v7.3d os registros públicos das rotinas sem dado pessoal (achado da auditoria de 30/10: o repositório é público); v7.3e os serviços de consulta (CEP e CNPJ) no inventário.
>
> **A pesquisa da decisão 2 (2026-10-29) mostrou que ela só vale para o Google.** O Cloud Data Processing Addendum do Google (08/06/2026, que vale para o
> Workspace) incorpora as cláusulas-padrão da ANPD (Res. CD/ANPD 19/2024); o Adendo de Proteção de Dados da Microsoft (22/05/2026) e o do GitHub (out/2025)
> só têm as cláusulas europeias, que a ANPD não reconhece, e a organização do GitHub está no plano gratuito, onde o termo do GitHub nem se aplica. **Decisão do
> Presidente (2026-10-30):** NENHUM pedido é feito à Microsoft nem ao GitHub (o rascunho foi cancelado e apagado no mesmo dia, sem ter sido enviado nem
> guardado); o texto público sobre o assunto não muda (a Política continua dizendo, como já diz, quem são os prestadores, onde ficam os dados e que parte do
> tratamento acontece fora do Brasil); a estrutura não muda (as cópias nos EUA protegem contra perda de dados). Fica registrado aqui, internamente, o que a
> pesquisa achou, para reavaliar quando a ANPD reconhecer outras cláusulas ou os provedores passarem a oferecer as brasileiras.

- [ ] Minimização por padrão: cada tela e cada exportação mostram só o necessário; CPF completo
      exibido apenas para quem tem permissão específica, mascarado para os demais.
- [x] Headers de segurança HTTP (CSP, `X-Content-Type-Options`, `X-Frame-Options`, HSTS) no site
      estático e no painel. **[v5.7: o site; v7.3b: o painel e a API]**
- [x] Rate limiting nos endpoints públicos (inscrição de evento, contato, filiação) — proteção
      contra spam/abuso sem CAPTCHA comercial pago. **[feito antes, na FASE 5, por IP e por hora: inscrição (v4.6), atendimento (v5.5a), filiação (v5.4h), doação (v5.6a) e conta de visitante (v5.6b)]**
- [x] Transferência internacional (LGPD, art. 33): o mecanismo (cláusulas-padrão da ANPD ou outro) para cada operador fora do Brasil (Azure, GitHub, Google), como
      a v7.0c deixou registrado no inventário e na Política. **[v7.3c: o que os termos de cada um dizem, no inventário e na Política 2.17]**
- [ ] Contratos/termos com operadores (Azure, provedor de e-mail, PSP de pagamento, BSP de
      WhatsApp) registrados no inventário, com a finalidade de cada compartilhamento. **[v7.3c: Azure, GitHub e Google (o e-mail é o Google) com os
      termos; não há PSP (o Pix é estático) nem WhatsApp; faltam os dois serviços de consulta que a API chama, o ViaCEP (recebe só o CEP) e o Minha Receita
      (recebe só o CNPJ do fornecedor): v7.3e]**

✅ **v7.3b concluída (2026-10-30) — os cabeçalhos de segurança do painel e da API.** O **painel** passa a mandar a política de conteúdo (só ele mesmo e a
API do seu ambiente; o script do tema liberado pelo resumo sha256, nunca por `unsafe-inline`; fotos e PDFs por `blob:`), quadro proibido, `nosniff`,
referência só do próprio site e a câmera e as chaves de acesso liberadas só para ele (a portaria lê o QR; o passkey), escritos na montagem em
`dist/staticwebapp.config.json` (`painel/scripts/cabecalhos-de-seguranca.mjs`). A **API** manda `nosniff`, quadro proibido, sem referência, HSTS e, no JSON,
a política fechada (a documentação e o PDF aberto direto não são travados). O robô da homologação percorre **todas as 67 telas** do menu escutando os
avisos de bloqueio do navegador: na primeira rodada achou, em todas, a tentativa de `eval` que o `zod` faz para descobrir se pode compilar; o `zod` passou
a não tentar (`jitless`, o caminho que a documentação dele indica). A primeira publicação na homologação caiu por indisponibilidade do Azure e foi refeita.
**Testes locais:** servidor 1734 em duas rodadas e 1734 contra Postgres 18; painel 785 (duas rodadas) e a montagem.
**Na homologação (2026-10-30):** robô `v7.3b-01` 2/2 (os cabeçalhos do painel e da API de teste; as 67 telas sem nenhum bloqueio). Regressões verdes:
`v7.2c-01` 3, `v7.2e-01` 3, `v5.7c-01` 4, `v5.6b-01` 6.
**Em produção (2026-10-30):** `main` = `d8a4bad`; Deploy API (1734 contra Postgres) e Deploy Painel verdes; `painel.asaf.org.br/version.json` = `d8a4bad`;
`painel.asaf.org.br` manda a política com `https://api.asaf.org.br`, `X-Frame-Options: DENY` e `camera=(self)`; a API manda `nosniff`, `DENY`, HSTS e, no
JSON, `default-src 'none'; frame-ancestors 'none'`.

✅ **v7.3c concluída (2026-10-30) — o que os termos de cada prestador dizem.** O inventário de dados (tela e planilha) passa a registrar, para cada
prestador, o documento de proteção de dados que vale para a conta da ASAF: **Microsoft (Azure)**, o Adendo de Proteção de Dados de 22/05/2026, com as
cláusulas europeias e sem as da ANPD, mas com a obrigação de cumprir as leis aplicáveis; **GitHub**, no plano gratuito, só os Termos de Serviço e a
Declaração de Privacidade (sem contrato de operador); **Google (Workspace)**, o Adendo de Tratamento de Dados de 30/10/2026, com as cláusulas-padrão da ANPD.
A **Política de Privacidade 2.17** diz isso em texto simples e diz que a cópia de segurança nos EUA é escolha da ASAF (contra perda de dados); o texto foi
conferido por verificador independente (a primeira redação tinha 3 frases falsas). **Nada foi pedido às empresas** (decisão do Presidente, 30/10).
**Testes:** servidor 1735 contra Postgres 18 (validação da branch e Deploy API).
**Na homologação (2026-10-30):** robô `v7.3c-01` 2/2 (a Política 2.17 no site de teste; o inventário com os termos). Regressões: `v7.0c-01` 3 e `v7.2g-01`
2 (esse esperava a versão 2.16 escrita fixa; passou a aceitar da 2.16 em diante, os parágrafos da v7.2 continuam conferidos).
**Em produção (2026-10-30):** `main` = `88fa94a`; Deploy Site, Deploy Painel e Deploy API (1735) verdes; `painel.asaf.org.br/version.json` = `88fa94a`;
`asaf.org.br/privacidade/` mostra "Versão 2.17 · em vigor desde 30 de outubro de 2026" e o parágrafo novo da transferência.

✅ **v7.3d concluída (2026-10-30) — os registros públicos das rotinas sem dado pessoal.** O repositório é público e os registros das execuções do GitHub
Actions ficam abertos por 90 dias; a auditoria de 30/10 viu que, se uma rotina agendada falhasse contra o banco de produção, o erro impresso traria os valores
da linha (o CPF de um `DETAIL: Key (cpf)=(...)`), e que a publicação da API imprimia o JSON do Container App (com o e-mail de quem o criou). Até aqui nada
de dado pessoal tinha saído (as rotinas só imprimem contagens). Agora: com `ASAF_REGISTRO_SEGURO=1` (ligado nos fluxos que usam o banco de produção) os
erros saem só com o tipo e onde aconteceram, sem a mensagem (`app/registro_seguro.py`); a conexão do banco esconde os valores das consultas
(`hide_parameters`); a senha do banco é mascarada sozinha e decodificada (antes só a URL inteira); a publicação não imprime o JSON (`-o none`); os prints dos
robôs da homologação ficam 7 dias (eram 30). Os registros antigos (até 90 dias) seguem como estão.
**Testes:** servidor 1756 em duas rodadas e 1756 contra Postgres 18; os passos dos fluxos são EXECUTADOS no teste com um `az` de mentira (a primeira
versão do `-o none` saiu com a quebra de linha errada e o teste que só lia o texto não pegou; o teste novo pega).
**Na homologação (2026-10-30):** a API de teste publicada com a branch e os robôs `v7.3c-01` 2, `v7.2c-01` 3 e `v5.7c-01` 4 verdes. A homologação usa o
fluxo da `main`, então o `-o none` dela passa a valer na próxima publicação.
**Em produção (2026-10-30):** `main` = `cf4d77a`; Deploy API verde (1756 contra Postgres); no registro público desse deploy a senha aparece mascarada, o
passo de publicação não tem mais `createdBy` nem e-mail, e as mensagens da migração já saem no formato do registro seguro; a API responde 200.

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
- [x] Declaração de acessibilidade publicada, com canal para relatar barreira encontrada. **[feito antes, na v5.7: publicada em `/acessibilidade/` com a conformidade parcial declarada; a revisão manual continua pendente e é outro item]**

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
> Transparência geradas do sistema. **Os blocos que restavam já foram feitos na v6.3 (22/10/2026):** a prestação de contas anual
> (v6.3b, `/transparencia/contas/`, só depois da Assembleia), o relatório anual de atividades (v6.3c, `/transparencia/relatorio-anual/`), as atas
> em texto e o responsável e o histórico de cada documento (v6.3a). Aqui fica só o que ainda não existe (o relatório de parcerias com o poder
> público quando a v12.1 estiver ativa); reaproveitar, não reconstruir.

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

> **[parcial, 22/10/2026 — "Esqueci a minha senha", registrado na v6.2]:** código de 6 números de uso único, válido por 10 minutos, enviado ao e-mail de
> acesso; tetos por conta, por CPF, por IP e do sistema; a troca encerra todas as sessões e avisa o titular por e-mail; o pedido e a troca ficam na
> Auditoria; o MFA continua exigido. **Falta daqui:** aviso de login em dispositivo novo, verificação reforçada para quem tem alçada financeira ou
> gerencia acessos e o monitoramento de tentativa distribuída. Reaproveitar o que existe, não reconstruir.

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
      - **Lote 8 ✅ FEITO, provado na homologação e confirmado em produção (2026-10-08, commit `944df23`)** (mesma versão-maior,
        só última estável): servidor `fastapi` 0.142.2 → **0.143.0** e `sqlalchemy` 2.1.2 → **2.1.4**; painel `vite` 8.3.4, `eslint` 10.12,
        `typescript-eslint` 8.71, `@tanstack/react-table` 9.2.6, `lucide-react` 1.53, radix (`alert-dialog` 1.1.24, `slot` 1.4.0), `idb` 8.0.4,
        `applicationinsights-web` 3.4.5, `@playwright/test` 1.64, `jsdom` 30.1.2; site `astro` 7.3.7, `@playwright/test` 1.64, `jsdom` 30.1.2.
        **Verificado:** suíte do servidor 984 de 984, rodada duas vezes (nas versões novas); painel: formatação, tipos (inclusive do robô), lint,
        408 testes e build; site: tipos, 247 testes, formatação e build de teste. **Na homologação:** deploy da branch e o robô verde em fase0
        (6/6), fase1 (24/24), filiação por sócios (h-09 5/5), Auditoria financeira (h-03 8/8), relatórios e antifraude (e-04 16/16), registrar
        saída (h-08 5/5) e despesa/compras (e-03 12/12). **Em produção:** Deploy API, Painel e Site verdes; `version.json` = `944df23`;
        `asaf.org.br` e o painel respondem 200; as rotas da filiação seguem 401 sem login; o `openapi.json` lista 406 rotas. Pré-lançamento
        (beta/rc) segue só informativo.
      - **Lote 9 ✅ FEITO, provado na homologação e confirmado em produção (2026-10-09, commit `dfbad3c`)** (mesma versão-maior, só última estável): servidor
        `pydantic` 2.13.5 → **2.14.0** (com `pydantic_core` 2.50.0) e `pypdf` 6.19.0 → **6.20.0**, mais as dependências de trás (`cryptography` 50.0.2, `dnspython` 2.9.0,
        `idna` 3.20, `Mako` 1.4.3, `MarkupSafe` 3.0.4, `cbor2`, `greenlet`, `iniconfig`, `opentelemetry-api`, `pycparser`, `python-dotenv`, `tzdata`, `watchfiles`,
        `websockets`); painel `@tanstack/react-table` 9.2.8 e `lucide-react` 1.54.0; site `astro` 7.3.8 (deixou de depender do `esbuild`, por isso o `package-lock.json`
        encolheu) e `prettier-plugin-astro` 1.1.1. O Pydantic 2.14 estável saiu depois do aviso de 02/10 (na época só havia beta). Conferido em 09/10: imagem base
        `python:3.14-slim` e Node 26 já eram as últimas estáveis; as ações do GitHub (`checkout` v7, `setup-python` v7, `setup-node` v7, `upload-artifact` v7, `cache` v6,
        `azure/login` v3, `static-web-apps-deploy` v1) estão na última versão-maior.
        **Verificado:** suíte do servidor 1046 de 1046, **rodada duas vezes** no código final (as duas primeiras rodadas, antes da correção abaixo, deram 1045 e
        "1 falhou"); `pip check` sem conflito; painel: formatação, tipos, lint (0 erros), 421 testes e build; site: formatação, tipos, 287 testes, build de teste,
        356 testes de navegador (uma falha única do axe em `/contato/`, na máquina local com a suíte pesada rodando ao lado, não reproduziu em duas rodadas seguintes
        nem no CI) e os roteiros de estado vazio, Instituição e sincronização. **Na homologação:** deploy da branch e robô verde em `v5.4h-12` 4/4 (listas), `v5.4c-fase0`
        6/6, `v5.4c-fase1` 24/24, `v5.4e-04` 16/16, `v5.4h-09` 5/5 e `v5.4g-02` 7/7 (o verificador de PDF, que usa o `pypdf`), mais `v5.4h-14` 2/2 no `hml-site`
        reconstruído com o Astro novo. **Em produção:** Deploy API, Painel e Site verdes (o do site inclui axe, Lighthouse e o passo da Instituição); `version.json` do
        painel e do site = `dfbad3c`; a API responde 200 nas rotas públicas e 401 nas protegidas, com 407 rotas no `openapi.json`.
        **Defeito achado no caminho (já estava em produção desde a paginação, corrigido neste lote):** a busca de associados com letras e números juntos (`6fcd7dfd`)
        extraía os dígitos (`67`) e os procurava no CPF e no telefone de todo mundo; só texto com cara de número (CPF ou telefone, com ou sem pontuação) vira busca por
        dígitos. Apareceu como um teste instável na suíte (o CPF do administrador de teste tinha `67`); ganhou teste determinístico que falha sem a correção.
      - **Directus 12.4.1 → 12.5.0: ADIADO, com motivo (não é silêncio).** É a única versão desatualizada que sobrou. É troca da imagem do contêiner de **produção** (infraestrutura),
        e a regra do projeto pede provar antes: subir a 12.5.0 numa cópia descartável (como na 12.4.1), rodar `directus_configurar.py verificar` e `isolar_directus.py
        verificar` e só então trocar a imagem, dizendo o plano ao Presidente. Não há motivo de segurança conhecido para pressa; fica para o próximo lote.
      - **Lote 10 ✅ FEITO, provado na homologação e confirmado em produção (2026-10-15, commit `d99a2b8`)** (mesma versão-maior, só última estável): servidor `fastapi` 0.143.0 → **0.143.2**,
        `pydantic` 2.14.0 → **2.14.1** (com `pydantic_core` 2.50.1) e `pypdf` 6.20.0 → **6.20.1** (as três fixadas em `requirements.txt`), mais as de trás que o `pip` resolve (`starlette` 1.8.0,
        `httptools` 0.9.0, `truststore` 0.10.5, `pluggy` 1.7.0); painel e site dentro das faixas (React 19.3.1, `astro` 7.4.0, `vitest` 5.0.5, TanStack Query 5.104.3 e Table 9.3.1, Zod 4.6.7,
        Radix, `lucide-react` 1.57, `react-hook-form` 7.90, Playwright 1.64.1, `@axe-core/playwright` 4.14.0, Prettier 3.9.10, `jsdom` 30.1.3, `sanitize-html` 2.18.1 e outros). Conferido pacote a pacote
        com `npm view`: nada mais desatualizado; **TypeScript 7** (`@typescript/native` 7.0.2) e o 6 lado a lado (`@typescript/typescript6` 6.0.2) seguem nas últimas. **Verificado:** suíte do servidor
        1138 de 1138, **rodada duas vezes** no código final; painel: formatação, tipos, lint (0 erros), 534 testes, build e 10 de 10 no navegador (com a API apontada para a produção, como no CI);
        site: formatação, tipos, 537 testes, build de teste, **584 de 584 no navegador com o `axe` novo** e os roteiros de estado vazio, Instituição, sincronização e tamanho. **Na homologação:**
        `v5.4c-fase0` 6, `v5.4c-fase1` 24, `v5.4g-02` 7 (o verificador de PDF, com o `pypdf` novo), `v5.4h-12` 4, `v5.4h-09` 5, `v5.5a-01` 6, `v5.5a-02` 7 e `v5.4g-01` 5 (acessibilidade de todas as
        páginas do site reconstruído). **Em produção:** Deploy API, Painel e Site verdes; `version.json` do painel e do site = `d99a2b8`; a API responde 200 nas rotas públicas e 401 na protegida, com 419
        rotas no `openapi.json`. **Limite conhecido (informativo):** `npm audit` do site lista 13 avisos, todos na cadeia do `@lhci/cli` 0.15.1 (Lighthouse CI: `tmp`, `uuid`, `extract-zip`, `basic-ftp`
        etc.), que é ferramenta só do CI (nunca vai para o site), já está na última versão e não tem correção publicada; o `npm audit` do painel dá 0. Rever a cada lote.
      - **Lote 11 ✅ FEITO, provado na homologação e confirmado em produção (2026-10-27, commit `8333b5c`)** (mesma versão-maior, só última estável): servidor
        `fastapi` 0.143.3 → **0.162.0**, `sqlalchemy` 2.1.4 → **2.1.6**, `httpx2` 2.13.1 → **2.16.0**, `reportlab` 5.0.1 → **5.1.0**, `azure-identity` 1.26.0 → **1.27.0**,
        `pypdf` 6.21.0 → **6.21.2**, `alembic` 1.20.0 → **1.20.1**; painel e site dentro das faixas (`react-router` 8.5, `vite` 8.3.5, TanStack Query 5.105, `lucide-react`
        1.62, `react-hook-form` 7.91, `typescript-eslint` 8.72, `astro` 7.4.2, `@astrojs/check` 0.9.12, `prettier-plugin-astro` 1.1.2). **Verificado:** servidor 1601 em duas
        rodadas e contra Postgres; painel 745 e site 772 + 924 no navegador, duas rodadas. **Na homologação:** `v5.4c` 30 (a mescla de cadastros falhou uma vez e passou
        de novo, 24 de 24: a lista recarregada demorava, ver abaixo), `v5.4g` 31 (o 05 confere o site depois de reconstruído: 6 de 6 depois de publicar de novo), `v5.5a` 13,
        `v5.4f` 54, `v7.0d` 3, `v7.0c` 3. **Em produção:** Deploy API, Painel e Site verdes; `version.json` do painel e do site = `8333b5c`; 482 rotas no `openapi.json`;
        rota pública 200 e protegida 401. **Achado ao vivo (corrigido à parte, `f818b38`, homologação `v5.4c-fase1` 24 + 24, produção Deploy API verde):** o par julgado
        "não é duplicado" voltava à fila de revisão a cada busca, e a lista fazia 4 consultas por item (com a fila cheia, a tela demorava a se atualizar).
      - **Lotes 12 e 13 ✅ FEITOS, provados na homologação e confirmados em produção (2026-10-27, commit `c1880a9`, autorizados pelo Presidente nesta data)**: **Python
        3.14 → 3.15** (3.15.2, a última estável; a imagem `python:3.15-slim` pega sempre a correção mais nova da linha), **Pillow 12.3 → 13.0.0** e `pypdf` 6.21.2 → **6.21.3**
        (saiu no mesmo dia; o Presidente pediu para conferir que tudo estava na última versão antes de publicar: conferido no PyPI, no Docker Hub e com `npm outdated`). O
        `uvicorn[standard]` virou `uvicorn` + `httptools` + `uvloop` (as duas peças que o extra usava para ser rápido; o resto — `pyyaml`, `python-dotenv`, `watchfiles`,
        `websockets` — o sistema não usa, e o `pyyaml` ainda não tem pacote pronto para o 3.15). Pillow 13: nenhuma das APIs removidas é usada. **Verificado:** servidor 1612
        em duas rodadas no 3.15.2 (sobre a `main` com a v7.1a e o lote 14) e 1612 contra Postgres no 3.15.2. **Na homologação:** a imagem `python:3.15-slim` subiu e
        passaram `v5.4c` 30, `v5.4g-02` 7, `v7.0d` 3, `v7.1a` 4, `v5.6a-01` 5 e `v5.4f` 54. **Por que esperou:** é troca da imagem base da produção; o sistema de segurança do
        Claude Code bloqueou o primeiro envio sem a autorização explícita, que o Presidente deu. **Em produção:** Deploy API verde (1612 no Python 3.15.2); o Container App
        `asaf-api` está na revisão `asaf-api--0000152` com a imagem `asaf-api:c1880a9…`; `openapi.json` 200, rota pública 200 e protegida 401. **Plano de volta (não foi
        preciso):** reverter o commit na `main` ou reativar a revisão anterior do Container App.
      - **Lote 14 ✅ FEITO, provado na homologação e confirmado em produção (2026-10-27, commit `ef4e080`)** (`@hookform/resolvers` 5.9 → **6.0.1**, só o painel; a única
        quebra da 6 é no resolvedor de effect-ts, e o painel usa o de Zod): painel 747 em duas rodadas (já sobre a v7.1a), tipos, lint e build limpos. **Na homologação:** `v7.0c`
        3, `v7.0d` 3, `v7.1a` 4, `v5.4f` 54, `v5.4c` 30, `v5.4h-09` 5, `v6.2d-01` 2, `v5.5a` 13, `v5.5b-01` 4. **Achado:** o roteiro de filiação da v5.4c mandava a versão 2 do
        aviso fixa (a v7.1a a passou a 3): os robôs agora leem a versão em vigor do mesmo arquivo do catálogo que o site mostra. **Em produção:** Deploy Painel verde e
        `painel.asaf.org.br/version.json` = `ef4e080`.
      - **Lote 15 ✅ FEITO, provado na homologação e confirmado em produção (2026-10-28, junto da v7.1d)**: `@hookform/resolvers` 6.0.1 → **6.0.2**, `lucide-react`
        1.62 → **1.63.0**, `react-router` 8.5.0 → **8.5.1** (painel) e `pytest` 9.1.1 → **9.2.0** (correções; o site já estava todo na última estável). Painel 759 e
        servidor 1657 em duas rodadas; regressões da v7.1d verdes na homologação.
      - **Directus 12.4.1 → 12.5.1:** continua adiado com o mesmo motivo (provar numa cópia descartável antes de trocar a imagem de produção e dizer o plano ao Presidente).
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
