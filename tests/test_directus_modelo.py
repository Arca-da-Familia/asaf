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

SEM_ARQUIVO = "arquivo-que-nao-existe.env"

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


def test_documento_oficial_nao_mora_no_directus_so_no_sistema():
    """Decisão de 2026-10-03: ata, estatuto, certidão, balanço, emenda, parcela e pagamento ficam no SISTEMA
    (sigilo, versão pública e aprovação); o Directus é só editor do site."""
    assert {c["colecao"] for c in m.COLECOES} == {"noticias"}
    assert "Editor de transparência" not in {p["nome"] for p in m.PERFIS}
    assert "Editor de transparência" in m.PERFIS_DESCONTINUADOS and "documentos" in m.COLECOES_DESCONTINUADAS
    pastas = {p["nome"] for p in m.PASTAS} | {f for p in m.PASTAS for f in p["filhas"]}
    assert pastas.isdisjoint(m.PASTAS_DESCONTINUADAS)  # o que saiu não pode voltar por engano


def test_toda_permissao_so_cita_colecao_do_modelo_ou_arquivos():
    permitidas = m.COLECOES_PERMITIDAS | {m.ARQUIVOS, m.PASTAS_SISTEMA}
    for perfil in m.PERFIS:
        assert {p["colecao"] for p in perfil["permissoes"]} <= permitidas, perfil["nome"]


# -------------------------------------------------------------------------- script (com Directus falso)
class DirectusFalso:
    """Mínimo do Directus que o script usa, em memória. `licenciado=False` imita a instância sem licença."""

    def __init__(self, licenciado=True):
        self.licenciado = licenciado
        self.base = "http://directus-falso"
        self.pastas, self.colecoes, self.campos, self.relacoes = [], {}, {}, []
        self.politicas, self.papeis, self.permissoes = [], [], []
        self.itens, self.arquivos, self.usuarios = {}, [], []  # conteúdo de gente: nunca pode ser apagado
        self.configuracoes, self.marcadores = {}, []
        self._n = 0

    def _id(self):
        self._n += 1
        return f"id-{self._n}"

    def ler(self, caminho, **params):
        if caminho == "/users" and "filter[email][_eq]" in params:
            return [{"id": u["id"], "email": u["email"]} for u in self.usuarios if u.get("email") == params["filter[email][_eq]"]]
        if params.get("aggregate[count]"):
            if caminho.startswith("/items/"):
                total = len(self.itens.get(caminho.split("/")[-1], []))
            elif caminho == "/files":
                pasta = params.get("filter[folder][_eq]")
                total = len([a for a in self.arquivos if a["folder"] == pasta])
            elif caminho == "/users":
                papel = params.get("filter[role][_eq]")
                total = len([u for u in self.usuarios if u["role"] == papel])
            else:
                raise AssertionError(caminho)
            return [{"count": str(total)}]
        if caminho == "/folders":
            return copy.deepcopy(self.pastas)
        if caminho == "/collections":
            return [{"collection": nome, "meta": copy.deepcopy(dados.get("meta"))} for nome, dados in self.colecoes.items()]
        if caminho.startswith("/fields/"):
            return copy.deepcopy(self.campos[caminho.split("/")[-1]])
        if caminho == "/settings":
            return copy.deepcopy(self.configuracoes)
        if caminho == "/presets":
            return copy.deepcopy(self.marcadores)
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
        if caminho == "/presets":
            registro = {"id": self._id(), **corpo}
            self.marcadores.append(registro)
            return registro
        if caminho == "/relations":
            self.relacoes.append({"collection": corpo["collection"], "field": corpo["field"]})
            return corpo
        if caminho == "/policies":
            registro = {"id": self._id(), "name": corpo["name"], "admin_access": corpo["admin_access"],
                        "app_access": corpo["app_access"], "enforce_tfa": corpo["enforce_tfa"]}
            self.politicas.append(registro)
            return registro
        if caminho == "/users":
            registro = {"id": self._id(), "email": corpo["email"], "role": corpo["role"], "token": corpo.get("token")}
            self.usuarios.append(registro)
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
        if caminho == "/settings":
            self.configuracoes.update(copy.deepcopy(corpo))
            return self.configuracoes
        if caminho.startswith("/collections/"):
            self.colecoes[caminho.split("/")[-1]]["meta"].update(copy.deepcopy(corpo["meta"]))
            return self.colecoes[caminho.split("/")[-1]]
        if caminho.startswith("/fields/"):
            _, _, colecao, campo = caminho.split("/")
            registro = next(f for f in self.campos[colecao] if f["field"] == campo)
            registro["meta"].update(copy.deepcopy(corpo["meta"]))
            return registro
        if caminho.startswith("/users/"):
            usuario = next(u for u in self.usuarios if u["id"] == identificador)
            usuario.update(copy.deepcopy(corpo))
            return usuario
        for p in self.permissoes:
            if p["id"] == identificador:
                p.update(copy.deepcopy(corpo))
                return p
        raise AssertionError(caminho)

    def apagar(self, caminho):
        identificador = caminho.split("/")[-1]
        if caminho.startswith("/collections/"):
            self.colecoes.pop(identificador)
            self.campos.pop(identificador, None)
        elif caminho.startswith("/folders/"):
            self.pastas = [p for p in self.pastas if p["id"] != identificador]
        elif caminho.startswith("/roles/"):
            self.papeis = [p for p in self.papeis if p["id"] != identificador]
        elif caminho.startswith("/policies/"):
            self.politicas = [p for p in self.politicas if p["id"] != identificador]
            self.permissoes = [p for p in self.permissoes if p["policy"] != identificador]
        else:
            self.permissoes = [p for p in self.permissoes if p["id"] != identificador]


