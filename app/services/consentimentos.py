"""v7.1b (FASE 7) - o REGISTRO dos consentimentos (LGPD, art. 8º: cabe a quem trata o dado provar que o consentimento foi dado; art. 8º, § 5º: ele pode ser revogado a
qualquer momento, de graça). Ver o modelo em app/models/privacidade.py::Consentimento e os termos em app/textos_de_privacidade.py.

Como funciona:
  - quem envia a foto no painel diz QUEM autorizou e COMO (o termo assinado em papel, guardado pela secretaria, ou digitalizado na biblioteca de Documentos), e a
    versão do termo que estava na tela; o servidor confere que é a versão em vigor (quem estava com a tela velha recebe "recarregue");
  - o consentimento fica ligado ao registro que ele cobre (`origem` + `id_origem`); apagar o registro ENCERRA o consentimento (revogado, apagado ou fim do prazo) e
    revogar no painel é apagar a foto: nada fica publicado sem um consentimento vigente;
  - v7.1c: no atendimento social (origem `beneficiario`) o consentimento é da pessoa atendida e revogar fecha os registros novos (nada é apagado); registrar um
    termo novo SUBSTITUI o vigente;
  - nada se apaga: o consentimento encerrado continua como prova de que houve (e de quando acabou)."""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app import textos_de_privacidade
from app.models.documentos import DocumentoInstitucional
from app.models.privacidade import APAGADO, FIM_DO_PRAZO, INVALIDADO, REVOGADO, SUBSTITUIDO, Consentimento

# de onde vem cada consentimento (o registro que ele cobre) e o termo de cada um
FOTO_DA_DIRETORIA = "foto_da_diretoria"
FOTO_DE_EVENTO = "foto_de_evento"
FOTO_DE_ETAPA = "foto_de_etapa_de_parceria"
BENEFICIARIO = "beneficiario"  # v7.1c: o atendimento social (prontuário e encaminhamentos) de um beneficiário
TERMO_DA_ORIGEM = {FOTO_DA_DIRETORIA: "IMAGEM_DIRETORIA", FOTO_DE_EVENTO: "IMAGEM_ATIVIDADE", FOTO_DE_ETAPA: "IMAGEM_ATIVIDADE",
                   BENEFICIARIO: "ATENDIMENTO_SOCIAL"}
ROTULO_DA_ORIGEM = {FOTO_DA_DIRETORIA: "Foto da Diretoria no site", FOTO_DE_EVENTO: "Foto de evento", FOTO_DE_ETAPA: "Foto de etapa de parceria",
                    BENEFICIARIO: "Atendimento social do beneficiário"}

# quem consente pela criança ou pelo adolescente (v7.1c)
TITULAR = "titular"
RESPONSAVEL = "responsavel"
RESPONSAVEL_LEGAL = "responsavel_legal"
VINCULOS = {"mae": "Mãe", "pai": "Pai", RESPONSAVEL_LEGAL: "Responsável legal (guarda, tutela ou curatela)"}

# como o consentimento foi dado
TERMO_EM_PAPEL = "termo_em_papel"
TERMO_DIGITALIZADO = "termo_digitalizado"
DECLARACAO_ANTIGA = "declaracao_antiga"  # as fotos de antes da v7.1b (a declaração de quem enviou) e a marca no cadastro do beneficiário de antes da v7.1c
MEIOS = {
    TERMO_EM_PAPEL: "Termo assinado em papel, guardado pela secretaria",
    TERMO_DIGITALIZADO: "Termo assinado e digitalizado na biblioteca de Documentos",
    DECLARACAO_ANTIGA: "Declaração de quem enviou a foto (antes do termo do sistema)",
}
# no atendimento social a marca antiga era do cadastro, não de quem enviou foto
MEIOS_DA_ORIGEM = {BENEFICIARIO: {DECLARACAO_ANTIGA: "Marca no cadastro do beneficiário (antes do termo do sistema): não vale para registrar atendimento"}}
ENCERRAMENTOS = {REVOGADO: "Revogado (a pessoa retirou a autorização)", APAGADO: "Encerrado: a foto foi apagada", FIM_DO_PRAZO: "Encerrado: acabou o mandato",
                 SUBSTITUIDO: "Encerrado: substituído por um termo registrado depois",
                 INVALIDADO: "Encerrado: o nascimento corrigido mostra que quem assinou sozinho era menor de idade"}
ENCERRAMENTOS_DA_ORIGEM = {BENEFICIARIO: {REVOGADO: "Revogado (a pessoa ou o responsável retirou o consentimento)"}}


def _rotulo_do_meio(c: Consentimento) -> str:
    return MEIOS_DA_ORIGEM.get(c.origem, {}).get(c.meio) or MEIOS.get(c.meio, c.meio)


def _rotulo_do_encerramento(c: Consentimento) -> Optional[str]:
    return ENCERRAMENTOS_DA_ORIGEM.get(c.origem, {}).get(c.encerramento or "") or ENCERRAMENTOS.get(c.encerramento or "")


