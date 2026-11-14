import Papa from 'papaparse'

// v1.3 - parsing acontece no navegador (o arquivo bruto nunca sobe pro servidor). Só CSV por
// enquanto: a única biblioteca client-side madura para .xlsx (SheetJS `xlsx` via npm) tem duas
// vulnerabilidades de alta severidade sem correção disponível (prototype pollution + ReDoS) -
// exatamente a superfície de ataque de "parsear arquivo enviado por qualquer um". Excel exporta
// para CSV nativamente (Salvar como > CSV), então o requisito é atendido sem esse risco.
export type PlanilhaParseada = {
  cabecalhos: string[]
  linhas: Record<string, string>[]
}

export function parseArquivoCsv(arquivo: File): Promise<PlanilhaParseada> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(arquivo, {
      header: true,
      skipEmptyLines: true,
      complete: (resultado) => {
        resolve({
          cabecalhos: resultado.meta.fields ?? [],
          linhas: resultado.data,
        })
      },
      error: (erro: Error) => reject(erro),
    })
  })
}

export const CAMPOS_SISTEMA = [
  { chave: 'nome_completo', rotulo: 'Nome completo', obrigatorio: true },
  { chave: 'cpf', rotulo: 'CPF', obrigatorio: true },
  { chave: 'email_contato', rotulo: 'E-mail', obrigatorio: false },
  {
    chave: 'telefone_whatsapp',
    rotulo: 'Telefone/WhatsApp',
    obrigatorio: false,
  },
  {
    chave: 'data_nascimento',
    rotulo: 'Data de nascimento (dia/mês/ano)',
    obrigatorio: false,
  },
  { chave: 'categoria', rotulo: 'Categoria', obrigatorio: false },
] as const

export type ChaveCampoSistema = (typeof CAMPOS_SISTEMA)[number]['chave']
export type MapeamentoColunas = Partial<Record<ChaveCampoSistema, string>>

// Sugestão automática de mapeamento por semelhança de nome - o usuário sempre confirma/ajusta
// na tela, isto só poupa clique em planilha com cabeçalho óbvio (ex.: "Nome", "CPF").
export function sugerirMapeamento(cabecalhos: string[]): MapeamentoColunas {
  const normalizado = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  const pistas: Record<ChaveCampoSistema, string[]> = {
    nome_completo: ['nome', 'nome completo', 'associado'],
    cpf: ['cpf'],
    email_contato: ['email', 'e-mail'],
    telefone_whatsapp: ['telefone', 'whatsapp', 'celular'],
    data_nascimento: ['nascimento', 'data de nascimento', 'data nasc'],
    categoria: ['categoria'],
  }
  const mapeamento: MapeamentoColunas = {}
  for (const campo of CAMPOS_SISTEMA) {
    const achado = cabecalhos.find((c) =>
      pistas[campo.chave].includes(normalizado(c)),
    )
    if (achado) mapeamento[campo.chave] = achado
  }
  return mapeamento
}

// v9.5d (pedido do Presidente, 13/11): a data pode vir do jeito brasileiro (22/07/1975, como o Excel em português grava) ou no formato do sistema
// (1975-07-22); o servidor recebe sempre no formato do sistema. Outro jeito segue como veio e o servidor aponta o erro na linha.
export function dataParaOSistema(valor: string): string {
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(valor.trim())
  if (!br) return valor.trim()
  const [, dia, mes, ano] = br
  return `${ano}-${mes!.padStart(2, '0')}-${dia!.padStart(2, '0')}`
}

export function aplicarMapeamento(
  linhas: Record<string, string>[],
  mapeamento: MapeamentoColunas,
): Record<ChaveCampoSistema, string>[] {
  return linhas.map((linha) => {
    const resultado = {} as Record<ChaveCampoSistema, string>
    for (const campo of CAMPOS_SISTEMA) {
      const coluna = mapeamento[campo.chave]
      const valor = coluna ? (linha[coluna] ?? '').trim() : ''
      resultado[campo.chave] =
        campo.chave === 'data_nascimento' ? dataParaOSistema(valor) : valor
    }
    return resultado
  })
}

// v9.5d (pedido do Presidente, 13/11: "tem que ter a opção de baixar a planilha modelo"): a planilha modelo traz só a linha dos nomes das colunas, com os
// nomes que o assistente já reconhece sozinho. Separada por ponto e vírgula e com a marca de acentos (BOM), que é como o Excel em português abre um CSV
// direto em colunas. Sem linha de exemplo: uma linha de exemplo esquecida na planilha viraria um associado inventado.
export const COLUNAS_DA_PLANILHA_MODELO = [
  'Nome completo',
  'CPF',
  'E-mail',
  'Telefone',
  'Data de nascimento',
  'Categoria',
]

export function planilhaModeloCsv(): string {
  return `\uFEFF${COLUNAS_DA_PLANILHA_MODELO.join(';')}\r\n`
}
