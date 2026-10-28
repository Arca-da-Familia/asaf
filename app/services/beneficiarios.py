"""v4.2 (FASE 4) - Beneficiário como papel de Pessoa, vínculo N:N a Projeto, prontuário de
atendimento (dado sensível - visível só pra equipe do projeto) e encaminhamento à rede externa.
Frequência/participação usa o motor de presença (v4.0) direto, contexto "Projeto" - nenhum
mecanismo de presença próprio aqui."""
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.associados import Associado, DependenteFamiliar
from app.models.beneficiarios import Beneficiario, BeneficiarioProjeto, EncaminhamentoRedeExterna, RegistroAtendimento
from app.models.core import Usuario
from app.models.pessoas import Papel, Pessoa
from app.models.projetos import EquipeProjeto, ProjetoEvento
from app.services.catalogos import validar_codigo_em_catalogo

TIPO_PAPEL_BENEFICIARIO = "beneficiario"


def criar_beneficiario(
    db: Session, *, id_pessoa: Optional[int], nome_completo: Optional[str], data_nascimento: Optional[datetime], id_usuario: Optional[int],
) -> Beneficiario:
    """v7.1c: o consentimento não é mais uma marca no cadastro: é o termo assinado, registrado à parte (`registrar_consentimento`)."""
    if id_pessoa is not None:
        pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa).first()
        if not pessoa:
            raise HTTPException(status_code=404, detail="Pessoa não encontrada.")
    else:
        pessoa = Pessoa(nome_completo=nome_completo, data_nascimento=data_nascimento)
        db.add(pessoa)
        db.flush()

    if db.query(Beneficiario).filter(Beneficiario.id_pessoa == pessoa.id_pessoa).first():
        raise HTTPException(status_code=400, detail="Esta pessoa já é beneficiária.")

    beneficiario = Beneficiario(id_pessoa=pessoa.id_pessoa, id_usuario_criacao=id_usuario)
    db.add(beneficiario)
    if not db.query(Papel).filter(Papel.id_pessoa == pessoa.id_pessoa, Papel.tipo_papel == TIPO_PAPEL_BENEFICIARIO).first():
        db.add(Papel(id_pessoa=pessoa.id_pessoa, tipo_papel=TIPO_PAPEL_BENEFICIARIO))
    db.commit()
    db.refresh(beneficiario)
    return beneficiario


def listar_beneficiarios(
    db: Session, *,
    # v4.10 - tela cross-projeto nova (antes só dava pra ver beneficiário aninhado dentro de UM
    # projeto por vez, `Projetos.tsx::SecaoBeneficiarios`) - busca por nome (via `Pessoa`, que é
    # quem guarda o nome de verdade) e filtro por projeto (via o vínculo N:N).
    busca: Optional[str] = None, id_projeto: Optional[int] = None,
) -> list[Beneficiario]:
    query = db.query(Beneficiario)
    if id_projeto is not None:
        query = query.join(BeneficiarioProjeto, BeneficiarioProjeto.id_beneficiario == Beneficiario.id_beneficiario).filter(BeneficiarioProjeto.id_projeto == id_projeto)
    if busca:
        query = query.join(Pessoa, Pessoa.id_pessoa == Beneficiario.id_pessoa).filter(Pessoa.nome_completo.ilike(f"%{busca}%"))
    return query.order_by(Beneficiario.criado_em.desc()).all()


def atualizar_beneficiario(
    db: Session, *, id_beneficiario: int, nome_completo: Optional[str], data_nascimento: Optional[datetime], id_usuario: Optional[int],
) -> Beneficiario:
    beneficiario = obter_beneficiario(db, id_beneficiario)
    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == beneficiario.id_pessoa).first()
    if nome_completo is not None:
        pessoa.nome_completo = nome_completo
    if data_nascimento is not None:
        pessoa.data_nascimento = data_nascimento
        _conferir_consentimento_pelo_nascimento(db, beneficiario, pessoa, id_usuario)
    db.commit()
    db.refresh(beneficiario)
    return beneficiario


