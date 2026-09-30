"""v4.8 (FASE 4) - verificação pública de crachá/certificado de evento. Endpoint totalmente
público (sem autenticação), mesmo padrão de `GET /carteirinha/verificar/{token}`
(app/routers/associados.py): confirma autenticidade sem expor dado pessoal além do nome e da
atividade. Cuidado de ordenação de rota (mesmo achado já corrigido duas vezes em v4.5/v4.6):
`verificar` precisa continuar sendo o único segmento literal sob `/certificado/` - qualquer rota
literal futura nesse prefixo tem que vir antes de um `{algo}` parametrizado."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.motores import DocumentoEmitido, TemplateDocumento
from app.models.pessoas import Pessoa

router = APIRouter()


@router.get("/certificado/verificar/{codigo}", summary="Verificar crachá/certificado de evento (público)")
def verificar_certificado_endpoint(codigo: str, db: Session = Depends(get_db)):
    documento = db.query(DocumentoEmitido).filter(DocumentoEmitido.codigo_verificacao == codigo).first()
    if not documento:
        raise HTTPException(status_code=404, detail="Código de verificação não encontrado.")

    template = db.query(TemplateDocumento).filter(TemplateDocumento.id_template == documento.id_template).first()
    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == documento.id_pessoa).first() if documento.id_pessoa else None

    from app.services.eventos import obter_evento

    atividade = None
    if documento.contexto_tipo == "Evento" and documento.id_contexto:
        atividade = obter_evento(db, documento.id_contexto).titulo

    return {
        "nome_completo": pessoa.nome_completo if pessoa else None,
        "atividade": atividade,
        "tipo_documento": template.nome if template else None,
        "emitida_em": documento.emitida_em,
    }
