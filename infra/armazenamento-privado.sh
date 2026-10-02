#!/usr/bin/env bash
# Conta de armazenamento PRIVADA dos arquivos enviados à API (foto de associado, ata assinada,
# comprovante financeiro, documento emitido). Idempotente: pode rodar de novo sem estragar nada.
#
# POR QUE (achado de 2026-10-01): a API gravava tudo no disco efêmero do contêiner e os arquivos
# sumiam a cada deploy/reinício. Desenho completo e travas: app/services/armazenamento.py.
#
# Decisões:
#   - Conta NOVA e separada da `stasafarcadafamilia` (que é do Directus/site e usa chave de conta
#     inteira): dado de associado e dado público do site nunca dividem credencial.
#   - Sem chave: `--allow-shared-key-access false`. A API entra pela identidade gerenciada do
#     Container App com o papel "Storage Blob Data Contributor" - nada para vazar, nada para rotacionar.
#   - Sem acesso público a blob, TLS 1.2+, só HTTPS.
#   - GRS (cópia em outra região) - é dado de associado/ata, não se perde por incidente de datacenter.
#   - Soft delete 30 dias (blob e contêiner) + versionamento: apagar/sobrescrever por engano tem volta.
#
# Uso:  az login  &&  bash infra/armazenamento-privado.sh
# Depois da 1ª execução a API precisa da variável ARMAZENAMENTO_BLOB_URL (o script já define) e de
# alguns minutos para o papel propagar; ao subir, a API grava/lê/apaga uma sonda e recusa subir se falhar.
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-Associacao-RG}"
LOCATION="${LOCATION:-brazilsouth}"
STORAGE_ACCOUNT="${STORAGE_ACCOUNT:-stasafprivado}"
CONTAINER_APP="${CONTAINER_APP:-asaf-api}"
CONTAINERS=(fotos-associados atas comprovantes documentos-emitidos)  # mesmos nomes de PASTAS em armazenamento.py

if ! az storage account show -g "$RESOURCE_GROUP" -n "$STORAGE_ACCOUNT" >/dev/null 2>&1; then
  az storage account create \
    --resource-group "$RESOURCE_GROUP" --name "$STORAGE_ACCOUNT" --location "$LOCATION" \
    --kind StorageV2 --sku Standard_GRS \
    --min-tls-version TLS1_2 --https-only true \
    --allow-blob-public-access false --allow-shared-key-access false \
    --public-network-access Enabled >/dev/null
fi

# Garante as travas mesmo numa conta que já existia.
az storage account update -g "$RESOURCE_GROUP" -n "$STORAGE_ACCOUNT" \
  --min-tls-version TLS1_2 --https-only true \
  --allow-blob-public-access false --allow-shared-key-access false >/dev/null

az storage account blob-service-properties update \
  --resource-group "$RESOURCE_GROUP" --account-name "$STORAGE_ACCOUNT" \
  --enable-delete-retention true --delete-retention-days 30 \
  --enable-container-delete-retention true --container-delete-retention-days 30 \
  --enable-versioning true >/dev/null

# Contêineres pelo plano de controle (ARM): funciona com a chave desligada e sem papel de dados.
for conteiner in "${CONTAINERS[@]}"; do
  az storage container-rm create --resource-group "$RESOURCE_GROUP" \
    --storage-account "$STORAGE_ACCOUNT" --name "$conteiner" --public-access off >/dev/null
done

PRINCIPAL_ID="$(az containerapp show -g "$RESOURCE_GROUP" -n "$CONTAINER_APP" --query identity.principalId -o tsv)"
ACCOUNT_ID="$(az storage account show -g "$RESOURCE_GROUP" -n "$STORAGE_ACCOUNT" --query id -o tsv)"
if [ -z "$(az role assignment list --assignee "$PRINCIPAL_ID" --scope "$ACCOUNT_ID" \
      --role "Storage Blob Data Contributor" --query '[0].id' -o tsv)" ]; then
  az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
    --role "Storage Blob Data Contributor" --scope "$ACCOUNT_ID" >/dev/null
fi

BLOB_URL="https://${STORAGE_ACCOUNT}.blob.core.windows.net"
az containerapp update -g "$RESOURCE_GROUP" -n "$CONTAINER_APP" \
  --set-env-vars "ARMAZENAMENTO_BLOB_URL=${BLOB_URL}" >/dev/null

echo "Conta ${STORAGE_ACCOUNT} pronta; API ${CONTAINER_APP} aponta para ${BLOB_URL}."
echo "Aguarde alguns minutos (propagação do papel) antes de fazer o deploy da API."
