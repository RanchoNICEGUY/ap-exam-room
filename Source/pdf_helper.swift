import Foundation
import PDFKit
import AppKit

// CLI PDFKit renderer & info tool for HTTP portable server and batch cropper
// Modes:
//   pdf_helper info <pdf_path>
//   pdf_helper page <pdf_path> <page_1based> <scale> <out_png>
//   pdf_helper crop <pdf_path> <page_1based> <x1,y1,x2,y2> <scale> <out_png>
//   pdf_helper batch-info   (reads newline-separated pdf paths from stdin -> JSON map)
let args = CommandLine.arguments
if args.count >= 2 && args[1] == "batch-info" {
    let inputData = FileHandle.standardInput.readDataToEndOfFile()
    let rawStr = String(data: inputData, encoding: .utf8) ?? ""
    let paths = rawStr.split(separator: "\n").map { String($0) }.filter { !$0.isEmpty }
    var res: [String: [Int]] = [:]
    let lock = NSLock()
    let queue = DispatchQueue(label: "batch", attributes: .concurrent)
    let group = DispatchGroup()
    let sem = DispatchSemaphore(value: 8)
    for path in paths {
        group.enter()
        sem.wait()
        queue.async {
            defer { sem.signal(); group.leave() }
            var n = 0
            var ansStart = 0
            let fm = FileManager.default
            if let attrs = try? fm.attributesOfItem(atPath: path),
               let fsize = attrs[.size] as? Int64, fsize >= 1024,
               let doc = PDFDocument(url: URL(fileURLWithPath: path)) {
                n = doc.pageCount
                if n >= 4 && n <= 120 {
                    let minP = max(3, Int(Double(n) * 0.35))
                    for p in minP...n {
                        if let s = doc.page(at: p - 1)?.string {
                            let head = String(s.prefix(400))
                            if head.contains("Scoring Guidelines") || head.contains("ANSWER KEY") || head.contains("Answer Key") || head.contains("参考答案") {
                                ansStart = p
                                break
                            }
                        }
                    }
                }
            }
            lock.lock()
            res[path] = [n, ansStart]
            lock.unlock()
        }
    }
    group.wait()
    if let data = try? JSONSerialization.data(withJSONObject: res) {
        FileHandle.standardOutput.write(data)
    }
    exit(0)
}
if args.count < 3 { exit(1) }
let mode = args[1]
let pdfPath = args[2]
guard let doc = PDFDocument(url: URL(fileURLWithPath: pdfPath)) else {
    fputs("Failed to open PDF: \(pdfPath)\n", stderr)
    exit(2)
}

if mode == "info" {
    let out: [String: Any] = ["pages": doc.pageCount]
    let data = try JSONSerialization.data(withJSONObject: out)
    FileHandle.standardOutput.write(data)
    exit(0)
}

if mode == "page" && args.count >= 6 {
    let pg = Int(args[3]) ?? 1
    let scale = CGFloat(Double(args[4]) ?? 2.0)
    let outPath = args[5]
    guard pg >= 1 && pg <= doc.pageCount, let page = doc.page(at: pg - 1) else { exit(3) }
    let box = page.bounds(for: .mediaBox)
    let w = max(1, Int(box.width * scale))
    let h = max(1, Int(box.height * scale))
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
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
    let data = rep.representation(using: .png, properties: [:])!
    try data.write(to: URL(fileURLWithPath: outPath))
    exit(0)
}

if mode == "crop" && args.count >= 7 {
    let pg = Int(args[3]) ?? 1
    let coords = args[4].split(separator: ",").compactMap { Double($0) }
    let scale = CGFloat(Double(args[5]) ?? 2.0)
    let outPath = args[6]
    guard pg >= 1 && pg <= doc.pageCount, let page = doc.page(at: pg - 1), coords.count == 4 else { exit(3) }
    let cropRect = CGRect(x: coords[0], y: coords[1], width: max(1, coords[2] - coords[0]), height: max(1, coords[3] - coords[1]))
    let w = max(1, Int(cropRect.width * scale))
    let h = max(1, Int(cropRect.height * scale))
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    let ctx = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.current = ctx
    let cg = ctx.cgContext
    cg.setFillColor(NSColor.white.cgColor)
    cg.fill(CGRect(x: 0, y: 0, width: w, height: h))
    cg.saveGState()
    cg.scaleBy(x: scale, y: scale)
    cg.translateBy(x: -cropRect.origin.x, y: -cropRect.origin.y)
    page.draw(with: .mediaBox, to: cg)
    cg.restoreGState()
    NSGraphicsContext.restoreGraphicsState()
    let data = rep.representation(using: .png, properties: [:])!
    try data.write(to: URL(fileURLWithPath: outPath))
    exit(0)
}

exit(4)
