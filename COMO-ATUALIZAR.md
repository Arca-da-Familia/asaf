# Como atualizar o site da ASAF

Este guia é para quem edita o site (diretoria e comunicação). Não precisa saber programar.

**Regra de ouro:** o site tem duas fontes, e cada coisa mora em um só lugar.

| O que você quer mudar | Onde mora | Onde mexer |
| --- | --- | --- |
| **Notícias** e fotos do site | Editor do site (Directus) | `https://cms.asaf.org.br` |
| Diretoria, projetos, eventos, editais de assembleia | Sistema da ASAF | O painel do sistema (`painel.asaf.org.br`) |
| Documentos oficiais (atas, certidões, balanços, termos) | Sistema da ASAF | O painel, módulo **Documentos** (veja abaixo) |
| Emendas parlamentares, parcerias, parcelas, pagamentos, etapas e prestação de contas | Sistema da ASAF | O painel, módulo **Parcerias e emendas** (veja abaixo) |
| Quem ocupa cada cargo da Diretoria e do Conselho Fiscal | Sistema da ASAF | O painel, **Governança → Mandatos** (veja abaixo) |
| Projetos (como o **Despertai**), eventos, fotos e relatórios de evento | Sistema da ASAF | O painel, **Projetos** e **Eventos** (veja abaixo) |

> **Nunca coloque documento oficial (ata, estatuto, certidão, termo) no Editor do site.** Eles têm RG, CPF e outros
> dados pessoais e precisam de controle próprio, que fica no sistema.

---

## Publicar uma notícia (Editor do site)

1. Entre em **https://cms.asaf.org.br** com o seu e-mail e senha (pode pedir um código do celular).
2. No menu da esquerda, clique em **Notícias** e depois em **Criar**.
3. Preencha, nesta ordem:
   - **Conteúdo:** Título, Endereço da notícia, Resumo e Texto.
     - *Endereço da notícia (slug):* só letras minúsculas sem acento, números e hífen. Ex.: `encontro-de-familias-outubro`.
       **Não mude depois de publicada**, senão o link que já foi compartilhado para de funcionar.
     - *Resumo:* uma ou duas frases. É o que aparece na lista e na prévia do WhatsApp.
   - **Foto da notícia (opcional)** — veja as regras abaixo.
   - **Publicação:** *Situação* e *Publicar em* (data).
4. Escolha a **Situação**:
   - **Rascunho** — só você vê; ainda está escrevendo.
   - **Em revisão** — pronta, esperando alguém conferir.
   - **Publicado** — vai para o site.
   - **Arquivado** — sai do site e fica guardada.
5. Clique em **Publicar** (ou **Salvar**) no alto da tela.

**Quem pode publicar:** o *Editor de conteúdo* publica. O *Redator* só escreve rascunhos e manda para revisão.

### Quanto tempo leva para aparecer no site?

O site confere o Editor a cada **15 minutos** e, se algo mudou, publica sozinho. Então, **normalmente**, a notícia aparece
**de 15 a 30 minutos** depois de salva. Atenção: quem dispara essa conferência é o agendador do GitHub, que **às vezes atrasa**
(já houve intervalos de horas). Se o site ficar **mais de 2 horas** atrás, o sistema abre um aviso sozinho (veja o fim deste
guia). Não existe nenhum passo a mais para você: salvou como **Publicado**, o resto é automático.

Notícia com **data de publicação no futuro** só aparece quando a data chegar.

### Regras da foto (obrigatórias — a lei de proteção de crianças e de dados exige)

Uma notícia **com foto** só vai ao ar se:

1. a **Descrição da foto (texto alternativo)** estiver preenchida — ela descreve a foto para quem não enxerga
   (ex.: *"Crianças lendo livros no pátio da sede"*); e
2. a caixa **Autorização de imagem** estiver marcada — marque **somente** se há autorização de uso da imagem
   (dos responsáveis, no caso de crianças e adolescentes).

Se faltar uma das duas, **a notícia inteira não é publicada** (não só a foto) e aparece um aviso amarelo no resumo da
publicação do site (GitHub → Actions → *Deploy Site*). Corrija e salve de novo.

### Ligar a notícia a um projeto ou evento (Despertai, por exemplo)

