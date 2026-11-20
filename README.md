# YacaCode Minecraft Server — Produção 24/7 (Orange Pi 4GB ARM64)

Stack completa, profissional e ultra-otimizada para rodar um servidor **Minecraft 26.3 (PaperMC + Java 25)** com **Crossplay Java + Bedrock (GeyserMC + Floodgate)**, **Painel Admin Profissional YacaCode**, **Cloudflare Tunnel (HTTPS Zero Trust)**, **Cloudflare DDNS (Domínio sincronizado no IP do servidor)** e **Backups Automáticos** rodando **24 horas por dia** em um **Orange Pi de 4GB de RAM**.

---

## Arquitetura da Stack (Orçamento de Memória para 4GB RAM)

```
                         ┌──────────────────────────────┐
                         │       CLOUDFLARE EDGE        │
                         ├──────────────┬───────────────┤
                         │ HTTPS Tunnel │  DNS Only (A) │
                         │ painel.dom   │  mc.dom       │
                         └──────┬───────┴───────┬───────┘
                                │ (sem abrir    │ Port Forward:
                                │  porta 8080!) │ 25565/TCP (Java)
                                ▼               │ 19132/UDP+TCP (Bedrock)
  ┌─────────────────────── ORANGE PI 4GB (ARM64) ────────────────────────┐
  │                                                                      │
  │  ┌─────────────────────┐      ┌──────────────────────────────────┐   │
  │  │ yacacode-cloudflared│─────▶│ yacacode-panel (~45MB RAM)       │   │
  │  │ (~30MB RAM)         │      │ Painel Admin Web YacaCode        │   │
  │  └─────────────────────┘      └───────┬──────────────────┬───────┘   │
  │                                       │ RCON (interno)   │ Docker    │
  │  ┌─────────────────────┐              ▼                  ▼           │
  │  │ yacacode-ddns       │      ┌──────────────────────────────────┐   │
  │  │ (~15MB RAM)         │      │ yacacode-mc (PaperMC 26.3)       │   │
  │  │ Atualiza IP a 5 min │      │ Java 25 + CompactObjectHeaders   │   │
  │  └─────────────────────┘      │ GeyserMC + Floodgate + Chunky    │   │
  │                               │ Heap: 1.5GB–2.5GB (Limit 3.0GB)  │   │
  │  ┌─────────────────────┐      └───────────────┬──────────────────┘   │
  │  │ yacacode-backup     │◀─────────────────────┘                      │
  │  │ (~20MB RAM idle)    │  RCON save-off → save-all → .tgz → save-on  │
  │  └─────────────────────┘                                             │
  └──────────────────────────────────────────────────────────────────────┘
```

| Serviço | Container | Arquitetura | RAM Estimada | Função |
| :--- | :--- | :--- | :--- | :--- |
| **Minecraft Paper 26.3** | `yacacode-mc` | ARM64 / AMD64 | 1.5 GB – 2.8 GB | Servidor Java 25 + GeyserMC + Floodgate + Chunky + Logo YacaCode |
| **Painel Admin YacaCode** | `yacacode-panel` | ARM64 / AMD64 | **~45 MB** | Dashboard, Console SSE, Jogadores, Plugins, Arquivos, Backups, Temperatura |
| **Cloudflare Tunnel** | `yacacode-cloudflared` | ARM64 / AMD64 | ~30 MB | Expõe o painel em `https://painel.seudominio.com` sem abrir portas HTTP |
| **Cloudflare DDNS** | `yacacode-ddns` | ARM64 / AMD64 | ~15 MB | Mantém `mc.seudominio.com` sempre apontando para o IP público atual |
| **Backup Automático** | `yacacode-backup` | ARM64 / AMD64 | ~20 MB | Backups diários compactados com retenção de 7 dias / 10 arquivos |

---

## O que já vem pronto nesta pasta

- **Versão mais recente estável do Minecraft**: **PaperMC `26.3`** rodando em **Java 25** com `-XX:+UseCompactObjectHeaders` (economiza ~15% de RAM heap no Orange Pi 4GB) + **Aikar's G1GC Flags**.
- **Crossplay Java & Bedrock nativo**: **GeyserMC** + **Floodgate** (baixados e atualizados automaticamente) com suporte a **NetherNet (TCP + UDP 19132)** para jogadores de Android, iOS, Windows, Xbox, PlayStation e Switch entrarem **sem conta Java**.
- **Identidade Visual Oficial YacaCode**:
  - Ícone 64x64 oficial baixado de `yacacode.com` em `minecraft/server-icon.png` (aparece na lista de servidores!).
  - MOTD personalizado Java e Bedrock da **YacaCode**.
  - Painel Web com a paleta e logotipo oficiais de `yacacode.com` (suporte a tema Claro/Escuro automático).
- **Painel Admin Profissional Ultra-leve (~45MB RAM)**:
  - Autenticação segura (`scrypt` + cookie HMAC-SHA256 + rate-limit anti-brute-force + suporte Cloudflare Access Zero Trust).
  - Telemetria em tempo real do **Orange Pi** (RAM, ZRAM/Swap, CPU, **Temperatura ARM em °C**, Disco, TPS, gráficos SVG).
  - Console ao vivo (SSE com keepalive para Cloudflare Tunnel) + barra de comandos RCON com histórico.
  - Gestão de Jogadores Java & Bedrock (Kick, Ban, OP, Whitelist / Floodgate `fwhitelist`, Mensagem Global).
  - Editor visual de `server.properties` + botão **1-clique** para aplicar Presets Orange Pi 4GB & GeyserMC.
  - Gerenciador de Plugins (com upload `.jar` drag-and-drop), Gerenciador de Arquivos com editor de texto e Central de Backups.
