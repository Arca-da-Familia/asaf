"""v1.6 (FASE 1) - pessoas além do associado: voluntário (Lei 9.608/1998) e funcionário CLT.
Distinção jurídica real, não só de rótulo: voluntário nunca gera vínculo empregatício; o
cadastro de `Funcionario` aqui é deliberadamente mínimo (identificação + centro de custo, para o
financeiro enxergar a despesa) - folha, ponto e eSocial ficam fora do escopo por decisão
registrada no plano, recomenda-se sistema de folha especializado se a associação vier a
precisar de fato.

Ambos os papéis (`voluntario`/`funcionario`) já existiam como valor válido de `Papel.tipo_papel`
desde a v1.0, sem tabela satélite - esta versão constrói a tabela satélite de cada um, seguindo
o mesmo padrão de `Associado` para o papel "associado"."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String

from app.database import Base


class TermoAdesaoVoluntario(Base):
    """Documento formal exigido pela Lei 9.608/1998 - sem ele, a pessoa não pode ser alocada
    como voluntária em nenhum projeto (ver app/routers/projetos.py::alocar_voluntario).
    Versionado: uma renovação cria uma linha NOVA (nunca edita a anterior), marcando a anterior
    `ativo=False` - histórico completo preservado, nunca sobrescrito.

    **Assinatura eletrônica pendente**: `documento_referencia` hoje é só uma referência de
    upload comum (mesmo estágio do termo de filiação da v1.2) - a verificação de assinatura
    real depende do motor da FASE 20/v20.2, que ainda não existe. Conectar aqui quando existir."""
    __tablename__ = "termos_adesao_voluntario"
    id_termo = Column(Integer, primary_key=True, index=True)
    id_pessoa = Column(Integer, ForeignKey("pessoas.id_pessoa"), nullable=False, index=True)
    atividade = Column(String, nullable=False)
    carga_horaria_semanal = Column(Float, nullable=False)
    local = Column(String, nullable=True)
    data_inicio = Column(DateTime, nullable=False)
    data_fim_vigencia = Column(DateTime, nullable=False)
    documento_referencia = Column(String, nullable=True)
    # Obrigatório só quando a pessoa é menor de idade na data_inicio - ver
    # app/services/voluntariado.py::criar_termo_adesao. Dado sensível (FASE 7): nunca exposto em
    # endpoint público, só em rota autenticada com permissão de gestão de associados.
    autorizacao_responsavel_referencia = Column(String, nullable=True)
    versao = Column(Integer, nullable=False, default=1)
    ativo = Column(Boolean, default=True)
    id_usuario_registrou = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class RegistroHorasVoluntariado(Base):
    """Lastro para o certificado de voluntariado (motor único da v4.8, quando existir - por ora
    só o registro em si, real e consultável). Sempre amarrado a um termo (nunca a uma pessoa
    solta) - não existe registro de hora sem termo de adesão por trás."""
    __tablename__ = "registros_horas_voluntariado"
    id_registro = Column(Integer, primary_key=True, index=True)
    id_termo = Column(Integer, ForeignKey("termos_adesao_voluntario.id_termo"), nullable=False, index=True)
    data = Column(DateTime, nullable=False)
    horas = Column(Float, nullable=False)
    descricao_atividade = Column(String, nullable=True)
    id_projeto = Column(Integer, ForeignKey("projetos_eventos.id_projeto"), nullable=True)
    id_usuario_registrou = Column(Integer, ForeignKey("usuarios.id_usuario"), nullable=True)
    criado_em = Column(DateTime, default=datetime.utcnow)


class Funcionario(Base):
    """Cadastro mínimo do papel 'funcionario' (v1.6) - só identificação e vínculo com centro de
    custo (`PlanoDeContas`), para o financeiro (FASE 3) enxergar a despesa em relatório. Folha
    de pagamento, ponto e eSocial são **decisão explícita de ficar fora** - integrar com sistema
    de folha especializado se/quando a associação precisar."""
    __tablename__ = "funcionarios"
    id_funcionario = Column(Integer, primary_key=True, index=True)
    id_pessoa = Column(Integer, ForeignKey("pessoas.id_pessoa"), nullable=False, unique=True, index=True)
    cargo = Column(String, nullable=False)
    id_conta_centro_custo = Column(Integer, ForeignKey("plano_de_contas.id_conta"), nullable=True)
    data_admissao = Column(DateTime, nullable=False)
    data_desligamento = Column(DateTime, nullable=True)
    ativo = Column(Boolean, default=True)
    criado_em = Column(DateTime, default=datetime.utcnow)
