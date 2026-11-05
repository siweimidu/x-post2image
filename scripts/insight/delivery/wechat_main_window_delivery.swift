import AppKit
import AVFoundation
import CoreImage
import CoreMedia
import Darwin
import Foundation
import ImageIO
import Vision

private let targetConversation = "文件传输助手"
private let minimumOCRConfidence: Float = 0.80
private let conversationListWidth: CGFloat = 300
private let appSidebarWidth: CGFloat = 60
private let chatHeaderHeight: CGFloat = 65
private let stableVerificationSamples = 2
private let automationEventTag: Int64 = 0x5849435745434841

enum DeliveryError: LocalizedError {
    case invalidArguments(String)
    case preconditionFailed(String)
    case captureFailed(String)
    case verificationFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidArguments(let message),
             .preconditionFailed(let message),
             .captureFailed(let message),
             .verificationFailed(let message):
            return message
        }
    }
}

struct Options {
    var dryRun = false
    var imageProbe = false
    var imageURL: URL?
    var captionURL: URL?
    var diagnosticsDirectory: URL?
    var auditFrameURL: URL?

    static func parse(_ arguments: [String]) throws -> Options {
        var options = Options()
        var index = 1
        while index < arguments.count {
            switch arguments[index] {
            case "--dry-run":
                options.dryRun = true
            case "--image-probe":
                options.imageProbe = true
            case "--image", "--caption-file", "--diagnostics", "--audit-frame":
                guard index + 1 < arguments.count else {
                    throw DeliveryError.invalidArguments(
                        "Missing value after \(arguments[index])"
                    )
                }
                let url = URL(fileURLWithPath: arguments[index + 1])
                    .standardizedFileURL
                if arguments[index] == "--image" {
                    options.imageURL = url
                } else if arguments[index] == "--caption-file" {
                    options.captionURL = url
                } else if arguments[index] == "--audit-frame" {
                    options.auditFrameURL = url
                } else {
                    options.diagnosticsDirectory = url
                }
                index += 1
            default:
                throw DeliveryError.invalidArguments(
                    "Unknown argument: \(arguments[index])"
                )
            }
            index += 1
        }

        if options.auditFrameURL != nil {
            guard !options.dryRun, !options.imageProbe,
                  options.imageURL == nil, options.captionURL == nil else {
                throw DeliveryError.invalidArguments(
                    "--audit-frame cannot be combined with delivery options"
                )
            }
            return options
        }
        if options.imageProbe && options.imageURL == nil {
            throw DeliveryError.invalidArguments(
                "Image probing requires --image PATH"
            )
        }
        if !options.dryRun && !options.imageProbe
            && (options.imageURL == nil || options.captionURL == nil) {
            throw DeliveryError.invalidArguments(
                "Delivery requires --image PATH and --caption-file PATH"
            )
        }
        return options
    }
}

struct WeChatWindow {
    let id: CGWindowID
    let ownerPID: pid_t
    let bounds: CGRect
    let sharingState: Int
}

struct RecognizedText {
    let text: String
    let screenRect: CGRect
    let confidence: Float
}

struct PasteboardSnapshot {
    private let items: [[NSPasteboard.PasteboardType: Data]]

    init(_ pasteboard: NSPasteboard = .general) {
        items = (pasteboard.pasteboardItems ?? []).map { item in
            Dictionary(uniqueKeysWithValues: item.types.compactMap { type in
                item.data(forType: type).map { (type, $0) }
            })
        }
    }

    func restore(_ pasteboard: NSPasteboard = .general) {
        pasteboard.clearContents()
        let restoredItems = items.map { values -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (type, data) in values {
                item.setData(data, forType: type)
            }
            return item
        }
        if !restoredItems.isEmpty {
            pasteboard.writeObjects(restoredItems)
        }
    }
}

final class ProcessLock {
    private let fileDescriptor: Int32