- **Pronto para 24/7 no Orange Pi**:
  - Script `scripts/setup-orangepi.sh` configura Docker, **ZRAM + Swapfile**, sysctl, rotação de logs (protege SD/eMMC), Firewall UFW, serviço `systemd` (auto-start após falta de energia) e Watchdog cron a cada 5 min.

---

## Guia Rápido de Instalação no Orange Pi (5 Passos)

### 1. Copie esta pasta para o Orange Pi
No seu Mac/PC, envie a pasta `yacacode-minecraft` para o Orange Pi (ex: via `scp` ou `rsync`):

```bash
rsync -avz --exclude 'minecraft/data' --exclude 'backups/*.tgz' \
  ./yacacode-minecraft usuario@IP_DO_ORANGEPI:~/yacacode-minecraft
```

Conecte-se ao Orange Pi via SSH:
```bash
ssh usuario@IP_DO_ORANGEPI
cd ~/yacacode-minecraft
```

### 2. Provisione o Orange Pi para operação 24/7
Execute uma única vez como `root`:
```bash
sudo ./scripts/setup-orangepi.sh
```
> Se o seu usuário acabou de ser adicionado ao grupo `docker`, saia e entre novamente no SSH (`exit` → `ssh ...`).

### 3. Configure senhas, domínio e Cloudflare
Execute o assistente interativo (gera automaticamente senhas criptográficas fortes e hash `scrypt`):
```bash
./scripts/configure.sh
```
> Precisa dos tokens da Cloudflare? Veja o passo a passo exato em **[docs/CLOUDFLARE-E-DOMINIO.md](docs/CLOUDFLARE-E-DOMINIO.md)**.

### 4. Crie o DNS na Cloudflare e libere as portas no roteador
- Crie o registro `A` (DNS Only) automaticamente via API:
  ```bash
  ./scripts/setup-cloudflare-dns.sh
  ```
- No painel do seu **roteador** (Port Forwarding → IP local do Orange Pi), libere:
  - `25565` **TCP** (Minecraft Java)
  - `19132` **UDP + TCP** (Minecraft Bedrock / Geyser NetherNet)
  - *(Não libere a porta `8080`! O Painel Admin já fica acessível com HTTPS seguro via Cloudflare Tunnel.)*

### 5. Suba a stack 24/7 e finalize os presets
```bash
docker compose up -d --build
```
Acompanhe o 1º boot (o Paper 26.3, GeyserMC, Floodgate e Chunky serão baixados automaticamente):
```bash
docker compose logs -f minecraft
```
Quando aparecer `Done (...)! For help, type "help"`:
1. Acesse o Painel Admin em **`https://painel.seudominio.com`** (ou `http://IP_LOCAL:8080` se habilitou LAN).
2. Vá em **Configurações** → clique em **⚡ Aplicar Presets YacaCode** → clique em **↻ Reiniciar** no topo!
3. *(Altamente recomendado para Orange Pi)* No **Console ao Vivo**, pré-gere os chunks ao redor do spawn com Chunky para eliminar lag de exploração:
   ```
   chunky radius 1500
   chunky start
   ```

---

## Como os Jogadores Conectam

- **Minecraft Java Edition (PC)**:
  - Endereço do servidor: `mc.seudominio.com` *(ou o domínio escolhido no `.env`)*
  - Versão: **26.3**
- **Minecraft Bedrock Edition (Celular, Windows, Consoles)**:
  - Nome: `YacaCode`
  - Endereço do servidor: `mc.seudominio.com`
  - Porta: **`19132`**
  - Não precisa de conta Java (autenticação automática via Floodgate).

---

## Comandos Úteis do Dia a Dia

| Ação | Comando |
| :--- | :--- |
| Ver status de todos os containers | `docker compose ps` |
| Ver logs do Minecraft ao vivo | `docker compose logs -f minecraft` |
| Fazer backup imediato seguro | `./scripts/backup-now.sh` |
| Diagnóstico de rede, DNS, IP e CGNAT | `./scripts/check-network.sh` |
| Atualizar Paper, Geyser, Painel e imagens | `./scripts/update.sh` |
| Reiniciar tudo com segurança | `docker compose restart` |

---

## Guias Técnicos Detalhados

- **[docs/CLOUDFLARE-E-DOMINIO.md](docs/CLOUDFLARE-E-DOMINIO.md)** — Tutorial completo do Cloudflare Tunnel, Zero Trust Access, Cloudflare DDNS, Registro A/SRV, Port Forwarding e solução para CGNAT.
- **[docs/ORANGEPI-OTIMIZACAO.md](docs/ORANGEPI-OTIMIZACAO.md)** — Engenharia de memória 4GB RAM, proteção de cartão SD vs SSD NVMe, refrigeração e ajuste fino do Chunky / Spark.
