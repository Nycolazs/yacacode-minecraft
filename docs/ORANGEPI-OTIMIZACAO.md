# Guia de Engenharia 24/7 — Orange Pi 4GB RAM (ARM64)

Rodar um servidor moderno de **Minecraft 26.3 + Crossplay Bedrock** 24 horas por dia em um **Orange Pi de 4GB de RAM** exige atenção a quatro pilares: **Memória**, **Armazenamento**, **Temperatura** e **Pré-geração de Chunks**. Esta stack já foi engenheirada pensando nos quatro.

---

## 1. Gerenciamento de Memória (4GB RAM)

Por padrão, o `docker-compose.yml` usa:
- `MC_INIT_MEMORY=1536M` / `MC_MAX_MEMORY=2560M` / `MC_MEM_LIMIT=3072m`
- `-XX:+UseCompactObjectHeaders` (recurso do **Java 25** que reduz o overhead de cada objeto na JVM em ~10–20%, liberando centenas de MB reais no Minecraft!)
- **Aikar's G1GC Flags** (`USE_AIKAR_FLAGS=true`) para evitar engasgos (lag spikes) do Garbage Collector.
- **ZRAM (2GB LZ4)** + **Swapfile (2GB prioridade baixa)** configurados pelo `scripts/setup-orangepi.sh`, prevenindo que o Linux OOM Killer mate o Minecraft em picos momentâneos.

> **Regra de ouro em 4GB de RAM:** Nunca coloque `MC_MAX_MEMORY` acima de `2800M` em uma placa de 4GB. A JVM sempre usa memória nativa (off-heap, metaspace, Netty buffers, Geyser) além do `-Xmx`. Manter em `2560M` dá estabilidade absoluta 24/7!

---

## 2. Proteção do Armazenamento (Cartão SD vs eMMC vs NVMe SSD)

- **Recomendação forte**: Se o seu Orange Pi possui slot **NVMe SSD** ou **eMMC**, rode a pasta `yacacode-minecraft` nele em vez de um cartão MicroSD barato.
- Se estiver rodando em **MicroSD**, use um cartão **A2 / High Endurance** (ex: SanDisk Extreme / Samsung PRO Endurance).
- O que a nossa stack já faz para prolongar a vida útil do disco:
  - `SYNC_CHUNK_WRITES=false` (evita milhares de `fsync()` por segundo).
  - Rotação rígida de logs do Docker (`max-size: 10m`, `max-file: 3`).
  - `PAUSE_IF_NO_PLAYERS=true` no container `yacacode-backup` (não escreve backup redundante se ninguém jogou nas últimas 24h!).
  - `vm.dirty_ratio=15` e `vm.dirty_background_ratio=5` no kernel.

---

## 3. Refrigeração & Fonte de Energia 24/7

- Use **dissipador metálico + ventoinha (fan) ativa** no Orange Pi. Sem cooler ativo, o processador ARM reduz o clock (*thermal throttling*) acima de 75°C–80°C e o TPS cai.
- Use uma **fonte de alimentação real de boa qualidade** (5V/3A ou 5V/4A conforme o modelo do seu Orange Pi — fontes fracas de carregador de celular causam reinícios aleatórios e corrupção do mundo!).
- O **Painel Admin YacaCode** exibe a **temperatura real da CPU** no topo e no Dashboard, e o `scripts/watchdog.sh` monitora automaticamente a cada 5 minutos (enviando alerta no Discord se você preencher `DISCORD_WEBHOOK_URL` no `.env`).

---

## 4. Pré-geração de Chunks com Chunky (Segredo dos 20 TPS no ARM!)

Gerar novos chunks em tempo real enquanto vários jogadores exploram de barco ou Elytra é o que mais consome CPU em qualquer processador ARM.

O plugin **Chunky** já vem instalado automaticamente! Após o primeiro boot, abra o **Console ao Vivo** no Painel YacaCode e execute:

```
chunky world world
chunky radius 1500
chunky start
```

Deixe rodar de madrugada (você pode acompanhar com `chunky progress`). Depois que o raio de 1500 blocos (3000x3000 blocos!) estiver pré-gerado, o servidor rodará liso a **20.0 TPS** com mínimo uso de CPU!

---

## 5. Diagnóstico de Performance com Spark (Nativo no Paper 26.3)

Se um dia notar queda de TPS, o **Spark Profiler** já vem habilitado nativamente no PaperMC 26.3 (ativado pelo nosso Preset YacaCode). No Console ao Vivo do painel, rode:

```
spark health
spark profiler start --timeout 60
```

Em 60 segundos ele gera um link com o relatório completo mostrando exatamente qual entidade, farm ou plugin está consumindo CPU.