def test_aplicar_cria_tudo_e_verificar_fica_limpo_com_licenca():
    falso = DirectusFalso(licenciado=True)
    feito = cfg.aplicar(falso)
    assert any(x.startswith("coleção criada: noticias") for x in feito)
    assert not any("documentos" in x for x in feito)
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


def _semear_antigo(falso):
    """O que existia em produção antes da decisão de 2026-10-03."""
    falso.colecoes["documentos"] = {}
    falso.campos["documentos"] = []
    mae = falso._id()
    falso.pastas += [{"id": mae, "name": "Documentos institucionais", "parent": None},
                     {"id": falso._id(), "name": "Atas", "parent": mae},
                     {"id": falso._id(), "name": "Emendas e parcerias", "parent": None}]
    papel = {"id": falso._id(), "name": "Editor de transparência"}
    politica = {"id": falso._id(), "name": "Editor de transparência", "admin_access": False, "app_access": True, "enforce_tfa": True}
    falso.papeis.append(papel)
    falso.politicas.append(politica)
    falso.permissoes.append({"id": falso._id(), "policy": politica["id"], "collection": "documentos", "action": "read",
                             "permissions": None, "validation": None, "presets": None, "fields": ["*"]})
    return papel


def test_descontinuados_vazios_sao_removidos_e_a_segunda_rodada_nao_muda_nada():
    falso = DirectusFalso()
    _semear_antigo(falso)
    feito = cfg.aplicar(falso)
    assert "coleção descontinuada removida (estava vazia): documentos" in feito
    assert "pasta descontinuada removida (estava vazia): Atas" in feito
    assert "pasta descontinuada removida (estava vazia): Documentos institucionais" in feito  # mãe só depois da filha
    assert "perfil descontinuado removido (sem usuários): papel Editor de transparência" in feito
    assert "documentos" not in falso.colecoes
    assert "Editor de transparência" not in {p["name"] for p in falso.papeis + falso.politicas}
    assert not any(p["collection"] == "documentos" for p in falso.permissoes)
    assert cfg.verificar(falso) == []
    assert cfg.aplicar(falso) == []


