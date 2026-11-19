"""v9.5k - os MODELOS de credencial (o criador de credencial, rodada 6, escolha do Presidente: "uma página inicial... que já mostra os existentes...
alguns modelos" e depois o editor de "arrasta e edita... o que vai em cada lugar... no cabeçalho... tanto para digital como para física").

Um modelo é o DESENHO do cartão (85,6 x 54 mm): onde fica cada parte (faixa, logo, título, foto, nome, matrícula, categoria, "associado desde",
QR, texto livre), o tamanho, a cor. Não guarda dado de nenhuma pessoa: o nome, a foto e a matrícula entram na hora de mostrar ou imprimir. No máximo
UM modelo está em uso (o da folha A4 das credenciais emitidas, o da impressão da Minha carteirinha e as cores do cabeçalho dela no celular); os
outros ficam guardados e podem voltar. Sem nenhum em uso, vale o modelo pronto "Faixa no alto" (o cartão da v9.5j)."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String

from app.database import Base
from app.models.core import _TipoJson


class ModeloCredencial(Base):
    __tablename__ = "modelos_credencial"
    id_modelo = Column(Integer, primary_key=True, index=True)
    nome = Column(String(60), nullable=False)
    desenho = Column(_TipoJson, nullable=False)
    em_uso = Column(Boolean, nullable=False, default=False)
    usado_desde = Column(DateTime, nullable=True)
    criado_em = Column(DateTime, nullable=False, default=datetime.utcnow)
    id_usuario_criacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    atualizado_em = Column(DateTime, nullable=False, default=datetime.utcnow)
    id_usuario_atualizacao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
