// gesture-watch: watches the camera for one raised index finger and says
// "point" on standard output. Every Claude Code session runs one; they queue
// on a lock, so only one at a time has the camera, and when its session ends
// the next one takes over. The mod builds it with swiftc.
//
//   gesture-watch --lock <file> --mode <file> [--debug]
//   gesture-watch --test        checks the hand rules on made-up hands
//
// Standard output, one line each: standby, leader, asking (for camera
// access), camera on, camera off <why>, point, denied, no camera. Exit 3: camera access denied; 4: no camera.

import AppKit
import AVFoundation
import CoreMedia
import Foundation
import Vision

setvbuf(stdout, nil, _IOLBF, 0)

func say(_ line: String) {
    print(line)
}

var isDebug = false

func debug(_ line: @autoclosure () -> String) {
    guard isDebug else { return }
    FileHandle.standardError.write(Data((line() + "\n").utf8))
}

// MARK: - The hand rules

enum Joint: CaseIterable {
    case wrist, indexMCP, indexPIP, indexTip, middleMCP, middlePIP, middleTip, ringPIP, ringTip, littlePIP, littleTip
}

struct Point {
    var x: Double
    var y: Double
}

typealias Hand = [Joint: Point]

func distance(_ a: Point, _ b: Point) -> Double {
    hypot(a.x - b.x, a.y - b.y)
}

// A hand smaller than this (wrist to middle knuckle, as a share of the frame's
// height) is someone in the background, not the person at the keyboard.
let minPalm = 0.05

/// Why the hand is not one index finger raised, or nil when it is: the index
/// straight and upright, the other three folded with their tips well below it.
/// Points are Vision's, y up, x already scaled by the frame's aspect so
/// lengths compare.
func whyNotPointing(_ hand: Hand) -> String? {
    guard let wrist = hand[.wrist], let indexMCP = hand[.indexMCP], let indexPIP = hand[.indexPIP],
          let indexTip = hand[.indexTip], let middleMCP = hand[.middleMCP] else { return "index or palm unseen" }

    let palm = distance(wrist, middleMCP)
    guard palm >= minPalm else { return String(format: "small palm %.3f", palm) }

    // Straight: the tip reaches well past the middle joint, and the finger is long.
    let reach = distance(wrist, indexTip) / distance(wrist, indexPIP)
    let length = distance(indexMCP, indexTip) / palm
    guard reach > 1.15, length > 0.6 else { return String(format: "index bent: reach %.2f length %.2f", reach, length) }

    // Upright: within about 35° of straight up.
    let rise = indexTip.y - indexMCP.y
    let drift = abs(indexTip.x - indexMCP.x)
    guard rise > 0, rise > drift * 1.4 else { return String(format: "index not upright: rise %.3f drift %.3f", rise, drift) }

    // The other three folded: each tip nearer the wrist than its middle joint,
    // and well below the index tip.
    for (name, pip, tip) in [("middle", Joint.middlePIP, Joint.middleTip), ("ring", .ringPIP, .ringTip), ("little", .littlePIP, .littleTip)] {
        guard let joint = hand[pip], let end = hand[tip] else { return "\(name) unseen" }
        let fold = distance(wrist, end) / distance(wrist, joint)
        let below = (indexTip.y - end.y) / palm
        guard fold < 1.05, below > 0.5 else { return String(format: "\(name) not folded: fold %.2f below %.2f", fold, below) }
    }

    return nil
}

func isPointingUp(_ hand: Hand) -> Bool {
    whyNotPointing(hand) == nil
}

/// Turns looks into single gestures: a raised finger held for `hold` seconds
/// fires once, and fires again only after the hand has been down for `release`
/// seconds and `cooldown` has passed since it last fired.
struct Trigger {
    let hold = 0.6
    // Looks further apart than this start the hold over.
    let gap = 0.45
    let release = 0.5
    let cooldown = 2.0

    var since: Double?
    var lastSeen = -Double.infinity
    var lastFired = -Double.infinity
    var isArmed = true

    mutating func look(isPointing: Bool, at now: Double) -> Bool {
        guard isPointing else {
            if now - lastSeen >= release {
                isArmed = true
                since = nil
            }
            return false
        }

        if since == nil || now - lastSeen > gap { since = now }
        lastSeen = now
        guard isArmed, let since, now - since >= hold, now - lastFired >= cooldown else { return false }

        isArmed = false
        lastFired = now
        return true
    }
}

