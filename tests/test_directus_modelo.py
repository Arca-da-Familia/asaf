"""Modelo editorial do Directus (v5.3): as regras de privilégio mínimo provadas SEM um Directus no ar.

O que garante, em linguagem simples: (1) o Directus só guarda conteúdo editorial, nunca dado do sistema;
(2) ninguém além do administrador tem acesso de administrador; (3) a conta do site só LÊ e só o que está
publicado; (4) o Redator não publica nem apaga; (5) o Colaborador de mídia não vê texto nenhum; (6) foto
exige texto alternativo e autorização de imagem. E o script `directus_configurar` é idempotente.
"""
import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import directus_configurar as cfg  # noqa: E402
import directus_modelo as m  # noqa: E402


def _perfil(nome):
    return next(p for p in m.PERFIS if p["nome"] == nome)


def _perms(nome, colecao=None, acao=None):
    return [p for p in _perfil(nome)["permissoes"]
            if (colecao is None or p["colecao"] == colecao) and (acao is None or p["acao"] == acao)]


# ---------------------------------------------------------------------------------------- coleções
def test_o_directus_so_guarda_conteudo_editorial_nunca_tabela_do_sistema():
    import app.models  # noqa: F401  (registra todas as tabelas do sistema)
    from app.database import Base

    tabelas_do_sistema = set(Base.metadata.tables)
    assert tabelas_do_sistema, "sem tabelas do sistema carregadas - o teste não prova nada"
    assert {c["colecao"] for c in m.COLECOES}.isdisjoint(tabelas_do_sistema)
    assert all(not c["colecao"].startswith("directus_") for c in m.COLECOES)


@pytest.mark.parametrize("colecao", [c["colecao"] for c in m.COLECOES])
def test_toda_colecao_tem_status_com_rascunho_por_padrao_e_data_de_atualizacao(colecao):
    definicao = next(c for c in m.COLECOES if c["colecao"] == colecao)
    campos = {f["field"]: f for f in definicao["campos"]}
    assert campos["status"]["schema"]["default_value"] == m.STATUS_RASCUNHO
    valores = {o["value"] for o in campos["status"]["meta"]["options"]["choices"]}
    assert {m.STATUS_RASCUNHO, m.STATUS_REVISAO, m.STATUS_PUBLICADO} <= valores
    assert "date_updated" in campos  # a "Última atualização" que o site mostra vem daqui
    assert "user_updated" in campos  # trilha: quem alterou por último
    assert definicao["meta"]["versioning"] is True  # histórico com reversão


def test_foto_exige_texto_alternativo_e_autorizacao_de_imagem():
    campos = {f["field"]: f for f in next(c for c in m.COLECOES if c["colecao"] == "noticias")["campos"]}
    for nome in ("imagem_alt", "autorizacao_imagem"):
        condicoes = campos[nome]["meta"]["conditions"]
        assert any(c.get("required") is True for c in condicoes), nome
    assert campos["autorizacao_imagem"]["schema"]["default_value"] is False


def test_slug_da_noticia_e_unico():
    campos = {f["field"]: f for f in next(c for c in m.COLECOES if c["colecao"] == "noticias")["campos"]}
    assert campos["slug"]["schema"]["is_unique"] is True


# ----------------------------------------------------------------------------------------- perfis
def test_nenhum_perfil_do_modelo_e_administrador():
    # O modelo nem tem o campo `admin_access`; o script grava sempre False.
    assert all("admin_access" not in p for p in m.PERFIS)


def test_so_o_leitor_do_site_fica_sem_acesso_ao_studio():
    sem = [p["nome"] for p in m.PERFIS if not p["app_access"]]
    assert sem == ["Leitor do site"]


def test_ninguem_do_modelo_toca_nas_colecoes_de_gestao_do_directus():
    for perfil in m.PERFIS:
        usadas = {p["colecao"] for p in perfil["permissoes"]}
        assert usadas.isdisjoint(m.COLECOES_DE_SISTEMA_PROIBIDAS_A_EDITORES), perfil["nome"]


def test_leitor_do_site_so_le_e_so_o_que_esta_no_ar():
    permissoes = _perfil("Leitor do site")["permissoes"]
    assert {p["acao"] for p in permissoes} == {"read"}
    noticias = _perms("Leitor do site", "noticias", "read")[0]
    texto = repr(noticias["filtro"])
    assert "publicado" in texto and "$NOW" in texto  # publicada e com a data (agendamento) já vencida
    assert _perms("Leitor do site", "documentos", "read")[0]["filtro"] == m.SO_PUBLICADO
    # arquivo: só campos públicos (sem quem enviou, caminho de armazenamento, etc.)
    campos = _perms("Leitor do site", m.ARQUIVOS, "read")[0]["campos"]
    assert "*" not in campos and "uploaded_by" not in campos and "storage" not in campos


