import ExpoModulesCore
import PencilKit

/**
 * GraphitePencilKitModule
 *
 * Registers the native PKCanvasView-backed view with Expo. The view exposes:
 *   - Prop `initialStrokes`: `[[String: Any]]` — our InkStroke[] shape, loaded
 *     on first mount and whenever the note switches.
 *   - Event `onStrokesChanged`: fired after the user lifts their pencil. The
 *     payload is the full drawing re-serialized to our InkStroke[] shape, so
 *     the JS side can hand it directly to `updateNoteCanvas`.
 *
 * The Swift <-> JS bridging of individual strokes happens here. PencilKit's
 * own `PKDrawing.dataRepresentation()` is an opaque blob; we intentionally
 * avoid it so Graphite's canvas_json schema stays human-readable and
 * cross-platform compatible.
 */
public class GraphitePencilKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("GraphitePencilKit")

    View(GraphitePencilKitView.self) {
      Events("onStrokesChanged")

      Prop("initialStrokes") { (view: GraphitePencilKitView, strokes: [[String: Any]]) in
        view.loadInitialStrokes(strokes)
      }
    }
  }
}
