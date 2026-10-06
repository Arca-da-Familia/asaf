"""Preenche o banco de HOMOLOGAÇÃO (teste) com dados INVENTADOS, passando pelas rotas de verdade do sistema, para dar para conferir
todas as telas e fluxos prontos sem criar nada de teste na produção.

    python scripts/popular_homologacao.py

Variáveis de ambiente (o fluxo `deploy-homologacao.yml` as monta; nada é impresso):
    DATABASE_URL        endereço do banco de TESTE (tem que ser o `asaf_hml`; qualquer outro é recusado)
    JWT_SECRET          segredo de assinatura do ambiente de teste
    ARMAZENAMENTO_BLOB_URL  armazenamento privado do ambiente de teste (fotos e documentos)
    HML_ADMIN_SENHA     senha do administrador de teste (guardada no cofre como HML-ADMIN-SENHA; o fluxo só a LÊ)
    HML_USUARIOS_JSON   senhas do Secretário e do Tesoureiro de teste, `{"secretario": "...", "tesoureiro": "..."}` (cofre: HML-USUARIOS)

O que cria (tudo marcado "de Teste", sem nenhum dado real):
  15 associados (e o administrador de teste, que também é associado); 10 mandatos (7 da Diretoria Executiva + 3 do Conselho Fiscal, Art. 19 e 24); logins para o Secretário e o Tesoureiro
  de teste (as permissões vêm do cargo); plano de contas e livro-caixa; projeto em destaque com duas edições (uma passada, com
  fotos e relatório aprovado), projeto e evento internos; Estatuto em PDF interno + texto público aprovado; uma emenda com parcelas,
  etapas, foto, movimentos classificados e publicação aprovada; assembleia convocada.

Segurança: recusa rodar fora do banco `asaf_hml`; só roda em banco SEM usuário nenhum (nunca em cima de dado existente).
Na homologação o segundo passo (MFA) fica DESLIGADO (decisão do presidente, 2026-10-05): entra-se só com CPF e senha. Só neste banco;
a produção mantém a exigência ligada.
"""
from __future__ import annotations

import io
import json
import os
import secrets
import string
import sys
from datetime import date, datetime, timedelta
from decimal import Decimal

BANCO_HML = "asaf_hml"
SUFIXO_EMAIL = "homologacao.example.com"
CATEGORIAS_DE_ASSOCIADO = ["Efetivo"]

NOMES = [
    "Ana Lúcia Ferreira", "Bruno Carvalho Lima", "Carla Menezes Souza", "Daniel Ribeiro Costa", "Elisa Barbosa Nunes",
    "Fábio Henrique Dias", "Gisele Moraes Pinto", "Heitor Almeida Rocha", "Isabela Torres Cunha", "João Pedro Teixeira",
    "Karina Duarte Melo", "Leonardo Batista Reis", "Marina Azevedo Lopes", "Nelson Fonseca Prado", "Olívia Campos Vieira",
]
# cargo -> (órgão, cargo)  — exatamente o Art. 19 (7) e o Art. 24 (3) do Estatuto
CARGOS = [
    ("DIRETORIA_EXECUTIVA", "PRESIDENTE"), ("DIRETORIA_EXECUTIVA", "VICE_PRESIDENTE"), ("DIRETORIA_EXECUTIVA", "VICE_PRESIDENTE_2"),
    ("DIRETORIA_EXECUTIVA", "SECRETARIO"), ("DIRETORIA_EXECUTIVA", "VICE_SECRETARIO"), ("DIRETORIA_EXECUTIVA", "TESOUREIRO"),
    ("DIRETORIA_EXECUTIVA", "VICE_TESOUREIRO"), ("CONSELHO_FISCAL", "CONSELHO_FISCAL"), ("CONSELHO_FISCAL", "CONSELHO_FISCAL"),
    ("CONSELHO_FISCAL", "CONSELHO_FISCAL"),
]

ESTATUTO_DE_TESTE = (
    "ESTATUTO DA ASSOCIAÇÃO (TEXTO DE TESTE)\n\nART. 1 - A associação de teste é uma entidade civil sem fins lucrativos, criada só para "
    "conferir o sistema.\nART. 2 - Este texto é inventado e não vale como documento da associação de verdade.\n\n"
    "ART. 3 - Os cargos da diretoria e do conselho fiscal seguem o estatuto de verdade."
)
RELATORIO_DE_TESTE = (
    "RELATÓRIO DA EDIÇÃO DE TESTE\n\nA edição de teste reuniu famílias do bairro em oficinas, apresentações e rodas de conversa. "
    "As atividades foram gratuitas e abertas ao público. Este relatório é inventado."
)


