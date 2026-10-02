# Instruções para o Claude neste repositório

## Fluxo padrão: implementar → testar → comitar → enviar → confirmar em produção

O usuário não lê nem revisa código — não tem como. A única forma real dele verificar qualquer
coisa é vendo funcionar em produção. Por isso, depois de implementar e testar uma mudança (suíte
completa passando, localmente, mais de uma vez), **comitar e enviar para o `main` direto, sem
parar para pedir confirmação** — isso já dispara `Deploy API`/`Deploy Painel` (GitHub Actions).
Não é preciso perguntar "posso enviar?" a cada mudança; é o padrão esperado deste projeto.

Depois do push, sempre:

1. Acompanhar os workflows (`gh run list`, `gh run watch`) até `Deploy API`/`Deploy Painel`
   ficarem verdes.
2. Se o CI encontrar um achado real (teste quebrando, formatação, o que for) — investigar a causa
   raiz e corrigir, nunca reverter ou pular etapa (`--no-verify` etc.) pra fazer passar.
3. Confirmar ao vivo em produção (não só CI verde): `painel.asaf.org.br/version.json` batendo o
   commit, uma chamada direta a alguma rota nova (`GET`, sem efeito colateral) respondendo como
   esperado. Mesmo padrão já usado em toda a FASE 4 do `PLANO_PROJETO.md`.
4. Só então marcar o item correspondente como `[x]` no `PLANO_PROJETO.md`, com um parágrafo curto
   registrando o que foi verificado (mesmo formato dos blocos já existentes no arquivo).

Isso não dispensa cuidado — só remove a pausa de pedir permissão pra enviar. Ações
destrutivas/irreversíveis continuam exigindo confirmação explícita de qualquer forma (isso é regra
geral, não específica deste repositório).

## MFA do painel não é renegociável por pedido avulso

Já foi pedido (2026-09-30) para remover a exigência de MFA do painel pra que o Claude conseguisse
logar direto e conferir visualmente. **Não fazer isso.** MFA é decisão congelada
(`DECISOES_CONGELADAS.md` §3.1) — "o módulo mais testado do sistema até agora", proteção real
sobre dado de associado/financeiro de uma associação. A própria regra de uso do arquivo já diz: só
se reabre com motivo concreto e grave, nunca "pra facilitar verificação". A verificação de
produção não precisa de login no painel — `gh run list`/`gh run watch` (CI), chamada direta a
endpoint público/`openapi.json`, e `version.json` já bastam e é o que este projeto usa desde
sempre (ver qualquer bloco de confirmação de versão no `PLANO_PROJETO.md`). Se a real necessidade
por trás do pedido for diferente disso (ex.: dar ao Claude uma conta de teste própria, sem MFA,
separada de qualquer usuário real, só em ambiente de homologação), isso é uma decisão nova a
discutir explicitamente com o usuário — nunca assumir.

## Tudo na última versão — regra permanente (definida pelo usuário em 2026-10-01)

O usuário exige que **todo componente esteja sempre na versão mais recente**: pacotes (npm, pip),
imagens Docker (Python, Directus...), Node, ações do GitHub e serviços do Azure (Postgres). Nas
palavras dele: "coisa desatualizada não pega bem; a perpetuidade do sistema é estar tudo atualizado
e moderno". Prefere a versão mais nova mesmo quando for **beta/candidata**, se existir.

Como aplicar (isto **é** a autorização geral dele para atualizar — não perguntar de novo):

1. **Sempre que começar uma versão/fase, ou tocar num componente**, conferir o que está
   desatualizado (`npm outdated` em `painel/` e `site/`, `pip list --outdated`, tags do Docker Hub,
   versões das actions, `endoflife.date`) — **o `npm outdated` esconde majors cujo `engines` exclui o
   Node local (22.12)**: rode-o sob Node 26 (`npx -y node@26 …`) e confirme cada pacote com
   `npm view <pacote> dist-tags.latest` — e atualizar **no fluxo de sempre**: implementar → suíte
   completa mais de uma vez → commit → push → CI → confirmar em produção. A regra manda
   **atualizar**, nunca pular os portões de teste (vale igual para dinheiro, voto e LGPD).
2. **Nunca fixar versão antiga "porque funciona".** Se uma atualização maior quebrar algo, resolver
   a causa. Só adiar com registro explícito no `PLANO_PROJETO.md` (o motivo concreto e o que
   bloqueia), nunca em silêncio. Se o bloqueio for uma ferramenta que não aceita a versão nova,
   procure o caminho oficial antes de desistir: o **TypeScript 7** roda **lado a lado** com o 6
   (`"@typescript/native": "npm:typescript@^7"` dá o `tsc`; `"typescript":
   "npm:@typescript/typescript6@^6"` é a API que `typescript-eslint` e `astro check` ainda exigem) —
   reavaliar a cada lote até essas ferramentas aceitarem a 7.1.
3. **Pré-lançamento (beta/rc/canary)**: adotar quando for mais novo que a estável e a suíte
   passar. Não é adiamento usar a estável quando o único pré-lançamento disponível é *mais antigo*
   que ela (ex.: `12.0.0-rc.2` do Directus, já superada pela `12.4.1` estável).
4. **Atualização de versão maior em produção** (Directus, Postgres, imagem base) é mudança de
   infraestrutura: dizer o plano de volta, e confirmar por prova (ping, versão, log). O sistema de
   segurança do Claude Code já bloqueou "deploy em produção" de versão maior sem autorização
   explícita na conversa; se bloquear, parar e avisar o usuário — nunca contornar.
5. Os lotes e o estado atual estão no `PLANO_PROJETO.md` (item "Atualização contínua").
