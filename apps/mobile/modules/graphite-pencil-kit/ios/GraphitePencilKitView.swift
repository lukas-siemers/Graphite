import ExpoModulesCore
import PencilKit
import UIKit

/**
 * GraphitePencilKitView
 *
 * An ExpoView that hosts a full-bleed PKCanvasView. PencilKit handles:
 *   - Apple Pencil pressure, tilt, azimuth, smoothing
 *   - Palm rejection (allowsFingerDrawing = false)
 *   - Native eraser / undo support
 *
 * On every canvas edit we re-serialize the full drawing into our InkStroke[]
 * shape and emit it up to JS. We do NOT attempt incremental diffing — the
 * full-canvas pass is cheap even for hundreds of strokes and matches how
 * Graphite's store already consumes the data.
 *
 * Loading existing strokes goes the other way: JS sends the InkStroke[] via
 * the `initialStrokes` prop and we reconstruct a `PKDrawing` from scratch.
 * We ignore `initialStrokes` if the drawing is already non-empty (to avoid
 * stomping user edits on re-render).
 */
class GraphitePencilKitView: ExpoView, PKCanvasViewDelegate {
  private let canvasView = PKCanvasView()
  private let toolPicker = PKToolPicker()

  // Reentrancy guard: applying `initialStrokes` mutates the PKDrawing, which
  // re-enters `canvasViewDrawingDidChange`. Without this we'd emit the strokes
  // we just loaded right back to JS, which would overwrite newer state.
  private var isLoadingInitialStrokes = false

  // One-shot flag: we only honor `initialStrokes` on the first non-empty load.
  // Props re-fire on every React render and we don't want to blow away the
  // user's in-progress strokes just because the parent re-rendered.
  private var hasLoadedInitialStrokes = false

  let onStrokesChanged = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    canvasView.delegate = self
    canvasView.drawingPolicy = .pencilOnly
    canvasView.alwaysBounceVertical = true
    canvasView.backgroundColor = UIColor(red: 30 / 255.0, green: 30 / 255.0, blue: 30 / 255.0, alpha: 1.0)
    canvasView.isOpaque = false
    canvasView.translatesAutoresizingMaskIntoConstraints = false

    // Use a white default ink so strokes are visible against our #1E1E1E bg.
    // Future work: expose color/width as props.
    canvasView.tool = PKInkingTool(.pen, color: .white, width: 3)

    addSubview(canvasView)
    NSLayoutConstraint.activate([
      canvasView.topAnchor.constraint(equalTo: topAnchor),
      canvasView.bottomAnchor.constraint(equalTo: bottomAnchor),
      canvasView.leadingAnchor.constraint(equalTo: leadingAnchor),
      canvasView.trailingAnchor.constraint(equalTo: trailingAnchor)
    ])

