import { createContext, useCallback, useContext, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingTarget } from "~/types/game";
import { extractMutationError, type MutationError } from "~/lib/mutation-error";

/** Client-buffered "divide as you choose" distribution (CR 601.2d / 120.4).
 *
 *  A spell whose `pendingTarget.divideTotal` is set (Pyrokinesis's 4 damage,
 *  Fire Covenant / Meteor Shower's X, Fiery Justice's 5) divides that budget
 *  among the targets the player picks, each getting ≥ 1. The chosen interaction
 *  (prototype variant B): every legal target carries an on-card `[−] N [+]`
 *  stepper; the player dials each target's share independently and freely; a
 *  "Done" finalizes when the whole budget is assigned.
 *
 *  The distribution is held LOCALLY here (nothing hits the server until Done),
 *  mirroring {@link usePendingChoiceBuffer}. On Done, `submit` fires the
 *  fully-validated `selectTarget({amount})` mutation ONCE per assigned target;
 *  the final call brings the server's running divide sum to `divideTotal` and
 *  the engine auto-finalizes (CR 601.2d). Priority is held throughout target
 *  selection, so the sequence is effectively atomic — and it reuses the
 *  canonical per-target legality validation instead of duplicating it. */
type DivideEntry = { type: "permanent" | "player"; n: number };

export type DivideBuffer = {
    /** True while THIS viewer is assigning a divide split (set by the board,
     *  which knows the viewer; the raw state hook reports the spell-level
     *  flag and the board narrows it to the chooser). */
    active: boolean;
    /** The budget to divide (`divideTotal`). */
    total: number;
    /** Points assigned so far across all targets. */
    sum: number;
    /** Budget still unassigned: `total − sum`. */
    remaining: number;
    /** Points currently assigned to `id` (0 if none). */
    get: (id: string) => number;
    /** Add one point to `id` (no-op when the budget is spent). `type`
     *  distinguishes a battlefield permanent from a player target so the
     *  finalizing `selectTarget` uses the right `targetType`. */
    inc: (id: string, type: "permanent" | "player") => void;
    /** Remove one point from `id` (drops it entirely at 0). */
    dec: (id: string) => void;
    /** Whole budget assigned across ≥1 target — "Done" is legal. */
    canSubmit: boolean;
    /** Commit the distribution (see the sequential `selectTarget` note above). */
    submit: () => Promise<void>;
    /** True between submit dispatch and its resolution — gate action buttons. */
    isPending: boolean;
    /** Last submission error, for the shared toast. */
    lastError: MutationError | null;
    dismissError: () => void;
};

export const DivideBufferContext = createContext<DivideBuffer | null>(null);

/** Sum of a buffer's assigned points. */
function bufferSum(buffer: Record<string, DivideEntry>): number {
    return Object.values(buffer).reduce((a, e) => a + e.n, 0);
}

/** Identity of the current divide selection — keyed ONLY on the source spell +
 *  its total, NOT on `selected` / `divideAmounts`. The sequential `selectTarget`
 *  calls fired at submit grow those server fields; keying on them would reset
 *  the local buffer mid-submit. Resets when a new divide spell begins or the
 *  selection finalizes (`pendingTarget` → undefined). */
function divideKey(pt: PendingTarget | undefined): string | null {
    if (!pt || pt.divideTotal === undefined) return null;
    return `${pt.cardInstanceId}:${pt.divideTotal}`;
}

/** Inert value when no provider is mounted (isolated component tests, or any
 *  render outside the board root). Never `active`, so the click sites fall
 *  through to their plain non-divide behaviour — purely additive. */
const INERT_DIVIDE: DivideBuffer = {
    active: false,
    total: 0,
    sum: 0,
    remaining: 0,
    get: () => 0,
    inc: () => {},
    dec: () => {},
    canSubmit: false,
    submit: async () => {},
    isPending: false,
    lastError: null,
    dismissError: () => {},
};

/** Owns the local distribution buffer for the active divide selection. Mounted
 *  once at the board root so the on-card steppers (which dial it) and the banner
 *  "Done" (which submits it) share one source of truth. Viewer-agnostic: reports
 *  `active` at the spell level; the board narrows it to the chooser. */
export function useDivideBufferState(args: {
    gameId: Id<"games">;
    pendingTarget: PendingTarget | undefined;
}): DivideBuffer {
    const { gameId, pendingTarget } = args;
    const [buffer, setBuffer] = useState<Record<string, DivideEntry>>({});
    const [isPending, setIsPending] = useState(false);
    const [lastError, setLastError] = useState<MutationError | null>(null);
    const selectTarget = useMutation(api.game.selectTarget);

    // Reset the buffer when the divide selection identity changes (render-time
    // "adjust state on prop change" pattern, same as usePendingChoiceBufferState
    // — no useEffect).
    const key = divideKey(pendingTarget);
    const [trackedKey, setTrackedKey] = useState<string | null>(key);
    if (trackedKey !== key) {
        setTrackedKey(key);
        setBuffer({});
        setLastError(null);
    }

    const active = key !== null;
    const total =
        active && pendingTarget ? (pendingTarget.divideTotal ?? 0) : 0;
    const sum = bufferSum(buffer);
    const remaining = Math.max(0, total - sum);

    const get = useCallback((id: string) => buffer[id]?.n ?? 0, [buffer]);

    const inc = useCallback(
        (id: string, type: "permanent" | "player") => {
            setBuffer((prev) => {
                if (total - bufferSum(prev) <= 0) return prev; // budget spent
                const cur = prev[id]?.n ?? 0;
                return { ...prev, [id]: { type, n: cur + 1 } };
            });
        },
        [total]
    );

    const dec = useCallback((id: string) => {
        setBuffer((prev) => {
            const cur = prev[id]?.n ?? 0;
            if (cur <= 0) return prev;
            const next = { ...prev };
            if (cur - 1 <= 0) delete next[id];
            else next[id] = { type: prev[id].type, n: cur - 1 };
            return next;
        });
    }, []);

    const canSubmit =
        active && total > 0 && sum === total && Object.keys(buffer).length > 0;

    const submit = useCallback(async () => {
        if (!pendingTarget || isPending) return;
        if (
            !(
                pendingTarget.divideTotal !== undefined &&
                total > 0 &&
                bufferSum(buffer) === total &&
                Object.keys(buffer).length > 0
            )
        ) {
            return;
        }
        setIsPending(true);
        try {
            // Fire the fully-validated selectTarget once per assigned target;
            // the final call brings the server's running divide sum to
            // `divideTotal` and the engine auto-finalizes (CR 601.2d).
            for (const [id, entry] of Object.entries(buffer)) {
                await selectTarget({
                    gameId,
                    playerId: pendingTarget.playerId,
                    targetType: entry.type,
                    targetId: id,
                    amount: entry.n,
                });
            }
        } catch (e) {
            setLastError(extractMutationError(e));
        } finally {
            setIsPending(false);
        }
    }, [pendingTarget, isPending, buffer, total, gameId, selectTarget]);

    const dismissError = useCallback(() => setLastError(null), []);

    return {
        active,
        total,
        sum,
        remaining,
        get,
        inc,
        dec,
        canSubmit,
        submit,
        isPending,
        lastError,
        dismissError,
    };
}

export function useDivideBuffer(): DivideBuffer {
    return useContext(DivideBufferContext) ?? INERT_DIVIDE;
}
