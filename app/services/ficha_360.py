"""v1.5 (FASE 1) - monta a Ficha 360º de um associado: dados básicos, situação financeira
resumida, cargos exercidos e a linha do tempo unificada (EventoLinhaDoTempo). Usado tanto pelo
endpoint administrativo (`GET /api/associados/{id}/ficha-360`, permissão `associados`) quanto
pelo autoatendimento (`GET /auth/me/ficha-360`) - mesma montagem, permissão diferente em cada
rota, ver app/routers/situacao.py e app/routers/auth.py.

**Escopo real desta versão, não fingido**: "participação em projetos/eventos" (FASE 4),
"presença em assembleias" e "votos computados" (FASE 2), "protocolos abertos" (nenhuma fase
ainda define o que é um protocolo) e "comunicações enviadas e recebidas" (FASE 6) fazem parte do
que a v1.5 do plano descreve, mas nenhuma dessas fases existe ainda - não há dado real para
mostrar. Cada uma aparece na ficha sozinha, sem exigir nenhuma mudança aqui, no dia em que o
módulo correspondente existir e chamar `publicar_evento_linha_do_tempo` (é exatamente o que o
"módulo novo aparece na ficha sem alterar a tela" do plano quer dizer)."""
from sqlalchemy.orm import Session

from app.models.associados import Associado, DocumentoAnexo, HistoricoCargo
from app.models.financeiro import TituloFinanceiro
from app.models.linha_do_tempo import EventoLinhaDoTempo


def montar_ficha_360(db: Session, associado: Associado) -> dict:
    titulos_pendentes = (
        db.query(TituloFinanceiro)
        .filter(TituloFinanceiro.id_associado == associado.id_associado, TituloFinanceiro.status == "Pendente")
        .all()
    )
    saldo_devedor_total = sum(t.saldo_devedor for t in titulos_pendentes)

    cargos = (
        db.query(HistoricoCargo)
        .filter(HistoricoCargo.id_associado == associado.id_associado)
        .order_by(HistoricoCargo.data_posse.desc())
        .all()
    )

    documentos = (
        db.query(DocumentoAnexo)
        .filter(DocumentoAnexo.id_associado == associado.id_associado)
        .order_by(DocumentoAnexo.data_upload.desc())
        .all()
    )

    linha_do_tempo = (
        db.query(EventoLinhaDoTempo)
        .filter(EventoLinhaDoTempo.id_pessoa == associado.id_pessoa)
        .order_by(EventoLinhaDoTempo.data_evento.desc())
        .all()
    )

    return {
        "dados": {
            "id_associado": associado.id_associado,
            "nome_completo": associado.nome_completo,
            "numero_matricula": associado.numero_matricula,
            "categoria": associado.categoria,
            "status_arrolamento": associado.status_arrolamento,
            "data_admissao": associado.data_admissao,
        },
        "situacao_financeira": {
            "saldo_devedor_total": saldo_devedor_total,
            "quantidade_titulos_pendentes": len(titulos_pendentes),
        },
        "cargos": [
            {
                "id_historico": c.id_historico,
                "titulo_cargo": c.titulo_cargo,
                "data_posse": c.data_posse,
                "data_saida": c.data_saida,
                "atual": c.data_saida is None,
            }
            for c in cargos
        ],
        "documentos": [
            {"id_documento": d.id_documento, "tipo_documento": d.tipo_documento, "data_upload": d.data_upload}
            for d in documentos
        ],
        "linha_do_tempo": [
            {
                "id_evento": e.id_evento,
                "modulo_origem": e.modulo_origem,
                "tipo": e.tipo,
                "titulo": e.titulo,
                "descricao": e.descricao,
                "data_evento": e.data_evento,
            }
            for e in linha_do_tempo
        ],
    }
