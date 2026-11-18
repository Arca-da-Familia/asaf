"""v9.5i - a CREDENCIAL do associado (a carteirinha), decisão do Presidente em 14/11/2026: o QR vale SEMPRE (o cartão impresso não pode vencer) e quem o lê
vê a situação de AGORA. Revoga a regra de 15/10 (o QR que vencia em 15 dias).

Cada credencial tem um código próprio, sorteado (128 bits: não dá para adivinhar nem percorrer), que é o que vai no QR. "Emitir outra" (quem perdeu o
cartão) marca a anterior como substituída na hora: o QR dela passa a mostrar "Esta credencial não vale". Cada associado tem no máximo UMA credencial
valendo (substituida_em vazio). O QR não leva CPF, endereço nem telefone; a página de quem lê mostra a foto, o nome, a matrícula, a categoria e a
situação de agora (desligado: nem foto nem nome)."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from app.database import Base

# por que a credencial deixou de valer (códigos fixos: nada de texto livre aqui)
PERDA_OU_TROCA = "emitida outra"
JUNCAO = "juncao de cadastros"
MOTIVOS = (PERDA_OU_TROCA, JUNCAO)


class Credencial(Base):
    __tablename__ = "credenciais"
    id_credencial = Column(Integer, primary_key=True, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"), nullable=False, index=True)
    codigo = Column(String(40), nullable=False, unique=True, index=True)
    emitida_em = Column(DateTime, nullable=False, default=datetime.utcnow)
    id_usuario_emissao = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    substituida_em = Column(DateTime, nullable=True)
    motivo_substituicao = Column(String(30), nullable=True)
