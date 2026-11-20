#!/usr/bin/env bash
# ==============================================================================
# YacaCode Minecraft Server — Assistente de Configuração (.env)
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
EXAMPLE_FILE="$ROOT_DIR/.env.example"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${GREEN}${BOLD}"
echo "=============================================================="
echo "   YacaCode Minecraft Server — Configuração Inicial (24/7)"
echo "   PaperMC 26.3 • Java + Bedrock • Cloudflare • Orange Pi 4GB"
echo "==============================================================${NC}"
echo

if [[ -f "$ENV_FILE" ]]; then
  read -r -p "O arquivo .env já existe. Deseja criar um backup (.env.bak) e reconfigurar? [s/N]: " OVERWRITE
  if [[ ! "${OVERWRITE,,}" =~ ^(s|sim|y|yes)$ ]]; then
    echo "Operação cancelada. Seu .env atual foi mantido."
    exit 0
  fi
  cp "$ENV_FILE" "$ENV_FILE.bak"
  echo -e "${YELLOW}Backup criado em .env.bak${NC}"
fi

gen_secret() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import secrets; print(secrets.token_hex($bytes))"
  else
    tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$((bytes * 2))"
  fi
}

hash_password() {
  local pass="$1"
  if command -v node >/dev/null 2>&1; then
    PASS_INPUT="$pass" node -e "
      const c = require('node:crypto');
      const salt = c.randomBytes(16).toString('hex');
      const key = c.scryptSync(process.env.PASS_INPUT, salt, 64).toString('hex');
      process.stdout.write('scrypt$' + salt + '$' + key);
    "
  elif command -v python3 >/dev/null 2>&1; then
    PASS_INPUT="$pass" python3 -c "
import hashlib, os, secrets
salt = secrets.token_hex(16)
dk = hashlib.scrypt(os.environ['PASS_INPUT'].encode('utf-8'), salt=salt.encode('utf-8'), n=16384, r=8, p=1, dklen=64)
print(f'scrypt\${salt}\${dk.hex()}', end='')
"
  else
    echo ""
  fi
}

echo -e "${CYAN}1) Identidade & Domínios${NC}"
read -r -p "Nome do servidor [YacaCode]: " SERVER_NAME
SERVER_NAME="${SERVER_NAME:-YacaCode}"

read -r -p "Domínio para jogar (Java e Bedrock) [mc.yacacode.com]: " MC_DOMAIN
MC_DOMAIN="${MC_DOMAIN:-mc.yacacode.com}"

read -r -p "Domínio do Painel Admin (Cloudflare Tunnel) [painel.yacacode.com]: " PANEL_DOMAIN
PANEL_DOMAIN="${PANEL_DOMAIN:-painel.yacacode.com}"

read -r -p "Fuso horário [America/Fortaleza]: " TZ_VAL
TZ_VAL="${TZ_VAL:-America/Fortaleza}"

echo
echo -e "${CYAN}2) Acesso ao Painel Admin YacaCode${NC}"
read -r -p "Usuário administrador do painel [admin]: " PANEL_USER
PANEL_USER="${PANEL_USER:-admin}"