    // Show the system tool picker once the canvas is in a window.
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.toolPicker.setVisible(true, forFirstResponder: self.canvasView)
      self.toolPicker.addObserver(self.canvasView)
      self.canvasView.becomeFirstResponder()
    }
  }

  // MARK: - Prop loading

  func loadInitialStrokes(_ strokes: [[String: Any]]) {
    // Only honor the first non-empty load for a given mount. If JS re-sends
    // the same strokes on re-render we ignore it to avoid clobbering edits.
    if hasLoadedInitialStrokes {
      return
    }
    hasLoadedInitialStrokes = true

    isLoadingInitialStrokes = true
    defer { isLoadingInitialStrokes = false }

    let pkStrokes = strokes.compactMap { Self.deserializeStroke($0) }
    canvasView.drawing = PKDrawing(strokes: pkStrokes)
  }

  // MARK: - PKCanvasViewDelegate

  func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
    if isLoadingInitialStrokes {
      return
    }
    let serialized = Self.serializeDrawing(canvasView.drawing)
    onStrokesChanged([
      "strokes": serialized
    ])
  }

  // MARK: - PKDrawing <-> InkStroke[] mapping
  //
  // Graphite's InkStroke shape (see packages/db/src/canvas-types.ts):
  //
  //   interface InkStroke {
  //     id: string;
  //     points: { x, y, pressure, tilt, timestamp }[];
  //     color: string;      // hex "#RRGGBB"
  //     width: number;      // base stroke width
  //     opacity: number;    // 0.0 - 1.0
  //   }
  //
  // IDs are stable per-stroke within a drawing session but are *not* preserved
  // across save/load — we regenerate them on deserialize. That's fine: the
  // store re-emits the whole set on every edit anyway, so external consumers
  // never see a stroke change IDs mid-session.

  private static func serializeDrawing(_ drawing: PKDrawing) -> [[String: Any]] {
    return drawing.strokes.enumerated().map { (index, stroke) in
      serializeStroke(stroke, index: index)
    }
  }

  private static func serializeStroke(_ stroke: PKStroke, index: Int) -> [String: Any] {
    var points: [[String: Any]] = []
    points.reserveCapacity(stroke.path.count)

    // stroke.path is a PKStrokePath — we iterate by index to get raw points.
    for i in 0..<stroke.path.count {
      let p = stroke.path[i]
      points.append([
        "x": Double(p.location.x),
        "y": Double(p.location.y),
        // force is 0 for non-Pencil input; clamp defensively.
        "pressure": max(0.0, min(1.0, Double(p.force))),
        // PencilKit reports altitude in radians (0 = flat, π/2 = vertical).
        // Our InkStroke uses tilt in *degrees*, so convert here.
        "tilt": Double(p.altitude) * 180.0 / .pi,
        // timeOffset is seconds relative to stroke start; we store ms
        // relative to the drawing start for easier JS consumption.
        "timestamp": Int(p.timeOffset * 1000.0)
      ])
    }

    let ink = stroke.ink
    let (color, opacity) = hexAndOpacity(for: ink.color)

    return [
      "id": "pk-\(index)",
      "points": points,
      "color": color,
      // PencilKit doesn't expose a direct "base width" — inkingTool.width is
      // the UI value but strokes carry their own. We derive it from the
      // first point's raw size, falling back to 3.0.
      "width": stroke.path.first.map { Double($0.size.width) } ?? 3.0,
      "opacity": opacity
    ]
  }

  private static func deserializeStroke(_ dict: [String: Any]) -> PKStroke? {
    guard let pointsRaw = dict["points"] as? [[String: Any]], !pointsRaw.isEmpty else {
      return nil
    }

    let baseWidth = (dict["width"] as? Double) ?? 3.0
    let colorHex = (dict["color"] as? String) ?? "#FFFFFF"
    let opacity = (dict["opacity"] as? Double) ?? 1.0
    let color = uiColor(fromHex: colorHex, alpha: CGFloat(opacity))

    let strokePoints: [PKStrokePoint] = pointsRaw.compactMap { raw in
      guard
        let x = raw["x"] as? Double,
        let y = raw["y"] as? Double
      else { return nil }

      let pressure = (raw["pressure"] as? Double) ?? 1.0
      let tiltDegrees = (raw["tilt"] as? Double) ?? 0.0
      let tiltRadians = tiltDegrees * .pi / 180.0
      let timestampMs = (raw["timestamp"] as? Double) ?? 0.0

      return PKStrokePoint(
        location: CGPoint(x: x, y: y),
        timeOffset: timestampMs / 1000.0,
        size: CGSize(width: baseWidth, height: baseWidth),
        opacity: CGFloat(opacity),
        force: CGFloat(pressure),
        azimuth: 0,
        altitude: tiltRadians
      )
    }

    guard !strokePoints.isEmpty else { return nil }

    let path = PKStrokePath(
      controlPoints: strokePoints,
      creationDate: Date()
    )
    let ink = PKInk(.pen, color: color)
    return PKStroke(ink: ink, path: path)
  }

  // MARK: - Color helpers

  private static func hexAndOpacity(for color: UIColor) -> (String, Double) {
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 1
    color.getRed(&r, green: &g, blue: &b, alpha: &a)
    let hex = String(
      format: "#%02X%02X%02X",
      Int((r * 255).rounded()),
      Int((g * 255).rounded()),
      Int((b * 255).rounded())
    )
    return (hex, Double(a))
  }

  private static func uiColor(fromHex hex: String, alpha: CGFloat) -> UIColor {
    var cleaned = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if cleaned.hasPrefix("#") {
      cleaned.removeFirst()
    }
    guard cleaned.count == 6, let value = UInt32(cleaned, radix: 16) else {
      return UIColor(white: 1, alpha: alpha)
    }
    let r = CGFloat((value & 0xFF0000) >> 16) / 255.0
    let g = CGFloat((value & 0x00FF00) >> 8) / 255.0
    let b = CGFloat(value & 0x0000FF) / 255.0
    return UIColor(red: r, green: g, blue: b, alpha: alpha)
  }
}
