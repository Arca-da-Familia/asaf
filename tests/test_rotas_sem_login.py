"""v5.4c — achado AO VIVO ao varrer a API de teste sem login (2026-10-05): rotas antigas do protótipo mexiam em dado de associado SEM exigir
login — corrigir telefone, e-mail e endereço de QUALQUER associado (`PUT /api/meu-perfil/{id}`), listar todos os associados, gerar uma
carteirinha VÁLIDA de qualquer um, ler e criar vínculos de família, e cadastrar associado direto — tudo só com o número do associado, que é
sequencial. Estavam em produção.

Este arquivo (1) varre TODAS as rotas sem login e exige que as abertas sejam exatamente a lista das públicas de propósito — rota nova
aberta por engano reprova aqui — e (2) prova, rota por rota, que as fechadas recusam anônimo e estranho e aceitam o dono e quem tem a permissão."""
import re
from datetime import date, timedelta

import pytest

from app.main import app
from app.models.core import NivelAcesso, Usuario
from app.models.associados import Associado
from app.models.pessoas import Pessoa
from app.security import criar_access_token, hash_senha
from tests.apoio_auth import cabecalho_admin

# Públicas DE PROPÓSITO: site (vitrine e Transparência), formulários que o público preenche, login e as verificações por link/QR.
ABERTAS_DE_PROPOSITO = {
    ("GET", "/"),
    ("GET", "/api/cep/{cep}"),
    ("GET", "/api/espacos/{id_espaco}/disponibilidade"),  # agenda do espaço sem dizer quem reservou (testado em test_espacos)
    ("POST", "/api/filiacao/propor"),  # a porta pública da filiação (o formulário do site)
    ("GET", "/api/opcoes/{tipo_lista}"),  # opções de listas (categoria, estado civil...) para os formulários
    ("POST", "/auth/bootstrap-admin"),  # só funciona num sistema sem nenhum usuário (testado em test_auth)
    ("POST", "/auth/login"),
    ("POST", "/auth/login/mfa"),
    ("POST", "/auth/logout"),
    ("POST", "/auth/webauthn/login/concluir"),
    ("POST", "/auth/webauthn/login/iniciar"),
    ("GET", "/carteirinha/verificar/{token}"),  # o que a portaria escaneia (só nome, foto e validade)
    ("GET", "/certificado/verificar/{codigo}"),
    ("GET", "/pesquisa-satisfacao/{token}"),  # link recebido por quem participou do evento
    ("POST", "/pesquisa-satisfacao/{token}/responder"),
}
PREFIXOS_PUBLICOS = ("/api/publico/",)


def test_so_as_rotas_publicas_de_proposito_respondem_sem_login(client):
    esquema = app.openapi()
    abertas, vistas = set(), set()
    for caminho, metodos in esquema["paths"].items():
        url = re.sub(r"\{[^}]+\}", "1", caminho)
        for metodo in metodos:
            if metodo.upper() not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
                continue
            vistas.add((metodo.upper(), caminho))
            r = client.request(metodo.upper(), url, json={} if metodo != "get" else None, follow_redirects=False)
            if r.status_code not in (401, 403):
                abertas.add((metodo.upper(), caminho))
    inesperadas = {a for a in abertas if a not in ABERTAS_DE_PROPOSITO and not a[1].startswith(PREFIXOS_PUBLICOS)}
    assert not inesperadas, (
        "Rota que NÃO exige login e não está na lista das públicas de propósito (feche-a com Depends(get_current_user) ou "
        f"exigir_permissao; se é pública de verdade, acrescente aqui com o motivo): {sorted(inesperadas)}"
    )
    # a lista não pode apodrecer: toda rota listada como pública tem que existir de fato
    sumidas = {a for a in ABERTAS_DE_PROPOSITO if a not in vistas}
    assert not sumidas, f"rota listada como pública que não existe mais: {sorted(sumidas)}"


# ------------------------------------------------------------------------------------------------ rota por rota
def _associado_com_login(db, nome: str) -> tuple[Associado, dict]:
    nivel = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == "Associado").first()
    pessoa = Pessoa(nome_completo=nome)
    db.add(pessoa)
    db.flush()
    usuario = Usuario(email=f"{nome.lower().replace(' ', '.')}@teste.local", senha_hash=hash_senha("SenhaForte123456"), id_nivel=nivel.id_nivel, ativo=True)
    db.add(usuario)
    db.flush()
    associado = Associado(id_pessoa=pessoa.id_pessoa, id_usuario=usuario.id_usuario)
    db.add(associado)
    db.commit()
    db.refresh(associado)
    return associado, {"Authorization": f"Bearer {criar_access_token(usuario)}"}


PERFIL = {
    "email_contato": "novo.perfil@exemplo.com.br", "telefone_whatsapp": "11977776666", "logradouro": "Rua Nova", "numero": "9",
    "bairro": "Centro", "cidade": "Belém", "estado": "PA",
}


