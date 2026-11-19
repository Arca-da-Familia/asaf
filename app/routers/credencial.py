"""v9.5i - a credencial do associado (a carteirinha), com QR que vale sempre e mostra a situação de AGORA (decisão do Presidente, 14/11/2026).

- `GET /api/minha-credencial`: a do associado que está logado (Minha carteirinha). Nasce na primeira vez que é aberta.
- `POST /api/associados/{id}/credencial/emitir-outra`: quem perdeu o cartão (permissão de associados): a credencial que valia deixa de valer NA HORA e
  nasce outra com código novo; fica na Auditoria.
- v9.5j, as CREDENCIAIS EMITIDAS (permissão de associados): a lista com filtros (falta imprimir, impressas, emitidas de novo), as contagens, a
  pré-visualização da impressão (a 2ª aba) e o registro da impressão - credencial com dado faltando (foto, matrícula) só se imprime com justificativa,
  que fica na Auditoria.
- v9.5k, o CRIADOR DE CREDENCIAL (permissão de associados): os modelos guardados, o em uso e os prontos; guardar, alterar (nunca o em uso),
  apagar (nunca o em uso) e "usar para todos" (o anterior fica guardado). Toda mudança fica na Auditoria. O desenho em uso vale para a folha A4, para a
  impressão da Minha carteirinha e para as cores do cabeçalho dela no celular; sem nenhum em uso, vale o pronto "Faixa no alto".
- `GET /api/publico/credencial/{codigo}` e `.../foto`: a página de quem lê o QR (portaria, outro associado, parceiro), SEM login. Só o mínimo para
  conferir a pessoa: foto, nome, matrícula, categoria e a situação de agora. Nunca CPF, endereço, telefone ou e-mail. Credencial que não vale
  (substituída, de quem saiu, código que não existe): nem nome nem foto, e o mesmo texto nos três casos."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import String as SqlString
from sqlalchemy import and_, cast, exists, or_
from sqlalchemy.orm import Session, aliased

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.associados import Associado
from app.models.core import Usuario
from app.models.pessoas import Pessoa
from app.security import exigir_permissao, get_current_user
from app.services import armazenamento
from app import paginacao
from app.models.credencial import PERDA_OU_TROCA, Credencial
from app.models.modelo_credencial import ModeloCredencial
from app.services import credencial as credenciais
from app.services import modelo_credencial as modelos

router = APIRouter()
_permissao_associados = exigir_permissao("associados")


def _arquivo_da_foto(pessoa: Pessoa) -> Optional[tuple[str, str]]:
    """(pasta, nome) da foto do cadastro, só se for uma imagem que o sistema serve."""
    alvo = armazenamento.separar_url(pessoa.foto)
    if alvo is None or armazenamento.tipo_servido(alvo[1]) not in ("image/jpeg", "image/png", "image/webp"):
        return None
    return alvo


@router.get("/api/minha-credencial", summary="Minha carteirinha: a credencial de quem está logado (o QR vale sempre)")
def minha_credencial(db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
    if associado is None:
        raise HTTPException(status_code=404, detail="Você não tem cadastro de associado: a carteirinha é de associado.")
    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == associado.id_pessoa).first()
    c = credenciais.atual(db, associado, usuario.id_usuario)
    db.commit()
    return {
        "codigo": c.codigo,
        "pagina": f"{credenciais.CAMINHO_DA_PAGINA}{c.codigo}",
        "emitida_em": c.emitida_em.isoformat() if c.emitida_em else None,
        "nome_completo": pessoa.nome_completo if pessoa else None,
        "matricula": associado.numero_matricula,
        "categoria": associado.categoria,
        "situacao": credenciais.situacao_de_agora(db, associado),
        "associado_desde": associado.data_admissao.date().isoformat() if associado.data_admissao else None,
        "foto": pessoa.foto if pessoa and _arquivo_da_foto(pessoa) else None,
        # v9.5k: o desenho em uso (a impressão da Minha carteirinha e as cores do cabeçalho no celular)
        "desenho": _modelo_em_uso(db)["desenho"],
    }


@router.get("/api/publico/credencial/{codigo}", summary="Quem lê o QR da credencial: a situação de agora (público, sem dado de contato)")
def conferir_credencial(codigo: str, db: Session = Depends(get_db)):
    return credenciais.situacao_publica(db, credenciais.codigo_lido(codigo), lambda pessoa: _arquivo_da_foto(pessoa) is not None)


@router.get("/api/publico/credencial/{codigo}/foto", summary="A foto de quem a credencial identifica, só enquanto ela vale (público)")
def foto_da_credencial(codigo: str, db: Session = Depends(get_db)):
    dono = credenciais.dono_que_vale(db, credenciais.por_codigo(db, credenciais.codigo_lido(codigo)))
    alvo = _arquivo_da_foto(dono[1]) if dono else None
    if alvo is None:
        raise HTTPException(status_code=404, detail="Foto não encontrada.")
    try:
        conteudo = armazenamento.obter().ler(*alvo)
    except Exception:  # noqa: BLE001 - rede, permissão: quem pede a foto recebe um erro claro, não um 500 sem explicação
        armazenamento.LOG.exception("não foi possível ler a foto da credencial")
        raise HTTPException(status_code=502, detail="Não consegui ler a foto agora. Tente de novo em instantes.")
    if conteudo is None:
        raise HTTPException(status_code=404, detail="Foto não encontrada.")
    return Response(
        content=conteudo, media_type=armazenamento.tipo_servido(alvo[1]),
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"},
    )


@router.post("/api/associados/{id_associado}/credencial/emitir-outra", summary="Emitir outra credencial (quem perdeu o cartão): a anterior deixa de valer na hora")
def emitir_outra_credencial(id_associado: int, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_associados)):
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if associado is None:
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    if associado.status_arrolamento == credenciais.DESLIGADO:
        raise HTTPException(status_code=409, detail="Quem está desligado não tem credencial valendo: readmita antes de emitir outra.")
    anterior, nova = credenciais.emitir_outra(db, associado, usuario.id_usuario)
    registrar_auditoria(
        db, usuario, "associados", "CREDENCIAL_EMITIDA_DE_NOVO", id_registro_afetado=id_associado,
        dados_depois={"anterior_emitida_em": anterior.emitida_em.isoformat() if anterior and anterior.emitida_em else None},
    )
    db.commit()
    return {
        "mensagem": "Credencial nova emitida. A anterior deixou de valer.",
        "codigo": nova.codigo,
        "pagina": f"{credenciais.CAMINHO_DA_PAGINA}{nova.codigo}",
        "emitida_em": nova.emitida_em.isoformat() if nova.emitida_em else None,
    }


# ------------------------------------------------------------------------------------------------------------------------------------------------
# v9.5j - as credenciais emitidas (rodada 6: tabela com seleção; imprimir as marcadas numa folha A4 numa 2ª aba; recusar dado faltando sem justificativa)
# ------------------------------------------------------------------------------------------------------------------------------------------------
FILTROS = ("todas", "falta_imprimir", "impressas", "emitidas_de_novo")
MAXIMO_POR_PEDIDO = 60  # 6 folhas A4 de 10 cartões por vez
MINIMO_DA_JUSTIFICATIVA = 10


def _faltando(associado: Associado, pessoa: Pessoa) -> list[str]:
    """O que falta para o cartão sair completo."""
    falta = []
    if not pessoa.nome_completo or not pessoa.nome_completo.strip():
        falta.append("nome")
    if associado.numero_matricula is None:
        falta.append("matrícula")
    if _arquivo_da_foto(pessoa) is None:
        falta.append("foto")
    return falta


def _consulta_das_credenciais(db: Session, filtro: str, busca: Optional[str]):
    valendo = aliased(Credencial)
    consulta = (
        db.query(Associado, Pessoa, valendo)
        .join(Pessoa, Pessoa.id_pessoa == Associado.id_pessoa)
        .outerjoin(valendo, and_(valendo.id_associado == Associado.id_associado, valendo.substituida_em.is_(None)))
        # desligado não tem credencial valendo (quem lê o QR vê "não vale"): fica fora da lista
        .filter(or_(Associado.status_arrolamento.is_(None), Associado.status_arrolamento != credenciais.DESLIGADO))
    )
    if filtro == "falta_imprimir":
        consulta = consulta.filter(valendo.impressa_em.is_(None))
    elif filtro == "impressas":
        consulta = consulta.filter(valendo.impressa_em.isnot(None))
    elif filtro == "emitidas_de_novo":
        consulta = consulta.filter(exists().where(and_(
            Credencial.id_associado == Associado.id_associado, Credencial.motivo_substituicao == PERDA_OU_TROCA,
        )))
    termo = (busca or "").strip()
    if termo:
        consulta = consulta.filter(or_(
            Pessoa.nome_completo.ilike(f"%{termo}%"), cast(Associado.numero_matricula, SqlString) == termo,
        ))
    return consulta


@router.get("/api/credenciais", summary="Credenciais emitidas: a de cada associado, com filtros (falta imprimir, impressas, emitidas de novo)")
def listar_credenciais(
    resposta: Response,
    filtro: str = Query("todas"),
    busca: Optional[str] = Query(None, max_length=120),
    pagina: Optional[int] = paginacao.PAGINA,
    por_pagina: int = paginacao.POR_PAGINA,
    db: Session = Depends(get_db),
    _usuario: Usuario = Depends(_permissao_associados),
):
    if filtro not in FILTROS:
        raise HTTPException(status_code=422, detail="Filtro desconhecido.")
    consulta = _consulta_das_credenciais(db, filtro, busca)
    linhas = paginacao.aplicar(consulta.order_by(Pessoa.nome_completo, Associado.id_associado), pagina, por_pagina, resposta)
    ids = [a.id_associado for a, _, _ in linhas] or [-1]
    de_novo = {
        i for (i,) in db.query(Credencial.id_associado).filter(
            Credencial.id_associado.in_(ids), Credencial.motivo_substituicao == PERDA_OU_TROCA,
        )
    }
    return [
        {
            "id_associado": associado.id_associado,
            "nome_completo": pessoa.nome_completo,
            "matricula": associado.numero_matricula,
            "situacao": credenciais.situacao_de_agora(db, associado),
            "credencial": None if credencial is None else {
                "emitida_em": credencial.emitida_em.isoformat() if credencial.emitida_em else None,
                "impressa_em": credencial.impressa_em.isoformat() if credencial.impressa_em else None,
            },
            "emitida_de_novo": associado.id_associado in de_novo,
            "faltando": _faltando(associado, pessoa),
        }
        for associado, pessoa, credencial in linhas
    ]


@router.get("/api/credenciais/resumo", summary="Credenciais emitidas: quantas em cada filtro")
def resumir_credenciais(db: Session = Depends(get_db), _usuario: Usuario = Depends(_permissao_associados)):
    return {f: _consulta_das_credenciais(db, f, None).order_by(None).count() for f in FILTROS}


def _dos_ids(texto: str) -> list[int]:
    try:
        ids = list(dict.fromkeys(int(x) for x in texto.split(",") if x.strip()))
    except ValueError:
        raise HTTPException(status_code=422, detail="Lista de associados inválida.")
    if not ids:
        raise HTTPException(status_code=422, detail="Escolha pelo menos um associado.")
    if len(ids) > MAXIMO_POR_PEDIDO:
        raise HTTPException(status_code=422, detail=f"No máximo {MAXIMO_POR_PEDIDO} credenciais por vez.")
    return ids


def _associados_para_imprimir(db: Session, ids: list[int]) -> list[tuple[Associado, Pessoa]]:
    achados = {
        a.id_associado: (a, p)
        for a, p in db.query(Associado, Pessoa).join(Pessoa, Pessoa.id_pessoa == Associado.id_pessoa).filter(Associado.id_associado.in_(ids))
    }
    if any(i not in achados for i in ids):
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    desligados = [p.nome_completo or "sem nome" for a, p in achados.values() if a.status_arrolamento == credenciais.DESLIGADO]
    if desligados:
        raise HTTPException(status_code=409, detail="Desligado não tem credencial valendo: " + ", ".join(desligados) + ".")
    return [achados[i] for i in ids]


@router.get("/api/credenciais/para-imprimir", summary="A folha de impressão (2ª aba): os cartões das credenciais escolhidas e o que falta em cada um")
def credenciais_para_imprimir(
    ids: str = Query(..., max_length=2000), db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_associados),
):
    cartoes = []
    for associado, pessoa in _associados_para_imprimir(db, _dos_ids(ids)):
        c = credenciais.atual(db, associado, usuario.id_usuario)
        cartoes.append({
            "id_associado": associado.id_associado,
            "nome_completo": pessoa.nome_completo,
            "matricula": associado.numero_matricula,
            "categoria": associado.categoria,
            "associado_desde": associado.data_admissao.date().isoformat() if associado.data_admissao else None,
            "foto": pessoa.foto if _arquivo_da_foto(pessoa) else None,
            "pagina": f"{credenciais.CAMINHO_DA_PAGINA}{c.codigo}",
            "impressa_em": c.impressa_em.isoformat() if c.impressa_em else None,
            "faltando": _faltando(associado, pessoa),
        })
    db.commit()
    return cartoes


class RegistroDaImpressao(BaseModel):
    ids: list[int] = Field(..., min_length=1, max_length=MAXIMO_POR_PEDIDO)
    # justificativa de quem sai com dado faltando, pelo número do associado
    justificativas: dict[int, str] = Field(default_factory=dict)


@router.post("/api/credenciais/registrar-impressao", summary="Registra a impressão: credencial com dado faltando só com justificativa (fica na Auditoria)")
def registrar_impressao(dados: RegistroDaImpressao, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_associados)):
    escolhidos = _associados_para_imprimir(db, list(dict.fromkeys(dados.ids)))
    sem_justificativa = []
    for associado, pessoa in escolhidos:
        falta = _faltando(associado, pessoa)
        justificativa = (dados.justificativas.get(associado.id_associado) or "").strip()
        if falta and len(justificativa) < MINIMO_DA_JUSTIFICATIVA:
            sem_justificativa.append(f"{pessoa.nome_completo or 'sem nome'} (falta {', '.join(falta)})")
    if sem_justificativa:
        raise HTTPException(
            status_code=409,
            detail="Falta dado no cartão e não há justificativa (pelo menos 10 letras): " + "; ".join(sem_justificativa) + ". Nada foi registrado.",
        )
    agora = datetime.utcnow()
    for associado, pessoa in escolhidos:
        c = credenciais.atual(db, associado, usuario.id_usuario)
        c.impressa_em = agora
        falta = _faltando(associado, pessoa)
        registrar_auditoria(
            db, usuario, "associados", "CREDENCIAL_IMPRESSA", id_registro_afetado=associado.id_associado,
            dados_depois={"faltando": falta, "justificativa": (dados.justificativas.get(associado.id_associado) or "").strip() if falta else None},
        )
    db.commit()
    n = len(escolhidos)
    quantas = "1 credencial impressa" if n == 1 else f"{n} credenciais impressas"
    return {"mensagem": f"Registrado: {quantas}.", "impressas": n}


# ---------------------------------------------------------------- v9.5k: o criador de credencial ----------------------------------------------------------------
def _modelo_em_uso(db: Session) -> dict:
    """O desenho que vale agora: o modelo em uso ou, sem nenhum, o pronto "Faixa no alto"."""
    m = db.query(ModeloCredencial).filter(ModeloCredencial.em_uso.is_(True)).order_by(ModeloCredencial.usado_desde.desc()).first()
    if m is None:
        pronto = modelos.PRONTOS[modelos.PADRAO]
        return {"id_modelo": None, "nome": pronto["nome"], "desenho": pronto["desenho"], "pronto": modelos.PADRAO}
    return {"id_modelo": m.id_modelo, "nome": m.nome, "desenho": m.desenho, "pronto": None}


def _modelo_saida(m: ModeloCredencial) -> dict:
    return {
        "id_modelo": m.id_modelo,
        "nome": m.nome,
        "desenho": m.desenho,
        "em_uso": bool(m.em_uso),
        "usado_desde": m.usado_desde.isoformat() if m.usado_desde else None,
        "atualizado_em": m.atualizado_em.isoformat() if m.atualizado_em else None,
    }


def _modelo_ou_404(db: Session, id_modelo: int) -> ModeloCredencial:
    m = db.query(ModeloCredencial).filter(ModeloCredencial.id_modelo == id_modelo).first()
    if m is None:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")
    return m


class ModeloEntrada(BaseModel):
    nome: str = Field(min_length=1, max_length=60)
    desenho: dict


def _desenho_conferido(dados: dict) -> dict:
    try:
        desenho = modelos.Desenho.model_validate(dados)
    except modelos.ValidationError as erro:
        raise HTTPException(status_code=422, detail=" ".join(modelos.erros_de_formato(erro)))
    achados = modelos.problemas(desenho)
    if achados:
        raise HTTPException(status_code=422, detail=" ".join(achados))
    return desenho.model_dump(exclude_none=True)


def _nome_limpo(nome: str) -> str:
    limpo = " ".join(nome.split())
    if not limpo:
        raise HTTPException(status_code=422, detail="Dê um nome ao modelo.")
    return limpo


@router.get("/api/credenciais/modelos", summary="Criador de credencial: o modelo em uso, os guardados e os prontos")
def listar_modelos(db: Session = Depends(get_db), _usuario: Usuario = Depends(_permissao_associados)):
    guardados = db.query(ModeloCredencial).order_by(ModeloCredencial.em_uso.desc(), ModeloCredencial.atualizado_em.desc()).all()
    return {
        "em_uso": _modelo_em_uso(db),
        "guardados": [_modelo_saida(m) for m in guardados],
        "prontos": [{"chave": chave, "nome": p["nome"], "desenho": p["desenho"]} for chave, p in modelos.PRONTOS.items()],
        "maximo_guardados": modelos.MAXIMO_DE_MODELOS_GUARDADOS,
    }


@router.get("/api/credenciais/modelo-em-uso", summary="O desenho da credencial que vale agora (a folha A4 de impressão)")
def modelo_em_uso(db: Session = Depends(get_db), _usuario: Usuario = Depends(_permissao_associados)):
    return _modelo_em_uso(db)


@router.get("/api/credenciais/modelos/{id_modelo}", summary="Um modelo de credencial guardado (para o editor)")
def obter_modelo(id_modelo: int, db: Session = Depends(get_db), _usuario: Usuario = Depends(_permissao_associados)):
    return _modelo_saida(_modelo_ou_404(db, id_modelo))


@router.post("/api/credenciais/modelos", status_code=201, summary="Guarda um modelo de credencial novo (não muda o que está em uso)")
def criar_modelo(dados: ModeloEntrada, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_associados)):
    if db.query(ModeloCredencial).count() >= modelos.MAXIMO_DE_MODELOS_GUARDADOS:
        raise HTTPException(status_code=409, detail=f"Já há {modelos.MAXIMO_DE_MODELOS_GUARDADOS} modelos guardados: apague algum antes.")
    agora = datetime.utcnow()
    m = ModeloCredencial(
        nome=_nome_limpo(dados.nome), desenho=_desenho_conferido(dados.desenho), em_uso=False, criado_em=agora, atualizado_em=agora,
        id_usuario_criacao=usuario.id_usuario, id_usuario_atualizacao=usuario.id_usuario,
    )
    db.add(m)
    db.flush()
    registrar_auditoria(db, usuario, "associados", "MODELO_CREDENCIAL_GUARDADO", id_registro_afetado=m.id_modelo, dados_depois={"nome": m.nome})
    db.commit()
    db.refresh(m)
    return _modelo_saida(m)


@router.put("/api/credenciais/modelos/{id_modelo}", summary="Altera um modelo guardado (o em uso não se altera: guarde uma cópia)")
def alterar_modelo(id_modelo: int, dados: ModeloEntrada, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_associados)):
    m = _modelo_ou_404(db, id_modelo)
    if m.em_uso:
        raise HTTPException(status_code=409, detail="O modelo em uso não se altera: guarde como um modelo novo e depois use-o para todos.")
    nome_antes = m.nome
    m.nome = _nome_limpo(dados.nome)
    m.desenho = _desenho_conferido(dados.desenho)
    m.atualizado_em = datetime.utcnow()
    m.id_usuario_atualizacao = usuario.id_usuario
    registrar_auditoria(
        db, usuario, "associados", "MODELO_CREDENCIAL_ALTERADO", id_registro_afetado=m.id_modelo,
        dados_antes={"nome": nome_antes}, dados_depois={"nome": m.nome},
    )
    db.commit()
    db.refresh(m)
    return _modelo_saida(m)


@router.post("/api/credenciais/modelos/{id_modelo}/usar", summary="Usar este modelo para todas as credenciais (o anterior fica guardado; o QR de cada uma não muda)")
def usar_modelo(id_modelo: int, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_associados)):
    m = _modelo_ou_404(db, id_modelo)
    _desenho_conferido(m.desenho)
    anterior = _modelo_em_uso(db)
    for outro in db.query(ModeloCredencial).filter(ModeloCredencial.em_uso.is_(True), ModeloCredencial.id_modelo != m.id_modelo).all():
        outro.em_uso = False
    m.em_uso = True
    m.usado_desde = datetime.utcnow()
    registrar_auditoria(
        db, usuario, "associados", "MODELO_CREDENCIAL_EM_USO", id_registro_afetado=m.id_modelo,
        dados_antes={"modelo": anterior["nome"]}, dados_depois={"modelo": m.nome},
    )
    db.commit()
    return {"mensagem": f"Pronto: \"{m.nome}\" é o desenho de todas as credenciais. O QR de cada uma continua o mesmo.", "em_uso": _modelo_em_uso(db)}


@router.delete("/api/credenciais/modelos/{id_modelo}", summary="Apaga um modelo guardado (nunca o em uso)")
def apagar_modelo(id_modelo: int, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_associados)):
    m = _modelo_ou_404(db, id_modelo)
    if m.em_uso:
        raise HTTPException(status_code=409, detail="O modelo em uso não se apaga: use outro antes.")
    registrar_auditoria(db, usuario, "associados", "MODELO_CREDENCIAL_APAGADO", id_registro_afetado=m.id_modelo, dados_antes={"nome": m.nome})
    db.delete(m)
    db.commit()
    return {"mensagem": "Modelo apagado."}
