# Como atualizar o site da ASAF

Este guia é para quem edita o site (diretoria e comunicação). Não precisa saber programar.

**Regra de ouro:** o site tem duas fontes, e cada coisa mora em um só lugar.

| O que você quer mudar | Onde mora | Onde mexer |
| --- | --- | --- |
| **Notícias** e fotos do site | Editor do site (Directus) | `https://cms.asaf.org.br` |
| Diretoria, projetos, eventos, editais de assembleia | Sistema da ASAF | O painel do sistema (`painel.asaf.org.br`) |
| Documentos oficiais, atas, emendas e prestação de contas | Sistema da ASAF | O painel — **ainda em construção** (versão 5.4 do plano) |

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

## Quando algo não aparece

1. A **Situação** está *Publicado* e a data *Publicar em* já passou?
2. Se tem foto: a **descrição** e a **autorização** estão preenchidas?
3. O **Endereço da notícia** só tem letras minúsculas, números e hífen, e não é igual ao de outra notícia?
4. Passaram mais de 25 minutos? Peça para olhar o resumo da última publicação do site: ele diz, notícia por notícia, o
   motivo de ter ficado de fora.