class ApagarFoto(BaseModel):
    """O corpo do DELETE de uma foto (o motivo vai no corpo, nunca no endereço: o endereço fica no registro de acesso do servidor)."""
    revogado: bool = False  # a pessoa retirou a autorização (o consentimento fica REVOGADO)
    motivo: Optional[str] = Field(None, max_length=500)


class ApagarFotoDaDiretoria(ApagarFoto):
    revogado: bool = True  # na Diretoria, a tela só oferece apagar porque a pessoa retirou a autorização


def _data_da_assinatura(assinado_em: Optional[str]) -> datetime:
    """A data em que o termo foi assinado (é a que vale como prova, não a do envio da foto): obrigatória, não pode ser futura nem absurda."""
    from app.services.fuso import FUSO_ASAF

    try:
        dia = date.fromisoformat((assinado_em or "").strip())
    except ValueError:
        raise HTTPException(status_code=400, detail="Informe a data em que o termo foi assinado.") from None
    if dia > datetime.now(FUSO_ASAF).date():
        raise HTTPException(status_code=400, detail="A data da assinatura do termo não pode ser depois de hoje.")
    if dia.year < 2000:
        raise HTTPException(status_code=400, detail="Confira a data da assinatura do termo.")
    return datetime(dia.year, dia.month, dia.day)


def exigir_dados(db: Session, *, origem: str, versao_do_termo: Optional[str], quem_autorizou: Optional[str], meio: Optional[str],
                 id_documento: Optional[int], assinado_em: Optional[str] = None) -> tuple[str, str, str, datetime]:
    """Confere o que a tela mandou ANTES de gravar a foto (para não sobrar foto sem consentimento). Devolve (termo, versão, quem autorizou, data da assinatura)."""
    termo = TERMO_DA_ORIGEM[origem]
    vigente = textos_de_privacidade.versao_atual(termo)
    if versao_do_termo != vigente:
        raise HTTPException(status_code=422, detail=f"O termo ({textos_de_privacidade.ponto(termo).nome}) foi atualizado: recarregue a página e confira a "
                                                    "versão em vigor.")
    quem = " ".join((quem_autorizou or "").split())
    if len(quem) < 3:
        raise HTTPException(status_code=400, detail="Diga quem autorizou o uso da imagem (o nome de quem assinou o termo).")
    if meio not in (TERMO_EM_PAPEL, TERMO_DIGITALIZADO):
        raise HTTPException(status_code=400, detail="Diga como o termo foi entregue: assinado em papel ou digitalizado na biblioteca de Documentos.")
    if meio == TERMO_DIGITALIZADO and id_documento is None:
        raise HTTPException(status_code=400, detail="Informe o número do documento do termo digitalizado (na biblioteca de Documentos).")
    if id_documento is not None and not db.query(DocumentoInstitucional.id_documento).filter(DocumentoInstitucional.id_documento == id_documento).first():
        raise HTTPException(status_code=404, detail=f"O documento nº {id_documento} (o termo assinado) não existe.")
    return termo, vigente, quem[:300], _data_da_assinatura(assinado_em)


def registrar(db: Session, usuario, *, origem: str, id_origem: int, termo: str, versao: str, titular: str, meio: str, dado_em: datetime,
              id_documento: Optional[int] = None, id_pessoa: Optional[int] = None, dado_por: Optional[str] = None, nome_responsavel: Optional[str] = None,
              vinculo_responsavel: Optional[str] = None, agora: Optional[datetime] = None) -> Consentimento:
    """Grava o consentimento (sem commit: vai na mesma transação do registro que ele cobre). `dado_em` é a data da assinatura do termo."""
    agora = agora or datetime.utcnow()
    c = Consentimento(
        ponto=termo, versao=versao, titular=titular, id_pessoa=id_pessoa, dado_por=dado_por, nome_responsavel=nome_responsavel,
        vinculo_responsavel=vinculo_responsavel, meio=meio, id_documento=id_documento, dado_em=dado_em,
        id_usuario_registro=getattr(usuario, "id_usuario", None), registrado_em=agora, origem=origem, id_origem=id_origem,
    )
    db.add(c)
    return c


def vigente(db: Session, origem: str, id_origem: int, *, travar: bool = False) -> Optional[Consentimento]:
    """`travar`: trava a linha até o fim da transação (quem encerra): duas pessoas encerrando ao mesmo tempo, a segunda relê e não acha mais o vigente (sem a
    trava, a segunda reescreveria o motivo da primeira, e a prova da revogação mudaria). O SQLite dos testes não trava, e não precisa."""
    q = db.query(Consentimento).filter(Consentimento.origem == origem, Consentimento.id_origem == id_origem, Consentimento.encerrado_em.is_(None))
    return (q.with_for_update() if travar else q).first()


def vale_para_gravar(c: Optional[Consentimento]) -> bool:
    """v7.1c: a marca antiga (de antes do termo) fica como prova do que havia, mas não abre o atendimento: só o termo assinado e registrado."""
    return c is not None and c.meio != DECLARACAO_ANTIGA


