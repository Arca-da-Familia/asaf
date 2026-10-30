"""v7.3a (FASE 7) - o CPF PROTEGIDO: escondido em toda lista e ficha, num formato só (`***.***.***-NN`), e o completo só por um clique em "Mostrar o CPF",
registrado na Auditoria.

Decisão do Presidente (2026-10-29): veem o completo, pela permissão `ver_cpf_completo`, o Presidente, os Secretários (cadastro e filiação) e os Tesoureiros (o
recibo de doação leva o CPF do doador); quem atende a solicitação do titular vê o CPF DAQUELE pedido enquanto ele está aberto (conferir a identidade) - é assim que
o 1º Vice-Presidente, que atende o pedido sobre os dados do próprio Presidente (decisão de 2026-10-28), vê aquele CPF e nenhum outro. Vice-Presidentes e
Conselho Fiscal veem sempre escondido. A busca por CPF continua no servidor (quem busca já sabe o número).

O CPF revelado nunca vai para a Auditoria: ela guarda quem viu, de onde e quando."""
from __future__ import annotations

import re
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.models.core import Usuario
from app.security import usuario_tem_permissao

PERMISSAO = "ver_cpf_completo"
ACAO = "CPF_REVELADO"


def mascarar(valor: Optional[str]) -> Optional[str]:
    """O formato único: `***.***.***-NN`. Um documento que não é CPF (o CNPJ de uma empresa doadora, que é público) volta como está; vazio volta None."""
    if not valor:
        return None
    digitos = re.sub(r"\D", "", valor)
    if len(digitos) != 11:
        return valor
    return f"***.***.***-{digitos[-2:]}"


def formatar(digitos: str) -> str:
    d = re.sub(r"\D", "", digitos)
    return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}" if len(d) == 11 else digitos


def _atendimento(db: Session, usuario: Usuario, id_registro: int) -> tuple[str, Optional[str]]:
    from app.models.atendimento import Atendimento

    a = db.get(Atendimento, id_registro)
    if a is None:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    pela_permissao = usuario_tem_permissao(db, usuario, PERMISSAO) and usuario_tem_permissao(db, usuario, "atendimento")
    if not pela_permissao and not pode_ver_o_do_pedido(a, usuario):
        raise HTTPException(status_code=403, detail="Só quem atende esta solicitação de titular, enquanto ela está aberta, vê o CPF completo dela.")
    return "atendimentos", a.cpf


def pode_ver_o_do_pedido(a, usuario: Usuario) -> bool:
    from app.models.atendimento import EM_ATENDIMENTO, NOVO, TITULAR_LGPD

    return a.tipo == TITULAR_LGPD and a.status in (NOVO, EM_ATENDIMENTO) and a.id_responsavel == usuario.id_usuario


def _simples(modelo_e_tabela):
    def achar(db: Session, usuario: Usuario, id_registro: int) -> tuple[str, Optional[str]]:
        modelo, tabela, campo, permissao_do_modulo = modelo_e_tabela()
        if not usuario_tem_permissao(db, usuario, PERMISSAO) or not usuario_tem_permissao(db, usuario, permissao_do_modulo):
            raise HTTPException(status_code=403, detail="Ver o CPF completo é só para o Presidente, os Secretários e os Tesoureiros.")
        registro = db.get(modelo, id_registro)
        if registro is None:
            raise HTTPException(status_code=404, detail="Registro não encontrado.")
        return tabela, getattr(registro, campo)
    return achar


def _associado():
    from app.models.associados import Associado
    return Associado, "associados", "cpf", "associados"


def _proposta():
    from app.models.filiacao import PropostaFiliacao
    return PropostaFiliacao, "propostas_filiacao", "cpf", "associados"


def _doacao():
    from app.models.doacoes import Doacao
    return Doacao, "doacoes", "documento_doador", "financeiro"


def _intencao():
    from app.models.intencoes_de_doacao import IntencaoDeDoacao
    return IntencaoDeDoacao, "intencoes_de_doacao", "documento_doador", "financeiro"


ORIGENS = {
    "associado": _simples(_associado),
    "proposta": _simples(_proposta),
    "doacao": _simples(_doacao),
    "intencao": _simples(_intencao),
    "atendimento": _atendimento,
}


def revelar(db: Session, usuario: Usuario, origem: str, id_registro: int, ip_origem: Optional[str]) -> str:
    if origem not in ORIGENS:
        raise HTTPException(status_code=422, detail="Origem desconhecida.")
    tabela, valor = ORIGENS[origem](db, usuario, id_registro)
    digitos = re.sub(r"\D", "", valor or "")
    if len(digitos) != 11:
        raise HTTPException(status_code=404, detail="Este registro não tem CPF.")
    registrar_auditoria(db, usuario, tabela, ACAO, id_registro_afetado=id_registro, dados_depois={"origem": origem}, ip_origem=ip_origem)
    return formatar(digitos)
