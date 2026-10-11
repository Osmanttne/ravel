import SwiftUI
import UIKit

@main
struct RavelShareTestHostApp: App {
    var body: some Scene {
        WindowGroup { RavelShareTestHostView() }
    }
}

private struct RavelShareTestHostView: View {
    @State private var sample: Sample?

    var body: some View {
        NavigationStack {
            List {
                Section("Synthetic single items") {
                    Button("View synthetic screenshot") { sample = .screenshot }
                    Button("Share ticket message") { sample = .text }
                    Button("Share example link") { sample = .url }
                    Button("Share ticket image") { sample = .image }
                }
                Section("Unsupported input checks") {
                    Button("Share two independent items") { sample = .multiple }
                }
                Section {
                    Text("Install Ravel first, then choose Ravel in the Share menu. These examples contain invented .example links. The test host makes no network requests.")
                    Text("Use a fixture backend for deterministic checks. In Gemini mode, tapping Analyze privately in the extension sends the selected example to the backend and Google.")
                }
            }
            .navigationTitle("Share menu tests")
            .sheet(item: $sample) { sample in
                if sample == .screenshot {
                    NavigationStack {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 20) {
                                Image(uiImage: Sample.ticketImage())
                                    .resizable()
                                    .scaledToFit()
                                    .accessibilityLabel("Synthetic ticket offer with a transfer fee and an invented example link")
                                Text("Take an iPhone screenshot of this synthetic example. In Photos, select that screenshot and use Share → Ravel. You can also choose it with Check screenshot in Ravel.")
                            }
                            .padding()
                        }
                        .navigationTitle("Synthetic screenshot")
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Done") { self.sample = nil }
                            }
                        }
                    }
                } else {
                    ActivitySheet(items: sample.items)
                }
            }
        }
    }
}

private enum Sample: String, Identifiable {
    case text, url, image, multiple, screenshot
    var id: String { rawValue }

    var items: [Any] {
        let message = "Free concert tickets. Pay a $20 transfer fee before delivery: https://tickets.example/offer"
        let link = URL(string: "https://campus.example/events")!
        switch self {
        case .text: return [message]
        case .url: return [link]
        case .image: return [Self.ticketImage()]
        case .multiple: return [Self.ticketImage(), link]
        case .screenshot: return []
        }
    }

    static func ticketImage() -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 700, height: 460))
        return renderer.image { context in
            UIColor.white.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 700, height: 460))
            let text = "SYNTHETIC EXAMPLE\n\nFree concert tickets!\nPay a $20 transfer fee before delivery.\nhttps://tickets.example/offer"
            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 28),
                .foregroundColor: UIColor.black
            ]
            (text as NSString).draw(in: CGRect(x: 28, y: 28, width: 644, height: 404), withAttributes: attributes)
        }
    }
}

private struct ActivitySheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
