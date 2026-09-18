"""v4.0 (FASE 4) - motores compartilhados: presença/check-in, inscrição, documento gerado,
indicadores e agenda/conflito. Gate de permissão único (`exigir_permissao("projetos")`) porque
FASE 4 é o primeiro consumidor real - quando outra fase (ex.: FASE 14, aula) também consumir,
a checagem de permissão de escrita passa a ser decidida por quem chama o motor, nunca solta."""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.schemas.motores import (
    CompromissoAgendaCriar,
    DocumentoEmitir,
    IndicadorCriar,
    InscricaoAlterarStatus,
    InscricaoCriar,
    InscricaoVincularCobranca,
    MedicaoIndicadorCriar,
    RegistrarEntradaCriar,
    TemplateDocumentoCriar,
    VerificarConflitoRequest,
)
from app.security import exigir_permissao
from app.services import agenda, documentos, indicadores, inscricao, presenca

router = APIRouter()
_permissao_projetos = exigir_permissao("projetos")


def _ip_origem(request: Request) -> str:
    return request.client.host if request.client else None


# ==========================================
# MOTOR DE PRESENÇA/CHECK-IN
# ==========================================
@router.post("/api/presencas/entrada", summary="Registrar entrada (motor de presença/check-in)")
def registrar_entrada_endpoint(dados: RegistrarEntradaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    registro = presenca.registrar_entrada(
        db, contexto_tipo=dados.contexto_tipo, id_contexto=dados.id_contexto, id_pessoa=dados.id_pessoa,
        meio_registro=dados.meio_registro, id_usuario_operador=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "registros_presenca", "CREATE", id_registro_afetado=registro.id_registro,
        dados_depois={"contexto_tipo": registro.contexto_tipo, "id_contexto": registro.id_contexto, "id_pessoa": registro.id_pessoa},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Entrada registrada.", "id_registro": registro.id_registro}


@router.post("/api/presencas/{id_registro}/saida", summary="Registrar saída (motor de presença/check-in)")
def registrar_saida_endpoint(id_registro: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    registro = presenca.registrar_saida(db, id_registro=id_registro, id_usuario_operador=usuario.id_usuario)
    registrar_auditoria(db, usuario, "registros_presenca", "SAIDA", id_registro_afetado=registro.id_registro, ip_origem=_ip_origem(request))
    return {"mensagem": "Saída registrada."}


@router.get("/api/presencas/", summary="Listar presenças de um contexto")
def listar_presencas_endpoint(contexto_tipo: str, id_contexto: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [
        {
            "id_registro": r.id_registro, "id_pessoa": r.id_pessoa, "hora_entrada": r.hora_entrada,
            "hora_saida": r.hora_saida, "meio_registro": r.meio_registro,
        }
        for r in presenca.listar_presencas(db, contexto_tipo=contexto_tipo, id_contexto=id_contexto)
    ]


# ==========================================
# MOTOR DE INSCRIÇÃO
# ==========================================
@router.post("/api/inscricoes/", summary="Inscrever pessoa em um contexto (motor de inscrição)")
def inscrever_endpoint(dados: InscricaoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    inscricao_criada = inscricao.inscrever(
        db, contexto_tipo=dados.contexto_tipo, id_contexto=dados.id_contexto, id_pessoa=dados.id_pessoa,
        respostas_formulario=dados.respostas_formulario, id_usuario_operador=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "inscricoes", "CREATE", id_registro_afetado=inscricao_criada.id_inscricao,
        dados_depois={"contexto_tipo": inscricao_criada.contexto_tipo, "id_contexto": inscricao_criada.id_contexto, "id_pessoa": inscricao_criada.id_pessoa},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Inscrição registrada.", "id_inscricao": inscricao_criada.id_inscricao, "status": inscricao_criada.status}


@router.put("/api/inscricoes/{id_inscricao}/status", summary="Alterar status de uma inscrição")
def alterar_status_inscricao_endpoint(id_inscricao: int, dados: InscricaoAlterarStatus, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    inscricao_atualizada = inscricao.alterar_status(db, id_inscricao=id_inscricao, novo_status=dados.status)
    registrar_auditoria(
        db, usuario, "inscricoes", "UPDATE", id_registro_afetado=inscricao_atualizada.id_inscricao,
        dados_depois={"status": inscricao_atualizada.status}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Status atualizado.", "status": inscricao_atualizada.status}


@router.put("/api/inscricoes/{id_inscricao}/cobranca", summary="Vincular inscrição a um título de cobrança")
def vincular_cobranca_endpoint(id_inscricao: int, dados: InscricaoVincularCobranca, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    inscricao_atualizada = inscricao.vincular_cobranca(db, id_inscricao=id_inscricao, id_titulo=dados.id_titulo)
    registrar_auditoria(
        db, usuario, "inscricoes", "VINCULAR_COBRANCA", id_registro_afetado=inscricao_atualizada.id_inscricao,
        dados_depois={"id_titulo_cobranca": inscricao_atualizada.id_titulo_cobranca}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Cobrança vinculada."}


@router.get("/api/inscricoes/", summary="Listar inscrições de um contexto")
def listar_inscricoes_endpoint(contexto_tipo: str, id_contexto: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [
        {
            "id_inscricao": i.id_inscricao, "id_pessoa": i.id_pessoa, "status": i.status,
            "id_titulo_cobranca": i.id_titulo_cobranca, "data_inscricao": i.data_inscricao,
        }
        for i in inscricao.listar_inscricoes(db, contexto_tipo=contexto_tipo, id_contexto=id_contexto)
    ]


# ==========================================
# MOTOR DE DOCUMENTO GERADO
# ==========================================
@router.post("/api/templates-documento/", summary="Cadastrar Template de Documento")
def criar_template_endpoint(dados: TemplateDocumentoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    template = documentos.criar_template(db, codigo=dados.codigo, nome=dados.nome, corpo_texto=dados.corpo_texto)
    registrar_auditoria(
        db, usuario, "templates_documento", "CREATE", id_registro_afetado=template.id_template,
        dados_depois={"codigo": template.codigo, "nome": template.nome}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Template cadastrado.", "id_template": template.id_template}


@router.get("/api/templates-documento/", summary="Listar Templates de Documento")
def listar_templates_endpoint(db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [
        {"id_template": t.id_template, "codigo": t.codigo, "nome": t.nome, "ativo": t.ativo}
        for t in documentos.listar_templates(db)
    ]


@router.post("/api/documentos-emitidos/", summary="Emitir documento a partir de um template (motor de documento gerado)")
def emitir_documento_endpoint(dados: DocumentoEmitir, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    documento = documentos.emitir_documento(
        db, codigo_template=dados.codigo_template, variaveis=dados.variaveis, contexto_tipo=dados.contexto_tipo,
        id_contexto=dados.id_contexto, id_pessoa=dados.id_pessoa, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "documentos_emitidos", "CREATE", id_registro_afetado=documento.id_documento,
        dados_depois={"numero_sequencial": documento.numero_sequencial, "id_template": documento.id_template},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Documento emitido.", "id_documento": documento.id_documento, "numero_sequencial": documento.numero_sequencial, "caminho_arquivo": documento.caminho_arquivo}


@router.get("/api/documentos-emitidos/", summary="Listar Documentos Emitidos")
def listar_documentos_emitidos_endpoint(
    contexto_tipo: str = None, id_contexto: int = None, id_pessoa: int = None,
    db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos),
):
    return [
        {
            "id_documento": d.id_documento, "id_template": d.id_template, "numero_sequencial": d.numero_sequencial,
            "contexto_tipo": d.contexto_tipo, "id_contexto": d.id_contexto, "id_pessoa": d.id_pessoa,
            "caminho_arquivo": d.caminho_arquivo, "emitida_em": d.emitida_em,
        }
        for d in documentos.listar_documentos_emitidos(db, contexto_tipo=contexto_tipo, id_contexto=id_contexto, id_pessoa=id_pessoa)
    ]


# ==========================================
# MOTOR DE INDICADORES
# ==========================================
@router.post("/api/indicadores/", summary="Cadastrar Indicador")
def criar_indicador_endpoint(dados: IndicadorCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    indicador = indicadores.criar_indicador(
        db, nome=dados.nome, unidade=dados.unidade, meta=dados.meta, periodicidade=dados.periodicidade,
        contexto_tipo=dados.contexto_tipo, id_contexto=dados.id_contexto,
    )
    registrar_auditoria(
        db, usuario, "indicadores", "CREATE", id_registro_afetado=indicador.id_indicador,
        dados_depois={"nome": indicador.nome, "unidade": indicador.unidade}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Indicador cadastrado.", "id_indicador": indicador.id_indicador}


@router.get("/api/indicadores/", summary="Listar Indicadores")
def listar_indicadores_endpoint(contexto_tipo: str = None, id_contexto: int = None, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [
        {
            "id_indicador": i.id_indicador, "nome": i.nome, "unidade": i.unidade, "meta": i.meta,
            "periodicidade": i.periodicidade, "contexto_tipo": i.contexto_tipo, "id_contexto": i.id_contexto,
        }
        for i in indicadores.listar_indicadores(db, contexto_tipo=contexto_tipo, id_contexto=id_contexto)
    ]


@router.post("/api/indicadores/{id_indicador}/medicoes", summary="Registrar Medição de Indicador")
def registrar_medicao_endpoint(id_indicador: int, dados: MedicaoIndicadorCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    medicao = indicadores.registrar_medicao(db, id_indicador=id_indicador, valor=dados.valor, periodo=dados.periodo, fonte=dados.fonte, id_usuario=usuario.id_usuario)
    registrar_auditoria(
        db, usuario, "medicoes_indicador", "CREATE", id_registro_afetado=medicao.id_medicao,
        dados_depois={"id_indicador": medicao.id_indicador, "periodo": medicao.periodo, "valor": str(medicao.valor)},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Medição registrada.", "id_medicao": medicao.id_medicao}


@router.get("/api/indicadores/{id_indicador}/medicoes", summary="Listar Medições de um Indicador")
def listar_medicoes_endpoint(id_indicador: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [
        {"id_medicao": m.id_medicao, "valor": m.valor, "periodo": m.periodo, "fonte": m.fonte, "medido_em": m.medido_em}
        for m in indicadores.listar_medicoes(db, id_indicador=id_indicador)
    ]


# ==========================================
# MOTOR DE AGENDA/CONFLITO
# ==========================================
@router.post("/api/agenda/verificar-conflito", summary="Verificar conflito de horário (motor de agenda) - só leitura, não reserva")
def verificar_conflito_endpoint(dados: VerificarConflitoRequest, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    conflitos = agenda.verificar_conflito(
        db, recurso_tipo=dados.recurso_tipo, id_recurso=dados.id_recurso, data_hora_inicio=dados.data_hora_inicio,
        data_hora_fim=dados.data_hora_fim, excluir_id_compromisso=dados.excluir_id_compromisso,
    )
    return {
        "tem_conflito": len(conflitos) > 0,
        "compromissos_conflitantes": [{"id_compromisso": c.id_compromisso, "contexto_tipo": c.contexto_tipo, "id_contexto": c.id_contexto} for c in conflitos],
    }


@router.post("/api/agenda/compromissos", summary="Criar Compromisso de Agenda (recusa se houver conflito)")
def criar_compromisso_endpoint(dados: CompromissoAgendaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    compromisso = agenda.criar_compromisso(
        db, recurso_tipo=dados.recurso_tipo, id_recurso=dados.id_recurso, contexto_tipo=dados.contexto_tipo,
        id_contexto=dados.id_contexto, data_hora_inicio=dados.data_hora_inicio, data_hora_fim=dados.data_hora_fim,
        id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "compromissos_agenda", "CREATE", id_registro_afetado=compromisso.id_compromisso,
        dados_depois={"recurso_tipo": compromisso.recurso_tipo, "id_recurso": compromisso.id_recurso},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Compromisso registrado.", "id_compromisso": compromisso.id_compromisso}


@router.get("/api/agenda/compromissos", summary="Listar Compromissos de um Recurso")
def listar_compromissos_endpoint(recurso_tipo: str, id_recurso: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    return [
        {
            "id_compromisso": c.id_compromisso, "contexto_tipo": c.contexto_tipo, "id_contexto": c.id_contexto,
            "data_hora_inicio": c.data_hora_inicio, "data_hora_fim": c.data_hora_fim,
        }
        for c in agenda.listar_compromissos(db, recurso_tipo=recurso_tipo, id_recurso=id_recurso)
    ]