    init() throws {
        let lockURL = URL(
            fileURLWithPath: NSTemporaryDirectory(),
            isDirectory: true
        ).appendingPathComponent("x-post2image-wechat-delivery.lock")
        let descriptor = Darwin.open(
            lockURL.path,
            O_CREAT | O_RDWR,
            S_IRUSR | S_IWUSR
        )
        guard descriptor >= 0 else {
            throw DeliveryError.preconditionFailed(
                "Could not create the exclusive WeChat delivery lock"
            )
        }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            Darwin.close(descriptor)
            throw DeliveryError.preconditionFailed(
                "Another WeChat delivery is already running"
            )
        }
        fileDescriptor = descriptor
    }

    deinit {
        flock(fileDescriptor, LOCK_UN)
        Darwin.close(fileDescriptor)
    }
}

final class FrameCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    private let session = AVCaptureSession()
    private let context = CIContext(options: [.cacheIntermediates: false])
    private let lock = NSLock()
    private var pendingSemaphore: DispatchSemaphore?
    private var pendingImage: CGImage?

    func start(displayID: CGDirectDisplayID) throws {
        guard let input = AVCaptureScreenInput(displayID: displayID) else {
            throw DeliveryError.captureFailed(
                "AVFoundation could not create a display capture input"
            )
        }
        input.capturesCursor = false
        input.capturesMouseClicks = false
        input.minFrameDuration = CMTime(value: 1, timescale: 10)

        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(
            self,
            queue: DispatchQueue(label: "x-post2image.wechat-display-capture")
        )

        guard session.canAddInput(input), session.canAddOutput(output) else {
            throw DeliveryError.captureFailed(
                "AVFoundation rejected the display capture pipeline"
            )
        }
        session.beginConfiguration()
        session.addInput(input)
        session.addOutput(output)
        session.commitConfiguration()
        session.startRunning()
        if !session.isRunning {
            throw DeliveryError.captureFailed("Display capture did not start")
        }
    }

    func stop() {
        if session.isRunning {
            session.stopRunning()
        }
    }

    func nextFrame(timeout: TimeInterval = 5) throws -> CGImage {
        let semaphore = DispatchSemaphore(value: 0)
        lock.lock()
        pendingImage = nil
        pendingSemaphore = semaphore
        lock.unlock()

        guard semaphore.wait(timeout: .now() + timeout) == .success else {
            lock.lock()
            pendingSemaphore = nil
            lock.unlock()
            throw DeliveryError.captureFailed(
                "Timed out waiting for a display frame"
            )
        }

        lock.lock()
        defer { lock.unlock() }
        guard let image = pendingImage else {
            throw DeliveryError.captureFailed(
                "The display frame could not be converted to an image"
            )
        }
        pendingImage = nil
        return image
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard sampleBuffer.isValid,
              let pixelBuffer = sampleBuffer.imageBuffer else {
            return
        }

        lock.lock()
        guard let semaphore = pendingSemaphore else {
            lock.unlock()
            return
        }
        pendingSemaphore = nil
        lock.unlock()

        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let cgImage = context.createCGImage(ciImage, from: ciImage.extent)

        lock.lock()
        pendingImage = cgImage
        lock.unlock()
        semaphore.signal()
    }
}

