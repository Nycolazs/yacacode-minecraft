#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# YacaCode Minecraft — Publicador de Atualização Automática (OTA) para Android
# ============================================================================
# Uso:
#   ./scripts/release-android.sh 1.2.0 "Resumo das novidades desta versão"
#
# O que este script faz:
#   1. Incrementa versionCode e atualiza versionName no build.gradle.kts
#   2. Executa os testes unitários Android + build Release assinado (yacacode-release.jks)
#   3. Verifica a assinatura do APK com apksigner
#   4. Salva uma cópia em ~/Downloads/YacaCode-Minecraft-v<versao>.apk
#   5. Cria commit + tag v<versao>, envia para o GitHub e publica o GitHub Release
#      -> Todos os celulares Android com o app recebem a atualização automaticamente!
# ============================================================================

if [[ $# -lt 1 ]]; then
  echo "Uso: $0 <versao-semver> [notas-da-versao]"
  echo "Exemplo: $0 1.2.0 \"Melhorias no terminal e sincronização da IA\""
  exit 1
fi

NEW_VERSION="${1#v}"
RELEASE_NOTES="${2:-Atualização YacaCode Minecraft v${NEW_VERSION} com melhorias de estabilidade, desempenho e sincronização.}"

if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Erro: versão inválida '$NEW_VERSION'. Use formato semver como 1.2.0"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/apps/android"
GRADLE_FILE="$ANDROID_DIR/app/build.gradle.kts"
KEYSTORE="$ANDROID_DIR/yacacode-release.jks"

if [[ ! -f "$KEYSTORE" ]]; then
  echo "Erro: keystore de assinatura não encontrada em $KEYSTORE"
  exit 1
fi

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

CURRENT_CODE="$(grep -Eo 'ycVersionCode"\)\?\.toString\(\)\?\.toIntOrNull\(\) \?: [0-9]+' "$GRADLE_FILE" | grep -Eo '[0-9]+$' || echo 1)"
NEXT_CODE=$((CURRENT_CODE + 1))

echo "==> Atualizando versão para v${NEW_VERSION} (versionCode=${NEXT_CODE})..."
python3 - "$GRADLE_FILE" "$NEXT_CODE" "$NEW_VERSION" <<'PY'
import re, sys
path, code, ver = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, 'r', encoding='utf-8').read()
text = re.sub(r'(ycVersionCode"\)\?\.toString\(\)\?\.toIntOrNull\(\) \?: )\d+', rf'\g<1>{code}', text)
text = re.sub(r'(ycVersionName"\)\?\.toString\(\) \?: ")[^"]+(")', rf'\g<1>{ver}\g<2>', text)
open(path, 'w', encoding='utf-8').write(text)
PY

echo "==> Rodando testes e gerando APK Release assinado..."
(cd "$ANDROID_DIR" && ./gradlew testDebugUnitTest assembleRelease --no-daemon)

APK_SRC="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
APK_NAME="YacaCode-Minecraft-v${NEW_VERSION}.apk"
APK_REL="$ROOT_DIR/releases/$APK_NAME"
APK_DL="$HOME/Downloads/$APK_NAME"

mkdir -p "$ROOT_DIR/releases"
cp -f "$APK_SRC" "$APK_REL"
cp -f "$APK_SRC" "$APK_DL"

APKSIGNER="$(find "$ANDROID_HOME/build-tools" -name apksigner 2>/dev/null | sort -V | tail -n 1 || true)"
if [[ -n "$APKSIGNER" ]]; then
  echo "==> Verificando assinatura do APK..."
  "$APKSIGNER" verify --verbose "$APK_REL"
fi

echo "==> Publicando tag v${NEW_VERSION} e GitHub Release..."
cd "$ROOT_DIR"
git add "$GRADLE_FILE"
git commit -m "chore(android): release v${NEW_VERSION} (build ${NEXT_CODE})" || true
git tag -f "v${NEW_VERSION}"
git push origin HEAD
git push -f origin "v${NEW_VERSION}"

if gh release view "v${NEW_VERSION}" >/dev/null 2>&1; then
  gh release upload "v${NEW_VERSION}" "$APK_REL" --clobber
  gh release edit "v${NEW_VERSION}" --title "YacaCode Minecraft v${NEW_VERSION}" --notes "$RELEASE_NOTES"
else
  gh release create "v${NEW_VERSION}" "$APK_REL" \
    --title "YacaCode Minecraft v${NEW_VERSION}" \
    --notes "$RELEASE_NOTES"
fi

echo ""
echo "✅ Release v${NEW_VERSION} publicado com sucesso!"
echo "   - APK em Downloads: $APK_DL"
echo "   - GitHub Release: https://github.com/Nycolazs/yacacode-minecraft/releases/tag/v${NEW_VERSION}"
echo "   - Todos os apps Android instalados vão detectar e oferecer a atualização automaticamente!"
