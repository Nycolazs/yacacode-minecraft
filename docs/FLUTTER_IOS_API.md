# YacaCode Minecraft Panel — Guia da API REST para App Nativo Flutter (iOS)

Base URL em produção: `https://painel.yacacode.com` (via Cloudflare Tunnel HTTPS).

## 1. Autenticação e Segurança (Cookie + CSRF)
O painel usa cookie `HttpOnly` (`yacacode_session`, TTL 24h, HMAC-SHA256) + validação CSRF via header.

No **Flutter / Dio** (use `dio` + `dio_cookie_manager` + `cookie_jar` com `PersistCookieJar`):
- Envie o header em **todas** as requisições mutáveis (`POST`, `PUT`, `PATCH`, `DELETE`):
  ```
  X-Requested-With: YacaCodePanel
  Content-Type: application/json
  ```
- Faça login em `POST /api/auth/login`:
  ```json
  { "username": "nycolas", "password": "..." }
  ```
- Verifique sessão e branding ao abrir o app em `GET /api/auth/me`:
  - Retorna `{ authenticated, username, displayName, role, isOwner, brand }`.
  - Cargos (RBAC): `admin` (acesso total), `moderator` (console, jogadores, energia start/restart, IA de jogo), `viewer` (somente leitura).

---

## 2. Endpoints Principais

### Visão Geral & Telemetria
- `GET /api/health` — público (`{ status: "ok", service: "yacacode-panel" }`).
- `GET /api/overview` — status completo: `server` (running, health, stats CPU/RAM, TPS, ping, jogadores online Java/Bedrock), `host` (temperatura °C, RAM Orange Pi, disco, load), `stack`, `network`, `history` (pontos para gráfico CPU/RAM/Temp).
- `POST /api/server/power` — `{ "action": "start" | "restart" | "stop" | "kill" }`.

### Assistente IA Gemini (Chat do Painel + Jorge In-Game)
- `GET /api/ai/status` — `{ configured, model, inGameChatEnabled, inGameChat: { connected, totalAnswered, triggers }, permissions, availableModels }`.
- `PUT /api/ai/config` *(Admin)* — `{ apiKey?, model?, inGameChatEnabled? }`.
- `POST /api/ai/chat` — `{ "message": "quem tá online e em qual nível?", "history": [{ "role": "user"|"model", "text": "..." }] }`
  - Retorna `{ ok, reply, model, actions: [{ tool, label, status, output }], pendingActions: [{ id, command, label, reason }] }`.
- `POST /api/ai/confirm` — `{ "actionId": "...", "decision": "approve" | "reject" }` (confirmação em 1 clique para ações destrutivas).

### Console ao Vivo (SSE + Comandos)
- `GET /api/console/stream?tail=200` *(Mod+)* — Server-Sent Events (`event: log` com `{ line, ts }`, `event: meta`).
- `POST /api/console/command` *(Mod+)* — `{ "command": "time set day" }`.

### Jogadores
- `GET /api/players` — online, max, whitelist, ops, bannedPlayers, bannedIps.
- `POST /api/players/action` *(Mod+)* — `{ action: "kick"|"ban"|"pardon"|"op"|"deop"|"whitelist-add"|"whitelist-remove"|"whitelist-on"|"whitelist-off"|"say"|"whisper", player?, reason?, message? }`.

### Backups no Google Drive (com Barra de Progresso ao Vivo)
- `GET /api/backups/gdrive/status?files=1` — status da conta Google conectada, cota, pasta, `progress: { active, stage, percent, message, uploadedBytes, totalBytes, speedBps, startedAt, finishedAt, error }` e `remoteFiles`.
- `POST /api/backups/now` *(Admin)* — inicia backup assíncrono em background (retorna HTTP `202` com `progress`); faça polling a cada `1200ms` em `GET /api/backups/gdrive/status` (sem `?files=1`) enquanto `progress.active == true`.
- `PUT /api/backups/gdrive/config` *(Admin)* — `{ folderName, scheduleHours, enabled, maxBackups, skipIfNoActivity }`.
- `POST /api/backups/gdrive/test` *(Admin)* — testa conexão e atualiza cota.
- `DELETE /api/backups/gdrive/files?id=<fileId>` *(Admin)* — apaga backup da nuvem.

### Configurações, Arquivos, Rede & Usuários
- `GET /api/properties` / `PUT /api/properties` *(Admin)*
- `GET /api/plugins` / `POST /api/plugins/toggle` / `DELETE /api/plugins?name=...` *(Admin)*
- `GET /api/files?path=...` / `GET /api/files/content?path=...` / `PUT /api/files/content` *(Admin)*
- `GET /api/network`
- `GET /api/users` / `POST /api/users` / `PATCH /api/users` / `DELETE /api/users?username=...` *(Admin)*

---

## 3. Identidade Visual YacaCode (Tokens para ThemeData do Flutter)
- **Primary (Dark / Light):** `#8AB840` / `#527215`
- **Accent (Dark / Light):** `#F0C040` / `#B88400`
- **Background (Dark / Light):** `#0B0D09` / `#F6F8F2`
- **Surface (Dark / Light):** `#131710` / `#FFFFFF`
- **Surface Elevated (Dark / Light):** `#1A2115` / `#EDF2E4`
- **Border (Dark / Light):** `#1F2B19` / `#D8E2C4`
- **Fontes:** `Plus Jakarta Sans` (títulos), `Inter` (corpo), `JetBrains Mono` (console/IPs/coordenadas)
- **Logo:** [panel/public/assets/yacacode-logo-256.png](../panel/public/assets/yacacode-logo-256.png)