def _conferir_consentimento_pelo_nascimento(db: Session, beneficiario: Beneficiario, pessoa: Pessoa, id_usuario: Optional[int]) -> None:
    """v7.1c: o nascimento corrigido pode mostrar que quem consentiu sozinho era menor de idade na data da assinatura: esse consentimento deixa de valer
    (fica INVALIDADO, como prova) e o prontuário fecha até o termo do responsável ser registrado."""
    from types import SimpleNamespace

    from app.services import consentimentos

    c = consentimentos.vigente(db, consentimentos.BENEFICIARIO, beneficiario.id_beneficiario)
    if c is None or c.dado_por != consentimentos.TITULAR or not _menor_de_idade(pessoa, c.dado_em.date()):
        return
    consentimentos.encerrar(db, SimpleNamespace(id_usuario=id_usuario), origem=consentimentos.BENEFICIARIO, id_origem=beneficiario.id_beneficiario,
                            como=consentimentos.INVALIDADO, motivo="A data de nascimento corrigida mostra que tinha menos de 18 anos ao assinar: falta o termo "
                                                                   "de um dos pais ou do responsável.")


def obter_beneficiario(db: Session, id_beneficiario: int) -> Beneficiario:
    beneficiario = db.query(Beneficiario).filter(Beneficiario.id_beneficiario == id_beneficiario).first()
    if not beneficiario:
        raise HTTPException(status_code=404, detail="Beneficiário não encontrado.")
    return beneficiario


def nucleo_familiar(db: Session, *, id_beneficiario: int) -> list[DependenteFamiliar]:
    beneficiario = db.query(Beneficiario).filter(Beneficiario.id_beneficiario == id_beneficiario).first()
    if not beneficiario:
        raise HTTPException(status_code=404, detail="Beneficiário não encontrado.")
    return db.query(DependenteFamiliar).filter(
        (DependenteFamiliar.id_pessoa_titular == beneficiario.id_pessoa) | (DependenteFamiliar.id_pessoa_vinculada == beneficiario.id_pessoa)
    ).all()


# ==========================================
# VÍNCULO BENEFICIÁRIO x PROJETO
# ==========================================
def vincular_a_projeto(
    db: Session, *, id_beneficiario: int, id_projeto: int, papel: str, atendimento_por_familia: bool, id_usuario: Optional[int],
) -> BeneficiarioProjeto:
    if not db.query(Beneficiario).filter(Beneficiario.id_beneficiario == id_beneficiario).first():
        raise HTTPException(status_code=404, detail="Beneficiário não encontrado.")
    if not db.query(ProjetoEvento).filter(ProjetoEvento.id_projeto == id_projeto).first():
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    validar_codigo_em_catalogo(db, "papel_beneficiario_projeto", papel, "Papel do beneficiário no projeto")
    if db.query(BeneficiarioProjeto).filter(BeneficiarioProjeto.id_beneficiario == id_beneficiario, BeneficiarioProjeto.id_projeto == id_projeto).first():
        raise HTTPException(status_code=400, detail="Este beneficiário já está vinculado a este projeto.")

    vinculo = BeneficiarioProjeto(
        id_beneficiario=id_beneficiario, id_projeto=id_projeto, papel=papel,
        atendimento_por_familia=atendimento_por_familia, id_usuario_registro=id_usuario,
    )
    db.add(vinculo)
    db.commit()
    db.refresh(vinculo)
    return vinculo


def listar_vinculos_do_projeto(db: Session, *, id_projeto: int) -> list[BeneficiarioProjeto]:
    return db.query(BeneficiarioProjeto).filter(BeneficiarioProjeto.id_projeto == id_projeto).all()


def obter_vinculo(db: Session, id_vinculo: int) -> BeneficiarioProjeto:
    vinculo = db.query(BeneficiarioProjeto).filter(BeneficiarioProjeto.id_vinculo == id_vinculo).first()
    if not vinculo:
        raise HTTPException(status_code=404, detail="Vínculo beneficiário-projeto não encontrado.")
    return vinculo


