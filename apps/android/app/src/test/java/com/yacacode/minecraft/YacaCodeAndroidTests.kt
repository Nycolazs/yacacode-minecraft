package com.yacacode.minecraft

import com.yacacode.minecraft.data.AiConversationsResponse
import com.yacacode.minecraft.data.ApiException
import com.yacacode.minecraft.data.AppUpdater
import com.yacacode.minecraft.data.AuthMeResponse
import com.yacacode.minecraft.data.ConsoleLogKind
import com.yacacode.minecraft.data.ConsoleLogLine
import com.yacacode.minecraft.data.GDriveStatusResponse
import com.yacacode.minecraft.data.GitHubReleaseDto
import com.yacacode.minecraft.data.MarkdownBlock
import com.yacacode.minecraft.data.MarkdownParser
import com.yacacode.minecraft.data.OverviewResponse
import com.yacacode.minecraft.data.PlayersResponse
import com.yacacode.minecraft.data.YacaCodeApiClient
import com.yacacode.minecraft.data.isCancellation
import kotlinx.coroutines.CancellationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class YacaCodeAndroidTests {
    private val json = YacaCodeApiClient.json

    @Test
    fun decodeProductionAuthMe() {
        val raw = """
            {"authenticated":true,"username":"nycolas","displayName":"nycolas","role":"admin","isOwner":true,"expiresAt":1795230867954,"cfEmail":null,"viaCloudflare":true,"cfAccessEnabled":false,"brand":{"name":"YacaCode","mcVersion":"26.3","mcDomain":"mc.yacacode.com","panelDomain":"painel.yacacode.com","javaPort":25565,"bedrockPort":19132}}
        """.trimIndent()
        val parsed = json.decodeFromString<AuthMeResponse>(raw)
        assertTrue(parsed.authenticated)
        assertTrue(parsed.isAdmin)
        assertEquals("mc.yacacode.com", parsed.brand?.mcDomain)
    }

    @Test
    fun decodeProductionOverview() {
        val raw = """
            {"server":{"name":"YacaCode","configuredVersion":"26.3","runningVersion":"26.3","container":{"exists":true,"id":"0e4c8f86499c","name":"yacacode-mc","image":"yacacode-pumpkin-rust:latest","tty":false,"state":"running","running":true,"restarting":false,"startedAt":"2026-11-20T01:17:19.238573535Z","finishedAt":"0001-01-01T00:00:00Z","restartCount":0,"health":"healthy","memLimitBytes":805306368},"stats":{"cpuPercent":0.3,"cpuCoresUsed":0.01,"onlineCpus":4,"memUsedBytes":350453760,"memLimitBytes":805306368,"memPercent":43.5,"rxBytes":14643923,"txBytes":73435086},"ping":{"online":true,"latencyMs":12,"version":"26.3","motd":"YacaCode"},"tps":{"tps1m":20,"tps5m":20,"tps15m":20,"raw":"20.0 (Rust Native Engine)"},"players":{"online":0,"max":6,"list":[],"javaCount":0,"bedrockCount":0},"crossplay":{"geyserInstalled":true,"floodgateInstalled":true,"geyserConfigured":true},"backupCount":0,"latestBackup":null},"connection":{"mcDomain":"mc.yacacode.com","panelDomain":"painel.yacacode.com","javaPort":25565,"bedrockPort":19132,"viaCloudflare":true,"cfEmail":null},"host":{"arch":"arm64","platform":"linux","hostname":"2ce4eba9c97d","cpuCores":4,"cpuModel":"Cortex-A53","loadAvg":[0.02,0.16,0.46],"uptimeSeconds":35805,"memory":{"totalBytes":4110106624,"usedBytes":699654144,"availableBytes":3410452480,"percent":17,"swapTotalBytes":4202528768,"swapUsedBytes":0,"swapPercent":0},"temperature":{"celsius":44.7,"status":"ok","sensors":[{"name":"cpu-thermal","celsius":44.7}]},"disk":{"totalBytes":31071121408,"usedBytes":7738986496,"freeBytes":23332134912,"percent":24.9}},"stack":[{"key":"minecraft","label":"Minecraft Pumpkin (Rust)","container":"yacacode-mc","exists":true,"running":true,"state":"running","health":"healthy","startedAt":"2026-11-20T01:17:19.238573535Z","restartCount":0}],"network":{"checkedAt":1795144365528,"publicIp":"177.37.137.121","domainIps":["45.179.88.242"],"dnsSynced":false,"error":null},"history":[{"ts":1795144365528,"hostMemPercent":17,"mcMemMB":334,"mcCpuPercent":0.3,"tempC":44.7}],"dockerAvailable":true}
        """.trimIndent()
        val parsed = json.decodeFromString<OverviewResponse>(raw)
        assertEquals("26.3", parsed.server.runningVersion)
        assertEquals(44.7, parsed.host.temperature?.celsius)
        assertEquals(1, parsed.history.size)
    }

    @Test
    fun decodeProductionPlayersAndGDrive() {
        val playersRaw = """
            {"online":[{"name":".BedrockUser","edition":"bedrock"}],"max":6,"whitelistEnabled":false,"whitelist":["Nycolazs"],"ops":[{"uuid":"1fa74ed4-a987-4bab-8dd9-2fb9bb12292b","name":"Nycolazs","level":4}],"bannedPlayers":[],"bannedIps":[]}
        """.trimIndent()
        val p = json.decodeFromString<PlayersResponse>(playersRaw)
        assertTrue(p.online.first().isBedrock)
        assertEquals("Nycolazs", p.whitelist.first().name)
        assertEquals(4, p.ops.first().level)

        val gdRaw = """
            {"connected":true,"hasCredentials":true,"enabled":true,"syncInProgress":false,"progress":{"active":false,"stage":"idle","percent":0,"message":"","fileName":null,"uploadedBytes":0,"totalBytes":0,"speedBps":0,"startedAt":null,"finishedAt":null,"error":null},"accountEmail":"admin@example.com","folderName":"YacaCode Minecraft Backups","scheduleHours":24,"maxBackups":10,"remoteFiles":[{"id":"test-drive-file-id","name":"yacacode-world-20261119-235118.tar.gz","size":194159472,"createdTime":"2026-11-20T02:54:52.115Z","webViewLink":"https://drive.google.com/file/d/test-drive-file-id/view"}]}
        """.trimIndent()
        val gd = json.decodeFromString<GDriveStatusResponse>(gdRaw)
        assertTrue(gd.connected)
        assertEquals(1, gd.remoteFiles?.size)
    }

    @Test
    fun classifyConsoleLines() {
        assertEquals(ConsoleLogKind.CHAT, ConsoleLogLine.classify("00:04:00  INFO <chat> Nycolazs: oi"))
        assertEquals(ConsoleLogKind.WARN, ConsoleLogLine.classify("WARN High tick time"))
        assertEquals(ConsoleLogKind.ERROR, ConsoleLogLine.classify("ERROR Failed to bind"))
        assertEquals(ConsoleLogKind.GEYSER, ConsoleLogLine.classify("Geyser-Spigot listening"))
        assertEquals(ConsoleLogKind.INFO, ConsoleLogLine.classify("00:01:00  INFO Server started"))
    }

    @Test
    fun parseMarkdownBlocks() {
        val md = """
            # Status
            Tudo **online** agora.
            - Item A
            - Item B
            ```bash
            time set day
            ```
        """.trimIndent()
        val blocks = MarkdownParser.parse(md)
        assertEquals(4, blocks.size)
        val code = blocks[3] as MarkdownBlock.CodeBlock
        assertEquals("bash", code.language)
        assertEquals("time set day", code.code)
    }

    @Test
    fun normalizeBaseUrl() {
        assertEquals("https://painel.yacacode.com", YacaCodeApiClient.normalizeBaseUrl("painel.yacacode.com/"))
        assertEquals("http://100.73.198.14:8080", YacaCodeApiClient.normalizeBaseUrl("http://100.73.198.14:8080/"))
        assertEquals("https://painel.yacacode.com", YacaCodeApiClient.normalizeBaseUrl(""))
    }

    @Test
    fun detectCoroutineAndOkHttpCancellations() {
        assertTrue(CancellationException("Tab switched").isCancellation())
        assertTrue(IOException("Canceled").isCancellation())
        assertTrue(RuntimeException("wrapper", CancellationException()).isCancellation())
        assertFalse(ApiException(500, "Internal error").isCancellation())
        assertFalse(IOException("Connection timed out").isCancellation())
    }

    @Test
    fun compareSemanticVersionsForOtaUpdater() {
        assertTrue(AppUpdater.isNewerVersion("v1.1.1", "1.1.0"))
        assertTrue(AppUpdater.isNewerVersion("v1.2.0", "1.1.9"))
        assertTrue(AppUpdater.isNewerVersion("2.0.0", "1.9.9"))
        assertFalse(AppUpdater.isNewerVersion("v1.1.0", "1.1.0"))
        assertFalse(AppUpdater.isNewerVersion("v1.0.9", "1.1.0"))
    }

    @Test
    fun decodeSyncedAiConversationsAndGitHubRelease() {
        val convRaw = """
            {"conversations":[{"id":"conv_1","title":"Quem tá online?","createdAt":"2026-11-20T16:50:00Z","updatedAt":"2026-11-20T16:51:00Z","messageCount":2,"preview":"0 jogadores online"}],"activeConversationId":"conv_1","activeConversation":{"id":"conv_1","title":"Quem tá online?","messages":[{"id":"m1","role":"user","text":"Quem tá online?","time":"13:50"},{"id":"m2","role":"model","text":"0 jogadores online","model":"gemini-3.5-flash-lite","time":"13:50"}]}}
        """.trimIndent()
        val parsed = json.decodeFromString<AiConversationsResponse>(convRaw)
        assertEquals("conv_1", parsed.activeConversationId)
        assertEquals(1, parsed.conversations.size)
        assertEquals(2, parsed.activeConversation?.messages?.size)

        val relRaw = """
            {"tag_name":"v1.2.0","name":"v1.2.0","body":"Sync + OTA","html_url":"https://github.com/Nycolazs/yacacode-minecraft/releases/tag/v1.2.0","assets":[{"name":"YacaCode-Minecraft-v1.2.0.apk","browser_download_url":"https://example.com/app.apk","size":13600000}]}
        """.trimIndent()
        val rel = json.decodeFromString<GitHubReleaseDto>(relRaw)
        assertEquals("v1.2.0", rel.tagName)
        assertEquals(1, rel.assets.size)
        assertTrue(rel.assets.first().name.endsWith(".apk"))
    }
}
