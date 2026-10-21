"""v6.1 (FASE 6) - comunicação interna no painel: calcular o grupo de um aviso, publicar com a contagem conferida, o mural e a caixa de entrada de cada pessoa, o relatório de
leitura, incluir quem entrou no grupo depois e retirar o aviso (ver app/models/comunicacao.py).

Regras que este módulo garante:
  - o grupo é calculado AQUI, do dado de hoje (a situação do associado vem do financeiro na hora, não do rótulo guardado), e nunca vem pronto da tela;
  - publicar exige que o total que a pessoa viu e confirmou seja o mesmo que o servidor calcula agora (grupo mudou = conferir de novo) e recusa grupo vazio;
  - filtrar o grupo pela SITUAÇÃO do associado (em dia, inadimplente, suspenso...) revela dado financeiro e de disciplina: exige, além de `comunicar`, a permissão `associados` ou
    `financeiro`; quem só tem `comunicar` também não vê os NOMES no relatório de um aviso filtrado por situação (só os totais);
  - cada pessoa só vê os avisos em que ela está entre os destinatários (pelo usuário ou pelo associado dela); qualquer outro aviso não existe para ela (404);
  - o aviso publicado não muda: retirar tira do mural com motivo, mas ele continua no histórico de quem recebeu;
  - publicar, incluir, retirar e confirmar vão para a Auditoria (ler não: abrir só grava a data na linha do destinatário, e nem isso no modo "ver como")."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session, joinedload

from app.auditoria import registrar_auditoria
from app.models.associados import Associado
from app.models.comunicacao import (
    CANAL_EMAIL,
    CANCELADO,
    ENVIADO,
    ENVIANDO,
    NAO_RECEBE,
    FALHOU,
    NA_FILA,
    SEM_EMAIL,
    PARTES_DO_PROJETO,
    PROJETO_EQUIPE,
    PROJETO_VOLUNTARIOS,
    PUBLICO_PERMISSAO,
    PUBLICO_PROJETO,
    TIPOS_DE_PUBLICO,
    Aviso,
    AvisoDestinatario,
    EntregaDeAviso,
)
from app.models.core import Catalogo, OpcaoCatalogo, PermissaoSistema, Usuario
from app.models.projetos import AlocacaoVoluntario, EquipeProjeto, ProjetoEvento
from app.models.preferencias_de_comunicacao import AVISOS as AVISO_POR_EMAIL
from app.services import notificacoes_painel, preferencias_de_comunicacao
from app.services.catalogos import validar_codigo_em_catalogo
from app.services.categoria_associado import ATIVO_EM_DIA, ATIVO_INADIMPLENTE, EM_EXPERIENCIA, LICENCIADO, calcular_categorias
from app.services.fuso import para_belem

PERMISSAO = "comunicar"
# quem pode filtrar por situação (e ver os nomes de um grupo filtrado por situação): já enxerga a situação do associado por outro caminho
PERMISSOES_QUE_VEEM_A_SITUACAO = ("associados", "financeiro")
CATALOGO_DE_CATEGORIA = "categoria_aviso"
DESLIGADO = "Desligado"
SUSPENSO = "Suspenso (Estatuto)"
# as situações que a tela oferece; o desligado nunca recebe aviso
SITUACOES = (ATIVO_EM_DIA, ATIVO_INADIMPLENTE, EM_EXPERIENCIA, LICENCIADO, SUSPENSO)
ALOCACOES_QUE_CONTAM = ("PENDENTE", "CONFIRMADA")

TAMANHO_DO_TITULO = 150
TAMANHO_DO_TEXTO = 5000
DIAS_MAXIMOS_NO_MURAL = 730
MOTIVO_MINIMO, MOTIVO_MAXIMO = 10, 500
# meia-noite de Belém em UTC (Belém é UTC-3, sem horário de verão): o aviso "até 20/10" sai do mural às 03:00 UTC do dia 21
FIM_DO_DIA_EM_BELEM_UTC = time(3, 0)

# v6.2c - as variáveis do TEXTO do aviso (o título não aceita): viram o nome de cada pessoa no painel e no e-mail
VARIAVEIS = ("primeiro_nome", "nome")
_VARIAVEL = re.compile(r"\{([A-Za-z_]+)\}")
NOME_QUANDO_NAO_HA = "associado(a)"

NO_MURAL, VENCIDO, RETIRADO = "No mural", "Vencido", "Retirado"
SITUACOES_DO_AVISO = (NO_MURAL, VENCIDO, RETIRADO)


def validar_texto_e_titulo(titulo: str, texto: str) -> tuple[str, str]:
    """Título e texto obrigatórios e no tamanho; o título sem variável (ele aparece no sino e na lista de todos igual); o texto só com as variáveis que existem."""
    titulo, texto = (titulo or "").strip(), (texto or "").strip()
    if not titulo or len(titulo) > TAMANHO_DO_TITULO:
        raise HTTPException(status_code=422, detail=f"O título é obrigatório e tem até {TAMANHO_DO_TITULO} letras.")
    if not texto or len(texto) > TAMANHO_DO_TEXTO:
        raise HTTPException(status_code=422, detail=f"O texto é obrigatório e tem até {TAMANHO_DO_TEXTO} letras.")
    if _VARIAVEL.search(titulo):
        raise HTTPException(status_code=422, detail="O título não aceita variáveis como {primeiro_nome}: use-as só no texto.")
    desconhecidas = sorted({v for v in _VARIAVEL.findall(texto) if v not in VARIAVEIS})
    if desconhecidas:
        raise HTTPException(
            status_code=422,
            detail="Variável que não existe no texto: " + ", ".join("{" + v + "}" for v in desconhecidas) + ". As que existem: {primeiro_nome} e {nome}.",
        )
    return titulo, texto


def personalizar(texto: str, nome: Optional[str]) -> str:
    """O texto com o nome da pessoa no lugar das variáveis (quem não tem nome no cadastro vê "associado(a)")."""
    nome = (nome or "").strip()
    valores = {"nome": nome or NOME_QUANDO_NAO_HA, "primeiro_nome": nome.split()[0] if nome else NOME_QUANDO_NAO_HA}
    return _VARIAVEL.sub(lambda m: valores.get(m.group(1), m.group(0)), texto)


def hoje() -> date:
    """O dia de hoje em Belém: o aviso "válido até 20/10" fica no mural até o fim do dia 20 de Belém, não até as 21h (meia-noite UTC)."""
    return para_belem(datetime.utcnow()).date()


def pode_ver_a_situacao(db: Session, usuario: Usuario) -> bool:
    from app.security import usuario_tem_permissao  # import local: app.security importa modelos que importam serviços

    return any(usuario_tem_permissao(db, usuario, codigo) for codigo in PERMISSOES_QUE_VEEM_A_SITUACAO)


def _em_lotes(ids: list[int], tamanho: int = 500) -> Iterable[list[int]]:
    for inicio in range(0, len(ids), tamanho):  # o IN do banco tem limite de parâmetros
        yield ids[inicio:inicio + tamanho]


# ------------------------------------------------------------------------------------------------ quem é a pessoa
def _nome_do_associado(associado: Associado) -> str:
    return associado.nome_completo or f"Associado nº {associado.id_associado}"


def _usuarios_ativos(db: Session, ids: Iterable[Optional[int]]) -> dict[int, Optional[str]]:
    """Os usuários ATIVOS entre os ids, com o e-mail do login de cada um."""
    lista = sorted({i for i in ids if i is not None})
    ativos: dict[int, Optional[str]] = {}
    for lote in _em_lotes(lista):
        ativos.update(dict(db.query(Usuario.id_usuario, Usuario.email).filter(Usuario.id_usuario.in_(lote), Usuario.ativo.is_(True)).all()))
    return ativos


class _Nomes:
    """Nome de quem publicou ou retirou (o associado ligado ao usuário, ou o e-mail): uma consulta por usuário, guardada durante a resposta."""

    def __init__(self, db: Session):
        self.db, self.cache = db, {}

    def __call__(self, id_usuario: Optional[int]) -> Optional[str]:
        if id_usuario is None:
            return None
        if id_usuario not in self.cache:
            associado = self.db.query(Associado).options(joinedload(Associado.pessoa)).filter(Associado.id_usuario == id_usuario).first()
            if associado is not None:
                self.cache[id_usuario] = _nome_do_associado(associado)
            else:
                usuario = self.db.get(Usuario, id_usuario)
                self.cache[id_usuario] = usuario.email if usuario is not None else None
        return self.cache[id_usuario]


# endereço que o servidor de e-mail aceita: só ASCII, sem espaço nem separador (um endereço com acento quebraria a conversa com o servidor no meio do lote)
_EMAIL = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")
EMAIL_DO_CONTATO, EMAIL_DO_LOGIN = "contato", "login"


def _email_valido(email: Optional[str]) -> Optional[str]:
    email = (email or "").strip()
    return email if _EMAIL.match(email) and not email.endswith("@exemplo.invalid") else None


def email_de(email_do_contato: Optional[str], email_do_login: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """v6.2a - A regra única do e-mail de uma pessoa (para contar na conferência e para enviar): o e-mail de CONTATO do cadastro; sem ele, o do LOGIN de um usuário
    ativo. Devolve (endereço, origem), a origem para só mandar para a higienização o e-mail de contato."""
    if _email_valido(email_do_contato):
        return _email_valido(email_do_contato), EMAIL_DO_CONTATO
    if _email_valido(email_do_login):
        return _email_valido(email_do_login), EMAIL_DO_LOGIN
    return None, None


def email_atual(db: Session, linha: AvisoDestinatario) -> tuple[Optional[str], Optional[str]]:
    """v6.2a - o e-mail de quem recebeu o aviso, lido do cadastro NA HORA de enviar (a mesma regra da conferência)."""
    associado = None
    if linha.id_associado is not None:
        associado = db.query(Associado).options(joinedload(Associado.pessoa)).filter(Associado.id_associado == linha.id_associado).first()
    id_usuario = linha.id_usuario if linha.id_usuario is not None else (associado.id_usuario if associado is not None else None)
    login = _usuarios_ativos(db, [id_usuario]).get(id_usuario) if id_usuario is not None else None
    return email_de(associado.pessoa.email_contato if associado is not None and associado.pessoa else None, login)


# ------------------------------------------------------------------------------------------------ a regra do grupo
@dataclass(frozen=True)
class Destino:
    id_associado: Optional[int]
    id_usuario: Optional[int]
    nome: str
    email: Optional[str] = None  # v6.2a: o e-mail do cadastro AGORA (só para contar; a entrega lê de novo na hora de enviar)
    id_pessoa: Optional[int] = None  # v6.2b: para respeitar a preferência de contato

    @property
    def tem_acesso(self) -> bool:
        return self.id_usuario is not None


def _rotulos_do_catalogo(db: Session, chave: str) -> list[tuple[str, str]]:
    catalogo = db.query(Catalogo).filter(Catalogo.chave == chave).first()
    if catalogo is None:
        return []
    opcoes = (
        db.query(OpcaoCatalogo).filter(OpcaoCatalogo.id_catalogo == catalogo.id_catalogo, OpcaoCatalogo.ativo.is_(True))
        .order_by(OpcaoCatalogo.ordem, OpcaoCatalogo.id_opcao).all()
    )
    return [(o.codigo, o.rotulo or o.codigo) for o in opcoes]


def categorias_obrigatorias(db: Session) -> set[str]:
    """v6.2a - as categorias de aviso marcadas `obrigatoria` no catálogo (decisão do Presidente: Convocação e Mudança de regra)."""
    catalogo = db.query(Catalogo).filter(Catalogo.chave == CATALOGO_DE_CATEGORIA).first()
    if catalogo is None:
        return set()
    opcoes = db.query(OpcaoCatalogo).filter(OpcaoCatalogo.id_catalogo == catalogo.id_catalogo, OpcaoCatalogo.ativo.is_(True)).all()
    return {o.codigo for o in opcoes if isinstance(o.metadados, dict) and o.metadados.get("obrigatoria")}


def _sem_repetir(valores: list) -> list:
    return list(dict.fromkeys(valores))


def normalizar_publico(db: Session, publico: dict, usuario: Optional[Usuario] = None) -> dict:
    """Confere a regra que veio da tela e devolve só o que vale para o tipo escolhido (campos de outro tipo são descartados). Com `usuario`, recusa o filtro por situação a quem
    não pode ver a situação do associado."""
    tipo = publico.get("tipo")
    if tipo not in TIPOS_DE_PUBLICO:
        raise HTTPException(status_code=422, detail="Escolha quem recebe: associados, quem tem uma permissão ou um projeto.")
    if tipo == PUBLICO_PERMISSAO:
        codigo = (publico.get("codigo_permissao") or "").strip()
        if not codigo or db.query(PermissaoSistema).filter(PermissaoSistema.codigo_permissao == codigo).first() is None:
            raise HTTPException(status_code=422, detail="Escolha uma permissão que existe.")
        return {"tipo": tipo, "codigo_permissao": codigo}

    situacoes = _sem_repetir(list(publico.get("situacoes") or []))
    if any(s not in SITUACOES for s in situacoes):
        raise HTTPException(status_code=422, detail="Situação de associado inválida.")
    if situacoes and usuario is not None and not pode_ver_a_situacao(db, usuario):
        raise HTTPException(
            status_code=403,
            detail="Escolher pela situação do associado (em dia, inadimplente, suspenso...) mostra dado financeiro e de disciplina: precisa também da permissão 'associados' ou 'financeiro'.",
        )
    categorias_validas = {rotulo for _, rotulo in _rotulos_do_catalogo(db, "categoria_associado")}
    categorias = _sem_repetir(list(publico.get("categorias") or []))
    if any(c not in categorias_validas for c in categorias):
        raise HTTPException(status_code=422, detail="Categoria de associado inválida.")
    normalizado = {"tipo": tipo, "situacoes": situacoes, "categorias": categorias}
    if tipo == PUBLICO_PROJETO:
        id_projeto = publico.get("id_projeto")
        if not isinstance(id_projeto, int) or db.get(ProjetoEvento, id_projeto) is None:
            raise HTTPException(status_code=422, detail="Escolha um projeto que existe.")
        partes = _sem_repetir(list(publico.get("partes_do_projeto") or []))
        if not partes or any(p not in PARTES_DO_PROJETO for p in partes):
            raise HTTPException(status_code=422, detail="Escolha a equipe, os voluntários ou os dois.")
        normalizado.update({"id_projeto": id_projeto, "partes_do_projeto": [p for p in PARTES_DO_PROJETO if p in partes]})
    return normalizado


def _destinos_por_associados(db: Session, ids: Optional[set[int]], situacoes: list[str], categorias: list[str]) -> list[Destino]:
    """Desligado e suspenso são decisões, não conta: valem como estão. O resto (em dia, inadimplente, em experiência, licenciado) é recalculado agora do financeiro, porque o
    rótulo guardado só muda quando algo dispara o recálculo e pode estar velho. Poucas consultas para o grupo inteiro (não algumas por pessoa)."""
    consulta = (
        db.query(Associado).options(joinedload(Associado.pessoa))
        .filter(or_(Associado.status_arrolamento.is_(None), Associado.status_arrolamento != DESLIGADO))
    )
    if ids is not None:
        if not ids:
            return []
        consulta = consulta.filter(Associado.id_associado.in_(ids))
    if categorias:
        consulta = consulta.filter(Associado.categoria.in_(categorias))
    associados = consulta.all()
    calculaveis = [a for a in associados if a.status_arrolamento != SUSPENSO]
    calculadas = calcular_categorias(db, calculaveis)
    ativos = _usuarios_ativos(db, (a.id_usuario for a in associados))
    destinos = []
    for associado in associados:
        situacao = SUSPENSO if associado.status_arrolamento == SUSPENSO else calculadas[associado.id_associado]
        if situacoes and situacao not in situacoes:
            continue
        id_usuario = associado.id_usuario if associado.id_usuario in ativos else None
        email, _ = email_de(associado.pessoa.email_contato if associado.pessoa else None, ativos.get(associado.id_usuario))
        destinos.append(Destino(associado.id_associado, id_usuario, _nome_do_associado(associado), email, associado.id_pessoa))
    return destinos


def _destinos_por_permissao(db: Session, codigo: str) -> list[Destino]:
    from app.security import usuario_tem_permissao  # import local: app.security importa modelos que importam serviços

    usuarios = db.query(Usuario).filter(Usuario.ativo.is_(True)).all()
    associados = {
        a.id_usuario: a for a in db.query(Associado).options(joinedload(Associado.pessoa)).filter(Associado.id_usuario.isnot(None)).all()
    }
    destinos = []
    for usuario in usuarios:
        associado = associados.get(usuario.id_usuario)
        if associado is not None and associado.status_arrolamento == DESLIGADO:
            continue
        if not usuario_tem_permissao(db, usuario, codigo):
            continue
        email, _ = email_de(associado.pessoa.email_contato if associado is not None and associado.pessoa else None, usuario.email)
        destinos.append(Destino(
            associado.id_associado if associado else None, usuario.id_usuario, _nome_do_associado(associado) if associado else usuario.email, email,
            associado.id_pessoa if associado else None,
        ))
    return destinos


def _ids_do_projeto(db: Session, id_projeto: int, partes: list[str]) -> set[int]:
    ids: set[int] = set()
    if PROJETO_EQUIPE in partes:
        ids |= {i for (i,) in db.query(EquipeProjeto.id_associado).filter(EquipeProjeto.id_projeto == id_projeto, EquipeProjeto.data_fim.is_(None)).all()}
    if PROJETO_VOLUNTARIOS in partes:
        alocacoes = db.query(AlocacaoVoluntario.id_associado, AlocacaoVoluntario.id_pessoa).filter(
            AlocacaoVoluntario.id_projeto == id_projeto, AlocacaoVoluntario.status.in_(ALOCACOES_QUE_CONTAM),
        ).all()
        ids |= {a for a, _ in alocacoes if a is not None}
        # o voluntário alocado só como PESSOA que depois se tornou associado também conta (a alocação antiga não aponta para o associado)
        pessoas = sorted({p for a, p in alocacoes if a is None and p is not None})
        for lote in _em_lotes(pessoas):
            ids |= {i for (i,) in db.query(Associado.id_associado).filter(Associado.id_pessoa.in_(lote)).all()}
    return ids


def resolver_publico(db: Session, publico: dict) -> list[Destino]:
    """Quem está no grupo AGORA, uma vez cada um, em ordem de nome."""
    if publico["tipo"] == PUBLICO_PERMISSAO:
        destinos = _destinos_por_permissao(db, publico["codigo_permissao"])
    elif publico["tipo"] == PUBLICO_PROJETO:
        destinos = _destinos_por_associados(db, _ids_do_projeto(db, publico["id_projeto"], publico["partes_do_projeto"]), publico["situacoes"], publico["categorias"])
    else:
        destinos = _destinos_por_associados(db, None, publico["situacoes"], publico["categorias"])
    return sorted(destinos, key=lambda d: (d.nome.casefold(), d.id_associado or 0, d.id_usuario or 0))


def _lista_em_portugues(itens: list[str]) -> str:
    return itens[0] if len(itens) == 1 else ", ".join(itens[:-1]) + " ou " + itens[-1]


def descrever_publico(db: Session, publico: dict) -> str:
    if publico["tipo"] == PUBLICO_PERMISSAO:
        permissao = db.query(PermissaoSistema).filter(PermissaoSistema.codigo_permissao == publico["codigo_permissao"]).first()
        return f"Quem tem a permissão \"{publico['codigo_permissao']}\"" + (f" ({permissao.modulo})" if permissao and permissao.modulo else "")
    filtros = ""
    if publico["situacoes"]:
        filtros += f" em situação {_lista_em_portugues(publico['situacoes'])}"
    if publico["categorias"]:
        filtros += f", da categoria {_lista_em_portugues(publico['categorias'])}"
    if publico["tipo"] == PUBLICO_PROJETO:
        projeto = db.get(ProjetoEvento, publico["id_projeto"])
        partes = {PROJETO_EQUIPE: "a equipe", PROJETO_VOLUNTARIOS: "os voluntários associados"}
        quem = " e ".join(partes[p] for p in publico["partes_do_projeto"])
        texto = f"Do projeto \"{projeto.nome_projeto if projeto else publico['id_projeto']}\": {quem}"
        return (texto + (f" ({filtros.strip(' ,')})" if filtros else ""))[:400]
    return ("Associados" + filtros if filtros else "Todos os associados (menos os desligados)")[:400]


def conferir_publico(db: Session, usuario: Usuario, publico: dict) -> dict:
    """A prévia que a tela mostra antes de publicar: o total, quantos não têm acesso ao painel e quem são."""
    normalizado = normalizar_publico(db, publico, usuario)
    destinos = resolver_publico(db, normalizado)
    return {
        "descricao": descrever_publico(db, normalizado),
        "total": len(destinos),
        "sem_acesso": sum(1 for d in destinos if not d.tem_acesso),
        "com_email": sum(1 for d in destinos if d.email),
        # v6.2b: dos que têm e-mail, quantos desligaram os avisos NÃO obrigatórios por e-mail (a convocação e a mudança de regra chegam a eles mesmo assim)
        "desligaram_os_avisos": len(preferencias_de_comunicacao.quem_nao_recebe(db, (d.id_pessoa for d in destinos if d.email), AVISO_POR_EMAIL)),
        "pessoas": [{"nome": d.nome, "tem_acesso": d.tem_acesso, "tem_email": bool(d.email)} for d in destinos],
    }


# ------------------------------------------------------------------------------------------------ publicar, incluir, retirar
def _avisar_no_sino(db: Session, aviso: Aviso, destinos: list[Destino]) -> None:
    ids = [d.id_usuario for d in destinos if d.id_usuario is not None]
    if ids:
        notificacoes_painel.notificar(
            db, ids, tipo="aviso", titulo=f"Novo aviso: {aviso.titulo}",
            texto="Pede a sua confirmação de leitura." if aviso.exige_confirmacao else None, link=f"/meus-avisos/{aviso.id_aviso}",
        )


def _gravar_destinos(db: Session, aviso: Aviso, destinos: list[Destino]) -> None:
    """Uma linha por pessoa (a prova) e, se o aviso vai também por e-mail, a entrega dela na fila (ou "sem e-mail no cadastro")."""
    agora = datetime.utcnow()
    # v6.2b: quem desligou os avisos por e-mail não recebe o e-mail de um aviso NÃO obrigatório (no painel, recebe sempre)
    fora = set()
    if aviso.por_email and aviso.categoria not in categorias_obrigatorias(db):
        fora = preferencias_de_comunicacao.quem_nao_recebe(db, (d.id_pessoa for d in destinos), AVISO_POR_EMAIL)
    linhas = [
        AvisoDestinatario(id_aviso=aviso.id_aviso, id_associado=d.id_associado, id_usuario=d.id_usuario, tinha_acesso=d.tem_acesso, incluido_em=agora)
        for d in destinos
    ]
    db.add_all(linhas)
    if aviso.por_email:
        db.flush()
        db.add_all([
            EntregaDeAviso(
                id_destinatario=linha.id_destinatario, canal=CANAL_EMAIL, tentativas=0, criado_em=agora,
                situacao=(NAO_RECEBE if d.id_pessoa in fora else NA_FILA) if d.email else SEM_EMAIL,
            )
            for linha, d in zip(linhas, destinos)
        ])


def publicar(
    db: Session, usuario: Usuario, *, titulo: str, texto: str, categoria: str, valido_ate: date, exige_confirmacao: bool, publico: dict, total_confirmado: int,
    por_email: bool = False, id_modelo: Optional[int] = None, conferir_total: bool = True,
) -> Aviso:
    """`conferir_total=False` só para o aviso AGENDADO (o total foi conferido ao agendar; na hora de publicar o grupo é recalculado pela mesma regra)."""
    titulo, texto = validar_texto_e_titulo(titulo, texto)
    validar_codigo_em_catalogo(db, CATALOGO_DE_CATEGORIA, categoria, "Categoria do aviso")
    validar_modelo(db, id_modelo)
    dia = hoje()
    if valido_ate < dia:
        raise HTTPException(status_code=422, detail="A data \"válido até\" já passou.")
    if valido_ate > dia + timedelta(days=DIAS_MAXIMOS_NO_MURAL):
        raise HTTPException(status_code=422, detail="Um aviso fica no mural por no máximo 2 anos.")
    normalizado = normalizar_publico(db, publico, usuario)
    destinos = resolver_publico(db, normalizado)
    if not destinos:
        raise HTTPException(status_code=422, detail="Ninguém está neste grupo hoje: o aviso não foi publicado.")
    if conferir_total and total_confirmado != len(destinos):
        raise HTTPException(
            status_code=409,
            detail=f"O grupo mudou desde a conferência: agora são {len(destinos)} pessoa(s), não {total_confirmado}. Confira de novo antes de publicar.",
        )
    aviso = Aviso(
        titulo=titulo, texto=texto, categoria=categoria, exige_confirmacao=bool(exige_confirmacao), por_email=bool(por_email), valido_ate=valido_ate, publico=normalizado,
        id_modelo=id_modelo,
        publico_descricao=descrever_publico(db, normalizado), total_destinatarios=len(destinos), id_usuario_autor=usuario.id_usuario, publicado_em=datetime.utcnow(),
    )
    db.add(aviso)
    db.flush()
    _gravar_destinos(db, aviso, destinos)
    _avisar_no_sino(db, aviso, destinos)
    registrar_auditoria(
        db, usuario, "avisos", "AVISO_PUBLICADO", id_registro_afetado=aviso.id_aviso,
        dados_depois={
            "titulo": titulo, "categoria": categoria, "publico": aviso.publico_descricao, "total_destinatarios": len(destinos),
            "sem_acesso": sum(1 for d in destinos if not d.tem_acesso), "exige_confirmacao": aviso.exige_confirmacao, "valido_ate": valido_ate.isoformat(),
            "por_email": aviso.por_email, "com_email": sum(1 for d in destinos if d.email) if aviso.por_email else 0,
        },
    )
    db.refresh(aviso)
    return aviso


def validar_modelo(db: Session, id_modelo: Optional[int]) -> None:
    if id_modelo is None:
        return
    from app.models.comunicacao import ModeloDeAviso

    if db.get(ModeloDeAviso, id_modelo) is None:
        raise HTTPException(status_code=422, detail="Modelo de aviso inexistente.")


def obter(db: Session, id_aviso: int) -> Aviso:
    aviso = db.get(Aviso, id_aviso)
    if aviso is None:
        raise HTTPException(status_code=404, detail="Aviso não encontrado.")
    return aviso


def situacao(aviso: Aviso, dia: Optional[date] = None) -> str:
    if aviso.retirado_em is not None:
        return RETIRADO
    return VENCIDO if aviso.valido_ate < (dia or hoje()) else NO_MURAL


def incluir_novos(db: Session, usuario: Usuario, id_aviso: int) -> int:
    """Acrescenta quem entrou no grupo depois da publicação (ninguém sai: a lista é a prova de quem estava). Só com o aviso no mural."""
    aviso = obter(db, id_aviso)
    if situacao(aviso) != NO_MURAL:
        raise HTTPException(status_code=409, detail="Só se inclui gente em aviso que ainda está no mural.")
    ja = db.query(AvisoDestinatario.id_associado, AvisoDestinatario.id_usuario).filter(AvisoDestinatario.id_aviso == id_aviso).all()
    associados = {a for a, _ in ja if a is not None}
    usuarios = {u for _, u in ja if u is not None}
    novos = [
        d for d in resolver_publico(db, aviso.publico)
        if not ((d.id_associado is not None and d.id_associado in associados) or (d.id_usuario is not None and d.id_usuario in usuarios))
    ]
    if not novos:
        return 0
    _gravar_destinos(db, aviso, novos)
    aviso.total_destinatarios += len(novos)
    _avisar_no_sino(db, aviso, novos)
    registrar_auditoria(db, usuario, "avisos", "AVISO_DESTINATARIOS_INCLUIDOS", id_registro_afetado=id_aviso, dados_depois={"incluidos": len(novos), "total": aviso.total_destinatarios})
    return len(novos)


def retirar(db: Session, usuario: Usuario, id_aviso: int, motivo: str) -> Aviso:
    """Tira do mural, com o motivo que quem recebeu vai ler. Só o aviso que ESTÁ no mural (o vencido já saiu dele; retirar depois só impediria a confirmação atrasada)."""
    aviso = obter(db, id_aviso)
    motivo = (motivo or "").strip()
    if not (MOTIVO_MINIMO <= len(motivo) <= MOTIVO_MAXIMO):
        raise HTTPException(status_code=422, detail=f"Escreva o motivo da retirada (de {MOTIVO_MINIMO} a {MOTIVO_MAXIMO} letras): quem recebeu vai lê-lo.")
    if aviso.retirado_em is not None:
        raise HTTPException(status_code=409, detail="Este aviso já foi retirado.")
    if situacao(aviso) != NO_MURAL:
        raise HTTPException(status_code=409, detail="Este aviso já venceu: ele já saiu do mural.")
    aviso.retirado_em = datetime.utcnow()
    aviso.id_usuario_retirada = usuario.id_usuario
    aviso.motivo_retirada = motivo
    # o e-mail que ainda não saiu não sai mais (o que já saiu fica registrado como enviado)
    ids = [i for (i,) in db.query(AvisoDestinatario.id_destinatario).filter(AvisoDestinatario.id_aviso == id_aviso).all()]
    for lote in _em_lotes(ids):
        db.query(EntregaDeAviso).filter(EntregaDeAviso.id_destinatario.in_(lote), EntregaDeAviso.situacao == NA_FILA).update(
            {"situacao": CANCELADO}, synchronize_session=False,
        )
    registrar_auditoria(db, usuario, "avisos", "AVISO_RETIRADO", id_registro_afetado=id_aviso, dados_depois={"motivo": motivo})
    db.refresh(aviso)
    return aviso


def reenviar_falhas(db: Session, usuario: Usuario, id_aviso: int) -> int:
    """v6.2a - os e-mails que falharam voltam para a fila (com as tentativas zeradas). Só com o aviso no mural; vai para a Auditoria."""
    aviso = obter(db, id_aviso)
    if situacao(aviso) != NO_MURAL:
        raise HTTPException(status_code=409, detail="Só se reenvia o e-mail de aviso que ainda está no mural.")
    ids = [i for (i,) in db.query(AvisoDestinatario.id_destinatario).filter(AvisoDestinatario.id_aviso == id_aviso).all()]
    voltaram = 0
    for lote in _em_lotes(ids):
        voltaram += db.query(EntregaDeAviso).filter(EntregaDeAviso.id_destinatario.in_(lote), EntregaDeAviso.situacao == FALHOU).update(
            {"situacao": NA_FILA, "tentativas": 0, "proxima_tentativa_em": None, "ultimo_erro": None}, synchronize_session=False,
        )
    if voltaram:
        registrar_auditoria(db, usuario, "avisos", "AVISO_EMAILS_REENVIADOS", id_registro_afetado=id_aviso, dados_depois={"voltaram_para_a_fila": voltaram})
    else:
        db.commit()
    return voltaram


def _totais_de_email(db: Session, ids_avisos: list[int]) -> dict[int, dict]:
    if not ids_avisos:
        return {}
    linhas = (
        db.query(AvisoDestinatario.id_aviso, EntregaDeAviso.situacao, func.count(EntregaDeAviso.id_entrega))
        .join(EntregaDeAviso, EntregaDeAviso.id_destinatario == AvisoDestinatario.id_destinatario)
        .filter(AvisoDestinatario.id_aviso.in_(ids_avisos), EntregaDeAviso.canal == CANAL_EMAIL)
        .group_by(AvisoDestinatario.id_aviso, EntregaDeAviso.situacao).all()
    )
    totais: dict[int, dict] = {}
    for id_aviso, situacao_da_entrega, n in linhas:
        totais.setdefault(id_aviso, {s: 0 for s in (NA_FILA, ENVIANDO, ENVIADO, FALHOU, SEM_EMAIL, CANCELADO, NAO_RECEBE)})[situacao_da_entrega] = n
    return totais


# ------------------------------------------------------------------------------------------------ a lista e o relatório (quem tem `comunicar`)
def _totais(db: Session, ids: list[int]) -> dict[int, dict]:
    if not ids:
        return {}
    linhas = (
        db.query(
            AvisoDestinatario.id_aviso, func.count(AvisoDestinatario.id_destinatario),
            func.count(AvisoDestinatario.lido_em), func.count(AvisoDestinatario.confirmado_em),
            func.sum(case((AvisoDestinatario.tinha_acesso.is_(False), 1), else_=0)),
        ).filter(AvisoDestinatario.id_aviso.in_(ids)).group_by(AvisoDestinatario.id_aviso).all()
    )
    return {i: {"destinatarios": n, "lidos": lidos, "confirmados": conf, "sem_acesso": int(sem or 0)} for i, n, lidos, conf, sem in linhas}


def _resumo(aviso: Aviso, totais: Optional[dict], dia: date, rotulos: dict[str, str], nomes: _Nomes, email: Optional[dict] = None) -> dict:
    if aviso.leitura_apagada_em is not None or totais is None:
        totais = {"destinatarios": aviso.total_destinatarios, "lidos": aviso.total_lidos, "confirmados": aviso.total_confirmados, "sem_acesso": None}
    return {
        "id_aviso": aviso.id_aviso, "titulo": aviso.titulo, "categoria": aviso.categoria, "categoria_rotulo": rotulos.get(aviso.categoria, aviso.categoria),
        "exige_confirmacao": aviso.exige_confirmacao, "valido_ate": aviso.valido_ate, "publicado_em": aviso.publicado_em, "publico_descricao": aviso.publico_descricao,
        "autor": nomes(aviso.id_usuario_autor), "situacao": situacao(aviso, dia), "retirado_em": aviso.retirado_em, "motivo_retirada": aviso.motivo_retirada,
        "leitura_apagada_em": aviso.leitura_apagada_em, "totais": totais,
        "por_email": aviso.por_email, "email": email if aviso.por_email else None,
    }


def listar(db: Session, *, situacao_filtro: Optional[str], busca: Optional[str], pagina: int, por_pagina: int) -> dict:
    dia = hoje()
    consulta = db.query(Aviso)
    if situacao_filtro == NO_MURAL:
        consulta = consulta.filter(Aviso.retirado_em.is_(None), Aviso.valido_ate >= dia)
    elif situacao_filtro == VENCIDO:
        consulta = consulta.filter(Aviso.retirado_em.is_(None), Aviso.valido_ate < dia)
    elif situacao_filtro == RETIRADO:
        consulta = consulta.filter(Aviso.retirado_em.isnot(None))
    elif situacao_filtro:
        raise HTTPException(status_code=422, detail="Situação inválida.")
    if busca and busca.strip():
        consulta = consulta.filter(Aviso.titulo.ilike(f"%{busca.strip()}%"))
    total = consulta.count()
    avisos = consulta.order_by(Aviso.publicado_em.desc(), Aviso.id_aviso.desc()).offset((pagina - 1) * por_pagina).limit(por_pagina).all()
    totais = _totais(db, [a.id_aviso for a in avisos])
    emails = _totais_de_email(db, [a.id_aviso for a in avisos if a.por_email])
    rotulos, nomes = dict(_rotulos_do_catalogo(db, CATALOGO_DE_CATEGORIA)), _Nomes(db)
    return {
        "total": total, "pagina": pagina, "por_pagina": por_pagina,
        "itens": [_resumo(a, totais.get(a.id_aviso), dia, rotulos, nomes, emails.get(a.id_aviso)) for a in avisos],
    }


def detalhar(db: Session, usuario: Usuario, id_aviso: int) -> dict:
    aviso = obter(db, id_aviso)
    resumo = _resumo(
        aviso, _totais(db, [id_aviso]).get(id_aviso), hoje(), dict(_rotulos_do_catalogo(db, CATALOGO_DE_CATEGORIA)), _Nomes(db),
        _totais_de_email(db, [id_aviso]).get(id_aviso) if aviso.por_email else None,
    )
    # os nomes de um grupo escolhido pela situação (ex.: os inadimplentes) só para quem já enxerga a situação do associado
    nomes_ocultos = bool((aviso.publico or {}).get("situacoes")) and not pode_ver_a_situacao(db, usuario)
    pessoas = []
    if not nomes_ocultos:
        linhas = db.query(AvisoDestinatario).filter(AvisoDestinatario.id_aviso == id_aviso).all()
        associados = {}
        for lote in _em_lotes(sorted({l.id_associado for l in linhas if l.id_associado is not None})):
            associados.update({a.id_associado: a for a in db.query(Associado).options(joinedload(Associado.pessoa)).filter(Associado.id_associado.in_(lote)).all()})
        ativos = _usuarios_ativos(db, [l.id_usuario for l in linhas] + [a.id_usuario for a in associados.values()])
        nomes = _Nomes(db)
        entregas: dict[int, EntregaDeAviso] = {}
        for lote in _em_lotes([l.id_destinatario for l in linhas]):
            entregas.update({
                e.id_destinatario: e for e in db.query(EntregaDeAviso).filter(EntregaDeAviso.id_destinatario.in_(lote), EntregaDeAviso.canal == CANAL_EMAIL).all()
            })
        for linha in linhas:
            associado = associados.get(linha.id_associado)
            nome = _nome_do_associado(associado) if associado is not None else (nomes(linha.id_usuario) or "—")
            id_usuario_hoje = associado.id_usuario if associado is not None else linha.id_usuario
            pessoas.append({
                "id_destinatario": linha.id_destinatario, "nome": nome, "tinha_acesso": linha.tinha_acesso, "tem_acesso_hoje": id_usuario_hoje in ativos,
                "incluido_em": linha.incluido_em, "lido_em": linha.lido_em, "confirmado_em": linha.confirmado_em,
                "email": _entrega_para_a_tela(entregas.get(linha.id_destinatario)),
            })
        pessoas.sort(key=lambda p: p["nome"].casefold())
    modelo = None
    if aviso.id_modelo is not None:
        from app.models.comunicacao import ModeloDeAviso

        usado = db.get(ModeloDeAviso, aviso.id_modelo)
        modelo = {"id_modelo": usado.id_modelo, "nome": usado.nome, "versao": usado.versao} if usado is not None else None
    return {**resumo, "texto": aviso.texto, "nomes_ocultos": nomes_ocultos, "destinatarios": pessoas, "modelo": modelo}


def _entrega_para_a_tela(entrega: Optional[EntregaDeAviso]) -> Optional[dict]:
    if entrega is None:
        return None
    return {"situacao": entrega.situacao, "tentativas": entrega.tentativas, "enviado_em": entrega.enviado_em, "erro": entrega.ultimo_erro}


def opcoes_de_publico(db: Session, usuario: Usuario) -> dict:
    """O que a tela de "Novo aviso" oferece para montar o grupo (as situações, só a quem pode filtrar por elas)."""
    return {
        "situacoes": list(SITUACOES) if pode_ver_a_situacao(db, usuario) else [],
        "categorias_de_associado": [rotulo for _, rotulo in _rotulos_do_catalogo(db, "categoria_associado")],
        "permissoes": [
            {"codigo": p.codigo_permissao, "modulo": p.modulo, "descricao": p.descricao}
            for p in db.query(PermissaoSistema).order_by(PermissaoSistema.modulo, PermissaoSistema.codigo_permissao).all()
        ],
        "projetos": [{"id_projeto": p.id_projeto, "nome": p.nome_projeto} for p in db.query(ProjetoEvento).order_by(ProjetoEvento.nome_projeto).all()],
        "categorias_de_aviso": [
            {"codigo": c, "rotulo": r, "obrigatoria": c in categorias_obrigatorias(db)} for c, r in _rotulos_do_catalogo(db, CATALOGO_DE_CATEGORIA)
        ],
    }


# ------------------------------------------------------------------------------------------------ o mural e a caixa de entrada (cada pessoa, os dela)
def _minhas_linhas(db: Session, usuario: Usuario):
    associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
    condicao = AvisoDestinatario.id_usuario == usuario.id_usuario
    if associado is not None:
        condicao = or_(condicao, AvisoDestinatario.id_associado == associado.id_associado)
    return db.query(AvisoDestinatario).filter(condicao)


def _minha_linha(db: Session, usuario: Usuario, id_aviso: int) -> AvisoDestinatario:
    linha = _minhas_linhas(db, usuario).filter(AvisoDestinatario.id_aviso == id_aviso).order_by(AvisoDestinatario.id_destinatario).first()
    if linha is None:
        raise HTTPException(status_code=404, detail="Aviso não encontrado.")
    return linha


def _para_quem_recebeu(aviso: Aviso, linha: AvisoDestinatario, dia: date, rotulos: dict[str, str], nomes: _Nomes, com_texto: bool) -> dict:
    dados = {
        "id_aviso": aviso.id_aviso, "titulo": aviso.titulo, "categoria_rotulo": rotulos.get(aviso.categoria, aviso.categoria),
        "exige_confirmacao": aviso.exige_confirmacao, "valido_ate": aviso.valido_ate, "publicado_em": aviso.publicado_em, "autor": nomes(aviso.id_usuario_autor),
        "situacao": situacao(aviso, dia), "retirado_em": aviso.retirado_em, "motivo_retirada": aviso.motivo_retirada,
        "lido_em": linha.lido_em, "confirmado_em": linha.confirmado_em,
    }
    if com_texto:
        dados["texto"] = aviso.texto
    return dados


def meus_avisos(db: Session, usuario: Usuario, *, so_mural: bool) -> dict:
    """A caixa de entrada (todos) ou o mural (só os que estão no mural, filtrados no banco). Os que pedem confirmação e ainda não foram confirmados vêm primeiro; depois, os mais novos."""
    dia = hoje()
    consulta = _minhas_linhas(db, usuario).join(Aviso, Aviso.id_aviso == AvisoDestinatario.id_aviso)
    if so_mural:
        consulta = consulta.filter(Aviso.retirado_em.is_(None), Aviso.valido_ate >= dia)
    vistos: dict[int, AvisoDestinatario] = {}
    for linha in consulta.order_by(AvisoDestinatario.id_destinatario).all():
        vistos.setdefault(linha.id_aviso, linha)
    avisos = []
    for lote in _em_lotes(sorted(vistos)):
        avisos += db.query(Aviso).filter(Aviso.id_aviso.in_(lote)).all()
    rotulos, nomes = dict(_rotulos_do_catalogo(db, CATALOGO_DE_CATEGORIA)), _Nomes(db)
    itens = [_para_quem_recebeu(a, vistos[a.id_aviso], dia, rotulos, nomes, com_texto=False) for a in avisos]

    def pendente(i: dict) -> bool:
        return i["exige_confirmacao"] and i["confirmado_em"] is None and i["situacao"] == NO_MURAL

    itens.sort(key=lambda i: (not pendente(i), -i["publicado_em"].timestamp(), -i["id_aviso"]))
    return {
        "nao_lidos": sum(1 for i in itens if i["lido_em"] is None),
        "confirmacoes_pendentes": sum(1 for i in itens if pendente(i)),
        "avisos": itens,
    }


def abrir_meu(db: Session, usuario: Usuario, id_aviso: int) -> dict:
    """Abrir grava a data da leitura (a primeira vez) e liga a linha ao usuário, se ela era só do associado (ganhou acesso depois). No modo "ver como" só mostra: a leitura
    de quem está vendo como outro nível não é a leitura da pessoa e não vira prova."""
    linha = _minha_linha(db, usuario, id_aviso)
    if not getattr(usuario, "id_nivel_impersonado", None):
        if linha.lido_em is None:
            linha.lido_em = datetime.utcnow()
        if linha.id_usuario is None and db.query(AvisoDestinatario).filter(AvisoDestinatario.id_aviso == id_aviso, AvisoDestinatario.id_usuario == usuario.id_usuario).first() is None:
            linha.id_usuario = usuario.id_usuario
        db.commit()
    dados = _para_quem_recebeu(db.get(Aviso, id_aviso), linha, hoje(), dict(_rotulos_do_catalogo(db, CATALOGO_DE_CATEGORIA)), _Nomes(db), com_texto=True)
    dados["texto"] = personalizar(dados["texto"], _Nomes(db)(usuario.id_usuario) if _pessoa_do_usuario(db, usuario) else None)
    return dados


def confirmar_meu(db: Session, usuario: Usuario, id_aviso: int) -> dict:
    linha = _minha_linha(db, usuario, id_aviso)
    aviso = db.get(Aviso, id_aviso)
    if not aviso.exige_confirmacao:
        raise HTTPException(status_code=409, detail="Este aviso não pede confirmação.")
    if aviso.retirado_em is not None:
        raise HTTPException(status_code=409, detail="Este aviso foi retirado: não há o que confirmar.")
    if linha.confirmado_em is None:
        agora = datetime.utcnow()
        linha.confirmado_em = agora
        linha.lido_em = linha.lido_em or agora
        registrar_auditoria(db, usuario, "avisos", "AVISO_CONFIRMADO", id_registro_afetado=id_aviso, dados_depois={"id_destinatario": linha.id_destinatario})
    dados = _para_quem_recebeu(aviso, linha, hoje(), dict(_rotulos_do_catalogo(db, CATALOGO_DE_CATEGORIA)), _Nomes(db), com_texto=True)
    dados["texto"] = personalizar(dados["texto"], _Nomes(db)(usuario.id_usuario) if _pessoa_do_usuario(db, usuario) else None)
    return dados


def _pessoa_do_usuario(db: Session, usuario: Usuario) -> Optional[int]:
    associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
    return associado.id_pessoa if associado is not None else None


# ------------------------------------------------------------------------------------------------ prazo de guarda (chamado pela rotina de retenção)
def saiu_do_mural_em(aviso: Aviso) -> datetime:
    """O instante (UTC) em que o aviso saiu do mural: o fim do dia `valido_ate` em Belém, ou a retirada, o que veio primeiro."""
    fim = datetime.combine(aviso.valido_ate + timedelta(days=1), FIM_DO_DIA_EM_BELEM_UTC)
    return aviso.retirado_em if aviso.retirado_em is not None and aviso.retirado_em < fim else fim


def apagar_leituras_vencidas(db: Session, agora: datetime, dias: int) -> int:
    """5 anos (o prazo da configuração) depois de o aviso sair do mural (vencer ou ser retirado, o que vier primeiro), a lista de quem recebeu, leu e confirmou é apagada; o aviso fica
    com os totais. A confirmação continua na Auditoria (AVISO_CONFIRMADO), que não tem prazo automático. Devolve quantas linhas de destinatário foram apagadas."""
    limite = agora - timedelta(days=dias)
    # só os candidatos: o que venceu antes do limite (com folga de um dia para o fuso) ou foi retirado antes dele
    candidatos = (
        db.query(Aviso).filter(
            Aviso.leitura_apagada_em.is_(None),
            or_(Aviso.valido_ate < limite.date(), Aviso.retirado_em < limite),
        ).all()
    )
    apagadas = 0
    for aviso in candidatos:
        if saiu_do_mural_em(aviso) >= limite:
            continue
        totais = _totais(db, [aviso.id_aviso]).get(aviso.id_aviso, {"lidos": 0, "confirmados": 0})
        aviso.total_lidos, aviso.total_confirmados = totais["lidos"], totais["confirmados"]
        aviso.leitura_apagada_em = agora
        ids = [i for (i,) in db.query(AvisoDestinatario.id_destinatario).filter(AvisoDestinatario.id_aviso == aviso.id_aviso).all()]
        for lote in _em_lotes(ids):
            db.query(EntregaDeAviso).filter(EntregaDeAviso.id_destinatario.in_(lote)).delete(synchronize_session=False)
        apagadas += db.query(AvisoDestinatario).filter(AvisoDestinatario.id_aviso == aviso.id_aviso).delete(synchronize_session=False)
    db.commit()
    return apagadas