// MARK: - Self-test

enum Finger {
    case up, folded, side
}

// A hand facing the camera, wrist low, in units of the frame's height.
func madeHand(_ fingers: [Finger], scale: Double = 1) -> Hand {
    let wrist = Point(x: 0.5, y: 0.2)
    let at = { (x: Double, y: Double) in Point(x: wrist.x + (x - wrist.x) * scale, y: wrist.y + (y - wrist.y) * scale) }
    var hand: Hand = [.wrist: wrist, .middleMCP: at(0.5, 0.35)]
    let joints: [(mcp: Joint?, pip: Joint, tip: Joint, x: Double)] = [
        (.indexMCP, .indexPIP, .indexTip, 0.45), (nil, .middlePIP, .middleTip, 0.5),
        (nil, .ringPIP, .ringTip, 0.55), (nil, .littlePIP, .littleTip, 0.6),
    ]
    for (finger, joint) in zip(fingers, joints) {
        if let mcp = joint.mcp { hand[mcp] = at(joint.x, 0.35) }
        switch finger {
        case .up:
            hand[joint.pip] = at(joint.x, 0.42)
            hand[joint.tip] = at(joint.x, 0.52)
        case .folded:
            hand[joint.pip] = at(joint.x, 0.38)
            hand[joint.tip] = at(joint.x, 0.30)
        case .side:
            hand[joint.pip] = at(joint.x - 0.07, 0.36)
            hand[joint.tip] = at(joint.x - 0.16, 0.37)
        }
    }
    return hand
}

func selfTest() -> Bool {
    var failed = 0
    func check(_ name: String, _ isTrue: Bool) {
        if !isTrue { failed += 1 }
        print("\(isTrue ? "ok  " : "FAIL") \(name)")
    }

    check("one finger up", isPointingUp(madeHand([.up, .folded, .folded, .folded])))
    check("open hand", !isPointingUp(madeHand([.up, .up, .up, .up])))
    check("fist", !isPointingUp(madeHand([.folded, .folded, .folded, .folded])))
    check("two fingers up", !isPointingUp(madeHand([.up, .up, .folded, .folded])))
    check("finger pointing sideways", !isPointingUp(madeHand([.side, .folded, .folded, .folded])))
    check("finger up, far away", !isPointingUp(madeHand([.up, .folded, .folded, .folded], scale: 0.25)))
    var missing = madeHand([.up, .folded, .folded, .folded])
    missing[.ringTip] = nil
    check("finger up, a folded finger unseen", !isPointingUp(missing))

    func fires(_ looks: [(isPointing: Bool, at: Double)]) -> Int {
        var trigger = Trigger()
        return looks.filter { trigger.look(isPointing: $0.isPointing, at: $0.at) }.count
    }
    let tick = 1.0 / 12
    let held = { (from: Double, to: Double) in stride(from: from, to: to, by: tick).map { (isPointing: true, at: $0) } }
    let down = { (from: Double, to: Double) in stride(from: from, to: to, by: tick).map { (isPointing: false, at: $0) } }
    check("held a second fires once", fires(held(0, 1)) == 1)
    check("a quick flick does not fire", fires(held(0, 0.4)) == 0)
    check("held five seconds fires once", fires(held(0, 5)) == 1)
    check("down and up again fires twice", fires(held(0, 1) + down(1, 2) + held(2, 3)) == 2)
    check("up again within the cooldown waits", fires(held(0, 0.7) + down(0.7, 1.3) + held(1.3, 2.2)) == 1)
    check("one missed look does not restart the hold", fires(held(0, 0.3) + [(false, 0.33)] + held(0.37, 0.65)) == 1)

    return failed == 0
}

// MARK: - The camera

enum Pace {
    case idle, active

    var fps: Double {
        switch self {
        case .idle: return 5
        case .active: return 12
        }
    }
}

