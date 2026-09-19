import ARKit
import SceneKit
import SwiftUI

/// Full-screen ARKit view. A tap raycasts onto the real world and reports the hit point.
struct ARMeasureView: UIViewRepresentable {
    @EnvironmentObject var session: MeasureSession

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView()
        view.automaticallyUpdatesLighting = true
        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.horizontal, .vertical]
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
            config.sceneReconstruction = .mesh // LiDAR phones: raycasts hit real surfaces, not just planes
        }
        view.session.run(config)
        view.addGestureRecognizer(UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tap(_:))))
        context.coordinator.view = view
        return view
    }

    func updateUIView(_ view: ARSCNView, context: Context) {
        context.coordinator.syncMarkers(session)
    }

    func makeCoordinator() -> Coordinator { Coordinator(session: session) }

    final class Coordinator: NSObject {
        let session: MeasureSession
        weak var view: ARSCNView?
        private var markers: [SCNNode] = []
        private var lines: [SCNNode] = []
        private var completedPairs: [(simd_float3, simd_float3)] = []
        private var pendingFirst: simd_float3?

        init(session: MeasureSession) { self.session = session }

        @objc func tap(_ g: UITapGestureRecognizer) {
            guard let view, let query = view.raycastQuery(from: g.location(in: view), allowing: .estimatedPlane, alignment: .any),
                  let hit = view.session.raycast(query).first else { return }
            let t = hit.worldTransform.columns.3
            let p = simd_float3(t.x, t.y, t.z)
            Task { @MainActor in
                let hadFirst = session.firstPoint
                session.tapped(at: p)
                if let a = hadFirst { completedPairs.append((a, p)); pendingFirst = nil } else { pendingFirst = p }
                redraw()
            }
        }

        /// Rebuild markers when the session is reset or undone from the overlay.
        func syncMarkers(_ s: MeasureSession) {
            let expected = s.inches.count
            if completedPairs.count > expected { completedPairs.removeLast(completedPairs.count - expected); redraw() }
            if s.firstPoint == nil, pendingFirst != nil { pendingFirst = nil; redraw() }
        }

        private func redraw() {
            guard let view else { return }
            (markers + lines).forEach { $0.removeFromParentNode() }
            markers = []; lines = []
            for (a, b) in completedPairs { addMarker(a, in: view); addMarker(b, in: view); addLine(a, b, in: view) }
            if let p = pendingFirst { addMarker(p, in: view) }
        }

        private func addMarker(_ p: simd_float3, in view: ARSCNView) {
            let n = SCNNode(geometry: SCNSphere(radius: 0.008))
            n.geometry?.firstMaterial?.diffuse.contents = UIColor.systemGreen
            n.simdPosition = p
            view.scene.rootNode.addChildNode(n)
            markers.append(n)
        }

        private func addLine(_ a: simd_float3, _ b: simd_float3, in view: ARSCNView) {
            let len = simd_distance(a, b)
            let cyl = SCNCylinder(radius: 0.003, height: CGFloat(len))
            cyl.firstMaterial?.diffuse.contents = UIColor.systemGreen
            let n = SCNNode(geometry: cyl)
            n.simdPosition = (a + b) / 2
            n.simdLook(at: b, up: simd_float3(0, 1, 0), localFront: simd_float3(0, 1, 0))
            view.scene.rootNode.addChildNode(n)
            lines.append(n)
        }
    }
}
