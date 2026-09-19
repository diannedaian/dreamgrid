import Foundation
import simd

enum Dimension: Int, CaseIterable, Identifiable {
    case length, width, height
    var id: Int { rawValue }

    var title: String {
        switch self {
        case .length: return "Length"
        case .width: return "Width"
        case .height: return "Height"
        }
    }

    var hint: String {
        switch self {
        case .length: return "Tap one end of the long wall, then the other."
        case .width: return "Tap one end of the short wall, then the other."
        case .height: return "Tap the floor at a wall, then the ceiling directly above it."
        }
    }
}

/// Drives the three-measurement flow and the hand-off back to the web app.
@MainActor
final class MeasureSession: ObservableObject {
    @Published var step: Dimension? = .length
    @Published var firstPoint: simd_float3?
    @Published var inches: [Dimension: Int] = [:]
    @Published var status: String = ""
    @Published var returnURL: URL = UserDefaults.standard.url(forKey: "returnURL") ?? URL(string: "http://localhost:5173/")!

    private static let metersPerInch: Float = 0.0254

    func handle(openURL url: URL) {
        guard let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let ret = items.first(where: { $0.name == "return" })?.value,
              let parsed = URL(string: ret) else { return }
        returnURL = parsed
        UserDefaults.standard.set(parsed, forKey: "returnURL")
        reset()
    }

    /// Called with a world-space point for each tap. Two taps complete the current dimension.
    func tapped(at point: simd_float3) {
        guard let current = step else { return }
        if let a = firstPoint {
            let meters = simd_distance(a, point)
            inches[current] = max(1, Int((meters / Self.metersPerInch).rounded()))
            firstPoint = nil
            step = Dimension(rawValue: current.rawValue + 1)
        } else {
            firstPoint = point
        }
    }

    func undo() {
        if firstPoint != nil { firstPoint = nil; return }
        guard let current = step, current.rawValue > 0 else {
            if step == nil { step = .height; inches[.height] = nil }
            return
        }
        let prev = Dimension(rawValue: current.rawValue - 1)!
        inches[prev] = nil
        step = prev
    }

    func reset() {
        step = .length
        firstPoint = nil
        inches = [:]
        status = ""
    }

    var complete: Bool { step == nil && inches.count == Dimension.allCases.count }

    /// POSTs the measurement to the web app's relay so the desktop page imports it automatically.
    func send() async {
        guard complete else { return }
        let payload: [String: Int] = ["w": inches[.length]!, "d": inches[.width]!, "h": inches[.height]!]
        var req = URLRequest(url: returnURL.appendingPathComponent("api/measurement"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        req.timeoutInterval = 6
        status = "Sending…"
        do {
            let (_, resp) = try await URLSession.shared.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            status = (200..<300).contains(code) ? "Sent to DreamGrid" : "Server replied \(code)"
        } catch {
            status = "Couldn't reach \(returnURL.host ?? "server"). Is the dev server running with --host?"
        }
    }

    /// Fallback: open the room page on this phone with the dimensions in the URL.
    var fallbackURL: URL? {
        guard complete, var c = URLComponents(url: returnURL, resolvingAgainstBaseURL: false) else { return nil }
        c.queryItems = [
            URLQueryItem(name: "w", value: String(inches[.length]!)),
            URLQueryItem(name: "d", value: String(inches[.width]!)),
            URLQueryItem(name: "h", value: String(inches[.height]!)),
        ]
        return c.url
    }
}

func feetInches(_ inches: Int) -> String { "\(inches / 12)' \(inches % 12)\"" }
