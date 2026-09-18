"""v4.2 (FASE 4) - Beneficiário como papel de Pessoa, vínculo N:N a Projeto, prontuário de
atendimento (dado sensível - visível só pra equipe do projeto) e encaminhamento à rede externa.
Frequência/participação usa o motor de presença (v4.0) direto, contexto "Projeto" - nenhum
mecanismo de presença próprio aqui."""
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.associados import Associado, DependenteFamiliar
from app.models.beneficiarios import Beneficiario, BeneficiarioProjeto, EncaminhamentoRedeExterna, RegistroAtendimento
from app.models.core import Usuario
from app.models.pessoas import Papel, Pessoa
from app.models.projetos import EquipeProjeto, ProjetoEvento
from app.services.catalogos import validar_codigo_em_catalogo

TIPO_PAPEL_BENEFICIARIO = "beneficiario"


def criar_beneficiario(
    db: Session, *, id_pessoa: Optional[int], nome_completo: Optional[str], data_nascimento: Optional[datetime],
    consentimento_lgpd_registrado: bool, observacao_consentimento: Optional[str], id_usuario: Optional[int],
) -> Beneficiario:
    if id_pessoa is not None:
        pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa).first()
        if not pessoa:
            raise HTTPException(status_code=404, detail="Pessoa não encontrada.")
    else:
        pessoa = Pessoa(nome_completo=nome_completo, data_nascimento=data_nascimento)
        db.add(pessoa)
        db.flush()

    if db.query(Beneficiario).filter(Beneficiario.id_pessoa == pessoa.id_pessoa).first():
        raise HTTPException(status_code=400, detail="Esta pessoa já é beneficiária.")

    beneficiario = Beneficiario(
        id_pessoa=pessoa.id_pessoa, consentimento_lgpd_registrado=consentimento_lgpd_registrado,
        observacao_consentimento=observacao_consentimento,
        data_consentimento=datetime.utcnow() if consentimento_lgpd_registrado else None,
        id_usuario_registro_consentimento=id_usuario if consentimento_lgpd_registrado else None,
        id_usuario_criacao=id_usuario,
    )
    db.add(beneficiario)
    if not db.query(Papel).filter(Papel.id_pessoa == pessoa.id_pessoa, Papel.tipo_papel == TIPO_PAPEL_BENEFICIARIO).first():
        db.add(Papel(id_pessoa=pessoa.id_pessoa, tipo_papel=TIPO_PAPEL_BENEFICIARIO))
    db.commit()
    db.refresh(beneficiario)
    return beneficiario


def listar_beneficiarios(db: Session) -> list[Beneficiario]:
    return db.query(Beneficiario).order_by(Beneficiario.criado_em.desc()).all()


def obter_beneficiario(db: Session, id_beneficiario: int) -> Beneficiario:
    beneficiario = db.query(Beneficiario).filter(Beneficiario.id_beneficiario == id_beneficiario).first()
    if not beneficiario:
        raise HTTPException(status_code=404, detail="Beneficiário não encontrado.")
    return beneficiario


def nucleo_familiar(db: Session, *, id_beneficiario: int) -> list[DependenteFamiliar]:
    beneficiario = db.query(Beneficiario).filter(Beneficiario.id_beneficiario == id_beneficiario).first()
    if not beneficiario:
        raise HTTPException(status_code=404, detail="Beneficiário não encontrado.")
    return db.query(DependenteFamiliar).filter(
        (DependenteFamiliar.id_pessoa_titular == beneficiario.id_pessoa) | (DependenteFamiliar.id_pessoa_vinculada == beneficiario.id_pessoa)
    ).all()


# ==========================================
# VÍNCULO BENEFICIÁRIO x PROJETO
# ==========================================
def vincular_a_projeto(
    db: Session, *, id_beneficiario: int, id_projeto: int, papel: str, atendimento_por_familia: bool, id_usuario: Optional[int],
) -> BeneficiarioProjeto:
    if not db.query(Beneficiario).filter(Beneficiario.id_beneficiario == id_beneficiario).first():
        raise HTTPException(status_code=404, detail="Beneficiário não encontrado.")
    if not db.query(ProjetoEvento).filter(ProjetoEvento.id_projeto == id_projeto).first():
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    validar_codigo_em_catalogo(db, "papel_beneficiario_projeto", papel, "Papel do beneficiário no projeto")
    if db.query(BeneficiarioProjeto).filter(BeneficiarioProjeto.id_beneficiario == id_beneficiario, BeneficiarioProjeto.id_projeto == id_projeto).first():
        raise HTTPException(status_code=400, detail="Este beneficiário já está vinculado a este projeto.")

    vinculo = BeneficiarioProjeto(
        id_beneficiario=id_beneficiario, id_projeto=id_projeto, papel=papel,
        atendimento_por_familia=atendimento_por_familia, id_usuario_registro=id_usuario,
    )
    db.add(vinculo)
    db.commit()
    db.refresh(vinculo)
    return vinculo


