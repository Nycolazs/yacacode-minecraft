#!/usr/bin/env bash
# ==============================================================================
# YacaCode — Relay TCP/UDP via Tailscale (Bypass CGNAT / Operadora Bloqueada)
# ==============================================================================
# Execute ESTE script na sua VPS (ex: vps-relay / 100.115.95.11) como root:
#   sudo ./setup-vps-relay.sh 100.73.198.14
#
# Ele encaminha as portas do Minecraft (Java 25565 TCP + Bedrock 19132 TCP/UDP)
# do IP público fixo da VPS direto para o Orange Pi pelo túnel Tailscale,
# sem precisar abrir portas no roteador da sua casa e ocultando seu IP residencial!
# ==============================================================================
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Execute como root: sudo $0 [IP_TAILSCALE_DO_ORANGEPI]"
  exit 1
fi

ORANGEPI_TS_IP="${1:-100.73.198.14}"
PUB_IFACE="$(ip route show default | awk '/default/ {print $5; exit}')"

if [[ -z "$PUB_IFACE" ]]; then
  echo "Não foi possível detectar a interface de rede pública da VPS."
  exit 1
fi

echo "=== Configurando Relay Minecraft YacaCode ==="
echo "Interface pública da VPS: $PUB_IFACE"
echo "Destino Orange Pi (Tailscale): $ORANGEPI_TS_IP"

# 1. Ativar IP forwarding no kernel
cat > /etc/sysctl.d/99-yacacode-relay.conf <<'EOF'
net.ipv4.ip_forward=1
EOF
sysctl -p /etc/sysctl.d/99-yacacode-relay.conf >/dev/null

# 2. Script idempotente das regras iptables
cat > /usr/local/sbin/yacacode-relay-rules.sh <<EOF
#!/usr/bin/env bash
set -euo pipefail
PUB_IFACE="${PUB_IFACE}"
DEST="${ORANGEPI_TS_IP}"

apply_rule() {
  local table="\$1"; shift
  iptables -t "\$table" -C "\$@" 2>/dev/null || iptables -t "\$table" -A "\$@"
}

# Java Edition (25565/TCP)
apply_rule nat PREROUTING -i "\$PUB_IFACE" -p tcp --dport 25565 -j DNAT --to-destination "\${DEST}:25565"
apply_rule nat POSTROUTING -o tailscale0 -p tcp -d "\$DEST" --dport 25565 -j MASQUERADE
apply_rule filter FORWARD -i "\$PUB_IFACE" -o tailscale0 -p tcp -d "\$DEST" --dport 25565 -j ACCEPT
apply_rule filter FORWARD -i tailscale0 -o "\$PUB_IFACE" -m state --state RELATED,ESTABLISHED -j ACCEPT

# Bedrock Edition NetherNet (19132/UDP + 19132/TCP)
apply_rule nat PREROUTING -i "\$PUB_IFACE" -p udp --dport 19132 -j DNAT --to-destination "\${DEST}:19132"
apply_rule nat POSTROUTING -o tailscale0 -p udp -d "\$DEST" --dport 19132 -j MASQUERADE
apply_rule filter FORWARD -i "\$PUB_IFACE" -o tailscale0 -p udp -d "\$DEST" --dport 19132 -j ACCEPT

apply_rule nat PREROUTING -i "\$PUB_IFACE" -p tcp --dport 19132 -j DNAT --to-destination "\${DEST}:19132"
apply_rule nat POSTROUTING -o tailscale0 -p tcp -d "\$DEST" --dport 19132 -j MASQUERADE
apply_rule filter FORWARD -i "\$PUB_IFACE" -o tailscale0 -p tcp -d "\$DEST" --dport 19132 -j ACCEPT
EOF
chmod +x /usr/local/sbin/yacacode-relay-rules.sh

# 3. Serviço systemd para reaplicar as regras automaticamente em todo boot da VPS
cat > /etc/systemd/system/yacacode-mc-relay.service <<'EOF'
[Unit]
Description=YacaCode Minecraft TCP/UDP Relay to Orange Pi via Tailscale
After=network-online.target tailscaled.service
Wants=network-online.target tailscaled.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/yacacode-relay-rules.sh

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now yacacode-mc-relay.service

# 4. Liberar portas no UFW caso esteja ativo na VPS
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 25565/tcp comment 'YacaCode MC Java Relay' >/dev/null
  ufw allow 19132/tcp comment 'YacaCode MC Bedrock NetherNet TCP' >/dev/null
  ufw allow 19132/udp comment 'YacaCode MC Bedrock NetherNet UDP' >/dev/null
  ufw route allow in on "$PUB_IFACE" out on tailscale0 to "$ORANGEPI_TS_IP" port 25565 proto tcp >/dev/null || true
  ufw route allow in on "$PUB_IFACE" out on tailscale0 to "$ORANGEPI_TS_IP" port 19132 proto tcp >/dev/null || true
  ufw route allow in on "$PUB_IFACE" out on tailscale0 to "$ORANGEPI_TS_IP" port 19132 proto udp >/dev/null || true
fi

VPS_PUBLIC_IP="$(curl -fsS --max-time 6 https://1.1.1.1/cdn-cgi/trace | awk -F= '/^ip=/{print $2}' || echo 'SEU_IP_DA_VPS')"
echo
echo "✓ Relay configurado e ativo 24/7 na VPS!"
echo "  Aponte na Cloudflare (Proxy DESLIGADO / DNS Only):"
echo "    Tipo: A | Nome: mc.yacacode.com | Conteúdo: ${VPS_PUBLIC_IP}"