def test_redator_escreve_so_rascunho_so_o_seu_e_nao_apaga():
    assert _perms("Redator", acao="delete") == []
    criar = _perms("Redator", "noticias", "create")[0]
    assert set(criar["validacao"]["status"]["_in"]) == {m.STATUS_RASCUNHO, m.STATUS_REVISAO}
    assert m.STATUS_PUBLICADO not in criar["validacao"]["status"]["_in"]
    atualizar = _perms("Redator", "noticias", "update")[0]
    assert m.STATUS_PUBLICADO not in repr(atualizar["validacao"])
    assert "$CURRENT_USER" in repr(atualizar["filtro"]) and "rascunho" in repr(atualizar["filtro"])
    assert "$CURRENT_USER" in repr(_perms("Redator", "noticias", "read")[0]["filtro"])


def test_colaborador_de_midia_so_envia_foto_e_nao_ve_texto_de_colecao_nenhuma():
    usadas = {p["colecao"] for p in _perfil("Colaborador de mídia")["permissoes"]}
    assert usadas <= {m.ARQUIVOS, m.PASTAS_SISTEMA}
    assert _perms("Colaborador de mídia", acao="delete") == []
    assert "$CURRENT_USER" in repr(_perms("Colaborador de mídia", m.ARQUIVOS, "read")[0]["filtro"])


def test_editor_de_transparencia_nao_mexe_em_noticia_e_editor_de_conteudo_nao_mexe_em_documento():
    assert {p["colecao"] for p in _perfil("Editor de transparência")["permissoes"]} >= {"documentos"}
    assert "noticias" not in {p["colecao"] for p in _perfil("Editor de transparência")["permissoes"]}
    assert "documentos" not in {p["colecao"] for p in _perfil("Editor de conteúdo")["permissoes"]}


def test_toda_permissao_so_cita_colecao_do_modelo_ou_arquivos():
    permitidas = m.COLECOES_PERMITIDAS | {m.ARQUIVOS, m.PASTAS_SISTEMA}
    for perfil in m.PERFIS:
        assert {p["colecao"] for p in perfil["permissoes"]} <= permitidas, perfil["nome"]


# -------------------------------------------------------------------------- script (com Directus falso)
class DirectusFalso:
    """Mínimo do Directus que o script usa, em memória. `licenciado=False` imita a instância sem licença."""

    def __init__(self, licenciado=True):
        self.licenciado = licenciado
        self.pastas, self.colecoes, self.campos, self.relacoes = [], {}, {}, []
        self.politicas, self.papeis, self.permissoes = [], [], []
        self._n = 0

    def _id(self):
        self._n += 1
        return f"id-{self._n}"

    def ler(self, caminho, **params):
        if caminho == "/folders":
            return copy.deepcopy(self.pastas)
        if caminho == "/collections":
            return [{"collection": nome} for nome in self.colecoes]
        if caminho.startswith("/fields/"):
            return [{"field": f["field"]} for f in self.campos[caminho.split("/")[-1]]]
        if caminho == "/relations":
            return copy.deepcopy(self.relacoes)
        if caminho == "/policies":
            return copy.deepcopy(self.politicas)
        if caminho == "/roles":
            return copy.deepcopy(self.papeis)
        if caminho == "/permissions":
            politica = params["filter[policy][_eq]"]
            return [copy.deepcopy(p) for p in self.permissoes if p["policy"] == politica]
        raise AssertionError(caminho)

    def criar(self, caminho, corpo):
        corpo = copy.deepcopy(corpo)
        if caminho == "/folders":
            registro = {"id": self._id(), "name": corpo["name"], "parent": corpo["parent"]}
            self.pastas.append(registro)
            return registro
        if caminho == "/collections":
            self.colecoes[corpo["collection"]] = corpo
            self.campos[corpo["collection"]] = corpo["fields"]
            return corpo
        if caminho.startswith("/fields/"):
            self.campos[caminho.split("/")[-1]].append(corpo)
            return corpo
        if caminho == "/relations":
            self.relacoes.append({"collection": corpo["collection"], "field": corpo["field"]})
            return corpo
        if caminho == "/policies":
            registro = {"id": self._id(), "name": corpo["name"], "admin_access": corpo["admin_access"],
                        "app_access": corpo["app_access"], "enforce_tfa": corpo["enforce_tfa"]}
            self.politicas.append(registro)
            return registro
        if caminho == "/roles":
            registro = {"id": self._id(), "name": corpo["name"]}
            self.papeis.append(registro)
            return registro
        if caminho == "/permissions":
            personalizada = bool(corpo["permissions"] or corpo["validation"] or corpo["presets"] or corpo["fields"] != ["*"])
            if personalizada and not self.licenciado:
                raise cfg.ErroDirectus("POST /permissions -> HTTP 403: custom_permission_rules_enabled is a restricted resource.")
            registro = {**corpo, "id": self._id()}
            self.permissoes.append(registro)
            return registro
        raise AssertionError(caminho)

    def alterar(self, caminho, corpo):
        identificador = caminho.split("/")[-1]
        for p in self.permissoes:
            if p["id"] == identificador:
                p.update(copy.deepcopy(corpo))
                return p
        raise AssertionError(caminho)

    def apagar(self, caminho):
        identificador = caminho.split("/")[-1]
        self.permissoes = [p for p in self.permissoes if p["id"] != identificador]


