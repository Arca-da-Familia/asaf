"""v1.0 - FASE 1: `Pessoa` como raiz de identidade, `Papel` como N:N (uma pessoa pode ser
associada, voluntária, beneficiária, aluna etc. ao mesmo tempo, sem cadastro duplicado - ver
PLANO_PROJETO.md FASE 1/v1.0). `Associado` deixa de guardar dado pessoal duplicado: passa a ter
`id_pessoa` e expor os campos pessoais via `association_proxy` (proxy.py em app/models/
associados.py) - código existente que lê/escreve `associado.nome_completo` etc. continua
funcionando sem mudança, porque o dado agora mora só em `Pessoa`."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint

from app.database import Base


class Pessoa(Base):
    __tablename__ = "pessoas"
    id_pessoa = Column(Integer, primary_key=True, index=True)
    nome_completo = Column(String, index=True)
    # CPF não é obrigatório pra todo papel (criança beneficiária, participante externo de
    # evento) - por isso nullable aqui, ao contrário do antigo Associado.cpf. Único só entre
    # não-nulos (comportamento padrão de UNIQUE em Postgres/SQLite - duas linhas com CPF NULL
    # não colidem).
    cpf = Column(String, unique=True, index=True, nullable=True)
    data_nascimento = Column(DateTime, nullable=True)
    email_contato = Column(String, nullable=True)
    telefone_whatsapp = Column(String, nullable=True)
    estado_civil = Column(String(50), nullable=True)
    profissao = Column(String(100), nullable=True)
    naturalidade = Column(String(100), nullable=True)
    foto = Column(String, nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
    # v1.8 - qualidade permanente da base. `data_ultima_confirmacao`: quando a própria pessoa
    # confirmou/atualizou os dados pela última vez pelo painel (nulo = nunca confirmou) - dado
    # "confirmado há 8 anos" é dado duvidoso, isso é o que permite o sistema saber disso (ver
    # PRAZO_RECADASTRAMENTO_DIAS). `contato_suspeito`: marcado por
    # app/services/higienizacao_contato.py quando o telefone tem formato inválido ou um e-mail
    # é reportado como devolvido (bounce) - nunca calculado silenciosamente, sempre alimenta a
    # fila de revisão (`FilaRevisaoCadastro`).
    data_ultima_confirmacao = Column(DateTime, nullable=True)
    contato_suspeito = Column(Boolean, default=False)
    # v4.4 - habilidades cadastradas da pessoa (CSV de códigos do catálogo `habilidade_voluntario`,
    # mesmo padrão de `opcoes_validas` em app/models/votacao.py) - hoje só usado para comparar
    # com `AlocacaoVoluntario.habilidades_exigidas` na escala de voluntariado, mas fica em Pessoa
    # (não em TermoAdesaoVoluntario) porque é atributo da pessoa em si, não do termo/vigência.
    habilidades = Column(String, nullable=True)


class Papel(Base):
    """Marca que uma Pessoa exerce um papel no sistema (associado/voluntário/beneficiário/aluno/
    participante_externo/funcionário/fornecedor_pf). Atributos específicos de cada papel ficam
    na tabela satélite correspondente (ex.: `Associado` para o papel "associado") - Papel aqui é
    só o marcador N:N, não duplica dado."""
    __tablename__ = "papeis"
    __table_args__ = (UniqueConstraint("id_pessoa", "tipo_papel", name="uq_papel_pessoa_tipo"),)
    id_papel = Column(Integer, primary_key=True, index=True)
    id_pessoa = Column(Integer, ForeignKey("pessoas.id_pessoa"), nullable=False, index=True)
    tipo_papel = Column(String(30), nullable=False)
    ativo = Column(Boolean, default=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
