import { useCallback, useEffect, useRef, useState } from "react";

/** Marker attribute an element outside the staged card's DOM subtree carries to
 *  count as "part of the stage" for tap-away detection. The confirm affordance
 *  is rendered through a portal (the hand strip clips the band above it — the
 *  same reason the drag lift is clamped, #271 fix 4), so it is NOT a DOM
 *  descendant of the card; without this marker the pointerdown that presses the
 *  pill would read as a tap-away, un-stage the card and unmount the pill BEFORE
 *  its click ever fired. */
export const TAP_STAGE_KEEP_ATTR = "data-tap-stage-keep";

export type TapStageConfirm = {
    /** True while the card is staged — the caller lifts it and renders the
     *  confirm affordance. Always false for a mouse/pen pointer. */
    staged: boolean;
    /** Wire alongside the card's own `onPointerDown` — records the pointer type
     *  of the gesture the next click belongs to. */
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    /** Called from the card's click handler at the point it would commit.
     *
     *  Returns `true` when the click was CONSUMED by staging — the caller must
     *  not commit. Returns `false` when the caller should commit right now:
     *  every mouse/pen click (behaviour byte-identical to before this hook
     *  existed) and the second touch tap on an already-staged card. */
    consumeClick: () => boolean;
    /** Clear the stage without committing (drag start, external cancel). */
    unstage: () => void;
};

/** Touch-only "tap = stage, tap again = confirm" gate for a play/cast
 *  affordance (issue #1767, parent #1758).
 *
 * On a touch pointer a hand card is one accidental brush away from being cast:
 * the tap dispatched the mutation immediately, with no undo. This hook inserts
 * a confirmation step for touch pointers ONLY — the first tap stages the card
 * (the caller lifts it and shows a confirm affordance), the second tap on the
 * card or on that affordance commits, and a tap anywhere else cancels.
 *
 * **Mouse and pen are untouched.** `consumeClick` returns `false` on the first
 * call for any `pointerType` other than `"touch"`, so a desktop click still
 * commits on the first click through exactly the same code path as before. The
 * discrimination is made from the `pointerdown` that precedes the click, not
 * from the click itself (a synthetic `click` carries no `pointerType` in every
 * engine, and React types it as a MouseEvent) — a click with no preceding
 * pointerdown therefore reads as non-touch and commits, which is the safe
 * default for programmatic clicks.
 *
 * **No stale stage.** The stage is local, optimistic UI state over a card that
 * the server can move out from under it at any moment. It is dropped whenever
 * `enabled` goes false (the card lost its legal play/cast) and whenever
 * `resetKey` changes — the caller passes a digest of the game state the staged
 * action depends on (priority, phase, turn, the card's zone and legal actions,
 * any pending cast/target). A card that leaves the hand unmounts its component
 * outright, which drops the stage with it. */
export function useTapStageConfirm(opts: {
    /** Whether a commit is currently possible at all. False un-stages. */
    enabled: boolean;
    /** Digest of the game state the staged action depends on; any change
     *  un-stages (no stale stage across priority/zone/turn changes). */
    resetKey: string;
    /** The element whose taps stage/confirm (the card root) — owned by the
     *  caller, which also needs it as the confirm affordance's anchor. Bounds
     *  tap-away detection: a press inside it is never a cancel. */
    rootRef: React.RefObject<HTMLElement | null>;
}): TapStageConfirm {
    const { enabled, resetKey, rootRef } = opts;
    const [staged, setStaged] = useState(false);
    /** `pointerType` of the gesture the pending click belongs to. */
    const pointerTypeRef = useRef<string>("");

    const unstage = useCallback(() => setStaged(false), []);

    const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
        pointerTypeRef.current = e.pointerType;
    }, []);

    const consumeClick = useCallback((): boolean => {
        if (!enabled) return false;
        // Mouse / pen: commit on the first click, exactly as before this hook
        // existed. Clearing a stage a previous touch tap left behind is the
        // only thing that changes for them, and it costs them nothing.
        if (pointerTypeRef.current !== "touch") {
            if (staged) setStaged(false);
            return false;
        }
        if (staged) {
            setStaged(false);
            return false;
        }
        setStaged(true);
        return true;
    }, [enabled, staged]);

    // The card lost its legal action, or the game state the stage depends on
    // moved → the staged action is no longer the action the player staged.
    // Adjusted DURING render (React's "adjusting state when a prop changes"
    // pattern) rather than in an effect: an effect would render one frame with
    // the card still lifted over an action that no longer exists, and would
    // cascade a second render to take it back.
    const guard = `${enabled ? "1" : "0"}|${resetKey}`;
    const [lastGuard, setLastGuard] = useState(guard);
    if (lastGuard !== guard) {
        setLastGuard(guard);
        if (staged) setStaged(false);
    }

    // Tap-away cancels. Listens in the CAPTURE phase so a target that stops
    // propagation (a menu, an overlay) can't wedge the stage open, and exempts
    // both the card's own subtree and any portal'd part of the stage.
    useEffect(() => {
        if (!staged) return;
        const onDocPointerDown = (e: PointerEvent) => {
            const target = e.target;
            if (!(target instanceof Node)) return;
            if (rootRef.current?.contains(target)) return;
            const el =
                target instanceof Element ? target : target.parentElement;
            if (el?.closest(`[${TAP_STAGE_KEEP_ATTR}]`)) return;
            setStaged(false);
        };
        document.addEventListener("pointerdown", onDocPointerDown, true);
        return () =>
            document.removeEventListener("pointerdown", onDocPointerDown, true);
    }, [staged, rootRef]);

    return { staged, onPointerDown, consumeClick, unstage };
}
