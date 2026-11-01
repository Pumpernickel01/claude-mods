// Wake-word listener for the Claude HUD. On-device speech recognition (Apple's Speech framework);
// nothing leaves the Mac and nothing is kept until "Hey Claude" is heard. Then: the HUD fades in over
// the screen in a window of this app, and what you say next goes to Jarvis.
//
//   listen                         listen until killed
//   listen --text "hey claude ..." push a transcript through the wake handler (no microphone)
//   listen --window                fade the HUD window in and out once, checking it took the keyboard
//   --dry-run                      print what would be sent instead of calling the server
//
// Built by dock.py: swiftc -swift-version 5 with an embedded Info.plist (usage descriptions).
import AppKit
import AVFoundation
import CoreAudio
import Speech
import WebKit

let args = CommandLine.arguments
let port = ProcessInfo.processInfo.environment["CLAUDE_MODS_HUD_PORT"] ?? "7431"
// where dock.py lives: from the environment, else the note the build left in the app bundle (launched by
// the Finder, launchd or `open`, the app gets no environment of ours)
let hudDir = ProcessInfo.processInfo.environment["CLAUDE_HUD_DIR"]
    ?? (Bundle.main.resourcePath.flatMap { try? String(contentsOfFile: $0 + "/hud_dir", encoding: .utf8) })?.trimmingCharacters(in: .whitespacesAndNewlines)
    ?? FileManager.default.currentDirectoryPath
