# Regras globais — todos os projetos da IEADESPA

Valem em todos os repositórios e em todas as contas. As regras do `CLAUDE.md` de cada
projeto valem por cima destas. Gravadas em 17/11/2026.

## Qualidade e continuidade, não economia

- O objetivo é o trabalho não parar, com robustez. Nunca rebaixar o modelo de quem
  revisa, corrige ou caça defeitos para poupar cota.
- Um agente por vez.
- Tudo em português do Brasil e no padrão brasileiro (vírgula decimal, datas dd/mm/aaaa).
- Nunca gravar senha, chave de acesso ou dado pessoal (CPF, endereço) na memória ou no
  `HANDOFF.md`.

## Início de sessão (e depois de /clear)

1. Ler o `HANDOFF.md` da raiz do repositório, se existir.
2. Consultar a memória do projeto no servidor MCP `memoria-projeto` (`search_nodes` ou
   `read_graph`) antes de alterar código.
3. Conferir `git status` e o ramo atual.

## Primeira vez num repositório (sem `HANDOFF.md`)

Fazer sozinho, no começo da primeira conversa, antes do pedido do usuário (ele não
precisa pedir nada de especial; depois, seguir com o que ele pediu):
1. Ler `CLAUDE.md`, `README`/`LEIA-ME`, plano de trabalho e a memória automática do
   Claude desse projeto, se houver.
2. Migrar para o servidor os fatos duráveis: arquitetura, regras de negócio, decisões do
   usuário, defeitos resolvidos e pendências. Não copiar o que o repositório já registra
   (código, histórico do Git, documentação).
3. Criar o `HANDOFF.md` (modelo abaixo) e o `AGENTS.md`, que aponta para o `CLAUDE.md`,
   o `HANDOFF.md` e o servidor "se estiver configurado neste computador" (é o arquivo
   que o Codex lê).
4. Pôr `/HANDOFF.md` no `.gitignore` do repositório: o estado do trabalho é de cada
   pessoa e nunca vai para o Git (decisão de 17/11/2026).
5. Copiar o kit `C:\MCP\continuidade\` para `.claude/continuidade/` do repositório e
   citá-lo numa linha no guia de colaboração (`COMO-COLABORAR`, `CONTRIBUTING` ou
   `README`): quem quiser a memória no próprio computador segue o `LEIA-ME.md` do kit.
6. O `AGENTS.md`, o `.gitignore` e o kit vão para o Git pelas regras de commit daquele
   repositório; se ele não disser como, perguntar antes de registrar.

## Passagem de bastão: a cada marco, não só no fim

A cota acaba sem aviso (no VS Code o saldo não aparece). A cada marco (commit, resultado
de agente, decisão do usuário, antes de mudar de assunto):
a) Gravar no servidor `memoria-projeto` as decisões de arquitetura, regras de negócio e
   defeitos resolvidos, em observações curtas com data.
b) Atualizar o `HANDOFF.md`: (1) o que foi concluído, (2) arquivos alterados, (3)
   pendências e erros conhecidos, (4) próximo passo exato, inclusive agente em andamento
   e o diário dele.

Antes de encerrar, de trocar de conta ou de ferramenta (Claude ↔ Codex), fazer a passagem
completa. Ao concluir uma tarefa ou antes de mudar de assunto, lembrar o usuário de rodar
`/clear` depois da passagem.

## O que vai onde

- **O repositório** é a memória comum entre pessoas: decisão que outro colaborador
  precisa saber vai para os documentos dele, não só para o servidor.
- **Servidor `memoria-projeto`** (`C:\MCP\memorias\<repositório>.jsonl`, compartilhado
  com o Codex, pessoal de cada computador): fatos duráveis do projeto. O arquivo de
  memória nunca é compartilhado entre pessoas.
- **`HANDOFF.md`**: só o estado atual do trabalho. É substituído a cada marco, não acumula
  histórico.
- **Memória automática do Claude**: como trabalhar com o usuário (preferências, correções).

Modelo do `HANDOFF.md`:

```markdown
# Passagem de bastão — <repositório>

Atualizado em dd/mm/aaaa hh:mm (Claude ou Codex).

## 1. Concluído
## 2. Arquivos alterados (ainda não registrados no Git)
## 3. Pendências e erros conhecidos
## 4. Próximo passo exato
```
