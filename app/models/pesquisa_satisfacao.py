"""v4.10 (FASE 4) - pesquisa de satisfação pós-evento. Escopada só a `Evento` (FK explícita,
`id_evento`), não motor genérico `contexto_tipo`/`id_contexto` - só há um consumidor real agora
(mesmo raciocínio que manteve `TituloFinanceiro` com FK explícita em vez de polimórfico: motor
genérico se justifica quando um SEGUNDO consumidor real aparece, não por antecipação).

`id_inscricao` existe só pra (a) impedir convite duplicado pra quem já foi convidado e (b) saber
pra quem mandar o link - **nunca é exposto na agregação de resultado**
(`app/services/pesquisa_satisfacao.py::calcular_resultado`), que é onde "resposta anônima na
exibição" de fato se cumpre. `token` segue o mesmo padrão de `Inscricao.token_cancelamento`
(v4.6): opaco, único, gerado por `secrets.token_urlsafe`, nunca o id sequencial."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint

from app.database import Base


class RespostaPesquisaSatisfacao(Base):
    __tablename__ = "respostas_pesquisa_satisfacao"
    __table_args__ = (
        UniqueConstraint("id_evento", "id_inscricao", name="uq_pesquisa_satisfacao_evento_inscricao"),
    )
    id_resposta = Column(Integer, primary_key=True, index=True)
    id_evento = Column(Integer, ForeignKey("eventos.id_evento"), nullable=False, index=True)
    id_inscricao = Column(Integer, ForeignKey("inscricoes.id_inscricao"), nullable=False)
    token = Column(String, nullable=False, unique=True, index=True)
    nota = Column(Integer, nullable=True)  # 0-10, nulo até responder
    comentario = Column(Text, nullable=True)
    enviado_em = Column(DateTime, default=datetime.utcnow)
    respondido_em = Column(DateTime, nullable=True)
