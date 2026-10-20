#!/usr/bin/env bash
# Liga o E-MAIL do Directus (o editor do site): convite de editores e recuperação de senha (v5.7h, autorizado pelo Presidente em 2026-10-20).
# Idempotente: pode rodar de novo sem estragar nada (cada execução cria uma revisão nova do Container App, que reinicia o Directus em ~35 s).
#
# De onde vem: os cinco segredos `SMTP-*` que já estão no cofre `kv-asaf-arca` (os MESMOS que a API usa, conta do Google Workspace da associação). Eles são copiados para o Container App
# `asaf-directus` como segredos dele (não ficam em variável aberta) e ligados às variáveis que o Directus lê (EMAIL_TRANSPORT, EMAIL_FROM, EMAIL_SMTP_*). NENHUM valor é impresso.
#
# Uso:  az login  &&  bash infra/directus-email.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1

RESOURCE_GROUP="${RESOURCE_GROUP:-Associacao-RG}"
CONTAINER_APP="${CONTAINER_APP:-asaf-directus}"
COFRE="${COFRE:-kv-asaf-arca}"

ler() { az keyvault secret show --vault-name "$COFRE" --name "$1" --query value -o tsv | tr -d '\r'; }

HOST="$(ler SMTP-HOST)"
PORTA="$(ler SMTP-PORTA)"
USUARIO="$(ler SMTP-USUARIO)"
SENHA="$(ler SMTP-SENHA)"
REMETENTE="$(ler SMTP-REMETENTE)"
for nome in HOST PORTA USUARIO SENHA REMETENTE; do
  [ -n "${!nome}" ] || { echo "falta o segredo SMTP-$nome no cofre $COFRE"; exit 1; }
done
# porta 465 = TLS direto; 587 = começa sem criptografia e sobe para TLS (STARTTLS)
SEGURO=false
[ "$PORTA" = "465" ] && SEGURO=true

az containerapp secret set -n "$CONTAINER_APP" -g "$RESOURCE_GROUP" --output none --secrets \
  "smtp-host=$HOST" "smtp-porta=$PORTA" "smtp-usuario=$USUARIO" "smtp-senha=$SENHA" "smtp-remetente=$REMETENTE"

az containerapp update -n "$CONTAINER_APP" -g "$RESOURCE_GROUP" --output none --set-env-vars \
  EMAIL_TRANSPORT=smtp \
  EMAIL_FROM=secretref:smtp-remetente \
  EMAIL_SMTP_HOST=secretref:smtp-host \
  EMAIL_SMTP_PORT=secretref:smtp-porta \
  EMAIL_SMTP_USER=secretref:smtp-usuario \
  EMAIL_SMTP_PASSWORD=secretref:smtp-senha \
  EMAIL_SMTP_SECURE="$SEGURO"

echo "E-mail do Directus ligado no Container App $CONTAINER_APP (variáveis EMAIL_*; nenhum valor impresso)."
az containerapp show -n "$CONTAINER_APP" -g "$RESOURCE_GROUP" --query "properties.template.containers[0].env[?starts_with(name, 'EMAIL_')].name" -o tsv
