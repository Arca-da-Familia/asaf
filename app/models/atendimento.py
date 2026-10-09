"""v5.5a (FASE 5) - a fila única de atendimento: tudo que uma pessoa de fora manda pelo site (contato, pedido de informação sobre recursos públicos, solicitação
de titular de dados da LGPD, e, na v5.5b, a oferta de voluntariado) cai numa tabela só, com protocolo, situação, responsável e PRAZO. Formulário que vira e-mail
solto é o jeito conhecido de perder gente interessada e de descumprir prazo legal; aqui cada pedido tem número, dono e data limite, e quem responde fica registrado.

O responsável por padrão é o Presidente (decisão de 2026-10-09: a associação não tem segunda pessoa para o papel); quem tem a permissão `atendimento` enxerga a
fila inteira e é avisado no sino quando chega pedido novo."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text

from app.database import Base

# o que a pessoa quer (o código é estável; o rótulo para a tela está em app/services/atendimento.py)
CONTATO = "CONTATO"
PEDIDO_INFORMACAO = "PEDIDO_INFORMACAO"
TITULAR_LGPD = "TITULAR_LGPD"
VOLUNTARIO = "VOLUNTARIO"
TIPOS = (CONTATO, PEDIDO_INFORMACAO, TITULAR_LGPD, VOLUNTARIO)

NOVO = "Novo"
EM_ATENDIMENTO = "Em atendimento"
RESPONDIDO = "Respondido"
ENCERRADO = "Encerrado"
SITUACOES = (NOVO, EM_ATENDIMENTO, RESPONDIDO, ENCERRADO)


class Atendimento(Base):
    __tablename__ = "atendimentos"
    id_atendimento = Column(Integer, primary_key=True, index=True)
    # ASAF-2026-00012: o número que a pessoa recebe na confirmação e usa para falar do pedido
    protocolo = Column(String(24), nullable=False, unique=True, index=True)
    tipo = Column(String(24), nullable=False, index=True)
    # para a solicitação de titular, qual direito do art. 18 da LGPD (CONFIRMACAO, ACESSO, CORRECAO...)
    subtipo = Column(String(40), nullable=True)
    assunto = Column(String(150), nullable=True)
    mensagem = Column(Text, nullable=False)

    nome_completo = Column(String(150), nullable=False)
    email_contato = Column(String(150), nullable=True)
    telefone_whatsapp = Column(String(30), nullable=True)
    cpf = Column(String(11), nullable=True)
    # só no pedido de voluntariado: com a idade a secretaria sabe se o termo de adesão precisa da autorização de um responsável (menor de 18 anos)
    data_nascimento = Column(DateTime, nullable=True)
    # a pessoa do cadastro, quando o CPF (ou o e-mail) já é de alguém que o sistema conhece: a mesma deduplicação dos demais formulários
    id_pessoa = Column(Integer, ForeignKey("pessoas.id_pessoa"), nullable=True, index=True)
    # quem é o remetente para agrupar os pedidos dele: o CPF, senão o e-mail, senão o telefone
    chave_remetente = Column(String(150), nullable=True, index=True)
    # impressão digital do pedido (tipo + remetente + texto): o mesmo pedido mandado duas vezes (duplo clique) não vira dois protocolos
    impressao_do_pedido = Column(String(64), nullable=True, index=True)
    origem = Column(String(20), nullable=False, default="site")

    consentimento_lgpd_em = Column(DateTime, nullable=True)
    consentimento_lgpd_versao = Column(String(20), nullable=True)

    status = Column(String(20), nullable=False, default=NOVO, index=True)
    prazo_dias = Column(Integer, nullable=False)
    prazo_em = Column(DateTime, nullable=False, index=True)
    id_responsavel = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    assumido_em = Column(DateTime, nullable=True)

    resposta = Column(Text, nullable=True)
    respondido_em = Column(DateTime, nullable=True)
    id_usuario_resposta = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    # a resposta foi enviada por e-mail de verdade? (None = não havia e-mail ou não se tentou; False = tentou e falhou: a pessoa precisa ser avisada por outro meio)
    resposta_enviada_por_email = Column(Boolean, nullable=True)

    motivo_encerramento = Column(String(300), nullable=True)
    encerrado_em = Column(DateTime, nullable=True)
    id_usuario_encerramento = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)

    criado_em = Column(DateTime, default=datetime.utcnow, index=True)
    atualizado_em = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
