import { FileText, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

type Arquivo = {
  id: string
  nome: string
  tamanho: number
  progresso: number
}

type FileUploadProps = {
  onArquivosSelecionados: (arquivos: File[]) => void
  tiposAceitos?: string[]
  tamanhoMaximoMb?: number
  multiplos?: boolean
  disabled?: boolean
  className?: string
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Upload com limite de tipo/tamanho e barra de progresso. O progresso abaixo é simulado
// para demonstrar a UI — a integração real usa XHR com onprogress ao ligar ao endpoint.
export function FileUpload({
  onArquivosSelecionados,
  tiposAceitos,
  tamanhoMaximoMb = 10,
  multiplos = false,
  disabled,
  className,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [arquivos, setArquivos] = useState<Arquivo[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [arrastando, setArrastando] = useState(false)

  useEffect(() => {
    const pendente = arquivos.some((a) => a.progresso < 100)
    if (!pendente) return
    const t = setTimeout(() => {
      setArquivos((prev) =>
        prev.map((a) =>
          a.progresso < 100
            ? { ...a, progresso: Math.min(100, a.progresso + 25) }
            : a,
        ),
      )
    }, 120)
    return () => clearTimeout(t)
  }, [arquivos])

  function validar(file: File): string | null {
    if (tiposAceitos?.length && !tiposAceitos.includes(file.type)) {
      return `"${file.name}" tem um tipo de arquivo não permitido.`
    }
    if (file.size > tamanhoMaximoMb * 1024 * 1024) {
      return `"${file.name}" excede o limite de ${tamanhoMaximoMb} MB.`
    }
    return null
  }

  function processar(lista: FileList | null) {
    if (!lista) return
    const aceitos: File[] = []
    const novos: Arquivo[] = []
    let msg: string | null = null
    for (const file of Array.from(lista)) {
      const erroArquivo = validar(file)
      if (erroArquivo) {
        msg = erroArquivo
        continue
      }
      aceitos.push(file)
      novos.push({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        nome: file.name,
        tamanho: file.size,
        progresso: 0,
      })
    }
    setArquivos((prev) => (multiplos ? [...prev, ...novos] : novos))
    setErro(msg)
    if (aceitos.length) onArquivosSelecionados(aceitos)
  }

  function remover(id: string) {
    setArquivos((prev) => prev.filter((a) => a.id !== id))
  }

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
            inputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setArrastando(true)
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault()
          setArrastando(false)
          processar(e.dataTransfer.files)
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border px-6 py-8 text-center transition-colors',
          arrastando && 'border-primary bg-primary/5',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
        <p className="mt-2 text-sm">
          Arraste arquivos aqui ou clique para selecionar
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {tiposAceitos?.length
            ? `Tipos permitidos: ${tiposAceitos.join(', ')}`
            : `Até ${tamanhoMaximoMb} MB por arquivo`}
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple={multiplos}
        disabled={disabled}
        accept={tiposAceitos?.join(',')}
        onChange={(e) => processar(e.target.files)}
      />

      {erro && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {arquivos.length > 0 && (
        <ul className="mt-3 space-y-2">
          {arquivos.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{a.nome}</p>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${a.progresso}%` }}
                  />
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatarTamanho(a.tamanho)}
              </span>
              <button
                type="button"
                onClick={() => remover(a.id)}
                aria-label={`Remover ${a.nome}`}
              >
                <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
