# YacaCode Minecraft — Apps Nativos (iOS & Android)

Aplicativos nativos completos do painel **YacaCode Minecraft 24/7**, já apontados para produção (`https://painel.yacacode.com`).

## Apps Incluídos

| Plataforma | Stack | Pasta | Artefato / Atualização |
|---|---|---|---|
| **iOS** | Swift 5.9 + SwiftUI + LocalAuthentication (Face ID / Touch ID) + Keychain + URLSession SSE | `apps/ios/` | `releases/YacaCode-Minecraft-iOS.ipa` |
| **Android** | Kotlin 2.1 + Jetpack Compose + Material 3 + BiometricPrompt + Android Keystore AES-256-GCM + OkHttp SSE + Auto-Updater OTA | `apps/android/` | [GitHub Releases](https://github.com/Nycolazs/yacacode-minecraft/releases) (`YacaCode-Minecraft-v*.apk`) |

## Funcionalidades Portadas (100% do Painel Web)
- **Login Seguro + Biometria (Face ID / Touch ID / Digital)**:
  - Sessão via cookie `HttpOnly` (`yacacode_session`) + header CSRF `X-Requested-With: YacaCodePanel`.
  - Credenciais salvas com criptografia nativa (iOS Keychain / Android Keystore AES-256-GCM) para login em 1 toque e bloqueio biométrico opcional ao reabrir o app.
  - Apontado para produção (`https://painel.yacacode.com`), com opção de servidor personalizado (ex: Tailscale `http://100.73.198.14:8080`).
- **Visão Geral & Telemetria**:
  - Hero status ao vivo, controles de energia (`start`, `restart`, `stop`), `save-all` e backup rápido.
  - Cards de conexão Java (`mc.yacacode.com:25565`) e Bedrock (`mc.yacacode.com:19132`) com cópia em 1 toque.
  - 6 KPIs em tempo real, gráfico interativo Bézier de RAM/CPU/Temperatura com toque/arrasto e saúde da stack Docker 24/7.
- **Assistente IA Gemini (Visual inspirado no Gemini + Sync PC ↔ Celular)**:
  - Conversas salvas **por usuário** no servidor (`/api/ai/conversations`) com **sincronização em tempo real via SSE (`/api/ai/events`)** entre PC (painel web), iPhone e Android.
  - Múltiplas conversas salvas, criação de novas conversas, exclusão, cartões de sugestão rápida, respostas ricas em Markdown com blocos de código copiáveis, Function Calling e confirmação em 1 clique sincronizada em todos os dispositivos.
- **Atualizações Automáticas OTA (Android)**:
  - Verifica novas versões publicadas no **GitHub Releases** (`Nycolazs/yacacode-minecraft`), mostra as novidades, baixa o APK assinado com barra de progresso e abre o instalador nativo do Android preservando login e biometria.
- **Terminal ao Vivo (Visual inspirado no Termius)**:
  - Tema escuro OLED dedicado com stream SSE em tempo real (`/api/console/stream`), syntax highlighting (timestamps, `INFO`, `WARN`, `ERROR`, `<chat>`, `Geyser/Floodgate`, comandos), busca/filtro com destaque, ajuste de fonte, auto-scroll, barra de snippets rápidos e histórico de comandos (`↑`/`↓`).
- **Jogadores & Moderação**:
  - Aviso global (`say`), lista de jogadores online com avatares (`mc-heads.net`), tags Java/Bedrock, ações rápidas (Whisper, OP, Kick, Ban) e abas dedicadas de Whitelist, OPs e Banidos.
- **Backups (Google Drive Pessoal)**:
  - Status da conta, uso de armazenamento, disparo de backup em 1 toque com **barra de progresso em tempo real** (compactação → upload → retenção), listagem/exclusão na nuvem e opções de agendamento.
- **Configurações, Plugins, Arquivos, Rede & Usuários (RBAC)**:
  - Editor visual `pumpkin.toml` / `server.properties` + Presets YacaCode.
  - Checklist Crossplay, upload de `.jar`, ativação/desativação de plugins (com proteção para módulos nativos Rust).
  - Explorador de arquivos `/data` com editor de código escuro, criação de pastas, download e exclusão.
  - Diagnóstico de DNS/Cloudflare e gerenciamento completo de usuários RBAC + troca de senha.

## Como Compilar

### iOS (macOS + Xcode)
```bash
cd apps/ios
xcodegen generate
xcodebuild -project YacaCodeMC.xcodeproj -scheme YacaCodeMC -configuration Release -allowProvisioningUpdates build
```

### Android (Compilar localmente)
```bash
cd apps/android
./gradlew testDebugUnitTest assembleRelease
```

### Publicar Atualização Automática (OTA) para todos os Android
Sempre que quiser enviar uma nova versão para todos os celulares Android com o app instalado:
```bash
./scripts/release-android.sh 1.2.0 "Resumo das novidades desta versão"
```
O script atualiza a versão, roda os testes, gera e assina o APK com a mesma chave de produção, salva uma cópia em `~/Downloads/`, cria a tag no GitHub e publica o **GitHub Release** — todos os apps Android detectam e oferecem a atualização automaticamente!