# ==========================================
# CONTROLE DE VISIBILIDADE - "SÓ A EQUIPE DO PROJETO" (dado sensível)
# ==========================================
def exigir_membro_da_equipe_do_vinculo(db: Session, *, usuario: Usuario, id_vinculo: int) -> BeneficiarioProjeto:
    """Prontuário/encaminhamento (dado potencialmente sensível: saúde, vulnerabilidade social,
    menor de idade) só é visível pra quem está ATIVO na equipe DAQUELE projeto especificamente -
    nem `exigir_permissao("projetos")` sozinho, nem ser da diretoria, dá acesso por padrão. Errar
    pro lado de recusar é o certo aqui - liberar demais é o erro grave de LGPD que o plano avisa."""
    vinculo = obter_vinculo(db, id_vinculo)
    associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
    membro = (
        db.query(EquipeProjeto).filter(
            EquipeProjeto.id_projeto == vinculo.id_projeto, EquipeProjeto.id_associado == (associado.id_associado if associado else -1),
            EquipeProjeto.data_fim.is_(None),
        ).first()
        if associado
        else None
    )
    if not membro:
        raise HTTPException(status_code=403, detail="Só a equipe ativa deste projeto pode ver ou registrar o prontuário deste beneficiário.")
    return vinculo


# ==========================================
# PRONTUÁRIO DE ATENDIMENTO (imutável)
# ==========================================
def _exigir_relatorio_de_impacto(db: Session) -> None:
    """v7.0d: o prontuário e o encaminhamento são tratamento de ALTO RISCO (dado sensível de criança e de família): só gravam com o relatório de impacto
    aprovado (app/services/relatorio_de_impacto.py). A leitura do que já existe continua (auditada)."""
    from app.services import relatorio_de_impacto

    relatorio_de_impacto.exigir_aprovado(db, "ATENDIMENTO_SOCIAL")


def _exigir_consentimento(db: Session, id_vinculo: int) -> None:
    """v7.1c: o atendimento social é tratado com o CONSENTIMENTO da pessoa atendida (ou de um dos pais ou do responsável, se é criança ou adolescente): sem ele
    vigente, o prontuário e o encaminhamento não gravam (a leitura do que já existe continua, auditada)."""
    from app.services import consentimentos

    vinculo = obter_vinculo(db, id_vinculo)
    c = consentimentos.vigente(db, consentimentos.BENEFICIARIO, vinculo.id_beneficiario)
    if c is not None and not consentimentos.vale_para_gravar(c):
        raise HTTPException(status_code=409, detail="Há só a marca antiga do cadastro (de antes do termo): registre o termo de consentimento assinado na tela "
                                                    "Beneficiários antes de gravar o atendimento.")
    if c is None:
        raise HTTPException(status_code=409, detail="Sem o consentimento registrado da pessoa atendida (ou do responsável, se é criança ou adolescente): "
                                                    "registre o termo assinado na tela Beneficiários antes de gravar o atendimento.")


IDADE_ADULTA = 18


def _menor_de_idade(pessoa: Pessoa, no_dia) -> bool:
    """Tinha menos de 18 anos NO DIA (o da assinatura do termo). Sem a data de nascimento não se sabe: quem registra o termo tem de informá-la antes."""
    nascimento = pessoa.data_nascimento.date()
    idade = no_dia.year - nascimento.year - ((no_dia.month, no_dia.day) < (nascimento.month, nascimento.day))
    return idade < IDADE_ADULTA


