#!/usr/bin/env bash
# ==============================================================================
# YacaCode Minecraft Server — Provisionamento 24/7 para Orange Pi 4GB (ARM64)
# ==============================================================================
# O que este script configura de forma segura e idempotente:
#   1. Docker Engine + Docker Compose v2 (ARM64 nativo)
#   2. ZRAM (2GB comprimido na RAM) + Swapfile de emergência (2GB)
#   3. Kernel sysctl otimizado para 4GB RAM + proteção de SD/eMMC
#   4. Rotação de logs global do Docker (evita lotar o disco em 24/7)
#   5. Firewall UFW (libera apenas SSH 22, Java 25565/tcp e Bedrock 19132 tcp+udp)
#   6. Serviço systemd para boot automático após queda de energia
#   7. Cron do watchdog térmico/saúde a cada 5 minutos
# ==============================================================================
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Execute como root: sudo ./scripts/setup-orangepi.sh"
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REAL_USER="${SUDO_USER:-$(whoami)}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${GREEN}${BOLD}"
echo "=============================================================="
echo "   YacaCode — Setup de Produção 24/7 para Orange Pi 4GB ARM64"
echo "==============================================================${NC}"
echo "Diretório do projeto: $PROJECT_DIR"
echo "Arquitetura detectada: $(uname -m) | RAM: $(free -h | awk '/Mem:/ {print $2}')"
echo

# 1. Atualizar pacotes essenciais
echo -e "${CYAN}[1/7] Instalando dependências base...${NC}"
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg lsb-release jq ufw dnsutils zram-tools

# 2. Instalar Docker + Compose v2 se necessário
echo -e "${CYAN}[2/7] Verificando Docker Engine e Docker Compose v2...${NC}"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
else
  echo "  ✓ Docker já instalado: $(docker --version)"
fi

if [[ "$REAL_USER" != "root" ]] && id "$REAL_USER" >/dev/null 2>&1; then
  usermod -aG docker "$REAL_USER" || true
fi

# 3. Configurar rotação de logs do Docker (protege SD/eMMC)
echo -e "${CYAN}[3/7] Configurando rotação de logs do Docker...${NC}"
mkdir -p /etc/docker
if [[ ! -f /etc/docker/daemon.json ]]; then
  cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "live-restore": true
}
EOF
  systemctl restart docker
else
  echo "  • /etc/docker/daemon.json já existe (mantido sem sobrescrever)."
fi

# 4. Configurar ZRAM + Swapfile + Tuning Kernel para 4GB RAM
echo -e "${CYAN}[4/7] Otimizando memória (ZRAM + Swap + Sysctl) para 4GB RAM...${NC}"
if [[ -f /etc/default/zramswap ]]; then
  cat > /etc/default/zramswap <<'EOF'
ALGO=lz4
PERCENT=50
PRIORITY=100
EOF
  systemctl enable --now zramswap || true
  systemctl restart zramswap || true
fi

if [[ ! -f /swapfile ]] && [[ "$(swapon --show=NAME --noheadings | grep -c '/swapfile' || true)" -eq 0 ]]; then
  echo "  • Criando swapfile de segurança (2GB, prioridade baixa abaixo do ZRAM)..."
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile
  swapon -p 10 /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw,pri=10 0 0' >> /etc/fstab
else
  echo "  ✓ Swapfile já configurado."
fi

cat > /etc/sysctl.d/99-yacacode-minecraft.conf <<'EOF'
# Otimização YacaCode para Orange Pi 4GB rodando Minecraft 24/7
vm.swappiness=20
vm.vfs_cache_pressure=50
vm.dirty_ratio=15
vm.dirty_background_ratio=5
net.core.rmem_max=16777216
net.core.wmem_max=16777216
EOF
sysctl --system >/dev/null

# 5. Configurar Firewall UFW (Painel 8080 NÃO é exposto; apenas SSH + Java + Bedrock)
echo -e "${CYAN}[5/7] Configurando Firewall UFW...${NC}"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp comment 'SSH Admin' >/dev/null
ufw allow 25565/tcp comment 'Minecraft Java Edition' >/dev/null
ufw allow 19132/udp comment 'Minecraft Bedrock Geyser WebRTC/RakNet' >/dev/null
ufw allow 19132/tcp comment 'Minecraft Bedrock Geyser NetherNet' >/dev/null
ufw --force enable >/dev/null
echo "  ✓ UFW ativo: 22/tcp, 25565/tcp, 19132/tcp, 19132/udp (porta 8080 protegida via Cloudflare Tunnel)."

# 6. Serviço Systemd para iniciar automaticamente no boot após queda de energia
echo -e "${CYAN}[6/7] Criando serviço systemd (auto-start 24/7)...${NC}"
cat > /etc/systemd/system/yacacode-minecraft.service <<EOF
[Unit]
Description=YacaCode Minecraft Server Stack (Paper 26.3 + Panel + Cloudflare)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${PROJECT_DIR}
ExecStart=/usr/bin/docker compose up -d --remove-orphans
ExecStop=/usr/bin/docker compose down --timeout 90
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable yacacode-minecraft.service
echo "  ✓ Serviço yacacode-minecraft.service habilitado no boot."

# 7. Watchdog cron a cada 5 minutos
echo -e "${CYAN}[7/7] Configurando Watchdog 24/7 (temperatura + saúde dos containers)...${NC}"
chmod +x "${PROJECT_DIR}/scripts/"*.sh
cat > /etc/cron.d/yacacode-watchdog <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
*/5 * * * * root ${PROJECT_DIR}/scripts/watchdog.sh >> /var/log/yacacode-watchdog.log 2>&1
EOF
chmod 644 /etc/cron.d/yacacode-watchdog

# Garantir diretórios com permissões limpas
mkdir -p "${PROJECT_DIR}/minecraft/data" "${PROJECT_DIR}/backups"
chown -R "${REAL_USER}:${REAL_USER}" "${PROJECT_DIR}/backups" || true

echo
echo -e "${GREEN}${BOLD}✓ Orange Pi 4GB provisionado com sucesso para operação 24/7!${NC}"
echo
echo -e "${BOLD}Próximos passos:${NC}"
echo "  1. Configure o .env (se ainda não fez): ./scripts/configure.sh"
echo "  2. Inicie tudo agora: docker compose up -d --build"
echo "  3. Acompanhe o 1º boot: docker compose logs -f minecraft"
echo "  4. Verifique rede/portas: ./scripts/check-network.sh"
echo
echo -e "${YELLOW}Dica: Faça logout/login SSH caso seu usuário tenha acabado de entrar no grupo docker.${NC}"