def test_descontinuados_com_conteudo_ou_usuario_nunca_sao_apagados():
    falso = DirectusFalso()
    papel = _semear_antigo(falso)
    falso.itens["documentos"] = [{"id": 1}]
    atas = next(p for p in falso.pastas if p["name"] == "Atas")
    falso.arquivos.append({"folder": atas["id"]})
    falso.usuarios.append({"role": papel["id"]})
    feito = cfg.aplicar(falso)
    assert "AVISO: coleção descontinuada 'documentos' tem 1 item(ns): NÃO removida" in feito
    assert "AVISO: pasta descontinuada 'Atas' ainda tem conteúdo: NÃO removida" in feito
    assert "AVISO: pasta descontinuada 'Documentos institucionais' ainda tem conteúdo: NÃO removida" in feito  # tem filha
    assert "AVISO: perfil descontinuado 'Editor de transparência' tem usuário(s): NÃO removido" in feito
    assert "documentos" in falso.colecoes and len(falso.pastas) >= 3 and "Editor de transparência" in {p["name"] for p in falso.papeis}
    assert "coleção descontinuada ainda existe: documentos" in cfg.verificar(falso)  # e a verificação continua cobrando


@pytest.fixture(autouse=True)
def _nunca_toca_nos_arquivos_reais(monkeypatch):
    """Nenhum teste pode ler o .env.directus nem o CREDENCIAIS_AZURE.md (cifrado) do computador, nem rodar `sops`."""
    monkeypatch.setattr(cfg, "ARQUIVO_TOKEN", SEM_ARQUIVO)
    monkeypatch.setattr(cfg, "ARQUIVO_CREDENCIAIS", SEM_ARQUIVO)

    def proibido(*a, **k):
        raise AssertionError("o teste tentou executar um programa externo (sops/az) sem simulá-lo")

    monkeypatch.setattr(cfg.subprocess, "run", proibido)


def test_cliente_do_ambiente_exige_credencial():
    with pytest.raises(SystemExit) as erro:
        cfg.cliente_do_ambiente({"DIRECTUS_URL": "http://x"})
    assert "nenhuma credencial" in str(erro.value)
    c = cfg.cliente_do_ambiente({"DIRECTUS_URL": "http://x/", "DIRECTUS_TOKEN": "t"})
    assert c.base == "http://x"


def test_token_vem_do_arquivo_env_local_antes_do_arquivo_de_credenciais(tmp_path, monkeypatch):
    env = tmp_path / ".env.directus"
    env.write_text('# token temporário\nDIRECTUS_TOKEN = "do-env"\n', encoding="utf-8")
    cred = tmp_path / "cred.md"
    cred.write_text("DIRECTUS_TOKEN=das-credenciais\n", encoding="utf-8")
    c = cfg.cliente_do_ambiente({}, producao=True, arquivo_token=str(env), arquivo_credenciais=str(cred))
    assert c._cab == {"Authorization": "Bearer do-env"}  # sem aspas, sem espaços
    assert c.base == "https://cms.asaf.org.br"


def test_arquivo_env_em_branco_e_ignorado_e_cai_no_arquivo_de_credenciais(tmp_path):
    env = tmp_path / ".env.directus"
    env.write_text("DIRECTUS_TOKEN=\n", encoding="utf-8")
    cred = tmp_path / "cred.md"
    cred.write_text("# Directus\n- DIRECTUS_TOKEN=abc123\n", encoding="utf-8")
    c = cfg.cliente_do_ambiente({}, producao=True, arquivo_token=str(env), arquivo_credenciais=str(cred))
    assert c._cab == {"Authorization": "Bearer abc123"}


def test_credenciais_so_sao_consultadas_em_modo_producao(tmp_path):
    cred = tmp_path / "cred.md"
    cred.write_text("DIRECTUS_TOKEN=abc123\n", encoding="utf-8")
    with pytest.raises(SystemExit):
        cfg.cliente_do_ambiente({}, producao=False, arquivo_credenciais=str(cred))


def test_token_das_credenciais_texto_puro_formatos_comuns_e_ausencia(tmp_path):
    f = tmp_path / "c.md"
    for linha, esperado in [("DIRECTUS_TOKEN=abc", "abc"), ("  - DIRECTUS_TOKEN: `x-y_z`", "x-y_z"),
                            ('> DIRECTUS_TOKEN = "q1"', "q1"), ("DIRECTUS_TOKEN=", None), ("OUTRA=1", None)]:
        f.write_text(f"# titulo\nSENHA=nao-pegar\n{linha}\n", encoding="utf-8")
        assert cfg.token_das_credenciais(str(f)) == esperado, linha
    assert cfg.token_das_credenciais(str(tmp_path / "nao-existe")) is None


