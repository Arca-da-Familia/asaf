"""v5.4a - verificador da versão pública (app/services/documentos_verificacao.py), com PDFs DE VERDADE.

O que se prova (cada teste é uma promessa que o site de transparência faz ao público):
  - CPF/RG/e-mail/celular na versão pública são RECUSADOS - inclusive quando "cobertos" por uma tarja preta
    desenhada por cima (o texto continua lá embaixo: é o texto que o Google e o leitor de tela enxergam);
  - PDF só-imagem é recusado (IN 06/2025 TCM-PA, art. 17, § 5º);
  - os dados da PRÓPRIA ASAF (e-mail, telefone, CEP da sede) passam, e "2026-2028" não vira "RG";
  - o resultado NUNCA devolve o dado inteiro - só amostra mascarada."""
import io

import pytest
from pypdf import PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.services import documentos_verificacao as v

CPF_VALIDO = "111.444.777-35"
CPF_VALIDO_SEM_PONTOS = "11144477735"


def pdf_com_texto(*paginas: list[str]) -> bytes:
    """Um PDF com camada de texto (uma lista de linhas por página)."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    for linhas in paginas:
        y = 800
        for linha in linhas:
            c.drawString(50, y, linha)
            y -= 18
        c.showPage()
    c.save()
    return buf.getvalue()


def pdf_so_imagem(paginas: int = 2) -> bytes:
    """Um PDF que é só foto (sem nenhum texto): o que sai de um scanner sem OCR."""
    from PIL import Image

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    for _ in range(paginas):
        imagem = Image.new("RGB", (300, 400), (230, 230, 230))
        c.drawImage(ImageReader(imagem), 50, 300, width=300, height=400)
        c.showPage()
    c.save()
    return buf.getvalue()


def pdf_com_tarja_sobre_o_cpf() -> bytes:
    """O "erro de quem cobre com retângulo preto": o CPF continua no arquivo, só ficou invisível."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.drawString(50, 800, "Ata de eleição da diretoria. O presidente eleito é Fulano de Tal, CPF " + CPF_VALIDO)
    c.setFillColorRGB(0, 0, 0)
    c.rect(400, 795, 150, 14, fill=1, stroke=0)  # a tarja
    c.showPage()
    c.save()
    return buf.getvalue()


TEXTO_LIMPO = [
    "ASAF - Associação Arca da Família",
    "ATA DA ASSEMBLEIA GERAL ORDINÁRIA realizada em 10 de outubro de 2026, na sede da associação.",
    "Foram eleitos os membros da diretoria para o mandato 2026-2028 e aprovadas as contas do exercício anterior.",
    "Contato institucional: asaf@asaf.org.br, telefone (94) 98412-0703, CEP 68515-000.",
]


def codigos(achados) -> list[str]:
    return [a.codigo for a in achados]


# --------------------------------------------------------------------------------- documento bom
def test_pdf_limpo_com_dados_institucionais_da_asaf_passa_e_guarda_o_texto():
    r = v.verificar_versao_publica(pdf_com_texto(TEXTO_LIMPO, TEXTO_LIMPO))
    assert r.ok and r.bloqueios == []
    assert r.paginas == 2 and r.caracteres > 100
    assert "Arca da Família" in r.texto  # texto extraído guardado (busca)
    assert "2026-2028" not in codigos(r.bloqueios)  # intervalo de anos não é número de documento


# --------------------------------------------------------------------------------------- CPF
def test_cpf_formatado_e_cpf_valido_sem_pontos_sao_recusados_e_so_a_amostra_mascarada_volta():
    r = v.verificar_versao_publica(pdf_com_texto(TEXTO_LIMPO + [f"Presidente: Maria, CPF {CPF_VALIDO}", f"Secretário CPF {CPF_VALIDO_SEM_PONTOS}"]))
    assert not r.ok
    cpfs = [a for a in r.bloqueios if a.codigo == "CPF"]
    assert len(cpfs) == 1  # é o mesmo CPF escrito de duas formas
    assert cpfs[0].amostra == "111.***.***-35" and cpfs[0].pagina == 1
    tudo = repr(r.como_dicionario())
    assert "444" not in tudo and "777" not in tudo  # o dado inteiro nunca sai no resultado


def test_onze_digitos_que_nao_sao_cpf_nao_bloqueiam():
    r = v.verificar_versao_publica(pdf_com_texto(TEXTO_LIMPO + ["Processo 12345678901 e protocolo 98765432101."]))
    assert "CPF" not in codigos(r.bloqueios)


def test_cpf_valido_funciona_e_rejeita_repeticao():
    assert v.cpf_valido("111.444.777-35") and v.cpf_valido("52998224725")
    assert not v.cpf_valido("111.111.111-11") and not v.cpf_valido("123") and not v.cpf_valido("111.444.777-36")


def test_tarja_preta_desenhada_por_cima_do_cpf_NAO_esconde_nada_e_e_recusada():
    r = v.verificar_versao_publica(pdf_com_tarja_sobre_o_cpf())
    assert not r.ok and "CPF" in codigos(r.bloqueios)


# ------------------------------------------------------------------------- RG e outros documentos
@pytest.mark.parametrize("linha", [
    "Identidade nº 1234567 SSP/PA", "RG: 12.345.678-9", "R.G. 1234567", "CNH 01234567890 categoria B",
    "Título de eleitor 123456789012", "PIS/PASEP 12345678901", "CTPS nº 123456 série 0012",
])
def test_numero_de_documento_pessoal_e_recusado(linha):
    r = v.verificar_versao_publica(pdf_com_texto(TEXTO_LIMPO + [linha]))
    assert "DOCUMENTO_PESSOAL" in codigos(r.bloqueios), linha


