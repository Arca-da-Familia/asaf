"""v4.2 (FASE 4) - Beneficiários e atendimento. `exigir_permissao("projetos")` é o piso (mesmo
módulo de Projetos), mas o prontuário e o encaminhamento têm uma segunda trava por cima:
`exigir_membro_da_equipe_do_vinculo` - só quem está ativo na equipe DAQUELE projeto específico
lê ou escreve, nunca "quem tem permissão de projetos" de modo geral. Toda consulta ao prontuário
é auditada (`CONSULTA_PRONTUARIO`), não só a escrita - dado sensível pede rastro de quem LEU,
não só de quem mudou."""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.beneficiarios import Beneficiario
from app.models.pessoas import Pessoa
from app.schemas.beneficiarios import (
    BeneficiarioAtualizar,
    BeneficiarioCriar,
    BeneficiarioProjetoCriar,
    ConsentimentoDoBeneficiario,
    EliminarProntuario,
    EncaminhamentoRedeExternaCriar,
    RegistroAtendimentoCriar,
    RevogarConsentimento,
)
from app.security import exigir_permissao
from app.services import beneficiarios, consentimentos

router = APIRouter()
_permissao_projetos = exigir_permissao("projetos")
_permissao_exportar = exigir_permissao("exportar_beneficiarios")
_permissao_eliminar = exigir_permissao("privacidade_gerir")  # v7.1d: quem decide a eliminação é o encarregado


def _ip_origem(request: Request) -> str:
    return request.client.host if request.client else None


def _serializar_beneficiario(b, pessoa=None, consentimento=None) -> dict:
    """v7.1c: `consentimento` é o vigente (quem consentiu, o responsável e o vínculo, a versão, a data; pode ser só a marca antiga do cadastro);
    `consentimento_lgpd_registrado` diz se há o TERMO que abre o atendimento (a marca antiga não abre); `observacao_consentimento` é a anotação da marca antiga
    (só leitura)."""
    return {
        "id_beneficiario": b.id_beneficiario, "id_pessoa": b.id_pessoa,
        "nome_completo": pessoa.nome_completo if pessoa else None,
        "data_nascimento": pessoa.data_nascimento if pessoa else None,
        "consentimento_lgpd_registrado": consentimentos.vale_para_gravar(consentimento),
        "consentimento": consentimentos.para_o_painel(consentimento),
        "observacao_consentimento": b.observacao_consentimento,
    }


def _consentimentos_vigentes(db: Session, ids: list[int]) -> dict:
    from app.models.privacidade import Consentimento

    if not ids:
        return {}
    return {c.id_origem: c for c in db.query(Consentimento).filter(
        Consentimento.origem == consentimentos.BENEFICIARIO, Consentimento.id_origem.in_(set(ids)), Consentimento.encerrado_em.is_(None))}


def _mapear_pessoas(db: Session, ids_pessoa: list[int]) -> dict:
    if not ids_pessoa:
        return {}
    return {p.id_pessoa: p for p in db.query(Pessoa).filter(Pessoa.id_pessoa.in_(set(ids_pessoa))).all()}


