import XCTest
@testable import YacaCodeMC

final class YacaCodeMCTests: XCTestCase {

    func testDecodeProductionAuthMe() throws {
        let json = """
        {"authenticated":true,"username":"nycolas","displayName":"nycolas","role":"admin","isOwner":true,"expiresAt":1795230867954,"cfEmail":null,"viaCloudflare":true,"cfAccessEnabled":false,"brand":{"name":"YacaCode","mcVersion":"26.3","mcDomain":"mc.yacacode.com","panelDomain":"painel.yacacode.com","javaPort":25565,"bedrockPort":19132}}
        """
        let decoded = try JSONDecoder().decode(AuthMeResponse.self, from: Data(json.utf8))
        XCTAssertTrue(decoded.authenticated)
        XCTAssertEqual(decoded.username, "nycolas")
        XCTAssertTrue(decoded.isAdmin)
        XCTAssertEqual(decoded.brand?.mcDomain, "mc.yacacode.com")
    }

    func testDecodeProductionOverview() throws {
        let json = """
        {"server":{"name":"YacaCode","configuredVersion":"26.3","runningVersion":"26.3","container":{"exists":true,"id":"0e4c8f86499c","name":"yacacode-mc","image":"yacacode-pumpkin-rust:latest","tty":false,"state":"running","running":true,"restarting":false,"startedAt":"2026-11-20T01:17:19.238573535Z","finishedAt":"0001-01-01T00:00:00Z","restartCount":0,"health":"healthy","memLimitBytes":805306368},"stats":{"cpuPercent":0.3,"cpuCoresUsed":0.01,"onlineCpus":4,"memUsedBytes":350453760,"memLimitBytes":805306368,"memPercent":43.5,"rxBytes":14643923,"txBytes":73435086},"ping":{"online":true,"latencyMs":12,"version":"26.3","motd":"YacaCode"},"tps":{"tps1m":20,"tps5m":20,"tps15m":20,"raw":"20.0 (Rust Native Engine)"},"players":{"online":0,"max":6,"list":[],"javaCount":0,"bedrockCount":0},"crossplay":{"geyserInstalled":true,"floodgateInstalled":true,"geyserConfigured":true},"backupCount":0,"latestBackup":null},"connection":{"mcDomain":"mc.yacacode.com","panelDomain":"painel.yacacode.com","javaPort":25565,"bedrockPort":19132,"viaCloudflare":true,"cfEmail":null},"host":{"arch":"arm64","platform":"linux","hostname":"2ce4eba9c97d","cpuCores":4,"cpuModel":"Cortex-A53","loadAvg":[0.02,0.16,0.46],"uptimeSeconds":35805,"memory":{"totalBytes":4110106624,"usedBytes":699654144,"availableBytes":3410452480,"percent":17,"swapTotalBytes":4202528768,"swapUsedBytes":0,"swapPercent":0},"temperature":{"celsius":44.7,"status":"ok","sensors":[{"name":"cpu-thermal","celsius":44.7}]},"disk":{"totalBytes":31071121408,"usedBytes":7738986496,"freeBytes":23332134912,"percent":24.9}},"stack":[{"key":"minecraft","label":"Minecraft Pumpkin (Rust)","container":"yacacode-mc","exists":true,"running":true,"state":"running","health":"healthy","startedAt":"2026-11-20T01:17:19.238573535Z","restartCount":0}],"network":{"checkedAt":1795144365528,"publicIp":"177.37.137.121","domainIps":["45.179.88.242"],"dnsSynced":false,"error":null},"history":[{"ts":1795144365528,"hostMemPercent":17,"mcMemMB":334,"mcCpuPercent":0.3,"tempC":44.7}],"dockerAvailable":true}
        """
        let decoded = try JSONDecoder().decode(OverviewResponse.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.server.runningVersion, "26.3")
        XCTAssertEqual(decoded.host.temperature?.celsius, 44.7)
        XCTAssertEqual(decoded.history.count, 1)
    }