def test_rg_formatado_sem_rotulo_tambem_e_recusado():
    r = v.verificar_versao_publica(pdf_com_texto(TEXTO_LIMPO + ["Fulano, 12.345.678-9, brasileiro"]))
    assert "DOCUMENTO_PESSOAL" in codigos(r.bloqueios)


def test_a_palavra_identidade_sem_numero_e_anos_nao_bloqueiam():
    r = v.verificar_versao_publica(pdf_com_texto(TEXTO_LIMPO + ["A identidade visual 2025-2026 da ASAF foi renovada."]))
    assert r.ok


# --------------------------------------------------------------------------- e-mail e telefone
def test_email_pessoal_e_celular_pessoal_sao_recusados_mas_os_da_asaf_passam():
    r = v.verificar_versao_publica(pdf_com_texto(TEXTO_LIMPO + ["Contato: maria.silva@gmail.com e (94) 99123-4567."]))
    assert {"EMAIL", "TELEFONE"} <= set(codigos(r.bloqueios))
    email = next(a for a in r.bloqueios if a.codigo == "EMAIL")
    assert email.amostra == "m***@gmail.com"
    assert v.verificar_versao_publica(pdf_com_texto(TEXTO_LIMPO)).ok  # asaf@asaf.org.br e (94) 98412-0703 do TEXTO_LIMPO


def test_telefone_fixo_e_cep_de_outro_lugar_so_avisam():
    r = v.verificar_versao_publica(pdf_com_texto(TEXTO_LIMPO + ["Fixo (91) 3222-1100. Rua das Flores, CEP 66000-000."]))
    assert r.ok
    assert {"TELEFONE_FIXO", "CEP"} <= set(codigos(r.avisos))


def test_expressoes_de_dado_pessoal_so_avisam_para_quem_aprova_ler():
    r = v.verificar_versao_publica(pdf_com_texto(TEXTO_LIMPO + ["Maria, brasileira, casada, residente na Rua Tal, nascida em 1980."]))
    assert r.ok
    aviso = next(a for a in r.avisos if a.codigo == "PALAVRAS_DE_DADO_PESSOAL")
    assert "residente" in aviso.mensagem and "nascida em" in aviso.mensagem


# ----------------------------------------------------------------------------------- só imagem
def test_pdf_so_imagem_e_recusado_com_a_instrucao_de_fazer_ocr():
    r = v.verificar_versao_publica(pdf_so_imagem(3))
    assert not r.ok and codigos(r.bloqueios) == ["SO_IMAGEM"]
    assert "OCR" in r.bloqueios[0].mensagem and "IN 06/2025" in r.bloqueios[0].mensagem


def test_uma_folha_de_assinaturas_sem_texto_so_avisa():
    texto = [TEXTO_LIMPO, TEXTO_LIMPO, TEXTO_LIMPO, []]  # 3 páginas com texto, 1 em branco
    r = v.verificar_versao_publica(pdf_com_texto(*texto))
    assert r.ok and "PAGINA_SEM_TEXTO" in codigos(r.avisos)


# ------------------------------------------------------------------------------ arquivo estranho
def test_o_que_nao_e_pdf_ou_esta_danificado_ou_e_perigoso_e_recusado_sem_levantar_excecao():
    assert codigos(v.verificar_versao_publica(b"nao sou pdf").bloqueios) == ["NAO_E_PDF"]
    assert codigos(v.verificar_versao_publica(b"%PDF-1.4\nlixo sem estrutura").bloqueios) == ["PDF_ILEGIVEL"]
    assert codigos(v.verificar_versao_publica(b"").bloqueios) == ["NAO_E_PDF"]
    grande = b"%PDF-" + b"0" * (v.TAMANHO_MAXIMO + 1)
    assert codigos(v.verificar_versao_publica(grande).bloqueios) == ["GRANDE_DEMAIS"]


def test_pdf_com_senha_e_pdf_com_javascript_sao_recusados():
    escritor = PdfWriter()
    escritor.add_blank_page(width=200, height=200)
    escritor.encrypt("segredo")
    saida = io.BytesIO()
    escritor.write(saida)
    assert codigos(v.verificar_versao_publica(saida.getvalue()).bloqueios) == ["PDF_COM_SENHA"]

    escritor = PdfWriter()
    escritor.add_blank_page(width=200, height=200)
    escritor.add_js("app.alert('oi')")
    saida = io.BytesIO()
    escritor.write(saida)
    assert codigos(v.verificar_versao_publica(saida.getvalue()).bloqueios) == ["PDF_PERIGOSO"]


def test_dado_pessoal_em_campo_de_formulario_do_pdf_tambem_e_achado():
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.drawString(50, 800, "Formulário de teste com texto suficiente para a camada de texto existir na página.")
    c.acroForm.textfield(name="cpf", value=CPF_VALIDO, x=50, y=700, width=200, height=20)
    c.showPage()
    c.save()
    r = v.verificar_versao_publica(buf.getvalue())
    assert not r.ok and "CPF" in codigos(r.bloqueios)
    assert "formulário" in next(a for a in r.bloqueios if a.codigo == "CPF").mensagem
