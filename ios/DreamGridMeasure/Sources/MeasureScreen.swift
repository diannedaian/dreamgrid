import SwiftUI

/// Camera fills the screen; a thin overlay says which dimension to tap next.
struct MeasureScreen: View {
    @EnvironmentObject var session: MeasureSession
    @Environment(\.openURL) private var openURL

    var body: some View {
        ZStack(alignment: .bottom) {
            ARMeasureView().ignoresSafeArea()

            VStack(spacing: 10) {
                if let step = session.step {
                    Text(step.title).font(.title2.bold())
                    Text(session.firstPoint == nil ? step.hint : "Now tap the other end.")
                        .font(.callout).multilineTextAlignment(.center)
                } else {
                    Text("Room measured").font(.title2.bold())
                }

                HStack(spacing: 18) {
                    ForEach(Dimension.allCases) { d in
                        VStack(spacing: 2) {
                            Text(d.title).font(.caption2).opacity(0.7)
                            Text(session.inches[d].map(feetInches) ?? "—").font(.body.monospacedDigit())
                        }
                    }
                }

                if session.complete {
                    Button("Send to DreamGrid") { Task { await session.send() } }
                        .buttonStyle(.borderedProminent)
                    if !session.status.isEmpty { Text(session.status).font(.footnote) }
                    if let url = session.fallbackURL {
                        Button("Open room on this phone") { openURL(url) }.font(.footnote)
                    }
                }

                HStack {
                    Button("Undo", action: session.undo)
                    Spacer()
                    Button("Start over", action: session.reset)
                }
                .font(.footnote)
            }
            .padding(16)
            .frame(maxWidth: .infinity)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
            .padding(12)
        }
    }
}