def test_arquivo_cifrado_e_decifrado_so_em_memoria_e_so_o_token_e_usado(tmp_path, monkeypatch, capsys):
    cifrado = tmp_path / "CREDENCIAIS_AZURE.md"
    original = '{"data": "ENC[AES256_GCM,data:xxx]", "sops": {"version": "3"}}'
    cifrado.write_text(original, encoding="utf-8")
    chamadas = []

    class Resultado:
        returncode = 0
        stdout = "# Azure\nSENHA_DO_BANCO=muito-secreta\nDIRECTUS_TOKEN=tok-persistente\n"

    def falso_run(comando, **kw):
        chamadas.append(comando)
        return Resultado()

    monkeypatch.setattr(cfg.subprocess, "run", falso_run)
    monkeypatch.setattr(cfg.shutil, "which", lambda nome: "sops.exe")
    assert cfg.token_das_credenciais(str(cifrado)) == "tok-persistente"
    assert chamadas == [["sops.exe", "-d", str(cifrado)]]  # `-d` imprime na saída: nunca `-d -i` (que gravaria em disco)
    assert cifrado.read_text(encoding="utf-8") == original  # o arquivo continua cifrado, byte a byte
    saida = capsys.readouterr()
    assert "muito-secreta" not in saida.out + saida.err and "tok-persistente" not in saida.out + saida.err
    assert [p.name for p in tmp_path.iterdir()] == ["CREDENCIAIS_AZURE.md"]  # nenhum arquivo temporário com texto puro


def test_falha_ao_decifrar_ou_sem_sops_da_erro_claro(tmp_path, monkeypatch):
    cifrado = tmp_path / "c.md"
    cifrado.write_text('{"sops": {}}', encoding="utf-8")
    monkeypatch.setattr(cfg.shutil, "which", lambda nome: None)
    with pytest.raises(SystemExit) as erro:
        cfg.token_das_credenciais(str(cifrado))
    assert "sops" in str(erro.value)

    class Falha:
        returncode = 1
        stdout = ""

    monkeypatch.setattr(cfg.shutil, "which", lambda nome: "sops.exe")
    monkeypatch.setattr(cfg.subprocess, "run", lambda *a, **k: Falha())
    with pytest.raises(SystemExit) as erro:
        cfg.token_das_credenciais(str(cifrado))
    assert "decifrar" in str(erro.value)


def test_senha_do_cofre_so_com_opcao_explicita_e_nunca_e_impressa(monkeypatch, capsys):
    chamadas = {}

    def falso_entrar(base, email, senha, otp=None, http=None):
        chamadas.update(base=base, email=email, senha=senha)
        return "token-de-acesso"

    monkeypatch.setattr(cfg, "senha_do_cofre", lambda *a, **k: "segredo-do-cofre")
    monkeypatch.setattr(cfg, "entrar", falso_entrar)
    with pytest.raises(SystemExit):  # sem a opção, o cofre NÃO é consultado (a senha de lá está defasada)
        cfg.cliente_do_ambiente({}, producao=True)
    assert chamadas == {}
    cfg.cliente_do_ambiente({}, producao=True, usar_senha_do_cofre=True)
    assert chamadas == {"base": "https://cms.asaf.org.br", "email": "asaf@asaf.org.br", "senha": "segredo-do-cofre"}
    saida = capsys.readouterr()
    assert "segredo-do-cofre" not in saida.out + saida.err


def test_ler_arquivo_env_ignora_comentario_linha_vazia_e_arquivo_ausente(tmp_path):
    assert cfg.ler_arquivo_env(str(tmp_path / "nao-existe")) == {}
    arquivo = tmp_path / "x"
    arquivo.write_text("\n# c\nA=1\nB = 'dois'\nsem-igual\n", encoding="utf-8")
    assert cfg.ler_arquivo_env(str(arquivo)) == {"A": "1", "B": "dois"}