Na notícia, abra a seção **Ligada a um projeto ou evento (opcional)** e digite o **Número do projeto** e/ou o **Número do
evento**. Os dois números aparecem **no alto da página do projeto ou do evento, no painel** (e a tela de cada evento tem o
botão *Escrever notícia deste evento*, que abre este editor). Pronto: a notícia aparece sozinha na página do projeto e/ou
do evento no site (na página do projeto, as **6 mais recentes**) e, na própria notícia, ganha o link *Sobre o projeto…* / *Sobre o evento…*. Se o número não existir
(ou o projeto/evento for **Interno**), a notícia **é publicada mesmo assim, só sem a ligação**, e o resumo da publicação
(GitHub → Actions → *Deploy Site*) avisa o motivo.

### Listas prontas

Em **Notícias**, o menu tem atalhos: **Todas as notícias**, **Para revisar**, **Rascunhos** e **No ar**.

### Tirar uma notícia do ar

Mude a **Situação** para **Arquivado** (ou Rascunho) e salve. Normalmente em 15 a 30 minutos ela sai do site.

### Corrigir uma notícia já publicada

Edite, salve — o site é atualizado no mesmo ciclo. O Editor guarda o **histórico de versões**: dá para ver e voltar a uma
versão anterior (ícone de relógio, à direita).

---

## Documentos oficiais (painel → Documentos)

O sistema guarda o **original** de cada documento em área **privada** (ninguém de fora enxerga, cada download fica
registrado). O que vai ao site é uma **versão pública**, conferida pelo sistema e aprovada por **outra pessoa**.

### Cadastrar e enviar para o site

1. No painel, abra **Documentos → Novo documento**. Escolha o **tipo**, dê um **título** e responda *quem pode ler o
   original*: **Pública** (qualquer pessoa; ex.: estatuto, balanço), **Interna** (só a associação) ou **Restrita** (tem RG,
   CPF, endereço; ex.: ata assinada).
2. Se for para o site, deixe marcado **Publicar no site de transparência**. Anexe o arquivo original (PDF, JPG ou PNG, até
   25 MB). Ele fica guardado em área privada.
3. Na tela do documento, envie a **versão pública**. Ela pode ser de **dois jeitos**:
   - **PDF com texto**, em que os dados pessoais foram **apagados de verdade** (não vale só desenhar uma tarja preta por
     cima: o texto continua dentro do arquivo). Documento *Pública* pode usar o próprio original (botão **Usar o original
     como versão pública**);
   - **Texto colado no sistema** (campo **Ou cole o texto da versão pública** e o botão **Enviar o texto e conferir**): serve
     para o que o público lê como página.
     O exemplo é o **Estatuto**: o PDF registrado em cartório (com as assinaturas) fica como **original interno**, e o
     texto do estatuto, **já sem as assinaturas**, é colado aqui e vira uma página do site. O texto passa pela **mesma
     conferência** do PDF e, se for aprovado, o site mostra **exatamente** aquele texto (o sistema confere que nada mudou
     no caminho). Os dois jeitos seguem os mesmos passos de aprovação.
4. O sistema **confere na hora** e mostra o resultado. Ele **barra** a versão pública se encontrar estes padrões: CPF (com
   pontos ou, sem pontos, quando os dígitos conferem); número de RG, CNH, título de eleitor, PIS ou carteira de trabalho
   escrito junto do nome do documento (ex.: *"RG 1234567"*) ou no formato 00.000.000-0 (um RG solto, sem nada que o identifique,
   pode passar); e-mail que não seja da ASAF; celular que não seja o da ASAF; PDF que é
   só imagem escaneada (mais da metade das páginas sem texto); PDF com senha, danificado, com programa dentro ou com arquivo
   embutido. Texto escondido em campos de formulário e anotações do PDF **também é conferido**. Ele só **avisa** (e quem
   aprova lê com atenção) de página sem texto, telefone fixo, CEP que não seja o da sede e expressões como "residente" ou
   "data de nascimento". **Importante:** a conferência é automática e não substitui os olhos de quem aprova — nome de pessoa
   ou endereço, por exemplo, o sistema não consegue garantir.
5. Clique em **Enviar para revisão**. Quem **criou o documento ou o enviou para revisão não pode aprová-lo**: precisa ser outra
   pessoa que tenha a permissão de *aprovar publicação*. Quem aprova abre a versão pública, confere e clica em **Aprovar a
   publicação** (ou **Recusar**, com o motivo; o documento volta a rascunho).