def test_aplicar_cria_tudo_e_verificar_fica_limpo_com_licenca():
    falso = DirectusFalso(licenciado=True)
    feito = cfg.aplicar(falso)
    assert any(x.startswith("coleção criada: documentos") for x in feito)
    assert any(x.startswith("coleção criada: noticias") for x in feito)
    assert cfg.verificar(falso) == []


def test_aplicar_duas_vezes_nao_duplica_nem_muda_nada():
    falso = DirectusFalso()
    cfg.aplicar(falso)
    estado = copy.deepcopy((falso.pastas, falso.politicas, falso.papeis, falso.permissoes, falso.relacoes))
    segundo = cfg.aplicar(falso)
    assert segundo == []
    assert estado == (falso.pastas, falso.politicas, falso.papeis, falso.permissoes, falso.relacoes)


def test_sem_licenca_avisa_e_a_verificacao_aponta_o_que_faltou():
    falso = DirectusFalso(licenciado=False)
    feito = cfg.aplicar(falso)
    assert cfg.AVISO_LICENCA in feito
    problemas = cfg.verificar(falso)
    assert "permissão ausente: Redator / noticias / create" in problemas
    assert "permissão ausente: Leitor do site / noticias / read" in problemas


def test_verificar_reprova_colecao_de_negocio_no_directus():
    falso = DirectusFalso()
    cfg.aplicar(falso)
    falso.colecoes["associados"] = {}
    assert any("coleção fora do modelo: associados" in p for p in cfg.verificar(falso))


def test_verificar_reprova_perfil_com_acesso_de_administrador_ou_permissao_a_mais():
    falso = DirectusFalso()
    cfg.aplicar(falso)
    falso.politicas[0]["admin_access"] = True
    politica = next(p for p in falso.politicas if p["name"] == "Redator")
    falso.permissoes.append({"id": "extra", "policy": politica["id"], "collection": "noticias", "action": "delete",
                             "permissions": None, "validation": None, "presets": None, "fields": ["*"]})
    problemas = cfg.verificar(falso)
    assert any("acesso de administrador" in p for p in problemas)
    assert "permissão a mais: Redator / noticias / delete" in problemas


def test_aplicar_remove_permissao_que_nao_esta_no_modelo_e_corrige_a_alterada():
    falso = DirectusFalso()
    cfg.aplicar(falso)
    politica = next(p for p in falso.politicas if p["name"] == "Redator")
    falso.permissoes.append({"id": "extra", "policy": politica["id"], "collection": "noticias", "action": "delete",
                             "permissions": None, "validation": None, "presets": None, "fields": ["*"]})
    leitura = next(p for p in falso.permissoes if p["policy"] == politica["id"] and p["collection"] == "noticias" and p["action"] == "read")
    leitura["permissions"] = None  # alguém abriu a leitura de tudo
    feito = cfg.aplicar(falso)
    assert "permissão removida (fora do modelo): Redator / noticias / delete" in feito
    assert "permissão corrigida: Redator / noticias / read" in feito
    assert cfg.verificar(falso) == []


def test_cliente_do_ambiente_exige_credencial():
    with pytest.raises(SystemExit):
        cfg.cliente_do_ambiente({"DIRECTUS_URL": "http://x"})
    c = cfg.cliente_do_ambiente({"DIRECTUS_URL": "http://x/", "DIRECTUS_TOKEN": "t"})
    assert c.base == "http://x"


def test_modo_producao_usa_a_senha_do_cofre_sem_imprimir_e_o_email_padrao(monkeypatch, capsys):
    chamadas = {}

    def falso_entrar(base, email, senha, otp=None, http=None):
        chamadas.update(base=base, email=email, senha=senha)
        return "token-de-acesso"

    monkeypatch.setattr(cfg, "senha_do_cofre", lambda *a, **k: "segredo-do-cofre")
    monkeypatch.setattr(cfg, "entrar", falso_entrar)
    c = cfg.cliente_do_ambiente({}, producao=True)
    assert c.base == "https://cms.asaf.org.br"
    assert chamadas == {"base": "https://cms.asaf.org.br", "email": "asaf@asaf.org.br", "senha": "segredo-do-cofre"}
    saida = capsys.readouterr()
    assert "segredo-do-cofre" not in saida.out + saida.err


def test_modo_producao_nao_vai_ao_cofre_se_ja_ha_token_ou_senha(monkeypatch):
    def nao_deveria(*a, **k):
        raise AssertionError("foi ao cofre sem precisar")

    monkeypatch.setattr(cfg, "senha_do_cofre", nao_deveria)
    assert cfg.cliente_do_ambiente({"DIRECTUS_TOKEN": "t"}, producao=True).base == "https://cms.asaf.org.br"
