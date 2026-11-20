#!/usr/bin/env bash
# ==============================================================================
# YacaCode — Watchdog 24/7 para Orange Pi 4GB (Temperatura, Disco & Saúde)
# ==============================================================================
# Executado automaticamente pelo cron a cada 5 minutos após setup-orangepi.sh.
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

MAX_TEMP="${MAX_TEMP_ALERT_C:-78}"
WEBHOOK="${DISCORD_WEBHOOK_URL:-}"
STATE_FILE="/tmp/yacacode-watchdog.state"

notify() {
  local level="$1"
  local msg="$2"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $msg"
  if [[ -n "$WEBHOOK" ]]; then
    local payload
    payload="$(printf '{"content":"**[YacaCode Orange Pi — %s]** %s"}' "$level" "$msg")"
    curl -fsS -m 6 -H "Content-Type: application/json" -d "$payload" "$WEBHOOK" >/dev/null || true
  fi
}

# 1. Monitorar temperatura da CPU ARM do Orange Pi
if [[ -r /sys/class/thermal/thermal_zone0/temp ]]; then
  RAW_T="$(cat /sys/class/thermal/thermal_zone0/temp)"
  TEMP_C=$(( RAW_T / 1000 ))
  if (( TEMP_C >= MAX_TEMP )); then
    LAST_ALERT="$(grep '^TEMP=' "$STATE_FILE" 2>/dev/null | cut -d= -f2 || echo 0)"
    NOW="$(date +%s)"
    if (( NOW - LAST_ALERT > 1800 )); then
      notify "ALERTA TÉRMICO" "CPU do Orange Pi atingiu ${TEMP_C}°C (limite ${MAX_TEMP}°C). Verifique dissipador/cooler!"
      grep -v '^TEMP=' "$STATE_FILE" 2>/dev/null > "${STATE_FILE}.tmp" || true
      echo "TEMP=${NOW}" >> "${STATE_FILE}.tmp"
      mv "${STATE_FILE}.tmp" "$STATE_FILE"
    fi
  fi
fi

# 2. Monitorar espaço em disco (< 12% livre)
DISK_USE="$(df -P "$ROOT_DIR" | awk 'NR==2 {gsub("%",""); print $5}')"
if (( DISK_USE >= 88 )); then
  LAST_DISK="$(grep '^DISK=' "$STATE_FILE" 2>/dev/null | cut -d= -f2 || echo 0)"
  NOW="$(date +%s)"
  if (( NOW - LAST_DISK > 3600 )); then
    notify "DISCO CHEIO" "Armazenamento do Orange Pi em ${DISK_USE}% de uso. Limpe backups antigos."
    grep -v '^DISK=' "$STATE_FILE" 2>/dev/null > "${STATE_FILE}.tmp" || true
    echo "DISK=${NOW}" >> "${STATE_FILE}.tmp"
    mv "${STATE_FILE}.tmp" "$STATE_FILE"
  fi
fi

# 3. Monitorar saúde do container yacacode-mc (se estiver unhealthy, reinicia)
if command -v docker >/dev/null 2>&1; then
  MC_HEALTH="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' yacacode-mc 2>/dev/null || echo 'missing')"
  if [[ "$MC_HEALTH" == "unhealthy" ]]; then
    notify "AUTO-RECUPERAÇÃO" "Container yacacode-mc ficou UNHEALTHY. Executando restart seguro..."
    docker restart --time 60 yacacode-mc >/dev/null || true
  fi
fi
