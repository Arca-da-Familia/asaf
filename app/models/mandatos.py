"""v2.1 (FASE 2) - Diretoria, Conselho Fiscal e mandatos: quem ocupa qual cargo, em qual órgão,
por quanto tempo. Órgão (catálogo `orgao_direcao`) e cargo (catálogo `titulo_cargo`, v0.3.1) são
sempre catálogo, nunca enum fixo no código - a ASAF pode criar um conselho novo sem deploy (ver
PLANO_PROJETO.md v2.1).

Vencimento do mandato é SEMPRE calculado na leitura (`Mandato.vigente`), nunca por job/cron que
pode falhar em silêncio - mesma decisão já tomada para período de experiência/licença do
associado (v1.2/v1.4). A concessão de permissão pelo cargo funciona pelo mesmo princípio:
`OpcaoCatalogo.metadados["permissoes"]` do cargo (v2.1, seed em `seed_catalogos`) é somada, em
tempo real, às permissões do nível de acesso por `app.security.usuario_tem_permissao` - nunca um
valor gravado que alguém precisa lembrar de atualizar."""
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String

from app.database import Base

RENUNCIA = "Renúncia"
DESTITUICAO = "Destituição"
IMPEDIMENTO_TEMPORARIO = "Impedimento temporário"
MOTIVOS_ENCERRAMENTO_ANTECIPADO = {RENUNCIA, DESTITUICAO, IMPEDIMENTO_TEMPORARIO}


class Mandato(Base):
    __tablename__ = "mandatos"
    id_mandato = Column(Integer, primary_key=True, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    orgao_codigo = Column(String(50), nullable=False, index=True)
    cargo_codigo = Column(String(50), nullable=False, index=True)
    data_inicio = Column(DateTime, nullable=False)
    data_fim_previsto = Column(DateTime, nullable=False)
    # Só preenchido em encerramento antecipado (vacância) - vencimento natural no
    # `data_fim_previsto` nunca grava nada, é calculado na leitura (ver `vigente`).
    data_fim_efetivo = Column(DateTime, nullable=True)
    motivo_encerramento = Column(String(50), nullable=True)
    # Assembleia/eleição de referência - texto livre até a `Assembleia` de verdade existir (v2.2).
    ato_origem = Column(String, nullable=True)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)

    def vigente(self, em: Optional[datetime] = None) -> bool:
        momento = em or datetime.utcnow()
        if self.data_fim_efetivo is not None and momento >= self.data_fim_efetivo:
            return False
        return self.data_inicio <= momento <= self.data_fim_previsto


class DeclaracaoConflitoInteresse(Base):
    """v2.1 - conflito de interesse declarado por um dirigente (parente em fornecedor, interesse
    em contrato).

    v3.3 - a pendência registrada aqui foi resolvida: consultada automaticamente pelo fluxo de
    aprovação de compras (`app/services/compras.py::_checar_conflito_interesse`), que bloqueia um
    aprovador (ou solicitante) com declaração ativa envolvendo o `id_fornecedor` em questão,
    exigindo outro aprovador. `id_fornecedor` é opcional (NULL) para declarações antigas/gerais
    feitas antes desta versão, tratadas como conflito com QUALQUER fornecedor (mais restritivo,
    nunca menos, na ausência de detalhe)."""
    __tablename__ = "declaracoes_conflito_interesse"
    id_declaracao = Column(Integer, primary_key=True, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    descricao = Column(String, nullable=False)
    ativa = Column(Boolean, default=True)
    id_fornecedor = Column(Integer, ForeignKey("fornecedores.id_fornecedor"), nullable=True)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
