# Manual de operação do sistema da ASAF (runbook)

Escrito para quem **não** construiu o sistema e precisa mantê-lo de pé (v8.4b, 2026-11-03). Cada seção diz **quando** usar, **o que fazer** e **como
conferir**. Os comandos são do Azure CLI (`az`), rodados num computador com o `az` instalado e logado na conta que administra o Azure
(`az login --use-device-code`, com o e-mail do domínio arcadafamilia.org.br; o login pelo navegador às vezes abre a conta errada). Tudo o que dá para
fazer pelo GitHub (botões em **Actions**) vem primeiro, porque não precisa instalar nada.

> **Regra de ouro:** mudança arriscada se faz **primeiro na homologação** (o ambiente de teste, com dados inventados) e só depois na produção. A
> produção nunca recebe dado de teste.

## 1. O que é o quê

| Parte | Endereço | Onde fica no Azure (grupo `Associacao-RG`) |
|---|---|---|
| Site público | asaf.org.br | Static Web App `asaf-site` |
| Painel (a área de quem trabalha) | painel.asaf.org.br | Static Web App `asaf-painel` |
| API (o "motor" do painel e do site) | api.asaf.org.br | Container App `asaf-api` |
| Editor de notícias do site | cms.asaf.org.br | Container App `asaf-directus` |
| Banco de dados | — | PostgreSQL `asaf-pg-server` (bancos `asaf` e, para teste, `asaf_hml`) |
| Arquivos (fotos, atas, documentos) | — | Conta de armazenamento `stasafprivado` (privada) |
| Senhas e chaves | — | Cofre `kv-asaf-arca` |
| Endereço (DNS) do domínio | — | Zona `asaf.org.br` (com DNSSEC; o código DS está no Registro.br) |
| Homologação (teste) | hml-site / hml-painel / hml-api .asaf.org.br | `asaf-site-hml`, `asaf-painel-hml`, `asaf-api-hml`, `stasafhmlprivado` |

O código está no GitHub (`Arca-da-Familia/asaf`). **Toda publicação é automática**: o que entra na `main` vai para a produção pelos fluxos `Deploy API`,
`Deploy Painel` e `Deploy Site`.

## 2. Está tudo no ar?

- **O monitor automático** confere o site, o painel, a API e o exame de saúde a cada 15 minutos. Se algo ficar fora do ar por mais de uma rodada, ele abre
  um aviso no GitHub (Issues) com o título **"ALERTA: o site, o painel ou a API da ASAF não está respondendo"**, e o fecha sozinho quando volta.
- **Exame de saúde da API:** abra https://api.asaf.org.br/health. O certo é `{"status":"ok","banco":"ok","armazenamento":"ok"}`. Se vier `falha`,
  ele diz o quê (o banco ou o armazenamento). A primeira resposta pode levar até ~40 segundos: a API dorme quando ninguém usa.
- **Qual versão está no ar:** https://painel.asaf.org.br/version.json e https://asaf.org.br/version.json mostram o código (`commit`) publicado.

## 3. Ver o que deu errado (os registros)

- **Pelo Portal do Azure:** Container Apps > `asaf-api` > **Fluxo de log** (Log stream) mostra o que a API está escrevendo agora; **Application Insights**
  (`asaf-appinsights`) > Falhas mostra os erros dos últimos dias.
- **Pelo `az`:** `az containerapp logs show --name asaf-api --resource-group Associacao-RG --tail 100` (acrescente `--follow` para acompanhar ao vivo).
- **As rotinas automáticas** (lembretes, prazos, retenção) rodam no GitHub Actions: abra a execução vermelha em **Actions**. O registro delas é público e
  não traz dado pessoal (v7.3d): para o detalhe de um erro, rode a mesma rotina na homologação.

## 4. Reiniciar a API

Quando: a API não responde e o exame de saúde não volta sozinho em alguns minutos (as sondas já reiniciam sozinhas uma cópia travada, v8.4a).

```bash
az containerapp revision list --name asaf-api --resource-group Associacao-RG -o table
az containerapp revision restart --name asaf-api --resource-group Associacao-RG --revision <nome da revisão ativa>
```