# ------------------------------------------------------------------------------------------------ geradores
def cpf_valido(base: int) -> str:
    """CPF com dígitos verificadores corretos a partir de um número de 9 dígitos (inventado: não é de ninguém conhecido)."""
    digitos = [int(c) for c in f"{base:09d}"]
    for tamanho in (9, 10):
        soma = sum(d * (tamanho + 1 - i) for i, d in enumerate(digitos[:tamanho]))
        digitos.append((soma * 10 % 11) % 10)
    return "".join(map(str, digitos))


def senha_aleatoria(tamanho: int = 20) -> str:
    alfabeto = string.ascii_letters + string.digits
    # a política do sistema pede senha forte: garante maiúscula, minúscula e dígito
    senha = [secrets.choice(string.ascii_uppercase), secrets.choice(string.ascii_lowercase), secrets.choice(string.digits)]
    senha += [secrets.choice(alfabeto) for _ in range(tamanho - 3)]
    secrets.SystemRandom().shuffle(senha)
    return "".join(senha)


def imagem_jpeg(rotulo: str, cor: tuple[int, int, int], tamanho: tuple[int, int] = (1200, 800)) -> bytes:
    from PIL import Image, ImageDraw

    imagem = Image.new("RGB", tamanho, cor)
    desenho = ImageDraw.Draw(imagem)
    desenho.rectangle([40, 40, tamanho[0] - 40, tamanho[1] - 40], outline=(255, 255, 255), width=8)
    desenho.text((80, tamanho[1] // 2 - 10), f"FOTO DE TESTE (inventada) - {rotulo}", fill=(255, 255, 255))
    saida = io.BytesIO()
    imagem.save(saida, format="JPEG", quality=80)
    return saida.getvalue()


PDF_ORIGINAL = b"%PDF-1.4\n% original de teste (inventado)\n"


class Roteiro:
    """Acompanha o que foi criado e o que falhou, sem derrubar o resto: cada área roda isolada."""

    def __init__(self, escrever=print):
        self.escrever, self.feito, self.falhas = escrever, [], []

    def area(self, nome: str, funcao):
        try:
            resultado = funcao()
            self.feito.append(nome)
            self.escrever(f"  + {nome}" + (f": {resultado}" if resultado else ""))
            return resultado
        except Exception as erro:  # noqa: BLE001 - uma área que falha não impede as outras
            self.falhas.append((nome, str(erro)[:240]))
            self.escrever(f"  ! {nome} FALHOU: {str(erro)[:240]}")
            return None


def _ok(resposta, *codigos):
    codigos = codigos or (200, 201)
    if resposta.status_code not in codigos:
        raise RuntimeError(f"{resposta.request.method} {resposta.request.url.path} -> {resposta.status_code}: {resposta.text[:200]}")
    return resposta


def _cabecalho(usuario) -> dict:
    from app.security import criar_access_token

    return {"Authorization": f"Bearer {criar_access_token(usuario)}"}


def popular(client, db, admin_headers: dict | None = None, admin_senha: str | None = None, escrever=print,
            senhas: dict | None = None) -> dict:
    """Roda o roteiro inteiro e devolve `{"usuarios": {...}, "feito": [...], "falhas": [...]}`. `senhas` traz a senha de cada
    papel (vêm do cofre); sem ela, uma senha aleatória é gerada e aparece só neste retorno."""
    senhas = senhas or {}
    from app.models.associados import Associado
    from app.models.core import Usuario
    from app.models.financeiro import CentroDeCusto, Exercicio, PlanoDeContas
    from app.services import contabilidade

    roteiro = Roteiro(escrever)
    contexto: dict = {"usuarios": {}}

    def administrador():
        nonlocal admin_headers
        if admin_headers is None:
            admin_cpf = cpf_valido(111000111)
            _ok(client.post("/auth/bootstrap-admin", json={
                "nome_completo": "Marta Souza de Teste (Presidente)", "cpf": admin_cpf, "email": f"presidente@{SUFIXO_EMAIL}",
                "senha": admin_senha or senha_aleatoria(),
            }))
            admin = db.query(Usuario).filter(Usuario.email == f"presidente@{SUFIXO_EMAIL}").first()
            admin_headers = _cabecalho(admin)
            contexto["usuarios"]["presidente"] = {"cpf": admin_cpf, "email": f"presidente@{SUFIXO_EMAIL}", "senha": "(a do cofre: HML-ADMIN-SENHA)"}
        return "administrador (Presidente) de teste criado" if "presidente" in contexto["usuarios"] else "administrador já existia"

    roteiro.area("Administrador de teste", administrador)
    if admin_headers is None:
        return {**contexto, "feito": roteiro.feito, "falhas": roteiro.falhas}

    # ---------------------------------------------------------------------------------------- associados
    ids_associados: list[int] = []

    def associados():
        for i, nome in enumerate(NOMES):
            cpf = cpf_valido(222000000 + i * 7919)
            corpo = {
                "nome_completo": f"{nome} de Teste", "cpf": cpf, "email_contato": f"associado{i + 1}@{SUFIXO_EMAIL}",
                "telefone_whatsapp": f"9198{i:02d}{i:02d}{(i * 37) % 10000:04d}"[:11], "categoria": CATEGORIAS_DE_ASSOCIADO[0],
                "data_nascimento": f"{1960 + i * 2}-0{1 + i % 9}-1{i % 9}", "cep": "68515000", "logradouro": "Rua das Flores de Teste",
                "numero": str(10 + i), "bairro": "Bairro de Teste", "cidade": "Parauapebas", "estado": "PA",
            }
            resposta = client.post("/associados-master/", json=corpo, headers=admin_headers)
            ids_associados.append(_ok(resposta).json()["id_associado"])
        return f"{len(ids_associados)} associados"

    roteiro.area("Associados", associados)

    # ---------------------------------------------------------------------------------------- mandatos (cargo -> permissões)
    def mandatos():
        for i, (orgao, cargo) in enumerate(CARGOS):
            _ok(client.post("/api/mandatos/", headers=admin_headers, json={
                "id_associado": ids_associados[i], "orgao_codigo": orgao, "cargo_codigo": cargo,
                "data_inicio": "2026-01-15", "ato_origem": "Ata de posse de teste (inventada)",
            }))
        return "10 mandatos (7 da Diretoria Executiva + 3 do Conselho Fiscal)"

    if ids_associados:
        roteiro.area("Mandatos da Diretoria e do Conselho Fiscal", mandatos)

    # ---------------------------------------------------------------------------------------- logins de teste (a permissão vem do cargo)
    cabecalhos: dict[str, dict] = {"presidente": admin_headers}

    # Os dois de sempre (Secretário e Tesoureiro) ganham senha aleatória se o cofre não trouxer a deles. Os EXTRAS só existem quando o cofre traz a
    # senha: servem para provar ao vivo o que depende de várias pessoas (quórum de decisão da disciplina, parecer do Conselho Fiscal) e, sem
    # senha, não há como o robô entrar com eles.
    PERSONAS_FIXAS = (("secretario", 3), ("tesoureiro", 5))
    PERSONAS_EXTRAS = (("cargo_presidente", 0), ("vice_presidente", 1), ("vice_presidente_2", 2), ("conselheiro", 7))

    def logins():
        pessoas = list(PERSONAS_FIXAS) + [(papel, i) for papel, i in PERSONAS_EXTRAS if senhas.get(papel)]
        for papel, indice in pessoas:
            senha = senhas.get(papel) or senha_aleatoria()
            email = f"{papel}@{SUFIXO_EMAIL}"
            _ok(client.post(f"/api/associados/{ids_associados[indice]}/conceder-acesso", headers=admin_headers,
                            json={"email": email, "senha_provisoria": senha}))
            usuario = db.query(Usuario).filter(Usuario.email == email).first()
            cabecalhos[papel] = _cabecalho(usuario)
            cpf = db.query(Associado).filter(Associado.id_associado == ids_associados[indice]).first().cpf
            contexto["usuarios"][papel] = {"cpf": cpf, "email": email, "senha": senha}
        return f"{len(pessoas)} usuários de teste com cargo (senhas do cofre)"

    if len(ids_associados) > 5:
        roteiro.area("Logins do Secretário e do Tesoureiro", logins)

    secretario, tesoureiro = cabecalhos.get("secretario", admin_headers), cabecalhos.get("tesoureiro", admin_headers)

    # ---------------------------------------------------------------------------------------- plano de contas e exercício
    contas: dict[str, "PlanoDeContas"] = {}

    def financeiro():
        exercicio = db.query(Exercicio).filter(Exercicio.ano == 2026).first()
        if exercicio is None:
            _ok(client.post("/api/exercicios/", json={"ano": 2026}, headers=admin_headers))
        for chave, codigo, descricao, tipo in (
            ("caixa", "1.01.01", "Caixa e banco (teste)", "Ativo"), ("receita", "4.01.01", "Repasses de emendas (teste)", "Receita"),
            ("despesa", "5.01.01", "Despesas de projetos (teste)", "Despesa"),
        ):
            conta = db.query(PlanoDeContas).filter(PlanoDeContas.codigo_contabil == codigo).first()
            if conta is None:
                conta = PlanoDeContas(codigo_contabil=codigo, descricao_conta=descricao, tipo=tipo)
                db.add(conta)
                db.commit()
            contas[chave] = conta
        return "exercício 2026 e plano de contas de teste"

    roteiro.area("Exercício contábil e plano de contas", financeiro)

    # ---------------------------------------------------------------------------------------- projetos, eventos, fotos, relatórios
    ids: dict[str, int] = {}

    def projetos_e_eventos():
        agora = datetime.utcnow()
        fmt = "%Y-%m-%dT%H:%M:%S"
        projeto = _ok(client.post("/projetos/", headers=admin_headers, json={
            "nome_projeto": "Projeto Principal de Teste", "tipo_foco": "Social", "necessita_alvara_bombeiros": False,
            "data_inicio": (agora - timedelta(days=400)).strftime(fmt), "data_fim_prevista": (agora + timedelta(days=400)).strftime(fmt),
            "descricao": "Programa de encontros com as famílias do bairro. Texto inventado para conferir a página do projeto.",
            "publico_alvo": "Famílias do bairro de teste", "visibilidade": "Pública", "destaque_no_site": True,
        })).json()["id_projeto"]
        ids["projeto"] = projeto
        interno = _ok(client.post("/projetos/", headers=admin_headers, json={
            "nome_projeto": "Projeto Interno de Teste", "tipo_foco": "Social", "necessita_alvara_bombeiros": False,
            "data_inicio": agora.strftime(fmt), "data_fim_prevista": (agora + timedelta(days=90)).strftime(fmt),
            "descricao": "Projeto só da associação: nunca aparece no site.", "visibilidade": "Interna",
        })).json()["id_projeto"]
        passada = _ok(client.post("/api/eventos/", headers=admin_headers, json={
            "titulo": "Encontro de Teste 2025", "descricao": "Primeira edição do encontro de teste (inventada).", "categoria": "PALESTRA",
            "data_hora_inicio": (agora - timedelta(days=300)).strftime(fmt), "data_hora_fim": (agora - timedelta(days=300) + timedelta(hours=4)).strftime(fmt),
            "endereco_avulso": "Salão de teste, Parauapebas", "visibilidade": "Pública", "id_projeto": projeto,
        })).json()["id_evento"]
        futura = _ok(client.post(f"/api/eventos/{passada}/nova-edicao", headers=admin_headers, json={
            "titulo": "Encontro de Teste 2026", "data_hora_inicio": (agora + timedelta(days=25)).strftime(fmt),
            "data_hora_fim": (agora + timedelta(days=25, hours=4)).strftime(fmt),
        })).json()["id_evento"]
        _ok(client.post(f"/api/eventos/{futura}/sessoes", headers=admin_headers, json={
            "titulo": "Abertura (teste)", "descricao": "Boas-vindas e apresentação das atividades.",
            "data_hora_inicio": (agora + timedelta(days=25)).strftime(fmt),
        }))
        interna = _ok(client.post("/api/eventos/", headers=admin_headers, json={
            "titulo": "Reunião Interna de Teste", "categoria": "PALESTRA", "data_hora_inicio": (agora + timedelta(days=5)).strftime(fmt),
            "visibilidade": "Interna", "id_projeto": interno,
        })).json()["id_evento"]
        ids.update({"passada": passada, "futura": futura, "interna": interna})
        for n, cor in enumerate(((20, 90, 60), (200, 120, 20), (40, 80, 160)), start=1):
            _ok(client.post(f"/api/eventos/{passada}/fotos", headers=admin_headers,
                            data={"alt": f"Foto de teste {n}: cena inventada de uma atividade do encontro, sem pessoas reais", "autorizacao_imagem": "true"},
                            files={"arquivo": (f"foto{n}.jpg", imagem_jpeg(f"encontro 2025, foto {n}", cor), "image/jpeg")}))
        return "projeto em destaque, projeto interno, 3 eventos, programação e 3 fotos com autorização"

    roteiro.area("Projetos, eventos e fotos", projetos_e_eventos)

    # ---------------------------------------------------------------------------------------- documentos (preparo por um, aprovação por outro)
    def publicar_documento(titulo, tipo, texto, **vinculo):
        dados = {"tipo": tipo, "titulo": titulo, "classificacao": "Interna", "publicar_no_site": "true",
                 **{k: str(v) for k, v in vinculo.items()}}
        id_documento = _ok(client.post("/api/documentos", headers=secretario, data=dados,
                                       files={"arquivo": ("original-de-teste.pdf", PDF_ORIGINAL, "application/pdf")})).json()["id_documento"]
        _ok(client.post(f"/api/documentos/{id_documento}/versao-publica-texto", headers=secretario, json={"texto": texto}))
        _ok(client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=secretario))
        _ok(client.post(f"/api/documentos/{id_documento}/aprovar", headers=admin_headers))
        return id_documento

    def documentos():
        publicar_documento("Estatuto (texto de teste)", "ESTATUTO", ESTATUTO_DE_TESTE)
        if "passada" in ids:
            publicar_documento("Relatório do Encontro de Teste 2025", "RELATORIO_EVENTO", RELATORIO_DE_TESTE,
                               vinculo_tipo="evento", vinculo_id=ids["passada"])
        return "Estatuto em texto e relatório do evento, aprovados por outra pessoa"

    roteiro.area("Documentos aprovados", documentos)

    # ---------------------------------------------------------------------------------------- uma emenda completa
    def emenda():
        gestor = tesoureiro
        parceria = _ok(client.post("/api/parcerias", headers=gestor, json={
            "tipo": "EMENDA", "ano": 2026, "titulo": "Emenda de Teste - Oficinas de música",
            "objeto": "Oficinas de música e reforço escolar para crianças do bairro de teste (texto inventado).",
            "esfera": "Municipal", "orgao_concedente": "Secretaria de Teste", "numero_emenda": "123/2026", "proponente": "Vereador de Teste",
            "valor_total": "50000.00",
        })).json()
        id_parceria = parceria["id_parceria"]
        for numero, valor in ((1, "25000.00"), (2, "25000.00")):
            _ok(client.post(f"/api/parcerias/{id_parceria}/parcelas", headers=gestor, json={"numero": numero, "valor_previsto": valor}))
        etapa = _ok(client.post(f"/api/parcerias/{id_parceria}/etapas", headers=gestor, json={
            "titulo": "Oficina de percussão (teste)", "descricao": "Aulas de percussão para crianças, inventadas para o teste.",
            "data_realizacao": (date.today() - timedelta(days=30)).isoformat(), "local": "Quadra de teste", "publico_atendido": 40,
        })).json()["etapas"][-1]["id_etapa"]
        _ok(client.post(f"/api/parcerias/{id_parceria}/etapas/{etapa}/fotos", headers=gestor,
                        data={"alt": "Foto de teste: cena inventada de uma oficina de percussão, sem pessoas reais", "autorizacao_imagem": "true"},
                        files={"arquivo": ("oficina.jpg", imagem_jpeg("oficina de percussão", (120, 60, 140)), "image/jpeg")}))
        # livro-caixa: um recebimento e um pagamento no centro de custo exclusivo da emenda
        exercicio = db.query(Exercicio).filter(Exercicio.ano == 2026).first()
        centro = parceria["id_centro_custo"]
        contabilidade.criar_lancamento(db, exercicio=exercicio, historico="Repasse da 1ª parcela (teste)", tipo_origem="HOMOLOGACAO", partidas=[
            (contas["caixa"].id_conta, contabilidade.DEBITO, Decimal("25000"), centro), (contas["receita"].id_conta, contabilidade.CREDITO, Decimal("25000"), centro)])
        contabilidade.criar_lancamento(db, exercicio=exercicio, historico="Pagamento de instrumentos (teste)", tipo_origem="HOMOLOGACAO", partidas=[
            (contas["despesa"].id_conta, contabilidade.DEBITO, Decimal("4200"), centro), (contas["caixa"].id_conta, contabilidade.CREDITO, Decimal("4200"), centro)])
        db.commit()
        pendentes = _ok(client.get(f"/api/parcerias/{id_parceria}", headers=gestor)).json()["lancamentos_sem_classificacao"]
        for p in pendentes:
            corpo = {"id_lancamento": p["id_lancamento"], "natureza": p["natureza"],
                     "descricao_publica": "Repasse da 1ª parcela" if p["natureza"] != "PAGAMENTO" else "Compra de instrumentos musicais"}
            if p["natureza"] == "PAGAMENTO":
                corpo["categoria"] = "OUTRO"
            _ok(client.post(f"/api/parcerias/{id_parceria}/lancamentos", headers=gestor, json=corpo))
        _ok(client.post(f"/api/parcerias/{id_parceria}/enviar-revisao", headers=gestor))
        _ok(client.post(f"/api/parcerias/{id_parceria}/aprovar", headers=admin_headers))
        return "emenda de R$ 50.000 com 2 parcelas, etapa com foto, movimentos classificados e publicação aprovada"

    if "tesoureiro" in contexto["usuarios"] and contas:
        roteiro.area("Emenda parlamentar completa", emenda)

    # ---------------------------------------------------------------------------------------- assembleia convocada
    def assembleia():
        id_assembleia = _ok(client.post("/api/assembleias/", headers=admin_headers, json={
            "tipo": "Ordinária", "pauta": "Prestação de contas do exercício (assembleia de teste)",
            "data_hora_convocacao": (datetime.utcnow() + timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%S"),
            "local_fisico": "Sede de teste, Parauapebas",
        })).json()["id_assembleia"]
        _ok(client.post(f"/api/assembleias/{id_assembleia}/convocar", headers=admin_headers))
        return "assembleia ordinária convocada, com edital"

    roteiro.area("Assembleia convocada", assembleia)

    return {**contexto, "feito": roteiro.feito, "falhas": roteiro.falhas}


# ------------------------------------------------------------------------------------------------ execução
def _exigir_banco_de_teste(db) -> None:
    from sqlalchemy import text

    nome = db.execute(text("SELECT current_database()")).scalar()
    if nome != BANCO_HML:
        raise SystemExit(f"RECUSADO: este roteiro só roda no banco de teste ('{BANCO_HML}'), não em '{nome}'.")
    from app.models.core import Usuario

    if db.query(Usuario).count() > 0:
        raise SystemExit("O banco de teste já tem usuários: não vou criar por cima. Para recomeçar, rode o fluxo com 'resetar_banco'.")


def _nome_do_banco(db) -> str:
    from sqlalchemy import text

    return db.execute(text("SELECT current_database()")).scalar()


def desligar_segundo_passo_do_ambiente_de_teste(db) -> int:
    """Decisão do presidente (2026-10-05, dita no chat): na homologação NÃO há verificação em dois passos. O segundo passo já é
    provado em produção e pela suíte automática; aqui o teste (do robô e das pessoas) tem que entrar só com CPF e senha. Só mexe no
    banco de teste: o nome do banco é conferido ANTES de qualquer escrita. A produção continua com a exigência ligada
    (DECISOES_CONGELADAS §3.1): este roteiro recusa qualquer banco que não seja o `asaf_hml`, então não tem como alcançá-la."""
    nome = _nome_do_banco(db)
    if nome != BANCO_HML:
        raise SystemExit(f"RECUSADO: só o banco de teste ('{BANCO_HML}') perde a exigência do segundo passo, não '{nome}'.")
    from app.models.core import NivelAcesso

    afetados = db.query(NivelAcesso).filter(NivelAcesso.exige_mfa.is_(True)).update({"exige_mfa": False}, synchronize_session=False)
    db.commit()
    return afetados


def main() -> int:
    url = os.environ.get("DATABASE_URL", "")
    if f"/{BANCO_HML}" not in url:
        raise SystemExit(f"RECUSADO: DATABASE_URL não aponta para o banco de teste ('{BANCO_HML}').")
    os.environ.setdefault("RUN_DB_MIGRATION", "false")
    # `python scripts/popular_homologacao.py` põe só a pasta `scripts/` no caminho dos módulos: o pacote `app` é da raiz do repositório
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from fastapi.testclient import TestClient

    from app.database import SessaoLocal
    from app.main import app

    with SessaoLocal() as db:
        _exigir_banco_de_teste(db)
        with TestClient(app) as client:
            resultado = popular(client, db, admin_senha=os.environ.get("HML_ADMIN_SENHA"),
                                senhas=json.loads(os.environ.get("HML_USUARIOS_JSON") or "{}"))
            print(f"  + Segundo passo desligado só no banco de teste: {desligar_segundo_passo_do_ambiente_de_teste(db)} níveis")
    print(f"\nFeito: {len(resultado['feito'])} áreas; falhas: {len(resultado['falhas'])}")
    return 1 if resultado["falhas"] else 0


if __name__ == "__main__":
    sys.exit(main())
