"""v1.8 (FASE 1) - qualidade permanente da base: detector de duplicidade contínuo, fila de
revisão (mesclagem nunca acontece sozinha) e higienização de contato. Reaproveita a permissão
`associados`, mesma equipe que já cuida de filiação/situação/família/voluntariado."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.associados import Associado, DependenteFamiliar
from app.models.core import Usuario
from app.models.pessoas import Pessoa
from app.models.qualidade_cadastro import PENDENTE, FilaRevisaoCadastro
from app.schemas.qualidade_cadastro import MarcarEmailSuspeitoRequest, MesclarPessoasRequest
from app.security import exigir_permissao
from app.services.duplicidade import escanear_duplicidade_continua
from app.services.higienizacao_contato import escanear_telefones_invalidos, marcar_email_suspeito
from app.services.mesclagem import mesclar_pessoas

router = APIRouter()
_permissao_associados = exigir_permissao("associados")


def _buscar_pessoa_ou_404(db: Session, id_pessoa: int) -> Pessoa:
    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa).first()
    if not pessoa:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada.")
    return pessoa


@router.post("/api/pessoas/duplicidade/escanear", summary="Varrer toda a base por duplicidade de nome+nascimento")
def escanear_duplicidade(db: Session = Depends(get_db), _usuario: Usuario = Depends(_permissao_associados)):
    novos = escanear_duplicidade_continua(db)
    return {"mensagem": f"{novos} novo(s) candidato(s) a duplicidade adicionado(s) à fila.", "novos": novos}


@router.post("/api/pessoas/higienizar-contatos", summary="Varrer telefones com formato inválido")
def higienizar_contatos(db: Session = Depends(get_db), _usuario: Usuario = Depends(_permissao_associados)):
    novos = escanear_telefones_invalidos(db)
    return {"mensagem": f"{novos} telefone(s) com formato inválido adicionado(s) à fila.", "novos": novos}


@router.post("/api/pessoas/{id_pessoa}/marcar-contato-suspeito", summary="Reportar e-mail devolvido (bounce) manualmente")
def reportar_email_suspeito(
    id_pessoa: int, dados: MarcarEmailSuspeitoRequest,
    db: Session = Depends(get_db), _usuario: Usuario = Depends(_permissao_associados),
):
    # Não há infraestrutura de envio de e-mail ainda (pendência da v6.2) - sem ela, não existe
    # detecção automática de bounce. Este é o caminho manual, pra quando alguém descobre por
    # fora do sistema que um e-mail voltou.
    pessoa = _buscar_pessoa_ou_404(db, id_pessoa)
    entrada = marcar_email_suspeito(db, pessoa, dados.motivo)
    return {"mensagem": "Contato marcado como suspeito.", "id_fila": entrada.id_fila}


@router.get("/api/pessoas/fila-revisao", summary="Listar itens pendentes na fila de revisão de cadastro")
def listar_fila_revisao(status: str = PENDENTE, db: Session = Depends(get_db), _usuario: Usuario = Depends(_permissao_associados)):
    itens = db.query(FilaRevisaoCadastro).filter(FilaRevisaoCadastro.status == status).order_by(FilaRevisaoCadastro.criado_em.desc()).all()
    # v7.1 (achado ao vivo): eram 4 consultas POR ITEM; com a fila cheia a tela demorava a se atualizar depois de uma busca. Agora 2 consultas no total.
    ids = {i for item in itens for i in (item.id_pessoa_a, item.id_pessoa_b) if i}
    pessoas = {p.id_pessoa: p for p in db.query(Pessoa).filter(Pessoa.id_pessoa.in_(ids))} if ids else {}
    associados = {a.id_pessoa: a for a in db.query(Associado).filter(Associado.id_pessoa.in_(ids))} if ids else {}
    resultado = []
    for item in itens:
        pessoa_a = pessoas.get(item.id_pessoa_a)
        pessoa_b = pessoas.get(item.id_pessoa_b) if item.id_pessoa_b else None
        # v5.4c (achado AO VIVO): dois cadastros duplicados costumam ter O MESMO NOME; sem dizer quem é associado (e a matrícula), a tela de
        # mesclar não tinha como distinguir um do outro.
        associado_a = associados.get(item.id_pessoa_a)
        associado_b = associados.get(item.id_pessoa_b) if item.id_pessoa_b else None
        resultado.append({
            "id_fila": item.id_fila, "tipo_sinal": item.tipo_sinal, "detalhe": item.detalhe,
            "status": item.status, "criado_em": item.criado_em,
            "id_pessoa_a": item.id_pessoa_a, "nome_pessoa_a": pessoa_a.nome_completo if pessoa_a else None,
            "id_pessoa_b": item.id_pessoa_b, "nome_pessoa_b": pessoa_b.nome_completo if pessoa_b else None,
            "e_associado_a": associado_a is not None, "matricula_a": associado_a.numero_matricula if associado_a else None,
            "e_associado_b": associado_b is not None, "matricula_b": associado_b.numero_matricula if associado_b else None,
        })
    return resultado


def _lado_da_comparacao(db: Session, pessoa: Pessoa) -> dict:
    """Um lado da comparação de cadastros duplicados: os dados da pessoa (o CPF ESCONDIDO, como em toda lista - v7.3a), o cadastro de associado
    (matrícula, desde quando, categoria, situação, endereço) e o tamanho do que vem junto (mensalidades, família)."""
    from app.models.associados import Endereco
    from app.models.financeiro import TituloFinanceiro
    from app.services import cpf_protegido

    associado = db.query(Associado).filter(Associado.id_pessoa == pessoa.id_pessoa).first()
    lado = {
        "id_pessoa": pessoa.id_pessoa,
        "nome_completo": pessoa.nome_completo,
        "cpf_mascarado": cpf_protegido.mascarar(pessoa.cpf),
        "data_nascimento": pessoa.data_nascimento.date().isoformat() if pessoa.data_nascimento else None,
        "email_contato": pessoa.email_contato,
        "telefone_whatsapp": pessoa.telefone_whatsapp,
        "estado_civil": pessoa.estado_civil,
        "profissao": pessoa.profissao,
        "naturalidade": pessoa.naturalidade,
        "tem_foto": bool(pessoa.foto),
        "familiares": db.query(DependenteFamiliar).filter(DependenteFamiliar.id_pessoa_titular == pessoa.id_pessoa).count(),
        "associado": None,
    }
    if associado is not None:
        endereco = db.query(Endereco).filter(Endereco.id_associado == associado.id_associado).first()
        titulos = db.query(TituloFinanceiro.status).filter(TituloFinanceiro.id_associado == associado.id_associado).all()
        lado["associado"] = {
            "id_associado": associado.id_associado,
            "numero_matricula": associado.numero_matricula,
            "data_admissao": associado.data_admissao.date().isoformat() if associado.data_admissao else None,
            "categoria": associado.categoria,
            "status_arrolamento": associado.status_arrolamento,
            "endereco": ", ".join(p for p in [
                endereco.logradouro, endereco.numero, endereco.bairro, endereco.cidade and f"{endereco.cidade}/{endereco.estado or ''}".rstrip("/"),
            ] if p) if endereco else None,
            "titulos_pagos": sum(1 for (st,) in titulos if st == "Pago"),
            "titulos_em_aberto": sum(1 for (st,) in titulos if st == "Pendente"),
        }
    return lado


@router.get("/api/pessoas/fila-revisao/{id_fila}/comparar", summary="Os dois cadastros de um possível duplicado, lado a lado (CPF escondido)")
def comparar_item_fila(id_fila: int, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_associados)):
    """v9.5 (Qualidade da base passo a passo, desenho aprovado pelo Presidente): o passo "Comparar" da tela. Diz qual cadastro FICA (o da matrícula
    mais antiga; o de associado, se só um é) e, campo a campo, o que acontece - pela MESMA regra que a junção usa (`classificar_campos`), então o
    "Vai ficar assim" da tela é o que o servidor grava. Também a situação e o acesso ao painel depois de juntar."""
    from app.services.mesclagem import classificar_campos, escolher_acesso, mais_antigo, situacao_depois

    item = db.query(FilaRevisaoCadastro).filter(FilaRevisaoCadastro.id_fila == id_fila).first()
    if not item or not item.id_pessoa_b:
        raise HTTPException(status_code=404, detail="Item da fila não encontrado ou não é um possível duplicado.")
    pessoa_a = db.query(Pessoa).filter(Pessoa.id_pessoa == item.id_pessoa_a).first()
    pessoa_b = db.query(Pessoa).filter(Pessoa.id_pessoa == item.id_pessoa_b).first()
    if not pessoa_a or not pessoa_b:
        raise HTTPException(status_code=404, detail="Um dos dois cadastros não existe mais (já foi juntado?).")
    associado_a = db.query(Associado).filter(Associado.id_pessoa == pessoa_a.id_pessoa).first()
    associado_b = db.query(Associado).filter(Associado.id_pessoa == pessoa_b.id_pessoa).first()
    if associado_a and associado_b:
        a_fica = mais_antigo(associado_a) <= mais_antigo(associado_b)
    else:
        a_fica = not (associado_b and not associado_a)  # o cadastro de associado sempre fica (a pessoa sem cadastro é que é juntada a ele)
    (p_fica, as_fica), (p_sai, as_sai) = ((pessoa_a, associado_a), (pessoa_b, associado_b)) if a_fica else ((pessoa_b, associado_b), (pessoa_a, associado_a))

    campos = classificar_campos(db, p_fica, p_sai, as_fica, as_sai)
    resposta = {
        "id_fila": item.id_fila, "tipo_sinal": item.tipo_sinal, "detalhe": item.detalhe,
        "fica": p_fica.id_pessoa, "os_dois_sao_associados": bool(associado_a and associado_b),
        "a": _lado_da_comparacao(db, pessoa_a), "b": _lado_da_comparacao(db, pessoa_b),
        # campo a campo, do ponto de vista de quem fica ("fica" = o cadastro que fica, "sai" = o juntado)
        "campos": campos,
        "cpf_diferente": any(c["chave"] == "cpf" and c["modo"] == "escolher" for c in campos),
        "situacao": None, "acesso": None,
    }
    if as_fica and as_sai:
        _, texto = situacao_depois(as_fica, as_sai)
        resposta["situacao"] = {"fica": as_fica.status_arrolamento, "sai": as_sai.status_arrolamento, "depois": texto}
        fica, sai, texto_acesso = escolher_acesso(db, as_fica, as_sai, usuario.id_usuario)

        def descrever(associado):
            u = db.query(Usuario).filter(Usuario.id_usuario == associado.id_usuario).first() if associado.id_usuario else None
            return "Sem acesso" if u is None else ("Tem acesso" if u.ativo else "Acesso desligado")

        resposta["acesso"] = {"fica": descrever(as_fica), "sai": descrever(as_sai), "depois": texto_acesso}
    return resposta


@router.post("/api/pessoas/fila-revisao/{id_fila}/ignorar", summary="Marcar item da fila como não sendo um problema real")
def ignorar_item_fila(id_fila: int, db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_associados)):
    item = db.query(FilaRevisaoCadastro).filter(FilaRevisaoCadastro.id_fila == id_fila).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item da fila não encontrado.")
    item.status = "ignorado"
    item.resolvido_em = datetime.utcnow()
    item.id_usuario_resolveu = usuario.id_usuario
    db.commit()
    return {"mensagem": "Item marcado como ignorado."}


@router.post("/api/pessoas/{id_pessoa_mantida}/mesclar", summary="Mesclar duas Pessoas duplicadas (irreversível)")
def mesclar(
    id_pessoa_mantida: int, dados: MesclarPessoasRequest,
    db: Session = Depends(get_db), usuario: Usuario = Depends(_permissao_associados),
):
    resultado = mesclar_pessoas(
        db, id_pessoa_mantida, dados.id_pessoa_absorvida, dados.nome_confirmacao, usuario=usuario, escolhas=dados.escolhas,
        id_fila=dados.id_fila,
    )

    # Qualquer entrada pendente na fila que envolvia qualquer uma das duas pessoas fica
    # desatualizada depois da mesclagem - resolve automaticamente, sem deixar pendência morta.
    pendentes = db.query(FilaRevisaoCadastro).filter(
        FilaRevisaoCadastro.status == PENDENTE,
        (FilaRevisaoCadastro.id_pessoa_a.in_([id_pessoa_mantida, dados.id_pessoa_absorvida]))
        | (FilaRevisaoCadastro.id_pessoa_b.in_([id_pessoa_mantida, dados.id_pessoa_absorvida])),
    ).all()
    for item in pendentes:
        item.status = "mesclado"
        item.resolvido_em = datetime.utcnow()
        item.id_usuario_resolveu = usuario.id_usuario
    db.commit()

    return {"mensagem": "Pessoas mescladas com sucesso.", **resultado}