Conferir: https://api.asaf.org.br/health volta a dizer `ok`.

## 5. Voltar a API a uma versão anterior

Quando: uma versão nova da API quebrou algo e é preciso voltar enquanto se corrige.

**GitHub > Actions > "Voltar a API a uma versão anterior" > Run workflow**: escolha o ambiente e cole o código da versão boa (os 7 primeiros caracteres do
`commit`, por exemplo o que o `version.json` mostrava antes). O fluxo recoloca a imagem guardada daquela versão e confere que a API responde. Testado na
homologação em 2026-11-03.

Cuidado: voltar a API **não volta o banco**. Até hoje as mudanças de banco deste sistema só acrescentam (tabela, coluna), e a versão anterior funciona com o
banco mais novo; se um dia uma versão apagar ou renomear algo no banco, voltar a imagem não basta (peça ajuda técnica). O painel e o site voltam pelo
caminho normal: desfazer o commit na `main` (`git revert`) e deixar a publicação automática rodar.

## 6. Restaurar uma cópia de segurança

**Banco:** o Azure guarda cópias por **35 dias**, com uma cópia em outra região. A restauração cria um **servidor novo** (nunca escreve por cima do atual):

```bash
az postgres flexible-server restore --resource-group Associacao-RG --name asaf-pg-restaurado \
  --source-server asaf-pg-server --restore-time "2026-11-03T12:00:00Z"
```

Use a hora em UTC (Belém + 3 horas) de um momento **antes** do problema. Depois, confira os dados no servidor novo e só então decida, com a Diretoria,
se a API passa a usar ele (trocar a senha de conexão `dburl`, seção 7). Faça um ensaio na homologação antes de precisar de verdade.

**Arquivos:** a conta `stasafprivado` tem **lixeira de 25 dias** e guarda as versões anteriores de cada arquivo. Portal > Contas de armazenamento >
`stasafprivado` > Contêineres > (o contêiner) > ligue "Mostrar blobs excluídos" > selecione > **Restaurar**.

## 7. Trocar uma chave do sistema (rotação)

**Isto NÃO é a senha das pessoas.** As "senhas" do cofre são **chaves de máquina**: a que a API usa para entrar no banco, a do e-mail automático, a que
publica o site. Ninguém as digita nem as decora; são sorteadas pelo computador e ficam no cofre. A senha de cada pessoa para entrar no painel **não tem
troca obrigatória** (troca forçada leva a senha fraca ou anotada em papel); só se troca quando há suspeita de vazamento.

Quando trocar as chaves de máquina: quando alguém com acesso técnico ao Azure sair e na hora em que houver suspeita de vazamento (registre em Privacidade >
Incidentes); a troca periódica está em decisão do Presidente (2026-11-03).

**Atenção:** as senhas da API ficam **copiadas** dentro do Container App (não são lidas do cofre a cada vez). Trocar uma senha é sempre: (1) gerar a nova,
(2) gravar no **cofre** (para não se perder), (3) gravar no **Container App** e (4) reiniciar. Faça antes na homologação (`asaf-api-hml`, segredos `HML-*`).

```bash
# exemplo: a chave dos logins (JWT). Efeito: todo mundo precisa entrar de novo no painel.
NOVA=$(python -c "import secrets; print(secrets.token_urlsafe(48))")
az keyvault secret set --vault-name kv-asaf-arca --name JWT-SECRET --value "$NOVA" -o none
az containerapp secret set --name asaf-api --resource-group Associacao-RG --secrets jwtsecret="$NOVA" -o none
az containerapp revision restart --name asaf-api --resource-group Associacao-RG --revision <revisão ativa>
```

A senha do banco (`DATABASE-URL` no cofre, `dburl` na API) se troca também no servidor do banco (`az postgres flexible-server update --admin-password`),
na mesma hora; a do e-mail (`SMTP-SENHA`/`smtp-senha`) é a senha de app do Google. Depois de trocar, anote a data na tabela abaixo.

**Datas da última troca** (do cofre, conferidas em 2026-11-03; nenhuma tem data de validade):