def registrar_consentimento(
    db: Session, usuario, *, id_beneficiario: int, dado_por: str, nome_responsavel: Optional[str], vinculo: Optional[str], meio: str,
    id_documento: Optional[int], assinado_em: Optional[str], versao_do_termo: Optional[str],
):
    """v7.1c - registra o termo de consentimento do atendimento social assinado (o da pessoa atendida, ou o de um dos pais ou do responsável). Quem tem menos de 18
    anos NA DATA DA ASSINATURA só com um dos pais ou o responsável (LGPD, art. 14); o adulto consente por si (ou pelo responsável legal, se há curatela).
    Registrar de novo SUBSTITUI o vigente (o anterior fica encerrado, como prova)."""
    from app.services import consentimentos

    beneficiario = obter_beneficiario(db, id_beneficiario)
    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == beneficiario.id_pessoa).first()
    if pessoa.data_nascimento is None:
        raise HTTPException(status_code=400, detail="Informe antes a data de nascimento no cadastro do beneficiário (Editar): é ela que diz se quem consente é a "
                                                    "própria pessoa ou um dos pais ou o responsável.")
    if dado_por not in (consentimentos.TITULAR, consentimentos.RESPONSAVEL):
        raise HTTPException(status_code=400, detail="Diga quem consentiu: a própria pessoa atendida ou um dos pais / o responsável.")
    nome = " ".join((nome_responsavel or "").split())
    if dado_por == consentimentos.RESPONSAVEL:
        if len(nome) < 3:
            raise HTTPException(status_code=400, detail="Informe o nome de quem consentiu pela pessoa atendida (um dos pais ou o responsável).")
        if vinculo not in consentimentos.VINCULOS:
            raise HTTPException(status_code=400, detail="Informe o vínculo de quem consentiu: mãe, pai ou responsável legal.")
    termo, versao, _quem, assinado = consentimentos.exigir_dados(
        db, origem=consentimentos.BENEFICIARIO, versao_do_termo=versao_do_termo, quem_autorizou=nome if dado_por == consentimentos.RESPONSAVEL else pessoa.nome_completo,
        meio=meio, id_documento=id_documento, assinado_em=assinado_em,
    )
    menor = _menor_de_idade(pessoa, assinado.date())
    if dado_por == consentimentos.TITULAR and menor:
        raise HTTPException(status_code=400, detail="Na data da assinatura a pessoa atendida tinha menos de 18 anos: quem consente é um dos pais ou o "
                                                    "responsável legal (o adolescente assina junto).")
    if dado_por == consentimentos.RESPONSAVEL and not menor and vinculo != consentimentos.RESPONSAVEL_LEGAL:
        raise HTTPException(status_code=400, detail="Na data da assinatura a pessoa atendida já tinha 18 anos: ela mesma consente (ou o responsável legal, "
                                                    "se há curatela).")
    anterior = consentimentos.vigente(db, consentimentos.BENEFICIARIO, beneficiario.id_beneficiario)
    if anterior is not None:
        consentimentos.encerrar(db, usuario, origem=consentimentos.BENEFICIARIO, id_origem=beneficiario.id_beneficiario, como=consentimentos.SUBSTITUIDO,
                                motivo="Substituído por um termo registrado depois.")
        db.flush()
    novo = consentimentos.registrar(
        db, usuario, origem=consentimentos.BENEFICIARIO, id_origem=beneficiario.id_beneficiario, termo=termo, versao=versao,
        titular=(pessoa.nome_completo or "Pessoa atendida")[:300], id_pessoa=pessoa.id_pessoa, dado_por=dado_por,
        nome_responsavel=nome[:200] if dado_por == consentimentos.RESPONSAVEL else None,
        vinculo_responsavel=vinculo if dado_por == consentimentos.RESPONSAVEL else None, meio=meio, id_documento=id_documento, dado_em=assinado,
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Outra pessoa registrou o consentimento deste beneficiário agora mesmo: recarregue a página e confira.") from None
    db.refresh(novo)
    return novo


def revogar_consentimento(db: Session, usuario, *, id_beneficiario: int, motivo: Optional[str]):
    """v7.1c - a pessoa (ou o responsável) retirou o consentimento: a partir de agora nada novo grava; o que já existe fica guardado, só para a equipe (a
    eliminação dele se pede pela solicitação do titular de dados)."""
    from app.services import consentimentos

    obter_beneficiario(db, id_beneficiario)
    c = consentimentos.encerrar(db, usuario, origem=consentimentos.BENEFICIARIO, id_origem=id_beneficiario, como=consentimentos.REVOGADO, motivo=motivo)
    if c is None:
        raise HTTPException(status_code=404, detail="Este beneficiário não tem consentimento vigente.")
    db.commit()
    return c


def registrar_atendimento(db: Session, *, id_vinculo: int, relato: str, id_usuario: Optional[int]) -> RegistroAtendimento:
    _exigir_relatorio_de_impacto(db)
    _exigir_consentimento(db, id_vinculo)
    registro = RegistroAtendimento(id_vinculo=id_vinculo, relato=relato, id_usuario_autor=id_usuario)
    db.add(registro)
    db.commit()
    db.refresh(registro)
    return registro


def listar_atendimentos(db: Session, *, id_vinculo: int) -> list[RegistroAtendimento]:
    return db.query(RegistroAtendimento).filter(RegistroAtendimento.id_vinculo == id_vinculo).order_by(RegistroAtendimento.data_atendimento.desc()).all()


# ==========================================
# ENCAMINHAMENTO À REDE EXTERNA
# ==========================================
def registrar_encaminhamento(db: Session, *, id_vinculo: int, tipo_rede: str, descricao: str, id_usuario: Optional[int]) -> EncaminhamentoRedeExterna:
    _exigir_relatorio_de_impacto(db)
    _exigir_consentimento(db, id_vinculo)
    validar_codigo_em_catalogo(db, "tipo_rede_externa", tipo_rede, "Tipo de rede externa")
    encaminhamento = EncaminhamentoRedeExterna(id_vinculo=id_vinculo, tipo_rede=tipo_rede, descricao=descricao, id_usuario_registro=id_usuario)
    db.add(encaminhamento)
    db.commit()
    db.refresh(encaminhamento)
    return encaminhamento


def listar_encaminhamentos(db: Session, *, id_vinculo: int) -> list[EncaminhamentoRedeExterna]:
    return db.query(EncaminhamentoRedeExterna).filter(EncaminhamentoRedeExterna.id_vinculo == id_vinculo).order_by(EncaminhamentoRedeExterna.data_encaminhamento.desc()).all()


# ==========================================
# v7.1d - ELIMINAÇÃO DO PRONTUÁRIO A PEDIDO (LGPD, art. 18, VI: o titular pode pedir a eliminação do que foi tratado com o consentimento dele)
# ==========================================
SUBTIPOS_QUE_PEDEM_ELIMINACAO = ("ELIMINACAO", "REVOGACAO", "OUTRO")


def _so_letras(texto: Optional[str]) -> str:
    import unicodedata

    sem_acento = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode()
    return " ".join(sem_acento.lower().split())


def _pedido_e_desta_pessoa(db: Session, pedido, beneficiario: Beneficiario) -> bool:
    """O pedido é da pessoa atendida (o mesmo cadastro, o mesmo CPF ou o mesmo nome) ou de quem consentiu por ela (o nome do responsável em algum consentimento
    registrado, vigente ou encerrado)."""
    from app.models.privacidade import Consentimento
    from app.services import consentimentos

    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == beneficiario.id_pessoa).first()
    if pedido.id_pessoa is not None and pedido.id_pessoa == beneficiario.id_pessoa:
        return True
    cpf_do_pedido = "".join(c for c in (pedido.cpf or "") if c.isdigit())
    if cpf_do_pedido and pessoa is not None and cpf_do_pedido == "".join(c for c in (pessoa.cpf or "") if c.isdigit()):
        return True
    nome = _so_letras(pedido.nome_completo)
    if not nome:
        return False
    responsaveis = {_so_letras(n) for (n,) in db.query(Consentimento.nome_responsavel).filter(
        Consentimento.origem == consentimentos.BENEFICIARIO, Consentimento.id_origem == beneficiario.id_beneficiario,
        Consentimento.nome_responsavel.isnot(None))}
    return nome == _so_letras(pessoa.nome_completo if pessoa else "") or nome in responsaveis