def encerrar(db: Session, usuario, *, origem: str, id_origem: int, como: str, motivo: Optional[str] = None,
             agora: Optional[datetime] = None) -> Optional[Consentimento]:
    """Encerra o consentimento vigente do registro (sem commit: vai junto da exclusão do registro). REVOGADO quando a pessoa retirou a autorização."""
    c = vigente(db, origem, id_origem, travar=True)
    if c is None:
        return None
    c.encerrado_em = agora or datetime.utcnow()
    c.encerramento = como
    c.motivo_encerramento = " ".join((motivo or "").split())[:500] or None
    c.id_usuario_encerramento = getattr(usuario, "id_usuario", None)
    return c


def como_encerrar(revogado: bool) -> str:
    return REVOGADO if revogado else APAGADO


def para_o_painel(c: Optional[Consentimento], *, com_quem: bool = True) -> Optional[dict]:
    """`com_quem=False`: sem o nome de quem assinou (para quem só lê a tela da foto, sem cuidar dela: menor privilégio)."""
    if c is None:
        return None
    dados = {
        "id_consentimento": c.id_consentimento, "termo": c.ponto, "versao": c.versao, "titular": c.titular, "dado_por": c.dado_por,
        "nome_responsavel": c.nome_responsavel, "vinculo_responsavel": c.vinculo_responsavel,
        "vinculo_rotulo": VINCULOS.get(c.vinculo_responsavel or ""), "meio": c.meio,
        "meio_rotulo": _rotulo_do_meio(c), "id_documento": c.id_documento, "dado_em": c.dado_em, "origem": c.origem,
        "origem_rotulo": ROTULO_DA_ORIGEM.get(c.origem, c.origem), "id_origem": c.id_origem, "encerrado_em": c.encerrado_em, "encerramento": c.encerramento,
        "encerramento_rotulo": _rotulo_do_encerramento(c), "motivo_encerramento": c.motivo_encerramento,
        "versao_atual_do_termo": textos_de_privacidade.versao_atual(c.ponto),
    }
    if not com_quem:
        dados["titular"] = dados["nome_responsavel"] = None
    return dados


POR_PAGINA = 50


def listar(db: Session, *, situacao: Optional[str] = None, origem: Optional[str] = None, busca: Optional[str] = None, pagina: int = 1) -> dict:
    """Para Privacidade > Consentimentos: os vigentes e os encerrados (a prova fica), o mais novo primeiro, de 50 em 50. `busca` procura no nome de quem
    consentiu ou do responsável que consentiu por ela: quem retira a autorização de atividade tem de ter TODAS as fotos em que aparece apagadas, e é por aqui
    que se acham os consentimentos dela."""
    q = db.query(Consentimento)
    if situacao == "vigentes":
        q = q.filter(Consentimento.encerrado_em.is_(None))
    elif situacao == "encerrados":
        q = q.filter(Consentimento.encerrado_em.isnot(None))
    if origem:
        q = q.filter(Consentimento.origem == origem)
    termo = " ".join((busca or "").split())
    if termo:
        q = q.filter(or_(func.lower(Consentimento.titular).contains(termo.lower()),
                         func.lower(func.coalesce(Consentimento.nome_responsavel, "")).contains(termo.lower())))
    total = q.count()
    pagina = max(1, pagina)
    linhas = q.order_by(Consentimento.dado_em.desc(), Consentimento.id_consentimento.desc()).offset((pagina - 1) * POR_PAGINA).limit(POR_PAGINA)
    return {"consentimentos": [para_o_painel(c) for c in linhas], "total": total, "pagina": pagina, "por_pagina": POR_PAGINA}


def termo_para_a_tela(origem: str) -> dict:
    """O termo em vigor para a tela de envio de foto mostrar (e mandar a versão de volta)."""
    termo = TERMO_DA_ORIGEM[origem]
    t = textos_de_privacidade.atual(termo)
    return {"termo": termo, "versao": t.versao, "nome": textos_de_privacidade.ponto(termo).nome, "texto": textos_de_privacidade.sem_links(t.texto),
            "meios": [{"codigo": k, "rotulo": MEIOS[k]} for k in (TERMO_EM_PAPEL, TERMO_DIGITALIZADO)]}


def pdf_do_termo(termo: str) -> bytes:
    """O termo em vigor para imprimir e assinar."""
    from app.services import pdf_de_texto

    if termo not in set(TERMO_DA_ORIGEM.values()):
        raise HTTPException(status_code=404, detail="Termo não encontrado.")
    t = textos_de_privacidade.atual(termo)
    nome = textos_de_privacidade.ponto(termo).nome
    titulo = "TERMO DE CONSENTIMENTO" if termo == "ATENDIMENTO_SOCIAL" else "TERMO DE AUTORIZAÇÃO DE USO DE IMAGEM"
    linhas = [titulo, nome, ""]
    for paragrafo in textos_de_privacidade.sem_links(t.texto).split("\n\n"):
        linhas += [*paragrafo.split("\n"), ""]
    return pdf_de_texto.gerar(
        titulo.capitalize(), linhas, titulos=frozenset({0, 1}),
        rodape=f"ASAF - Associação Arca da Família · termo versão {t.versao}, em vigor desde {t.vigente_desde.strftime('%d/%m/%Y')}",
    )