func findMainWeChatWindow() throws -> WeChatWindow {
    guard let windowInfo = CGWindowListCopyWindowInfo(
        [.optionAll, .excludeDesktopElements],
        kCGNullWindowID
    ) as? [[String: Any]] else {
        throw DeliveryError.preconditionFailed(
            "Could not inspect on-screen windows"
        )
    }

    let candidates = windowInfo.compactMap { item -> WeChatWindow? in
        guard item[kCGWindowOwnerName as String] as? String == "微信",
              item[kCGWindowName as String] as? String == "微信",
              (item[kCGWindowLayer as String] as? Int) == 0,
              let boundsDictionary = item[kCGWindowBounds as String] as? NSDictionary,
              let bounds = CGRect(
                dictionaryRepresentation: boundsDictionary as CFDictionary
              ),
              let ownerPID = (item[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value,
              let windowID = (item[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
              bounds.width >= 700,
              bounds.height >= 500 else {
            return nil
        }
        let sharingState = (item[kCGWindowSharingState as String] as? NSNumber)?.intValue ?? -1
        return WeChatWindow(
            id: windowID,
            ownerPID: ownerPID,
            bounds: bounds,
            sharingState: sharingState
        )
    }

    guard let window = candidates.max(
        by: { $0.bounds.width * $0.bounds.height < $1.bounds.width * $1.bounds.height }
    ) else {
        throw DeliveryError.preconditionFailed(
            "No large on-screen WeChat main window was found; leave WeChat signed in and visible"
        )
    }
    return window
}

func normalizeForComparison(_ text: String) -> String {
    String(text.unicodeScalars.filter { scalar in
        !CharacterSet.whitespacesAndNewlines.contains(scalar)
            && scalar.value != 0x200B
            && scalar.value != 0xFEFF
    })
}

func recognizeText(
    in image: CGImage,
    displayBounds: CGRect,
    regionOfInterest: CGRect? = nil
) throws -> [RecognizedText] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    request.minimumTextHeight = 0.008
    if let region = regionOfInterest?.intersection(displayBounds),
       !region.isNull, !region.isEmpty {
        request.regionOfInterest = CGRect(
            x: (region.minX - displayBounds.minX) / displayBounds.width,
            y: 1 - (region.maxY - displayBounds.minY) / displayBounds.height,
            width: region.width / displayBounds.width,
            height: region.height / displayBounds.height
        )
    }

    let handler = VNImageRequestHandler(cgImage: image, orientation: .up)
    try handler.perform([request])

    return (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(3).first else {
            return nil
        }
        let box = observation.boundingBox
        let rect = CGRect(
            x: displayBounds.minX + box.minX * displayBounds.width,
            y: displayBounds.minY + (1 - box.maxY) * displayBounds.height,
            width: box.width * displayBounds.width,
            height: box.height * displayBounds.height
        )
        return RecognizedText(
            text: candidate.string,
            screenRect: rect,
            confidence: candidate.confidence
        )
    }
}

func matchingTargetObservations(
    in observations: [RecognizedText]
) -> [RecognizedText] {
    let normalizedTarget = normalizeForComparison(targetConversation)
    return observations.filter {
        normalizeForComparison($0.text) == normalizedTarget
            && $0.confidence >= minimumOCRConfidence
    }
}

func chatHeaderRegion(window: WeChatWindow) -> CGRect {
    CGRect(
        x: window.bounds.minX + conversationListWidth,
        y: window.bounds.minY,
        width: window.bounds.width - conversationListWidth,
        height: min(chatHeaderHeight, window.bounds.height * 0.08)
    )
}

func conversationListTargets(
    in observations: [RecognizedText],
    window: WeChatWindow
) -> [RecognizedText] {
    matchingTargetObservations(in: observations).filter { observation in
        let point = CGPoint(
            x: observation.screenRect.midX,
            y: observation.screenRect.midY
        )
        return point.x >= window.bounds.minX + appSidebarWidth
            && point.x < window.bounds.minX + conversationListWidth
            && point.y > window.bounds.minY + chatHeaderHeight
            && point.y < window.bounds.maxY - 20
    }
}

func headerIsVerified(
    image: CGImage,
    displayBounds: CGRect,
    window: WeChatWindow
) throws -> Bool {
    let headerObservations = try recognizeText(
        in: image,
        displayBounds: displayBounds,
        regionOfInterest: chatHeaderRegion(window: window)
    )
    return matchingTargetObservations(in: headerObservations).count == 1
}

func averageColor(
    in logicalRegion: CGRect,
    image: CGImage,
    displayBounds: CGRect
) throws -> (red: Double, green: Double, blue: Double) {
    let clippedRegion = logicalRegion.intersection(displayBounds)
    guard !clippedRegion.isNull, !clippedRegion.isEmpty else {
        throw DeliveryError.verificationFailed(
            "The selected-row color sample is outside the captured display"
        )
    }
    let scaleX = CGFloat(image.width) / displayBounds.width
    let scaleY = CGFloat(image.height) / displayBounds.height
    let ciRegion = CGRect(
        x: (clippedRegion.minX - displayBounds.minX) * scaleX,
        y: CGFloat(image.height)
            - (clippedRegion.maxY - displayBounds.minY) * scaleY,
        width: clippedRegion.width * scaleX,
        height: clippedRegion.height * scaleY
    )
    let inputImage = CIImage(cgImage: image)
    guard let filter = CIFilter(
        name: "CIAreaAverage",
        parameters: [
            kCIInputImageKey: inputImage,
            kCIInputExtentKey: CIVector(cgRect: ciRegion)
        ]
    ), let outputImage = filter.outputImage else {
        throw DeliveryError.verificationFailed(
            "Could not measure the selected conversation row"
        )
    }

    var rgba = [UInt8](repeating: 0, count: 4)
    CIContext(options: [.cacheIntermediates: false]).render(
        outputImage,
        toBitmap: &rgba,
        rowBytes: 4,
        bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
        format: .RGBA8,
        colorSpace: CGColorSpaceCreateDeviceRGB()
    )
    return (
        Double(rgba[0]) / 255,
        Double(rgba[1]) / 255,
        Double(rgba[2]) / 255
    )
}

func targetRowIsSelected(
    _ target: RecognizedText,
    image: CGImage,
    displayBounds: CGRect,
    window: WeChatWindow
) throws -> Bool {
    let rowRegion = CGRect(
        x: window.bounds.minX + appSidebarWidth,
        y: max(
            window.bounds.minY + chatHeaderHeight,
            target.screenRect.midY - 32
        ),
        width: conversationListWidth - appSidebarWidth,
        height: 64
    )
    let color = try averageColor(
        in: rowRegion,
        image: image,
        displayBounds: displayBounds
    )
    return color.green >= 0.55
        && color.green - color.red >= 0.25
        && color.green - color.blue >= 0.12
}

@discardableResult
func verifyTargetFrameVisual(
    _ image: CGImage,
    displayBounds: CGRect,
    window: WeChatWindow
) throws -> RecognizedText {
    let observations = try recognizeText(
        in: image,
        displayBounds: displayBounds
    )
    let listTargets = conversationListTargets(
        in: observations,
        window: window
    )
    guard listTargets.count == 1, let target = listTargets.first else {
        throw DeliveryError.verificationFailed(
            "Expected exactly one visible \(targetConversation) row; found \(listTargets.count)"
        )
    }
    guard try headerIsVerified(
        image: image,
        displayBounds: displayBounds,
        window: window
    ) else {
        throw DeliveryError.verificationFailed(
            "The cropped chat header is not exactly \(targetConversation)"
        )
    }
    guard try targetRowIsSelected(
        target,
        image: image,
        displayBounds: displayBounds,
        window: window
    ) else {
        throw DeliveryError.verificationFailed(
            "The unique \(targetConversation) row is not visibly selected"
        )
    }
    return target
}

func postMouseClick(at point: CGPoint) throws {
    let source = CGEventSource(stateID: .privateState)
    guard let down = CGEvent(
        mouseEventSource: source,
        mouseType: .leftMouseDown,
        mouseCursorPosition: point,
        mouseButton: .left
    ), let up = CGEvent(
        mouseEventSource: source,
        mouseType: .leftMouseUp,
        mouseCursorPosition: point,
        mouseButton: .left
    ) else {
        throw DeliveryError.preconditionFailed("Could not create a mouse event")
    }
    down.setIntegerValueField(.eventSourceUserData, value: automationEventTag)
    up.setIntegerValueField(.eventSourceUserData, value: automationEventTag)
    down.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.06)
    up.post(tap: .cghidEventTap)
}

func postKey(_ keyCode: CGKeyCode, flags: CGEventFlags = []) throws {
    let source = CGEventSource(stateID: .privateState)
    guard let down = CGEvent(
        keyboardEventSource: source,
        virtualKey: keyCode,
        keyDown: true
    ), let up = CGEvent(
        keyboardEventSource: source,
        virtualKey: keyCode,
        keyDown: false
    ) else {
        throw DeliveryError.preconditionFailed("Could not create a keyboard event")
    }
    down.flags = flags
    up.flags = flags
    down.setIntegerValueField(.eventSourceUserData, value: automationEventTag)
    up.setIntegerValueField(.eventSourceUserData, value: automationEventTag)
    down.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.04)
    up.post(tap: .cghidEventTap)
}

func commandKey(_ keyCode: CGKeyCode) throws {
    try postKey(keyCode, flags: .maskCommand)
}

func setPasteboardText(_ text: String) throws {
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    guard pasteboard.setString(text, forType: .string) else {
        throw DeliveryError.preconditionFailed(
            "Could not put the caption on the clipboard"
        )
    }
}

func setPasteboardPNG(_ url: URL) throws {
    let data = try Data(contentsOf: url)
    guard !data.isEmpty else {
        throw DeliveryError.preconditionFailed("The PNG image is empty")
    }
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    guard pasteboard.setData(data, forType: .png) else {
        throw DeliveryError.preconditionFailed(
            "Could not put the PNG image on the clipboard"
        )
    }
}

func messageInputPoint(window: WeChatWindow) -> CGPoint {
    CGPoint(
        x: window.bounds.minX + window.bounds.width * 0.62,
        y: window.bounds.minY + window.bounds.height * 0.84
    )
}

func messageInputIsEmpty(window: WeChatWindow) throws -> Bool {
    try postMouseClick(at: messageInputPoint(window: window))
    Thread.sleep(forTimeInterval: 0.15)
    let sentinel = "XIC_EMPTY_CHECK_\(UUID().uuidString)"
    try setPasteboardText(sentinel)
    try commandKey(0) // Command-A
    try commandKey(8) // Command-C
    Thread.sleep(forTimeInterval: 0.15)
    let isEmpty = NSPasteboard.general.string(forType: .string) == sentinel
    try postKey(124) // Right arrow collapses a possible selection without changing text.
    return isEmpty
}

func messageInputContainsImage(window: WeChatWindow) throws -> (Bool, [String]) {
    try postMouseClick(at: messageInputPoint(window: window))
    Thread.sleep(forTimeInterval: 0.15)
    try setPasteboardText("XIC_IMAGE_CHECK_\(UUID().uuidString)")
    try commandKey(0) // Command-A
    try commandKey(8) // Command-C
    Thread.sleep(forTimeInterval: 0.2)
    let pasteboard = NSPasteboard.general
    let hasImage = NSImage(pasteboard: pasteboard) != nil
        || pasteboard.data(forType: .png) != nil
        || pasteboard.data(forType: .tiff) != nil
    let types = pasteboard.types?.map(\.rawValue).sorted() ?? []
    try postKey(124) // Collapse a possible selection without changing content.
    return (hasImage, types)
}

func requireSameFrontmostWeChatWindow(_ window: WeChatWindow) throws {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier
        == window.ownerPID else {
        throw DeliveryError.verificationFailed(
            "WeChat lost foreground focus during the guarded delivery"
        )
    }
    let current = try findMainWeChatWindow()
    let boundsMatch = abs(current.bounds.minX - window.bounds.minX) < 2
        && abs(current.bounds.minY - window.bounds.minY) < 2
        && abs(current.bounds.width - window.bounds.width) < 2
        && abs(current.bounds.height - window.bounds.height) < 2
    guard current.id == window.id,
          current.ownerPID == window.ownerPID,
          boundsMatch else {
        throw DeliveryError.verificationFailed(
            "The verified WeChat main window changed during delivery"
        )
    }
}

func requireNoPhysicalInput(since startUptime: TimeInterval) throws {
    let elapsed = ProcessInfo.processInfo.systemUptime - startUptime
    let eventTypes: [CGEventType] = [
        .keyDown,
        .flagsChanged,
        .leftMouseDown,
        .rightMouseDown,
        .otherMouseDown,
        .mouseMoved,
        .leftMouseDragged,
        .rightMouseDragged,
        .otherMouseDragged,
        .scrollWheel
    ]
    let mostRecentAge = eventTypes.map {
        CGEventSource.secondsSinceLastEventType(
            .hidSystemState,
            eventType: $0
        )
    }.min() ?? .greatestFiniteMagnitude
    guard mostRecentAge > elapsed else {
        throw DeliveryError.verificationFailed(
            "Physical mouse or keyboard input occurred during target verification"
        )
    }
}

@discardableResult
func verifyStableTarget(
    capture: FrameCapture,
    displayBounds: CGRect,
    window: WeChatWindow
) throws -> CGImage {
    let verificationStart = ProcessInfo.processInfo.systemUptime
    var lastFrame: CGImage?
    for sampleIndex in 0..<stableVerificationSamples {
        try requireSameFrontmostWeChatWindow(window)
        let frame = try capture.nextFrame()
        try verifyTargetFrameVisual(
            frame,
            displayBounds: displayBounds,
            window: window
        )
        lastFrame = frame
        if sampleIndex + 1 < stableVerificationSamples {
            Thread.sleep(forTimeInterval: 0.2)
        }
    }
    try requireNoPhysicalInput(since: verificationStart)
    guard let lastFrame else {
        throw DeliveryError.verificationFailed(
            "No stable target verification frame was produced"
        )
    }
    return lastFrame
}

func clearMessageInputOnlyIfTargetVerified(
    capture: FrameCapture,
    displayBounds: CGRect,
    window: WeChatWindow
) {
    do {
        try verifyStableTarget(
            capture: capture,
            displayBounds: displayBounds,
            window: window
        )
        try postMouseClick(at: messageInputPoint(window: window))
        try commandKey(0) // Command-A
        try postKey(51) // Delete
    } catch {
        // Never touch an input box after the verified target has changed.
    }
}

func sendReturnAfterStableTarget(
    capture: FrameCapture,
    displayBounds: CGRect,
    window: WeChatWindow
) throws {
    try verifyStableTarget(
        capture: capture,
        displayBounds: displayBounds,
        window: window
    )
    try postKey(36)
}

func pasteAfterStableTarget(
    capture: FrameCapture,
    displayBounds: CGRect,
    window: WeChatWindow
) throws {
    try verifyStableTarget(
        capture: capture,
        displayBounds: displayBounds,
        window: window
    )
    try commandKey(9)
}

func activateAndVerifyTarget(
    capture: FrameCapture,
    displayBounds: CGRect,
    window: WeChatWindow
) throws {
    guard let application = NSRunningApplication(
        processIdentifier: window.ownerPID
    ) else {
        throw DeliveryError.preconditionFailed(
            "Could not resolve the running WeChat application"
        )
    }
    application.activate(options: [.activateAllWindows])
    Thread.sleep(forTimeInterval: 0.7)

    let initialFrame = try capture.nextFrame()
    if (try? verifyTargetFrameVisual(
        initialFrame,
        displayBounds: displayBounds,
        window: window
    )) != nil {
        try verifyStableTarget(
            capture: capture,
            displayBounds: displayBounds,
            window: window
        )
        return
    }

    let observations = try recognizeText(
        in: initialFrame,
        displayBounds: displayBounds
    )
    let listTargets = conversationListTargets(
        in: observations,
        window: window
    )
    guard listTargets.count == 1, let listTarget = listTargets.first else {
        throw DeliveryError.verificationFailed(
            "Expected one visible \(targetConversation) row before navigation; found \(listTargets.count)"
        )
    }
    try postMouseClick(
        at: CGPoint(
            x: listTarget.screenRect.midX,
            y: listTarget.screenRect.midY
        )
    )
    Thread.sleep(forTimeInterval: 0.8)

    try verifyStableTarget(
        capture: capture,
        displayBounds: displayBounds,
        window: window
    )
}

func writeDiagnosticFrame(
    _ image: CGImage,
    name: String,
    directory: URL?
) {
    guard let directory else { return }
    do {
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        let destinationURL = directory.appendingPathComponent(name)
        guard let destination = CGImageDestinationCreateWithURL(
            destinationURL as CFURL,
            "public.png" as CFString,
            1,
            nil
        ) else {
            return
        }
        CGImageDestinationAddImage(destination, image, nil)
        CGImageDestinationFinalize(destination)
    } catch {
        // Diagnostics never change delivery safety decisions.
    }
}

func loadCGImage(_ url: URL) throws -> CGImage {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw DeliveryError.invalidArguments(
            "Could not decode the audit frame at \(url.path)"
        )
    }
    return image
}

