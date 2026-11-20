#!/usr/bin/env bash
# ==============================================================================
# YacaCode — Descobrir e Conectar via SSH no Orange Pi Zero 2W na Rede Wi-Fi
# ==============================================================================
set -euo pipefail

GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}${BOLD}Procurando o Orange Pi Zero 2W (usuário: nycolas) na rede Wi-Fi brisa-Nyc...${NC}"

LOCAL_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '')"
if [[ -z "$LOCAL_IP" ]]; then
  echo "Não foi possível detectar o IP Wi-Fi deste Mac."
  exit 1
fi

SUBNET="$(echo "$LOCAL_IP" | awk -F. '{print $1"."$2"."$3".0/24"}')"
echo "Escaneando porta 22 (SSH) na sub-rede ${SUBNET}..."

CANDIDATES="$(nmap -p 22 --open -n -T4 "$SUBNET" 2>/dev/null | awk '/Nmap scan report for/{ip=$NF} /22\/tcp open/{print ip}')"

for ip in $CANDIDATES; do
  [[ "$ip" == "$LOCAL_IP" ]] && continue
  INFO="$(sshpass -p 'mariokart8' ssh -o ConnectTimeout=2 -o StrictHostKeyChecking=accept-new "nycolas@${ip}" "hostname; uname -r" 2>/dev/null || true)"
  if echo "$INFO" | grep -qiE 'orangepi|sunxi|yacacode'; then
    echo -e "${GREEN}${BOLD}✓ Orange Pi Zero 2W encontrado no IP: ${ip}${NC}"
    echo "$ip"
    exit 0
  fi
done

echo "Ainda não respondeu na porta 22. Aguarde ~60-90s após ligar o Orange Pi e rode novamente."
exit 1
