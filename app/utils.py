import hashlib
import html

def criptografar_senha(senha_pura: str):
    return hashlib.sha256(senha_pura.encode()).hexdigest()

def esc(valor):
    """Escapa valores antes de embuti-los em HTML/atributos, evitando XSS."""
    if valor is None:
        return ""
    return html.escape(str(valor), quote=True)

def iniciais(nome):
    partes = [p for p in (nome or "").strip().split() if p]
    if not partes:
        return "?"
    if len(partes) == 1:
        return partes[0][0].upper()
    return (partes[0][0] + partes[-1][0]).upper()

def avatar_html(pessoa, tamanho="w-9 h-9 text-xs"):
    if getattr(pessoa, "foto", None):
        return f'<img src="{esc(pessoa.foto)}" class="{tamanho} rounded-full object-cover border border-slate-200">'
    cor_ini = "bg-blue-100 text-blue-700"
    return f'<div class="{tamanho} rounded-full {cor_ini} flex items-center justify-center font-bold border border-slate-200">{esc(iniciais(pessoa.nome_completo))}</div>'
