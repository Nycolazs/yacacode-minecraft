#!/usr/bin/env bash
# ==============================================================================
# YacaCode — Diagnóstico de Rede, Portas, DNS Cloudflare e CGNAT
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

MC_DOMAIN="${MC_DOMAIN:-mc.yacacode.com}"
PANEL_DOMAIN="${PANEL_DOMAIN:-painel.yacacode.com}"
MC_JAVA_PORT="${MC_JAVA_PORT:-25565}"
MC_BEDROCK_PORT="${MC_BEDROCK_PORT:-19132}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}=== Diagnóstico de Rede YacaCode Minecraft ===${NC}"
echo

# 1. IP local LAN
LOCAL_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || echo 'desconhecido')"
echo -e "IP Local (LAN) do Orange Pi: ${BOLD}${LOCAL_IP}${NC}"
echo "  → Use este IP nas regras de Port Forwarding (Redirecionamento de Portas) do seu roteador!"

# 2. IP público
PUBLIC_IP="$(curl -fsS --max-time 6 https://1.1.1.1/cdn-cgi/trace 2>/dev/null | awk -F= '/^ip=/{print $2}' || echo '')"
echo -e "IP Público da Internet:      ${BOLD}${PUBLIC_IP:-indisponível}${NC}"

# 3. Alerta CGNAT básico
if [[ "$PUBLIC_IP" =~ ^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\. ]]; then
  echo -e "${RED}⚠ ATENÇÃO: IP em faixa CGNAT (100.64.0.0/10)!${NC}"
  echo "  Sua operadora usa CGNAT. Veja docs/CLOUDFLARE-E-DOMINIO.md para solicitar IP público ou usar túnel TCP/UDP."
else
  echo -e "${GREEN}✓ IP externo fora da faixa CGNAT padrão.${NC}"
  echo "  (Confira também na página WAN do roteador se o IP WAN é igual a ${PUBLIC_IP:-seu IP público}.)"
fi

echo
# 4. Resolução DNS
DNS_IP="$(dig +short A "$MC_DOMAIN" @1.1.1.1 2>/dev/null | head -n 1 || true)"
echo "DNS de $MC_DOMAIN (via 1.1.1.1): ${DNS_IP:-não resolvido}"
if [[ -n "$PUBLIC_IP" && "$DNS_IP" == "$PUBLIC_IP" ]]; then
  echo -e "${GREEN}✓ Domínio $MC_DOMAIN aponta exatamente para o seu IP público!${NC}"
elif [[ -n "$DNS_IP" ]]; then
  echo -e "${YELLOW}⚠ $MC_DOMAIN aponta para $DNS_IP, mas seu IP público atual é $PUBLIC_IP.${NC}"
  echo "  Verifique se o Proxy (nuvem laranja) está DESLIGADO (nuvem cinza) na Cloudflare e se o DDNS está ativo."
else
  echo -e "${YELLOW}⚠ Ainda não há registro A para $MC_DOMAIN. Rode ./scripts/setup-cloudflare-dns.sh${NC}"
fi

echo
# 5. Containers Docker
if command -v docker >/dev/null 2>&1; then
  echo -e "${BOLD}Status dos containers YacaCode:${NC}"
  docker ps -a --filter "name=yacacode-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" || true
fi

echo
echo -e "${BOLD}Resumo das Portas para Liberar no Roteador (Port Forwarding → ${LOCAL_IP}):${NC}"
echo "  • Java Edition:    ${MC_JAVA_PORT}  (TCP)"
echo "  • Bedrock Edition: ${MC_BEDROCK_PORT}  (UDP + TCP — obrigatório para NetherNet 2026)"
echo "  • Painel Admin:    NENHUMA porta no roteador! (Exposto via Cloudflare Tunnel em https://${PANEL_DOMAIN})"
