"""v5.4h - Rastro de recusas: quando alguém TENTA aprovar, reprovar ou assinar e o sistema recusa (falta de cargo, segregação de funções, conflito de
interesse, título travado...), isso também fica na Auditoria — quem tentou, em que rota, o resultado e o motivo. Antes só o que dava certo deixava
rastro, e uma tentativa de aprovar a própria despesa passava em branco.

Um tratador de erro do servidor (ver `app/main.py`) chama `registrar_recusa` para as rotas de aprovação/assinatura listadas aqui, quando a resposta é
400, 403 ou 409. Nunca derruba a resposta: se não conseguir gravar, a recusa sai igual para quem tentou."""
import json
import logging
import re
from typing import Optional

from starlette.requests import Request

from app.database import SessaoLocal
from app.models.core import AuditLog
from app.security import decodificar_access_token_silencioso

ACAO = "RECUSA_APROVACAO"
TABELA = "recusas"
STATUS_DE_RECUSA = (400, 403, 409)

# As rotas em que alguém aprova, reprova, rejeita, assina, homologa ou confirma a decisão de outra pessoa.
_ROTAS_DE_APROVACAO = re.compile(
    r"^/api/(?:"
    r"atas/\d+/assinar"
    r"|documentos/\d+/aprovar"
    r"|filiacao/propostas/\d+/aprovar"
    r"|fornecedores/dados-bancarios/\d+/(?:aprovar|rejeitar)"
    r"|horas-voluntariado/\d+/(?:aprovar|recusar)"
    r"|parcerias/\d+/aprovar"
    r"|processos-disciplinares/\d+/homologar"
    r"|reembolsos-despesa/\d+/(?:aprovar|reprovar)"
    r"|reservas-espaco/\d+/aprovar"
    r"|solicitacoes-compra/\d+/(?:aprovar|reprovar)"
    r"|alocacoes/\d+/(?:confirmar|recusar)"
    r"|trocas-turno/\d+/(?:confirmar|recusar)"
    r"|conselho-fiscal/auditoria-financeira/(?:titulos/\d+/decisao|aprovar-em-lote)"
    r"|deliberacoes/\d+/concluir"
    r"|processos-dissolucao/\d+/deliberar"
    r")/?$"
)


def e_rota_de_aprovacao(metodo: str, caminho: str) -> bool:
    return metodo in ("POST", "PUT") and bool(_ROTAS_DE_APROVACAO.match(caminho))


def deve_registrar(metodo: str, caminho: str, status_code: int) -> bool:
    return status_code in STATUS_DE_RECUSA and e_rota_de_aprovacao(metodo, caminho)


def registrar_recusa(request: Request, status_code: int, detalhe) -> None:
    """Grava a recusa na Auditoria (tabela `recusas`, ação `RECUSA_APROVACAO`). Só vale para quem estava logado: sem token não há quem tenha tentado."""
    cabecalho = request.headers.get("authorization", "")
    if not cabecalho.lower().startswith("bearer "):
        return
    payload = decodificar_access_token_silencioso(cabecalho[7:])
    if not payload or not payload.get("id_usuario"):
        return
    motivo: Optional[str] = detalhe if isinstance(detalhe, str) else json.dumps(detalhe, default=str, ensure_ascii=False)
    db = SessaoLocal()
    try:
        db.add(AuditLog(
            id_usuario=payload["id_usuario"], tabela_afetada=TABELA, acao=ACAO, id_registro_afetado=None,
            dados_depois=json.dumps(
                {"rota": request.url.path, "metodo": request.method, "status": status_code, "motivo": motivo}, ensure_ascii=False,
            ),
            ip_origem=request.client.host if request.client else None,
        ))
        db.commit()
    except Exception:  # a recusa sai igual para quem tentou, mesmo que o registro falhe
        db.rollback()
        logging.getLogger("asaf").exception("Não consegui gravar a recusa de %s %s na Auditoria", request.method, request.url.path)
    finally:
        db.close()
