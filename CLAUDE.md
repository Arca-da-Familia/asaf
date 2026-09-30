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
