"""v7.2c (FASE 7) - a ENTREGA do relatório dos dados ao titular pela Minha conta (LGPD, art. 18, II e V; art. 19, II e §3º).

Decisões do Presidente (2026-10-28): (2) PDF legível + arquivo para a portabilidade, pela Minha conta, válidos 15 dias (em mãos, o encarregado imprime);
(11) a portabilidade leva o que a pessoa forneceu + o que é dela no financeiro.

Como funciona: no pedido do titular, com a identidade validada, o encarregado (ou quem responde o pedido) confere o relatório (v7.2b) e o LIBERA. A liberação congela
o relatório no banco (`EntregaAoTitular.conteudo`): o que a pessoa baixa é exatamente o que foi conferido, nada anotado depois entra sem nova conferência. Por 15
dias, na Minha conta (sessão aberta com o código mandado ao e-mail do pedido), a pessoa baixa o PDF e o arquivo JSON; cada download fica na Auditoria. Vencido o
prazo, a limpeza da rotina de retenção apaga o conteúdo (ficam as datas). Nenhum arquivo é gravado no armazenamento: os dois são gerados da cópia congelada.

De quem é o relatório: da pessoa do cadastro ligada ao pedido; sem ligação, do CPF e do e-mail do pedido. O pedido feito por um dos pais ou pelo responsável
(v7.2a) precisa da ligação ao cadastro: o e-mail do pedido é de quem pediu, não do titular. Quando a identidade foi provada SÓ pelo código mandado ao e-mail (o
pedido aberto de dentro da Minha conta), o relatório traz só o que foi feito com aquele e-mail, nunca o cadastro ligado a ele: o e-mail do cadastro de quem não é
associado pode ter sido preenchido por outra pessoa (a deduplicação por CPF numa inscrição), e só o código não prova quem é o dono do cadastro (revisão da v7.2c).
Para entregar o cadastro, a identidade tem de vir do cadastro de associado (automática) ou ser conferida à mão."""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.atendimento import ENCERRADO, IDENTIDADE_CODIGO_NO_EMAIL, TITULAR_LGPD, Atendimento, EntregaAoTitular
from app.services import pdf_de_texto, relatorio_do_titular
from app.services.fuso import dia_e_hora_em_belem

VALIDADE_EM_DIAS = 15
FORMATOS = ("pdf", "json")
# os pedidos que se respondem com o relatório (art. 18, I, II, V e VII); corrigir, eliminar, revogar ou se opor não entregam os dados
SUBTIPOS_QUE_ENTREGAM = ("ACESSO", "PORTABILIDADE", "CONFIRMACAO", "COMPARTILHAMENTO")

# decisão 11: o que a pessoa FORNECEU sobre si (cadastro, contatos, formulários, pedidos, consentimentos dados) e o que é DELA no financeiro. O resto do relatório
# (o que a equipe registrou - prontuário, linha do tempo, presença, escala -, os atos de governança - votos, impugnações, petições - e os registros técnicos) fica
# no PDF, não no arquivo da portabilidade. O teste reprova a tabela do relatório que não estiver numa das duas listas: quem cria a tabela decide.
PORTAVEIS = frozenset({
    "pessoas", "associados", "enderecos", "dependentes_familiares", "beneficiarios", "valores_campo", "preferencias_de_comunicacao", "consentimentos",
    "documentos_anexos", "inscricoes", "respostas_pesquisa_satisfacao", "atendimentos", "propostas_filiacao", "termos_adesao_voluntario", "reservas_espaco",
    # o financeiro dela
    "doacoes", "intencoes_de_doacao", "titulos_financeiros", "creditos_associado", "negociacoes_divida", "isencoes_contribuicao", "isencoes_taxa_contexto",
    "reembolsos_despesa", "fornecedores", "dados_bancarios_fornecedor", "cotacoes_compra", "contas_a_pagar_recorrentes",
})
NAO_PORTAVEIS = frozenset({
    "usuarios",  # a conta de acesso ao painel (registro técnico)
    "beneficiarios_projeto", "registros_atendimento", "encaminhamentos_rede_externa", "eventos_linha_do_tempo", "registros_presenca", "documentos_emitidos",
    "alocacoes_voluntarios", "registros_horas_voluntariado", "trocas_turno_voluntario", "equipe_projeto", "funcionarios", "papeis", "fotos_da_diretoria",
    "historico_cargos", "mandatos", "mudancas_situacao", "processos_disciplinares", "manifestacoes_diretoria_disciplinar", "propostas_de_socios",
    "habilitados_assembleia", "credenciamentos_assembleia", "comprovantes_voto_secreto", "votos_abertos", "adesoes_peticao", "impugnacoes_votacao",
    "justificativas_falta_assembleia", "questionamentos_lancamento", "declaracoes_conflito_interesse", "delegacoes_aprovacao", "aprovacoes_compra",
    "solicitacoes_compra", "atos_do_encarregado", "avisos_destinatarios", "entregas_de_aviso",
})
# dentro de uma tabela portável, o que a EQUIPE escreveu (não foi fornecido pela pessoa)
COLUNAS_DA_EQUIPE = {
    "associados": {"observacoes_gerenciais"},
    "atendimentos": {"resposta", "motivo_encerramento", "identidade_nota", "identidade_validacao", "resultado", "fundamento"},
    "beneficiarios": {"observacao_consentimento"},
}


