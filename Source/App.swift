import AppKit
import PDFKit
import UniformTypeIdentifiers
import WebKit

final class ExamWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class APExamSchemeHandler: NSObject, WKURLSchemeHandler {
    private let resourcesURL: URL
    private let vaultRootURL: URL
    private var docCache: [String: PDFDocument] = [:]
    private var pageCache: [String: Data] = [:]
    private var pageOrder: [String] = []
    private let cacheLock = NSLock()

    init(resourcesURL: URL) {
        self.resourcesURL = resourcesURL
        let bundleParent = Bundle.main.bundleURL.deletingLastPathComponent() // 模考系统 or /Applications
        let rootCandidate = bundleParent.deletingLastPathComponent() // AP 内容学习
        if bundleParent.path != "/Applications" &&
           FileManager.default.fileExists(atPath: rootCandidate.appendingPathComponent("计算机A").path) {
            self.vaultRootURL = rootCandidate
        } else {
            self.vaultRootURL = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Documents/AP 内容学习")
        }
        super.init()
    }

    private func respond(_ urlSchemeTask: WKURLSchemeTask, status: Int = 200, mime: String, data: Data) {
        guard let url = urlSchemeTask.request.url else { return }
        let headers = [
            "Content-Type": mime,
            "Content-Length": "\(data.count)",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache"
        ]
        if let resp = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) {
            urlSchemeTask.didReceive(resp)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        }
    }

    private func respondError(_ urlSchemeTask: WKURLSchemeTask, status: Int, msg: String) {
        let data = ("{\"error\":" + (String(data: (try? JSONSerialization.data(withJSONObject: [msg])) ?? Data(), encoding: .utf8) ?? "[\"\"]") + "}").data(using: .utf8) ?? Data()
        respond(urlSchemeTask, status: status, mime: "application/json", data: data)
    }

    private func safeResolve(relPath: String, under base: URL) -> URL? {
        let trimmed = relPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if trimmed.contains("..") { return nil }
        let target = base.appendingPathComponent(trimmed).standardizedFileURL
        let baseStd = base.standardizedFileURL.path
        if target.path == baseStd || target.path.hasPrefix(baseStd + "/") {
            return target
        }
        return nil
    }

    private func queryParam(_ url: URL, name: String) -> String? {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let items = comps.percentEncodedQueryItems,
              let rawVal = items.first(where: { $0.name == name })?.value else {
            return nil
        }
        return rawVal.replacingOccurrences(of: "+", with: "%20").removingPercentEncoding ?? rawVal
    }

    private func loadPDF(relPath: String) -> PDFDocument? {
        guard let fileURL = safeResolve(relPath: relPath, under: vaultRootURL) else { return nil }
        cacheLock.lock()
        if let doc = docCache[fileURL.path] {
            cacheLock.unlock()
            return doc
        }
        cacheLock.unlock()
        guard let doc = PDFDocument(url: fileURL) else { return nil }
        cacheLock.lock()
        if docCache.count > 16 { docCache.removeAll() }
        docCache[fileURL.path] = doc
        cacheLock.unlock()
        return doc
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            respondError(urlSchemeTask, status: 400, msg: "Missing URL")
            return
        }
        let host = url.host ?? ""
        let rel = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))

        if host == "data" || host == "media" {
            let base = resourcesURL.appendingPathComponent("Data")
            let sub = host == "media" ? "media/\(rel)" : rel
            guard let target = safeResolve(relPath: sub, under: base),
                  let data = try? Data(contentsOf: target) else {
                respondError(urlSchemeTask, status: 404, msg: "Not found: \(sub)")
                return
            }
            let ext = target.pathExtension.lowercased()
            let mime: String = {
                switch ext {
                case "json": return "application/json; charset=utf-8"
                case "png": return "image/png"
                case "jpg", "jpeg": return "image/jpeg"
                case "svg": return "image/svg+xml"
                case "webp": return "image/webp"
                case "gif": return "image/gif"
                case "js": return "application/javascript; charset=utf-8"
                default: return "application/octet-stream"
                }
            }()
            respond(urlSchemeTask, mime: mime, data: data)
            return
        }

        if host == "pdf-info" || host == "pdf-page" {
            let relPath = queryParam(url, name: "path") ?? ""
            guard let doc = loadPDF(relPath: relPath) else {
                respondError(urlSchemeTask, status: 404, msg: "PDF not found: \(relPath)")
                return
            }
            if host == "pdf-info" {
                let info: [String: Any] = ["pages": doc.pageCount, "path": relPath]
                let data = (try? JSONSerialization.data(withJSONObject: info)) ?? Data()
                respond(urlSchemeTask, mime: "application/json; charset=utf-8", data: data)
                return
            }
            let pageNum = Int(queryParam(url, name: "page") ?? "1") ?? 1
            let scaleVal = Double(queryParam(url, name: "scale") ?? "2.0") ?? 2.0
            let scale = CGFloat(min(max(scaleVal, 0.75), 3.0))
            guard pageNum >= 1 && pageNum <= doc.pageCount,
                  let page = doc.page(at: pageNum - 1) else {
                respondError(urlSchemeTask, status: 400, msg: "Invalid page \(pageNum)")
                return
            }
            let cacheKey = "\(relPath)#\(pageNum)@\(String(format: "%.2f", scale))"
            cacheLock.lock()
            if let cached = pageCache[cacheKey] {
                cacheLock.unlock()
                respond(urlSchemeTask, mime: "image/png", data: cached)
                return
            }
            cacheLock.unlock()

            let box = page.bounds(for: .mediaBox)
            let w = max(1, Int(box.width * scale))
            let h = max(1, Int(box.height * scale))
            guard let rep = NSBitmapImageRep(
                bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h,
                bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
            ) else {
                respondError(urlSchemeTask, status: 500, msg: "Bitmap alloc failed")
                return
            }
            NSGraphicsContext.saveGraphicsState()
            let ctx = NSGraphicsContext(bitmapImageRep: rep)!
            NSGraphicsContext.current = ctx
            let cg = ctx.cgContext
            cg.setFillColor(NSColor.white.cgColor)
            cg.fill(CGRect(x: 0, y: 0, width: w, height: h))
            cg.saveGState()
            cg.scaleBy(x: scale, y: scale)
            page.draw(with: .mediaBox, to: cg)
            cg.restoreGState()
            NSGraphicsContext.restoreGraphicsState()
            guard let png = rep.representation(using: .png, properties: [:]) else {
                respondError(urlSchemeTask, status: 500, msg: "PNG encode failed")
                return
            }
            cacheLock.lock()
            if pageOrder.count >= 28, let oldest = pageOrder.first {
                pageOrder.removeFirst()
                pageCache.removeValue(forKey: oldest)
            }
            pageCache[cacheKey] = png
            pageOrder.append(cacheKey)
            cacheLock.unlock()
            respond(urlSchemeTask, mime: "image/png", data: png)
            return
        }

        respondError(urlSchemeTask, status: 404, msg: "Unknown apexam route: \(host)")
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler, WKScriptMessageHandlerWithReply {
    private var window: NSWindow!
    private var web: WKWebView!
    private var answerSound: NSSound?
    private var cachedSounds: [String: Data] = [:]
    private var history: HistoryStore?
    private var focused = false
    private var previousOptions: NSApplication.PresentationOptions = []
    private var previousFrame = NSRect.zero
    private var previousStyle: NSWindow.StyleMask = []
    private var resources: URL { Bundle.main.resourceURL! }
    private lazy var schemeHandler = APExamSchemeHandler(resourcesURL: resources)
    private lazy var localSession: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.connectionProxyDictionary = [:]
        cfg.timeoutIntervalForRequest = 15
        return URLSession(configuration: cfg)
    }()

    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(schemeHandler, forURLScheme: "apexam")
        config.userContentController.add(self, name: "roomAnswerSound")
        config.userContentController.add(self, name: "roomFocus")
        config.userContentController.add(self, name: "roomExitFocus")
        history = try? HistoryStore()
        config.userContentController.add(self, name: "roomHistory")
        config.userContentController.add(self, name: "roomExport")
        config.userContentController.add(self, name: "roomBackup")
        config.userContentController.add(self, name: "roomDeleteHistory")
        config.userContentController.add(self, name: "roomOpenExternalPdf")
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "roomCopyQuestion")
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "roomLocalFetch")
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "roomRunJava")
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "roomSyncPull")
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "roomSyncPush")
        config.websiteDataStore = .default()
        config.mediaTypesRequiringUserActionForPlayback = .all
        web = WKWebView(frame: .zero, configuration: config)
        web.uiDelegate = self
        web.navigationDelegate = self
        window = ExamWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "AP Exam Room"
        window.minSize = NSSize(width: 680, height: 520)
        window.contentView = web
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "About AP Exam Room", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(withTitle: "Quit AP Exam Room", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editItem = NSMenuItem()
        menu.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        editItem.submenu = editMenu
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        let viewItem = NSMenuItem()
        menu.addItem(viewItem)
        let viewMenu = NSMenu(title: "Question Bank")
        viewItem.submenu = viewMenu
        viewMenu.addItem(withTitle: "Back to Question Bank", action: #selector(returnToBank), keyEquivalent: "l").target = self
        let leave = viewMenu.addItem(withTitle: "Exit Focus Mode", action: #selector(leaveFocus), keyEquivalent: "l")
        leave.keyEquivalentModifierMask = [.command, .option]
        leave.target = self
        NSApp.mainMenu = menu
        for named in ["correct", "incorrect"] {
            if let url = Bundle.main.url(forResource: "answer-" + named, withExtension: "wav", subdirectory: "Assets"),
               let data = try? Data(contentsOf: url) {
                cachedSounds[named] = data
            }
        }
        web.loadFileURL(resources.appendingPathComponent("index.html"), allowingReadAccessTo: resources)
    }

    @objc private func returnToBank() {
        web.evaluateJavaScript("returnToLibrary()")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame else { return }
        if message.name == "roomOpenExternalPdf", let rel = message.body as? String {
            let bundleParent = Bundle.main.bundleURL.deletingLastPathComponent()
            let fallbackVault = ProcessInfo.processInfo.environment["AP_EXAM_VAULT"].map { URL(fileURLWithPath: $0) }
                ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Documents/AP-Exam-Vault")
            let root = FileManager.default.fileExists(atPath: bundleParent.deletingLastPathComponent().appendingPathComponent("计算机A").path)
                ? bundleParent.deletingLastPathComponent()
                : fallbackVault
            let cleaned = rel.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            if !cleaned.contains("..") {
                let target = root.appendingPathComponent(cleaned)
                if FileManager.default.fileExists(atPath: target.path) {
                    NSWorkspace.shared.open(target)
                }
            }
            return
        }
        if message.name == "roomAnswerSound" {
            guard let named = message.body as? String, ["correct", "incorrect"].contains(named) else { return }
            let data = cachedSounds[named] ?? {
                guard let url = Bundle.main.url(forResource: "answer-" + named, withExtension: "wav", subdirectory: "Assets") else { return nil }
                return try? Data(contentsOf: url)
            }()
            guard let soundData = data else { return }
            answerSound?.stop()
            answerSound = NSSound(data: soundData)
            answerSound?.play()
            return
        }
        if message.name == "roomHistory" {
            do {
                guard let history else { throw CocoaError(.fileWriteUnknown) }
                try history.save(message.body as? [[String: Any]] ?? [])
                web.evaluateJavaScript("receiveRoomHistory(" + (try history.load()) + ")")
            } catch {
                web.evaluateJavaScript("showHistoryStorageError()")
            }
            return
        }
        if message.name == "roomDeleteHistory" {
            do {
                guard let history, let payload = message.body as? [String: Any],
                      let all = payload["all"] as? Bool, let exams = payload["exams"] as? [String] else {
                    throw CocoaError(.fileWriteUnknown)
                }
                try history.delete(examIDs: all ? nil : exams)
                web.evaluateJavaScript("finishRoomDeletion(true)")
            } catch {
                web.evaluateJavaScript("finishRoomDeletion(false)")
            }
            return
        }
        if ["roomExport", "roomBackup"].contains(message.name), let contents = message.body as? String {
            let isBackup = message.name == "roomBackup"
            let panel = NSSavePanel()
            panel.allowedContentTypes = [.json]
            if isBackup {
                let date = Date.now.formatted(.iso8601.year().month().day().dateSeparator(.dash))
                panel.nameFieldStringValue = "AP Exam Room Backup \(date).json"
            } else {
                panel.nameFieldStringValue = "AP missed questions.json"
            }
            panel.beginSheetModal(for: window) { result in
                guard result == .OK, let url = panel.url else { return }
                do {
                    try contents.write(to: url, atomically: true, encoding: .utf8)
                    if isBackup { self.web.evaluateJavaScript("showRoomSettingsStatus('Backup saved.')") }
                }
                catch { NSAlert(error: error).runModal() }
            }
            return
        }
        if message.name == "roomExitFocus" { leaveFocus(); return }
        guard message.name == "roomFocus", let active = message.body as? Bool else { return }
        setFocusMode(active)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let index = resources.appendingPathComponent("index.html").standardizedFileURL
        guard message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.standardizedFileURL == index else {
            replyHandler(nil, "unauthorized")
            return
        }
        if message.name == "roomLocalFetch",
           let payload = message.body as? [String: Any],
           let urlStr = payload["url"] as? String,
           let url = URL(string: urlStr),
           let host = url.host, ["127.0.0.1", "localhost"].contains(host) {
            var req = URLRequest(url: url)
            req.httpMethod = (payload["method"] as? String) ?? "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let headers = payload["headers"] as? [String: String] {
                for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
            }
            if let body = payload["body"] as? String {
                req.httpBody = body.data(using: .utf8)
            }
            localSession.dataTask(with: req) { data, _, err in
                if let err {
                    replyHandler(nil, err.localizedDescription)
                    return
                }
                let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                replyHandler(text, nil)
            }.resume()
            return
        }
        if message.name == "roomRunJava",
           let payload = message.body as? [String: Any],
           let rawCode = payload["code"] as? String {
            DispatchQueue.global(qos: .userInitiated).async {
                let res = self.runJavaSnippet(rawCode)
                replyHandler(res, nil)
            }
            return
        }
        if message.name == "roomSyncPull" {
            guard let history else { replyHandler(["error": "history unavailable"], nil); return }
            let payload = message.body as? [String: Any] ?? [:]
            let since: Int64 = {
                if let n = payload["since"] as? Int64 { return n }
                if let n = payload["since"] as? Double { return Int64(n) }
                if let n = payload["since"] as? Int { return Int64(n) }
                return 0
            }()
            do {
                replyHandler(try history.pullSync(since: since), nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }
            return
        }
        if message.name == "roomSyncPush" {
            guard let history else { replyHandler(["error": "history unavailable"], nil); return }
            let payload = message.body as? [String: Any] ?? [:]
            let items = payload["items"] as? [String: [String: Any]] ?? [:]
            let historyRows = payload["historyRows"] as? [[String: Any]]
            do {
                replyHandler(try history.pushSync(items: items, historyRows: historyRows), nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }
            return
        }
        guard message.name == "roomCopyQuestion",
              let payload = message.body as? [String: String],
              let text = payload["text"], !text.isEmpty, let html = payload["html"] else {
            replyHandler(false, nil)
            return
        }
        let clipboard = NSPasteboard.general
        let item = NSPasteboardItem()
        item.setString(text, forType: .string)
        item.setString(html, forType: .html)
        clipboard.clearContents()
        replyHandler(clipboard.writeObjects([item]), nil)
    }

    private func runProcessWithTimeout(_ exe: String, args: [String], timeoutSec: TimeInterval = 5.0) -> (Int32, String) {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: exe)
        proc.arguments = args
        let outPipe = Pipe()
        let errPipe = Pipe()
        proc.standardOutput = outPipe
        proc.standardError = errPipe
        do {
            try proc.run()
        } catch {
            return (-1, "Failed to launch \(exe): \(error.localizedDescription)")
        }
        let sem = DispatchSemaphore(value: 0)
        proc.terminationHandler = { _ in sem.signal() }
        if sem.wait(timeout: .now() + timeoutSec) == .timedOut {
            proc.terminate()
            return (-2, "Execution timed out after \(Int(timeoutSec))s.")
        }
        let outData = outPipe.fileHandleForReading.readDataToEndOfFile()
        let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
        let combined = (String(data: outData, encoding: .utf8) ?? "") + (String(data: errData, encoding: .utf8) ?? "")
        return (proc.terminationStatus, combined)
    }

    private func runJavaSnippet(_ rawCode: String) -> [String: Any] {
        let trimmed = rawCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return ["ok": false, "output": "Editor is empty. Enter Java statements, methods, or a class first."]
        }
        let tmpDir = FileManager.default.temporaryDirectory.appendingPathComponent("apexam_java_\(UUID().uuidString)")
        do {
            try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
        } catch {
            return ["ok": false, "output": "Temp dir error: \(error.localizedDescription)"]
        }
        defer { try? FileManager.default.removeItem(at: tmpDir) }

        var className = "Main"
        var javaSource = rawCode
        var hasMain = rawCode.contains("static void main")

        if let pubRange = rawCode.range(of: #"public\s+class\s+([A-Za-z_]\w*)"#, options: .regularExpression) {
            let decl = String(rawCode[pubRange])
            if let namePart = decl.split(whereSeparator: { $0.isWhitespace }).last {
                className = String(namePart)
            }
            if !hasMain, let lastBrace = rawCode.lastIndex(of: "}") {
                javaSource = String(rawCode[..<lastBrace]) + "\n    public static void main(String[] args) { System.out.println(\"Compiled successfully! (Add static void main or call your methods inside main to run tests.)\"); }\n}\n"
                hasMain = true
            }
        } else if let clsRange = rawCode.range(of: #"\bclass\s+([A-Za-z_]\w*)"#, options: .regularExpression) {
            let decl = String(rawCode[clsRange])
            if let namePart = decl.split(whereSeparator: { $0.isWhitespace }).last {
                className = String(namePart)
            }
            if !hasMain {
                javaSource += "\nclass _Runner {\n    public static void main(String[] args) { System.out.println(\"Compiled successfully (0 syntax errors).\"); }\n}\n"
                className = "_Runner"
                hasMain = true
            }
        } else if rawCode.range(of: #"(?:^|\n)\s*(?:public|private|static)\s+[\w<>\[\]]+\s+\w+\s*\("#, options: .regularExpression) != nil {
            javaSource = "import java.util.*;\npublic class Main {\n" + rawCode + "\n    public static void main(String[] args) { System.out.println(\"Method(s) compiled cleanly (0 syntax errors).\"); }\n}\n"
            hasMain = true
        } else {
            javaSource = "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n" + rawCode + "\n    }\n}\n"
            hasMain = true
        }

        let srcFile = tmpDir.appendingPathComponent("\(className == "_Runner" ? "Solution" : className).java")
        do {
            try javaSource.write(to: srcFile, atomically: true, encoding: .utf8)
        } catch {
            return ["ok": false, "output": "Write error: \(error.localizedDescription)"]
        }

        let (cCode, cOut) = runProcessWithTimeout("/usr/bin/javac", args: ["-d", tmpDir.path, srcFile.path], timeoutSec: 8.0)
        if cCode != 0 {
            return ["ok": false, "output": cOut.isEmpty ? "Compilation failed." : cOut]
        }
        if !hasMain {
            return ["ok": true, "output": "Compiled successfully (0 errors)."]
        }
        let (rCode, rOut) = runProcessWithTimeout("/usr/bin/java", args: ["-Xmx128m", "-cp", tmpDir.path, className], timeoutSec: 5.0)
        let outTrim = rOut.trimmingCharacters(in: .whitespacesAndNewlines)
        return [
            "ok": rCode == 0,
            "output": outTrim.isEmpty ? (rCode == 0 ? "(Program finished with exit code 0 and no stdout.)" : "Runtime error (exit \(rCode)).") : outTrim
        ]
    }

    private func setFocusMode(_ active: Bool) {
        guard active != focused else { return }
        focused = active
        if active {
            let screen = window.screen ?? NSScreen.main
            previousOptions = NSApp.presentationOptions
            previousFrame = window.frame
            previousStyle = window.styleMask
            NSApp.presentationOptions = [.hideDock, .hideMenuBar, .disableProcessSwitching]
            window.styleMask = [.borderless]
            fitFocusWindow(to: screen)
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        } else {
            NSApp.presentationOptions = previousOptions
            window.styleMask = previousStyle
            window.setFrame(previousFrame, display: true)
            window.makeKeyAndOrderFront(nil)
        }
    }

    private func fitFocusWindow(to screen: NSScreen?) {
        guard let screen else { return }
        var frame = screen.frame
        if #available(macOS 12.0, *) {
            let insets = screen.safeAreaInsets
            frame.origin.x += insets.left
            frame.origin.y += insets.bottom
            frame.size.width -= insets.left + insets.right
            frame.size.height -= insets.top + insets.bottom
        }
        if window.frame != frame {
            window.setFrame(frame, display: true)
        }
    }

    func applicationDidChangeScreenParameters(_ notification: Notification) {
        guard focused else { return }
        fitFocusWindow(to: window.screen ?? NSScreen.main)
    }

    @objc private func leaveFocus() {
        guard focused else { return }
        let alert = NSAlert()
        alert.messageText = "Exit Focus Mode?"
        alert.informativeText = "Your responses and timer will be preserved."
        alert.addButton(withTitle: "Exit Focus Mode")
        alert.addButton(withTitle: "Keep Testing")
        alert.beginSheetModal(for: window) { [weak self] response in
            if response == .alertFirstButtonReturn {
                self?.web.evaluateJavaScript("leaveRoomFocus()")
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.targetFrame?.isMainFrame == true,
           navigationAction.request.url?.standardizedFileURL != resources.appendingPathComponent("index.html").standardizedFileURL {
            decisionHandler(.cancel)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { result in
            completionHandler(result == .OK ? panel.urls : nil)
        }
    }
}

@main
struct ExamRoom {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}
