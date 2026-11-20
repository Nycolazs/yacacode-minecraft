FROM node:22-alpine

LABEL org.opencontainers.image.title="YacaCode Minecraft Admin Panel" \
      org.opencontainers.image.vendor="YacaCode (https://yacacode.com)" \
      org.opencontainers.image.description="Painel administrativo profissional ultra-leve para Orange Pi 4GB ARM64"

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

# Copiar arquivos da aplicação (zero dependências npm externas = imagem minúscula e build instantâneo)
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
