import Foundation
import PDFKit
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count >= 2 else {
    fputs("Usage: ocr_helper <pdf_path> [start_page_1based] [end_page_1based]\n", stderr)
    exit(1)
}

let pdfPath = args[1]
guard let doc = PDFDocument(url: URL(fileURLWithPath: pdfPath)) else {
    fputs("Cannot open PDF: \(pdfPath)\n", stderr)
    exit(2)
}

let total = doc.pageCount
let startP = args.count >= 3 ? max(1, Int(args[2]) ?? 1) : 1
let endP = args.count >= 4 ? min(total, Int(args[3]) ?? total) : total

func ocrPage(_ page: PDFPage) -> String {
    let bounds = page.bounds(for: .mediaBox)
    let scale: CGFloat = 2.0
    let width = max(1, Int(bounds.width * scale))
    let height = max(1, Int(bounds.height * scale))
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(
        data: nil, width: width, height: height,
        bitsPerComponent: 8, bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return "" }

    ctx.setFillColor(CGColor.white)
    ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
    ctx.saveGState()
    ctx.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: ctx)
    ctx.restoreGState()

    guard let cgImg = ctx.makeImage() else { return "" }
    var lines: [String] = []
    let req = VNRecognizeTextRequest { request, _ in
        guard let obs = request.results as? [VNRecognizedTextObservation] else { return }
        for o in obs {
            if let top = o.topCandidates(1).first {
                lines.append(top.string)
            }
        }
    }
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = false
    req.recognitionLanguages = ["en-US", "zh-Hans"]

    let handler = VNImageRequestHandler(cgImage: cgImg, options: [:])
    try? handler.perform([req])
    return lines.joined(separator: "\n")
}

var result: [[String: Any]] = []
for p in startP...endP {
    if let page = doc.page(at: p - 1) {
        result.append([
            "page": p,
            "text": ocrPage(page)
        ])
    }
}

if let data = try? JSONSerialization.data(withJSONObject: ["pages": total, "items": result], options: []),
   let str = String(data: data, encoding: .utf8) {
    print(str)
}
