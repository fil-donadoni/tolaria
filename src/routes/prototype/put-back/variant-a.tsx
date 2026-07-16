// PROTOTYPE Variant A — the REAL LibraryOrderPicker, proving the target shape:
// left zone = HAND pool, ONE right zone = TOP of library (single drop area with
// internal drag-reorder, right = top, higher z + lateral offset). This is the
// existing scry/surveil/distribute mechanic with the left zone repurposed as the
// hand — exactly "put 2 hand cards on top, reorder by dragging".
//
// Mounted here via `distribute={{ keep: 2 }}`: every card starts in the LEFT
// (pool) zone, pull exactly 2 into the RIGHT (top) zone, reorder within it. The
// only cosmetic delta vs the real feature is the zone labels — distribute mode
// hardcodes BOTTOM/HAND; the shipped `putBack` mode will read HAND / TOP OF
// LIBRARY. Interaction + drag-reorder are identical. Throwaway.
import LibraryOrderPicker from "~/components/board/library-order/library-order-picker";
import {
    MinimizedChoiceContext,
    useMinimizedChoiceState,
} from "~/hooks/useMinimizedChoice";
import { MOCK_HAND, PUT_BACK_COUNT, PROMPT } from "./mock-data";

export default function VariantA() {
    // The real picker calls useMinimizedChoice(); provide the context it expects
    // (the board normally mounts it). No active choice → never minimized.
    const minimized = useMinimizedChoiceState(undefined);
    return (
        <MinimizedChoiceContext.Provider value={minimized}>
            <LibraryOrderPicker
            lookedAt={MOCK_HAND.map((c) => ({
                instanceId: c.instanceId,
                defId: c.defId,
            }))}
            destination="none"
            prompt={`${PROMPT} (prototype: left zone = HAND, right zone = TOP — labels say BOTTOM/HAND here only because it borrows distribute mode)`}
            submitting={false}
            distribute={{ keep: PUT_BACK_COUNT }}
            onConfirm={(topTopmostFirst) => {
                // Inert — the shipped picker submits this as the ordered
                // choose-hand-card picks (topmost first).
                // eslint-disable-next-line no-console
                console.log("put on top (topmost first):", topTopmostFirst);
            }}
            />
        </MinimizedChoiceContext.Provider>
    );
}
