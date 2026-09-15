"""v2.5 (FASE 2) - ata gerada do registro (nunca editor de texto livre), numeração sequencial do
livro de atas e de certidões (cada um seu próprio contador contínuo), e efeitos automáticos de
deliberação conforme o tipo."""
import json
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.ata import REFORMA_ESTATUTO, APROVACAO_CONTAS, Ata, CertidaoDeliberacao, Deliberacao
from app.models.governanca import Assembleia, HabilitadoAssembleia
from app.models.sessao_assembleia import Credenciamento, ItemPauta, OcorrenciaSessao
from app.models.votacao import ENCERRADA, Votacao
from app.auditoria import registrar_auditoria


def gerar_corpo_ata(db: Session, assembleia: Assembleia) -> str:
    """Monta o corpo da ata a partir do que a sessão de fato registrou - presença, pauta item a
    item (com resultado de votação quando houver), e ocorrências. `relato_secretaria` (campo
    separado em `Ata`) é o único espaço de texto livre - este corpo nunca é editável direto."""
    total_habilitados = db.query(HabilitadoAssembleia).filter(HabilitadoAssembleia.id_assembleia == assembleia.id_assembleia, HabilitadoAssembleia.habilitado.is_(True)).count()
    credenciamentos = db.query(Credenciamento).filter(Credenciamento.id_assembleia == assembleia.id_assembleia).all()
    itens = db.query(ItemPauta).filter(ItemPauta.id_assembleia == assembleia.id_assembleia).order_by(ItemPauta.ordem).all()
    ocorrencias = db.query(OcorrenciaSessao).filter(OcorrenciaSessao.id_assembleia == assembleia.id_assembleia).order_by(OcorrenciaSessao.criado_em).all()

    linhas = [
        f"ATA DE ASSEMBLEIA GERAL {assembleia.tipo.upper()}",
        f"Convocação: {assembleia.data_hora_convocacao:%d/%m/%Y às %H:%M}",
        "",
        "PRESENÇA",
        f"Associados habilitados: {total_habilitados}",
        f"Credenciados: {len(credenciamentos)}",
    ]
    for c in credenciamentos:
        associado = db.query(Associado).filter(Associado.id_associado == c.id_associado).first()
        nome = associado.nome_completo if associado else f"associado #{c.id_associado}"
        linhas.append(f"  - {nome} ({c.modalidade}) - entrada {c.hora_entrada:%H:%M}" + (f", saída {c.hora_saida:%H:%M}" if c.hora_saida else ""))

    linhas += ["", "ORDEM DO DIA", assembleia.pauta, "", "ITENS DA SESSÃO"]
    for item in itens:
        linhas.append(f"  {item.ordem}. {item.titulo} - {item.status}")
        if item.descricao:
            linhas.append(f"     {item.descricao}")
        votacoes = db.query(Votacao).filter(Votacao.id_item_pauta == item.id_item).all()
        for v in votacoes:
            if v.status == ENCERRADA:
                resultado = json.loads(v.resultado_contagem) if v.resultado_contagem else {}
                linhas.append(f"     Votação '{v.titulo}' ({v.tipo}): {resultado} - vencedor: {v.vencedor}, aprovado: {v.aprovado}, hash: {v.resultado_hash}")

    if ocorrencias:
        linhas += ["", "OCORRÊNCIAS"]
        for o in ocorrencias:
            linhas.append(f"  - {o.criado_em:%d/%m/%Y %H:%M}: {o.descricao}")

    return "\n".join(linhas)


def proximo_numero_ata(db: Session) -> int:
    ultimo = db.query(Ata).filter(Ata.numero_sequencial.isnot(None)).order_by(Ata.numero_sequencial.desc()).first()
    return (ultimo.numero_sequencial + 1) if ultimo else 1


def proximo_numero_certidao(db: Session) -> int:
    ultima = db.query(CertidaoDeliberacao).order_by(CertidaoDeliberacao.numero_sequencial.desc()).first()
    return (ultima.numero_sequencial + 1) if ultima else 1


def aplicar_efeitos_deliberacao(db: Session, deliberacao: Deliberacao, usuario) -> Optional[str]:
    """Efeitos automáticos ao concluir uma deliberação, conforme o tipo. Devolve uma nota de
    pendência quando o efeito depende de algo que ainda não existe no sistema (nunca finge um
    efeito que não pôde de fato acontecer)."""
    if deliberacao.tipo == REFORMA_ESTATUTO:
        registrar_auditoria(
            db, usuario, "deliberacoes", "PENDENCIA_REFORMA_ESTATUTO", id_registro_afetado=deliberacao.id_deliberacao,
            dados_depois={"nota": "Reforma de estatuto concluída - exige registro em cartório (v13.4) e nova versão de RegraEstatutaria (v2.0), ambos manuais: o sistema não sabe qual parâmetro mudou só pelo texto da deliberação."},
        )
        return "Pendência registrada: registro em cartório (v13.4) e nova RegraEstatutaria (v2.0) precisam ser lançados manualmente."
    if deliberacao.tipo == APROVACAO_CONTAS:
        registrar_auditoria(
            db, usuario, "deliberacoes", "PENDENCIA_FECHAMENTO_EXERCICIO", id_registro_afetado=deliberacao.id_deliberacao,
            dados_depois={"nota": "Aprovação de contas concluída - fechamento formal de Exercicio (FASE 3/v3.0) ainda não existe no sistema."},
        )
        return "Pendência registrada: fechamento de exercício depende da FASE 3/v3.0 (Exercicio), ainda não construída."
    return None
