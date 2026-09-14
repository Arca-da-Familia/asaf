"""v1.5 (FASE 1) - EventoLinhaDoTempo: registro append-only, genérico, que qualquer módulo
publica quando algo relevante acontece com um associado (filiação aprovada, licença,
desligamento, readmissão, anonimização, posse/saída de cargo). A Ficha 360º (v1.5) lê só esta
tabela para montar a linha do tempo - um módulo novo (projeto/evento na FASE 4, assembleia na
FASE 2, comunicação na FASE 6) passa a aparecer na ficha só chamando
`publicar_evento_linha_do_tempo`, sem precisar alterar o endpoint da ficha nem a tela.

Os dados estruturados de cada domínio (situação financeira, cargo atual, mudança de situação em
detalhe) continuam nas tabelas próprias (`TituloFinanceiro`, `HistoricoCargo`, `MudancaSituacao`)
- esta tabela é só a narrativa unificada, nunca a fonte de verdade de nenhum cálculo."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from app.database import Base


class EventoLinhaDoTempo(Base):
    __tablename__ = "eventos_linha_do_tempo"
    id_evento = Column(Integer, primary_key=True, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    modulo_origem = Column(String(30), nullable=False)
    tipo = Column(String(50), nullable=False)
    titulo = Column(String, nullable=False)
    descricao = Column(String, nullable=True)
    data_evento = Column(DateTime, nullable=False, index=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
