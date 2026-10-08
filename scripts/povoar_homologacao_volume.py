"""Enche o banco de HOMOLOGAÇÃO (teste) de dados INVENTADOS em volume, para as pessoas entrarem no painel de teste e verem o sistema "vivo":
30 novos cadastros de associados em vários status, mensalidades pagas/em aberto/vencidas, financeiro (fornecedores, despesas, doações),
assembleias com ata, projetos, eventos com inscrições e reservas de espaço. Passa pelas rotas de verdade do sistema.

    python scripts/povoar_homologacao_volume.py

Roda DEPOIS de `popular_homologacao.py` (precisa do administrador, do plano de contas, das 15 pessoas e da diretoria de teste) e depois das
rodadas do robô: ele enche o banco de teste de gente e de títulos, o que mudaria as contas que os roteiros conferem ao centavo.
Não cria nenhum documento com anexo (só um comprovante mínimo, que o sistema exige para dar baixa em despesa).

Variáveis de ambiente: DATABASE_URL (tem que ser o `asaf_hml`), JWT_SECRET, ARMAZENAMENTO_BLOB_URL.
Segurança: recusa rodar fora do banco `asaf_hml`; recusa rodar duas vezes (marca o que criou); não pede nem imprime senha nenhuma.
"""
from __future__ import annotations

import importlib.util
import os
import sys
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
_esp = importlib.util.spec_from_file_location("popular_homologacao", Path(__file__).with_name("popular_homologacao.py"))
ph = importlib.util.module_from_spec(_esp)
_esp.loader.exec_module(ph)

MARCA = "volume"  # e-mails `volume<N>@homologacao.example.com`: a marca de que este roteiro já rodou
ISO = "%Y-%m-%dT%H:%M:%S"

NOMES_NOVOS = [
    "Aline Pacheco Brandão", "Benedito Salgado Maia", "Cíntia Furtado Leal", "Davi Nogueira Peixoto", "Eliane Sampaio Vaz",
    "Fernando Queiroz Lage", "Gabriela Rangel Mota", "Hugo Valadares Neri", "Ingrid Cavalcante Dória", "Jonas Albuquerque Sena",
    "Kátia Mendonça Brito", "Lucas Aragão Pimentel", "Mônica Siqueira Duarte", "Natan Figueiredo Costa", "Odete Lacerda Fontes",
    "Paulo Magalhães Rios", "Quitéria Bezerra Alves", "Rafael Tavares Moreira", "Sílvia Cordeiro Dantas", "Tiago Medeiros Arruda",
    "Úrsula Frota Carneiro", "Valdir Pontes Esteves", "Wanda Louzada Cruz", "Xavier Montenegro Lins", "Yara Guimarães Sobral",
    "Zeca Andrade Barros", "Adriana Vilela Peres", "Breno Cardoso Linhares", "Camila Ventura Reis", "Diogo Salles Pinheiro",
]
CATEGORIAS = ["Efetivo", "Efetivo", "Contribuinte", "Fundador", "Efetivo", "Contribuinte"]


