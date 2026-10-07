"""v5.4c — a trava mecânica do item 10 do checklist dos pontos de revisão ("toda funcionalidade do servidor feita para uso humano tem uma TELA
real no painel"). Motivo (achado AO VIVO na conferência da homologação, 2026-10-05): a v1.2 (propostas de filiação) e a v1.4 (licença,
desligamento, readmissão, histórico, anonimização) estavam marcadas como concluídas com o servidor testado e NENHUMA tela; só apareceu
quando o robô tentou usar o sistema. O item 10 existia desde 2026-09-15 e dependia de alguém lembrar de conferir.

Aqui a conferência é automática: toda rota que não é pública de propósito precisa ser chamada por algum código do painel. As que ainda
não são estão listadas ABAIXO, cada uma com a versão do plano que vai construir a tela (`PLANO_PROJETO.md`, v5.4c a v5.4g). A lista só pode
ENCOLHER: rota nova sem tela reprova (ou ganha tela, ou é registrada aqui com a versão que a resolve), e rota que ganhou tela precisa sair
da lista (senão a lista apodrece).

O critério é conservador (a rota inteira, ou o último trecho dela como texto, aparece no código do painel): pode deixar passar uma rota
chamada só por coincidência de nome, nunca acusa uma rota que a tela realmente usa."""
import os
import re
from pathlib import Path

from app.main import app

RAIZ = Path(__file__).resolve().parent.parent
PAINEL_SRC = RAIZ / "painel" / "src"

# Públicas de propósito (site, links, login) ou de operação interna que não é tela: não precisam de tela do painel.
ISENTAS = (
    "/api/publico", "/api/filiacao/propor", "/auth/bootstrap-admin", "/carteirinha/verificar", "/certificado/verificar",
    "/pesquisa-satisfacao", "/setup-cerebro/", "/openapi", "/docs", "/redoc", "/uploads", "/health",
)

# Rotas que AINDA não têm tela, e a versão do plano que vai criá-la. Só pode encolher.
SEM_TELA_CONHECIDAS = {
    # v5.4c — FASE 1 (associados, qualidade da base, pessoas)
    # legados duplicados (o painel usa `listarAssociados` e `/auth/perfil`): a decisão é REMOVER, não criar tela; ainda usados por testes antigos
    "/api/meu-perfil/{id_associado}": "v5.4c",
    # v5.4f — FASE 4 (projetos, reserva, eventos)
    "/api/inscricoes/{id_inscricao}/cobranca": "v5.4f",
    "/api/presencas/entrada": "v5.4f",
}


def _fonte_do_painel() -> str:
    partes = []
    for pasta, _, arquivos in os.walk(PAINEL_SRC):
        for nome in arquivos:
            if nome.endswith((".ts", ".tsx")) and ".test." not in nome:
                partes.append((Path(pasta) / nome).read_text(encoding="utf-8"))
    return "\n".join(partes)


def _padrao(caminho: str) -> re.Pattern:
    """A rota inteira como expressão: o trecho fixo literal e cada {parametro} vira um ${...} ou um valor qualquer sem barra."""
    partes = re.split(r"(\{[^}]+\})", caminho)
    expr = "".join(r"(?:\$\{[^}]*\}|[^/'\"`]+)" if p.startswith("{") else re.escape(p) for p in partes)
    return re.compile(expr)


def _rotas_sem_tela() -> set[str]:
    fonte = _fonte_do_painel()
    sem_tela = set()
    for caminho in app.openapi()["paths"]:
        if caminho == "/" or caminho.startswith(ISENTAS):
            continue
        segmentos = [s for s in caminho.split("/") if s and not s.startswith("{")]
        ultimo = segmentos[-1] if segmentos else "/"
        literal = re.search(r"['\"`/]" + re.escape(ultimo) + r"['\"`/$]", fonte)
        if not _padrao(caminho).search(fonte) and not literal:
            sem_tela.add(caminho)
    return sem_tela


def test_toda_rota_do_servidor_tem_tela_ou_esta_registrada_com_a_versao_que_a_resolve():
    sem_tela = _rotas_sem_tela()
    novas = sorted(sem_tela - set(SEM_TELA_CONHECIDAS))
    assert not novas, (
        "Rota do servidor SEM nenhuma chamada no painel e fora da lista de pendências. Construa a tela (item 10 do checklist) ou, se for "
        f"pública/interna de propósito, acrescente a ISENTAS; se vai ficar para uma versão do plano, registre em SEM_TELA_CONHECIDAS: {novas}"
    )


def test_a_lista_de_pendencias_nao_apodrece():
    sem_tela = _rotas_sem_tela()
    resolvidas = sorted(set(SEM_TELA_CONHECIDAS) - sem_tela)
    assert not resolvidas, f"Estas rotas já têm tela (ou deixaram de existir): tire-as de SEM_TELA_CONHECIDAS: {resolvidas}"


def test_cada_pendencia_aponta_para_uma_versao_que_existe_no_plano():
    plano = (RAIZ / "PLANO_PROJETO.md").read_text(encoding="utf-8")
    for caminho, versao in SEM_TELA_CONHECIDAS.items():
        assert re.search(rf"^#### {re.escape(versao)}\b", plano, flags=re.MULTILINE), f"{caminho} aponta para {versao}, que não está no plano"
