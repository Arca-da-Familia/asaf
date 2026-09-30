"""v4.8 (FASE 4) - portaria de evento: check-in/check-out sem login, por token de operação
escopado a um evento. Diferente da carteirinha digital (v1.1, JWT puro, uso pessoal, só expira
sozinha), o token de portaria fica exposto fisicamente por horas (QR impresso/projetado numa
mesa) e precisa poder ser revogado no meio do evento - por isso é persistido (`TokenPortaria`),
não um JWT puro (ver `app/security.py::criar_token_portaria`/`decodificar_token_portaria`, que
carregam só o id desta linha).

`OperacaoPortariaIdempotente` é o ledger de idempotência que permite a portaria funcionar offline
(fila local no navegador, sincronizada depois - ver `app/services/checkin.py`): cada ação
(check-in ou check-out) carrega uma chave gerada pelo cliente, nunca regenerada num reenvio - o
servidor só precisa checar se a chave já foi processada pra nunca duplicar um `RegistroPresenca`.
Tabela própria (não uma coluna única em `RegistroPresenca`) porque check-in e check-out da mesma
pessoa/contexto usam chaves independentes sobre a mesma linha de presença."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from app.database import Base


class TokenPortaria(Base):
    __tablename__ = "tokens_portaria"
    id_token_portaria = Column(Integer, primary_key=True, index=True)
    id_evento = Column(Integer, ForeignKey("eventos.id_evento"), nullable=False, index=True)
    descricao = Column(String, nullable=True)  # rótulo livre: "Portaria principal", "Catraca lateral"
    criado_em = Column(DateTime, default=datetime.utcnow)
    expira_em = Column(DateTime, nullable=False)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    revogado_em = Column(DateTime, nullable=True)
    id_usuario_revogacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)


class OperacaoPortariaIdempotente(Base):
    __tablename__ = "operacoes_portaria_idempotentes"
    id_operacao = Column(Integer, primary_key=True, index=True)
    chave_idempotencia = Column(String, nullable=False, unique=True, index=True)
    id_registro_presenca = Column(Integer, ForeignKey("registros_presenca.id_registro"), nullable=False)
    tipo = Column(String, nullable=False)  # "entrada" | "saida"
    criado_em = Column(DateTime, default=datetime.utcnow)
