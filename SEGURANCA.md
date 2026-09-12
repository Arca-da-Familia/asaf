# Segredos do projeto (SOPS + age)

Os segredos locais (`.env`, `CREDENCIAIS_AZURE.md`, `infra/provisionar.sh`) são
**criptografados com SOPS + age** e versionados de forma segura no repositório público.
O texto puro **nunca** é commitado — sobe sempre a versão cifrada (AES-256-GCM).

## Onde fica a chave

- **Privada** (de cada pessoa, **nunca** commitada):
  - Windows: `%APPDATA%\sops\age\keys.txt`
  - Linux/macOS: `~/.config/sops/age/keys.txt`
- **Públicas** (commitadas em `.sops.yaml`): uma linha `age1...` por colaborador.
  A criptografia usa a chave pública de **cada** pessoa; cada uma decifra com a **sua** privada.

> ⚠️ **Cada máquina gera a SUA chave (diferente da outra).** Nunca copie a chave privada
> de uma máquina para a outra. Se as duas usarem a mesma chave, perde-se a capacidade de
> revogar o acesso de uma pessoa separadamente, e a chave "passeia" entre máquinas (mais risco).

## Criptografar / descriptografar / editar

```bash
# Criptografar (sobrescreve o arquivo local com a versão cifrada)
sops -e -i .env
sops -e -i CREDENCIAIS_AZURE.md
sops -e -i infra/provisionar.sh

# Descriptografar (imprime no terminal)
sops -d CREDENCIAIS_AZURE.md

# Editar um arquivo cifrado (abre no editor, decifra e recifra ao salvar)
sops CREDENCIAIS_AZURE.md
```

## Nova máquina (colaborador) — uma única vez

0. Ativar o pre-commit hook: `git config core.hooksPath .githooks`
1. Instalar: `winget install FiloSottile.age SecretsOPerationS.SOPS`
2. Gerar a **SUA** chave (diferente da outra máquina — nunca copie a de lá):
   `age-keygen -o %APPDATA%\sops\age\keys.txt`
3. Ver a chave pública: `age-keygen -y %APPDATA%\sops\age\keys.txt`
4. Adicionar a `age1...` no `.sops.yaml` (junto às demais).
5. Recifrar para todas as chaves:
   `sops updatekeys .env CREDENCIAIS_AZURE.md infra/provisionar.sh`
6. Commitar o `.sops.yaml` e os arquivos recifrados.

## Pre-commit hook (proteção automática)

O hook em `.githooks/pre-commit` bloqueia qualquer commit que tente subir `.env`,
`CREDENCIAIS_AZURE.md` ou `infra/provisionar.sh` em **texto puro**. Ative com:

```
git config core.hooksPath .githooks
```

## Atenção

- **Nunca** commite texto puro. Se rodar `sops -d` em um arquivo, recifre com `sops -e -i` antes de commitar.
- Perder a chave privada = perder o acesso aos arquivos cifrados. Faça backup dela.
