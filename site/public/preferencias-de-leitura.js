// v9.1b - PREFERÊNCIAS DE LEITURA do site: tamanho da letra e alto contraste.
//
// Arquivo à parte (não <script> dentro da página) porque a política de conteúdo do site só aceita script do próprio endereço; carregado no <head>, sem
// `defer`, para a escolha valer ANTES de a página aparecer (sem piscar no tamanho ou na cor antigos). Guarda no navegador só a escolha ("maior", "alto"),
// nunca dado da pessoa; sem armazenamento (navegação privada que o bloqueia), a escolha vale até sair da página. Sem JavaScript, os botões nem aparecem.
;(function () {
  var raiz = document.documentElement
  var FONTES = ['normal', 'maior', 'muito-maior']
  var CHAVE_FONTE = 'asaf-letra'
  var CHAVE_CONTRASTE = 'asaf-contraste'

  function ler(chave) {
    try {
      return window.localStorage.getItem(chave)
    } catch (e) {
      return null
    }
  }

  function gravar(chave, valor) {
    try {
      if (valor === null) window.localStorage.removeItem(chave)
      else window.localStorage.setItem(chave, valor)
    } catch (e) {
      /* sem armazenamento: vale só nesta página */
    }
  }

  var fonte = ler(CHAVE_FONTE)
  if (FONTES.indexOf(fonte) < 0) fonte = 'normal'
  var contraste = ler(CHAVE_CONTRASTE) === 'alto' ? 'alto' : 'normal'

  function aplicar() {
    raiz.setAttribute('data-letra', fonte)
    raiz.setAttribute('data-contraste', contraste)
    var botoes = document.querySelectorAll('[data-escolha-letra]')
    for (var i = 0; i < botoes.length; i++) {
      botoes[i].setAttribute(
        'aria-pressed',
        String(botoes[i].getAttribute('data-escolha-letra') === fonte),
      )
    }
    var alternar = document.querySelectorAll('[data-escolha-contraste]')
    for (var j = 0; j < alternar.length; j++) {
      alternar[j].setAttribute('aria-pressed', String(contraste === 'alto'))
    }
  }

  aplicar()

  document.addEventListener('click', function (evento) {
    var alvo = evento.target
    var botao =
      alvo && alvo.closest
        ? alvo.closest('[data-escolha-letra], [data-escolha-contraste]')
        : null
    if (!botao) return
    if (botao.hasAttribute('data-escolha-letra')) {
      var escolhida = botao.getAttribute('data-escolha-letra')
      if (FONTES.indexOf(escolhida) < 0) return
      fonte = escolhida
      gravar(CHAVE_FONTE, fonte === 'normal' ? null : fonte)
    } else {
      contraste = contraste === 'alto' ? 'normal' : 'alto'
      gravar(CHAVE_CONTRASTE, contraste === 'alto' ? 'alto' : null)
    }
    aplicar()
  })

  document.addEventListener('DOMContentLoaded', aplicar)
})()
