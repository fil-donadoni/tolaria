// PROTOTYPE Variant A — the REAL LibraryOrderPicker in `putBack` mode, proving
// the target shape: left zone = HAND pool, ONE right zone = TOP OF LIBRARY
// (single drop area with internal drag-reorder, right = top, higher z + lateral
// offset). Same scry/surveil mechanic with the left zone repurposed as the hand
// — "put 2 hand cards on top, reorder by dragging". The top zone is hard-capped
// at 2. Throwaway — the real feature mounts this exact mode from the board.
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
                prompt={PROMPT}
                submitting={false}
                putBack={{ keep: PUT_BACK_COUNT }}
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