def listar_vinculos_do_projeto(db: Session, *, id_projeto: int) -> list[BeneficiarioProjeto]:
    return db.query(BeneficiarioProjeto).filter(BeneficiarioProjeto.id_projeto == id_projeto).all()


def obter_vinculo(db: Session, id_vinculo: int) -> BeneficiarioProjeto:
    vinculo = db.query(BeneficiarioProjeto).filter(BeneficiarioProjeto.id_vinculo == id_vinculo).first()
    if not vinculo:
        raise HTTPException(status_code=404, detail="Vínculo beneficiário-projeto não encontrado.")
    return vinculo


# ==========================================
# CONTROLE DE VISIBILIDADE - "SÓ A EQUIPE DO PROJETO" (dado sensível)
# ==========================================
def exigir_membro_da_equipe_do_vinculo(db: Session, *, usuario: Usuario, id_vinculo: int) -> BeneficiarioProjeto:
    """Prontuário/encaminhamento (dado potencialmente sensível: saúde, vulnerabilidade social,
    menor de idade) só é visível pra quem está ATIVO na equipe DAQUELE projeto especificamente -
    nem `exigir_permissao("projetos")` sozinho, nem ser da diretoria, dá acesso por padrão. Errar
    pro lado de recusar é o certo aqui - liberar demais é o erro grave de LGPD que o plano avisa."""
    vinculo = obter_vinculo(db, id_vinculo)
    associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
    membro = (
        db.query(EquipeProjeto).filter(
            EquipeProjeto.id_projeto == vinculo.id_projeto, EquipeProjeto.id_associado == (associado.id_associado if associado else -1),
            EquipeProjeto.data_fim.is_(None),
        ).first()
        if associado
        else None
    )
    if not membro:
        raise HTTPException(status_code=403, detail="Só a equipe ativa deste projeto pode ver ou registrar o prontuário deste beneficiário.")
    return vinculo


# ==========================================
# PRONTUÁRIO DE ATENDIMENTO (imutável)
# ==========================================
def registrar_atendimento(db: Session, *, id_vinculo: int, relato: str, id_usuario: Optional[int]) -> RegistroAtendimento:
    registro = RegistroAtendimento(id_vinculo=id_vinculo, relato=relato, id_usuario_autor=id_usuario)
    db.add(registro)
    db.commit()
    db.refresh(registro)
    return registro


def listar_atendimentos(db: Session, *, id_vinculo: int) -> list[RegistroAtendimento]:
    return db.query(RegistroAtendimento).filter(RegistroAtendimento.id_vinculo == id_vinculo).order_by(RegistroAtendimento.data_atendimento.desc()).all()


# ==========================================
# ENCAMINHAMENTO À REDE EXTERNA
# ==========================================
def registrar_encaminhamento(db: Session, *, id_vinculo: int, tipo_rede: str, descricao: str, id_usuario: Optional[int]) -> EncaminhamentoRedeExterna:
    validar_codigo_em_catalogo(db, "tipo_rede_externa", tipo_rede, "Tipo de rede externa")
    encaminhamento = EncaminhamentoRedeExterna(id_vinculo=id_vinculo, tipo_rede=tipo_rede, descricao=descricao, id_usuario_registro=id_usuario)
    db.add(encaminhamento)
    db.commit()
    db.refresh(encaminhamento)
    return encaminhamento


def listar_encaminhamentos(db: Session, *, id_vinculo: int) -> list[EncaminhamentoRedeExterna]:
    return db.query(EncaminhamentoRedeExterna).filter(EncaminhamentoRedeExterna.id_vinculo == id_vinculo).order_by(EncaminhamentoRedeExterna.data_encaminhamento.desc()).all()
