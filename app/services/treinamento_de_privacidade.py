"""v7.5a (FASE 7) - o treinamento de privacidade: um material curto no painel, lido e confirmado ("Li e entendi"), com o registro de quem fez, quando e qual versão.

Decisões do Presidente (2026-11-02):
- quem precisa: todo usuário do painel com acesso a dado de outras pessoas (qualquer permissão, pelo nível ou pelo cargo); o associado comum, que só vê os
  próprios dados, não;
- **Diretoria Executiva e Conselho Fiscal** (mandato de 4 anos): ao entrar no cargo (também quem entra no meio do mandato) e a cada **2 anos**; quem sai do
  cargo passa para a regra dos demais (se continuar com acesso) ou deixa de precisar;
- **os demais** (voluntários, secretaria...): **todo ano**, porque não se sabe quanto tempo ficam;
- sem bloqueio: só o aviso no painel; **30 dias** para fazer depois que fica pendente.
O texto do material é conferido por verificador independente e aprovado pelo Presidente; a versão vai junto com cada confirmação."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.core import NivelAcesso, PermissaoSistema, Usuario, perfil_permissao
from app.models.mandatos import Mandato
from app.models.privacidade import TreinamentoDePrivacidade

ORGAOS_DE_MANDATO_LONGO = ("DIRETORIA_EXECUTIVA", "CONSELHO_FISCAL")
DIAS_COM_MANDATO = 730  # 2 anos
DIAS_SEM_MANDATO = 365
DIAS_PARA_FAZER = 30
INICIO_DO_TREINAMENTO = datetime(2026, 11, 2)  # quem já tinha acesso antes passou a precisar a partir daqui

VERSAO = "1"
TITULO = "Cuidados com os dados das pessoas na ASAF"
ITENS = (
    ("O que é dado pessoal",
     "É qualquer informação que identifica uma pessoa ou permite identificá-la: nome, CPF, telefone, endereço, e-mail, foto. Alguns são sensíveis e pedem "
     "cuidado redobrado: origem racial ou étnica, convicção religiosa, opinião política, filiação a sindicato ou a organização religiosa, filosófica ou "
     "política, saúde ou vida sexual, dado genético ou biométrico (Lei Geral de Proteção de Dados, art. 5º)."),
    ("Use só o que a sua tarefa pede",
     "O painel já mostra a cada um só o que a sua função permite. Mesmo assim, abra e use só o necessário para a tarefa daquele momento, e nunca para "
     "outro fim."),
    ("O CPF aparece escondido",
     "Nas listas e fichas o CPF aparece escondido, como ***.***.***-12 (só os dois últimos números aparecem). Use \"Mostrar o CPF\" só quando a tarefa "
     "precisar do número inteiro: cada clique fica registrado na Auditoria."),
    ("Nada de listas fora do sistema",
     "Não mande listas de pessoas por WhatsApp, e-mail pessoal ou pen drive. Se precisar exportar, use a exportação do painel (que fica registrada), "
     "guarde o arquivo só enquanto precisar e apague depois."),
    ("Senha e segundo passo são só seus",
     "Não empreste a senha nem o código do aplicativo autenticador (se você usa), não os anote em lugar à vista e não entre no painel com a conta de outra "
     "pessoa. "
     "Ninguém da associação vai pedir a sua senha ou o seu código."),
    ("Cuidado com a tela",
     "Não deixe o painel aberto com o computador sozinho. Em computador ou celular de outra pessoa, clique em Sair ao terminar (no celular, o botão de "
     "sair aparece só como ícone, no alto da tela)."),
    ("Desconfie de mensagem urgente",
     "Mensagem ou e-mail pedindo senha, código ou dados com urgência em nome da associação pode ser golpe. O e-mail oficial é asaf@asaf.org.br e o painel "
     "fica em painel.asaf.org.br: confira o endereço antes de digitar qualquer coisa. Na dúvida, pergunte à Diretoria por outro meio."),
    ("Crianças e adolescentes",
     "Dado de criança e de adolescente pede cuidado redobrado. Foto de atividade só com o termo de autorização de imagem assinado por um dos pais ou pelo "
     "responsável legal (ao enviar foto de evento, de parceria ou da Diretoria, o painel pede os dados desse termo)."),
    ("Pedido de alguém sobre os próprios dados",
     "Se uma pessoa pedir para ver, corrigir ou apagar os dados dela, não responda por conta própria: oriente a usar o formulário do site (ou, para quem "
     "tem acesso ao painel, Meu perfil > Meus dados pessoais). O pedido vai ao encarregado, que é o Presidente (se for sobre os dados dele, ao "
     "Vice-Presidente)."),
    ("Suspeitou de vazamento? Avise na hora",
     "Celular perdido com acesso ao painel, lista enviada para a pessoa errada, algo estranho no sistema: avise o Presidente (o encarregado) na hora. A "
     "associação tem 3 dias úteis, contados de quando soube que dados pessoais foram afetados, para comunicar à ANPD e às pessoas quando o incidente pode "
     "trazer risco ou dano relevante; avisar cedo faz diferença."),
)


def material() -> dict:
    return {"versao": VERSAO, "titulo": TITULO, "itens": [{"titulo": t, "texto": x} for t, x in ITENS]}


def permissoes_efetivas(db: Session, usuario: Usuario) -> set[str]:
    """As permissões do nível real (nunca o do "ver como") mais as dos cargos em mandato vigente."""
    codigos = {p for (p,) in db.query(PermissaoSistema.codigo_permissao).join(
        perfil_permissao, perfil_permissao.c.id_permissao == PermissaoSistema.id_permissao).filter(perfil_permissao.c.id_nivel == usuario.id_nivel)}
    associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
    if associado is not None:
        from app.services.mandatos import permissoes_por_mandatos_vigentes

        codigos |= permissoes_por_mandatos_vigentes(db, associado.id_associado)
    return codigos


def _mandato_longo(db: Session, usuario: Usuario, agora: datetime) -> Optional[Mandato]:
    """O mandato vigente de Diretoria Executiva ou Conselho Fiscal (o de início mais recente, se houver mais de um)."""
    associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
    if associado is None:
        return None
    from app.services.mandatos import mandatos_vigentes_do_associado

    longos = [m for m in mandatos_vigentes_do_associado(db, associado.id_associado, em=agora) if m.orgao_codigo in ORGAOS_DE_MANDATO_LONGO]
    return max(longos, key=lambda m: m.data_inicio) if longos else None


def situacao(db: Session, usuario: Usuario, agora: Optional[datetime] = None) -> dict:
    agora = agora or datetime.utcnow()
    ultimo = db.query(func.max(TreinamentoDePrivacidade.concluido_em)).filter(TreinamentoDePrivacidade.id_usuario == usuario.id_usuario).scalar()
    if not usuario.ativo or not permissoes_efetivas(db, usuario):
        return {"precisa": False, "pendente": False, "ultimo_em": ultimo, "valido_ate": None, "fazer_ate": None, "atrasado": False, "intervalo_dias": None,
                "com_mandato": False}
    mandato = _mandato_longo(db, usuario, agora)
    intervalo = DIAS_COM_MANDATO if mandato else DIAS_SEM_MANDATO
    # desde quando precisa: o que vier por último entre o começo do treinamento no sistema, a criação da conta e a posse no cargo
    inicio_da_obrigacao = max(d for d in (INICIO_DO_TREINAMENTO, usuario.data_criacao, mandato.data_inicio if mandato else None) if d is not None)
    if ultimo is None:
        pendente_desde = inicio_da_obrigacao
    elif mandato is not None and mandato.data_inicio > ultimo:  # entrou no cargo depois do último treinamento: faz de novo
        pendente_desde = mandato.data_inicio
    else:
        pendente_desde = ultimo + timedelta(days=intervalo)
    pendente = pendente_desde <= agora
    fazer_ate = pendente_desde + timedelta(days=DIAS_PARA_FAZER)
    return {"precisa": True, "pendente": pendente, "ultimo_em": ultimo, "valido_ate": None if pendente else pendente_desde,
            "fazer_ate": fazer_ate if pendente else None, "atrasado": pendente and agora > fazer_ate, "intervalo_dias": intervalo,
            "com_mandato": mandato is not None}


def concluir(db: Session, usuario: Usuario, agora: Optional[datetime] = None) -> TreinamentoDePrivacidade:
    t = TreinamentoDePrivacidade(id_usuario=usuario.id_usuario, versao_material=VERSAO, concluido_em=agora or datetime.utcnow())
    db.add(t)
    db.flush()
    return t


def quadro(db: Session, agora: Optional[datetime] = None) -> list[dict]:
    """Quem precisa fazer o treinamento e em que pé está (para o módulo Privacidade)."""
    agora = agora or datetime.utcnow()
    linhas = []
    for u in db.query(Usuario).filter(Usuario.ativo.is_(True)).order_by(Usuario.id_usuario).all():
        s = situacao(db, u, agora)
        if not s["precisa"]:
            continue
        associado = db.query(Associado).filter(Associado.id_usuario == u.id_usuario).first()
        nome = associado.nome_completo if associado else None
        nivel = db.get(NivelAcesso, u.id_nivel) if u.id_nivel else None
        linhas.append({"id_usuario": u.id_usuario, "nome": nome or u.email, "nivel": nivel.nome_nivel if nivel else None, **s})
    return sorted(linhas, key=lambda x: (not x["atrasado"], not x["pendente"], (x["nome"] or "").lower()))
