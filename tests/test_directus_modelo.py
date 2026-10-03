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
        self.pastas, self.colecoes, self.campos, self.relacoes = [], {}, {}, []
        self.politicas, self.papeis, self.permissoes = [], [], []
        self.itens, self.arquivos, self.usuarios = {}, [], []  # conteúdo de gente: nunca pode ser apagado
        self._n = 0

    def _id(self):
        self._n += 1
        return f"id-{self._n}"

    def ler(self, caminho, **params):
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
