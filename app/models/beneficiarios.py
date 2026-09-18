"""v4.2 (FASE 4) - Beneficiário como papel de `Pessoa` (v1.0), nunca um cadastro de pessoa por
tipo de projeto - mesmo padrão satélite de `Associado` (`app/models/associados.py`): tabela
própria com `id_pessoa`, mais uma linha em `Papel(tipo_papel="beneficiario")`. Núcleo familiar
reaproveita `DependenteFamiliar` (v1.7) direto - já é genérico entre duas `Pessoa`s desde aquela
versão, não precisa de nada novo aqui.

**Dado potencialmente sensível** (saúde, vulnerabilidade social, menor de idade): `RegistroAtendimento`
e `EncaminhamentoRedeExterna` ficam amarrados a `BeneficiarioProjeto` (o vínculo com UM projeto
específico), nunca ao beneficiário solto - é isso que permite "visível só para a equipe DAQUELE
projeto" (`app/services/beneficiarios.py::exigir_membro_da_equipe`), não a equipe de qualquer
projeto que o mesmo beneficiário participe. `Beneficiario.consentimento_lgpd_registrado` é um
placeholder honesto - FASE 7 (consentimento versionado de verdade, regra especial pra menor de
idade) ainda não existe; isto não finge ser esse motor."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint

from app.database import Base


class Beneficiario(Base):
    __tablename__ = "beneficiarios"
    id_beneficiario = Column(Integer, primary_key=True, index=True)
    id_pessoa = Column(Integer, ForeignKey("pessoas.id_pessoa"), nullable=False, unique=True, index=True)
    consentimento_lgpd_registrado = Column(Boolean, default=False, nullable=False)
    observacao_consentimento = Column(String, nullable=True)
    data_consentimento = Column(DateTime, nullable=True)
    id_usuario_registro_consentimento = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class BeneficiarioProjeto(Base):
    """O vínculo N:N Beneficiário-Projeto - fronteira real de visibilidade do prontuário (ver
    docstring do módulo). `atendimento_por_familia` marca que o atendimento é do NÚCLEO (consultar
    `DependenteFamiliar` do `id_pessoa` do beneficiário), não só do indivíduo."""
    __tablename__ = "beneficiarios_projeto"
    __table_args__ = (UniqueConstraint("id_beneficiario", "id_projeto", name="uq_beneficiario_projeto"),)
    id_vinculo = Column(Integer, primary_key=True, index=True)
    id_beneficiario = Column(Integer, ForeignKey("beneficiarios.id_beneficiario"), nullable=False, index=True)
    id_projeto = Column(Integer, ForeignKey("projetos_eventos.id_projeto"), nullable=False, index=True)
    papel = Column(String, nullable=False)  # catálogo `papel_beneficiario_projeto`
    atendimento_por_familia = Column(Boolean, default=False, nullable=False)
    data_inicio = Column(DateTime, default=datetime.utcnow)
    data_fim = Column(DateTime, nullable=True)
    id_usuario_registro = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)


class RegistroAtendimento(Base):
    """Prontuário de atendimento - datado e com autor, **imutável** depois de criado (mesma
    disciplina de lançamento contábil/log: correção é um registro novo que referencia o anterior,
    nunca edição/exclusão - aqui nem endpoint de edição existe, ainda mais sensível que
    financeiro)."""
    __tablename__ = "registros_atendimento"
    id_registro = Column(Integer, primary_key=True, index=True)
    id_vinculo = Column(Integer, ForeignKey("beneficiarios_projeto.id_vinculo"), nullable=False, index=True)
    data_atendimento = Column(DateTime, default=datetime.utcnow)
    relato = Column(Text, nullable=False)
    id_usuario_autor = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class EncaminhamentoRedeExterna(Base):
    __tablename__ = "encaminhamentos_rede_externa"
    id_encaminhamento = Column(Integer, primary_key=True, index=True)
    id_vinculo = Column(Integer, ForeignKey("beneficiarios_projeto.id_vinculo"), nullable=False, index=True)
    tipo_rede = Column(String, nullable=False)  # catálogo `tipo_rede_externa`
    descricao = Column(Text, nullable=False)
    data_encaminhamento = Column(DateTime, default=datetime.utcnow)
    id_usuario_registro = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