| Chave (cofre) | Última troca | Próxima (se houver troca periódica) |
|---|---|---|
| DATABASE-URL, STORAGE-ACCOUNT-KEY, STORAGE-CONNECTION-STRING, DIRECTUS-KEY, DIRECTUS-ADMIN-PASSWORD, SWA-SITE-DEPLOY-TOKEN, SWA-PAINEL-DEPLOY-TOKEN | 2026-09-10 | 2027-09 |
| JWT-SECRET | 2026-09-11 | 2027-09 |
| SMTP-HOST, SMTP-PORTA, SMTP-USUARIO, SMTP-SENHA, SMTP-REMETENTE | 2026-09-17 | 2027-09 |
| DIRECTUS-SECRET | 2026-10-02 | 2027-10 |
| DIRECTUS-SITE-TOKEN | 2026-10-03 | 2027-10 |
| HML-DATABASE-URL, HML-JWT-SECRET, HML-ADMIN-SENHA, SWA-PAINEL-HML-DEPLOY-TOKEN, SWA-SITE-HML-DEPLOY-TOKEN | 2026-10-05 | 2027-10 |
| HML-USUARIOS | 2026-10-19 | 2027-10 |

Para atualizar a tabela: `az keyvault secret list --vault-name kv-asaf-arca --query "[].{nome:name, atualizado:attributes.updated}" -o table`.

## 8. O site ou o painel caiu

1. Abra o aviso do monitor (Issues) ou confira os três endereços e o `/health` (seção 2).
2. Só a API fora? Seção 3 (o que diz o registro) e seção 4 (reiniciar). Começou depois de uma publicação? Seção 5 (voltar a versão).
3. O site e o painel são páginas estáticas: se só eles caíram e a API está bem, veja em **Actions** se o último `Deploy Site`/`Deploy Painel` falhou e
   rode de novo (Re-run).
4. Nada abre (nem o domínio)? Confira o DNS (Portal > Zonas DNS > `asaf.org.br`) e o Registro.br (o domínio está pago? o DS do DNSSEC continua lá?).
5. Se houver risco a dados pessoais, registre em **Privacidade > Incidentes de segurança** (o prazo de 3 dias úteis conta de quando se soube).

## 9. Custo

- **Onde ver:** Portal > Gerenciamento de Custos > Análise de custo (assinatura). O **orçamento de US$ 150/mês** manda aviso por e-mail para
  asaf@arcadafamilia.org.br.
- **Revisão a cada 3 meses**, registrada no `PLANO_PROJETO.md` (v8.4). A primeira (2026-11-03): agosto R$ 23,39; setembro R$ 28,87; outubro R$ 119,38
  (Container Apps R$ 79,23, registro de imagens R$ 37,18, DNS R$ 2,76); novembro até o dia 3, R$ 2,65. Bem abaixo do teto de US$ 100/mês. Próxima
  revisão: fevereiro de 2027 (o crédito de ONG de US$ 2.000 vence em 05/02/2027; renovação não confirmada).

## 10. Rotinas automáticas (GitHub Actions)

| Fluxo (nome em Actions) | Quando (hora UTC) | O que faz |
|---|---|---|
| Monitorar o site (está no ar?) | a cada 15 min | confere site, painel, API e `/health`; abre e fecha o aviso |
| Tarefa Diária (lembretes de mensalidade por e-mail) | todo dia, 12:00 | lembretes de mensalidade |
| Tarefa Periódica (expira promoções de lista de espera vencidas) | a cada 15 min | vagas, prazos de atendimento, retenção de dados, avisos agendados e por e-mail |
| Tarefa Periódica (fecha financeiramente eventos encerrados) | todo dia, 06:00 | fecha os eventos encerrados |
| Tarefa Mensal (cobrança do mês + contas a pagar recorrentes) | dia 1, 09:00 | rotina financeira do mês |
| Réplicas da API em dia de evento | a cada 3 horas | sobe o mínimo de cópias da API em dia de evento |
| Sincronizar site com o sistema | a cada 15 min | republica o site quando o conteúdo muda |
| Voltar a API a uma versão anterior | só à mão | seção 5 |

Uma rotina vermelha não para o sistema: abra a execução, leia o erro e, se não for passageiro (rede, Azure), corrija pelo caminho normal (homologação
primeiro).
