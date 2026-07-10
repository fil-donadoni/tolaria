import { createContext, useContext, useState } from "react";
import type { PendingTarget } from "~/types/game";

/** Shared "divide as you choose" stepper state (CR 601.2d / 120.4). A spell
 *  whose `pendingTarget.divideTotal` is set (Pyrokinesis's 4 damage, Fire
 *  Covenant / Meteor Shower's X, Fiery Justice's 5) divides that budget among
 *  the targets the player clicks, each getting the `amount` the stepper holds
 *  when they click. The server (`selectTarget`'s `amount` arg) records the
 *  split into `pendingTarget.divideAmounts` and auto-finalizes once the whole
 *  budget is spent; when the client sends NO amount the server falls back to a
 *  deterministic ≥1-each EQUAL split — which is exactly the bug this stepper
 *  removes. Mounted once at the board root so the banner (which sets the
 *  amount) and the battlefield / player click sites (which send it) share one
 *  source of truth, mirroring `PendingChoiceBufferContext`. */
export type DivideAmount = {
    /** True while the viewer is assigning a divide-as-you-choose split. */
    active: boolean;
    /** Points to assign to the NEXT clicked target. Always clamped to
     *  `[1, remaining]` (0 only when nothing is left). */
    amount: number;
    /** Budget still unassigned: `divideTotal − sum(divideAmounts)`. */
    remaining: number;
    /** Set the next-target amount; the value is clamped to `[1, remaining]`. */
    setAmount: (n: number) => void;
};

export const DivideAmountContext = createContext<DivideAmount | null>(null);

/** Budget still unassigned for a divide spell: `divideTotal` minus the sum of
 *  the per-target amounts already committed. `0` for a non-divide selection. */
export function computeRemaining(pt: PendingTarget | undefined): number {
    if (!pt || pt.divideTotal === undefined) return 0;
    const spent = pt.divideAmounts
        ? Object.values(pt.divideAmounts).reduce((a, b) => a + b, 0)
        : 0;
    return Math.max(0, pt.divideTotal - spent);
}

/** Clamp a requested amount into the legal `[1, remaining]` range (CR 601.2d —
 *  each target gets at least 1, and never more than the budget left). Collapses
 *  to `0` only when the budget is exhausted. */
export function clampAmount(n: number, remaining: number): number {
    if (remaining <= 0) return 0;
    return Math.min(Math.max(1, n), remaining);
}

/** Identity of the current divide selection — the source spell plus how much
 *  budget remains. Changes when a new divide spell begins OR after each
 *  committed target (the running sum grew), which re-seeds the stepper. */
function divideStateKey(pt: PendingTarget | undefined): string | null {
    if (!pt || pt.divideTotal === undefined) return null;
    return `${pt.cardInstanceId}:${pt.divideTotal}:${computeRemaining(pt)}`;
}

/** Raw stepper state, owned by the board root. Viewer-agnostic: it only tracks
 *  the pending amount and re-seeds it whenever the divide identity changes (a
 *  new spell, or a target just committed so `remaining` shrank). The board
 *  assembles the viewer-aware {@link DivideAmount} from this — see
 *  `useDivideAmount`. */
export function useDivideAmountState(
    pendingTarget: PendingTarget | undefined
): {
    rawAmount: number;
    setRawAmount: (n: number) => void;
} {
    const [rawAmount, setRawAmount] = useState(1);

    // Re-seed on identity/budget change (render-time "adjust state on prop
    // change" pattern, same as usePendingChoiceBufferState — no useEffect). Seed
    // to 1 normally, or to the whole remainder when only one point is left so a
    // single click finishes.
    const key = divideStateKey(pendingTarget);
    const [trackedKey, setTrackedKey] = useState<string | null>(key);
    if (trackedKey !== key) {
        setTrackedKey(key);
        const remaining = computeRemaining(pendingTarget);
        setRawAmount(remaining <= 1 ? Math.max(1, remaining) : 1);
    }

    return { rawAmount, setRawAmount };
}

/** Inert value when no provider is mounted (isolated component tests, or any
 *  render outside the board root). A divide selection is never `active`, so the
 *  click sites fall through to their plain non-divide `selectTarget` dispatch —
 *  the feature is purely additive. The board always mounts the real provider. */
const INERT_DIVIDE: DivideAmount = {
    active: false,
    amount: 1,
    remaining: 0,
    setAmount: () => {},
};

export function useDivideAmount(): DivideAmount {
    return useContext(DivideAmountContext) ?? INERT_DIVIDE;
}
