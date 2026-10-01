/**
 * Dados institucionais da ASAF usados em todo o site (rodapé, SEO, dados estruturados).
 *
 * Fonte: ESTATUTO_ASAF.txt (Art. 1º e 3º) — nada aqui é inventado. Dado que o Estatuto não traz
 * (CNPJ, telefone, e-mail, endereço atual) fica FORA até ser confirmado: na v5.2 (Contato) vem
 * do Directus/FastAPI, nunca digitado em código. O Estatuto fala em "sede provisória", então o
 * endereço completo de 2013 não é publicado aqui — só a cidade/UF, que é estável.
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
