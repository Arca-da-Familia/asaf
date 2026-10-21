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

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, false

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

# v6.2a - a entrega do aviso por um canal além do painel (hoje o e-mail; o WhatsApp da v11.3 entra como outro canal)
CANAL_EMAIL = "email"
NA_FILA = "Na fila"
ENVIANDO = "Enviando"  # a rodada pegou esta entrega (só uma rodada pega cada uma: é o que impede o e-mail em dobro)
ENVIADO = "Enviado"  # saiu do servidor de e-mail da ASAF (a caixa de destino ainda pode devolver depois)
FALHOU = "Falhou"
SEM_EMAIL = "Sem e-mail no cadastro"
CANCELADO = "Cancelado"  # o aviso foi retirado antes de o e-mail sair
NAO_RECEBE = "Desligou por escolha"  # v6.2b: a pessoa desligou os avisos não obrigatórios por e-mail (cabe nos 30 da coluna `situacao`)
SITUACOES_DA_ENTREGA = (NA_FILA, ENVIANDO, ENVIADO, FALHOU, SEM_EMAIL, CANCELADO, NAO_RECEBE)


class Aviso(Base):
    __tablename__ = "avisos"
    id_aviso = Column(Integer, primary_key=True, index=True)
    titulo = Column(String(150), nullable=False)
    texto = Column(Text, nullable=False)  # só texto: a tela nunca o trata como HTML
    categoria = Column(String(40), nullable=False)  # código do catálogo `categoria_aviso`
    exige_confirmacao = Column(Boolean, nullable=False, default=False)
    por_email = Column(Boolean, nullable=False, default=False, server_default=false())  # v6.2a: também por e-mail (quem publica escolhe)
    id_modelo = Column(Integer, ForeignKey("modelos_de_aviso.id_modelo", name="fk_avisos_id_modelo"), nullable=True)  # v6.2c: a VERSÃO do modelo que o aviso usou (se usou)
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


class EntregaDeAviso(Base):
    """v6.2a - a entrega do aviso a UMA pessoa por UM canal além do painel (o e-mail). O endereço NÃO é guardado: é lido do cadastro na hora de enviar (se a pessoa trocar o e-mail
    antes de sair, vai para o novo). O motivo da falha é guardado sem o endereço. Apagada junto com a linha do destinatário pela rotina de retenção (o mesmo prazo da prova de leitura)."""
    __tablename__ = "entregas_de_aviso"
    __table_args__ = (UniqueConstraint("id_destinatario", "canal", name="uq_entrega_de_aviso_canal"),)
    id_entrega = Column(Integer, primary_key=True, index=True)
    id_destinatario = Column(Integer, ForeignKey("avisos_destinatarios.id_destinatario"), nullable=False, index=True)
    canal = Column(String(20), nullable=False)
    situacao = Column(String(30), nullable=False, index=True)
    tentativas = Column(Integer, nullable=False, default=0)
    proxima_tentativa_em = Column(DateTime, nullable=True)
    pego_em = Column(DateTime, nullable=True)  # quando a rodada pegou a entrega (Enviando): a que ficou presa (a rodada caiu no meio) é achada por aqui
    ultimo_erro = Column(String(300), nullable=True)
    criado_em = Column(DateTime, nullable=False, default=datetime.utcnow)
    enviado_em = Column(DateTime, nullable=True, index=True)


# v6.2c - situação de um aviso agendado
AGENDADO = "Agendado"
PUBLICADO = "Publicado"
AGENDAMENTO_CANCELADO = "Cancelado"


class ModeloDeAviso(Base):
    """v6.2c - um texto pronto para avisos (ex.: "Convocação de assembleia"). VERSIONADO: editar cria uma linha nova com `versao` + 1 no mesmo `grupo` e desativa a anterior; a
    anterior fica (o aviso que a usou aponta para ela). O texto aceita as variáveis {primeiro_nome} e {nome}; o título não."""
    __tablename__ = "modelos_de_aviso"
    __table_args__ = (UniqueConstraint("grupo", "versao", name="uq_modelo_de_aviso_versao"),)  # duas edições ao mesmo tempo não criam duas "versão N+1"
    id_modelo = Column(Integer, primary_key=True, index=True)
    grupo = Column(String(36), nullable=False, index=True)  # o mesmo para todas as versões de um modelo
    versao = Column(Integer, nullable=False)
    nome = Column(String(100), nullable=False)
    titulo = Column(String(150), nullable=False)
    texto = Column(Text, nullable=False)
    categoria = Column(String(40), nullable=False)
    exige_confirmacao = Column(Boolean, nullable=False, default=False)
    por_email = Column(Boolean, nullable=False, default=False)
    ativo = Column(Boolean, nullable=False, default=True)  # só a versão mais nova de um modelo em uso fica ativa
    id_usuario_autor = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=False)
    criado_em = Column(DateTime, nullable=False, default=datetime.utcnow)


class AvisoAgendado(Base):
    """v6.2c - um aviso para publicar DEPOIS (data e hora escolhidas por quem publica). Guarda o que vai ser publicado; a tarefa periódica publica na hora (o grupo é calculado de
    novo naquele momento, pela mesma regra) e grava aqui o aviso que nasceu. Quem tem `comunicar` pode cancelar antes. O autor precisa continuar com `comunicar` na hora de
    publicar; se não tiver, o agendamento é cancelado com o motivo."""
    __tablename__ = "avisos_agendados"
    id_agendado = Column(Integer, primary_key=True, index=True)
    publicar_em = Column(DateTime, nullable=False, index=True)  # UTC
    situacao = Column(String(20), nullable=False, index=True)
    titulo = Column(String(150), nullable=False)
    texto = Column(Text, nullable=False)
    categoria = Column(String(40), nullable=False)
    valido_ate = Column(Date, nullable=False)
    exige_confirmacao = Column(Boolean, nullable=False, default=False)
    por_email = Column(Boolean, nullable=False, default=False)
    publico = Column(_TipoJson, nullable=False)
    publico_descricao = Column(String(400), nullable=False)
    total_conferido = Column(Integer, nullable=False)  # quantas pessoas a conferência mostrou ao agendar
    id_modelo = Column(Integer, ForeignKey("modelos_de_aviso.id_modelo"), nullable=True)
    id_usuario_autor = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=False)
    criado_em = Column(DateTime, nullable=False, default=datetime.utcnow)
    id_aviso = Column(Integer, ForeignKey("avisos.id_aviso"), nullable=True)  # o aviso que nasceu da publicação
    motivo = Column(String(500), nullable=True)  # por que foi cancelado
    id_usuario_cancelamento = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
