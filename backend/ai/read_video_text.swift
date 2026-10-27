import AppKit
import Foundation
import Vision

// Reads text printed on one image. Used only to recover a clock burned into
// CCTV footage. Prints a JSON array of strings. No faces, no identities.
guard CommandLine.arguments.count > 1 else {
    fputs("[]\n", stdout)
    exit(0)
}

let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = NSImage(contentsOf: url),
      let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let cgImage = bitmap.cgImage else {
    fputs("[]\n", stdout)
    exit(0)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    fputs("[]\n", stdout)
    exit(0)
}

let lines = (request.results ?? []).compactMap { observation -> String? in
    observation.topCandidates(1).first?.string
}

guard let data = try? JSONSerialization.data(withJSONObject: lines),
      let text = String(data: data, encoding: .utf8) else {
    fputs("[]\n", stdout)
    exit(0)
}

print(text)
