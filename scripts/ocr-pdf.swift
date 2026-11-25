// macOS-only OCR for scanned municipal PDFs, using the on-device Vision framework (no network).
// Usage: swift scripts/ocr-pdf.swift input.pdf > output.txt
import PDFKit
import Vision
import AppKit
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let doc = PDFDocument(url: url) else { exit(1) }
for i in 0..<doc.pageCount {
  guard let page = doc.page(at: i) else { continue }
  let bounds = page.bounds(for: .mediaBox)
  let scale: CGFloat = 3
  let w = Int(bounds.width*scale), h = Int(bounds.height*scale)
  let cs = CGColorSpaceCreateDeviceRGB()
  guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { continue }
  ctx.setFillColor(CGColor(red:1,green:1,blue:1,alpha:1)); ctx.fill(CGRect(x:0,y:0,width:w,height:h))
  ctx.scaleBy(x: scale, y: scale); page.draw(with: .mediaBox, to: ctx)
  guard let img = ctx.makeImage() else { continue }
  let req = VNRecognizeTextRequest(); req.recognitionLevel = .accurate; req.usesLanguageCorrection = false
  try? VNImageRequestHandler(cgImage: img).perform([req])
  let obs = (req.results ?? []).sorted { a, b in
    let ay = a.boundingBox.midY, by = b.boundingBox.midY
    if abs(ay-by) > 0.006 { return ay > by }; return a.boundingBox.minX < b.boundingBox.minX }
  print("=== PAGE \(i+1) ===")
  var lastY: CGFloat = -1; var line: [String] = []
  for o in obs { let y = o.boundingBox.midY
    if lastY >= 0 && abs(y-lastY) > 0.006 { print(line.joined(separator: " | ")); line = [] }
    line.append(o.topCandidates(1).first?.string ?? ""); lastY = y }
  if !line.isEmpty { print(line.joined(separator: " | ")) }
}
