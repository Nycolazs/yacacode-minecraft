#!/usr/bin/env bash
set -euo pipefail

cd /server
mkdir -p /server/plugins

# 1. Forwarding secret compartilhado com o Pumpkin Rust
SECRET="${VELOCITY_FORWARDING_SECRET:-yacacode-velocity-secret}"
printf '%s' "$SECRET" > /server/forwarding.secret
chmod 600 /server/forwarding.secret

# 2. Ícone oficial YacaCode
if [[ -f /assets/server-icon.png ]]; then
  cp /assets/server-icon.png /server/server-icon.png
fi

# 3. Gera velocity.toml otimizado se ainda não existir
if [[ ! -f /server/velocity.toml ]]; then
  cat > /server/velocity.toml <<'EOF'
config-version = "2.7"
bind = "0.0.0.0:25565"
motd = "<green><bold>YacaCode</bold></green> <dark_gray>|</dark_gray> <gold>Minecraft 26.3 (Rust)</gold>\n<gray>Java & Bedrock Crossplay • </gray><green>yacacode.com</green>"
show-max-players = 6
online-mode = false
force-key-authentication = false
prevent-client-proxy-connections = false
player-info-forwarding-mode = "modern"
forwarding-secret-file = "forwarding.secret"
announce-forge = false
kick-existing-players = false
ping-passthrough = "ALL"
enable-player-address-logging = true

[servers]
lobby = "minecraft:25565"
try = [
    "lobby"
]

[forced-hosts]

[advanced]
compression-threshold = 256
compression-level = -1
login-ratelimit = 3000
connection-timeout = 5000
read-timeout = 30000
haproxy-protocol = false
tcp-fast-open = false
bungee-plugin-message-channel = true
show-ping-requests = false
failover-on-unexpected-server-disconnect = true
announce-proxy-commands = true
log-command-executions = false
log-player-connections = true
accepts-transfers = true

[query]
enabled = false
port = 25565
map = "Velocity"
show-plugins = false
EOF
fi

# 4. Sincroniza plugins compatíveis enviados pelo Painel (ex: SkinsRestorer.jar)
if [[ -d /mc-plugins ]]; then
  for jar in /mc-plugins/*.jar; do
    [[ -f "$jar" ]] || continue
    base="$(basename "$jar")"
    # Ignora plugins exclusivos de Spigot/Paper
    case "$base" in
      Geyser-Spigot*|floodgate-spigot*|Chunky-Paper*)
        continue
        ;;
    esac
    cp -f "$jar" "/server/plugins/$base"
  done
fi

echo "[YacaCode Velocity] Iniciando Velocity 4.3.1 (Java 25) -> backend minecraft:25565..."
exec java \
  -Xms128M \
  -Xmx256M \
  -XX:+UseG1GC \
  -XX:G1HeapRegionSize=4M \
  -XX:+UnlockExperimentalVMOptions \
  -XX:+ParallelRefProcEnabled \
  -XX:+AlwaysPreTouch \
  -jar /opt/velocity/velocity.jar