MARCADOR_DO_PRONTUARIO = "(texto apagado a pedido do titular)"


def eliminar_prontuario(db: Session, usuario, *, id_beneficiario: int, protocolo: str) -> dict:
    """Apaga o RELATO de cada atendimento e a DESCRIÇÃO de cada encaminhamento do beneficiário, em todos os projetos; ficam a data, o tipo da rede e quem registrou
    (as contagens do relatório anual não mudam). Só com: o consentimento retirado (sem consentimento que abra o atendimento) e o protocolo de uma solicitação do titular
    de dados com a identidade validada (v5.7f), que pede a eliminação, a revogação ou outro pedido sobre os dados. Quem decide é o encarregado (a permissão
    `privacidade_gerir`, na rota): ele confere que o pedido é desta pessoa (ou do responsável por ela) e que não há obrigação de guardar (art. 16)."""
    from app.models.atendimento import TITULAR_LGPD, Atendimento
    from app.services import consentimentos

    beneficiario = obter_beneficiario(db, id_beneficiario)
    vigente = consentimentos.vigente(db, consentimentos.BENEFICIARIO, id_beneficiario)
    if consentimentos.vale_para_gravar(vigente):
        raise HTTPException(status_code=409, detail="O consentimento ainda está vigente: registre antes a revogação (a pessoa ou o responsável retirou o "
                                                    "consentimento) e depois elimine o prontuário.")
    pedido = db.query(Atendimento).filter(Atendimento.protocolo == (protocolo or "").strip().upper()).first()
    if pedido is None or pedido.tipo != TITULAR_LGPD:
        raise HTTPException(status_code=404, detail="Não há solicitação do titular de dados com esse protocolo.")
    if pedido.subtipo not in SUBTIPOS_QUE_PEDEM_ELIMINACAO:
        raise HTTPException(status_code=400, detail="Essa solicitação não pede a eliminação nem a revogação: confira o protocolo.")
    if not pedido.identidade_validacao:
        raise HTTPException(status_code=409, detail="A identidade de quem pediu ainda não foi validada: valide na fila de atendimento antes de eliminar.")
    from app.models.atendimento import ENCERRADO

    if pedido.status == ENCERRADO:
        raise HTTPException(status_code=409, detail="Essa solicitação já foi encerrada: a eliminação vale para um pedido em andamento ou respondido.")
    if not _pedido_e_desta_pessoa(db, pedido, beneficiario):
        raise HTTPException(status_code=400, detail="Essa solicitação não é desta pessoa nem do responsável registrado no consentimento dela: confira o "
                                                    "protocolo.")
    ids_vinculo = [v for (v,) in db.query(BeneficiarioProjeto.id_vinculo).filter(BeneficiarioProjeto.id_beneficiario == id_beneficiario)]
    relatos = encaminhamentos = 0
    if ids_vinculo:
        relatos = db.query(RegistroAtendimento).filter(
            RegistroAtendimento.id_vinculo.in_(ids_vinculo), RegistroAtendimento.relato != MARCADOR_DO_PRONTUARIO,
        ).update({RegistroAtendimento.relato: MARCADOR_DO_PRONTUARIO}, synchronize_session=False)
        encaminhamentos = db.query(EncaminhamentoRedeExterna).filter(
            EncaminhamentoRedeExterna.id_vinculo.in_(ids_vinculo), EncaminhamentoRedeExterna.descricao != MARCADOR_DO_PRONTUARIO,
        ).update({EncaminhamentoRedeExterna.descricao: MARCADOR_DO_PRONTUARIO}, synchronize_session=False)
    if vigente is not None:  # só a marca antiga do cadastro: acaba junto (o pedido de eliminação retira o consentimento)
        consentimentos.encerrar(db, usuario, origem=consentimentos.BENEFICIARIO, id_origem=id_beneficiario, como=consentimentos.REVOGADO,
                                motivo=f"Eliminação pedida pelo titular (protocolo {pedido.protocolo}).")
    beneficiario.observacao_consentimento = None
    db.commit()
    return {"relatos": relatos, "encaminhamentos": encaminhamentos, "protocolo": pedido.protocolo}
