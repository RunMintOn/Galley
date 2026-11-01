// Captures only the test process's window. Saves hashes/timestamps, not pixels.
import AppKit
import ScreenCaptureKit
import CoreMedia
import CoreVideo

final class Samples: NSObject, SCStreamOutput, @unchecked Sendable {
    var rows: [[String: Any]] = []
    var region = CGRect.zero
    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sample.isValid,
              let info = (CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]])?.first,
              let status = info[.status] as? Int else { return }
        let time = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
        var row: [String: Any] = ["time": time, "status": status]
        if status == SCFrameStatus.complete.rawValue, let pixels = CMSampleBufferGetImageBuffer(sample) {
            CVPixelBufferLockBaseAddress(pixels, .readOnly)
            let w = CVPixelBufferGetWidth(pixels), h = CVPixelBufferGetHeight(pixels)
            let stride = CVPixelBufferGetBytesPerRow(pixels)
            if let base = CVPixelBufferGetBaseAddress(pixels)?.assumingMemoryBound(to: UInt8.self) {
                var hash: UInt64 = 14695981039346656037
                // Right-hand content only: no window title, pointer or left panels.
                for y in Swift.stride(from: max(0, Int(region.minY)), to: min(h, Int(region.maxY)), by: 3) {
                    for x in Swift.stride(from: max(0, Int(region.minX)), to: min(w, Int(region.maxX)), by: 3) {
                        let p = y * stride + x * 4
                        for channel in 0..<3 { hash = (hash ^ UInt64(base[p + channel])) &* 1099511628211 }
                    }
                }
                row["hash"] = String(hash)
            }
            CVPixelBufferUnlockBaseAddress(pixels, .readOnly)
        }
        rows.append(row)
    }
}

@main struct Capture {
    @MainActor
    static func main() async throws {
        _ = NSApplication.shared
        NSApplication.shared.setActivationPolicy(.prohibited)
        let pid = Int32(CommandLine.arguments[1])!
        let seconds = Double(CommandLine.arguments[2])!
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        guard let window = content.windows.first(where: { $0.owningApplication?.processID == pid && $0.windowLayer == 0 }) else {
            fatalError("test window not found")
        }
        let config = SCStreamConfiguration()
        config.width = 720
        config.height = Int(720 * window.frame.height / window.frame.width)
        config.minimumFrameInterval = .zero // display's native rate, not default 1/60
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.queueDepth = 5
        config.showsCursor = false
        config.capturesAudio = false
        let samples = Samples()
        let roi = CommandLine.arguments.dropFirst(3).map { Double($0)! }
        let scale = 720 / window.frame.width
        samples.region = CGRect(x: (roi[0] + 10) * scale, y: (roi[1] + 80) * scale,
                                width: (roi[2] - 30) * scale, height: (roi[3] - 100) * scale)
        let queue = DispatchQueue(label: "test-window-capture")
        let stream = SCStream(filter: SCContentFilter(desktopIndependentWindow: window), configuration: config, delegate: nil)
        try stream.addStreamOutput(samples, type: .screen, sampleHandlerQueue: queue)
        try await stream.startCapture()
        print("READY")
        fflush(stdout)
        try await Task.sleep(for: .seconds(seconds))
        try await stream.stopCapture()
        let rows = queue.sync { samples.rows }
        let output: [String: Any] = ["windowID": window.windowID, "bounds": [
            "x": window.frame.minX, "y": window.frame.minY, "width": window.frame.width, "height": window.frame.height
        ], "rows": rows]
        print(String(data: try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]), encoding: .utf8)!)
    }
}
