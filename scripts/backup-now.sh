#!/usr/bin/env bash
# ==============================================================================
# YacaCode — Backup Imediato Seguro via RCON
# ==============================================================================
set -euo pipefail

echo "Disparando backup seguro coordenado via RCON (save-off -> save-all -> tar.gz -> save-on)..."
docker exec yacacode-backup backup now
echo "✓ Backup finalizado! Arquivos em ./backups:"
ls -lh "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/backups" | tail -n 10
