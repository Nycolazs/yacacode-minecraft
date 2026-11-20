# YacaCode Minecraft 24/7 — Contexto Operacional do Projeto

> Sempre responda em **Português do Brasil (pt-BR)**, de forma clara, objetiva e prática.

## 1. Visão Geral
Projeto de servidor Minecraft 24/7 cross-play (**Java + Bedrock**) + painel administrativo ultra-leve com identidade visual **YacaCode** (`https://yacacode.com`), rodando em um **Orange Pi Zero 2W (4 GB RAM, ARM64)** e gerenciado remotamente a partir deste servidor Linux (`servidor`) **exclusivamente via Tailscale**.

## 2. Topologia Tailscale (Toda comunicação deve usar Tailscale)
| Host / Alias | IP Tailscale | Papel | Acesso |
|---|---|---|---|
| `servidor` (este host) | `100.73.175.88` | Host do Antigravity (`agy`) / workspace `/home/nyc/projetos/yacacode-minecraft` | local (`nyc`) |
| `orangepi` / `yacacode-orangepi` | `100.73.198.14` | **Orange Pi Zero 2W** rodando Minecraft + Painel + Cloudflared | `ssh orangepi` (`nycolas`, chave ED25519 sem senha, `sudo NOPASSWD`) |
| `vps-relay` | `100.115.95.11` | VPS pública (`45.179.88.242`, GRU/BR) fazendo relay TCP/UDP (`25565/tcp`, `19132/tcp+udp`) para o Orange Pi via Tailscale (`yacacode-mc-relay.service`) | `ssh root@100.115.95.11` |
| `iphone-16` | `100.88.234.65` | Celular do Nycolas (acesso remoto ao `agy` e ao painel) | — |
| `macbook-air-de-nycolazs` | `100.78.137.88` | MacBook do Nycolas (origem do projeto) | — |
| `raspnyc` | `100.80.167.83` | Raspberry Pi 2GB separado — **NUNCA mexer neste host** | — |

> **Regra de ouro:** Sempre use `ssh orangepi` (`100.73.198.14` via Tailscale) para inspecionar, enviar arquivos (`rsync`) ou operar o Orange Pi. Não dependa de IPs de LAN (`192.168.0.6`).

## 3. Arquitetura Atual em Produção no Orange Pi (`orangepi:~/yacacode-minecraft`)

### Containers Docker (`docker compose` em `~/yacacode-minecraft`)
1. **`yacacode-mc`** (`minecraft/Dockerfile.pumpkin` -> `yacacode-pumpkin-rust:latest`):
   - Engine **Pumpkin em Rust (`0.2.2+26.3-26.63`)** — nativa para **Java 26.3 (`25565/tcp`)** e **Bedrock 1.26.63 NetherNet (`19132/tcp+udp`, descoberta LAN `7551/udp`)**.
   - Consumo real típico: **~60 MB RAM**, **~1–2% CPU**, temperatura **~45–47 °C** (migrado do Paper Java 25 que consumia ~1.5 GB RAM e 56–60 °C).
   - Limite `mem_limit: 768m`; configurações em `minecraft/config/pumpkin.toml` e entrypoint `minecraft/entrypoint-pumpkin.sh`.
   - Engine legada PaperMC Java 25 + Geyser/Floodgate permanece disponível sob `profiles: ["paper-java"]` no `docker-compose.yml` caso um dia o usuário queira voltar para plugins Spigot/Paper.
2. **`yacacode-panel`** (`panel/Dockerfile` -> `yacacode-mc-panel:latest`):
   - Node 22 **zero dependências externas** (`panel/server.js`, `panel/lib/{ai,auth,docker,files,gdrive,ingame-chat,mcping,playerdata,rcon,system}.js`, `panel/public/{index.html,styles.css,app.js}`).
   - Porta `8080`, ~18 MB RAM.
   - **Multi-usuário com RBAC** (`admin`, `moderator`, `viewer`) persistido em `/mc-data/.yacacode-panel-users.json` (usuário dono: `nycolas`; credenciais/segredos ficam em `orangepi:~/yacacode-minecraft/.env`).
   - **Assistente IA Gemini (`panel/lib/ai.js` + `panel/lib/playerdata.js` + `panel/lib/ingame-chat.js`):** chat integrado no painel com Function Calling nativo (REST API Gemini, default `gemini-3.5-flash-lite` com fallback automático), leitura de jogadores/nível XP (console + NBT `.dat`), logs, telemetria, execução de comandos respeitando RBAC e confirmação em 1 clique para ações destrutivas (`ban`, `kick`, `clear`, `kill`, `stop`, `restart`). Inclui também o bot **Jorge** no chat global do jogo (responde somente quando chamado por `Jorge`/`jorge`, sem `@` ou `!`), restrito a dúvidas e conversa sobre Minecraft (**ZERO tools / ZERO execução de comandos**). Chave API e toggle do chat in-game configuráveis via `.env` (`GEMINI_API_KEY`) ou no painel (Admin, `/mc-data/.yacacode-ai-config.json` modo `0600`).
   - **Backup no Google Drive Pessoal (`panel/lib/gdrive.js`):** OAuth 2.0 Web Flow (escopo restrito `drive.file`), execução assíncrona em background com **barra de progresso em tempo real** (compactação → upload resumable em chunks de 4 MB → retenção), agendamento automático configurável no painel (6h/12h/24h/72h/manual) e arquivo temporário em `os.tmpdir()` apagado imediatamente após o upload (zero backups locais no SD do Orange Pi, sem incluir `.yacacode-*.json`). Credenciais/tokens salvos em `/mc-data/.yacacode-gdrive-config.json` modo `0600`.
   - Gráfico de telemetria real normalizado 0–100% quad-core (eixo duplo CPU + RAM, curvas Bézier, tooltip interativo).
   - Testes automatizados: `cd panel && node --test tests/*.test.js` (devem passar 8/8 antes de qualquer deploy).