let dryRun = args.contains("--dry-run")
let tokenFile = ProcessInfo.processInfo.environment["CLAUDE_HUD_TOKEN_FILE"] ?? (NSHomeDirectory() + "/.cache/claude-hud/token")
func token() -> String { (try? String(contentsOfFile: tokenFile, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
// "hey"/"hay" with the name or its usual mishearings; "hi" only with the name itself. Never a bare article:
// "a cloud" is ordinary speech, and anything after a false wake would be sent and billed.
// Timing, in seconds, with overrides in ~/.config/claude-hud/listen.conf (one `key=value` per line):
//   pause  silence that ends a sentence (3.5)      max     longest question (30)
//   grace  "sending in…" window you can still cancel or continue in (2.5)   followup  wake-free seconds after an answer (8)
let conf: [String: Double] = {
    var d: [String: Double] = ["pause": 3.5, "max": 30, "grace": 2.5, "followup": 8]
    let path = NSHomeDirectory() + "/.config/claude-hud/listen.conf"
    for line in ((try? String(contentsOfFile: path, encoding: .utf8)) ?? "").split(separator: "\n") {
        let kv = line.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
        if kv.count == 2, let v = Double(kv[1]), d[kv[0]] != nil { d[kv[0]] = v }
    }
    return d
}()
// input=builtin (default) pins the Mac's own microphone: a Bluetooth headset's microphone runs in a
// low-quality phone mode the recognizer hears badly, and pinning keeps the headset in music quality.
// input=default follows whatever macOS has selected.
let inputPref: String = {
    let path = NSHomeDirectory() + "/.config/claude-hud/listen.conf"
    for line in ((try? String(contentsOfFile: path, encoding: .utf8)) ?? "").split(separator: "\n") {
        let kv = line.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
        if kv.count == 2, kv[0] == "input" { return kv[1] }
    }
    return "builtin"
}()

func audioProperty<T>(_ id: AudioObjectID, _ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope, _ value: inout T) -> Bool {
    var addr = AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    var size = UInt32(MemoryLayout<T>.size)
    return AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &value) == noErr
}

func deviceName(_ id: AudioDeviceID) -> String {
    var name: CFString = "" as CFString
    return audioProperty(id, kAudioObjectPropertyName, kAudioObjectPropertyScopeGlobal, &name) ? (name as String) : "device \(id)"
}

/// The built-in microphone, or nil when there is none (a Mac mini with nothing plugged in).
func builtInInputDevice() -> AudioDeviceID? {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr else { return nil }
    var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else { return nil }
    for id in ids {
        var transport: UInt32 = 0
        guard audioProperty(id, kAudioDevicePropertyTransportType, kAudioObjectPropertyScopeGlobal, &transport), transport == kAudioDeviceTransportTypeBuiltIn else { continue }
        var cfg = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreamConfiguration, mScope: kAudioObjectPropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
        var bsize: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(id, &cfg, 0, nil, &bsize) == noErr, bsize > 0 else { continue }
        let buf = UnsafeMutablePointer<AudioBufferList>.allocate(capacity: Int(bsize)); defer { buf.deallocate() }
        guard AudioObjectGetPropertyData(id, &cfg, 0, nil, &bsize, buf) == noErr else { continue }
        if UnsafeMutableAudioBufferListPointer(buf).reduce(0, { $0 + Int($1.mNumberChannels) }) > 0 { return id }
    }
    return nil
}

let cancelRegex = try! NSRegularExpression(pattern: "\\b(cancel|never ?mind|forget it|scratch that|stop|wait)\\b[,.!?]*\\s*$", options: .caseInsensitive)
let wakeRegex = try! NSRegularExpression(pattern: "\\b(?:(?:hey|hay)[,.]?\\s+(?:claude|cloud|clawed|claud|clod|clyde)|hi[,.]?\\s+claude)\\b[,.!?]*", options: .caseInsensitive)

// Lines go to stderr and to ~/.cache/claude-hud/listen.log (0600): launched as an app, stderr goes nowhere.
let logPath = ProcessInfo.processInfo.environment["CLAUDE_HUD_LOG"] ?? (NSHomeDirectory() + "/.cache/claude-hud/listen.log")
func log(_ s: String) {
    let stamp = ISO8601DateFormatter().string(from: Date())
    let line = (stamp + " " + s + "\n").data(using: .utf8)!
    FileHandle.standardError.write(line)
    if !FileManager.default.fileExists(atPath: logPath) {
        try? FileManager.default.createDirectory(atPath: (logPath as NSString).deletingLastPathComponent, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        FileManager.default.createFile(atPath: logPath, contents: nil, attributes: [.posixPermissions: 0o600])
    }
    if let h = FileHandle(forWritingAtPath: logPath) { h.seekToEndOfFile(); h.write(line); h.closeFile() }
}

func post(_ path: String, _ body: [String: Any]) {
    if dryRun { log("POST \(path) \(body)"); return }
    var req = URLRequest(url: URL(string: "http://127.0.0.1:\(port)\(path)")!)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue(token(), forHTTPHeaderField: "X-HUD-Token")  // written by the server, 0600, this run's
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    URLSession.shared.dataTask(with: req) { _, r, e in
        if let e = e { log("\(path): \(e.localizedDescription)") }
        else if let r = r as? HTTPURLResponse, r.statusCode >= 400 { log("\(path): HTTP \(r.statusCode)") }
    }.resume()
}

func openHud() {
    if dryRun { log("open hud"); return }
    if hud.panel != nil { hud.show(); return }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
    p.arguments = [hudDir + "/launch.py", "--no-open"]  // makes sure the server runs
    p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
    p.terminationHandler = { _ in DispatchQueue.main.async { hud.show() } }
    do { try p.run() } catch { log("launch.py: \(error.localizedDescription)"); hud.show() }
}

// MARK: - HUD window: the page in a borderless panel that fades in over whatever is on screen, full-screen
// apps too, without a Space of its own. A non-activating panel takes the keyboard while the app in front
// stays active, so closing it hands the keyboard straight back. Made per wake: a server restart changes the
// page's token, and between wakes nothing runs.
final class HudPanel: NSPanel { override var canBecomeKey: Bool { true } }  // borderless refuses it otherwise

final class Hud: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    var panel: HudPanel?
    var closing = false
    var onShown: (() -> Void)?
    var onClosed: (() -> Void)?

    func fade(_ p: NSPanel, to alpha: CGFloat, over seconds: Double, then: (() -> Void)? = nil) {
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = seconds; ctx.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            p.animator().alphaValue = alpha
        }, completionHandler: then)
    }

    func show() {
        if let p = panel {
            if closing { closing = false; fade(p, to: 1, over: 0.3) }
            return
        }
        guard let screen = NSScreen.main else { return }
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "hud")
        let web = WKWebView(frame: NSRect(origin: .zero, size: screen.frame.size), configuration: config)
        web.setValue(false, forKey: "drawsBackground")  // the panel's dark colour, not white, until the page paints
        web.navigationDelegate = self
        let p = HudPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.isReleasedWhenClosed = false; p.hidesOnDeactivate = false; p.hasShadow = false
        p.backgroundColor = NSColor(red: 27 / 255, green: 27 / 255, blue: 26 / 255, alpha: 1)
        p.level = .statusBar  // above the menu bar
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        p.contentView = web; p.alphaValue = 0
        panel = p
        web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/?wake=1")!))
    }

    func hide() {
        guard let p = panel, !closing else { return }
        closing = true
        fade(p, to: 0, over: 0.6) { if self.closing { self.remove() } }
    }

    func remove() {
        closing = false
        panel?.orderOut(nil)
        (panel?.contentView as? WKWebView)?.configuration.userContentController.removeScriptMessageHandler(forName: "hud")
        panel?.contentView = nil; panel = nil
        onClosed?()
    }

    func webView(_ web: WKWebView, didFinish nav: WKNavigation!) {
        guard let p = panel, !closing else { return }
        p.makeKeyAndOrderFront(nil); p.makeFirstResponder(web)
        fade(p, to: 1, over: 0.45) { self.onShown?() }
    }

    func webView(_ web: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError error: Error) {
        log("hud window: \(error.localizedDescription)"); remove()
    }

    // a dead page cannot hear esc: it must not stay over the screen
    func webViewWebContentProcessDidTerminate(_ web: WKWebView) { log("hud window: page died"); remove() }

    // this process holds the microphone: the window shows the local page and nothing else
    func webView(_ web: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(action.request.url?.host == "127.0.0.1" ? .allow : .cancel)
    }

    /// The page says when it is done: esc, or 20 s of quiet. Esc also ends what the voice side was doing.
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard m.body as? String == "close" else { return }
        if jarvis.capturing { jarvis.discard() }
        jarvis.awaiting = false; jarvis.followUntil = .distantPast
        hide()
    }
}

