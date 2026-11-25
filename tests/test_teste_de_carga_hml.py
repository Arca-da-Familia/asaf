"""O teste de carga da homologação (`scripts/teste_de_carga_hml.py`) roda de verdade, dentro do processo, contra o próprio sistema (sem rede, num banco de teste):
prova que o roteiro funciona (entra, cria o evento, manda a multidão, o grupo atrás do mesmo IP, confere) ANTES de gastar uma rodada na homologação, e que ele
reprova quando algo está errado. Também prova a trava de segurança: recusa qualquer endereço que não seja o da homologação."""
import asyncio
import importlib.util
import json
import uuid
from argparse import Namespace
from pathlib import Path

import httpx2 as httpx
import pytest

from app.main import app

CAMINHO = Path(__file__).resolve().parent.parent / "scripts" / "teste_de_carga_hml.py"


def _carregar():
    especificacao = importlib.util.spec_from_file_location("teste_de_carga_hml", CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _args(carga, **sobrescritas) -> Namespace:
    padrao = dict(
        url=carga.URL_PADRAO, pessoas=24, vagas=16, rampa=1.0, preenchimento=0.2, conexoes=50, p95_maximo=30.0, saida="",
    )
    padrao.update(sobrescritas)
    return Namespace(**padrao)


def _rodar(carga, args) -> int:
    transporte = httpx.ASGITransport(app=app)
    return asyncio.run(carga.principal(args, transporte=transporte))


SENHA_DO_PRESIDENTE_DE_TESTE = "SenhaDoPresidenteDaCarga2026"  # inventada, só deste teste


@pytest.fixture()
def presidente_de_teste(client, db, monkeypatch):
    """O presidente de teste da homologação (CPF e senha só existem aqui). Lá nenhum nível exige o segundo passo (decisão do Presidente de
    05/10/2026, só no banco `asaf_hml`) e o roteiro entra só com CPF e senha; aqui ele é uma conta com as permissões do nível Presidente num
    nível que, como lá, não exige o segundo passo. v9.6s: o administrador da sessão não faz mais esse papel, porque cadastra o segundo passo
    (o servidor o cobra, como na produção) e o login dele pede o código do aplicativo autenticador."""
    from sqlalchemy import select

    from app.models.associados import Associado
    from app.models.core import NivelAcesso, Usuario, perfil_permissao
    from app.security import hash_senha
    from tests.test_conceder_acesso import _criar_ficha

    # a ficha ANTES de abrir a escrita desta sessão: no SQLite da suíte, com a escrita aberta aqui, o servidor não consegue gravar a ficha
    id_associado, cpf = _criar_ficha(client)
    presidente = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == "Presidente").one()
    nivel = NivelAcesso(nome_nivel=f"presidente_da_hml_{uuid.uuid4().hex[:8]}", descricao="o Presidente da homologação", exige_mfa=False)
    db.add(nivel)
    db.flush()
    permissoes = db.execute(select(perfil_permissao.c.id_permissao).where(perfil_permissao.c.id_nivel == presidente.id_nivel)).scalars().all()
    for id_permissao in permissoes:
        db.execute(perfil_permissao.insert().values(id_nivel=nivel.id_nivel, id_permissao=id_permissao))
    usuario = Usuario(
        email=f"carga.{uuid.uuid4().hex[:8]}@teste.local", senha_hash=hash_senha(SENHA_DO_PRESIDENTE_DE_TESTE), id_nivel=nivel.id_nivel, ativo=True,
    )
    db.add(usuario)
    db.flush()
    db.get(Associado, id_associado).id_usuario = usuario.id_usuario
    db.commit()
    carga = _carregar()
    monkeypatch.setattr(carga, "cpf_do_presidente", lambda: cpf)
    monkeypatch.setenv("HML_ADMIN_SENHA", SENHA_DO_PRESIDENTE_DE_TESTE)
    return carga


