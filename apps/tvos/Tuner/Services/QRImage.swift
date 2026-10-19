import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit

/// QR codes drawn on the device with Core Image (pairing link, privacy policy address).
enum QRImage {
    private static let context = CIContext()

    /// Dark #141224 modules on white, `scale` pixels per module, with Core Image's own quiet zone. Nil if the text
    /// can't be encoded.
    static func make(_ text: String, scale: CGFloat = 12) -> UIImage? {
        let generator = CIFilter.qrCodeGenerator()
        generator.message = Data(text.utf8)
        generator.correctionLevel = "M"
        guard let code = generator.outputImage else { return nil }
        let colors = CIFilter.falseColor()
        colors.inputImage = code
        colors.color0 = CIColor(red: 20 / 255, green: 18 / 255, blue: 36 / 255)
        colors.color1 = CIColor(red: 1, green: 1, blue: 1)
        guard let colored = colors.outputImage else { return nil }
        let scaled = colored.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let image = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: image)
    }
}