// MARK: - Wake handling
final class Jarvis {
    var capturing = false
    var followUp = false          // a capture that needs no wake word: right after an answer was spoken
    var sending = false           // the grace window: silence was heard, the question goes out unless you speak
    var sendAt = Date.distantPast
    var awaiting = false          // an answer is being made or spoken: "cancel" stops it
    var wakeAt = Date.distantPast
    var lastChange = Date.distantPast
    var rest = ""
    var cooldownUntil = Date.distantPast
    var followUntil = Date.distantPast
    var onRestart: (() -> Void)?

    func isCancel(_ t: String) -> Bool { cancelRegex.firstMatch(in: t, range: NSRange(location: 0, length: (t as NSString).length)) != nil }

    /// Every partial transcript of the current recognition request passes through here.
    func handle(transcript: String, final: Bool = false) {
        let ns = transcript as NSString
        if !capturing {
            if awaiting, isCancel(transcript.trimmingCharacters(in: .whitespacesAndNewlines)) {  // "cancel" while it thinks or speaks
                awaiting = false; log("cancel while answering"); post("/cancel", [:]); hud.hide(); onRestart?(); return
            }
            if Date() < followUntil {  // the conversation goes on: no wake word needed
                let words = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !words.isEmpty else { return }
                capturing = true; followUp = true; wakeAt = Date(); lastChange = Date(); rest = words
                openHud(); post("/state", ["name": "listening", "text": rest])
                if final { finish() }
                return
            }
            guard Date() > cooldownUntil,
                  let m = wakeRegex.firstMatch(in: transcript, range: NSRange(location: 0, length: ns.length)) else { return }
            capturing = true; followUp = false; wakeAt = Date(); lastChange = Date()
            rest = ns.substring(from: m.range.location + m.range.length).trimmingCharacters(in: .whitespacesAndNewlines)
            log(dryRun ? "wake: \"\(rest)\"" : "wake (\(rest.count) chars)")  // words only in a dry run: the agent's log keeps none
            openHud(); post("/state", ["name": "listening", "text": rest])
            if final { finish() }
            return
        }
        // capturing: the words so far, as they keep arriving, shown live on the page. A wake capture takes
        // only what follows the wake phrase; a transcript without it (the recognizer restarted) changes nothing.
        var now = rest
        if followUp { now = transcript.trimmingCharacters(in: .whitespacesAndNewlines) }
        else if let m = wakeRegex.firstMatch(in: transcript, range: NSRange(location: 0, length: ns.length)) {
            now = ns.substring(from: m.range.location + m.range.length).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if now != rest {
            rest = now; lastChange = Date()
            if sending { sending = false }  // more words: the sentence goes on
            post("/state", ["name": "listening", "text": rest, "phase": "listening"])
        }
        if final { finish() }
    }

    /// Called a few times a second. A pause (conf.pause) opens the grace window, shown on the page as
    /// "sending in…"; more words close it again; when it runs out the question goes. conf.max caps it all.
    func tick() {
        guard capturing else { return }
        let now = Date()
        if sending {
            if now >= sendAt { finish() }
            return
        }
        if now.timeIntervalSince(wakeAt) > conf["max"]! { finish(); return }
        if !rest.isEmpty && now.timeIntervalSince(lastChange) > conf["pause"]! {
            if isCancel(rest) { log("cancelled by voice"); discard(); hud.hide(); return }
            sending = true; sendAt = now.addingTimeInterval(conf["grace"]!)
            post("/state", ["name": "listening", "text": rest, "phase": "sending"])
        }
        if rest.isEmpty && now.timeIntervalSince(wakeAt) > 12 { discard() }  // nothing said after the wake word
    }

    /// Drops the capture: nothing is sent.
    func discard() {
        capturing = false; sending = false; cooldownUntil = Date().addingTimeInterval(2); followUntil = .distantPast
        rest = ""
        post("/state", ["name": "idle"]); onRestart?()
    }

    func finish() {
        guard capturing else { return }
        capturing = false; sending = false; cooldownUntil = Date().addingTimeInterval(3); followUntil = .distantPast
        if rest.isEmpty { post("/state", ["name": "idle"]); log("nothing heard: HUD open, type instead") }
        else if isCancel(rest) { log("cancelled by voice"); post("/state", ["name": "idle"]); hud.hide() }
        else { log(dryRun ? "ask: \(rest)" : "ask (\(rest.count) chars)"); post("/ask", ["text": rest, "speak": true]); awaitAnswer() }
        rest = ""
        onRestart?()
    }

    /// After the answer has been spoken, eight seconds in which the next sentence needs no wake word.
    func awaitAnswer() {
        if dryRun { return }
        awaiting = true
        var polls = 0
        func poll() {
            polls += 1
            if polls > 240 || !self.awaiting { self.awaiting = false; return }  // two minutes, or cancelled
            var req = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/jarvis")!)
            req.timeoutInterval = 3
            URLSession.shared.dataTask(with: req) { data, _, _ in
                let j = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
                let busy = j["busy"] as? Bool ?? true, state = j["state"] as? String ?? ""
                DispatchQueue.main.async {
                    if !busy && state == "idle" {
                        self.awaiting = false
                        self.followUntil = Date().addingTimeInterval(conf["followup"]!)
                        self.onRestart?()  // a fresh transcript: the Mac's own voice is not part of it
                        log("follow-up window open")
                    } else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: poll) }
                }
            }.resume()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0, execute: poll)
    }
}

