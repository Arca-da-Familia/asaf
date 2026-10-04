"""v5.4a (FASE 5) - verificador da VERSÃO PÚBLICA de um documento institucional.

POR QUE EXISTE: ata de eleição, termo de fomento e relação de dirigentes trazem RG, CPF, endereço e telefone
de gente. PDF não se edita, então quem publica sobe ao lado do original uma VERSÃO PÚBLICA (com os dados
pessoais cobertos DE VERDADE) e só ela vai ao site. Este módulo confere o TEXTO EXTRAÍDO dessa versão - não o
desenho: uma tarja preta desenhada por cima de um CPF não apaga o texto que está por baixo, e é o texto que
o Google, um leitor de tela ou um copiar-e-colar enxergam. É a única defesa automática; a aprovação por uma
segunda pessoa (Presidente ou Secretário) continua obrigatória.

O QUE RECUSA (bloqueio - o arquivo nem é guardado):
  - não é PDF legível, tem senha, tem script/arquivo anexado, é grande demais;
  - é só imagem (sem camada de texto pesquisável) - a IN 06/2025 do TCM-PA, art. 17, § 5º, veda documento "em
    formato de imagem ou fotografia" e exige PDF pesquisável (OCR);
  - tem CPF, RG/CNH/título de eleitor/PIS/NIS/CTPS com número, e-mail pessoal ou celular.
O QUE SÓ AVISA (a pessoa que aprova lê): palavras que costumam acompanhar dado pessoal ("residente",
"nascido em", "estado civil"...), telefone fixo, página sem texto, CEP que não é o da sede.
O que NUNCA vai para o resultado: o dado encontrado por inteiro. A "amostra" é sempre mascarada.

Os dados institucionais da ASAF (e-mail, telefone, CEP da sede) são permitidos: aparecem em todo documento."""
from __future__ import annotations

import io
import re
from dataclasses import dataclass, field

TAMANHO_MAXIMO = 25 * 1024 * 1024
MAXIMO_DE_PAGINAS = 400
MINIMO_DE_CARACTERES_POR_PAGINA = 20  # abaixo disto a página não tem camada de texto útil
PARTE_MAXIMA_DE_PAGINAS_SEM_TEXTO = 0.5
TEXTO_GUARDADO_MAXIMO = 400_000  # caracteres do texto extraído que ficam guardados para busca

# Dados da própria ASAF (site/src/config/organizacao.ts): publicados em todo lugar, não são dado pessoal.
DOMINIOS_DE_EMAIL_INSTITUCIONAL = ("asaf.org.br", "arcadafamilia.org")
TELEFONES_INSTITUCIONAIS = ("94984120703",)  # só dígitos, sem 55
CEP_DA_SEDE = "68515000"


@dataclass
class Achado:
    codigo: str
    mensagem: str
    pagina: int | None = None
    amostra: str | None = None  # SEMPRE mascarada

    def como_dicionario(self) -> dict:
        return {"codigo": self.codigo, "mensagem": self.mensagem, "pagina": self.pagina, "amostra": self.amostra}


@dataclass
class Resultado:
    ok: bool
    bloqueios: list[Achado] = field(default_factory=list)
    avisos: list[Achado] = field(default_factory=list)
    paginas: int = 0
    caracteres: int = 0
    texto: str = ""

    def como_dicionario(self) -> dict:
        return {
            "ok": self.ok, "paginas": self.paginas, "caracteres": self.caracteres,
            "bloqueios": [a.como_dicionario() for a in self.bloqueios],
            "avisos": [a.como_dicionario() for a in self.avisos],
        }


# --------------------------------------------------------------------------------------- máscaras
def _so_digitos(texto: str) -> str:
    return re.sub(r"\D", "", texto)


def mascarar_cpf(texto: str) -> str:
    d = _so_digitos(texto)
    return f"{d[:3]}.***.***-{d[-2:]}" if len(d) == 11 else "***"


def mascarar_email(texto: str) -> str:
    usuario, _, dominio = texto.partition("@")
    return f"{usuario[:1]}***@{dominio}"


def mascarar_numero(texto: str) -> str:
    d = _so_digitos(texto)
    return f"****{d[-2:]}" if len(d) >= 2 else "***"


# ----------------------------------------------------------------------------------------- CPF
def cpf_valido(digitos: str) -> bool:
    """Dígitos verificadores do CPF (e rejeita 111.111.111-11 e afins)."""
    d = _so_digitos(digitos)
    if len(d) != 11 or d == d[0] * 11:
        return False
    for tamanho in (9, 10):
        soma = sum(int(d[i]) * (tamanho + 1 - i) for i in range(tamanho))
        resto = (soma * 10) % 11
        if (0 if resto == 10 else resto) != int(d[tamanho]):
            return False
    return True


