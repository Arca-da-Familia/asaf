# Ambiente de homologação (teste) da ASAF

Uma cópia do sistema **só para teste, com dados inventados**. Existe por um motivo: **na produção não se cria dado de teste**. A
auditoria registra tudo e não tem "excluir" (de propósito: o próprio banco recusa apagar lançamento e auditoria), então qualquer teste
feito lá ficaria para sempre e alguém, daqui a anos, teria de explicar o que eram. Na homologação dá para criar, errar e **apagar o
banco inteiro**, sem deixar rastro na produção.

## Endereços

| O quê | Endereço |
| --- | --- |
| Painel de teste | `https://hml-painel.asaf.org.br` |
| Site de teste | `https://hml-site.asaf.org.br` |
| API de teste | `https://hml-api.asaf.org.br` |

Todos mostram a faixa **AMBIENTE DE TESTE**, pedem aos buscadores para **não indexar** (`noindex` e `robots.txt` bloqueando tudo) e a API
de teste **só aceita chamadas do painel e do site de teste** (a produção não consegue falar com ela, e vice-versa).

## O que é separado da produção

- **Banco:** `asaf_hml`, dentro do mesmo servidor Postgres, com um usuário próprio (`asaf_hml`, no máximo 5 conexões) que só é dono desse
  banco. Não há custo extra de servidor.
- **Armazenamento privado:** conta própria `stasafhmlprivado` (LRS), com o próprio acesso da API de teste.
- **Segredos:** `HML-DATABASE-URL`, `HML-JWT-SECRET`, `SWA-PAINEL-HML-DEPLOY-TOKEN`, `SWA-SITE-HML-DEPLOY-TOKEN` (e, depois de popular,
  `HML-ADMIN-SENHA` e `HML-USUARIOS`) no Key Vault. Nenhum segredo da produção é usado no dia a dia da homologação.
- **Sem e-mail:** a API de teste não tem as variáveis de envio, então nenhum e-mail sai.
- **Sem Directus próprio:** o site de teste não tem notícias (o editor de notícias é um só, o de produção).
- **Sem verificação em dois passos (MFA)** — decisão do presidente em 2026-10-05: aqui só entram dados inventados, e o segundo passo
  já é provado na produção e pela suíte. O roteiro `popular` desliga a exigência **só no banco `asaf_hml`** (confere o nome do banco antes
  de gravar e recusa qualquer outro; um teste prova). **A produção continua com a exigência ligada** (`DECISOES_CONGELADAS.md` §3.1).
  Quem entra no painel de teste usa só CPF e senha.

## Como usar

**Publicar a versão atual no ambiente de teste** (GitHub → Actions → *Deploy Homologação (ambiente de TESTE)* → *Run workflow*):

- `resetar_banco` (desligado por padrão): **apaga o banco de teste inteiro** e o recria vazio. Só ele; a produção nunca é alcançada
  (o nome do banco é fixo no script `scripts/homologacao_banco.py`, e um teste prova isso).
- `popular` (desligado por padrão): depois de publicar, preenche o banco de teste com **dados inventados** pelas rotas de verdade do
  sistema (`scripts/popular_homologacao.py`). Só roda em banco **sem nenhum usuário**; para recomeçar, use junto com `resetar_banco`.

O fluxo **nunca dispara sozinho**: só quando alguém clica.

**Entrar:** as senhas dos usuários de teste ficam no Key Vault `kv-asaf-arca` (Portal do Azure → Cofres de chaves → Segredos):
`HML-ADMIN-SENHA` (a senha do Presidente de teste) e `HML-USUARIOS` (um texto com a senha do Secretário e a do Tesoureiro de teste).
Os CPFs são inventados e não são segredo:

| Usuário de teste | CPF | Senha | O que ele pode (vem do cargo) |
| --- | --- | --- | --- |
| Presidente (administrador) | 111.000.111-88 | `HML-ADMIN-SENHA` | tudo, inclusive aprovar publicação |
| 1º Secretário | 222.023.757-59 | `HML-USUARIOS` (secretario) | documentos e aprovação de publicação |
| 1º Tesoureiro | 222.039.595-25 | `HML-USUARIOS` (tesoureiro) | financeiro e parcerias/emendas |

Não há segundo passo: CPF e senha bastam. Para testar o fluxo "quem criou não aprova", entre com o Secretário ou o Tesoureiro para
preparar e com o Presidente para aprovar. Dá para criar, aprovar, desfazer e errar à vontade; se quiser recomeçar do zero, rode o fluxo
com `resetar_banco` + `popular`.

## Custo e cuidados

- A API de teste **desliga sozinha** 5 minutos depois do último acesso e só cobra os minutos em que está acordada
  (cerca de US$ 0,054 por hora). Uso normal: de US$ 1 a 5 por mês, dentro do crédito de organização sem fins lucrativos da assinatura.
- **Nunca** aponte os vigilantes automáticos (`monitorar-site.yml`, `sincronizar-site.yml`, tarefas periódicas) para a API de teste:
  chamadas a cada poucos minutos a mantêm acordada o mês inteiro (até US$ 42).
- Mantenha o banco de teste **pequeno**: o servidor é compartilhado com a produção e o disco não cresce sozinho.
- Há um orçamento mensal na assinatura (`orcamento-mensal-150-dolares`) com avisos a 50%, 80% e 100%.

## Desmontar (se um dia não for mais preciso)

Apagar, no grupo `Associacao-RG`: o Container App `asaf-api-hml`, os Static Web Apps `asaf-painel-hml` e `asaf-site-hml`, a conta de
armazenamento `stasafhmlprivado`, o banco e o papel `asaf_hml` do servidor Postgres, os registros DNS `hml-api`, `hml-painel`, `hml-site`
(e `asuid.hml-api`) e os segredos `HML-*` e `SWA-*-HML-*` do Key Vault. Nada da produção depende deles.