def test_meu_perfil_so_o_dono_ou_quem_tem_permissao_altera_e_fica_na_auditoria(client, auth_headers, db):
    dona, como_dona = _associado_com_login(db, "Dona Do Perfil Aberto")
    _, como_estranho = _associado_com_login(db, "Estranho Do Perfil Aberto")
    url = f"/api/meu-perfil/{dona.id_associado}"

    assert client.put(url, json=PERFIL).status_code == 401, "sem login: recusado (antes qualquer um trocava e-mail e endereço de qualquer associado)"
    assert client.put(url, json=PERFIL, headers=como_estranho).status_code == 403, "outro associado: recusado"
    assert client.put(url, json=PERFIL, headers=como_dona).status_code == 200
    assert client.put(url, json={**PERFIL, "email_contato": "da.diretoria@exemplo.com.br"}, headers=auth_headers).status_code == 200

    from app.models.core import AuditLog

    db.expire_all()
    assert db.query(Associado).filter(Associado.id_associado == dona.id_associado).first().email_contato == "da.diretoria@exemplo.com.br"
    registros = db.query(AuditLog).filter(AuditLog.acao == "UPDATE_PERFIL", AuditLog.id_registro_afetado == dona.id_associado).count()
    assert registros == 2, "cada alteração (a da dona e a da diretoria) deixa registro de quem fez"


@pytest.mark.parametrize("rota", ["carteirinha", "completude", "categoria-calculada"])
def test_ficha_do_associado_so_do_dono_ou_de_quem_tem_permissao(client, auth_headers, db, rota):
    dono, como_dono = _associado_com_login(db, f"Dono Ficha {rota}")
    _, como_estranho = _associado_com_login(db, f"Estranho Ficha {rota}")
    url = f"/api/associados/{dono.id_associado}/{rota}"

    assert client.get(url).status_code == 401
    assert client.get(url, headers=como_estranho).status_code == 403
    assert client.get(url, headers=como_dono).status_code == 200
    assert client.get(url, headers=auth_headers).status_code == 200


def test_carteirinha_gerada_pelo_dono_continua_verificavel_pela_portaria(client, db):
    """A rota que a portaria escaneia segue pública; o que fechou foi GERAR carteirinha de qualquer um."""
    dono, como_dono = _associado_com_login(db, "Dono Da Carteirinha Verificavel")
    from app.models.pessoas import Papel

    db.add(Papel(id_pessoa=dono.id_pessoa, tipo_papel="associado"))
    db.commit()
    token = client.get(f"/api/associados/{dono.id_associado}/carteirinha", headers=como_dono).json()["token"]
    r = client.get(f"/carteirinha/verificar/{token}")
    assert r.status_code == 200 and r.json()["valido"] is True
    assert "cpf" not in r.json()


def test_lista_e_dependentes_antigos_exigem_a_permissao_de_associados(client, auth_headers, db):
    dono, como_dono = _associado_com_login(db, "Dono Dos Dependentes Antigos")
    for rota, metodo, corpo in (
        ("/api/associados/busca-simples", "get", None),
        (f"/api/associados/{dono.id_associado}/dependentes", "get", None),
        (f"/api/associados/{dono.id_associado}/dependentes", "post", {"id_associado_vinculado": dono.id_associado + 1, "grau_parentesco": "FILHO"}),
    ):
        assert client.request(metodo, rota, json=corpo).status_code == 401, rota
        assert client.request(metodo, rota, json=corpo, headers=como_dono).status_code == 403, f"{rota}: associado comum não lista nem liga famílias"
    assert client.get("/api/associados/busca-simples", headers=auth_headers).status_code == 200


def test_setup_inicial_so_para_quem_gerencia_o_acesso(client, db):
    _, como_comum = _associado_com_login(db, "Comum Do Setup Inicial")
    assert client.post("/setup-cerebro/").status_code == 401
    assert client.post("/setup-cerebro/", headers=como_comum).status_code == 403
    # (a chamada de SUCESSO não é feita aqui de propósito: ela grava configurações padrão e mudaria a contagem que
    # tests/test_smoke.py confere no banco compartilhado da suíte.)


def test_valores_de_campo_personalizado_exigem_a_permissao_do_modulo_dono_da_entidade(client, auth_headers, db):
    """Achado AO VIVO (v5.4c): ler e gravar os valores de campo personalizado de qualquer registro estava aberto a qualquer logado."""
    dono, como_comum = _associado_com_login(db, "Comum Dos Campos Personalizados")
    for entidade in ("associado", "projeto_evento", "beneficiario"):
        leitura = f"/api/campos-personalizados/{entidade}/1/valores"
        assert client.get(leitura).status_code == 401
        assert client.get(leitura, headers=como_comum).status_code == 403, entidade
        assert client.put(leitura, json={"valores": []}, headers=como_comum).status_code == 403, entidade
        assert client.get(leitura, headers=auth_headers).status_code == 200, entidade
    assert client.get("/api/campos-personalizados/entidade-inventada/1/valores", headers=auth_headers).status_code == 404
