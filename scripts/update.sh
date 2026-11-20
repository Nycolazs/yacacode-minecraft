#!/usr/bin/env bash
# ==============================================================================
# YacaCode — Atualização Segura 24/7 (Backup -> Pull -> Rebuild -> Up)
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== [1/4] Criando backup de segurança antes de atualizar ==="
if docker ps --format '{{.Names}}' | grep -qx 'yacacode-backup'; then
  docker exec yacacode-backup backup now || echo "Aviso: backup pré-atualização falhou ou foi ignorado."
fi

echo "=== [2/4] Baixando imagens mais recentes (Java 25, Cloudflared, DDNS, Backup) ==="
docker compose pull

echo "=== [3/4] Reconstruindo o Painel YacaCode ==="
docker compose build panel

echo "=== [4/4] Aplicando atualizações com shutdown gracioso ==="
docker compose up -d --remove-orphans

echo "✓ Atualização concluída! Acompanhe os logs com: docker compose logs -f minecraft"
