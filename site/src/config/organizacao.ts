/**
 * Dados institucionais da ASAF usados em todo o site (rodapé, SEO, dados estruturados).
 *
 * Fontes — nada aqui é inventado:
 *  - ESTATUTO_ASAF.txt (Art. 1º e 3º): nome, lema, fundação, natureza, objetivo, áreas e sede.
 *  - Informados e confirmados pelo usuário em 2026-10-01: CNPJ, telefone e e-mail. O endereço da
 *    sede é o do Estatuto — o usuário confirmou que NÃO mudou ("sede provisória" no texto de 2013,
 *    mas é a sede em uso).
 *
 * Quando a v5.1/v5.2 trouxer o Directus, estes dados passam a vir de lá/da API (para quem não
 * edita código poder atualizar) — até lá este é o único lugar do site onde eles existem, para
 * mudar em um ponto só. O CNPJ tem teste de dígito verificador (tests/organizacao.test.ts):
 * erro de digitação aqui não chega à produção.
 */
export const SITE_URL = 'https://asaf.org.br'
export const PAINEL_URL = 'https://painel.asaf.org.br'

/** Origem da API. Em build de teste/CI aponta para o mock local (PUBLIC_API_URL). */
export const API_URL: string = (
  import.meta.env.PUBLIC_API_URL ?? 'https://api.asaf.org.br'
).replace(/\/+$/, '')

export const ORGANIZACAO = {
  nome: 'Associação Arca da Família',
  sigla: 'ASAF',
  lema: 'Eu e minha família na Arca',
  fundacao: '2013-02-10',
  fundacaoPorExtenso: '10 de fevereiro de 2013',
  cidade: 'Parauapebas',
  uf: 'PA',
  pais: 'BR',
  cnpj: '17.631.942/0001-70',
  // Celular (9 dígitos), DDD 94. Três formas do mesmo número: texto, link tel: e dado estruturado.
  telefone: '(94) 98412-0703',
  telefoneLink: 'tel:+5594984120703',
  telefoneInternacional: '+55-94-98412-0703',
  email: 'asaf@asaf.org.br',
  endereco: {
    logradouro: 'Rua Paulo Afonso',
    numero: '150',
    bairro: 'Bairro da Paz',
    cep: '68515-000',
  },
  natureza:
    'Entidade sócio comunitária de direito privado, sem fins econômicos e de caráter filantrópico.',
  // Completa a frase "Nosso objetivo principal é ..." (Art. 1º do Estatuto).
  objetivo:
    'o atendimento e a assistência à família, independentemente de classe social, nacionalidade, sexo, raça, cor ou crença religiosa.',
  // Art. 3º do Estatuto — lista na ordem do documento.
  areasDeAtuacao: [
    'Saúde',
    'Educação',
    'Agricultura',
    'Assistência Social',
    'Artes',
    'Formação Profissional',
    'Lazer',
    'Recreação',
    'Religião',
    'Esporte',
    'Cultura',
  ],
  descricaoCurta:
    'Entidade filantrópica sem fins econômicos, com sede em Parauapebas (PA), dedicada ao atendimento e à assistência à família, sem distinção de classe, raça ou crença.',
} as const

/**
 * Documentos legais versionados do site (PLANO v5.2: "Política de Privacidade e Termos de Uso
 * versionados"). Mudou o texto de uma página legal: aumente a versão e a data aqui — é o histórico
 * do que estava em vigor em cada época (a mudança fica no Git).
 */
export const DOCUMENTOS_LEGAIS = {
  privacidade: { versao: '1.0', vigenteDesde: '2026-10-03' },
  termos: { versao: '1.0', vigenteDesde: '2026-10-03' },
} as const

/** "Rua Paulo Afonso, 150 — Bairro da Paz" */
export const ENDERECO_LINHA = `${ORGANIZACAO.endereco.logradouro}, ${ORGANIZACAO.endereco.numero} — ${ORGANIZACAO.endereco.bairro}`

/** Logo institucional (arquivos gerados por `npm run logos`, a partir de design/logo/). */
export const LOGO = {
  /** Largura/altura reais do mestre — proporção usada para reservar espaço (sem salto de layout). */
  proporcao: 2607 / 2160,
  cabecalho: '/asaf-logo-160.webp',
  destaque: '/asaf-logo-640.webp',
  /** PNG com fundo transparente, para dados estruturados e quem não lê WebP. */
  png: '/asaf-logo-600.png',
  pngLargura: 600,
  pngAltura: 497,
  alt: 'Logotipo da Associação Arca da Família (ASAF)',
} as const
