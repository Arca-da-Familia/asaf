"""v1.5 (FASE 1) - EventoLinhaDoTempo: registro append-only, genérico, que qualquer módulo
publica quando algo relevante acontece com uma pessoa (filiação aprovada, licença, desligamento,
readmissão, anonimização, posse/saída de cargo, termo de voluntariado, horas de voluntariado). A
Ficha 360º (v1.5) lê só esta tabela para montar a linha do tempo - um módulo novo (projeto/
evento na FASE 4, assembleia na FASE 2, comunicação na FASE 6) passa a aparecer na ficha só
chamando `publicar_evento_linha_do_tempo`, sem precisar alterar o endpoint da ficha nem a tela.

Os dados estruturados de cada domínio (situação financeira, cargo atual, mudança de situação em
detalhe) continuam nas tabelas próprias (`TituloFinanceiro`, `HistoricoCargo`, `MudancaSituacao`)
- esta tabela é só a narrativa unificada, nunca a fonte de verdade de nenhum cálculo.

**Achado corrigido na v1.6**: nasceu com `id_associado` (só cobria quem já era Associado). A
v1.6 precisou publicar evento para voluntário/funcionário - papéis que uma `Pessoa` pode ter SEM
nunca ser Associado (é exatamente o que a v1.0 desenhou `Pessoa`/`Papel` para permitir). Corrigido
para `id_pessoa` antes que mais módulos passassem a depender da chave errada (migração
`a1b2c3d4e5f6`, com backfill via join em `associados`)."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from app.database import Base


class EventoLinhaDoTempo(Base):
    __tablename__ = "eventos_linha_do_tempo"
    id_evento = Column(Integer, primary_key=True, index=True)
    id_pessoa = Column(Integer, ForeignKey("pessoas.id_pessoa"), nullable=False, index=True)
    modulo_origem = Column(String(30), nullable=False)
    tipo = Column(String(50), nullable=False)
    titulo = Column(String, nullable=False)
    descricao = Column(String, nullable=True)
    data_evento = Column(DateTime, nullable=False, index=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