let visionJoints: [Joint: VNHumanHandPoseObservation.JointName] = [
    .wrist: .wrist, .indexMCP: .indexMCP, .indexPIP: .indexPIP, .indexTip: .indexTip,
    .middleMCP: .middleMCP, .middlePIP: .middlePIP, .middleTip: .middleTip,
    .ringPIP: .ringPIP, .ringTip: .ringTip, .littlePIP: .littlePIP, .littleTip: .littleTip,
]
let clearJoints: Set<Joint> = [.wrist, .indexMCP, .indexPIP, .indexTip, .middleMCP]

// The wrist and index must be seen clearly; folded fingers hide behind the
// palm, so a fainter guess at them is taken.
func handOf(_ observation: VNHumanHandPoseObservation, aspect: Double) -> Hand {
    var hand: Hand = [:]
    for (joint, name) in visionJoints {
        guard let point = try? observation.recognizedPoint(name) else { continue }
        if point.confidence >= (clearJoints.contains(joint) ? 0.3 : 0.1) {
            hand[joint] = Point(x: Double(point.location.x) * aspect, y: Double(point.location.y))
        }
    }
    return hand
}

// A coarse grid of the frame's brightness, to tell a still scene from movement.
let gridColumns = 32
let gridRows = 24

func gridOf(_ pixels: CVPixelBuffer) -> [UInt8] {
    CVPixelBufferLockBaseAddress(pixels, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixels, .readOnly) }

    let isPlanar = CVPixelBufferIsPlanar(pixels)
    guard let base = isPlanar ? CVPixelBufferGetBaseAddressOfPlane(pixels, 0) : CVPixelBufferGetBaseAddress(pixels) else { return [] }
    let rowBytes = isPlanar ? CVPixelBufferGetBytesPerRowOfPlane(pixels, 0) : CVPixelBufferGetBytesPerRow(pixels)
    let width = isPlanar ? CVPixelBufferGetWidthOfPlane(pixels, 0) : CVPixelBufferGetWidth(pixels)
    let height = isPlanar ? CVPixelBufferGetHeightOfPlane(pixels, 0) : CVPixelBufferGetHeight(pixels)
    let bytes = base.assumingMemoryBound(to: UInt8.self)

    var grid = [UInt8]()
    grid.reserveCapacity(gridColumns * gridRows)
    for row in 0..<gridRows {
        let y = (row * 2 + 1) * height / (gridRows * 2)
        for column in 0..<gridColumns {
            grid.append(bytes[y * rowBytes + (column * 2 + 1) * width / (gridColumns * 2)])
        }
    }
    return grid
}

// Moved: enough cells changed clearly since the frame last looked at.
func hasMoved(_ grid: [UInt8], since seen: [UInt8]) -> Bool {
    guard grid.count == seen.count else { return true }
    return zip(grid, seen).filter { abs(Int($0) - Int($1)) > 20 }.count >= 6
}