@router.post("/api/beneficiarios/", summary="Cadastrar Beneficiário (papel de Pessoa)")
def criar_beneficiario_endpoint(dados: BeneficiarioCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    beneficiario = beneficiarios.criar_beneficiario(
        db, id_pessoa=dados.id_pessoa, nome_completo=dados.nome_completo, data_nascimento=dados.data_nascimento, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "beneficiarios", "CREATE", id_registro_afetado=beneficiario.id_beneficiario,
        dados_depois={"id_pessoa": beneficiario.id_pessoa}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Beneficiário cadastrado.", "id_beneficiario": beneficiario.id_beneficiario}


@router.get("/api/beneficiarios/", summary="Listar Beneficiários")
def listar_beneficiarios_endpoint(
    busca: str = None, id_projeto: int = None,
    db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos),
):
    lista = beneficiarios.listar_beneficiarios(db, busca=busca, id_projeto=id_projeto)
    pessoas = _mapear_pessoas(db, [b.id_pessoa for b in lista])
    vigentes = _consentimentos_vigentes(db, [b.id_beneficiario for b in lista])
    return [_serializar_beneficiario(b, pessoas.get(b.id_pessoa), vigentes.get(b.id_beneficiario)) for b in lista]


@router.put("/api/beneficiarios/{id_beneficiario}", summary="Editar Beneficiário (dados de Pessoa)")
def atualizar_beneficiario_endpoint(id_beneficiario: int, dados: BeneficiarioAtualizar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    beneficiario = beneficiarios.atualizar_beneficiario(
        db, id_beneficiario=id_beneficiario, nome_completo=dados.nome_completo, data_nascimento=dados.data_nascimento, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(db, usuario, "beneficiarios", "UPDATE", id_registro_afetado=beneficiario.id_beneficiario, ip_origem=_ip_origem(request))
    return {"mensagem": "Beneficiário atualizado."}


@router.post("/api/beneficiarios/{id_beneficiario}/consentimento", summary="Registrar o termo de consentimento do atendimento social assinado (substitui o vigente)")
def registrar_consentimento_endpoint(id_beneficiario: int, dados: ConsentimentoDoBeneficiario, request: Request, db: Session = Depends(get_db),
                                     usuario=Depends(_permissao_projetos)):
    c = beneficiarios.registrar_consentimento(
        db, usuario, id_beneficiario=id_beneficiario, dado_por=dados.dado_por, nome_responsavel=dados.nome_responsavel, vinculo=dados.vinculo, meio=dados.meio,
        id_documento=dados.id_documento, assinado_em=dados.assinado_em, versao_do_termo=dados.versao_do_termo,
    )
    registrar_auditoria(db, usuario, "consentimentos", "CONSENTIMENTO_REGISTRADO", id_registro_afetado=c.id_consentimento,
                        dados_depois={"id_beneficiario": id_beneficiario, "versao": c.versao, "dado_por": c.dado_por, "meio": c.meio}, ip_origem=_ip_origem(request))
    return consentimentos.para_o_painel(c)


@router.post("/api/beneficiarios/{id_beneficiario}/consentimento/revogar", summary="A pessoa (ou o responsável) retirou o consentimento: nada novo grava")
def revogar_consentimento_endpoint(id_beneficiario: int, dados: RevogarConsentimento, request: Request, db: Session = Depends(get_db),
                                   usuario=Depends(_permissao_projetos)):
    c = beneficiarios.revogar_consentimento(db, usuario, id_beneficiario=id_beneficiario, motivo=dados.motivo)
    registrar_auditoria(db, usuario, "consentimentos", "CONSENTIMENTO_REVOGADO", id_registro_afetado=c.id_consentimento,
                        dados_depois={"id_beneficiario": id_beneficiario}, ip_origem=_ip_origem(request))
    return consentimentos.para_o_painel(c)


@router.post("/api/beneficiarios/{id_beneficiario}/eliminar-prontuario",
             summary="v7.1d - eliminar o prontuário a pedido do titular (os relatos e as descrições; ficam datas e tipos para as contagens)")
def eliminar_prontuario_endpoint(id_beneficiario: int, dados: EliminarProntuario, request: Request, db: Session = Depends(get_db),
                                 usuario=Depends(_permissao_eliminar)):
    resultado = beneficiarios.eliminar_prontuario(db, usuario, id_beneficiario=id_beneficiario, protocolo=dados.protocolo)
    registrar_auditoria(db, usuario, "beneficiarios", "PRONTUARIO_ELIMINADO", id_registro_afetado=id_beneficiario, dados_depois=resultado,
                        ip_origem=_ip_origem(request))
    return {"mensagem": f"Prontuário eliminado: {resultado['relatos']} relato(s) e {resultado['encaminhamentos']} encaminhamento(s) apagados.", **resultado}


@router.get("/api/beneficiarios/exportar", summary="Exportar beneficiários (v4.10 - permissão própria, nunca casual)")
def exportar_beneficiarios_endpoint(
    request: Request, busca: str = None, id_projeto: int = None,
    db: Session = Depends(get_db), usuario=Depends(_permissao_exportar),
):
    lista = beneficiarios.listar_beneficiarios(db, busca=busca, id_projeto=id_projeto)
    pessoas = _mapear_pessoas(db, [b.id_pessoa for b in lista])
    vigentes = _consentimentos_vigentes(db, [b.id_beneficiario for b in lista])
    registrar_auditoria(
        db, usuario, "beneficiarios", "EXPORTAR", dados_depois={"quantidade": len(lista)}, ip_origem=_ip_origem(request),
    )
    return [_serializar_beneficiario(b, pessoas.get(b.id_pessoa), vigentes.get(b.id_beneficiario)) for b in lista]


@router.get("/api/beneficiarios/{id_beneficiario}/nucleo-familiar", summary="Núcleo familiar do beneficiário (reaproveita DependenteFamiliar, v1.7)")
def nucleo_familiar_endpoint(id_beneficiario: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    vinculos = beneficiarios.nucleo_familiar(db, id_beneficiario=id_beneficiario)
    pessoa_do_beneficiario = db.query(Beneficiario).filter(Beneficiario.id_beneficiario == id_beneficiario).first().id_pessoa
    ids = {d.id_pessoa_titular for d in vinculos} | {d.id_pessoa_vinculada for d in vinculos}
    nomes = {p.id_pessoa: p.nome_completo for p in db.query(Pessoa).filter(Pessoa.id_pessoa.in_(ids)).all()} if ids else {}
    # a tela precisa dos nomes e de saber de que lado da família o beneficiário está (titular ou dependente)
    return [
        {
            "id_dependente": d.id_dependente, "id_pessoa_titular": d.id_pessoa_titular, "id_pessoa_vinculada": d.id_pessoa_vinculada,
            "grau_parentesco": d.grau_parentesco, "nome_titular": nomes.get(d.id_pessoa_titular, "-"),
            "nome_vinculada": nomes.get(d.id_pessoa_vinculada, "-"),
            "beneficiario_e": "titular" if d.id_pessoa_titular == pessoa_do_beneficiario else "dependente",
        }
        for d in vinculos
    ]


# ==========================================
# VÍNCULO BENEFICIÁRIO x PROJETO
# ==========================================
@router.post("/api/beneficiarios-projeto/", summary="Vincular Beneficiário a um Projeto (com papel)")
def vincular_a_projeto_endpoint(dados: BeneficiarioProjetoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    vinculo = beneficiarios.vincular_a_projeto(
        db, id_beneficiario=dados.id_beneficiario, id_projeto=dados.id_projeto, papel=dados.papel,
        atendimento_por_familia=dados.atendimento_por_familia, id_usuario=usuario.id_usuario,
    )
    registrar_auditoria(
        db, usuario, "beneficiarios_projeto", "CREATE", id_registro_afetado=vinculo.id_vinculo,
        dados_depois={"id_beneficiario": vinculo.id_beneficiario, "id_projeto": vinculo.id_projeto, "papel": vinculo.papel},
        ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Beneficiário vinculado ao projeto.", "id_vinculo": vinculo.id_vinculo}


@router.get("/api/projetos/{id_projeto}/beneficiarios", summary="Listar beneficiários vinculados a um projeto")
def listar_vinculos_do_projeto_endpoint(id_projeto: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    vinculos = beneficiarios.listar_vinculos_do_projeto(db, id_projeto=id_projeto)
    vigentes = _consentimentos_vigentes(db, [v.id_beneficiario for v in vinculos])
    return [
        {
            "id_vinculo": v.id_vinculo, "id_beneficiario": v.id_beneficiario, "papel": v.papel,
            "atendimento_por_familia": v.atendimento_por_familia, "data_inicio": v.data_inicio, "data_fim": v.data_fim,
            # v7.1c: sem o consentimento vigente o prontuário e o encaminhamento não gravam (a tela avisa antes)
            "consentimento_vigente": consentimentos.vale_para_gravar(vigentes.get(v.id_beneficiario)),
        }
        for v in vinculos
    ]


# ==========================================
# PRONTUÁRIO DE ATENDIMENTO (dado sensível - só equipe do projeto, consulta auditada)
# ==========================================
@router.post("/api/beneficiarios-projeto/{id_vinculo}/atendimentos", summary="Registrar atendimento (prontuário - imutável)")
def registrar_atendimento_endpoint(id_vinculo: int, dados: RegistroAtendimentoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    beneficiarios.exigir_membro_da_equipe_do_vinculo(db, usuario=usuario, id_vinculo=id_vinculo)
    registro = beneficiarios.registrar_atendimento(db, id_vinculo=id_vinculo, relato=dados.relato, id_usuario=usuario.id_usuario)
    registrar_auditoria(
        db, usuario, "registros_atendimento", "CREATE", id_registro_afetado=registro.id_registro,
        dados_depois={"id_vinculo": registro.id_vinculo}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Atendimento registrado.", "id_registro": registro.id_registro}


@router.get("/api/beneficiarios-projeto/{id_vinculo}/atendimentos", summary="Listar prontuário de atendimento (consulta auditada)")
def listar_atendimentos_endpoint(id_vinculo: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    beneficiarios.exigir_membro_da_equipe_do_vinculo(db, usuario=usuario, id_vinculo=id_vinculo)
    registros = beneficiarios.listar_atendimentos(db, id_vinculo=id_vinculo)
    registrar_auditoria(
        db, usuario, "registros_atendimento", "CONSULTA_PRONTUARIO", id_registro_afetado=id_vinculo,
        dados_depois={"quantidade_resultados": len(registros)}, ip_origem=_ip_origem(request),
    )
    return [
        {"id_registro": r.id_registro, "data_atendimento": r.data_atendimento, "relato": r.relato, "id_usuario_autor": r.id_usuario_autor}
        for r in registros
    ]


# ==========================================
# ENCAMINHAMENTO À REDE EXTERNA
# ==========================================
@router.post("/api/beneficiarios-projeto/{id_vinculo}/encaminhamentos", summary="Registrar encaminhamento à rede externa")
def registrar_encaminhamento_endpoint(id_vinculo: int, dados: EncaminhamentoRedeExternaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    beneficiarios.exigir_membro_da_equipe_do_vinculo(db, usuario=usuario, id_vinculo=id_vinculo)
    encaminhamento = beneficiarios.registrar_encaminhamento(db, id_vinculo=id_vinculo, tipo_rede=dados.tipo_rede, descricao=dados.descricao, id_usuario=usuario.id_usuario)
    registrar_auditoria(
        db, usuario, "encaminhamentos_rede_externa", "CREATE", id_registro_afetado=encaminhamento.id_encaminhamento,
        dados_depois={"id_vinculo": encaminhamento.id_vinculo, "tipo_rede": encaminhamento.tipo_rede}, ip_origem=_ip_origem(request),
    )
    return {"mensagem": "Encaminhamento registrado.", "id_encaminhamento": encaminhamento.id_encaminhamento}


@router.get("/api/beneficiarios-projeto/{id_vinculo}/encaminhamentos", summary="Listar encaminhamentos à rede externa")
def listar_encaminhamentos_endpoint(id_vinculo: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_projetos)):
    beneficiarios.exigir_membro_da_equipe_do_vinculo(db, usuario=usuario, id_vinculo=id_vinculo)
    encaminhamentos = beneficiarios.listar_encaminhamentos(db, id_vinculo=id_vinculo)
    # v7.0b: o encaminhamento (posto de saúde, CRAS, Conselho Tutelar...) é dado SENSÍVEL e muitas vezes de criança: a LEITURA vai para a Auditoria, como a do
    # prontuário (achado da classificação: só a escrita era auditada)
    registrar_auditoria(
        db, usuario, "encaminhamentos_rede_externa", "CONSULTA_ENCAMINHAMENTOS", id_registro_afetado=id_vinculo,
        dados_depois={"quantidade_resultados": len(encaminhamentos)}, ip_origem=_ip_origem(request),
    )
    return [
        {"id_encaminhamento": e.id_encaminhamento, "tipo_rede": e.tipo_rede, "descricao": e.descricao, "data_encaminhamento": e.data_encaminhamento}
        for e in encaminhamentos
    ]


# ==========================================
# FREQUÊNCIA/PARTICIPAÇÃO (motor de presença único, v4.0 - sem mecanismo próprio aqui)
# ==========================================
@router.get("/api/beneficiarios-projeto/{id_vinculo}/presencas", summary="Frequência do beneficiário no projeto (via motor de presença, v4.0)")
def listar_presencas_do_vinculo_endpoint(id_vinculo: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_projetos)):
    from app.services.presenca import listar_presencas

    vinculo = beneficiarios.obter_vinculo(db, id_vinculo)
    beneficiario = beneficiarios.obter_beneficiario(db, vinculo.id_beneficiario)
    registros = listar_presencas(db, contexto_tipo="Projeto", id_contexto=vinculo.id_projeto)
    return [
        {"id_registro": r.id_registro, "hora_entrada": r.hora_entrada, "hora_saida": r.hora_saida, "meio_registro": r.meio_registro}
        for r in registros
        if r.id_pessoa == beneficiario.id_pessoa
    ]