3. *(Backup local `yacacode-backup` desativado e arquivos locais em `~/yacacode-minecraft/backups/` removidos a pedido do usuário — backups ficam exclusivamente no Google Drive pessoal.)*

### Serviços Systemd no Orange Pi
- `yacacode-minecraft.service`: sobe o Docker Compose automaticamente no boot.
- `cloudflared.service`: Cloudflare Tunnel `yacacode-minecraft` (ID `b258b2ba-4cfb-4884-8f96-ceb59384675f`) expondo **`https://painel.yacacode.com` -> `http://127.0.0.1:8080`**.
- `tailscaled.service`: nó `yacacode-orangepi` (`100.73.198.14`), UFW libera `tailscale0`, OpenSSH nativo na porta 22 (`tailscale set --ssh=false`).
- `aw859a-wifi.service` (`/usr/local/sbin/yacacode-boot.sh` v2): corrige inicialização a frio do chip Wi-Fi UWE5622 (`sprdwl_ng`) + watchdog de reconexão a cada 15s. Bluetooth foi desativado para reduzir aquecimento do módulo combinado Wi-Fi/BT.

### URLs de Acesso Ativas
- **Painel público (HTTPS Cloudflare Tunnel):** `https://painel.yacacode.com`
- **Painel via Tailscale:** `http://100.73.198.14:8080`
- **Minecraft público (DNS Only via `vps-relay` `45.179.88.242`):** Java `mc.yacacode.com:25565` | Bedrock `mc.yacacode.com:19132`
- **Minecraft via Tailscale:** Java `100.73.198.14:25565` | Bedrock `100.73.198.14:19132`

## 4. Fluxo Padrão de Desenvolvimento e Deploy (via Tailscale)
1. Edite os arquivos localmente em `/home/nyc/projetos/yacacode-minecraft`.
2. Se alterou o painel, valide os testes:
   ```bash
   cd /home/nyc/projetos/yacacode-minecraft/panel && node --test tests/*.test.js
   ```
3. Se alterou scripts shell, valide a sintaxe com `bash -n scripts/*.sh`.
4. Sincronize com o Orange Pi **sem sobrescrever `.env`, `minecraft/data` ou `backups`**:
   ```bash
   rsync -avz --exclude='.env' --exclude='minecraft/data/' --exclude='backups/' --exclude='.DS_Store' \
     /home/nyc/projetos/yacacode-minecraft/ orangepi:~/yacacode-minecraft/
   ```
5. Recrie apenas o serviço alterado no Orange Pi:
   ```bash
   ssh orangepi 'cd ~/yacacode-minecraft && docker compose up -d --build panel'
   # ou minecraft, quando houver alteração na engine
   ```
6. Verifique saúde e logs:
   ```bash
   ssh orangepi 'docker ps --format "table {{.Names}}\t{{.Status}}" && curl -fsS http://127.0.0.1:8080/healthz'
   ```

## 5. Cuidados Críticos e Lições Aprendidas
- **Wi-Fi UWE5622 (`sprdwl_ng`):** Nunca adicione `regulatory-domain: "BR"` ou `country=BR` no netplan/wpa_supplicant do Orange Pi (quebra handshake WPA no driver `sprdwl_ng`). Nunca reative o `wpa_supplicant.service` genérico junto com `netplan-wpa-wlan0`.
- **Tailscale SSH:** Não execute `tailscale up --ssh` no Orange Pi (sem ACL Tailscale SSH isso bloqueia a porta 22). Mantenha `tailscale set --ssh=false` usando OpenSSH padrão sobre `tailscale0`.
- **`.env` no Docker Compose:** Valores com `$` (como hashes `scrypt$...`) sofrem expansão de variável no Docker Compose se não escapados (`$$`) ou convertidos para separador `:`.
- **CPU % no Docker:** A telemetria de CPU em `panel/lib/docker.js` deve manter `(cpuDelta / systemDelta) * 100` (escala 0–100% total dos 4 núcleos), nunca multiplicado por `onlineCpus`.
- **Não poluir RCON:** Evite polling RCON periódico em idle no painel para manter CPU/temperatura baixas e logs limpos.

## 6. Estado da Exposição Pública (`mc.yacacode.com`)
- **Concluído e validado em produção:**
  - DNS `A` `mc.yacacode.com -> 45.179.88.242` (Proxy OFF / DNS Only) propagado em `1.1.1.1` e `8.8.8.8`.
  - Relay TCP/UDP na **`vps-relay` (`100.115.95.11` / IP público `45.179.88.242`)** ativo 24/7 via `yacacode-mc-relay.service` encaminhando `25565/tcp`, `19132/tcp` e `19132/udp` para `100.73.198.14`.
  - `external_ip = "45.179.88.242"` configurado no Bedrock NetherNet do Pumpkin (`minecraft/config/pumpkin.toml` e produção).