final class Watcher: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let session = AVCaptureSession()
    let device: AVCaptureDevice
    let control = DispatchQueue(label: "gesture-watch.control")
    let frames = DispatchQueue(label: "gesture-watch.frames", qos: .utility)
    let onPoint: () -> Void
    var isRunning = false

    // Read and written on `frames` alone.
    let request: VNDetectHumanHandPoseRequest = {
        let request = VNDetectHumanHandPoseRequest()
        request.maximumHandCount = 1
        return request
    }()
    let handler = VNSequenceRequestHandler()
    var trigger = Trigger()
    var pace = Pace.idle
    var lastLook = -Double.infinity
    var lastHand = -Double.infinity
    var seen: [UInt8] = []

    init(device: AVCaptureDevice, onPoint: @escaping () -> Void) throws {
        self.device = device
        self.onPoint = onPoint
        super.init()

        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = session.canSetSessionPreset(.vga640x480) ? .vga640x480 : .low
        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else { throw CocoaError(.featureUnsupported) }
        session.addInput(input)

        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange]
        output.setSampleBufferDelegate(self, queue: frames)
        guard session.canAddOutput(output) else { throw CocoaError(.featureUnsupported) }
        session.addOutput(output)
    }

    func start() {
        control.async {
            guard !self.isRunning else { return }
            self.session.startRunning()
            self.isRunning = true
            self.frames.async { self.pace = .idle }
            self.setPace(.idle)
        }
    }

    func stop() {
        control.async {
            guard self.isRunning else { return }
            self.session.stopRunning()
            self.isRunning = false
        }
    }

    // The camera's own frame rate, so frames not needed are never made. Kept
    // inside the format's range: a duration outside it would raise.
    func setPace(_ pace: Pace) {
        let ranges = device.activeFormat.videoSupportedFrameRateRanges
        guard let range = ranges.first(where: { $0.minFrameRate <= pace.fps && pace.fps <= $0.maxFrameRate }) ?? ranges.first else { return }

        var duration = CMTime(value: 1, timescale: CMTimeScale(pace.fps))
        if CMTimeCompare(duration, range.minFrameDuration) < 0 { duration = range.minFrameDuration }
        if CMTimeCompare(duration, range.maxFrameDuration) > 0 { duration = range.maxFrameDuration }
        do {
            try device.lockForConfiguration()
            defer { device.unlockForConfiguration() }
            // Longer frames: widen the maximum first, so the minimum never passes it.
            if CMTimeCompare(duration, device.activeVideoMaxFrameDuration) > 0 {
                device.activeVideoMaxFrameDuration = duration
                device.activeVideoMinFrameDuration = duration
            } else {
                device.activeVideoMinFrameDuration = duration
                device.activeVideoMaxFrameDuration = duration
            }
            debug("pace \(pace) \(duration.seconds)s")
        } catch {
            debug("pace not set: \(error)")
        }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let now = ProcessInfo.processInfo.systemUptime
        let isActive = now - lastHand < 1.5
        // The camera may run faster than asked; look no more often than the pace.
        guard now - lastLook >= 0.8 / (isActive ? Pace.active.fps : Pace.idle.fps),
              let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        // With no hand about, a still scene is not looked at: no model runs
        // until something moves, and at least every two seconds.
        let grid = gridOf(pixels)
        guard isActive || hasMoved(grid, since: seen) || now - lastLook >= 2 else { return }
        lastLook = now
        seen = grid

        do {
            try handler.perform([request], on: pixels, orientation: .up)
        } catch {
            debug("vision: \(error)")
            return
        }
        let aspect = Double(CVPixelBufferGetWidth(pixels)) / Double(CVPixelBufferGetHeight(pixels))
        let observation = request.results?.first
        if observation != nil { lastHand = now }
        let hand = observation.map { handOf($0, aspect: aspect) }
        let why = hand.map(whyNotPointing) ?? "no hand"
        let isPointing = hand != nil && why == nil
        if isDebug, let observation, let all = try? observation.recognizedPoints(.all) {
            let seen = all.sorted { $0.key.rawValue.rawValue < $1.key.rawValue.rawValue }.map { name, point in
                String(format: "%@ %.2f %.3f %.3f", name.rawValue.rawValue, point.confidence, point.location.x * aspect, point.location.y)
            }
            debug("look \(why ?? "POINTING") | \(seen.joined(separator: "; "))")
        }
        if trigger.look(isPointing: isPointing, at: now) { onPoint() }

        let wanted: Pace = now - lastHand < 1.5 ? .active : .idle
        if wanted != pace {
            pace = wanted
            control.async { self.setPace(wanted) }
        }
    }
}

// MARK: - When the camera may run

func screenIsLocked() -> Bool {
    guard let info = CGSessionCopyCurrentDictionary() as? [String: Any] else { return false }
    return info["CGSSessionScreenIsLocked"] as? Bool ?? false
}

/// Keeps the camera on only while it can be of use: switched on with
/// /gesture, the screen unlocked and awake, this user's session in front.
final class Gate {
    let watcher: Watcher
    let modePath: String
    var isOff = false
    var isLocked = false
    var isAsleep = false
    var isAway = false
    var modeStamp: timespec?
    var said: String?
    var timer: DispatchSourceTimer?
    var observers: [NSObjectProtocol] = []

    init(watcher: Watcher, modePath: String) {
        self.watcher = watcher
        self.modePath = modePath
    }

