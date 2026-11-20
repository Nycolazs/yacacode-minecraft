#!/usr/bin/env bash
set -euo pipefail

cd /data

# 1. Garante que o binário ARM64/X64 do Pumpkin Rust está instalado
if [[ ! -x /usr/local/bin/pumpkin ]]; then
  if [[ -x /data/.bin/pumpkin ]]; then
    cp /data/.bin/pumpkin /usr/local/bin/pumpkin
    chmod +x /usr/local/bin/pumpkin
  else
    ARCH="$(uname -m)"
    if [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
      BIN_NAME="pumpkin-ARM64-Linux"
    else
      BIN_NAME="pumpkin-X64-Linux"
    fi
    echo "[YacaCode Rust Engine] Baixando ${BIN_NAME}..."
    mkdir -p /data/.bin
    curl -fsSL --retry 3 "https://github.com/Pumpkin-MC/Pumpkin/releases/download/nightly/${BIN_NAME}" -o /data/.bin/pumpkin
    chmod +x /data/.bin/pumpkin
    cp /data/.bin/pumpkin /usr/local/bin/pumpkin
  fi
fi

# 2. Aplica o ícone oficial 64x64 da YacaCode (icon.png e server-icon.png)
if [[ -f /assets/server-icon.png ]]; then
  cp /assets/server-icon.png /data/icon.png
  cp /assets/server-icon.png /data/server-icon.png
fi

# 3. Se pumpkin.toml ainda não existir, copia o template otimizado da YacaCode
if [[ ! -f /data/pumpkin.toml ]]; then
  cp /etc/pumpkin-default.toml /data/pumpkin.toml
fi

mkdir -p /data/logs /data/data
touch /data/logs/latest.log

# 4. Pipes de entrada/saída para comandos do Painel Admin e Assistente IA (rcon-cli)
rm -f /tmp/pumpkin.in /tmp/pumpkin.out /tmp/pumpkin.stdout.pipe
touch /tmp/pumpkin.in /tmp/pumpkin.out
mkfifo /tmp/pumpkin.stdout.pipe

# Replica stdout/stderr do Pumpkin tanto para Docker logs quanto para /tmp/pumpkin.out
tee -a /tmp/pumpkin.out < /tmp/pumpkin.stdout.pipe &
TEE_PID=$!

stop_server() {
  echo "[YacaCode Rust Engine] Recebido sinal de parada. Salvando mundo com segurança..."
  echo "stop" >> /tmp/pumpkin.in
  sleep 2
  kill "$TEE_PID" 2>/dev/null || true
  exit 0
}
trap stop_server SIGTERM SIGINT

echo "[YacaCode Rust Engine] Iniciando Pumpkin (Rust) — Java 26.3 + Bedrock NetherNet..."
tail -n 0 -f /tmp/pumpkin.in | /usr/local/bin/pumpkin > /tmp/pumpkin.stdout.pipe 2>&1 &
PUMPKIN_PID=$!
wait "$PUMPKIN_PID"
kill "$TEE_PID" 2>/dev/null || true