_CPF_FORMATADO = re.compile(r"(?<!\d)\d{3}\s?\.\s?\d{3}\s?\.\s?\d{3}\s?[-–]\s?\d{2}(?!\d)")
_CPF_SOLTO = re.compile(r"(?<![\d./-])\d{3}[ .]?\d{3}[ .]?\d{3}[ -]?\d{2}(?![\d/-])")
_DOCUMENTO_PESSOAL = re.compile(
    r"(?i)\b(?P<rotulo>r\.?\s?g\.?|identidade|registro\s+geral|c\.?n\.?h\.?|carteira\s+de\s+habilita[çc][ãa]o|"
    r"t[ií]tulo\s+de\s+eleitor|pis(?:\s*/\s*pasep)?|pasep|n\.?i\.?s\.?|ctps|carteira\s+de\s+trabalho|passaporte)\b"
    r"[^\n\d]{0,40}(?P<numero>\d[\d.\-]{4,13}[\dxX])"
)
_INTERVALO_DE_ANOS = re.compile(r"(?:19|20)\d{2}\D?(?:19|20)\d{2}")  # "2026-2028" não é número de documento
_RG_FORMATADO_SOLTO = re.compile(r"(?<![\d./-])\d{1,2}\.\d{3}\.\d{3}-[\dxX](?![\d/-])")
_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_CELULAR = re.compile(r"(?<!\d)(?:\+?55[\s.\-]?)?\(?\d{2}\)?[\s.\-]?9\d{4}[\s.\-]?\d{4}(?!\d)")
_FIXO = re.compile(r"(?<!\d)(?:\+?55[\s.\-]?)?\(?\d{2}\)?[\s.\-]?[2-5]\d{3}[\s.\-]?\d{4}(?!\d)")
_CEP = re.compile(r"(?<!\d)\d{5}-?\d{3}(?!\d)")
_PALAVRAS_DE_DADO_PESSOAL = re.compile(
    r"(?i)\b(residente|domiciliad[oa]|endere[çc]o\s+residencial|nascid[oa]\s+em|data\s+de\s+nascimento|"
    r"estado\s+civil|portador[a]?\s+d[ao]|filh[oa]\s+de|natural\s+de)\b"
)


def _sem_dominio_institucional(email: str) -> bool:
    return email.rpartition("@")[2].lower() not in DOMINIOS_DE_EMAIL_INSTITUCIONAL


def _digitos_nacionais(telefone: str) -> str:
    d = _so_digitos(telefone)
    return d[2:] if d.startswith("55") and len(d) > 11 else d


def procurar_dado_pessoal(texto: str, pagina: int | None = None) -> tuple[list[Achado], list[Achado]]:
    """(bloqueios, avisos) do texto de UMA página (ou do texto todo, com `pagina=None`)."""
    bloqueios: list[Achado] = []
    avisos: list[Achado] = []

    vistos_cpf: set[str] = set()
    for padrao, exigir_digitos_validos in ((_CPF_FORMATADO, False), (_CPF_SOLTO, True)):
        for m in padrao.finditer(texto):
            digitos = _so_digitos(m.group())
            if digitos in vistos_cpf:
                continue
            if exigir_digitos_validos and not cpf_valido(digitos):
                continue
            vistos_cpf.add(digitos)
            bloqueios.append(Achado("CPF", "CPF na versão pública", pagina, mascarar_cpf(digitos)))

    for m in _DOCUMENTO_PESSOAL.finditer(texto):
        if _INTERVALO_DE_ANOS.fullmatch(m.group("numero")):
            continue
        rotulo = re.sub(r"\s+", " ", m.group("rotulo")).upper()
        bloqueios.append(Achado("DOCUMENTO_PESSOAL", f"número de documento pessoal ({rotulo}) na versão pública",
                                pagina, mascarar_numero(m.group("numero"))))
    for m in _RG_FORMATADO_SOLTO.finditer(texto):
        bloqueios.append(Achado("DOCUMENTO_PESSOAL", "número no formato de RG na versão pública", pagina, mascarar_numero(m.group())))

    for m in _EMAIL.finditer(texto):
        if _sem_dominio_institucional(m.group()):
            bloqueios.append(Achado("EMAIL", "e-mail que não é da ASAF na versão pública", pagina, mascarar_email(m.group())))

    institucionais = {_digitos_nacionais(t) for t in TELEFONES_INSTITUCIONAIS}
    for m in _CELULAR.finditer(texto):
        if _digitos_nacionais(m.group()) not in institucionais:
            bloqueios.append(Achado("TELEFONE", "celular que não é da ASAF na versão pública", pagina, mascarar_numero(m.group())))
    for m in _FIXO.finditer(texto):
        if _digitos_nacionais(m.group()) not in institucionais:
            avisos.append(Achado("TELEFONE_FIXO", "telefone fixo na versão pública (confira se é da ASAF)", pagina, mascarar_numero(m.group())))

    for m in _CEP.finditer(texto):
        if _so_digitos(m.group()) != CEP_DA_SEDE:
            avisos.append(Achado("CEP", "CEP que não é o da sede (pode ser endereço de pessoa)", pagina, mascarar_numero(m.group())))
    palavras = sorted({m.group().lower() for m in _PALAVRAS_DE_DADO_PESSOAL.finditer(texto)})
    if palavras:
        avisos.append(Achado("PALAVRAS_DE_DADO_PESSOAL", f"expressões que costumam acompanhar dado pessoal: {', '.join(palavras)}", pagina))
    return bloqueios, avisos