# ----------------------------------------------------------------------- conta de serviço do site (leitor)
def _falso_com_perfis():
    falso = DirectusFalso()
    cfg.aplicar(falso)
    return falso


class CofreFalso:
    def __init__(self, ja_tem=False, falha=False):
        self.ja_tem, self.falha, self.gravados = ja_tem, falha, []

    def tem(self, *a, **k):
        return self.ja_tem

    def guardar(self, nome, valor, *a, **k):
        if self.falha:
            raise SystemExit("o Key Vault recusou")
        self.gravados.append((nome, valor))


def _sem_problemas(base, token):
    return []


def _criar_leitor(falso, cofre, **extra):
    return cfg.garantir_leitor_do_site(falso, guardar=cofre.guardar, tem_segredo=cofre.tem, verificar_token=_sem_problemas, **extra)


def test_leitor_cria_a_conta_guarda_o_token_no_cofre_e_nunca_o_mostra():
    falso = _falso_com_perfis()
    cofre = CofreFalso()
    relatorio = _criar_leitor(falso, cofre)
    assert [u["email"] for u in falso.usuarios] == [cfg.EMAIL_LEITOR]
    papel = next(p for p in falso.papeis if p["name"] == "Leitor do site")
    assert falso.usuarios[0]["role"] == papel["id"]
    ((nome, token),) = cofre.gravados
    assert nome == "DIRECTUS-SITE-TOKEN" and len(token) >= 40 and falso.usuarios[0]["token"] == token
    assert token not in " ".join(relatorio)  # nunca no relatório que vai para a tela
    assert any("conta criada" in x for x in relatorio)


def test_leitor_existente_com_token_no_cofre_nao_muda_nada_a_menos_que_rotacione():
    falso = _falso_com_perfis()
    cofre = CofreFalso()
    _criar_leitor(falso, cofre)
    token_antigo = falso.usuarios[0]["token"]
    cofre.ja_tem = True
    cofre.gravados.clear()
    relatorio = _criar_leitor(falso, cofre)
    assert cofre.gravados == [] and falso.usuarios[0]["token"] == token_antigo and "nada a fazer" in relatorio[0]
    _criar_leitor(falso, cofre, rotacionar=True)
    assert len(cofre.gravados) == 1 and falso.usuarios[0]["token"] == cofre.gravados[0][1] != token_antigo


def test_leitor_existente_sem_token_no_cofre_recebe_token_novo():
    falso = _falso_com_perfis()
    cofre = CofreFalso()
    _criar_leitor(falso, cofre)
    cofre.gravados.clear()  # o cofre perdeu o segredo: o Directus nunca mostra o token de novo
    relatorio = _criar_leitor(falso, cofre)
    assert len(cofre.gravados) == 1 and any("renovado" in x for x in relatorio)
    assert len(falso.usuarios) == 1


def test_leitor_exige_o_perfil_e_falha_alto_se_o_cofre_recusar():
    with pytest.raises(SystemExit):
        _criar_leitor(DirectusFalso(), CofreFalso())
    with pytest.raises(SystemExit):
        _criar_leitor(_falso_com_perfis(), CofreFalso(falha=True))


def test_leitor_o_proprio_token_e_testado_leitura_ok_escrita_e_usuarios_negados(monkeypatch):
    class LeitorFalso:
        def __init__(self, base, token, http=None):
            self.token = token

        def ler(self, caminho, **params):
            if caminho == "/users":
                raise cfg.ErroDirectus("GET /users -> HTTP 403")
            return []

        def criar(self, caminho, corpo):
            raise cfg.ErroDirectus("POST /items/noticias -> HTTP 403: sem permissão")

    monkeypatch.setattr(cfg, "Cliente", LeitorFalso)
    assert cfg.verificar_token_do_leitor("http://x", "t") == []

    class LeitorPoderoso(LeitorFalso):
        def ler(self, caminho, **params):
            return []

        def criar(self, caminho, corpo):
            return {"id": 1}

    monkeypatch.setattr(cfg, "Cliente", LeitorPoderoso)
    problemas = cfg.verificar_token_do_leitor("http://x", "t")
    assert any("CONSEGUIU criar" in p for p in problemas) and any("listar usuários" in p for p in problemas)

    class LeitorSemAcesso(LeitorFalso):
        def ler(self, caminho, **params):
            raise cfg.ErroDirectus("GET -> HTTP 403")

    monkeypatch.setattr(cfg, "Cliente", LeitorSemAcesso)
    assert any("não consegue ler notícias" in p for p in cfg.verificar_token_do_leitor("http://x", "t"))


