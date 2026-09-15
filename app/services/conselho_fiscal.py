"""v2.6 (FASE 2) - Conselho Fiscal: verificação de nível (é ou não o órgão) e se já existe
parecer emitido para um exercício, usado como trava antes da deliberação de aprovação de contas
(app/routers/ata.py)."""
from sqlalchemy.orm import Session

from app.models.conselho_fiscal import ParecerPrestacaoContas
from app.models.core import NivelAcesso, Usuario
from app.security import nivel_efetivo_id


def usuario_e_conselho_fiscal(db: Session, usuario: Usuario) -> bool:
    id_nivel = nivel_efetivo_id(usuario)
    if id_nivel is None:
        return False
    nivel = db.query(NivelAcesso).filter(NivelAcesso.id_nivel == id_nivel).first()
    return bool(nivel and nivel.is_conselho_fiscal)


def parecer_existe_para_ano(db: Session, ano_exercicio: int) -> bool:
    return db.query(ParecerPrestacaoContas).filter(ParecerPrestacaoContas.ano_exercicio == ano_exercicio).first() is not None