let jarvis = Jarvis()
let hud = Hud()
let listener = Listener()  // held for the life of the process: its callbacks keep only weak references

// MARK: - Microphone + on-device recognition
// The audio engine runs once, its tap feeding whichever request is current. A request lives for at most
// 50 s (Apple's limit), until the recognizer reports a final result, or until an error; then a new one
// starts. Each request has a generation number, and callbacks from an old one are ignored, so a cancelled
// task can never restart the loop under the one that replaced it.
final class Listener {
    let engine = AVAudioEngine()
    let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    var request: SFSpeechAudioBufferRecognitionRequest?
    var task: SFSpeechRecognitionTask?
    var gen = 0
    var restartPending = false
    var restartTimer: Timer?

    var reconfigurePending = false

    func start() {
        guard let recognizer = recognizer, recognizer.isAvailable else { log("speech recognizer unavailable"); exit(1) }
        jarvis.onRestart = { [weak self] in self?.restart() }
        // once, for the life of the process: a device change (headphones on or off) stops the engine and
        // starts it again after the system has settled, however many notifications arrive meanwhile
        NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            guard let self = self, !self.reconfigurePending else { return }
            self.reconfigurePending = true
            log("audio configuration changed: restarting the engine in a moment")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                self.reconfigurePending = false
                self.engine.stop(); self.engine.inputNode.removeTap(onBus: 0)
                self.begin()
            }
        }
        let t = Timer(timeInterval: 0.25, repeats: true) { _ in jarvis.tick() }
        RunLoop.main.add(t, forMode: .common)
        authorize()
    }

    /// Asks once; a refusal is remembered by macOS, so after that this only watches System Settings
    /// (every 30 s) and goes on the moment both switches are on. Never exits: launchd would not retry.
    func authorize(announced: Bool = false) {
        SFSpeechRecognizer.requestAuthorization { status in
            AVCaptureDevice.requestAccess(for: .audio) { mic in
                DispatchQueue.main.async {
                    log("permissions: speech \(status == .authorized ? "ok" : "no (\(status.rawValue))"), microphone \(mic ? "ok" : "no (\(AVCaptureDevice.authorizationStatus(for: .audio).rawValue))")")
                    if status == .authorized && mic { self.begin(); return }
                    if !announced {
                        log((status == .authorized ? "" : "speech recognition not allowed: System Settings › Privacy & Security › Speech Recognition. ")
                            + (mic ? "" : "microphone not allowed: System Settings › Privacy & Security › Microphone. ") + "waiting for it")
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 30) { self.authorize(announced: true) }
                }
            }
        }
    }

    var heard = 0, lastBeat = Date.distantPast, lastErr = Date.distantPast

    func begin() {
        let input = engine.inputNode
        if !engine.isRunning {
            var which = "system default"
            if inputPref == "builtin", let dev = builtInInputDevice(), let unit = input.audioUnit {
                var id = dev
                if AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &id, UInt32(MemoryLayout<AudioDeviceID>.size)) == noErr { which = deviceName(dev) }
            }
            let format = input.outputFormat(forBus: 0)
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in self?.request?.append(buffer) }
            engine.prepare()
            do { try engine.start() } catch { log("audio engine failed to start: \(error.localizedDescription); retrying in 10 s"); DispatchQueue.main.asyncAfter(deadline: .now() + 10) { self.begin() }; return }
            log("listening for \"Hey Claude\" (on-device); input: \(which), \(Int(format.sampleRate)) Hz, \(format.channelCount) ch")
        }
        newRequest()
    }

    func newRequest() {
        gen += 1
        let mine = gen
        task?.cancel()
        request?.endAudio()
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.requiresOnDeviceRecognition = true
        req.contextualStrings = ["Claude", "Hey Claude"]
        request = req
        task = recognizer!.recognitionTask(with: req) { [weak self] result, error in
            guard let self = self, mine == self.gen else { return }  // an old request: nothing it says matters now
            if let r = result {
                let t = r.bestTranscription.formattedString
                self.heard += 1
                if Date().timeIntervalSince(self.lastBeat) > 3 { self.lastBeat = Date(); log("hearing: \(self.heard) results so far, latest \(t.count) chars") }  // lengths only, never words
                jarvis.handle(transcript: t, final: r.isFinal)
            }
            if let e = error as NSError?, Date().timeIntervalSince(self.lastErr) > 5 {
                self.lastErr = Date(); log("recognition ended: \(e.domain) \(e.code) \(e.localizedDescription); starting over")
            }
            if error != nil || (result?.isFinal ?? false) { DispatchQueue.main.async { self.restart() } }
        }
        restartTimer?.invalidate()
        restartTimer = Timer.scheduledTimer(withTimeInterval: 50, repeats: false) { [weak self] _ in self?.restart() }
    }

    /// The current request is dropped at once (nothing it still delivers counts, so the Mac's own voice at
    /// the end of an answer can never become a follow-up); the next one starts a moment later. Coalesced.
    func restart() {
        guard engine.isRunning else { begin(); return }  // the engine died with the input device: bring it back
        gen += 1
        task?.cancel(); task = nil
        request?.endAudio(); request = nil
        guard !restartPending else { return }
        restartPending = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            self.restartPending = false
            self.newRequest()
        }
    }
}

// MARK: - main
if args.contains("--screen") {  // for dock.py: the main display's size in points, at once and exactly
    let f = NSScreen.main?.frame ?? .zero
    print(Int(f.width), Int(f.height)); exit(0)
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
if args.contains("--window") {
    var problem: String? = "never appeared"
    hud.onShown = {
        let web = hud.panel?.contentView as? WKWebView
        web?.evaluateJavaScript("document.hasFocus() && document.body.classList.contains('wake')") { got, _ in
            problem = hud.panel?.isKeyWindow == true && got as? Bool == true ? nil : "no keyboard, or the page is not in wake mode"
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { web?.evaluateJavaScript("dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))") }
        }
    }
    hud.onClosed = { print(problem.map { "hud window: \($0)" } ?? "hud window ok"); exit(problem == nil ? 0 : 1) }
    DispatchQueue.main.asyncAfter(deadline: .now() + 15) { print("hud window: esc did not close it"); exit(1) }
    hud.show()
} else if let i = args.firstIndex(of: "--text"), i + 1 < args.count {
    jarvis.handle(transcript: args[i + 1], final: true)
    if dryRun { exit(0) }
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.6) { exit(0) }
} else {
    listener.start()
}
app.run()
