"""v9.5i - a credencial do associado (a carteirinha), com QR que vale sempre e mostra a situação de AGORA (decisão do Presidente, 14/11/2026).

- `GET /api/minha-credencial`: a do associado que está logado (Minha carteirinha). Nasce na primeira vez que é aberta.
- `POST /api/associados/{id}/credencial/emitir-outra`: quem perdeu o cartão (permissão de associados): a credencial que valia deixa de valer NA HORA e
  nasce outra com código novo; fica na Auditoria.
- `GET /api/publico/credencial/{codigo}` e `.../foto`: a página de quem lê o QR (portaria, outro associado, parceiro), SEM login. Só o mínimo para
  conferir a pessoa: foto, nome, matrícula, categoria e a situação de agora. Nunca CPF, endereço, telefone ou e-mail. Credencial que não vale
  (substituída, de quem saiu, código que não existe): nem nome nem foto, e o mesmo texto nos três casos."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.associados import Associado
from app.models.core import Usuario
from app.models.pessoas import Pessoa
from app.security import exigir_permissao, get_current_user
from app.services import armazenamento
from app.services import credencial as credenciais

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
        "situacao": associado.status_arrolamento,
        "associado_desde": associado.data_admissao.date().isoformat() if associado.data_admissao else None,
        "foto": pessoa.foto if pessoa and _arquivo_da_foto(pessoa) else None,
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
