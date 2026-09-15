"""v1.8 (FASE 1) - higienização de contato: telefone com formato inválido é detectável agora
mesmo (mesmo validador da v1.1); e-mail que "volta" (bounce) **não é** - não existe nenhuma
infraestrutura de envio de e-mail no sistema ainda (pendência repetida desde a v6.2), então essa
detecção não pode ser automática hoje. `marcar_email_suspeito` existe como o caminho manual, pra
quando alguém da secretaria descobre um bounce por fora do sistema - documentado, não fingido."""
from sqlalchemy.orm import Session

from app.models.pessoas import Pessoa
from app.validadores import validar_telefone_br


def escanear_telefones_invalidos(db: Session) -> int:
    from app.models.qualidade_cadastro import CONTATO_TELEFONE_INVALIDO, FilaRevisaoCadastro, PENDENTE

    pessoas = (
        db.query(Pessoa)
        .filter(Pessoa.telefone_whatsapp.isnot(None), Pessoa.telefone_whatsapp != "")
        .all()
    )
    novos = 0
    for pessoa in pessoas:
        if validar_telefone_br(pessoa.telefone_whatsapp):
            continue
        ja_existe = (
            db.query(FilaRevisaoCadastro)
            .filter(
                FilaRevisaoCadastro.tipo_sinal == CONTATO_TELEFONE_INVALIDO,
                FilaRevisaoCadastro.id_pessoa_a == pessoa.id_pessoa, FilaRevisaoCadastro.status == PENDENTE,
            )
            .first()
        )
        pessoa.contato_suspeito = True
        if ja_existe:
            continue
        db.add(FilaRevisaoCadastro(
            tipo_sinal=CONTATO_TELEFONE_INVALIDO, id_pessoa_a=pessoa.id_pessoa,
            detalhe=f"Telefone com formato inválido: '{pessoa.telefone_whatsapp}'.",
        ))
        novos += 1
    db.commit()
    return novos


def marcar_email_suspeito(db: Session, pessoa: Pessoa, motivo: str):
    from app.models.qualidade_cadastro import CONTATO_EMAIL_SUSPEITO, FilaRevisaoCadastro

    pessoa.contato_suspeito = True
    entrada = FilaRevisaoCadastro(tipo_sinal=CONTATO_EMAIL_SUSPEITO, id_pessoa_a=pessoa.id_pessoa, detalhe=motivo)
    db.add(entrada)
    db.commit()
    db.refresh(entrada)
    return entrada
