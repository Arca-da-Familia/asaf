"""v2.5.8 (achado do usuário) - gerenciar opção de catálogo não pode exigir sempre
`gerenciar_acesso`: um secretário (permissão `associados`) precisa editar a categoria de
associado sem precisar de acesso à tela de Níveis e permissões. Cobre também a correção de
segurança nas rotas legadas (`/api/opcoes/*`), que nunca tiveram checagem de autenticação."""
import uuid

from app.models.core import NivelAcesso, PermissaoSistema, Usuario, perfil_permissao
from app.security import criar_access_token, hash_senha


def _chave_unica(prefixo: str) -> str:
    return f"{prefixo}_{uuid.uuid4().hex[:8]}"


def _criar_usuario_com_permissao(db, codigo_permissao: str) -> Usuario:
    """Nível de teste com EXATAMENTE uma permissão de módulo - nunca gerenciar_acesso -, pra
    provar que essa permissão específica (e só ela) basta pra gerenciar o catálogo dela."""
    nivel = NivelAcesso(nome_nivel=_chave_unica("nivel_teste"), descricao="Nível de teste", exige_mfa=False)
    db.add(nivel)
    db.flush()
    permissao = db.query(PermissaoSistema).filter(PermissaoSistema.codigo_permissao == codigo_permissao).first()
    db.execute(perfil_permissao.insert().values(id_nivel=nivel.id_nivel, id_permissao=permissao.id_permissao))
    usuario = Usuario(
        email=f"{_chave_unica('usuario_teste')}@teste.local",
        senha_hash=hash_senha("SenhaForte123456"), id_nivel=nivel.id_nivel, ativo=True,
    )
    db.add(usuario)
    db.commit()
    db.refresh(usuario)
    return usuario


def _headers(usuario: Usuario) -> dict:
    return {"Authorization": f"Bearer {criar_access_token(usuario)}"}


def test_permissao_do_modulo_dono_basta_pra_gerenciar_seu_catalogo(client, auth_headers, db):
    """`estado_civil` tem permissao_gerenciamento="associados" (migração 75fa21fb920d) - um
    usuário só com `associados` (sem gerenciar_acesso) deve conseguir adicionar/editar/excluir
    opção nele."""
    usuario_associados = _criar_usuario_com_permissao(db, "associados")
    headers = _headers(usuario_associados)

    resposta = client.post(
        "/api/catalogos/estado_civil/opcoes", headers=headers,
        json={"codigo": _chave_unica("COD"), "rotulo": "Estado civil de teste"},
    )
    assert resposta.status_code == 200, resposta.text
    id_opcao = resposta.json()["id_opcao"]

    resposta_put = client.put(f"/api/opcoes-catalogo/{id_opcao}", headers=headers, json={"rotulo": "Renomeado"})
    assert resposta_put.status_code == 200, resposta_put.text

    client.put(f"/api/opcoes-catalogo/{id_opcao}", headers=headers, json={"ativo": False})
    resposta_delete = client.delete(f"/api/opcoes-catalogo/{id_opcao}", headers=headers)
    assert resposta_delete.status_code == 200, resposta_delete.text


def test_permissao_de_outro_modulo_nao_basta(client, db):
    """Mesmo usuário do teste acima, mas tentando mexer num catálogo de OUTRO dono
    (`tipo_conta_contabil` -> financeiro) - deve ser recusado."""
    usuario_associados = _criar_usuario_com_permissao(db, "associados")
    headers = _headers(usuario_associados)

    resposta = client.post(
        "/api/catalogos/tipo_conta_contabil/opcoes", headers=headers,
        json={"codigo": _chave_unica("COD"), "rotulo": "Tipo de conta de teste"},
    )
    assert resposta.status_code == 403, resposta.text
    assert "financeiro" in resposta.json()["detail"]


def test_gerenciar_acesso_continua_podendo_editar_qualquer_catalogo(client, auth_headers):
    """`auth_headers` (fixture) é Presidente - tem `gerenciar_acesso` mas o teste confirma que
    isso continua sendo um caminho válido pra QUALQUER catálogo, mesmo um com dono declarado."""
    resposta = client.post(
        "/api/catalogos/tipo_conta_contabil/opcoes", headers=auth_headers,
        json={"codigo": _chave_unica("COD"), "rotulo": "Tipo de conta via admin"},
    )
    assert resposta.status_code == 200, resposta.text


def test_opcao_legado_post_sem_autenticacao_falha(client):
    """Achado real: /api/opcoes/{tipo} nunca teve nenhuma checagem de autenticação - corrigido
    pra exigir login (item 4 do checklist de revisão: nada grava sem autenticação)."""
    resposta = client.post("/api/opcoes/estado_civil", json={"valor": "Tentativa sem login"})
    assert resposta.status_code == 401


def test_opcao_legado_put_sem_autenticacao_falha(client):
    resposta = client.put("/api/opcoes/1", json={"valor": "Tentativa sem login"})
    assert resposta.status_code == 401


def test_opcao_legado_post_com_permissao_do_modulo_funciona(client, db):
    usuario_associados = _criar_usuario_com_permissao(db, "associados")
    resposta = client.post(
        "/api/opcoes/estado_civil", headers=_headers(usuario_associados),
        json={"valor": _chave_unica("Valor legado")},
    )
    assert resposta.status_code == 200, resposta.text
