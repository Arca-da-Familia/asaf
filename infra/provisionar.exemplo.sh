#!/usr/bin/env bash
# ============================================================================
# provisionar.exemplo.sh — MODELO PÚBLICO do script de provisionamento
# ============================================================================
#
# Este arquivo é a versão SANITIZADA (nomes de recurso trocados por
# placeholder) do script real que reconstrói a infraestrutura Azure da ASAF.
#
# O script REAL, com os nomes de recurso verdadeiros (servidor Postgres,
# Key Vault, Storage Account, Service Principal, domínio), é
# `infra/provisionar.sh` — que NÃO é versionado neste repositório público,
# pelo mesmo motivo de `CREDENCIAIS_AZURE.md`: mesmo sem conter senha
# nenhuma, o nome exato de cada recurso é um mapa de alvo que não precisa
# estar acessível a qualquer pessoa na internet. Fica só localmente, com
# quem administra a infraestrutura.
#
# Este arquivo público serve para: (1) documentar o PADRÃO seguido (ordem
# de criação, decisões de configuração, o porquê de cada parâmetro) para
# quem for entender a arquitetura sem precisar de acesso à infraestrutura
# real; (2) servir de ponto de partida caso outra associação, com
# autorização de uso conforme a LICENSE deste projeto, queira provisionar
# a própria infraestrutura equivalente.
#
# Preencha os placeholders `<...>` com os nomes reais só na sua cópia local
# de `infra/provisionar.sh` (gitignored) — nunca aqui.
# ============================================================================

set -euo pipefail

# ----------------------------------------------------------------------------
# 0. Variáveis — troque cada placeholder pelo nome real na sua cópia local.
#    Subscription ID e Tenant ID propositalmente NÃO ficam fixados em
#    nenhuma versão deste script — vêm do `az login` já autenticado.
# ----------------------------------------------------------------------------
RESOURCE_GROUP="<nome-do-resource-group>"
LOCATION="brazilsouth"
LOCATION_SWA="centralus"          # Static Web Apps não está disponível em Brazil South

PG_SERVER="<nome-do-servidor-postgres>"
PG_DB="<nome-do-banco>"
PG_ADMIN_USER="<usuario-admin-postgres>"

ACR_NAME="<nome-do-container-registry>"
CONTAINERAPPS_ENV="<nome-do-ambiente-container-apps>"
APP_API="<nome-do-container-app-api>"
APP_DIRECTUS="<nome-do-container-app-directus>"

STORAGE_ACCOUNT="<nome-da-conta-de-storage>"
KEY_VAULT="<nome-do-key-vault>"
APP_INSIGHTS="<nome-do-application-insights>"

SWA_SITE="<nome-do-static-web-app-site>"
SWA_PAINEL="<nome-do-static-web-app-painel>"

DOMINIO="<seu-dominio.org.br>"

SP_GITHUB="<nome-do-service-principal-github-actions>"
GITHUB_ORG_REPO="<org>/<repositorio>"

echo "Confira as variáveis acima antes de continuar."
echo "Assinatura ativa no momento:"
az account show --query "{nome:name, id:id}" -o table

# ----------------------------------------------------------------------------
# 1. Grupo de recursos
# ----------------------------------------------------------------------------
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION"

# ----------------------------------------------------------------------------
# 2. Banco de dados — Azure Database for PostgreSQL Flexible Server
#    SKU Burstable B1ms, backup 35 dias + geo-redundância (só configurável
#    NA CRIAÇÃO — não pode ser ligada depois, não esquecer numa reconstrução).
# ----------------------------------------------------------------------------
PG_SENHA_TEMP="$(openssl rand -base64 24 | tr -d '=+/' | cut -c1-24)A1!"
az postgres flexible-server create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$PG_SERVER" \
  --location "$LOCATION" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --version 16 \
  --storage-size 32 \
  --backup-retention 35 \
  --geo-redundant-backup Enabled \
  --admin-user "$PG_ADMIN_USER" \
  --admin-password "$PG_SENHA_TEMP" \
  --database-name "$PG_DB" \
  --public-access 0.0.0.0-0.0.0.0 \
  --yes

