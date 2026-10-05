// Ambiente de HOMOLOGAÇÃO (teste, só com dados inventados): o build do site de teste é feito com
// PUBLIC_AMBIENTE=homologacao. O da produção não define a variável, então nada disto aparece lá
// (o `test:vazio` prova que o texto da faixa não existe em nenhum arquivo do build de produção).
export const ehHomologacao = (
  valor: string | undefined = import.meta.env.PUBLIC_AMBIENTE,
): boolean => valor === 'homologacao'

export const TEXTO_DO_AMBIENTE_DE_TESTE =
  'AMBIENTE DE TESTE — todos os dados são inventados e nada aqui vale. O site de verdade é asaf.org.br.'