def _agora() -> datetime:
    return datetime.utcnow()


def quem_do_pedido(a: Atendimento) -> dict:
    """Os parâmetros de `relatorio_do_titular.montar` para a pessoa do pedido (os mesmos que o painel usa para mostrar o relatório a quem confere)."""
    if a.identidade_validacao == IDENTIDADE_CODIGO_NO_EMAIL:
        return {"email": a.email_contato}
    if a.id_pessoa is not None:
        return {"id_pessoa": a.id_pessoa}
    if a.por_representante:
        raise HTTPException(status_code=400, detail="O pedido foi feito por um dos pais ou pelo responsável e não está ligado ao cadastro do titular: o e-mail é "
                                                    "de quem pediu. Gere o relatório pelo cadastro da pessoa e entregue-o impresso.")
    return {"cpf": a.cpf, "email": a.email_contato}


def vigente(db: Session, a: Atendimento, agora: Optional[datetime] = None) -> Optional[EntregaAoTitular]:
    agora = agora or _agora()
    return (
        db.query(EntregaAoTitular)
        .filter(EntregaAoTitular.id_atendimento == a.id_atendimento, EntregaAoTitular.conteudo.isnot(None), EntregaAoTitular.valido_ate > agora)
        .order_by(EntregaAoTitular.id_entrega.desc())
        .first()
    )


def exigir_que_nao_seja_o_proprio(db: Session, usuario, a: Atendimento) -> None:
    """Ninguém entrega o relatório dos próprios dados (conflito de interesse), nem quando o pedido não está ligado ao cadastro: confere também o CPF e o e-mail."""
    from app.models.associados import Associado
    from app.models.pessoas import Pessoa

    proprio = db.query(Pessoa).join(Associado, Associado.id_pessoa == Pessoa.id_pessoa).filter(Associado.id_usuario == usuario.id_usuario).first()
    meus_emails = {e.strip().lower() for e in (getattr(usuario, "email", None), proprio.email_contato if proprio else None) if e}
    meu_cpf = relatorio_do_titular._so_digitos(proprio.cpf) if proprio else ""
    if ((proprio is not None and a.id_pessoa == proprio.id_pessoa) or (meu_cpf and relatorio_do_titular._so_digitos(a.cpf) == meu_cpf)
            or (a.email_contato or "").strip().lower() in meus_emails):
        raise HTTPException(status_code=403, detail="Este pedido é sobre os seus próprios dados: quem entrega o relatório é outra pessoa da equipe (conflito de interesse).")