# Regra de firewall permanente — decisão registrada em DECISOES_CONGELADAS.md
# seção 5.3: NÃO restringir a um IP específico do Container Apps (o
# "staticIp" do ambiente é só de entrada, não de saída; sem VNET+NAT Gateway
# não há IP de saída fixo, e isso fica fora do orçamento previsto).
az postgres flexible-server firewall-rule create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$PG_SERVER" \
  --rule-name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0

# Login por Entra ID como alternativa administrativa (não desativa o login
# por senha, soma uma segunda via de acesso administrativo desde a fundação).
az postgres flexible-server microsoft-entra-admin create \
  --resource-group "$RESOURCE_GROUP" \
  --server-name "$PG_SERVER" \
  --display-name "<seu-usuario@seudominio>" \
  --object-id "<object-id-do-usuario-entra-id>"

# ----------------------------------------------------------------------------
# 3. Azure Container Registry (build de imagem sem Docker local)
# ----------------------------------------------------------------------------
az acr create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$ACR_NAME" \
  --sku Basic \
  --admin-enabled false

# ----------------------------------------------------------------------------
# 4. Ambiente de Container Apps + aplicações (API e CMS)
#    Plano consumo, escala a zero quando ocioso.
# ----------------------------------------------------------------------------
az containerapp env create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$CONTAINERAPPS_ENV" \
  --location "$LOCATION"

az containerapp create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$APP_API" \
  --environment "$CONTAINERAPPS_ENV" \
  --image "mcr.microsoft.com/k8se/quickstart:latest" \
  --target-port 8000 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 2 \
  --system-assigned
# (a imagem real é publicada depois pelo workflow de CI/CD via `az acr build`
# + `az containerapp update` — aqui só se cria o "esqueleto" do app)

az acr login --name "$ACR_NAME"
az containerapp registry set \
  --resource-group "$RESOURCE_GROUP" \
  --name "$APP_API" \
  --server "${ACR_NAME}.azurecr.io" \
  --identity system

az containerapp create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$APP_DIRECTUS" \
  --environment "$CONTAINERAPPS_ENV" \
  --image "directus/directus:11" \
  --target-port 8055 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 1

# ----------------------------------------------------------------------------
# 5. Azure Blob Storage — uploads e documentos institucionais
# ----------------------------------------------------------------------------
az storage account create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$STORAGE_ACCOUNT" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2

az storage container create --account-name "$STORAGE_ACCOUNT" --name uploads --auth-mode login
az storage container create --account-name "$STORAGE_ACCOUNT" --name documentos-institucionais --auth-mode login

az storage account blob-service-properties update \
  --account-name "$STORAGE_ACCOUNT" \
  --enable-delete-retention true \
  --delete-retention-days 7 \
  --enable-versioning true

# ----------------------------------------------------------------------------
# 6. Key Vault — todos os segredos nascem aqui, nunca em texto no repositório
# ----------------------------------------------------------------------------
az keyvault create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$KEY_VAULT" \
  --location "$LOCATION"

az keyvault secret set --vault-name "$KEY_VAULT" --name "DATABASE-URL" \
  --value "postgresql://${PG_ADMIN_USER}:${PG_SENHA_TEMP}@${PG_SERVER}.postgres.database.azure.com:5432/${PG_DB}?sslmode=require"
unset PG_SENHA_TEMP   # some da memória do shell assim que vai para o Vault

az keyvault secret set --vault-name "$KEY_VAULT" --name "JWT-SECRET" \
  --value "$(openssl rand -base64 48)"

az keyvault secret set --vault-name "$KEY_VAULT" --name "STORAGE-ACCOUNT-KEY" \
  --value "$(az storage account keys list --account-name "$STORAGE_ACCOUNT" --query '[0].value' -o tsv)"

az keyvault set-policy \
  --name "$KEY_VAULT" \
  --object-id "$(az containerapp show -g "$RESOURCE_GROUP" -n "$APP_API" --query identity.principalId -o tsv)" \
  --secret-permissions get list

# ----------------------------------------------------------------------------
# 7. Application Insights — observabilidade (plano gratuito, 5GB/mês)
# ----------------------------------------------------------------------------
az monitor app-insights component create \
  --resource-group "$RESOURCE_GROUP" \
  --app "$APP_INSIGHTS" \
  --location "$LOCATION" \
  --application-type web

