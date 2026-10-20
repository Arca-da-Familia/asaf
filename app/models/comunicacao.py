"""v6.1 (FASE 6) - comunicação interna no painel: o AVISO (mural e caixa de entrada) e quem o recebeu.

O público de um aviso é uma REGRA (associados por situação/categoria, quem tem uma permissão, equipe/voluntários de um projeto), nunca uma lista colada: a regra fica guardada em
`publico` e, ao publicar, o sistema calcula o grupo e grava uma linha por pessoa em `avisos_destinatarios`. Essa lista é a PROVA de quem estava no grupo naquele momento; quem entra no
grupo depois só é acrescentado quando alguém com `comunicar` pede ("incluir quem entrou depois"), e ninguém é tirado.

Cada destinatário é um associado (`id_associado`), um usuário do painel (`id_usuario`) ou os dois. O associado sem acesso ao painel também recebe a linha (decisão do Presidente,
2026-10-20): o aviso aparece quando ele ganhar acesso, e o relatório de leitura diz que ele não foi avisado. O aviso publicado não se edita (a prova não muda por baixo): corrige-se
retirando, com motivo, e publicando outro.

Prazo de guarda (decisão de 2026-10-20, o prazo da lei): 5 anos depois de o aviso vencer (ou ser retirado), a rotina de retenção apaga as linhas de destinatário; o aviso fica com os
totais (`total_lidos`, `total_confirmados`) e a data em que a leitura foi apagada."""
from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint

from app.database import Base
from app.models.core import _TipoJson

# os três jeitos de dizer quem recebe (`publico["tipo"]`)
PUBLICO_ASSOCIADOS = "associados"
PUBLICO_PERMISSAO = "permissao"
PUBLICO_PROJETO = "projeto"
TIPOS_DE_PUBLICO = (PUBLICO_ASSOCIADOS, PUBLICO_PERMISSAO, PUBLICO_PROJETO)

# dentro de um projeto: a equipe (EquipeProjeto ativa) e/ou os voluntários associados (alocação pendente ou confirmada)
PROJETO_EQUIPE = "equipe"
PROJETO_VOLUNTARIOS = "voluntarios"
PARTES_DO_PROJETO = (PROJETO_EQUIPE, PROJETO_VOLUNTARIOS)


class Aviso(Base):
    __tablename__ = "avisos"
    id_aviso = Column(Integer, primary_key=True, index=True)
    titulo = Column(String(150), nullable=False)
    texto = Column(Text, nullable=False)  # só texto: a tela nunca o trata como HTML
    categoria = Column(String(40), nullable=False)  # código do catálogo `categoria_aviso`
    exige_confirmacao = Column(Boolean, nullable=False, default=False)
    valido_ate = Column(Date, nullable=False, index=True)  # último dia no mural (dia de Belém)
    publico = Column(_TipoJson, nullable=False)  # a regra do grupo, como foi escolhida
    publico_descricao = Column(String(400), nullable=False)  # a regra em português, para a tela e o relatório
    total_destinatarios = Column(Integer, nullable=False, default=0)
    id_usuario_autor = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=False)
    publicado_em = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    retirado_em = Column(DateTime, nullable=True)
    id_usuario_retirada = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    motivo_retirada = Column(String(500), nullable=True)
    # preenchidos pela rotina de retenção quando a lista de destinatários é apagada (os totais ficam)
    leitura_apagada_em = Column(DateTime, nullable=True)
    total_lidos = Column(Integer, nullable=True)
    total_confirmados = Column(Integer, nullable=True)


class AvisoDestinatario(Base):
    __tablename__ = "avisos_destinatarios"
    __table_args__ = (
        UniqueConstraint("id_aviso", "id_associado", name="uq_aviso_destinatario_associado"),
        UniqueConstraint("id_aviso", "id_usuario", name="uq_aviso_destinatario_usuario"),
    )
    id_destinatario = Column(Integer, primary_key=True, index=True)
    id_aviso = Column(Integer, ForeignKey("avisos.id_aviso"), nullable=False, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=True, index=True)
    id_usuario = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True, index=True)
    tinha_acesso = Column(Boolean, nullable=False, default=False)  # tinha usuário ativo no painel quando entrou no grupo
    incluido_em = Column(DateTime, nullable=False, default=datetime.utcnow)
    lido_em = Column(DateTime, nullable=True)
    confirmado_em = Column(DateTime, nullable=True)