while true; do
  read -r -s -p "Senha forte para o Painel Admin (mín. 8 caracteres): " PANEL_PASS
  echo
  if [[ ${#PANEL_PASS} -lt 8 ]]; then
    echo -e "${YELLOW}Use pelo menos 8 caracteres para segurança na internet.${NC}"
    continue
  fi
  read -r -s -p "Confirme a senha: " PANEL_PASS2
  echo
  if [[ "$PANEL_PASS" != "$PANEL_PASS2" ]]; then
    echo -e "${YELLOW}As senhas não coincidem. Tente novamente.${NC}"
    continue
  fi
  break
done

PASS_HASH="$(hash_password "$PANEL_PASS")"
RCON_PASS="$(gen_secret 24)"
SESSION_SECRET="$(gen_secret 32)"

echo
echo -e "${CYAN}3) Integração Cloudflare (pode deixar em branco e preencher depois no .env)${NC}"
echo "   • Tunnel Token: Cloudflare Zero Trust -> Networks -> Tunnels -> Docker"
read -r -p "CLOUDFLARE_TUNNEL_TOKEN (Enter para pular): " CF_TUNNEL_TOKEN

echo "   • DNS API Token: Cloudflare -> My Profile -> API Tokens -> Edit zone DNS"
read -r -p "CLOUDFLARE_DNS_API_TOKEN (Enter para pular): " CF_DNS_TOKEN

PROFILES="backup"
[[ -n "$CF_TUNNEL_TOKEN" ]] && PROFILES="${PROFILES},cloudflare"
[[ -n "$CF_DNS_TOKEN" ]] && PROFILES="${PROFILES},ddns"

read -r -p "Permitir acesso ao painel também pela rede local LAN (além do Tunnel)? [s/N]: " ALLOW_LAN
if [[ "${ALLOW_LAN,,}" =~ ^(s|sim|y|yes)$ ]]; then
  PANEL_BIND="0.0.0.0"
else
  PANEL_BIND="127.0.0.1"
fi

read -r -p "Permitir versões Java mais antigas com ViaVersion + ViaBackwards? [s/N]: " USE_VIA
if [[ "${USE_VIA,,}" =~ ^(s|sim|y|yes)$ ]]; then
  MODRINTH_PLUGINS="chunky,viaversion,viabackwards"
else
  MODRINTH_PLUGINS="chunky"
fi

# Gera .env a partir do template
cp "$EXAMPLE_FILE" "$ENV_FILE"

set_env() {
  local key="$1"
  local val="$2"
  python3 - "$ENV_FILE" "$key" "$val" <<'PYEOF'
import sys
path, key, val = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()
out = []
found = False
for line in lines:
    if line.startswith(f"{key}="):
        out.append(f"{key}={val}\n")
        found = True
    else:
        out.append(line)
if not found:
    out.append(f"{key}={val}\n")
with open(path, 'w', encoding='utf-8') as f:
    f.writelines(out)
PYEOF
}

set_env "COMPOSE_PROFILES" "$PROFILES"
set_env "TZ" "$TZ_VAL"
set_env "SERVER_NAME" "$SERVER_NAME"
set_env "MC_DOMAIN" "$MC_DOMAIN"
set_env "PANEL_DOMAIN" "$PANEL_DOMAIN"
set_env "MC_MODRINTH_PLUGINS" "$MODRINTH_PLUGINS"
set_env "RCON_PASSWORD" "$RCON_PASS"
set_env "PANEL_BIND_IP" "$PANEL_BIND"
set_env "PANEL_ADMIN_USER" "$PANEL_USER"
set_env "PANEL_SESSION_SECRET" "$SESSION_SECRET"
set_env "CLOUDFLARE_TUNNEL_TOKEN" "$CF_TUNNEL_TOKEN"
set_env "CLOUDFLARE_DNS_API_TOKEN" "$CF_DNS_TOKEN"

if [[ -n "$PASS_HASH" ]]; then
  set_env "PANEL_ADMIN_PASSWORD_HASH" "'$PASS_HASH'"
  set_env "PANEL_ADMIN_PASSWORD" ""
else
  set_env "PANEL_ADMIN_PASSWORD_HASH" ""
  set_env "PANEL_ADMIN_PASSWORD" "$PANEL_PASS"
fi

chmod 600 "$ENV_FILE"

echo
echo -e "${GREEN}${BOLD}✓ Arquivo .env criado e protegido (chmod 600)!${NC}"
echo "  • Perfis ativados: $PROFILES"
echo "  • Senha RCON e Session Secret gerados com entropia criptográfica"
if [[ -n "$PASS_HASH" ]]; then
  echo "  • Senha do painel armazenada em hash scrypt (nunca em texto puro)"
fi
echo
echo -e "${BOLD}Próximos passos:${NC}"
echo "  1. No Orange Pi: sudo ./scripts/setup-orangepi.sh"
echo "  2. (Opcional) Configurar DNS A/SRV automático: ./scripts/setup-cloudflare-dns.sh"
echo "  3. Iniciar a stack 24/7: docker compose up -d --build"
echo "  4. Após o 1º boot terminar, clique em 'Aplicar Presets YacaCode' no Painel Admin!"
