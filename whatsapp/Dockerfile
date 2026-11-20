FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache git

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY index.js ./

RUN mkdir -p /wa-auth

ENV PORT=3001
ENV AUTH_DIR=/wa-auth

EXPOSE 3001

CMD ["node", "index.js"]