func printJSON(_ value: [String: Any], to handle: FileHandle = .standardOutput) {
    guard let data = try? JSONSerialization.data(
        withJSONObject: value,
        options: [.sortedKeys]
    ), let line = String(data: data, encoding: .utf8) else {
        return
    }
    handle.write(Data((line + "\n").utf8))
}

func validateInputFiles(options: Options) throws -> String? {
    guard !options.dryRun, options.auditFrameURL == nil else { return nil }
    guard let imageURL = options.imageURL else {
        throw DeliveryError.invalidArguments("An image is required")
    }
    guard imageURL.pathExtension.lowercased() == "png",
          FileManager.default.fileExists(atPath: imageURL.path) else {
        throw DeliveryError.preconditionFailed(
            "The image must be an existing PNG file"
        )
    }
    guard !options.imageProbe else { return nil }
    guard let captionURL = options.captionURL else {
        throw DeliveryError.invalidArguments(
            "Delivery requires both an image and a caption file"
        )
    }
    let caption = try String(contentsOf: captionURL, encoding: .utf8)
    guard !caption.isEmpty else {
        throw DeliveryError.preconditionFailed("The caption is empty")
    }
    guard caption.utf16.count <= 2_000 else {
        throw DeliveryError.preconditionFailed(
            "The caption exceeds the 2,000-character safety limit"
        )
    }
    return caption
}

