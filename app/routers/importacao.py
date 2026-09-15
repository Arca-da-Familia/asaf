"""v1.3 (FASE 1) - Importação/exportação de base existente. O parsing do arquivo (Excel/CSV)
acontece no navegador (painel) - o arquivo bruto nunca sobe pro servidor; o que chega aqui já é
JSON estruturado, linha por linha, mapeado e revisado pelo assistente de 4 passos."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.associados import Associado, DependenteFamiliar, DocumentoAnexo, Endereco, HistoricoCargo
from app.models.financeiro import TituloFinanceiro
from app.models.importacao import LoteImportacao
from app.models.pessoas import Papel, Pessoa
from app.schemas.importacao import ImportarLoteRequest, VerificarDuplicidadeRequest
from app.security import exigir_permissao
from app.services.duplicidade import verificar_duplicidade
from app.services.matricula import proximo_numero_matricula

router = APIRouter()
_permissao_associados = exigir_permissao("associados")
_permissao_exportar = exigir_permissao("exportar_dados_pessoais")

# Colunas exportáveis - allowlist explícita (nunca um getattr solto em cima de input do
# cliente): novo campo pessoal só pode ser exportado depois de decidir conscientemente que pode.
_COLUNAS_EXPORTAVEIS = {
    "id_associado": lambda a: a.id_associado,
    "numero_matricula": lambda a: a.numero_matricula,
    "nome_completo": lambda a: a.nome_completo,
    "cpf": lambda a: a.cpf,
    "email_contato": lambda a: a.email_contato,
    "telefone_whatsapp": lambda a: a.telefone_whatsapp,
    "data_nascimento": lambda a: a.data_nascimento.date().isoformat() if a.data_nascimento else None,
    "categoria": lambda a: a.categoria,
    "status_arrolamento": lambda a: a.status_arrolamento,
    "data_admissao": lambda a: a.data_admissao.date().isoformat() if a.data_admissao else None,
}


@router.post("/api/associados/verificar-duplicidade", summary="Checar duplicidade de linhas antes de importar")
def verificar_duplicidade_lote(
    dados: VerificarDuplicidadeRequest, db: Session = Depends(get_db), _usuario=Depends(_permissao_associados)
):
    resultado = []
    for i, linha in enumerate(dados.linhas):
        data_nasc = datetime.combine(linha.data_nascimento, datetime.min.time()) if linha.data_nascimento else None
        veredito = verificar_duplicidade(db, linha.nome_completo, linha.cpf, data_nasc)
        resultado.append({"indice": i, **veredito})
    return {"resultados": resultado}


@router.post("/api/associados/importar-lote", summary="Importar associados em lote")
def importar_lote(
    dados: ImportarLoteRequest, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_associados)
):
    lote = LoteImportacao(id_usuario_criador=usuario.id_usuario, total_linhas=len(dados.linhas))
    db.add(lote)
    db.flush()

    criados, ignorados, erros = 0, 0, []
    for i, linha in enumerate(dados.linhas):
        if linha.resolucao == "ignorar":
            ignorados += 1
            continue

        data_nasc = datetime.combine(linha.data_nascimento, datetime.min.time()) if linha.data_nascimento else None
        veredito = verificar_duplicidade(db, linha.nome_completo, linha.cpf, data_nasc)
        if veredito["tipo"] is not None:
            erros.append({"indice": i, "motivo": f"Duplicidade não resolvida ({veredito['tipo']}) - use 'ignorar' ou resolva antes de reenviar."})
            continue

        # SAVEPOINT por linha: uma linha com erro (ex.: colisão de matrícula numa corrida rara)
        # só desfaz ELA. `with db.begin_nested()` libera (mescla na transação de fora) se o
        # bloco terminar bem, e desfaz só até o savepoint se uma exceção estourar dentro -
        # sem isso, um erro numa linha reverteria as linhas já criadas nesta mesma chamada.
        try:
            with db.begin_nested():
                novo = Associado(
                    nome_completo=linha.nome_completo, cpf=linha.cpf, email_contato=linha.email_contato,
                    telefone_whatsapp=linha.telefone_whatsapp, data_nascimento=data_nasc, categoria=linha.categoria,
                    numero_matricula=proximo_numero_matricula(db), id_lote_importacao=lote.id_lote,
                )
                db.add(novo)
                db.flush()
                db.add(Papel(id_pessoa=novo.id_pessoa, tipo_papel="associado"))
            criados += 1
        except Exception as e:
            erros.append({"indice": i, "motivo": str(e)})

    db.commit()
    registrar_auditoria(
        db, usuario, "lotes_importacao", "IMPORT", id_registro_afetado=lote.id_lote,
        dados_depois={"criados": criados, "ignorados": ignorados, "erros": len(erros)},
        ip_origem=request.client.host if request.client else None,
    )
    return {"id_lote": lote.id_lote, "criados": criados, "ignorados": ignorados, "erros": erros}


@router.post("/api/associados/importar-lote/{id_lote}/desfazer", summary="Desfazer uma importação em lote inteira")
def desfazer_lote(id_lote: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_associados)):
    lote = db.query(LoteImportacao).filter(LoteImportacao.id_lote == id_lote).first()
    if not lote:
        raise HTTPException(status_code=404, detail="Lote não encontrado.")
    if lote.desfeito:
        raise HTTPException(status_code=400, detail="Este lote já foi desfeito.")

    associados_do_lote = db.query(Associado).filter(Associado.id_lote_importacao == id_lote).all()
    ids = [a.id_associado for a in associados_do_lote]
    com_financeiro = (
        db.query(TituloFinanceiro.id_associado).filter(TituloFinanceiro.id_associado.in_(ids)).distinct().all()
        if ids else []
    )
    if com_financeiro:
        raise HTTPException(
            status_code=409,
            detail=f"{len(com_financeiro)} associado(s) deste lote já têm lançamento financeiro - desfazer bloqueado (dado financeiro nunca é apagado, só estornado).",
        )

    for associado in associados_do_lote:
        db.query(Endereco).filter(Endereco.id_associado == associado.id_associado).delete()
        db.query(DocumentoAnexo).filter(DocumentoAnexo.id_associado == associado.id_associado).delete()
        db.query(HistoricoCargo).filter(HistoricoCargo.id_associado == associado.id_associado).delete()
        db.query(DependenteFamiliar).filter(
            (DependenteFamiliar.id_pessoa_titular == associado.id_pessoa)
            | (DependenteFamiliar.id_pessoa_vinculada == associado.id_pessoa)
        ).delete()
        db.query(Papel).filter(Papel.id_pessoa == associado.id_pessoa).delete()
        id_pessoa = associado.id_pessoa
        db.delete(associado)
        db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa).delete()

    lote.desfeito = True
    lote.desfeito_em = datetime.utcnow()
    db.commit()

    registrar_auditoria(
        db, usuario, "lotes_importacao", "DESFEITO", id_registro_afetado=id_lote,
        dados_depois={"associados_removidos": len(ids)}, ip_origem=request.client.host if request.client else None,
    )
    return {"mensagem": f"Lote desfeito - {len(ids)} associado(s) removido(s)."}


@router.get("/api/associados/exportar", summary="Exportar dados pessoais de associados (permissão própria)")
def exportar_associados(colunas: str, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_exportar)):
    colunas_pedidas = [c.strip() for c in colunas.split(",") if c.strip()]
    desconhecidas = [c for c in colunas_pedidas if c not in _COLUNAS_EXPORTAVEIS]
    if desconhecidas:
        raise HTTPException(status_code=422, detail=f"Coluna(s) desconhecida(s): {', '.join(desconhecidas)}.")
    if not colunas_pedidas:
        raise HTTPException(status_code=422, detail="Informe ao menos uma coluna.")

    associados = db.query(Associado).all()
    linhas = [{c: _COLUNAS_EXPORTAVEIS[c](a) for c in colunas_pedidas} for a in associados]

    # v1.3 - exportação de base de associados é o maior vetor de vazamento numa associação;
    # nunca invisível. Audita quem, quantas linhas e quais campos - não o conteúdo em si (o
    # AuditLog não deveria virar um segundo vazamento do mesmo dado que está protegendo).
    registrar_auditoria(
        db, usuario, "associados", "EXPORT", dados_depois={"colunas": colunas_pedidas, "total_linhas": len(linhas)},
        ip_origem=request.client.host if request.client else None,
    )
    return {"colunas": colunas_pedidas, "linhas": linhas}