# ------------------------------------------------------------------------------------------ PDF
def _bloqueio(codigo: str, mensagem: str) -> Resultado:
    return Resultado(ok=False, bloqueios=[Achado(codigo, mensagem)])


def verificar_versao_publica(conteudo: bytes) -> Resultado:
    """Confere o PDF da versão pública. Nunca levanta por causa do arquivo: devolve `Resultado(ok=False)`."""
    if not conteudo.startswith(b"%PDF-"):
        return _bloqueio("NAO_E_PDF", "o arquivo não é um PDF (a versão pública precisa ser PDF pesquisável)")
    if len(conteudo) > TAMANHO_MAXIMO:
        return _bloqueio("GRANDE_DEMAIS", f"o PDF passa de {TAMANHO_MAXIMO // (1024 * 1024)} MB")
    for assinatura, mensagem in ((b"/JavaScript", "o PDF contém script"), (b"/JS", "o PDF contém script"),
                                 (b"/Launch", "o PDF contém ação de executar programa"),
                                 (b"/EmbeddedFile", "o PDF tem arquivo anexado dentro dele")):
        if assinatura in conteudo:
            return _bloqueio("PDF_PERIGOSO", mensagem)

    try:
        from pypdf import PdfReader
        from pypdf.errors import PyPdfError

        try:
            leitor = PdfReader(io.BytesIO(conteudo), strict=False)
            if leitor.is_encrypted:
                return _bloqueio("PDF_COM_SENHA", "o PDF tem senha ou criptografia (não dá para conferir o que há dentro)")
            quantidade = len(leitor.pages)
        except (PyPdfError, ValueError, KeyError, TypeError, OSError):
            return _bloqueio("PDF_ILEGIVEL", "não consegui abrir o PDF (arquivo danificado?)")
        if quantidade == 0:
            return _bloqueio("PDF_VAZIO", "o PDF não tem nenhuma página")
        if quantidade > MAXIMO_DE_PAGINAS:
            return _bloqueio("GRANDE_DEMAIS", f"o PDF tem mais de {MAXIMO_DE_PAGINAS} páginas")

        textos: list[str] = []
        for pagina in leitor.pages:
            try:
                textos.append(pagina.extract_text() or "")
            except Exception:  # noqa: BLE001 - uma página ruim não pode derrubar a verificação das outras
                textos.append("")
        extras: list[str] = []
        try:  # campos de formulário e anotações também guardam texto (e dado pessoal)
            for campo in (leitor.get_fields() or {}).values():
                valor = campo.get("/V")
                if valor:
                    extras.append(str(valor))
        except Exception:  # noqa: BLE001
            pass
        for pagina in leitor.pages:
            try:
                for anotacao in pagina.get("/Annots") or []:
                    conteudo_da_nota = anotacao.get_object().get("/Contents")
                    if conteudo_da_nota:
                        extras.append(str(conteudo_da_nota))
            except Exception:  # noqa: BLE001
                continue
    except ImportError:  # pragma: no cover - pypdf está em requirements.txt
        return _bloqueio("SEM_LEITOR_DE_PDF", "o leitor de PDF não está instalado no servidor")

    resultado = Resultado(ok=True, paginas=quantidade)
    resultado.texto = "\n\n".join(textos)[:TEXTO_GUARDADO_MAXIMO]
    resultado.caracteres = sum(len(re.sub(r"\s", "", t)) for t in textos)

    sem_texto = [i + 1 for i, t in enumerate(textos) if len(re.sub(r"\s", "", t)) < MINIMO_DE_CARACTERES_POR_PAGINA]
    if len(sem_texto) / quantidade > PARTE_MAXIMA_DE_PAGINAS_SEM_TEXTO:
        resultado.bloqueios.append(Achado(
            "SO_IMAGEM",
            "o PDF é só imagem (sem texto pesquisável): a IN 06/2025 do TCM-PA veda documento em formato de imagem; "
            "faça o reconhecimento de texto (OCR) e envie de novo",
        ))
    elif sem_texto:
        resultado.avisos.append(Achado("PAGINA_SEM_TEXTO", f"página(s) {', '.join(map(str, sem_texto))} sem texto (folha de assinaturas?)"))

    for numero, texto in enumerate(textos, start=1):
        bloqueios, avisos = procurar_dado_pessoal(texto, numero)
        resultado.bloqueios.extend(bloqueios)
        resultado.avisos.extend(avisos)
    if extras:
        bloqueios, avisos = procurar_dado_pessoal("\n".join(extras), None)
        for achado in bloqueios:
            achado.mensagem += " (em campo de formulário ou anotação do PDF)"
        resultado.bloqueios.extend(bloqueios)
        resultado.avisos.extend(avisos)

    resultado.ok = not resultado.bloqueios
    return resultado