@main
struct WeChatMainWindowDelivery {
    static func main() {
        let pasteboardSnapshot = PasteboardSnapshot()
        var capture: FrameCapture?
        var verifiedWindow: WeChatWindow?
        var verifiedDisplayBounds: CGRect?
        var processLock: ProcessLock?
        var inputContainsAutomationContent = false

        defer {
            if inputContainsAutomationContent,
               let frameCapture = capture,
               let window = verifiedWindow,
               let displayBounds = verifiedDisplayBounds {
                clearMessageInputOnlyIfTargetVerified(
                    capture: frameCapture,
                    displayBounds: displayBounds,
                    window: window
                )
            }
            capture?.stop()
            pasteboardSnapshot.restore()
            _ = processLock
        }

        do {
            let options = try Options.parse(CommandLine.arguments)
            let caption = try validateInputFiles(options: options)

            if let auditFrameURL = options.auditFrameURL {
                let window = try findMainWeChatWindow()
                let displayBounds = CGDisplayBounds(CGMainDisplayID())
                let image = try loadCGImage(auditFrameURL)
                try verifyTargetFrameVisual(
                    image,
                    displayBounds: displayBounds,
                    window: window
                )
                printJSON([
                    "audit_frame": auditFrameURL.path,
                    "status": "FRAME_TARGET_VERIFIED",
                    "target": targetConversation
                ])
                return
            }

            guard AXIsProcessTrusted() else {
                throw DeliveryError.preconditionFailed(
                    "Accessibility permission is required for verified mouse and keyboard control"
                )
            }
            guard CGPreflightScreenCaptureAccess() else {
                throw DeliveryError.preconditionFailed(
                    "Screen Recording permission is required for OCR verification"
                )
            }
            processLock = try ProcessLock()

            let window = try findMainWeChatWindow()
            verifiedWindow = window
            let displayID = CGMainDisplayID()
            let displayBounds = CGDisplayBounds(displayID)
            verifiedDisplayBounds = displayBounds
            guard displayBounds.intersects(window.bounds) else {
                throw DeliveryError.preconditionFailed(
                    "The WeChat main window is not on the main display"
                )
            }

            let frameCapture = FrameCapture()
            capture = frameCapture
            try frameCapture.start(displayID: displayID)
            Thread.sleep(forTimeInterval: 0.4)

            try activateAndVerifyTarget(
                capture: frameCapture,
                displayBounds: displayBounds,
                window: window
            )
            guard try messageInputIsEmpty(window: window) else {
                throw DeliveryError.verificationFailed(
                    "The verified self-chat input already contains a draft; it was left unchanged"
                )
            }
            let verifiedFrame = try verifyStableTarget(
                capture: frameCapture,
                displayBounds: displayBounds,
                window: window
            )

            writeDiagnosticFrame(
                verifiedFrame,
                name: "01-target-verified.png",
                directory: options.diagnosticsDirectory
            )

            if options.dryRun {
                printJSON([
                    "dry_run": true,
                    "status": "TARGET_VERIFIED",
                    "target": targetConversation,
                    "window_id": window.id
                ])
                return
            }

            guard let imageURL = options.imageURL else {
                throw DeliveryError.invalidArguments(
                    "Validated image unexpectedly missing"
                )
            }

            try setPasteboardPNG(imageURL)
            try pasteAfterStableTarget(
                capture: frameCapture,
                displayBounds: displayBounds,
                window: window
            )
            inputContainsAutomationContent = true
            Thread.sleep(forTimeInterval: 1.0)
            let imagePreviewFrame = try frameCapture.nextFrame()
            writeDiagnosticFrame(
                imagePreviewFrame,
                name: "02-image-preview.png",
                directory: options.diagnosticsDirectory
            )
            let (containsImage, copiedTypes) = try messageInputContainsImage(
                window: window
            )
            guard containsImage else {
                throw DeliveryError.verificationFailed(
                    "The pasted PNG could not be verified as an image in the message input; copied types: \(copiedTypes)"
                )
            }
            if options.imageProbe {
                clearMessageInputOnlyIfTargetVerified(
                    capture: frameCapture,
                    displayBounds: displayBounds,
                    window: window
                )
                inputContainsAutomationContent = false
                printJSON([
                    "copied_types": copiedTypes,
                    "image_probe": true,
                    "status": "IMAGE_PREVIEW_VERIFIED",
                    "target": targetConversation
                ])
                return
            }
            try sendReturnAfterStableTarget(
                capture: frameCapture,
                displayBounds: displayBounds,
                window: window
            )
            Thread.sleep(forTimeInterval: 1.0)
            try verifyStableTarget(
                capture: frameCapture,
                displayBounds: displayBounds,
                window: window
            )
            guard try messageInputIsEmpty(window: window) else {
                throw DeliveryError.verificationFailed(
                    "The PNG did not leave the message input after Return"
                )
            }
            inputContainsAutomationContent = false

            guard let caption else {
                throw DeliveryError.invalidArguments(
                    "Validated caption unexpectedly missing"
                )
            }
            try setPasteboardText(caption)
            try pasteAfterStableTarget(
                capture: frameCapture,
                displayBounds: displayBounds,
                window: window
            )
            inputContainsAutomationContent = true
            Thread.sleep(forTimeInterval: 0.35)
            try commandKey(0) // Command-A
            try commandKey(8) // Command-C
            Thread.sleep(forTimeInterval: 0.2)
            guard NSPasteboard.general.string(forType: .string) == caption else {
                clearMessageInputOnlyIfTargetVerified(
                    capture: frameCapture,
                    displayBounds: displayBounds,
                    window: window
                )
                inputContainsAutomationContent = false
                throw DeliveryError.verificationFailed(
                    "The complete pasted caption did not match its verified local source"
                )
            }
            try postKey(124) // Collapse selection at the end.
            try sendReturnAfterStableTarget(
                capture: frameCapture,
                displayBounds: displayBounds,
                window: window
            )
            Thread.sleep(forTimeInterval: 0.8)
            try verifyStableTarget(
                capture: frameCapture,
                displayBounds: displayBounds,
                window: window
            )
            guard try messageInputIsEmpty(window: window) else {
                throw DeliveryError.verificationFailed(
                    "The caption did not leave the message input after Return"
                )
            }
            inputContainsAutomationContent = false
            let finalFrame = try verifyStableTarget(
                capture: frameCapture,
                displayBounds: displayBounds,
                window: window
            )

            writeDiagnosticFrame(
                finalFrame,
                name: "03-delivery-complete.png",
                directory: options.diagnosticsDirectory
            )
            printJSON([
                "delivered_items": 1,
                "image_message": true,
                "caption_message": true,
                "status": "DELIVERED_FOR_REVIEW",
                "target": targetConversation,
                "window_id": window.id
            ])
        } catch {
            printJSON([
                "error": error.localizedDescription,
                "status": "STOPPED_WITHOUT_UNVERIFIED_SEND",
                "target": targetConversation
            ], to: .standardError)
            exit(1)
        }
    }
}
