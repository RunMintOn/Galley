import Carbon

func sourceID(_ source: TISInputSource) -> String {
    let value = TISGetInputSourceProperty(source, kTISPropertyInputSourceID)!
    return Unmanaged<CFString>.fromOpaque(value).takeUnretainedValue() as String
}

if let requested = CommandLine.arguments.dropFirst().first {
    let sources = TISCreateInputSourceList(nil, false).takeRetainedValue() as! [TISInputSource]
    guard let source = sources.first(where: { sourceID($0) == requested }),
          TISSelectInputSource(source) == noErr else {
        fatalError("Cannot select enabled input source: \(requested)")
    }
}
print(sourceID(TISCopyCurrentKeyboardInputSource().takeRetainedValue()))
