# Guia Completo: Cloudflare Tunnel (Painel Admin) + Domínio no IP do Servidor

Este guia explica exatamente como:
1. **Expor o Painel Admin YacaCode na internet com HTTPS e Zero Trust** via **Cloudflare Tunnel** (sem abrir nenhuma porta HTTP no roteador).
2. **Conectar seu domínio ao IP do Orange Pi** para jogadores **Java e Bedrock**, com atualização automática (**Cloudflare DDNS**).

> **Por que Painel usa Tunnel e o Jogo usa DNS Only?**
> O Cloudflare Tunnel gratuito faz proxy de tráfego **HTTP/HTTPS** (perfeito para o Painel Admin web em `https://painel.seudominio.com`). Já o tráfego de jogos do Minecraft (`25565/TCP` e `19132/UDP+TCP`) não passa pelo proxy HTTP laranja da Cloudflare — ele precisa de um registro **A com Proxy DESLIGADO (nuvem cinza / DNS Only)** apontando direto para o IP público do seu Orange Pi, mantido sempre atualizado pelo container `yacacode-ddns`.

---

## Parte 1 — Expor o Painel Admin com Cloudflare Tunnel

1. Acesse o painel **Cloudflare Zero Trust**: [https://one.dash.cloudflare.com](https://one.dash.cloudflare.com)
2. No menu lateral, vá em **Networks → Tunnels** → clique em **Create a tunnel**.
3. Escolha o tipo **Cloudflared** → dê o nome `yacacode-orangepi` → clique em **Save tunnel**.
4. Na tela de instalação, escolha **Docker** e copie **apenas o token** após `--token ` (uma string longa começando geralmente com `eyJ...`).
5. Cole esse valor no seu `.env`:
   ```env
   CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...SEU_TOKEN_AQUI...
   ```
6. Volte ao painel da Cloudflare, abra a aba **Public Hostname** do seu tunnel e clique em **Add a public hostname**:
   - **Subdomain**: `painel` *(ou o subdomínio desejado)*
   - **Domain**: `yacacode.com` *(seu domínio na Cloudflare)*
   - **Service Type**: `HTTP`
   - **URL**: `yacacode-panel:8080`
7. Clique em **Save hostname**.

> **Importante:** Como o `cloudflared` roda na mesma rede Docker `yacacode-net`, ele alcança o painel internamente usando `yacacode-panel:8080` — mesmo com `PANEL_BIND_IP=127.0.0.1`! Assim a porta 8080 fica 100% invisível na rede externa.

### Bônus de Segurança Máxima (Cloudflare Access / Zero Trust — Recomendado!)
Para adicionar uma **segunda camada de autenticação** antes mesmo de carregar a página de login do painel:
1. Em **Cloudflare Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Configure:
   - **Application name**: `YacaCode Minecraft Admin`
   - **Application domain**: `painel.yacacode.com`
3. Crie uma política **Allow** apenas para o seu e-mail (ex: `contato@yacacode.com`) usando One-Time PIN por e-mail ou login Google/GitHub.
4. No `.env`, ative `CF_ACCESS_ENABLED=true`. O painel passará a exibir o badge de confirmação **CF Zero Trust** no topo!

---

## Parte 2 — Conectar seu Domínio ao IP do Servidor (Cloudflare DDNS)

### 2.1 Gerar API Token da Cloudflare (com permissão mínima)
1. Acesse [https://dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).
2. Clique em **Create Token** → selecione o template **Edit zone DNS**.
3. Em **Zone Resources**, escolha **Include → Specific zone → `seu-dominio.com`**.
4. Clique em **Continue to summary → Create Token** e copie o token gerado.
5. Coloque no seu `.env`:
   ```env
   CLOUDFLARE_DNS_API_TOKEN=SEU_API_TOKEN_AQUI
   MC_DOMAIN=mc.yacacode.com
   ```

### 2.2 Criar os Registros DNS Automaticamente
Execute:
```bash
./scripts/setup-cloudflare-dns.sh
```
Ele criará o registro **`A`** com **Proxy OFF (DNS Only / nuvem cinza)**:

| Tipo | Nome | Conteúdo | Proxy | TTL |
| :--- | :--- | :--- | :--- | :--- |
| `A` | `mc.yacacode.com` | `SEU_IP_PUBLICO` | **Desligado (DNS Only)** | 2 min |

A partir daí, o container `yacacode-ddns` checa seu IP público a cada **5 minutos** e atualiza a Cloudflare automaticamente se a sua operadora trocar seu IP!

### 2.3 (Opcional) Jogar usando o domínio raiz (`yacacode.com`) no Java Edition
Se quiser que jogadores de **Java Edition** consigam conectar digitando apenas `yacacode.com` (sem afetar o site principal `https://yacacode.com`!), crie um registro **SRV** na Cloudflare:
- **Type**: `SRV`
- **Name**: `_minecraft._tcp`
- **Priority**: `0`
- **Weight**: `5`
- **Port**: `25565`
- **Target**: `mc.yacacode.com`

*(Nota: o Minecraft Bedrock Edition não lê registros SRV — jogadores Bedrock devem sempre usar `mc.yacacode.com` com porta `19132`.)*

---

## Parte 3 — Redirecionamento de Portas no Roteador (Port Forwarding)

1. No seu roteador doméstico/empresarial, primeiro fixe o **IP local (DHCP Reservation)** do Orange Pi (ex: `192.168.1.50`) para que o IP interno dele nunca mude após reiniciar.
2. Em **Port Forwarding / Redirecionamento de Portas / NAT Virtual Server**, adicione:

| Regra | Porta Externa | Porta Interna | Protocolo | IP Destino (Orange Pi) |
| :--- | :--- | :--- | :--- | :--- |
| Minecraft Java | `25565` | `25565` | **TCP** | IP fixo do Orange Pi |
| Minecraft Bedrock (NetherNet + RakNet) | `19132` | `19132` | **TCP e UDP (Both)** | IP fixo do Orange Pi |

> **Por que Bedrock precisa de TCP + UDP em 2026?**
> O Minecraft Bedrock moderno utiliza o protocolo **NetherNet**, que realiza sinalização inicial via **TCP** e streaming WebRTC via **UDP** na porta `19132`. Liberar ambos garante conexão imediata em celulares, Windows e consoles!

3. Teste tudo rodando:
   ```bash
   ./scripts/check-network.sh
   ```

---

## Parte 4 — E se a minha operadora usar CGNAT?

Se o `./scripts/check-network.sh` avisar sobre CGNAT (ou se o IP WAN mostrado no roteador for `100.64.x.x` diferente do IP público):

1. **Melhor solução (gratuita na maioria dos provedores BR)**: Ligue para o suporte da sua operadora e peça **saída do CGNAT / IPv4 público dinâmico** (diga que precisa acessar câmeras/servidor doméstico). A maioria dos provedores libera em minutos sem custo extra.
2. **Plano B (sem precisar sair do CGNAT)**: Use um túnel TCP+UDP dedicado para jogos (como **Playit.gg** ou uma micro-VPS barata com túnel **WireGuard / Rathole / FRP** apontando o registro `A` do seu domínio para o IP fixo da VPS). O painel admin continua funcionando perfeitamente pelo Cloudflare Tunnel mesmo atrás de CGNAT!