def test_a_multidao_nao_estoura_as_vagas_ninguem_se_perde_e_o_mesmo_ip_e_barrado(presidente_de_teste, tmp_path, capsys):
    carga = presidente_de_teste
    saida = tmp_path / "relatorio.json"
    codigo = _rodar(carga, _args(carga, saida=str(saida)))
    texto = capsys.readouterr().out
    relatorio = json.loads(saida.read_text(encoding="utf-8"))
    assert codigo == 0, texto
    assert "RESULTADO: APROVADO" in texto
    # as 16 vagas ficam cheias e o resto (24 pessoas + o grupo do mesmo IP que coube no limite) vai para a lista de espera
    assert relatorio["confirmadas"] == 16
    assert relatorio["lista_de_espera"] == relatorio["inscricoes_distintas"] - 16
    assert relatorio["vagas_livres_na_pagina_publica"] == 0
    assert relatorio["grupo_mesmo_ip_aceitas"] == carga.LIMITE_POR_IP and relatorio["grupo_mesmo_ip_barradas"] == 10
    assert relatorio["cliques_duplos_com_duas_inscricoes"] == 0
    assert relatorio["falhas"] == []
    # a senha do presidente nunca vai para o relatório
    assert SENHA_DO_PRESIDENTE_DE_TESTE not in saida.read_text(encoding="utf-8") and SENHA_DO_PRESIDENTE_DE_TESTE not in texto


def test_com_menos_gente_que_vagas_sobram_vagas_e_a_pagina_publica_conta_certo(presidente_de_teste, tmp_path):
    carga = presidente_de_teste
    saida = tmp_path / "relatorio.json"
    # 6 pessoas + o grupo do mesmo IP (30 aceitas) ocupam 36 inscrições: com 60 vagas, sobram 24
    codigo = _rodar(carga, _args(carga, pessoas=6, vagas=60, saida=str(saida)))
    relatorio = json.loads(saida.read_text(encoding="utf-8"))
    assert codigo == 0, relatorio["falhas"]
    assert relatorio["confirmadas"] == 36 and relatorio["lista_de_espera"] == 0
    assert relatorio["vagas_livres_na_pagina_publica"] == 24


def test_reprova_quando_o_tempo_de_resposta_passa_do_combinado(presidente_de_teste, capsys):
    carga = presidente_de_teste
    codigo = _rodar(carga, _args(carga, pessoas=6, vagas=4, p95_maximo=0.0))
    assert codigo == 1
    assert "REPROVADO" in capsys.readouterr().out


def test_recusa_qualquer_endereco_que_nao_seja_o_da_homologacao(monkeypatch, capsys):
    carga = _carregar()
    monkeypatch.setenv("HML_ADMIN_SENHA", "qualquer")
    for endereco in ("https://api.asaf.org.br", "http://hml-api.asaf.org.br", "https://hml-api.asaf.org.br.mal.example", "http://localhost:8000"):
        assert asyncio.run(carga.principal(_args(carga, url=endereco))) == 2, endereco
        assert "RECUSADO" in capsys.readouterr().out


def test_sem_a_senha_do_presidente_nao_roda(monkeypatch, capsys):
    carga = _carregar()
    monkeypatch.delenv("HML_ADMIN_SENHA", raising=False)
    assert asyncio.run(carga.principal(_args(carga))) == 2
    assert "HML_ADMIN_SENHA" in capsys.readouterr().out


def test_o_gerador_de_cpf_so_faz_cpf_valido():
    from app.validadores import validar_cpf

    carga = _carregar()
    for base in (1, 600000000, 111000111, 123456789):
        assert validar_cpf(carga.cpf_valido(base)), base


def test_o_script_de_carga_so_conhece_o_endereco_da_homologacao_e_nao_imprime_a_senha():
    script = CAMINHO.read_text(encoding="utf-8")
    assert 'HOST_PERMITIDO = "hml-api.asaf.org.br"' in script and 'alvo.scheme != "https" or alvo.hostname != HOST_PERMITIDO' in script
    assert "asaf.org.br" not in script.replace("hml-api.asaf.org.br", "").replace("homologacao.example.com", "")
    # a senha entra só na chamada de login; nenhum print a mostra
    assert script.count("senha") > 0 and "print(senha" not in script and "{senha" not in script
