#!/usr/bin/env bash
# ============================================================================
# provisionar.sh — reconstrução completa da infraestrutura Azure da ASAF
# ============================================================================
#
# O QUE É ISTO: a sequência real de comandos `az` usada para criar toda a
# infraestrutura de produção (Postgres, Container Apps, Storage, Key Vault,
# Static Web Apps, DNS, Service Principal). Serve para dois propósitos:
#
#   1. DOCUMENTAÇÃO VIVA — qualquer pessoa (mesmo sem ter participado da
#      criação original) entende exatamente como cada recurso nasceu, em que
#      ordem e com que parâmetro, sem depender de memória de quem fez.
#   2. PLANO DE RECUPERAÇÃO — se a assinatura Azure inteira for perdida
#      (cancelada, comprometida, migrada de titularidade), este script é o
#      roteiro para reconstruir tudo do zero, na ordem certa.
#
# O QUE ISTO NÃO É: não é Terraform/Bicep (não é declarativo, não é
# idempotente por padrão, não tem "terraform plan" para conferir antes de
# aplicar). Essa foi uma escolha deliberada e registrada em
# DECISOES_CONGELADAS.md — para o porte da ASAF, um script comentado e
# versionado entrega a maior parte do valor de "infraestrutura documentada
# e reconstruível" sem adicionar uma ferramenta nova para alguém aprender
# daqui a 10 anos. Se um dia o número de recursos crescer muito, migrar
# este script para Bicep é uma evolução possível — não uma dívida atual.
#
# NUNCA rodar este script inteiro contra o ambiente de produção existente
# sem revisar cada bloco antes — ele cria recursos, alguns comandos falham
# de propósito (com mensagem clara) se o recurso já existir, mas nem todos.
# Trate como referência a executar bloco a bloco, nunca como `./provisionar.sh`
# de uma vez só numa assinatura que já tem os recursos.
#
# NENHUM SEGREDO fica neste arquivo. Toda senha/connection string é gerada
# na hora (`openssl rand` / `az` gerando valor aleatório) e enviada direto
# para o Key Vault — nunca impressa no terminal, nunca gravada em variável
# de shell que sobreviva ao comando. Ver CREDENCIAIS_AZURE.md (não versionado,
# só local) para os nomes/endpoints reais já criados.
#
# ============================================================================

set -euo pipefail

# ----------------------------------------------------------------------------
# 0. Variáveis — nomes de recursos (não são segredo, mas mantidos como
#    variável para nunca precisar editar o script em vários lugares).
#    Preencher/conferir contra CREDENCIAIS_AZURE.md antes de rodar qualquer
#    bloco. Subscription ID e Tenant ID propositalmente NÃO estão fixados
#    aqui — vêm do `az login` já autenticado na sessão de quem executa.
# ----------------------------------------------------------------------------
RESOURCE_GROUP="Associacao-RG"
LOCATION="brazilsouth"
LOCATION_SWA="centralus"          # Static Web Apps não está disponível em Brazil South

PG_SERVER="asaf-pg-server"
PG_DB="asaf_db"
PG_ADMIN_USER="asafadmin"

ACR_NAME="asafregistry"
CONTAINERAPPS_ENV="asaf-env"
APP_API="asaf-api"
APP_DIRECTUS="asaf-directus"

STORAGE_ACCOUNT="stasafarcadafamilia"
KEY_VAULT="kv-asaf-arca"
APP_INSIGHTS="asaf-appinsights"

SWA_SITE="asaf-site"
SWA_PAINEL="asaf-painel"

DOMINIO="asaf.org.br"

SP_GITHUB="asaf-github-actions"
GITHUB_ORG_REPO="Arca-da-Familia/asaf"

echo "Confira as variáveis acima contra CREDENCIAIS_AZURE.md antes de continuar."
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
#    SKU Burstable B1ms, Postgres 16, 32GB, backup 35 dias + geo-redundância
#    (geo-redundância só é configurável NA CRIAÇÃO, não pode ser ligada
#    depois — não esquecer este parâmetro numa reconstrução).
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

# Regra de firewall permanente — ver DECISOES_CONGELADAS.md sobre por que
# NÃO restringir isto a um IP específico do Container Apps (o "staticIp" do
# ambiente é só de entrada, não de saída; sem VNET+NAT Gateway não há IP de
# saída fixo, e VNET+NAT Gateway está fora do orçamento de US$100/mês).
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
  --display-name "asaf@arcadafamilia.org" \
  --object-id "<object-id-do-usuario-entra-id>"

