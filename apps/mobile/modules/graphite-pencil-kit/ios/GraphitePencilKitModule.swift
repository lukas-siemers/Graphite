import ExpoModulesCore
import PencilKit
import UIKit

/**
 * GraphitePencilKitModule (Stage 2 — extractor-only)
 *
 * This module exposes a single `extractStrokes(base64)` AsyncFunction used to
 * convert an opaque `PKDrawing.dataRepresentation()` base64 blob into a
 * structured array of stroke dicts that match `packages/db/src/canvas-schema.ts`
 * (`CanvasSchemaV1.inkStrokeSchema`). The whole-drawing blob still lives at
 * `inkLayer.pkDrawingBase64` for iPad re-edit fidelity; the returned strokes[]
 * are the cross-platform render source.
 *
 * IMPORTANT — no view registration:
 * This module intentionally does NOT register a View. The drawing surface is
 * owned by `react-native-pencil-kit`'s Fabric view. Adding a second view
 * registration here re-introduces the "Unimplemented component" / Fabric
 * codegen collision that was fixed in commits af777bf and 3bb986d. If you
 * need a custom drawing view, create a separate module — do not extend this
 * one.
 *
 * Threading notes (see MEMORY: feedback_turbomodule_threading_crash):
 * AsyncFunction runs on the ExpoModules queue, not the RN TurboModule JS
 * thread, so the void-method Hermes GC crash pattern does not apply here.
 * All work must finish before we resolve the promise — no dispatch into
 * other queues without blocking on the result.
 *
 * Field mapping (PKStrokePoint -> schema) is documented on the call sites
 * below. Notable choices:
 *   - `pressure` = PKStrokePoint.force, clamped to [0, 1]
 *   - `timeOffset` = PKStrokePoint.timeOffset * 1000 (seconds -> ms)
 *   - `azimuth`, `altitude` stay in radians (the schema is radians-native)
 *   - `color` is "#RRGGBB" hex; alpha is dropped here because the schema has
 *     no opacity field
 *   - `width` = stroke.path.first?.size.width (base width); per-point width
 *     variation is carried through `pressure`
 *   - `tool` maps `PKInkType` to the schema enum. Unknown types fall back to
 *     "pen" so we never emit invalid data.
 *
 * IDs: nanoid is done on the JS side (per task spec) — we emit strokes
 * without an `id` field and the TS adapter fills one in.
 */
public class GraphitePencilKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("GraphitePencilKit")

    AsyncFunction("extractStrokes") { (base64: String) -> [[String: Any]] in
      guard let data = Data(base64Encoded: base64) else {
        throw Exception(
          name: "InvalidBase64",
          description: "extractStrokes received a base64 string that could not be decoded."
        )
      }

      let drawing: PKDrawing
      do {
        drawing = try PKDrawing(data: data)
      } catch {
        throw Exception(
          name: "InvalidPKDrawing",
          description: "PKDrawing could not parse the decoded data: \(error.localizedDescription)"
        )
      }

      return drawing.strokes.map { GraphitePencilKitModule.serializeStroke($0) }
    }
  }

  // MARK: - Stroke serialization

  private static func serializeStroke(_ stroke: PKStroke) -> [String: Any] {
    var points: [[String: Any]] = []
    points.reserveCapacity(stroke.path.count)

    for i in 0..<stroke.path.count {
      let p = stroke.path[i]
      var point: [String: Any] = [
        "x": Double(p.location.x),
        "y": Double(p.location.y),
        // force is 0 for non-Pencil input; clamp defensively to [0, 1].
        "pressure": max(0.0, min(1.0, Double(p.force))),
        // timeOffset is seconds relative to stroke start; schema wants ms.
        "timeOffset": Double(p.timeOffset) * 1000.0
      ]

      // azimuth/altitude are optional in the schema. Emit them when they
      // look meaningful (non-zero) to avoid noise from finger input where
      // PKStrokePoint reports 0 for both. Zero is legal radians but in
      // practice it means "no tilt data".
      let azimuth = Double(p.azimuth)
      let altitude = Double(p.altitude)
      if azimuth != 0.0 {
        point["azimuth"] = azimuth
      }
      if altitude != 0.0 {
        point["altitude"] = altitude
      }

      points.append(point)
    }

    let ink = stroke.ink
    let color = hexString(for: ink.color)
    let tool = toolName(for: ink.inkType)
    let width = stroke.path.first.map { Double($0.size.width) } ?? 3.0

    return [
      // Matches the v1 inkStrokeSchema shape. `id` is intentionally omitted
      // here — the JS adapter generates it via nanoid.
      "points": points,
      "color": color,
      "width": width,
      "tool": tool,
      "anchor": [
        "type": "absolute",
        "x": 0,
        "y": 0
      ] as [String: Any]
    ]
  }

  // MARK: - Helpers

  private static func hexString(for color: UIColor) -> String {
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 1
    color.getRed(&r, green: &g, blue: &b, alpha: &a)
    return String(
      format: "#%02X%02X%02X",
      Int((r * 255).rounded()),
      Int((g * 255).rounded()),
      Int((b * 255).rounded())
    )
  }

  /**
   * Maps `PKInkType` to the schema's `StrokeTool` enum.
   *   .pen        -> "pen"
   *   .pencil     -> "pencil"
   *   .marker     -> "marker"
   *   .crayon     -> "highlighter"  (closest match; crayon isn't in the enum)
   *   .watercolor -> "marker"       (closest match; watercolor isn't either)
   *   anything else -> "pen"        (safe default, prevents Zod failures)
   *
   * Eraser strokes never surface here — PencilKit applies the eraser to the
   * drawing before `strokes` is populated, so we only see the surviving ink.
   */
  private static func toolName(for inkType: PKInkType) -> String {
    switch inkType {
    case .pen:
      return "pen"
    case .pencil:
      return "pencil"
    case .marker:
      return "marker"
    default:
      break
    }

    // PKInkType gained .crayon (iOS 17) and .watercolor (iOS 17+) after our
    // minimum deployment target bumped. We handle them by string so the
    // build stays compatible with older SDKs.
    let asString = String(describing: inkType).lowercased()
    if asString.contains("crayon") {
      return "highlighter"
    }
    if asString.contains("watercolor") {
      return "marker"
    }
    return "pen"
  }
}
