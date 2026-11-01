import CoreGraphics
import CoreMedia
import Foundation

// Absolute deadlines avoid accumulating CGEvent/posting/sleep overhead.
Thread.current.qualityOfService = .userInteractive
let point = CGPoint(x: Double(CommandLine.arguments[1])!, y: Double(CommandLine.arguments[2])!)
let original = CGEvent(source: nil)!.location
defer {
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: original, mouseButton: .left)!.post(tap: .cghidEventTap)
}
CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)!.post(tap: .cghidEventTap)
var base = mach_timebase_info_data_t()
mach_timebase_info(&base)
let ticksPerSecond = 1_000_000_000 * UInt64(base.denom) / UInt64(base.numer)
let start = mach_absolute_time() + ticksPerSecond / 50
var times: [Double] = []
for index in 0..<480 {
    let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: index < 240 ? -25 : 25, wheel2: 0, wheel3: 0)!
    event.location = point
    event.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
    event.setIntegerValueField(.scrollWheelEventScrollPhase, value: index % 240 == 0 ? 1 : 2)
    mach_wait_until(start + UInt64(index) * ticksPerSecond / 120)
    event.post(tap: .cghidEventTap)
    times.append(CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock())))
    if index % 240 == 239 {
        let end = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: 0, wheel2: 0, wheel3: 0)!
        end.location = point
        end.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
        end.setIntegerValueField(.scrollWheelEventScrollPhase, value: 4)
        end.post(tap: .cghidEventTap)
    }
}
print(String(data: try JSONSerialization.data(withJSONObject: ["times": times]), encoding: .utf8)!)
