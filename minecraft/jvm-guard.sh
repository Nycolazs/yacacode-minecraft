#!/bin/sh
# Antes de iniciar o Paper: garante que o arquivo de parâmetros extras da JVM existe e é válido.
# Se o Java não aceitar os parâmetros (flag inexistente, memória incompatível...), o arquivo é
# guardado como .invalido e o server sobe com os padrões, em vez de ficar em loop de reinício.
F=/data/.yacacode-jvm-args.txt
[ -f "$F" ] || : > "$F"
chmod 644 "$F" 2>/dev/null

if [ -s "$F" ]; then
  if ! java -Xms"${INIT_MEMORY:-1024M}" -Xmx"${MAX_MEMORY:-2048M}" $JVM_XX_OPTS -XX:+UseCompactObjectHeaders @"$F" -version >/tmp/jvm-guard.log 2>&1; then
    echo "[YacaCode] Parâmetros da JVM em $F foram recusados pelo Java:"
    sed 's/^/[YacaCode]   /' /tmp/jvm-guard.log | head -5
    mv -f "$F" "$F.invalido"
    : > "$F"
    echo "[YacaCode] Arquivo movido para $F.invalido; subindo com os parâmetros padrão."
  fi
fi

exec /image/scripts/start "$@"
