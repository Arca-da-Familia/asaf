"""Aplica o isolamento do Directus em PRODUCAO (orquestra `isolar_directus.py` + Azure).

NAO e executado automaticamente por nada: foi escrito para ser rodado de forma deliberada, uma
vez, por quem tem acesso ao Azure (`az login`) e ao firewall do Postgres. Ordem pensada para manter
tudo consistente se algo falhar:
  1) segredo novo da senha do papel no Container App (se falhar/for barrado: ABORTA, banco intocado);
  2) banco: papel + schema + mover as tabelas, numa transacao, com verificacao antes do commit;
  3) configuracao do Directus (DB_USER, DB_SEARCH_PATH, DB_PASSWORD -> segredo novo) = revisao nova.
Se o passo 3 falhar depois do 2, REVERTE o banco para o estado anterior.

A senha do papel e gerada aqui (64 caracteres), vive so em memoria e no segredo `dbpasswordapp` do
Container App; nao e impressa. Para rotacionar depois: rode de novo (o papel ja existe, so a senha
muda) ou use `isolar_directus.py aplicar` com outra DIRECTUS_DB_PASSWORD e atualize o segredo.

Pre-requisitos: o IP desta maquina precisa estar na regra `AllowAdminMachine` do firewall do
Postgres (`az postgres flexible-server firewall-rule update -g Associacao-RG -s asaf-pg-server
-n AllowAdminMachine --start-ip-address <IP> --end-ip-address <IP>`).

Ensaiado em banco descartavel em 2026-10-01 (15/15 verificacoes, ver PLANO v5.1.0).
Depois de aplicar, rode `python scripts/isolar_directus.py verificar` com DATABASE_URL.
"""
import os
import secrets
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import isolar_directus as iso  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
RG, APP = "Associacao-RG", "asaf-directus"


def az(args: str):
    r = subprocess.run(f"az {args}", shell=True, capture_output=True, text=True)
    if r.returncode != 0:
        print("az falhou:", (r.stderr or r.stdout).strip().splitlines()[-1][:300])
    return r


def main() -> int:
    dsn = az("keyvault secret show --vault-name kv-asaf-arca --name DATABASE-URL --query value -o tsv").stdout.strip()
    senha = secrets.token_urlsafe(48)

    print("[1/3] gravando o segredo 'dbpasswordapp' no Container App...")
    if az(f"containerapp secret set -g {RG} -n {APP} --secrets dbpasswordapp={senha} -o none").returncode != 0:
        print("ABORTADO no passo 1 — o banco NAO foi tocado.")
        return 1

    print("[2/3] aplicando no banco (transacao unica)...")
    os.environ["DATABASE_URL"] = dsn
    conn = iso.conectar()
    try:
        cur = conn.cursor()
        iso.aplicar(cur, senha)
        falhas = iso.verificar(cur)
        if falhas:
            conn.rollback()
            print("verificacao falhou, rollback:", falhas)
            return 1
        conn.commit()
        print("banco: isolamento aplicado e verificado (commit).")
    finally:
        conn.close()

    print("[3/3] atualizando o Directus (DB_USER/DB_SEARCH_PATH/DB_PASSWORD)...")
    r = az(f"containerapp update -g {RG} -n {APP} --set-env-vars DB_USER=directus_app DB_SEARCH_PATH=directus "
           f"DB_PASSWORD=secretref:dbpasswordapp --query properties.latestRevisionName -o tsv")
    if r.returncode != 0:
        print("PASSO 3 FALHOU — revertendo o banco para o estado anterior...")
        conn = iso.conectar()
        try:
            iso.reverter(conn.cursor())
            conn.commit()
        finally:
            conn.close()
        print("banco revertido; o Directus segue na configuracao antiga.")
        return 1
    print("nova revisao:", r.stdout.strip().splitlines()[-1])
    print("OK passos 1-3 concluidos. Confirme: curl https://cms.asaf.org.br/server/ping e o login no Studio.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
