// PDFs de teste montados à mão, byte a byte (sem biblioteca): um com texto pesquisável e outro só com uma imagem (sem camada de texto). Foram conferidos contra o
// verificador de versão pública do servidor (app/services/documentos_verificacao.py): o de texto limpo passa, o que traz CPF é recusado por "CPF", o só-imagem
// por "SO_IMAGEM". Só ASCII no texto (a fonte Helvetica padrão do PDF não leva acento sem codificação extra).

function montar(objetos: string[]): Buffer {
  let saida = '%PDF-1.4\n'
  const posicoes: number[] = []
  objetos.forEach((corpo, i) => {
    posicoes.push(Buffer.byteLength(saida, 'latin1'))
    saida += `${i + 1} 0 obj\n${corpo}\nendobj\n`
  })
  const inicioDaTabela = Buffer.byteLength(saida, 'latin1')
  saida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  for (const p of posicoes) saida += `${String(p).padStart(10, '0')} 00000 n \n`
  saida += `trailer\n<</Size ${objetos.length + 1}/Root 1 0 R>>\nstartxref\n${inicioDaTabela}\n%%EOF\n`
  return Buffer.from(saida, 'latin1')
}

/** Um PDF de uma página com este texto (uma linha por item; sem acento nem parênteses). */
export function pdfComTexto(linhas: string[]): Buffer {
  const conteudo = `BT /F1 12 Tf 72 720 Td 16 TL ${linhas.map((l) => `(${l}) Tj T*`).join(' ')} ET`
  return montar([
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${conteudo.length}>>\nstream\n${conteudo}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ])
}

/** O mesmo PDF de texto, com uma TARJA PRETA desenhada por cima da primeira linha: o texto continua lá debaixo (quem copia ou busca lê tudo), então não conta como coberto. */
export function pdfComTextoETarja(linhas: string[]): Buffer {
  const conteudo = `BT /F1 12 Tf 72 720 Td 16 TL ${linhas.map((l) => `(${l}) Tj T*`).join(' ')} ET 0 0 0 rg 70 688 330 14 re f`
  return montar([
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${conteudo.length}>>
stream
${conteudo}
endstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ])
}

/** Um PDF de uma página que é só uma imagem 2x2 (sem texto nenhum): o verificador tem de recusar como "só imagem". */
export function pdfSoImagem(): Buffer {
  const desenho = 'q 200 0 0 200 100 500 cm /Im0 Do Q'
  return montar([
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</XObject<</Im0 5 0 R>>>>>>',
    `<</Length ${desenho.length}>>\nstream\n${desenho}\nendstream`,
    '<</Type/XObject/Subtype/Image/Width 2/Height 2/ColorSpace/DeviceGray/BitsPerComponent 8/Filter/ASCIIHexDecode/Length 9>>\nstream\n80FF40C0>\nendstream',
  ])
}