def liberar(db: Session, a: Atendimento, impressao_conferida: str, agora: Optional[datetime] = None) -> tuple[EntregaAoTitular, dict]:
    """Congela o relatório da pessoa do pedido para ela baixar por 15 dias - só se ele é IGUAL ao que foi conferido (a impressão); senão 409. Liberar de novo
    substitui a anterior (que é apagada). Devolve (entrega, relatório)."""
    agora = agora or _agora()
    if a.tipo != TITULAR_LGPD:
        raise HTTPException(status_code=400, detail="Só a solicitação do titular de dados entrega o relatório.")
    if a.subtipo not in SUBTIPOS_QUE_ENTREGAM:
        raise HTTPException(status_code=400, detail="Este pedido não se responde com o relatório dos dados (só acesso, portabilidade, confirmação e compartilhamento).")
    if a.status == ENCERRADO:
        raise HTTPException(status_code=400, detail="O pedido está encerrado: para entregar o relatório, a pessoa faz um novo pedido.")
    if a.identidade_validada_em is None:
        raise HTTPException(status_code=400, detail="Valide antes a identidade de quem pediu: o relatório tem todos os dados da pessoa.")
    if not a.email_contato:
        raise HTTPException(status_code=400, detail="O pedido não tem e-mail: a pessoa não tem como entrar na Minha conta. Entregue o relatório impresso.")
    relatorio = relatorio_do_titular.montar(db, **quem_do_pedido(a))
    if relatorio["impressao"] != impressao_conferida:
        raise HTTPException(status_code=409, detail="O relatório mudou desde que você o conferiu (entrou ou saiu algum dado): confira de novo antes de liberar.")
    if not relatorio["secoes"]:
        raise HTTPException(status_code=400, detail="O sistema não guarda nenhum dado desta pessoa: responda isso no pedido (não há relatório a entregar).")
    for anterior in db.query(EntregaAoTitular).filter(EntregaAoTitular.id_atendimento == a.id_atendimento, EntregaAoTitular.conteudo.isnot(None)):
        anterior.conteudo, anterior.apagado_em = None, agora
    entrega = EntregaAoTitular(id_atendimento=a.id_atendimento, conteudo=json.dumps(relatorio, ensure_ascii=False), liberado_em=agora,
                               valido_ate=agora + timedelta(days=VALIDADE_EM_DIAS))
    db.add(entrega)
    db.commit()
    db.refresh(entrega)
    return entrega, relatorio


def apagar_da_pessoa(db: Session, id_pessoa: Optional[int], agora: Optional[datetime] = None) -> int:
    """A eliminação ou a anonimização da pessoa apaga também a cópia ainda vigente do relatório entregue (sem commit: quem chama grava junto)."""
    if id_pessoa is None:
        return 0
    ids = select(Atendimento.id_atendimento).where(Atendimento.id_pessoa == id_pessoa)
    return (
        db.query(EntregaAoTitular)
        .filter(EntregaAoTitular.id_atendimento.in_(ids), EntregaAoTitular.conteudo.isnot(None))
        .update({EntregaAoTitular.conteudo: None, EntregaAoTitular.apagado_em: agora or _agora()}, synchronize_session=False)
    )


def limpar_vencidas(db: Session, agora: Optional[datetime] = None) -> int:
    """Apaga o conteúdo das entregas vencidas (chamada pela rotina de retenção, a cada 15 minutos). Ficam as datas. Devolve quantas apagou."""
    agora = agora or _agora()
    total = (
        db.query(EntregaAoTitular)
        .filter(EntregaAoTitular.conteudo.isnot(None), EntregaAoTitular.valido_ate <= agora)
        .update({EntregaAoTitular.conteudo: None, EntregaAoTitular.apagado_em: agora}, synchronize_session=False)
    )
    db.commit()
    return total


# ------------------------------------------------------------------------------------------------ o que a pessoa baixa
_SO_DATA = re.compile(r"^\d{4}-\d{2}-\d{2}(T00:00:00(\.0+)?)?$")
_DATA_E_HORA = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}")


def _rotulo(coluna: str) -> str:
    """"data_nascimento" -> "Data nascimento" (o mesmo do painel)."""
    texto = re.sub(r"^id_", "", coluna).replace("_", " ")
    return texto[:1].upper() + texto[1:]


def _em_palavras(valor) -> str:
    if isinstance(valor, bool):
        return "Sim" if valor else "Não"
    try:
        if isinstance(valor, str) and _SO_DATA.match(valor):
            # data sem hora (o nascimento é guardado à meia-noite): o dia como está, sem converter o fuso
            return datetime.fromisoformat(valor[:10]).strftime("%d/%m/%Y")
        if isinstance(valor, str) and _DATA_E_HORA.match(valor):
            return dia_e_hora_em_belem(datetime.fromisoformat(valor))
    except ValueError:
        pass  # texto que só parece data ("2026-02-30", "2026-10-29T10:00 reunião"): vai como foi escrito
    return str(valor)