def _cnpj(raiz: int) -> str:
    base = f"{raiz % 10**8:08d}9999"

    def digito(numeros: str, pesos: list[int]) -> int:
        resto = sum(int(d) * p for d, p in zip(numeros, pesos)) % 11
        return 0 if resto < 2 else 11 - resto

    d1 = digito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    d2 = digito(base + str(d1), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return f"{base}{d1}{d2}"


def povoar(client, db, escrever=print) -> dict:
    from app.models.associados import Associado
    from app.models.core import Usuario
    from app.models.financeiro import PlanoDeContas

    ok, cabecalho, Roteiro = ph._ok, ph._cabecalho, ph.Roteiro
    roteiro = Roteiro(escrever)

    admin = db.query(Usuario).join(Associado, Associado.id_usuario == Usuario.id_usuario).filter(Associado.cpf == ph.cpf_valido(111000111)).first()
    if admin is None:
        raise SystemExit("Não achei o administrador de teste: rode antes o roteiro `popular_homologacao.py`.")
    if db.query(Associado).filter(Associado.email_contato == f"{MARCA}1@{ph.SUFIXO_EMAIL}").first():
        raise SystemExit("O povoamento em volume já foi feito neste banco: para refazer, recrie o banco de teste (resetar_banco).")
    adm = cabecalho(admin)
    hoje = datetime.utcnow()

    # as pessoas da diretoria que têm login: votam nas assembleias (o sistema só deixa o próprio associado votar)
    com_login = [(a, u) for a, u in db.query(Associado, Usuario).join(Usuario, Associado.id_usuario == Usuario.id_usuario).all()]
    eleitores = [cabecalho(u) for _, u in com_login if u.id_usuario != admin.id_usuario][:5]

    # ---------------------------------------------------------------------------------------- chave Pix de teste (sem ela o Pix das cobranças não abre)
    def chave_pix():
        ok(client.put("/api/configuracoes/CHAVE_PIX", headers=adm, json={"valor": f"chave-pix-de-teste@{ph.SUFIXO_EMAIL}"}))
        return "chave Pix de teste (inventada) para o Pix Copia e Cola das cobranças"

    roteiro.area("Chave Pix de teste", chave_pix)

    # ---------------------------------------------------------------------------------------- 25 associados cadastrados direto
    ids: dict[int, int] = {}

    def associados():
        for i, nome in enumerate(NOMES_NOVOS[:25]):
            corpo = {
                "nome_completo": f"{nome} de Teste", "cpf": ph.cpf_valido(333000000 + i * 7937),
                "email_contato": f"{MARCA}{i + 1}@{ph.SUFIXO_EMAIL}", "telefone_whatsapp": f"9199{i:02d}{(i * 53) % 10000:04d}"[:11],
                "categoria": CATEGORIAS[i % len(CATEGORIAS)], "data_nascimento": f"{1955 + i}-0{1 + i % 9}-2{i % 8}", "cep": "68515000",
                "logradouro": "Avenida do Teste", "numero": str(100 + i), "bairro": "Bairro de Teste", "cidade": "Parauapebas", "estado": "PA",
            }
            ids[i] = ok(client.post("/associados-master/", json=corpo, headers=adm)).json()["id_associado"]
        return f"{len(ids)} associados"

    roteiro.area("25 associados cadastrados", associados)

    # ---------------------------------------------------------------------------------------- 5 em experiência (pela filiação) e propostas
    def filiacao():
        # o Estatuto (Art. 12) pede o pedido proposto por 3 sócios aptos antes de a Diretoria aprovar: o administrador (sócio ativo) e
        # mais dois sócios com login propõem
        socios = [adm, *eleitores[:2]]
        if len(socios) < 3:
            raise SystemExit("Faltam sócios com login para propor os candidatos: rode antes o roteiro `popular_homologacao.py`.")

        def pedido(numero: int, corpo: dict) -> int:
            """O pedido pelo formulário público (rota aberta): adulto, aviso de privacidade aceito, e um IP de origem próprio (o limite por IP não atrapalha)."""
            from app.services.filiacao_publica import VERSAO_AVISO_DE_PRIVACIDADE_FILIACAO

            completo = {
                "data_nascimento": f"{1980 + numero % 15}-0{1 + numero % 9}-1{numero % 9}", "consentimento_lgpd": True,
                "versao_texto_consentimento": VERSAO_AVISO_DE_PRIVACIDADE_FILIACAO, **corpo,
            }
            return ok(client.post("/api/filiacao/propor", json=completo, headers={"X-Forwarded-For": f"198.51.100.{numero + 1}"})).json()["id_proposta"]

        def socios_propoem(proposta: int) -> None:
            for socio in socios:
                ok(client.post(f"/api/filiacao/propostas/{proposta}/propor", headers=socio, json={"decisao": "Propõe"}))

        for k in range(5):
            nome = NOMES_NOVOS[25 + k]
            proposta = pedido(k, {
                "nome_completo": f"{nome} de Teste", "cpf": ph.cpf_valido(444000000 + k * 7951),
                "email_contato": f"{MARCA}{26 + k}@{ph.SUFIXO_EMAIL}", "telefone_whatsapp": f"9198{k:02d}{(k * 71) % 10000:04d}"[:11],
            })
            socios_propoem(proposta)
            ok(client.post(f"/api/filiacao/propostas/{proposta}/conferir", headers=adm))
            ok(client.post(f"/api/filiacao/propostas/{proposta}/aprovar", headers=adm, json={"categoria": "Efetivo"}))
        pendentes = []
        for k in range(4):  # propostas que ainda esperam conferência
            pendentes.append(pedido(10 + k, {
                "nome_completo": f"Candidato Pendente {k + 1} de Teste", "cpf": ph.cpf_valido(555000000 + k * 7963),
                "email_contato": f"pendente{k + 1}@{ph.SUFIXO_EMAIL}", "telefone_whatsapp": f"9197{k:02d}{(k * 91) % 10000:04d}"[:11],
            }))
        ok(client.post(f"/api/filiacao/propostas/{pendentes[0]}/conferir", headers=adm))
        ok(client.post(f"/api/filiacao/propostas/{pendentes[1]}/recusar", headers=adm, json={"motivo": "Documentação incompleta (teste)."}))
        return "5 em experiência e 4 propostas (1 conferida, 1 recusada, 2 novas)"

    roteiro.area("Filiação: em experiência e propostas", filiacao)

    # ---------------------------------------------------------------------------------------- status: licenciados e desligados
    def situacoes():
        for i in (20, 21, 22):
            ok(client.post(f"/api/associados/{ids[i]}/licenca", headers=adm, json={
                "motivo": "SAUDE", "data_inicio": str(date.today()), "data_fim_prevista": str(date.today() + timedelta(days=60)),
            }))
        for i in (23, 24):
            ok(client.post(f"/api/associados/{ids[i]}/desligar", headers=adm, json={"motivo": "PEDIDO_VOLUNTARIO", "data_efetiva": str(date.today())}))
        return "3 licenciados e 2 desligados"

    if len(ids) == 25:
        roteiro.area("Licenças e desligamentos", situacoes)

    # ---------------------------------------------------------------------------------------- financeiro: contas, planos, mensalidades
    contas: dict[str, int] = {}

    def conta(codigo: str, descricao: str, tipo: str) -> int:
        existente = db.query(PlanoDeContas).filter(PlanoDeContas.codigo_contabil == codigo).first()
        if existente:
            return existente.id_conta
        return ok(client.post("/plano-contas/", json={"codigo_contabil": codigo, "descricao_conta": descricao, "tipo": tipo}, headers=adm)).json()["id_conta"]

    def base_financeira():
        contas["caixa"] = conta("1.01.01", "Caixa e banco (teste)", "Ativo")
        contas["mensalidade"] = conta("4.02.01", "Mensalidades (teste)", "Receita")
        contas["doacao"] = conta("4.03.01", "Doações (teste)", "Receita")
        contas["despesa"] = conta("5.02.01", "Despesas administrativas (teste)", "Despesa")
        contas["energia"] = conta("5.02.02", "Água e energia (teste)", "Despesa")
        for categoria, valor in (("Efetivo", 60), ("Contribuinte", 90), ("Fundador", 60)):
            ok(client.post("/api/planos-contribuicao/", headers=adm, json={
                "categoria": categoria, "descricao": f"Mensalidade {categoria} (teste)", "periodicidade": "Mensal", "dia_vencimento": 10,
                "cobranca_por_nucleo_familiar": False, "id_conta_contabil": contas["mensalidade"], "valor_inicial": valor,
            }))
        return "contas e 3 planos de contribuição"

    roteiro.area("Contas e planos de contribuição", base_financeira)

    comprovante = {"caminho": None}

    def com_comprovante() -> str:
        if comprovante["caminho"] is None:
            comprovante["caminho"] = ok(client.post(
                "/api/comprovantes/", headers=adm, files={"arquivo": ("comprovante-de-teste.pdf", ph.PDF_ORIGINAL, "application/pdf")},
            )).json()["comprovante"]
        return comprovante["caminho"]

    def pagar(id_titulo: int, valor: float, forma: str = "Pix") -> None:
        ok(client.post("/baixar-titulo/", headers=adm, json={
            "id_titulo": id_titulo, "valor_pago": valor, "forma_pagamento": forma,
            "id_conta_contabil_contrapartida": contas["caixa"], "comprovante": com_comprovante(),
        }))

    def titulo(tipo: str, conta_id: int, descricao: str, valor: float, vence: datetime, **extra) -> int:
        return ok(client.post("/titulos/", headers=adm, json={
            "tipo_titulo": tipo, "id_conta_contabil": conta_id, "descricao": descricao, "valor_original": valor,
            "data_vencimento": vence.strftime(ISO), **extra,
        })).json()["id_titulo"]

    def mensalidades():
        # histórico dos 3 meses anteriores: a maioria em dia (paga), alguns associados com mensalidade vencida que nunca pagaram
        pagos = vencidos = 0
        for i in range(0, 20):
            for meses_atras in (3, 2, 1):
                vence = hoje - timedelta(days=30 * meses_atras)
                id_titulo = titulo("A Receber", contas["mensalidade"], f"Mensalidade {vence:%m/%Y} (teste)", 60.0, vence, id_associado=ids[i])
                pagar(id_titulo, 60.0)
                pagos += 1
        for i in range(14, 20):  # os inadimplentes: 2 a 4 mensalidades vencidas e nunca pagas (a categoria é recalculada ao criar o título)
            for meses_atras in range(1, 3 + i % 3):
                vence = hoje - timedelta(days=30 * meses_atras + 15)
                titulo("A Receber", contas["mensalidade"], f"Mensalidade {vence:%m/%Y} (teste) - em atraso", 60.0, vence, id_associado=ids[i])
                vencidos += 1
        return f"{pagos} mensalidades pagas e {vencidos} vencidas"

    if len(ids) == 25 and contas.get("mensalidade"):
        roteiro.area("Mensalidades (histórico pago e vencidas)", mensalidades)

    def cobranca_do_mes():
        # o plano novo só tem valor a partir de hoje: o mês corrente (dia 1) ainda não tem valor vigente; a cobrança em lote é a do PRÓXIMO mês
        competencia = (hoje.replace(day=1) + timedelta(days=32)).strftime("%Y-%m")
        ok(client.post("/api/contribuicoes/gerar-cobrancas/", headers=adm, json={"competencia": competencia, "confirmar": True}))
        return f"cobrança em lote da competência {competencia}"

    if contas.get("mensalidade"):
        roteiro.area("Cobrança em lote do próximo mês", cobranca_do_mes)

    # ---------------------------------------------------------------------------------------- fornecedores, despesas e doações
    def despesas():
        fornecedores = []
        for k, (razao, categoria) in enumerate((("Gráfica Rápida de Teste LTDA", "Gráfica"), ("Mercadinho do Bairro de Teste ME", "Alimentação"),
                                              ("Companhia de Energia de Teste", "Utilidades"))):
            fornecedores.append(ok(client.post("/fornecedores/", headers=adm, json={
                "razao_social": razao, "cnpj": _cnpj(66000000 + k * 17), "categoria_servico": categoria, "telefone": f"91 9{k}000-0{k}00"[:15],
            })).json()["id_fornecedor"])
        pagas = abertas = 0
        for k, (descricao, valor, conta_id) in enumerate((
            ("Impressão de convites (teste)", 380.0, contas["despesa"]), ("Lanches da assembleia (teste)", 640.0, contas["despesa"]),
            ("Conta de energia (teste)", 410.0, contas["energia"]), ("Material de limpeza (teste)", 215.5, contas["despesa"]),
            ("Conta de água (teste)", 98.7, contas["energia"]), ("Banner da campanha (teste)", 150.0, contas["despesa"]),
        )):
            vence = hoje + timedelta(days=(k - 3) * 9)
            id_titulo = titulo("A Pagar", conta_id, descricao, valor, vence, id_fornecedor=fornecedores[k % 3])
            if k < 3:
                pagar(id_titulo, valor, "Transferência")
                pagas += 1
            else:
                abertas += 1
        return f"3 fornecedores, {pagas} despesas pagas e {abertas} em aberto"

    if contas.get("despesa"):
        roteiro.area("Fornecedores e despesas", despesas)

    def doacoes():
        campanha = ok(client.post("/api/campanhas-arrecadacao/", headers=adm, json={
            "titulo": "Natal solidário (teste)", "descricao": "Campanha inventada para conferir as telas.", "meta_valor": 5000,
        })).json()["id_campanha"]
        for nome, valor, extra in (("Doador Um de Teste", 150, {}), ("Doadora Dois de Teste", 300, {"recorrente": True}), ("Quem preferiu não se identificar", 75, {"anonima": True})):
            ok(client.post("/api/doacoes/", headers=adm, json={
                "nome_doador": nome, "tipo_doacao": "Monetaria", "valor": valor, "id_campanha": campanha,
                "id_conta_contabil": contas["doacao"], "id_conta_contabil_caixa": contas["caixa"], **extra,
            }))
        ok(client.post("/api/doacoes/", headers=adm, json={
            "nome_doador": "Doador de Bens de Teste", "tipo_doacao": "Bens", "valor": 400, "descricao_bem": "Cadeiras usadas (teste)",
            "id_campanha": campanha, "id_conta_contabil": contas["doacao"],
        }))
        return "1 campanha, 3 doações em dinheiro (uma anônima) e 1 em bens"

    if contas.get("doacao"):
        roteiro.area("Campanha e doações", doacoes)

    # ---------------------------------------------------------------------------------------- assembleias com ata
    def assembleia(pauta: str, assinar: bool) -> int:
        id_a = ok(client.post("/api/assembleias/", headers=adm, json={
            "tipo": "Ordinária", "pauta": pauta, "data_hora_convocacao": (hoje + timedelta(days=20)).strftime(ISO), "local_fisico": "Sede de teste",
        })).json()["id_assembleia"]
        ok(client.post(f"/api/assembleias/{id_a}/convocar", headers=adm))
        ok(client.post(f"/api/assembleias/{id_a}/abrir-sessao", headers=adm))
        habilitados = ok(client.get(f"/api/assembleias/{id_a}/habilitados?apenas_habilitados=true", headers=adm)).json()
        for h in habilitados:
            client.post(f"/api/assembleias/{id_a}/credenciamentos", headers=adm, json={"modalidade": "Presencial", "id_associado": h["id_associado"]})
        id_item = ok(client.post(f"/api/assembleias/{id_a}/itens-pauta", headers=adm, json={"titulo": pauta})).json()["id_item"]
        id_votacao = ok(client.post(f"/api/itens-pauta/{id_item}/votacoes", headers=adm, json={
            "titulo": pauta, "tipo": "Aberta/Nominal", "escrutinio": "Maioria simples", "opcoes": ["Sim", "Não"],
        })).json()["id_votacao"]
        for n, cab in enumerate(eleitores):
            client.post(f"/api/votacoes/{id_votacao}/votar", headers=cab, json={"opcao": "Sim" if n % 4 else "Não"})
        ok(client.post(f"/api/votacoes/{id_votacao}/encerrar", headers=adm))
        ok(client.post(f"/api/assembleias/{id_a}/ocorrencias", headers=adm, json={"descricao": "Sessão sem incidentes (ata de teste)."}))
        id_ata = ok(client.post(f"/api/assembleias/{id_a}/ata", headers=adm)).json()["id_ata"]
        if assinar:
            ok(client.post(f"/api/atas/{id_ata}/assinar", headers=adm))
        return id_ata

    def atas():
        assembleia("Aprovação das contas de teste do exercício", assinar=True)
        assembleia("Plano de atividades de teste para o próximo ano", assinar=False)
        return "2 assembleias com ata (uma assinada, uma em rascunho)"

    roteiro.area("Assembleias e atas", atas)

    # ---------------------------------------------------------------------------------------- projetos, eventos, reservas
    def projetos_e_eventos():
        criados = []
        for nome, publico, foco in (("Horta comunitária de teste", "Pública", "Meio ambiente"), ("Reforço escolar de teste", "Pública", "Educação"),
                                    ("Mutirão de saúde de teste", "Interna", "Saúde")):
            id_projeto = ok(client.post("/projetos/", headers=adm, json={
                "nome_projeto": nome, "tipo_foco": foco, "necessita_alvara_bombeiros": False, "visibilidade": publico,
                "data_inicio": (hoje - timedelta(days=60)).strftime(ISO), "data_fim_prevista": (hoje + timedelta(days=200)).strftime(ISO),
                "descricao": "Projeto inventado para conferir as telas, sem dado de pessoa real.", "publico_alvo": "Famílias do bairro de teste",
            })).json()["id_projeto"]
            ok(client.post(f"/api/projetos/{id_projeto}/cronograma", headers=adm, json={
                "tipo": "Marco", "titulo": "Primeiro encontro (teste)", "prazo": (hoje + timedelta(days=20)).strftime(ISO),
            }))
            criados.append(id_projeto)
        total = 0
        for k, titulo_evento in enumerate(("Oficina de teste da horta", "Palestra de teste sobre educação", "Feira de saúde de teste")):
            id_evento = ok(client.post("/api/eventos/", headers=adm, json={
                "titulo": titulo_evento, "categoria": "PALESTRA", "visibilidade": "Pública", "vagas": 12, "id_projeto": criados[k],
                "data_hora_inicio": (hoje + timedelta(days=10 + 7 * k)).replace(hour=14, minute=0, second=0, microsecond=0).strftime(ISO),
                "data_hora_fim": (hoje + timedelta(days=10 + 7 * k)).replace(hour=17, minute=0, second=0, microsecond=0).strftime(ISO),
            })).json()["id_evento"]
            for p in range(8 + k * 2):  # 8, 10 e 12 inscrições: a última lota o evento
                cpf = ph.cpf_valido(777000000 + k * 1000 + p * 31)
                client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", headers={"X-Forwarded-For": f"203.0.113.{uuid.uuid4().hex}"}, json={
                    "nome_completo": f"Participante {p + 1} do evento {k + 1} de Teste", "cpf": cpf, "email": f"participante{k}{p}@{ph.SUFIXO_EMAIL}",
                    "telefone": f"9196{k}{p:02d}{(p * 13) % 1000:03d}"[:11], "consentimento_lgpd": True, "versao_texto_consentimento": "1",
                })
                total += 1
        return f"3 projetos com cronograma e 3 eventos com {total} inscrições"

    roteiro.area("Projetos e eventos", projetos_e_eventos)

    def espaco_e_reservas():
        id_espaco = ok(client.post("/api/espacos/", headers=adm, json={"nome": "Salão de reuniões de teste", "tipo": "SALAO", "capacidade": 60})).json()["id_espaco"]
        for d in (3, 5, 9):
            inicio = (hoje + timedelta(days=d)).replace(hour=15, minute=0, second=0, microsecond=0)
            ok(client.post("/api/reservas-espaco/", headers=adm, json={
                "id_espaco": id_espaco, "id_associado_solicitante": ids[d],
                "data_hora_inicio": inicio.strftime(ISO), "data_hora_fim": (inicio + timedelta(hours=2)).strftime(ISO), "finalidade": f"Reunião de teste {d}",
            }))
        return "1 espaço com 3 reservas"

    if len(ids) == 25:
        roteiro.area("Espaço e reservas", espaco_e_reservas)

    escrever(f"\nFeito: {len(roteiro.feito)} áreas; falhas: {len(roteiro.falhas)}")
    return {"feito": roteiro.feito, "falhas": roteiro.falhas}


def main() -> int:
    url = os.environ.get("DATABASE_URL", "")
    if f"/{ph.BANCO_HML}" not in url:
        raise SystemExit(f"RECUSADO: DATABASE_URL não aponta para o banco de teste ('{ph.BANCO_HML}').")
    os.environ.setdefault("RUN_DB_MIGRATION", "false")
    sys.path.insert(0, str(RAIZ))
    from fastapi.testclient import TestClient

    from app.database import SessaoLocal
    from app.main import app

    with SessaoLocal() as db:
        if ph._nome_do_banco(db) != ph.BANCO_HML:
            raise SystemExit(f"RECUSADO: este roteiro só roda no banco de teste ('{ph.BANCO_HML}').")
        with TestClient(app) as client:
            resultado = povoar(client, db)
    return 1 if resultado["falhas"] else 0


if __name__ == "__main__":
    sys.exit(main())
