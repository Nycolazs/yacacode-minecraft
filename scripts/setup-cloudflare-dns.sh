#!/usr/bin/env bash
# ==============================================================================
# YacaCode — Configuração Automática de DNS na Cloudflare (Registro A + SRV)
# ==============================================================================
# Cria/atualiza o registro A (Proxy OFF / DNS Only) do seu domínio para o IP
# público do Orange Pi e, opcionalmente, o registro SRV _minecraft._tcp.
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo .env não encontrado. Execute ./scripts/configure.sh primeiro."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ -z "${CLOUDFLARE_DNS_API_TOKEN:-}" ]]; then
  echo "Defina CLOUDFLARE_DNS_API_TOKEN no arquivo .env antes de executar este script."
  exit 1
fi

if [[ -z "${MC_DOMAIN:-}" ]]; then
  echo "Defina MC_DOMAIN no arquivo .env (ex: mc.yacacode.com)."
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Instale o 'jq' primeiro (sudo apt install jq / brew install jq)."
  exit 1
fi

PUBLIC_IP="$(curl -fsS --max-time 8 https://1.1.1.1/cdn-cgi/trace | awk -F= '/^ip=/{print $2}')"
if [[ -z "$PUBLIC_IP" ]]; then
  echo "Não foi possível detectar seu IP público."
  exit 1
fi

echo "IP público detectado: $PUBLIC_IP"
echo "Domínio Minecraft:    $MC_DOMAIN (Java: ${MC_JAVA_PORT:-25565}, Bedrock: ${MC_BEDROCK_PORT:-19132})"

# Descobre a zona raiz na Cloudflare tentando sufixos do domínio
ZONE_ID=""
ZONE_NAME=""
IFS='.' read -ra PARTS <<< "$MC_DOMAIN"
for ((i=0; i<${#PARTS[@]}-1; i++)); do
  CANDIDATE="$(IFS='.'; echo "${PARTS[*]:i}")"
  RESP="$(curl -fsS -H "Authorization: Bearer ${CLOUDFLARE_DNS_API_TOKEN}" \
    "https://api.cloudflare.com/client/v4/zones?name=${CANDIDATE}&status=active")"
  FOUND_ID="$(echo "$RESP" | jq -r '.result[0].id // empty')"
  if [[ -n "$FOUND_ID" ]]; then
    ZONE_ID="$FOUND_ID"
    ZONE_NAME="$CANDIDATE"
    break
  fi
done

if [[ -z "$ZONE_ID" ]]; then
  echo "Não foi possível localizar a zona DNS para '$MC_DOMAIN' com o API Token fornecido."
  echo "Verifique se o token possui permissão 'Zone -> DNS -> Edit' para o domínio."
  exit 1
fi

echo "Zona Cloudflare encontrada: $ZONE_NAME (ID: $ZONE_ID)"

# 1. Criar ou atualizar registro A (OBRIGATÓRIO proxied=false para Minecraft!)
EXISTING_A="$(curl -fsS -H "Authorization: Bearer ${CLOUDFLARE_DNS_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?type=A&name=${MC_DOMAIN}" \
  | jq -r '.result[0].id // empty')"

A_PAYLOAD="$(jq -n --arg name "$MC_DOMAIN" --arg ip "$PUBLIC_IP" '{
  type: "A",
  name: $name,
  content: $ip,
  ttl: 120,
  proxied: false,
  comment: "YacaCode Minecraft Server (Java + Bedrock DNS Only)"
}')"

if [[ -n "$EXISTING_A" ]]; then
  RES="$(curl -fsS -X PUT \
    -H "Authorization: Bearer ${CLOUDFLARE_DNS_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$A_PAYLOAD" \
    "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${EXISTING_A}")"
  echo "✓ Registro A atualizado: $MC_DOMAIN -> $PUBLIC_IP (DNS Only)"
else
  RES="$(curl -fsS -X POST \
    -H "Authorization: Bearer ${CLOUDFLARE_DNS_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$A_PAYLOAD" \
    "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records")"
  echo "✓ Registro A criado: $MC_DOMAIN -> $PUBLIC_IP (DNS Only)"
fi

if [[ "$(echo "$RES" | jq -r '.success')" != "true" ]]; then
  echo "Erro na API Cloudflare:"
  echo "$RES" | jq .
  exit 1
fi

# 2. Registro SRV opcional (_minecraft._tcp) — útil se usar porta Java != 25565 ou domínio raiz
echo
read -r -p "Deseja também criar/atualizar o registro SRV (_minecraft._tcp.${MC_DOMAIN}) para Java Edition? [s/N]: " CREATE_SRV
if [[ "${CREATE_SRV,,}" =~ ^(s|sim|y|yes)$ ]]; then
  SRV_NAME="_minecraft._tcp.${MC_DOMAIN}"
  EXISTING_SRV="$(curl -fsS -H "Authorization: Bearer ${CLOUDFLARE_DNS_API_TOKEN}" \
    "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?type=SRV&name=${SRV_NAME}" \
    | jq -r '.result[0].id // empty')"

  SRV_PAYLOAD="$(jq -n \
    --arg name "$SRV_NAME" \
    --arg target "$MC_DOMAIN" \
    --argjson port "${MC_JAVA_PORT:-25565}" '{
      type: "SRV",
      name: $name,
      ttl: 120,
      data: {
        priority: 0,
        weight: 5,
        port: $port,
        target: $target
      },
      comment: "YacaCode Minecraft Java SRV"
    }')"

  if [[ -n "$EXISTING_SRV" ]]; then
    curl -fsS -X PUT \
      -H "Authorization: Bearer ${CLOUDFLARE_DNS_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$SRV_PAYLOAD" \
      "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${EXISTING_SRV}" >/dev/null
    echo "✓ Registro SRV atualizado: $SRV_NAME -> $MC_DOMAIN:${MC_JAVA_PORT:-25565}"
  else
    curl -fsS -X POST \
      -H "Authorization: Bearer ${CLOUDFLARE_DNS_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$SRV_PAYLOAD" \
      "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" >/dev/null
    echo "✓ Registro SRV criado: $SRV_NAME -> $MC_DOMAIN:${MC_JAVA_PORT:-25565}"
  fi
fi

echo
echo "Pronto! O container 'yacacode-ddns' manterá este IP atualizado automaticamente a cada 5 minutos."