    func begin() {
        isLocked = screenIsLocked()
        let distributed = DistributedNotificationCenter.default()
        let workspace = NSWorkspace.shared.notificationCenter
        watch(distributed, Notification.Name("com.apple.screenIsLocked")) { $0.isLocked = true }
        watch(distributed, Notification.Name("com.apple.screenIsUnlocked")) { $0.isLocked = false }
        watch(workspace, NSWorkspace.screensDidSleepNotification) { $0.isAsleep = true }
        watch(workspace, NSWorkspace.screensDidWakeNotification) { $0.isAsleep = false }
        watch(workspace, NSWorkspace.willSleepNotification) { $0.isAsleep = true }
        watch(workspace, NSWorkspace.didWakeNotification) { $0.isAsleep = false }
        watch(workspace, NSWorkspace.sessionDidResignActiveNotification) { $0.isAway = true }
        watch(workspace, NSWorkspace.sessionDidBecomeActiveNotification) { $0.isAway = false }

        // /gesture writes the mode file; a stat every two seconds sees it.
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 2, repeating: 2, leeway: .seconds(1))
        timer.setEventHandler { [unowned self] in self.readMode() }
        timer.resume()
        self.timer = timer

        readMode()
        apply()
    }

    func watch(_ center: NotificationCenter, _ name: Notification.Name, _ change: @escaping (Gate) -> Void) {
        observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [unowned self] _ in
            change(self)
            self.apply()
        })
    }

    func readMode() {
        var info = stat()
        let stamp = stat(modePath, &info) == 0 ? info.st_mtimespec : nil
        guard said == nil || stamp?.tv_sec != modeStamp?.tv_sec || stamp?.tv_nsec != modeStamp?.tv_nsec else { return }

        modeStamp = stamp
        let text = (try? String(contentsOfFile: modePath, encoding: .utf8)) ?? "on"
        isOff = text.trimmingCharacters(in: .whitespacesAndNewlines) == "off"
        apply()
    }

    func apply() {
        let why = isOff ? "off" : isLocked ? "locked" : isAsleep ? "asleep" : isAway ? "away" : nil
        if why == nil { watcher.start() } else { watcher.stop() }

        let line = why.map { "camera off \($0)" } ?? "camera on"
        if line != said {
            said = line
            say(line)
        }
    }
}

// MARK: - Taking turns with the other sessions

func value(after flag: String) -> String? {
    guard let at = CommandLine.arguments.firstIndex(of: flag), at + 1 < CommandLine.arguments.count else { return nil }
    return CommandLine.arguments[at + 1]
}

if CommandLine.arguments.contains("--test") {
    exit(selfTest() ? 0 : 1)
}

isDebug = CommandLine.arguments.contains("--debug")
guard let lockPath = value(after: "--lock"), let modePath = value(after: "--mode") else {
    FileHandle.standardError.write(Data("usage: gesture-watch --lock <file> --mode <file> [--debug] | --test\n".utf8))
    exit(2)
}

// Leave with the session: when the process that started this one ends, so does this.
let parent = getppid()
if parent == 1 { exit(0) }
let parentWatch = DispatchSource.makeProcessSource(identifier: parent, eventMask: .exit, queue: .main)
parentWatch.setEventHandler { exit(0) }
parentWatch.resume()

var gate: Gate?

func refuse(_ line: String, _ code: Int32) -> Never {
    say(line)
    exit(code)
}

func begin() {
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .unspecified)
            ?? AVCaptureDevice.default(for: .video) else { refuse("no camera", 4) }
    do {
        let watcher = try Watcher(device: device) { say("point") }
        gate = Gate(watcher: watcher, modePath: modePath)
        gate?.begin()
    } catch {
        debug("camera: \(error)")
        refuse("no camera", 4)
    }
}

func lead() {
    say("leader")
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
        begin()
    case .notDetermined:
        say("asking")
        AVCaptureDevice.requestAccess(for: .video) { isGranted in
            DispatchQueue.main.async {
                if isGranted { begin() } else { refuse("denied", 3) }
            }
        }
    default:
        refuse("denied", 3)
    }
}

try? FileManager.default.createDirectory(atPath: (lockPath as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
let lockFile = open(lockPath, O_RDWR | O_CREAT | O_CLOEXEC, 0o600)
guard lockFile >= 0 else { refuse("no lock", 5) }

// Waits, using nothing, while another session has the camera; the lock is
// let go when that process ends, however it ends.
say("standby")
Thread.detachNewThread {
    while flock(lockFile, LOCK_EX) != 0 {
        if errno != EINTR { refuse("no lock", 5) }
    }
    DispatchQueue.main.async { lead() }
}

RunLoop.main.run()