6. Aprovado, o documento entra no site em **/transparencia/documentos/**, organizado por tipo e ano, em endereço fixo.

**Retirar do site:** quem aprova pode **Retirar do site** (com o motivo). Sai do site, mas o histórico fica guardado.
**Documento novo no lugar do antigo** (estatuto reformado, balanço retificado): use **Criar nova versão**; a antiga
continua publicada até a nova ser aprovada.

> **Título e descrição também vão ao site** e o sistema barra os padrões de CPF, RG, e-mail pessoal e celular neles (nome e
> endereço de pessoa ele não detecta).

### Atas

Em **Governança → Atas**, o botão *Anexar documento* guarda o documento assinado como **original privado** (Restrito) na
biblioteca de Documentos. Só quem tem a permissão de **originais sigilosos** consegue baixar. Para a ata ir ao site, abra o
documento na biblioteca, marque *Publicar no site* e siga os passos acima.

---

## Emendas e parcerias (painel → Parcerias e emendas)

Cada parceria tem **um centro de custo só dela** (código `PARC-0001`, `PARC-0002`…), criado sozinho. **O dinheiro não se
digita de novo**: o que entrou e saiu é lido do **livro-caixa** por esse centro de custo.

1. **Nova parceria:** tipo (emenda parlamentar, termo de fomento…), ano, título, objeto (o que será feito), valor total,
   órgão concedente, proponente (vereador), número da emenda, identificador único, número do termo e vigência.
2. **Parcelas:** cadastre as parcelas previstas. A soma delas **não pode passar** do valor total.
3. **No livro-caixa:** ao lançar um recebimento ou pagamento da parceria, marque o **centro de custo dela**.
4. **Movimentos a classificar:** o que foi lançado aparece na tela da parceria. Para cada movimento, escreva o **texto
   público** (ex.: *"Repasse da 1ª parcela"*). Em pagamento, escolha o tipo:
   - **Fornecedor:** aparece com razão social e CNPJ (o fornecedor precisa estar cadastrado no título pago);
   - **Equipe:** aparece **só a função** (ex.: *"Oficineiro de música"*) e o valor, **sem o nome da pessoa**;
   - **Tarifa ou taxa** e **Outro:** aparece só o texto público.

   **Não escreva nome de pessoa, CPF, telefone ou e-mail no texto público.** O sistema barra os padrões de CPF, RG, e-mail
   pessoal e celular, mas **não detecta nome nem endereço** — isso é com quem classifica e com quem aprova.
5. **Etapas de execução** (oficinas, entregas), com **fotos** (veja a regra logo abaixo), e **relatórios / prestação de contas** (previsto, apresentado, prazo de
   análise e resultado: *regulares*, *regulares com ressalvas* ou *irregulares*). O resultado só existe depois de o
   relatório ser apresentado. A parceria só vira **Concluída** depois da prestação de contas final apresentada.
6. O painel mostra **pendências** em vermelho (travam a publicação: soma das parcelas acima do valor, recebido acima do
   valor, pago acima do recebido, movimento sem classificar) e **avisos** em amarelo (relatório atrasado, vigência vencida).
7. **Enviar para revisão** → **outra pessoa** (com a permissão de aprovar publicação) **aprova**. Quem criou ou enviou não
   aprova. Aprovada, a parceria aparece em **/transparencia/emendas/** (emenda) ou **/transparencia/parcerias/** (demais),
   com os arquivos de **dados abertos** em **/transparencia/dados/**.

**Depois de aprovada:** valor recebido e pago acompanham o livro-caixa sozinhos. Movimento novo só aparece **no detalhe**
depois de classificado (o site diz quantos faltam). Hoje, **alterações feitas depois da aprovação** (nova parcela, etapa,
texto de movimento) vão ao site **sem nova aprovação** e ficam registradas no **histórico** da parceria — quem edita responde
por isso. Para tirar do ar, quem aprova usa **Retirar do site**.

### Fotos das etapas e a autorização de imagem

Foto de oficina ou de entrega mostra pessoas, muitas vezes **crianças**. Por isso o sistema só aceita a foto se você:

1. **Marcar que há autorização de uso de imagem** de todas as pessoas que aparecem (dos **responsáveis**, no caso de criança
   ou adolescente). Em palavras simples: *alguém assinou um termo dizendo que pode publicar aquela foto*. Marque **somente**
   se esse termo existe de verdade. Se o termo assinado estiver na biblioteca de **Documentos** (classificação *Restrita*),
   informe o número dele no campo opcional;
2. **Descrever a foto para quem não enxerga** (ex.: *"Crianças tocando tambores na quadra da escola"*) — **sem nome de
   pessoa**; o sistema barra os padrões de CPF, RG, e-mail e celular nessa descrição (nome de pessoa ele não detecta: isso é
   com quem escreve).

O sistema **regrava a imagem**: some a localização (GPS) e o modelo do aparelho que o celular escreve dentro do arquivo,
a foto é girada para a posição certa e reduzida (no máximo 2000 pontos de lado). A foto fica em área **privada** e só vai
ao site quando a parceria é **aprovada**. Se alguém **retirar a autorização**, abra a etapa e clique em **Apagar** (ao lado
da foto): ela some do sistema na hora e **sai do site na próxima publicação** (normalmente em 15 a 30 minutos). **O armazenamento
do Azure ainda guarda uma cópia de segurança por 30 dias** (proteção contra apagar sem querer) e só depois a apaga de vez. Se o
armazenamento não conseguir apagar o arquivo, o painel mostra o erro e a foto continua cadastrada: tente de novo.

### A promessa das 24 horas

O site diz, enquanto não há emenda, que a página **"será atualizada em até 24 horas após qualquer recebimento"**. Para
isso valer: **lance o recebimento no livro-caixa com o centro de custo da parceria e classifique no mesmo dia**. Depois que
a parceria estiver aprovada, o site confere o sistema a cada **15 minutos** e publica sozinho (mais alguns minutos de
construção; o agendador do GitHub às vezes atrasa). Para a **primeira** emenda aparecer, além de cadastrar e classificar, **outra pessoa precisa aprovar**.

---

## Projetos, Despertai e eventos (painel → Projetos e Eventos)

O **Despertai** (o principal programa da associação, segundo a diretoria) deve ser cadastrado como um **projeto** do sistema. Cada
edição dele é um **evento** ligado a esse projeto. Tudo o que pertence a uma edição (relatório, fotos, notícias) fica no **mesmo lugar**, e a página do projeto no site
junta o conjunto sozinha.

1. **Criar o projeto:** painel → **Projetos → Novo projeto**. Escolha a visibilidade **Pública** (senão ele não tem página no
   site) e marque **Mostrar em destaque na página inicial do site** para o Despertai aparecer na página inicial. O nome e a
   descrição são o que o público lê: **escreva só o que é verdade e comprovável**; o sistema barra os padrões de CPF, RG,
   e-mail pessoal e celular nesses textos (nome e endereço de pessoa ele não detecta). Dá para **editar** depois (botão
   *Editar projeto*). O **Nº do projeto** aparece no alto da página dele (é o número que se digita na notícia). O destaque é
   escolha da diretoria: **desmarque-o** quando o projeto terminar ou for cancelado (o site não olha a situação do projeto).
2. **Criar cada edição:** **Eventos → Novo evento**, escolhendo o **Projeto**. Para uma edição nova do ano seguinte, use
   *Criar nova edição*: ela já nasce ligada ao mesmo projeto e **herda a visibilidade** do evento anterior — se o anterior é
   Público, a nova **já aparece no site** (no projeto e na página inicial) assim que for criada; o título novo e o texto herdado
   passam pela conferência de dado pessoal. O evento também pode ser **editado** depois (título, datas, local, visibilidade,
   projeto).
3. **Contexto do evento** (na tela de cada evento):
   - **Relatórios e documentos:** o botão *Novo relatório deste evento* abre o cadastro de documento já ligado ao evento. O
     relatório segue as **mesmas regras de todo documento** (versão pública em PDF ou em texto, conferência de dado pessoal,
     **aprovação por outra pessoa**; para ir ao site precisa estar com *Publicar no site de transparência* marcado, que já vem
     marcado). Aprovado, ele aparece sozinho na página do evento e na do projeto **e também na página de Transparência** — se o
     evento for Interno, o relatório continua na Transparência, mas o site não mostra a ligação com o evento.
   - **Fotos do evento:** só entram com a **autorização de imagem** confirmada e a **descrição da foto** (mesmas regras das
     fotos de etapa de parceria, explicadas acima). Dá para **apagar** a foto a qualquer momento: ela some do sistema na hora e
     **sai do site na próxima publicação**; o Azure guarda uma cópia de segurança por 30 dias. **Atenção:** a foto vai ao site
     assim que o evento for Público, **sem uma segunda pessoa conferir** (quem envia responde pela autorização); se o evento era
     Interno e vira Público, **todas** as fotos já enviadas aparecem de uma vez. A descrição da foto é lida por quem usa leitor
     de tela; não aparece como legenda.
   - **Notícias deste evento:** o botão abre o editor do site; digite o **Número do evento** (veja acima).
4. **O que aparece no site** (tudo sozinho, normalmente de 15 a 30 minutos depois): na **página inicial**, o projeto em destaque
   (com o próximo evento dele, se houver); na **página do projeto**, as edições, os relatórios, as fotos (as 12 mais recentes) e
   as notícias (as 6 mais recentes); na **página do evento**, o
   projeto, as outras edições, o relatório, as fotos e as notícias. **Só aparece o que já foi liberado**: evento Público,
   relatório Aprovado, foto com autorização. Projeto ou evento **Interno** nunca aparece.

> **Calendário oficial do município:** a data de um evento (por exemplo, a inclusão dele no calendário oficial da cidade) só deve ser
> citada no site **com o documento que a comprove** (lei ou decreto); esse documento entra pelo módulo **Documentos**.

---

## Diretoria e Conselho Fiscal no site

A página **/diretoria/** já mostra **todos os cargos** do Estatuto: os **sete** da Diretoria Executiva (Art. 19: Presidente,
1º e 2º Vice-Presidente, 1º e 2º Secretário, 1º e 2º Tesoureiro) e os **três** do Conselho Fiscal (Art. 24). Cargo sem
ocupante mostra **"Ocupante ainda não publicado"** (o site não afirma que o cargo está vago: a diretoria pode estar empossada e
ainda não registrada), para ir sendo preenchido. **Nenhum nome é digitado no site**: quando a Assembleia elege e a posse é
registrada em **Governança → Mandatos**, o nome (só o nome, o cargo e as datas do mandato) aparece sozinho, normalmente em 15 a
30 minutos. Mandato encerrado no sistema volta a mostrar *"Ocupante ainda não publicado"*.

---

## Quando algo não aparece

1. A **Situação** está *Publicado* e a data *Publicar em* já passou?
2. Se tem foto: a **descrição** e a **autorização** estão preenchidas?
3. O **Endereço da notícia** só tem letras minúsculas, números e hífen, e não é igual ao de outra notícia?
4. Passou mais de 1 hora? (O normal é de 15 a 30 minutos; o agendador do GitHub às vezes atrasa.) O resumo da última publicação do site (GitHub → Actions → *Deploy Site*) diz, notícia por
   notícia, o motivo de ter ficado de fora.

## O sistema avisa sozinho quando o site tem problema

Ninguém precisa ficar olhando. Existem **três vigilantes automáticos**. **Dois** abrem um aviso (*Issue*) no GitHub do projeto
(quem acompanha o repositório recebe por e-mail, **se tiver as notificações ligadas**); o do tamanho aparece na própria publicação
do site:

- **Site fora do ar:** a cada 15 minutos o sistema confere, **de fora**, o site, o painel e a API. Se algo não responder
  duas vezes seguidas, abre o aviso *"ALERTA: o site, o painel ou a API da ASAF não está respondendo"* e **fecha sozinho** quando tudo volta.
- **Site desatualizado:** se o site no ar ficar **mais de 2 horas** atrás do sistema (por exemplo, um relatório aprovado que não
  chega ao site), abre o aviso *"o site está atrás do sistema há mais de 2 horas"* e fecha quando o site alcança. As 2 horas são
  contadas **desde que a sincronização percebeu a diferença**, e o aviso sai mesmo quando as publicações estão falhando.
- **Site grande demais:** o plano gratuito do Azure aceita até **250 MB e 15.000 arquivos**. A publicação **avisa a partir de
  60%** do limite (aviso amarelo em *Actions → Deploy Site*) e **para sozinha a partir de 85%** (publicação vermelha), antes de o
  Azure recusar, e diz quanto falta e o que fazer (limpar, ou
  passar para o plano pago). O tamanho dos PDFs e das fotos é conferido nessa mesma etapa.