    func testDecodeProductionPlayersAndGDrive() throws {
        let playersJson = """
        {"online":[{"name":".BedrockGuy","edition":"bedrock"}],"max":6,"whitelistEnabled":false,"whitelist":["Nycolazs"],"ops":[{"uuid":"1fa74ed4-a987-4bab-8dd9-2fb9bb12292b","name":"Nycolazs","level":4}],"bannedPlayers":[],"bannedIps":[]}
        """
        let p = try JSONDecoder().decode(PlayersResponse.self, from: Data(playersJson.utf8))
        XCTAssertEqual(p.online.first?.isBedrock, true)
        XCTAssertEqual(p.whitelist.first?.name, "Nycolazs")
        XCTAssertEqual(p.ops.first?.level, 4)

        let gdriveJson = """
        {"connected":true,"hasCredentials":true,"enabled":true,"syncInProgress":false,"progress":{"active":false,"stage":"idle","percent":0,"message":"","fileName":null,"uploadedBytes":0,"totalBytes":0,"speedBps":0,"startedAt":null,"finishedAt":null,"error":null},"accountEmail":"admin@example.com","folderName":"YacaCode Minecraft Backups","scheduleHours":24,"maxBackups":10,"remoteFiles":[{"id":"test-drive-file-id","name":"yacacode-world-20261119-235118.tar.gz","size":194159472,"createdTime":"2026-11-20T02:54:52.115Z","webViewLink":"https://drive.google.com/file/d/test-drive-file-id/view"}]}
        """
        let gd = try JSONDecoder().decode(GDriveStatusResponse.self, from: Data(gdriveJson.utf8))
        XCTAssertTrue(gd.connected)
        XCTAssertEqual(gd.remoteFiles?.count, 1)
    }

    func testSSELineParser() {
        var parser = SSELineParser()
        XCTAssertNil(parser.feed(line: ": keepalive"))
        XCTAssertNil(parser.feed(line: "event: log"))
        XCTAssertNil(parser.feed(line: #"data: {"line":"hello","ts":123}"#))
        let ev = parser.feed(line: "")
        XCTAssertEqual(ev?.event, "log")
        XCTAssertEqual(ev?.data, #"{"line":"hello","ts":123}"#)
    }

    func testConsoleLogClassifier() {
        XCTAssertEqual(ConsoleLogLine.classify("00:04:00  INFO <chat> Nycolazs: oi"), .chat)
        XCTAssertEqual(ConsoleLogLine.classify("WARN High tick time"), .warn)
        XCTAssertEqual(ConsoleLogLine.classify("ERROR Failed to bind port"), .error)
        XCTAssertEqual(ConsoleLogLine.classify("Geyser-Spigot listening on 19132"), .geyser)
        XCTAssertEqual(ConsoleLogLine.classify("00:01:00  INFO Server started"), .info)
    }

    func testMarkdownParser() {
        let md = """
        # Status
        Tudo **online** agora.
        - Item 1
        - Item 2
        ```bash
        time set day
        ```
        """
        let blocks = MarkdownBlockParser.parse(md)
        XCTAssertEqual(blocks.count, 4)
        if case .codeBlock(let lang, let code) = blocks[3] {
            XCTAssertEqual(lang, "bash")
            XCTAssertEqual(code, "time set day")
        } else {
            XCTFail("Expected codeBlock")
        }
    }

    func testURLNormalization() {
        XCTAssertEqual(APIClient.normalizeBaseURL("painel.yacacode.com/"), "https://painel.yacacode.com")
        XCTAssertEqual(APIClient.normalizeBaseURL("http://100.73.198.14:8080/"), "http://100.73.198.14:8080")
        XCTAssertEqual(APIClient.normalizeBaseURL(""), "https://painel.yacacode.com")
    }
}
