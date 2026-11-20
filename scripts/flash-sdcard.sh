#!/usr/bin/env bash
# ==============================================================================
# YacaCode — Gravação Segura da Imagem Pré-Configurada no Cartão SD (/dev/disk5)
# ==============================================================================
set -euo pipefail

IMG="/tmp/armbian_opizero2w.img"
DISK="/dev/disk5"
RDISK="/dev/rdisk5"

if [[ ! -f "$IMG" ]]; then
  echo "Erro: Imagem preparada $IMG não encontrada."
  exit 1
fi

# Trava de segurança: garante que /dev/disk5 é realmente o cartão USB externo removível
INFO="$(diskutil info "$DISK" 2>/dev/null || true)"
if ! echo "$INFO" | grep -q "Protocol:.*USB" || ! echo "$INFO" | grep -q "Removable Media:.*Removable"; then
  echo "ABORTADO POR SEGURANÇA: $DISK não é um dispositivo USB removível!"
  exit 1
fi

echo "[1/3] Desmontando $DISK..."
diskutil unmountDisk force "$DISK"

echo "[2/3] Gravando imagem YacaCode Armbian (Orange Pi Zero 2W) em $RDISK..."
dd if="$IMG" of="$RDISK" bs=4m status=progress
sync

echo "[3/3] Ejetando $DISK com segurança..."
diskutil eject "$DISK"

echo "✓ Cartão MicroSD gravado e pronto para colocar no Orange Pi Zero 2W!"
