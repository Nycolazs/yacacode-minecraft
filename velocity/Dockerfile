FROM eclipse-temurin:25-jre-alpine

LABEL org.opencontainers.image.title="YacaCode Velocity Proxy" \
      org.opencontainers.image.description="Proxy Velocity 4.3.1 ultra-leve na frente do Pumpkin Rust para SkinsRestorer e plugins de proxy"

RUN apk add --no-cache bash curl netcat-openbsd

ARG VELOCITY_URL="https://fill-data.papermc.io/v1/objects/0844bcabdcdb4f5b875906fd4c3365bc1bb76918e42bc595ed88ad195258dd75/velocity-4.3.1-45.jar"

RUN mkdir -p /opt/velocity /server && \
    curl -fsSL -H "User-Agent: YacaCode/1.0" "${VELOCITY_URL}" -o /opt/velocity/velocity.jar

COPY entrypoint-velocity.sh /usr/local/bin/entrypoint-velocity.sh
RUN chmod +x /usr/local/bin/entrypoint-velocity.sh

WORKDIR /server
EXPOSE 25565/tcp

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD nc -z 127.0.0.1 25565

ENTRYPOINT ["/usr/local/bin/entrypoint-velocity.sh"]
