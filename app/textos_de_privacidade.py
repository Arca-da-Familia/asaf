"""v7.1a (FASE 7) - os TEXTOS DE PRIVACIDADE que o titular lê ao entregar dado pessoal, cada um com a sua base legal e todas as suas versões.

Por que existe: o sistema guardava só o NÚMERO da versão do aviso que a pessoa aceitou ("2"); o texto ficava no código do site e mudava sem deixar rastro no sistema. Agora cada
versão tem o texto exato (o que a pessoa leu), a data em que passou a valer e a base legal; a tabela `textos_de_privacidade` guarda cada versão na primeira vez que o sistema sobe e
NUNCA a reescreve (tests/test_textos_de_privacidade.py prende a impressão de cada versão: mudar um texto publicado sem criar versão nova reprova a suíte).

Aviso x consentimento (LGPD art. 7º e 8º; plano v7.1): pedir consentimento para tudo é erro - enfraquece o consentimento onde ele importa. Onde a base é outra (o pedido da
própria pessoa, art. 7º, V; obrigação legal, art. 7º, II) o formulário mostra um AVISO (informa o que se faz com o dado) e a caixa diz "Li o aviso"; consentimento só onde ele é de
fato a base (foto, dado sensível de beneficiário: v7.1b e v7.1c).

Formato do texto: parágrafos separados por linha em branco; um link é escrito como [texto](/endereco/) - o site o mostra como link, o painel e o PDF como texto.
As versões antigas foram reconstituídas do código-fonte do site na época (`reconstituido=True`): é o texto que o formulário mostrava, tirado do histórico do repositório."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import date
from typing import Optional

AVISO = "aviso"
CONSENTIMENTO = "consentimento"


@dataclass(frozen=True)
class Ponto:
    codigo: str
    nome: str
    tipo: str  # AVISO ou CONSENTIMENTO
    onde: str  # onde a pessoa lê
    atividade: str  # a atividade do inventário (app/services/inventario.py)
    bases_legais: tuple[str, ...]  # códigos de app/services/inventario.py::BASES_LEGAIS
    caixa: str  # o que a caixa de marcar diz


@dataclass(frozen=True)
class Texto:
    ponto: str
    versao: str
    vigente_desde: date
    texto: str
    reconstituido: bool = False
    observacao: str = ""
    # o que esta versão era e o que a caixa dizia QUANDO foi mostrada (se diferente do ponto hoje): a versão 1 da inscrição em evento era "consentimento" e a caixa
    # dizia "Li e aceito."; a filiação 1 e 2, "Li o aviso ... e concordo com o uso dos meus dados ..."
    tipo: Optional[str] = None
    caixa: Optional[str] = None
    # a caixa era marcada pela EQUIPE no painel (declaração de quem enviava a foto, marca no cadastro do beneficiário), não pela pessoa
    pela_equipe: bool = False

    @property
    def impressao(self) -> str:
        return hashlib.sha256(self.texto.encode("utf-8")).hexdigest()


PONTOS: tuple[Ponto, ...] = (
    Ponto("INSCRICAO_EVENTO", "Inscrição em evento pelo site", AVISO, "site: página de cada evento, formulário de inscrição", "PROJETOS_EVENTOS", ("ART7_V",),
          "Li o aviso de privacidade."),
    Ponto("FILIACAO", "Pedido de filiação pelo site", AVISO, "site: Seja associado", "CADASTRO", ("ART7_V",), "Li o aviso de privacidade."),
    Ponto("ATENDIMENTO", "Contato e pedido de informação pelo site", AVISO, "site: Contato e Transparência > pedido de informação", "ATENDIMENTO", ("ART7_V", "ART7_II"),
          "Li e aceito o aviso de privacidade."),
    Ponto("ATENDIMENTO_TITULAR", "Solicitação do titular de dados pelo site", AVISO, "site: Privacidade > solicitação do titular", "ATENDIMENTO", ("ART7_II",),
          "Li e aceito o aviso de privacidade."),
    Ponto("ATENDIMENTO_VOLUNTARIADO", "Oferta de voluntariado pelo site", AVISO, "site: Seja voluntário", "ATENDIMENTO", ("ART7_V",),
          "Li e aceito o aviso de privacidade."),
    Ponto("DOACAO", "Pedido de doação pelo site", AVISO, "site: Como ajudar > doação", "DOACOES", ("ART7_V", "ART7_II"), "Li e aceito o aviso de privacidade."),
    Ponto("VISITANTE", "Conta de visitante (entrar com o e-mail)", AVISO, "site: Minha conta", "VISITANTE", ("ART7_V", "ART7_IX"), "(sem caixa: o aviso fica junto do botão)"),
    # v7.1b - os TERMOS de consentimento (a pessoa assina; quem envia a foto registra no painel quem autorizou e como)
    Ponto("IMAGEM_DIRETORIA", "Autorização de uso de imagem: foto da Diretoria e do Conselho no site", CONSENTIMENTO,
          "painel: Governança > mandatos, foto para o site (o termo é impresso e assinado)", "GOVERNANCA", ("ART7_I",), "Assinatura no termo"),
    # v7.1c - o consentimento para o atendimento social (prontuário e encaminhamentos: dado sensível, muitas vezes de criança)
    Ponto("ATENDIMENTO_SOCIAL", "Consentimento para o atendimento social (prontuário e encaminhamentos)", CONSENTIMENTO,
          "painel: Beneficiários (o termo é impresso e assinado pela pessoa atendida ou pelo responsável)", "BENEFICIARIOS", ("ART11_I", "ART7_I"),
          "Assinatura no termo"),
    Ponto("IMAGEM_ATIVIDADE", "Autorização de uso de imagem: fotos das atividades (eventos e parcerias)", CONSENTIMENTO,
          "painel: fotos de evento (Projetos e eventos) e de etapa de parceria (Transparência; o termo é impresso e assinado)", "PROJETOS_EVENTOS", ("ART7_I",),
          "Assinatura no termo"),
)

_POLITICA = "[Política de Privacidade](/privacidade/)"
_TITULAR = "[solicitação do titular de dados](/privacidade/solicitacao-do-titular/)"
_ATENDIMENTO_BASE = (
    "Usamos o que você escrever aqui só para responder ao seu pedido. Quem lê o seu pedido é quem atende na associação (hoje, a Presidência e a Diretoria). Guardamos o pedido, "
    "o protocolo e a nossa resposta para provar que atendemos no prazo. Para saber mais, ou para pedir que apaguemos o que guardamos, leia a "
)
_VOLUNTARIADO = (
    "Se a sua oferta for aceita, a secretaria cadastra você como voluntário(a) no sistema da ASAF, com o nome, o CPF (se você informar), o contato e a data de nascimento, para "
    "o termo de adesão e a escala."
)
_DOACAO_INICIO = (
    "Vamos guardar o seu nome, o seu e-mail, o CPF (se você informar), o valor e a campanha que escolheu, o seu aceite deste aviso e o endereço de internet (IP) de onde veio o "
    "pedido. Usamos esses dados para conferir o seu Pix no extrato do banco da associação, registrar a doação e emitir o recibo, que tentamos enviar por e-mail. Se o CPF for de "
    "um associado, a doação fica ligada ao cadastro dele. O endereço de internet (IP) serve à segurança (limite de pedidos e Auditoria). Quem confere é a tesouraria da associação. "
)
_DOACAO_FIM = (
    "Para saber mais, ou para pedir que apaguemos os seus dados, leia a [Política de Privacidade](/privacidade/#doacao-pelo-site) ou use a " + _TITULAR + "."
)
_CAIXA_FILIACAO_ANTIGA = "Li o aviso de privacidade e concordo com o uso dos meus dados para analisar o meu pedido de filiação."
_FILIACAO_INICIO = (
    "Os dados deste formulário (nome, CPF, data de nascimento, e-mail e telefone) vão para o sistema de gestão da ASAF e servem para a Diretoria Executiva analisar o seu pedido de "
    "filiação e, se ele for aprovado, para o seu cadastro de associado. "
)

TEXTOS: tuple[Texto, ...] = (
    # ---------------------------------------------------------------- inscrição em evento: era "consentimento" (configuração editável); a base é a própria inscrição (art. 7º, V)
    Texto("INSCRICAO_EVENTO", "1", date(2026, 9, 18),
          "Ao me inscrever, autorizo o uso dos meus dados pessoais (nome, CPF, e-mail, telefone e respostas deste formulário) para fins de organização deste evento, nos termos da LGPD.",
          reconstituido=True, observacao="Texto padrão do sistema (configuração TEXTO_CONSENTIMENTO_LGPD_INSCRICAO), que podia ser editado em Regras do sistema.",
          tipo=CONSENTIMENTO, caixa="Li e aceito."),
    Texto("INSCRICAO_EVENTO", "2", date(2026, 10, 27),
          "Os dados deste formulário (nome, CPF, e-mail, telefone e as respostas; numa inscrição em grupo, também o nome, o CPF e as respostas de cada pessoa que "
          "você inscrever) são usados para organizar a inscrição neste evento: a vaga ou a lista de espera, os e-mails sobre o evento, a presença, o certificado, quando "
          "houver, e a pesquisa de satisfação depois do evento (LGPD, art. 7º, V: a inscrição é feita a seu pedido). Quem inscreve outra pessoa, como uma criança da "
          "família, deve ser o responsável por ela ou ter a autorização dela.\n\n"
          "Cada pessoa inscrita passa a constar do cadastro de participantes da associação; se o CPF já estava lá, o cadastro é completado com o contato que faltava. O "
          "registro do envio, com o endereço de internet (IP), fica na Auditoria do sistema, por segurança. Quem vê é quem organiza o evento na associação. Para saber "
          "mais, ou para pedir que apaguemos os seus dados, leia a " + _POLITICA + " ou use a " + _TITULAR + "."),
    # ---------------------------------------------------------------- filiação
    Texto("FILIACAO", "1", date(2026, 10, 8),
          _FILIACAO_INICIO + "Para que três sócios possam propor o seu nome, eles veem só o seu nome e a sua idade. Guardamos também o endereço IP de quem envia, por segurança. "
          "Os seus direitos e os detalhes estão na " + _POLITICA + ".", reconstituido=True, caixa=_CAIXA_FILIACAO_ANTIGA),
    Texto("FILIACAO", "2", date(2026, 10, 8),
          _FILIACAO_INICIO + "Para que três sócios possam propor o seu nome, todos os sócios ativos e em dia veem, no painel, o seu nome e a sua idade; CPF, e-mail e telefone só a "
          "Diretoria vê. Guardamos também o endereço IP de quem envia, por segurança. Pedidos recusados ou sem andamento ficam guardados no sistema; você pode pedir a eliminação "
          "pelo e-mail da associação. Os seus direitos e os detalhes estão na " + _POLITICA + ".", reconstituido=True,
          observacao="Desde a v5.7b (16/10/2026) o pedido não aprovado é apagado sozinho 2 anos depois da última mudança; a versão 3 corrige o aviso.",
          caixa=_CAIXA_FILIACAO_ANTIGA),
    Texto("FILIACAO", "3", date(2026, 10, 27),
          _FILIACAO_INICIO + "Para que três sócios possam propor o seu nome, todos os sócios ativos e em dia veem, no painel, o seu nome e a sua idade; CPF, e-mail e telefone só a "
          "Diretoria vê. Guardamos também o endereço IP de quem envia, por segurança. Se o pedido não for aprovado, o sistema o apaga sozinho depois de um prazo (hoje, "
          "2 anos depois da última mudança nele); antes disso, você pode pedir a eliminação pelo e-mail da associação. Os seus direitos e os detalhes estão na " + _POLITICA + "."),
    # ---------------------------------------------------------------- atendimento (a versão é uma só para os três formulários; a 2 mudou só o do voluntariado)
    Texto("ATENDIMENTO", "1", date(2026, 10, 9), _ATENDIMENTO_BASE + _POLITICA + " ou use a " + _TITULAR + ".", reconstituido=True),
    Texto("ATENDIMENTO", "2", date(2026, 10, 16), _ATENDIMENTO_BASE + _POLITICA + " ou use a " + _TITULAR + ".", reconstituido=True,
          observacao="Igual à versão 1: a versão 2 mudou só o aviso do voluntariado."),
    Texto("ATENDIMENTO_TITULAR", "1", date(2026, 10, 9), _ATENDIMENTO_BASE + _POLITICA + ".", reconstituido=True),
    Texto("ATENDIMENTO_TITULAR", "2", date(2026, 10, 16), _ATENDIMENTO_BASE + _POLITICA + ".", reconstituido=True,
          observacao="Igual à versão 1: a versão 2 mudou só o aviso do voluntariado."),
    Texto("ATENDIMENTO_VOLUNTARIADO", "1", date(2026, 10, 9), _ATENDIMENTO_BASE + _POLITICA + " ou use a " + _TITULAR + ".", reconstituido=True),
    Texto("ATENDIMENTO_VOLUNTARIADO", "2", date(2026, 10, 16), _VOLUNTARIADO + "\n\n" + _ATENDIMENTO_BASE + _POLITICA + " ou use a " + _TITULAR + ".", reconstituido=True),
    # ---------------------------------------------------------------- doação
    Texto("DOACAO", "1", date(2026, 10, 15),
          _DOACAO_INICIO + "Se ninguém confirmar o pedido, ele continua guardado no sistema: hoje não há prazo para apagá-lo. " + _DOACAO_FIM, reconstituido=True),
    Texto("DOACAO", "2", date(2026, 10, 16),
          _DOACAO_INICIO + "Se ninguém confirmar o pedido, ele continua guardado no sistema por um prazo (hoje, 2 anos depois do prazo do pedido) e depois o sistema o apaga sozinho. "
          + _DOACAO_FIM, reconstituido=True),
    # ---------------------------------------------------------------- os termos de imagem (v7.1b). A versão 1 é a DECLARAÇÃO que quem enviava a foto marcava no painel:
    # antes da v7.1b o sistema não tinha o texto do termo que a pessoa assinava (se assinava)
    Texto("IMAGEM_DIRETORIA", "1", date(2026, 10, 15),
          "Esta pessoa autorizou o uso da imagem dela no site da ASAF. A foto fica pública na página Diretoria. Se ela retirar a autorização, use “Apagar a foto”: some "
          "do sistema na hora e do site na próxima publicação.", reconstituido=True, caixa="Esta pessoa autorizou o uso da imagem dela no site da ASAF", pela_equipe=True,
          observacao="Declaração de quem enviou a foto no painel (o texto da caixa e a explicação ao lado). O termo que a pessoa assinou, se houve, ficava fora do sistema."),
    Texto("IMAGEM_DIRETORIA", "2", date(2026, 10, 27),
          "Eu, identificado(a) abaixo, autorizo a ASAF - Associação Arca da Família a publicar a minha fotografia na página Diretoria do site da associação, junto do "
          "meu nome e do meu cargo, enquanto eu tiver mandato vigente ou já marcado na associação (LGPD, art. 7º, I). A foto fica guardada no sistema da ASAF, sem "
          "localização nem dados do aparelho, e não é usada para outra finalidade nem vendida. Quando não há mais mandato vigente nem marcado, o sistema apaga a foto "
          "sozinho.\n\n"
          "Posso retirar esta autorização a qualquer momento, sem custo, pedindo à secretaria ou pela solicitação do titular de dados no site: assim que o pedido é "
          "registrado, a foto sai do sistema, e sai do site na próxima publicação (o armazenamento ainda guarda uma cópia de segurança por cerca de 30 dias). A ASAF "
          "guarda o registro desta autorização (quem assinou, quando e como) por 5 anos depois que ela termina, como prova. Saiba mais na Política de Privacidade "
          "(asaf.org.br/privacidade).\n\n"
          "Nome completo: ______________________________\nCPF: ______________________________\nLocal e data: ______________________________\n"
          "Assinatura: ______________________________"),
    Texto("IMAGEM_ATIVIDADE", "1", date(2026, 10, 4),
          "Há autorização de uso de imagem de todas as pessoas que aparecem na foto (dos responsáveis, no caso de criança ou adolescente). Marque somente se existe de "
          "verdade.", reconstituido=True, caixa="Há autorização de uso de imagem", pela_equipe=True,
          observacao="Declaração de quem enviou a foto no painel. O termo que as pessoas assinaram, se houve, ficava fora do sistema."),
    Texto("IMAGEM_ATIVIDADE", "2", date(2026, 10, 27),
          "Eu, identificado(a) abaixo, autorizo a ASAF - Associação Arca da Família a usar fotografias em que eu apareço, ou em que aparece a criança ou o adolescente "
          "por quem sou responsável (identificado abaixo), tiradas nas atividades da associação (eventos, projetos e parcerias), para mostrar essas atividades no "
          "site da associação, nas páginas dos eventos, dos projetos e da transparência (LGPD, art. 7º, I). As fotos ficam guardadas no sistema da ASAF, sem "
          "localização nem dados do aparelho, e não são usadas para outra finalidade nem vendidas.\n\n"
          "CRIANÇA OU ADOLESCENTE: se a pessoa da foto é criança, quem autoriza é um dos pais ou o responsável legal (LGPD, art. 14, § 1º); se é adolescente, um dos "
          "pais ou o responsável legal assina junto, e a autorização é sempre no melhor interesse da criança ou do adolescente (LGPD, art. 14).\n\n"
          "Posso retirar esta autorização a qualquer momento, sem custo, pedindo à secretaria ou pela solicitação do titular de dados no site: assim que o pedido é "
          "registrado, as fotos em que eu (ou a criança ou o adolescente) apareço saem do sistema, e saem do site na próxima publicação (o armazenamento ainda guarda "
          "uma cópia de segurança por cerca de 30 dias). A ASAF guarda o registro desta autorização (quem assinou, quando e como) por 5 anos depois que ela termina, "
          "como prova. Saiba mais na Política de Privacidade (asaf.org.br/privacidade).\n\n"
          "Nome completo de quem autoriza: ______________________________\nCPF: ______________________________\n"
          "Se autoriza por uma criança ou um adolescente, o nome dela(e) e o vínculo (mãe, pai, responsável legal): ______________________________\n"
          "Assinatura do adolescente (se for o caso): ______________________________\n"
          "Atividade: ______________________________\nLocal e data: ______________________________\nAssinatura: ______________________________"),
    # ---------------------------------------------------------------- o atendimento social (v7.1c). A versão 1 é a MARCA que quem cadastrava o beneficiário
    # fazia no painel: o sistema não guardava texto nenhum nem a exigia para registrar atendimento
    Texto("ATENDIMENTO_SOCIAL", "1", date(2026, 9, 30),
          "Consentimento LGPD registrado", reconstituido=True, caixa="Consentimento LGPD registrado", pela_equipe=True,
          observacao="Marca que quem cadastrava o beneficiário fazia no painel (com uma observação livre). O sistema não guardava o texto do consentimento, nem "
                     "quem o deu, nem o exigia para registrar atendimento."),
    Texto("ATENDIMENTO_SOCIAL", "2", date(2026, 10, 27),
          "Eu, identificado(a) abaixo, autorizo a ASAF - Associação Arca da Família a registrar, no seu sistema, os dados do atendimento social que recebo, ou que "
          "recebe a criança ou o adolescente por quem sou responsável (identificado abaixo), nos projetos da associação: o relato de cada atendimento e os "
          "encaminhamentos à rede de proteção (CRAS, escola, posto de saúde, Conselho Tutelar), que podem trazer informação de saúde e da situação da família (dado "
          "pessoal sensível; LGPD, art. 11, I). Esses registros servem só para acompanhar o atendimento e dar continuidade a ele; só a equipe do projeto os vê, e "
          "cada leitura fica registrada no sistema. Se o atendimento é da família, o relato pode falar das pessoas da casa.\n\n"
          "CRIANÇA OU ADOLESCENTE: se a pessoa atendida é criança, quem consente é um dos pais ou o responsável legal (LGPD, art. 14, § 1º); se é adolescente, um dos "
          "pais ou o responsável legal assina junto, e o consentimento é sempre no melhor interesse da criança ou do adolescente (LGPD, art. 14).\n\n"
          "Posso retirar este consentimento a qualquer momento, sem custo, pedindo à equipe do projeto, à secretaria ou pela solicitação do titular de dados no site: "
          "assim que a retirada é registrada no sistema, nenhum atendimento novo é registrado. O que já foi registrado continua guardado, visto só pela equipe do "
          "projeto, e a eliminação dele eu posso pedir pela solicitação do titular de dados (LGPD, art. 18, VI). A ASAF guarda o registro deste consentimento (quem assinou, quando e como) por 5 anos depois que ele termina, como prova. Saiba mais na Política de "
          "Privacidade (asaf.org.br/privacidade).\n\n"
          "Nome completo de quem consente: ______________________________\nCPF: ______________________________\n"
          "Se consente por uma criança ou um adolescente, o nome dela(e) e o vínculo (mãe, pai, responsável legal): ______________________________\n"
          "Assinatura do adolescente (se for o caso): ______________________________\n"
          "Projeto(s) em que é atendido(a): ______________________________\nLocal e data: ______________________________\nAssinatura: ______________________________"),
    # ---------------------------------------------------------------- conta de visitante
    Texto("VISITANTE", "1", date(2026, 10, 16),
          "O seu e-mail é usado para enviar o código, para mostrar o que está ligado a ele e para limitar os pedidos; fica guardado junto do código e da sessão pelo tempo descrito "
          "na [Política de Privacidade](/privacidade/#conta-do-visitante).", reconstituido=True),
)

_PONTOS = {p.codigo: p for p in PONTOS}
_LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")


def ponto(codigo: str) -> Ponto:
    return _PONTOS[codigo]


def versoes(codigo: str) -> list[Texto]:
    return sorted((t for t in TEXTOS if t.ponto == codigo), key=lambda t: int(t.versao))


def atual(codigo: str) -> Texto:
    return versoes(codigo)[-1]


def tipo_da_versao(t: Texto) -> str:
    return t.tipo or ponto(t.ponto).tipo


def caixa_da_versao(t: Texto) -> str:
    return t.caixa or ponto(t.ponto).caixa


def versao_atual(codigo: str) -> str:
    return atual(codigo).versao


def buscar(codigo: str, versao: str) -> Optional[Texto]:
    return next((t for t in TEXTOS if t.ponto == codigo and t.versao == versao), None)


def sem_links(texto: str) -> str:
    """O texto como a pessoa o leu, sem a marcação dos links (para o painel, o PDF e a API de leitura)."""
    return _LINK.sub(r"\1", texto)


def para_o_site() -> dict:
    """O que o site usa para mostrar o aviso (scripts/gerar_textos_de_privacidade_do_site.py grava em site/src/data/; o teste confere que é igual). Só os avisos que o
    SITE mostra: os termos de imagem são impressos pelo painel."""
    return {
        p.codigo: {"versao": atual(p.codigo).versao, "paragrafos": atual(p.codigo).texto.split("\n\n"), "caixa": p.caixa}
        for p in PONTOS if p.onde.startswith("site:")
    }


def sincronizar(db) -> list[str]:
    """Grava no banco cada versão do catálogo que ainda não está lá; NUNCA reescreve uma versão já gravada (é o texto que foi mostrado). Devolve as divergências
    (versão gravada com texto diferente do catálogo) para o registro do sistema - a suíte de testes já impede que isso chegue a um ambiente."""
    from datetime import datetime

    from sqlalchemy.exc import IntegrityError

    from app.models.privacidade import TextoDePrivacidade

    gravados = {(t.ponto, t.versao): t for t in db.query(TextoDePrivacidade).all()}
    divergencias = []
    for t in TEXTOS:
        existente = gravados.get((t.ponto, t.versao))
        if existente is None:
            db.add(TextoDePrivacidade(
                ponto=t.ponto, versao=t.versao, tipo=tipo_da_versao(t), caixa=caixa_da_versao(t), texto=t.texto, impressao=t.impressao,
                vigente_desde=datetime(t.vigente_desde.year, t.vigente_desde.month, t.vigente_desde.day), reconstituido=t.reconstituido,
                observacao=t.observacao or None,
            ))
        elif existente.impressao != t.impressao:
            divergencias.append(f"{t.ponto} versão {t.versao}")
    try:
        db.commit()
    except IntegrityError:  # outra réplica da API gravou as mesmas versões ao mesmo tempo (subida simultânea): o que ela gravou vale
        db.rollback()
    return divergencias


def _versao_do_banco(r, catalogo: Optional[Texto]) -> dict:
    return {
        "versao": r.versao, "vigente_desde": r.vigente_desde.date().isoformat(), "texto": r.texto, "texto_sem_links": sem_links(r.texto), "impressao": r.impressao,
        "reconstituido": bool(r.reconstituido), "observacao": r.observacao, "registrado_em": r.registrado_em, "tipo": r.tipo, "caixa": r.caixa,
        # o catálogo do código diverge do que foi gravado (vale o gravado: é o que foi mostrado)
        "diverge_do_codigo": catalogo is not None and catalogo.impressao != r.impressao,
        "marcada_pela_equipe": bool(catalogo and catalogo.pela_equipe),
    }


def listar(db) -> dict:
    """Cada ponto de coleta com a base legal, a atividade do inventário e TODAS as versões como estão gravadas (a mais nova primeiro)."""
    from app.models.privacidade import TextoDePrivacidade
    from app.services.inventario import ATIVIDADES, BASES_LEGAIS

    nomes = {a.codigo: a.nome for a in ATIVIDADES}
    linhas: dict[str, list] = {}
    for r in db.query(TextoDePrivacidade).all():
        linhas.setdefault(r.ponto, []).append(r)
    pontos = []
    for p in PONTOS:
        versoes_gravadas = sorted(linhas.get(p.codigo, []), key=lambda r: int(r.versao) if r.versao.isdigit() else 0, reverse=True)
        pontos.append({
            "codigo": p.codigo, "nome": p.nome, "tipo": p.tipo, "onde": p.onde, "caixa": p.caixa, "atividade": p.atividade, "atividade_nome": nomes.get(p.atividade, p.atividade),
            "bases_legais": [{"codigo": b, "texto": BASES_LEGAIS[b]} for b in p.bases_legais],
            "versao_atual": versao_atual(p.codigo),
            "versoes": [_versao_do_banco(r, buscar(p.codigo, r.versao)) for r in versoes_gravadas],
        })
    return {"pontos": pontos}


def ler(db, codigo: str, versao: str) -> Optional[dict]:
    """O texto exato de uma versão, como está gravado (para o painel reabrir o aviso que a pessoa aceitou)."""
    from app.models.privacidade import TextoDePrivacidade

    if codigo not in _PONTOS:
        return None
    r = db.query(TextoDePrivacidade).filter(TextoDePrivacidade.ponto == codigo, TextoDePrivacidade.versao == versao).first()
    if r is None:
        return None
    p = ponto(codigo)
    return {"codigo": p.codigo, "nome": p.nome, "versao_atual": versao_atual(codigo), **_versao_do_banco(r, buscar(codigo, versao))}
