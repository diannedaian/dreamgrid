import SwiftUI

/// Opened from Safari via `dreamgrid://measure?return=http://<mac-ip>:5173/`.
/// Goes straight to the camera; the return URL is where measurements are sent.
@main
struct DreamGridMeasureApp: App {
    @StateObject private var session = MeasureSession()

    var body: some Scene {
        WindowGroup {
            MeasureScreen()
                .environmentObject(session)
                .onOpenURL { url in session.handle(openURL: url) }
        }
    }
}