def pdf(entrega: EntregaAoTitular, a: Atendimento) -> bytes:
    r = json.loads(entrega.conteudo)
    nome = (r.get("pessoa") or {}).get("nome_completo") or a.nome_completo
    paragrafos = [
        "RELATÓRIO DOS SEUS DADOS PESSOAIS NA ASAF",
        f"Titular: {nome}.",
        f"Pedido: protocolo {a.protocolo}. Relatório conferido e liberado em {dia_e_hora_em_belem(entrega.liberado_em)}; disponível na Minha conta até "
        f"{dia_e_hora_em_belem(entrega.valido_ate)} (horário de Belém).",
        *([] if r.get("pessoa") else ["Este relatório traz o que foi feito com o e-mail do pedido. Se você tem cadastro na associação (associado, voluntário, "
                                      "atendido nos projetos), o encarregado entrega os dados do cadastro depois de conferir a sua identidade."]),
        "Este é tudo o que o sistema da associação guarda sobre você, parte por parte, com para que serve, a base legal, com quem é compartilhado e por quanto "
        "tempo é guardado (Lei Geral de Proteção de Dados, art. 18, I e II, e art. 19, II). Os dados que você nos forneceu e os seus no financeiro também estão "
        "no arquivo para levar a outro serviço (art. 18, V), baixado na mesma página.",
        r.get("fora_do_relatorio") or "",
        "",
    ]
    titulos = {0}
    for secao in r["secoes"]:
        atividades = secao["atividades"]
        titulos.add(len(paragrafos))
        paragrafos.append(f"{atividades[0]['nome'] if atividades else 'Outros registros'} ({secao['tabela']})")
        for at in atividades:
            base = "; ".join(at["bases_legais"]) + ("" if at["base_legal_conferida"] else " (proposta, ainda não conferida pelo encarregado)")
            paragrafos += [
                f"Para que serve: {at['finalidade']}",
                f"Base legal: {base}",
                f"Com quem é compartilhado: {'; '.join(at['compartilhado_com']) or '—'}{' (há transferência internacional)' if at['transferencia_internacional'] else ''}",
                f"Por quanto tempo: {'; '.join(at['prazos_de_guarda']) or 'sem prazo automático'}",
            ]
        if secao.get("cortado"):
            paragrafos.append("Há mais registros do que os mostrados aqui (os mais novos primeiro): peça a lista completa ao encarregado.")
        for linha in secao["linhas"]:
            campos = "; ".join(f"{_rotulo(c)}: {_em_palavras(v)}" for c, v in linha.items() if c != "numero")
            paragrafos.append(f"Registro nº {linha['numero']} — {campos}")
        paragrafos.append("")
    return pdf_de_texto.gerar(f"Seus dados na ASAF - {a.protocolo}", paragrafos, f"ASAF — relatório dos dados pessoais, protocolo {a.protocolo}. Documento pessoal: "
                              "guarde com cuidado.", titulos=frozenset(titulos), tamanho=9)


def arquivo_de_portabilidade(entrega: EntregaAoTitular, a: Atendimento) -> bytes:
    """JSON (formato aberto, legível por máquina): por tabela, as linhas com o nome das colunas; só o que é portável (decisão 11)."""
    r = json.loads(entrega.conteudo)
    dados = {}
    for secao in r["secoes"]:
        if secao["tabela"] not in PORTAVEIS:
            continue
        fora = COLUNAS_DA_EQUIPE.get(secao["tabela"], set())
        dados[secao["tabela"]] = [{c: v for c, v in linha.items() if c not in fora} for linha in secao["linhas"]]
    cortadas = [s["tabela"] for s in r["secoes"] if s["tabela"] in dados and s.get("cortado")]
    corpo = {
        "formato": "ASAF - dados pessoais para portabilidade (LGPD, art. 18, V), versão 1",
        "explicacao": "O que você forneceu à associação e o que é seu no financeiro, por assunto (o nome técnico da tabela) e registro. O relatório completo, "
                      "com para que serve cada dado, está no PDF.",
        "protocolo": a.protocolo,
        "liberado_em": entrega.liberado_em.isoformat() + "Z",
        "titular": (r.get("pessoa") or {}).get("nome_completo") or a.nome_completo,
        # uma tabela com mais de 500 registros vem com os mais novos: a lista completa é pedida ao encarregado
        "tabelas_com_registros_a_mais": cortadas,
        "dados": dados,
    }
    return json.dumps(corpo, ensure_ascii=False, indent=2).encode("utf-8")


def resumo_para_a_minha_conta(db: Session, a: Atendimento, agora: Optional[datetime] = None) -> Optional[str]:
    """Até quando a pessoa pode baixar (ISO, UTC), se há uma entrega vigente e a identidade foi validada; senão None."""
    if a.identidade_validada_em is None:
        return None
    entrega = vigente(db, a, agora)
    return entrega.valido_ate.isoformat() if entrega else None
