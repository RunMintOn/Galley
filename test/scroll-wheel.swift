import CoreGraphics
import Foundation

// Pixel wheel events use the OS input path, not JavaScript scrollTop updates.
let point = CGPoint(x: Double(CommandLine.arguments[1])!, y: Double(CommandLine.arguments[2])!)
let original = CGEvent(source: nil)!.location
CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)!.post(tap: .cghidEventTap)
for direction in [-1, 1] {
    for index in 0..<240 {
        let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: Int32(direction * 25), wheel2: 0, wheel3: 0)!
        event.location = point
        event.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
        event.setIntegerValueField(.scrollWheelEventScrollPhase, value: index == 0 ? 1 : 2)
        event.post(tap: .cghidEventTap)
        usleep(8333)
    }
    let end = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: 0, wheel2: 0, wheel3: 0)!
    end.location = point
    end.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
    end.setIntegerValueField(.scrollWheelEventScrollPhase, value: 4)
    end.post(tap: .cghidEventTap)
}
CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: original, mouseButton: .left)!.post(tap: .cghidEventTap)