def test_guardar_no_cofre_usa_arquivo_temporario_apagado_e_nunca_o_valor_no_comando(monkeypatch):
    visto = {}

    class Ok:
        returncode = 0
        stdout = "https://kv/segredo/versao"

    def falso_run(comando, **kw):
        visto["comando"] = comando
        arquivo = comando[comando.index("--file") + 1]
        visto["arquivo"] = arquivo
        visto["conteudo"] = open(arquivo, encoding="utf-8").read()
        return Ok()

    monkeypatch.setattr(cfg.shutil, "which", lambda n: "az.cmd")
    monkeypatch.setattr(cfg.subprocess, "run", falso_run)
    cfg.guardar_no_cofre("DIRECTUS-SITE-TOKEN", "valor-super-secreto-123")
    assert "valor-super-secreto-123" not in " ".join(visto["comando"]) and "--value" not in visto["comando"]
    assert visto["conteudo"] == "valor-super-secreto-123"  # exatamente o valor, sem quebra de linha
    assert not Path(visto["arquivo"]).exists()  # o arquivo temporário não fica no disco


def test_guardar_no_cofre_apaga_o_arquivo_mesmo_quando_o_azure_recusa(monkeypatch):
    visto = {}

    class Falha:
        returncode = 1
        stdout = ""

    def falso_run(comando, **kw):
        visto["arquivo"] = comando[comando.index("--file") + 1]
        return Falha()

    monkeypatch.setattr(cfg.shutil, "which", lambda n: "az.cmd")
    monkeypatch.setattr(cfg.subprocess, "run", falso_run)
    with pytest.raises(SystemExit):
        cfg.guardar_no_cofre("X", "segredo")
    assert not Path(visto["arquivo"]).exists()


def test_cofre_tem_segredo_pergunta_so_o_id_nunca_o_valor(monkeypatch):
    visto = {}

    class Ok:
        returncode = 0
        stdout = "https://kv/segredos/x\n"

    def falso_run(comando, **kw):
        visto["c"] = comando
        return Ok()

    monkeypatch.setattr(cfg.shutil, "which", lambda n: "az.cmd")
    monkeypatch.setattr(cfg.subprocess, "run", falso_run)
    assert cfg.cofre_tem_segredo() is True
    assert visto["c"][visto["c"].index("--query") + 1] == "id" and "value" not in visto["c"]


# ------------------------------------------------------------------------ organização do Studio (formulário)
def _campos_da_noticia():
    return {f["field"]: f for f in next(c for c in m.COLECOES if c["colecao"] == "noticias")["campos"]}


def test_formulario_da_noticia_tem_secoes_em_portugues_na_ordem_de_quem_escreve():
    campos = _campos_da_noticia()
    secoes = [n for n, f in campos.items() if f["type"] == "alias"]
    assert secoes == ["grupo_conteudo", "grupo_foto", "grupo_publicacao", "grupo_historico"]
    for nome in secoes:
        assert campos[nome]["schema"] is None  # seção não é coluna do banco
        assert campos[nome]["meta"]["translations"][0]["language"] == "pt-BR"
    # Cada campo de dado cai numa seção, e a ordem é título -> resumo -> texto -> foto -> publicação.
    dados = [f for n, f in campos.items() if f["type"] != "alias" and n != "id"]
    assert all(f["meta"].get("group") in secoes for f in dados)
    ordem = [n for n, f in sorted(campos.items(), key=lambda par: par[1]["meta"]["sort"])]
    assert ordem.index("titulo") < ordem.index("resumo") < ordem.index("corpo") < ordem.index("imagem") < ordem.index("status")
    assert campos["grupo_historico"]["meta"]["options"]["start"] == "closed"  # o que ninguém edita fica recolhido


