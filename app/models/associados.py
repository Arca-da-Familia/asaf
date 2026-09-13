from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.ext.associationproxy import association_proxy

from app.database import Base
from app.models.pessoas import Pessoa

class Associado(Base):
    """v1.0 (FASE 1) - dado pessoal (nome/CPF/contato/nascimento/etc.) mora em `Pessoa`, nunca
    duplicado aqui. Os `association_proxy` abaixo expõem esses campos como se fossem colunas
    locais (`associado.nome_completo`, `associado.cpf == "..."` em filtro) - todo o código
    existente que lia/escrevia esses nomes continua funcionando sem mudança. Cada proxy tem seu
    próprio `creator`: se `associado.pessoa` ainda não existir, atribuir QUALQUER um desses
    campos cria a `Pessoa` na hora (o primeiro a ser atribuído cria; os seguintes só completam o
    mesmo objeto) - por isso `Associado(nome_completo=..., cpf=..., ...)` continua funcionando
    igual a antes, sem precisar criar a `Pessoa` manualmente em todo call site."""
    __tablename__ = "associados"
    id_associado = Column(Integer, primary_key=True, index=True)
    id_pessoa = Column(Integer, ForeignKey("pessoas.id_pessoa"), nullable=False, index=True)
    pessoa = relationship("Pessoa")

    categoria = Column(String, default="Efetivo")
    status_arrolamento = Column(String, default="Ativo - Em Dia")
    observacoes_gerenciais = Column(String, nullable=True)
    data_admissao = Column(DateTime, default=datetime.utcnow)
    id_usuario = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    # v1.2 - matrícula é número sequencial voltado pro humano (carteirinha, ofício, ata), nunca
    # o PK interno - atribuída na efetivação (ficha master direta ou filiação aprovada).
    numero_matricula = Column(Integer, unique=True, nullable=True, index=True)
    # v1.2 - fim do período de experiência configurável (PRAZO_EXPERIENCIA_DIAS); nulo = sem
    # período de experiência. Ver app/services/categoria_associado.py.
    data_fim_experiencia = Column(DateTime, nullable=True)
    # v1.3 - marca de qual lote de importação em massa esta linha veio (nulo = criado por fora
    # de importação em lote) - permite desfazer o lote inteiro de uma vez.
    id_lote_importacao = Column(Integer, ForeignKey("lotes_importacao.id_lote"), nullable=True)

    nome_completo = association_proxy("pessoa", "nome_completo", creator=lambda v: Pessoa(nome_completo=v))
    cpf = association_proxy("pessoa", "cpf", creator=lambda v: Pessoa(cpf=v))
    email_contato = association_proxy("pessoa", "email_contato", creator=lambda v: Pessoa(email_contato=v))
    telefone_whatsapp = association_proxy("pessoa", "telefone_whatsapp", creator=lambda v: Pessoa(telefone_whatsapp=v))
    data_nascimento = association_proxy("pessoa", "data_nascimento", creator=lambda v: Pessoa(data_nascimento=v))
    estado_civil = association_proxy("pessoa", "estado_civil", creator=lambda v: Pessoa(estado_civil=v))
    profissao = association_proxy("pessoa", "profissao", creator=lambda v: Pessoa(profissao=v))
    naturalidade = association_proxy("pessoa", "naturalidade", creator=lambda v: Pessoa(naturalidade=v))
    foto = association_proxy("pessoa", "foto", creator=lambda v: Pessoa(foto=v))

class Endereco(Base):
    __tablename__ = "enderecos"
    id_endereco = Column(Integer, primary_key=True, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"))
    cep = Column(String)
    logradouro = Column(String)
    numero = Column(String)
    bairro = Column(String)
    cidade = Column(String)
    estado = Column(String)

class DependenteFamiliar(Base):
    """Vínculo de parentesco entre dois associados já cadastrados (o sistema não registra pessoas de fora)."""
    __tablename__ = "dependentes_familiares"
    __table_args__ = (UniqueConstraint("id_titular", "id_associado_vinculado", name="uq_familia_titular_vinculado"),)
    id_dependente = Column(Integer, primary_key=True, index=True)
    id_titular = Column(Integer, ForeignKey("associados.id_associado"))
    id_associado_vinculado = Column(Integer, ForeignKey("associados.id_associado"))
    grau_parentesco = Column(String(50))

class DocumentoAnexo(Base):
    __tablename__ = "documentos_anexos"
    id_documento = Column(Integer, primary_key=True, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"))
    tipo_documento = Column(String)
    caminho_arquivo = Column(String)
    data_upload = Column(DateTime, default=datetime.utcnow)

class HistoricoCargo(Base):
    __tablename__ = "historico_cargos"
    id_historico = Column(Integer, primary_key=True, index=True)
    id_associado = Column(Integer, ForeignKey("associados.id_associado"))
    titulo_cargo = Column(String)
    data_posse = Column(DateTime)
    data_saida = Column(DateTime, nullable=True)

