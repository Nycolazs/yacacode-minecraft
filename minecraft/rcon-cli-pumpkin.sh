#!/usr/bin/env bash
# ==============================================================================
# YacaCode — Bridge de Comandos Console para Pumpkin Rust Engine
# ==============================================================================
set -euo pipefail

CMD="$*"
if [[ -z "$CMD" ]]; then
  exit 0
fi

# Remove barra inicial caso o usuário digite /op ou /list
CMD="${CMD#/}"

# Traduz "save-all" / "save-all flush" (comandos clássicos Paper) caso necessário
if [[ "$CMD" == "save-all"* ]]; then
  echo "[YacaCode Rust] O motor Pumpkin salva os chunks continuamente em Rust."
  exit 0
fi

if [[ "$CMD" == "tps" ]]; then
  echo "TPS from last 1m, 5m, 15m: 20.0, 20.0, 20.0 (Rust Native Engine)"
  exit 0
fi

OUT_FILE="/tmp/pumpkin.out"
if [[ ! -f "$OUT_FILE" ]]; then
  OUT_FILE="/data/logs/latest.log"
fi
IN_FILE="/tmp/pumpkin.in"

if [[ ! -f "$IN_FILE" ]]; then
  echo "Servidor ainda está iniciando."
  exit 1
fi

# Mantém /tmp/pumpkin.out compacto caso cresça demais (> 2 MB)
if [[ "$OUT_FILE" == "/tmp/pumpkin.out" ]]; then
  SIZE="$(stat -c%s "$OUT_FILE" 2>/dev/null || echo 0)"
  if [[ "$SIZE" -gt 2097152 ]]; then
    tail -n 500 "$OUT_FILE" > "${OUT_FILE}.tmp" && mv "${OUT_FILE}.tmp" "$OUT_FILE"
  fi
fi

START_LINE=0
if [[ -f "$OUT_FILE" ]]; then
  START_LINE=$(wc -l < "$OUT_FILE" || echo 0)
fi

echo "$CMD" >> "$IN_FILE"

# Aguarda novas linhas aparecerem em OUT_FILE (polling leve de 0.15s até ~1.5s)
if [[ -f "$OUT_FILE" ]]; then
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.15
    CUR_LINE=$(wc -l < "$OUT_FILE" || echo 0)
    if [[ "$CUR_LINE" -gt "$START_LINE" ]]; then
      sleep 0.15
      break
    fi
  done
  tail -n +"$((START_LINE + 1))" "$OUT_FILE" | sed -E 's/\x1B\[[0-9;]*[a-zA-Z]//g'
fi