# ----------------------------------------------------------------------------
# 8. Static Web Apps — site institucional e painel
#    Região Central US: Static Web Apps não está disponível em Brazil South.
# ----------------------------------------------------------------------------
az staticwebapp create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$SWA_SITE" \
  --location "$LOCATION_SWA"

az staticwebapp create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$SWA_PAINEL" \
  --location "$LOCATION_SWA"

az keyvault secret set --vault-name "$KEY_VAULT" --name "SWA-SITE-DEPLOY-TOKEN" \
  --value "$(az staticwebapp secrets list --name "$SWA_SITE" --query properties.apiKey -o tsv)"
az keyvault secret set --vault-name "$KEY_VAULT" --name "SWA-PAINEL-DEPLOY-TOKEN" \
  --value "$(az staticwebapp secrets list --name "$SWA_PAINEL" --query properties.apiKey -o tsv)"

az staticwebapp hostname set --name "$SWA_SITE" --hostname "$DOMINIO"
az staticwebapp hostname set --name "$SWA_PAINEL" --hostname "painel.${DOMINIO}"

# ----------------------------------------------------------------------------
# 9. DNS — zona Azure DNS para o domínio próprio
#    IMPORTANTE numa reconstrução: registros MX/DKIM de e-mail (se houver
#    Google Workspace ou similar) precisam ser recriados ANTES de trocar o
#    nameserver no registrador do domínio, ou o e-mail para de funcionar.
# ----------------------------------------------------------------------------
az network dns zone create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$DOMINIO"

# az network dns record-set mx add-record ...       (provedor de e-mail)
# az network dns record-set txt add-record ...       (verificação de domínio)
# az network dns record-set cname create/add-record  (DKIM)
# az network dns record-set a add-record (Alias para o Static Web App do site)
# az network dns record-set cname add-record (subdominio do painel)
#
# Depois de conferir que os registros de e-mail estão na zona: trocar os
# nameservers no registrador para os que o Azure DNS informar
# (`az network dns zone show --name "$DOMINIO" -g "$RESOURCE_GROUP" --query nameServers`).

# ----------------------------------------------------------------------------
# 10. Service Principal para CI/CD via OIDC (GitHub Actions) — sem senha
#     de longa duração salva em lugar nenhum.
# ----------------------------------------------------------------------------
az ad app create --display-name "$SP_GITHUB"
APP_ID="$(az ad app list --display-name "$SP_GITHUB" --query '[0].appId' -o tsv)"
az ad sp create --id "$APP_ID"

az role assignment create \
  --assignee "$APP_ID" \
  --role Contributor \
  --scope "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/${RESOURCE_GROUP}"

# O subject precisa bater EXATAMENTE com o formato que o GitHub Actions envia
# hoje (inclui IDs numéricos de org/repo desde 2024; conferir contra a
# mensagem de erro AADSTS700213 se falhar):
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:'"$GITHUB_ORG_REPO"':ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-pr",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:'"$GITHUB_ORG_REPO"':pull_request",
  "audiences": ["api://AzureADTokenExchange"]
}'

echo "Client ID (vai para o GitHub Secret AZURE_CLIENT_ID): $APP_ID"
echo "Tenant ID (AZURE_TENANT_ID) e Subscription ID (AZURE_SUBSCRIPTION_ID):"
az account show --query "{tenant:tenantId, subscription:id}" -o table

# ----------------------------------------------------------------------------
# 11. Orçamento — se a criação automatizada via API falhar (limitação comum
#     em assinaturas Microsoft Customer Agreement/Individual), configurar
#     manualmente pelo Portal: Cost Management + Billing → Budgets → Novo
#     orçamento → alertas em 80% e 100% para o e-mail da conta administradora.
# ----------------------------------------------------------------------------

echo ""
echo "Provisionamento de referência concluído. Próximos passos manuais:"
echo "  1. Configurar o orçamento pelo Portal (passo 11 acima), se necessário."
echo "  2. Rodar 'alembic upgrade head' contra o banco novo para criar o schema."
echo "  3. Publicar os GitHub Secrets (AZURE_CLIENT_ID/TENANT_ID/SUBSCRIPTION_ID)."
echo "  4. Fazer o primeiro deploy manual (push em main aciona o CI/CD)."
