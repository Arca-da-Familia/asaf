# Como atualizar o site da ASAF

Este guia é para quem edita o site (diretoria e comunicação). Não precisa saber programar.

**Regra de ouro:** o site tem duas fontes, e cada coisa mora em um só lugar.

| O que você quer mudar | Onde mora | Onde mexer |
| --- | --- | --- |
| **Notícias** e fotos do site | Editor do site (Directus) | `https://cms.asaf.org.br` |
| Diretoria, projetos, eventos, editais de assembleia | Sistema da ASAF | O painel do sistema (`painel.asaf.org.br`) |
| Documentos oficiais (atas, certidões, balanços, termos) | Sistema da ASAF | O painel, módulo **Documentos** (veja abaixo) |
| Emendas parlamentares, parcerias, parcelas, pagamentos, etapas e prestação de contas | Sistema da ASAF | O painel, módulo **Parcerias e emendas** (veja abaixo) |

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

O site confere o Editor a cada **15 minutos** e, se algo mudou, publica sozinho (leva uns 5 minutos). Então, em geral, a
notícia aparece **em até 25 minutos**. Para publicar na hora, peça a quem cuida do sistema para rodar *Publicar agora*.

Notícia com **data de publicação no futuro** só aparece quando a data chegar.

### Regras da foto (obrigatórias — a lei de proteção de crianças e de dados exige)

Uma notícia **com foto** só vai ao ar se:

1. a **Descrição da foto (texto alternativo)** estiver preenchida — ela descreve a foto para quem não enxerga
   (ex.: *"Crianças lendo livros no pátio da sede"*); e
2. a caixa **Autorização de imagem** estiver marcada — marque **somente** se há autorização de uso da imagem
   (dos responsáveis, no caso de crianças e adolescentes).

Se faltar uma das duas, **a notícia inteira não é publicada** (não só a foto) e aparece um aviso amarelo no resumo da
publicação do site (GitHub → Actions → *Deploy Site*). Corrija e salve de novo.

### Listas prontas

Em **Notícias**, o menu tem atalhos: **Todas as notícias**, **Para revisar**, **Rascunhos** e **No ar**.

### Tirar uma notícia do ar

Mude a **Situação** para **Arquivado** (ou Rascunho) e salve. Em até 25 minutos ela sai do site.

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
3. Na tela do documento, envie a **versão pública**: uma cópia em **PDF com texto** em que os dados pessoais foram
   **apagados de verdade** (não vale só desenhar uma tarja preta por cima: o texto continua dentro do arquivo). Documento
   *Pública* pode usar o próprio original (botão **Usar o original como versão pública**).
4. O sistema **confere na hora** e mostra o resultado. Ele **recusa** a versão pública se encontrar: CPF; número de RG, CNH,
   título de eleitor, PIS ou carteira de trabalho; e-mail que não seja da ASAF; celular que não seja o da ASAF; PDF que é
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

> **Título e descrição também vão ao site** e o sistema recusa CPF, RG, e-mail pessoal e celular neles.

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

   **Não escreva nome de pessoa, CPF, telefone ou e-mail no texto público.** O sistema recusa CPF, RG, e-mail pessoal e
   celular, mas **não consegue detectar um nome** — isso é com quem classifica e com quem aprova.
5. **Etapas de execução** (oficinas, entregas) e **relatórios / prestação de contas** (previsto, apresentado, prazo de
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

### A promessa das 24 horas

O site diz, enquanto não há emenda, que a página **"será atualizada em até 24 horas após qualquer recebimento"**. Para
isso valer: **lance o recebimento no livro-caixa com o centro de custo da parceria e classifique no mesmo dia**. Depois que
a parceria estiver aprovada, o site confere o sistema a cada **15 minutos** e publica sozinho (uns 5 minutos de
construção). Para a **primeira** emenda aparecer, além de cadastrar e classificar, **outra pessoa precisa aprovar**.

---

## Quando algo não aparece

1. A **Situação** está *Publicado* e a data *Publicar em* já passou?
2. Se tem foto: a **descrição** e a **autorização** estão preenchidas?
3. O **Endereço da notícia** só tem letras minúsculas, números e hífen, e não é igual ao de outra notícia?
4. Passaram mais de 25 minutos? Peça para olhar o resumo da última publicação do site: ele diz, notícia por notícia, o
   motivo de ter ficado de fora.