def test_todo_campo_do_formulario_tem_rotulo_em_portugues_e_a_foto_exige_o_que_a_lei_pede():
    campos = _campos_da_noticia()
    for nome, f in campos.items():
        if nome != "id":
            assert f["meta"].get("translations"), f"{nome} sem rótulo em português"
    assert "autorização" in campos["autorizacao_imagem"]["meta"]["translations"][0]["translation"].lower()
    assert "alternativo" in campos["imagem_alt"]["meta"]["translations"][0]["translation"].lower()


def test_atalhos_da_lista_e_configuracoes_do_projeto_existem_no_modelo():
    nomes = [x["nome"] for x in m.MARCADORES]
    assert nomes == [None, "Todas as notícias", "Para revisar", "Rascunhos", "No ar"]  # None = lista padrão, sem filtro
    assert m.MARCADORES[0]["filtro"] is None
    assert next(x for x in m.MARCADORES if x["nome"] == "Para revisar")["filtro"] == {"status": {"_eq": m.STATUS_REVISAO}}
    assert m.AJUSTES_DO_PROJETO["default_language"] == "pt-BR" and m.AJUSTES_DO_PROJETO["project_color"] == "#145238"


def test_aplicar_configura_o_projeto_cria_os_atalhos_e_a_segunda_rodada_nao_muda_nada():
    falso = DirectusFalso()
    feito = cfg.aplicar(falso)
    assert falso.configuracoes == m.AJUSTES_DO_PROJETO
    assert [p["bookmark"] for p in falso.marcadores] == [x["nome"] for x in m.MARCADORES]
    assert all(p["user"] is None and p["role"] is None for p in falso.marcadores)  # globais: valem para todos
    assert any(x.startswith("atalho criado") for x in feito) and cfg.verificar(falso) == []
    assert cfg.aplicar(falso) == []


def test_aplicar_devolve_a_apresentacao_do_campo_que_alguem_mexeu_e_nao_toca_no_resto():
    falso = DirectusFalso()
    cfg.aplicar(falso)
    campo = next(f for f in falso.campos["noticias"] if f["field"] == "titulo")
    campo["meta"]["group"] = None  # alguém tirou o título da seção
    campo["meta"]["width"] = "half"
    tipo_antes = campo["type"]
    feito = cfg.aplicar(falso)
    assert "campo ajustado (group, width): noticias.titulo" in feito
    assert campo["meta"]["group"] == "grupo_conteudo" and campo["type"] == tipo_antes
    assert cfg.aplicar(falso) == []


def test_verificar_aponta_configuracao_e_atalho_fora_do_modelo():
    falso = DirectusFalso()
    cfg.aplicar(falso)
    falso.configuracoes["default_language"] = "en-US"
    falso.marcadores.pop()
    problemas = cfg.verificar(falso)
    assert "configuração do projeto diferente do modelo: default_language" in problemas
    assert "atalho ausente: No ar" in problemas


def test_colecao_noticias_nao_usa_o_arquivar_do_directus_e_o_ajuste_chega_a_colecao_ja_existente():
    meta = next(c for c in m.COLECOES if c["colecao"] == "noticias")["meta"]
    assert meta["archive_field"] is None  # o chip "Publicado" no alto da lista confundia
    falso = DirectusFalso()
    cfg.aplicar(falso)
    # produção já tinha a coleção com "arquivar" ligado:
    falso.colecoes["noticias"]["meta"].update({"archive_field": "status", "archive_value": "arquivado", "unarchive_value": "rascunho"})
    feito = cfg.aplicar(falso)
    assert any(x.startswith("coleção ajustada (archive_field") and x.endswith(": noticias") for x in feito)
    assert falso.colecoes["noticias"]["meta"]["archive_field"] is None
    assert cfg.aplicar(falso) == []