# A senha gerada acima (PG_SENHA_TEMP) precisa ir DIRETO para o Key Vault
# no passo 6 — nunca fica de fato "guardada" em lugar nenhum além dele.

# ----------------------------------------------------------------------------
# 3. Azure Container Registry (build de imagem sem Docker local)
# ----------------------------------------------------------------------------
az acr create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$ACR_NAME" \
  --sku Basic \
  --admin-enabled false

# ----------------------------------------------------------------------------
# 4. Ambiente de Container Apps + as duas aplicações (API e Directus)
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
# (a imagem real é publicada depois pelo workflow deploy-api.yml via `az acr
# build` + `az containerapp update` — aqui só se cria o "esqueleto" do app)

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

# Conceder ao Container App da API permissão de leitura do Key Vault via
# identidade gerenciada (nunca via senha/connection string do Vault):
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

# Domínio customizado (depois de configurar a zona DNS no passo 9):
az staticwebapp hostname set --name "$SWA_SITE" --hostname "$DOMINIO"
az staticwebapp hostname set --name "$SWA_PAINEL" --hostname "painel.${DOMINIO}"

# ----------------------------------------------------------------------------
# 9. DNS — zona Azure DNS para o domínio asaf.org.br
#    IMPORTANTE numa reconstrução: os registros MX e DKIM do Google Workspace
#    (e-mail institucional) precisam ser recriados ANTES de trocar o
#    nameserver no Registro.br, ou o e-mail para de funcionar. Ver
#    CREDENCIAIS_AZURE.md para os valores exatos de MX/TXT/DKIM já em uso.
# ----------------------------------------------------------------------------
az network dns zone create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$DOMINIO"

# az network dns record-set mx add-record ...       (smtp.google.com)
# az network dns record-set txt add-record ...       (verificação Google)
# az network dns record-set cname create/add-record  (google._domainkey)
# az network dns record-set a add-record (Alias para o Static Web App do site)
# az network dns record-set cname add-record (painel.asaf.org.br -> asaf-painel)
#
# Depois de conferir que os 3 registros de e-mail estão na zona: trocar os
# nameservers no painel do Registro.br para os 4 que o Azure DNS informar
# (`az network dns zone show --name "$DOMINIO" -g "$RESOURCE_GROUP" --query nameServers`).

# ----------------------------------------------------------------------------
# 10. Service Principal para CI/CD via OIDC (GitHub Actions) — sem senha
#     de longa duração salva em lugar nenhum.
# ----------------------------------------------------------------------------
az ad app create --display-name "$SP_GITHUB"
APP_ID="$(az ad app list --display-name "$SP_GITHUB" --query '[0].appId' -o tsv)"
az ad sp create --id "$APP_ID"

# Escopo só ao resource group (nunca à assinatura inteira):
az role assignment create \
  --assignee "$APP_ID" \
  --role Contributor \
  --scope "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/${RESOURCE_GROUP}"

# Credenciais federadas — o subject precisa bater EXATAMENTE com o formato
# que o GitHub Actions envia hoje (inclui IDs numéricos de org/repo desde
# 2024; conferir contra a mensagem de erro AADSTS700213 se falhar):
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "asaf-github-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:'"$GITHUB_ORG_REPO"':ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "asaf-github-pr",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:'"$GITHUB_ORG_REPO"':pull_request",
  "audiences": ["api://AzureADTokenExchange"]
}'

echo "Client ID (vai para o GitHub Secret AZURE_CLIENT_ID): $APP_ID"
echo "Tenant ID (AZURE_TENANT_ID) e Subscription ID (AZURE_SUBSCRIPTION_ID):"
az account show --query "{tenant:tenantId, subscription:id}" -o table

# ----------------------------------------------------------------------------
# 11. Orçamento — a criação automatizada via API falhou nesta assinatura
#     (Microsoft Customer Agreement / Individual) em todas as combinações
#     testadas de endpoint e versão de API — limitação real, não erro de
#     comando. Configurar manualmente pelo Portal:
#     Cost Management + Billing → Budgets → Novo orçamento → US$100/mês →
#     alertas em 80% e 100% para o e-mail da conta administradora.
# ----------------------------------------------------------------------------

echo ""
echo "Provisionamento de referência concluído. Próximos passos manuais:"
echo "  1. Configurar o orçamento pelo Portal (passo 11 acima)."
echo "  2. Rodar 'alembic upgrade head' contra o banco novo para criar o schema."
echo "  3. Publicar os GitHub Secrets (AZURE_CLIENT_ID/TENANT_ID/SUBSCRIPTION_ID)."
echo "  4. Fazer o primeiro deploy manual (push em main aciona o CI/CD)."
