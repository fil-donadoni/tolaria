// PROTOTYPE route (/prototype/put-back) — Brainstorm "put back 2 on top" picker.
// Mounts the REAL LibraryOrderPicker (distribute mode) with a mocked hand as the
// left pool, proving the target shape: single TOP drop zone with internal
// drag-reorder (right = top). Throwaway (see NOTES.md); delete once the `putBack`
// mode + wiring land.
import VariantA from "./variant-a";

export default function PrototypePutBackRoute() {
    return <VariantA />;
}
