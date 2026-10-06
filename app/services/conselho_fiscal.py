"""v2.6 (FASE 2) - Conselho Fiscal: verificação de nível (é ou não o órgão) e se já existe
parecer emitido para um exercício, usado como trava antes da deliberação de aprovação de contas
(app/routers/ata.py)."""
from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.conselho_fiscal import ParecerPrestacaoContas
from app.models.core import NivelAcesso, Usuario
from app.security import nivel_efetivo_id
from app.services.mandatos import ORGAO_CONSELHO_FISCAL, mandatos_vigentes_do_associado


def usuario_e_conselho_fiscal(db: Session, usuario: Usuario) -> bool:
    """É do Conselho Fiscal quem tem um nível marcado como tal OU um mandato vigente no órgão Conselho Fiscal (Art. 24): o cargo em
    mandato já concede as permissões do cargo (`app.security.usuario_tem_permissao`), e o parecer e o questionamento são o dever do
    cargo. Achado ao vivo na v5.4d: só o nível contava, então nem os três conselheiros eleitos conseguiam emitir parecer, e a deliberação
    de "aprovação de contas" (que exige o parecer do ano) ficava impossível pela tela. Em "ver como" vale só o nível impersonado."""
    id_nivel = nivel_efetivo_id(usuario)
    if id_nivel is not None:
        nivel = db.query(NivelAcesso).filter(NivelAcesso.id_nivel == id_nivel).first()
        if nivel and nivel.is_conselho_fiscal:
            return True
    if getattr(usuario, "id_nivel_impersonado", None):
        return False
    associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
    if associado is None:
        return False
    return any(m.orgao_codigo == ORGAO_CONSELHO_FISCAL for m in mandatos_vigentes_do_associado(db, associado.id_associado))


def parecer_existe_para_ano(db: Session, ano_exercicio: int) -> bool:
    return db.query(ParecerPrestacaoContas).filter(ParecerPrestacaoContas.ano_exercicio == ano_exercicio).first() is not None
