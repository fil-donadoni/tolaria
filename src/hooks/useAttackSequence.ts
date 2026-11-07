import { createContext, useCallback, useContext, useState } from "react";

/** Client-only "assign an attack destination to each attacker, one at a time"
 *  sequence (Arena-style), started by the "Attack with all" button when the
 *  defending player controls ≥1 planeswalker (design option B,
 *  docs/superpowers/specs/2026-07-23-attack-with-all-design.md).
 *
 *  Lives ENTIRELY in the active player's client — no `GameState` field, no
 *  serialization. Attacker declaration is not yet confirmed while the sequence
 *  runs, so the opponent never acts on the intermediate state; the only cost is
 *  no resume across a mid-sequence reload (attackers stay declared vs. the
 *  player and the user re-enters target selection). */
export type AttackSequence = {
    /** True while the player is walking attacker-by-attacker choosing targets. */
    active: boolean;
    /** Declared attacker ids in declaration order. */
    order: string[];
    /** Index of the attacker currently choosing its destination. */
    index: number;
    /** `order[index]` while active, else undefined — the attacker a
     *  planeswalker click should (re)target and the board rings. */
    currentAttackerId: string | undefined;
    /** Begin the sequence over the given declared attackers, cursor at 0. */
    begin: (order: string[]) => void;
    /** Advance the cursor by one; deactivates once past the last attacker. */
    advance: () => void;
    /** Abandon the sequence (attackers stay declared vs. the player). */
    reset: () => void;
    /** Creatures the player clicked while the defender controls a planeswalker
     *  (CR 508.1b: the attack target is chosen as part of the declaration).
     *  Client-only and NOT yet declared — or, for a declared must-attack
     *  creature (CR 508.1d), declared but about to be retargeted. They carry no
     *  combat arrow until a target click resolves them. */
    awaiting: string[];
    /** Add the creature to the awaiting set, or remove it if already there. */
    toggleAwaiting: (id: string) => void;
    /** Drop the given creatures from the awaiting set (their target landed). */
    resolveAwaiting: (ids: string[]) => void;
    /** Attackers whose target is still unchosen: the awaiting set plus the
     *  not-yet-assigned tail of the "Attack with all" sequence. These get no
     *  arrow. */
    undecidedAttackerIds: string[];
    /** True while any attacker still needs its target chosen. */
    choosingTarget: boolean;
};

/** Inactive singleton returned when no provider is mounted (tests, classic
 *  surfaces). Consumers treat `active: false` as "no sequence". */
const INACTIVE: AttackSequence = {
    active: false,
    order: [],
    index: 0,
    currentAttackerId: undefined,
    begin: () => {},
    advance: () => {},
    reset: () => {},
    awaiting: [],
    toggleAwaiting: () => {},
    resolveAwaiting: () => {},
    undecidedAttackerIds: [],
    choosingTarget: false,
};

export const AttackSequenceContext = createContext<AttackSequence | null>(null);

/** Read the shared sequence. Returns the inactive singleton (never throws) when
 *  no provider is mounted, so hooks that consume it stay usable in isolation. */
export function useAttackSequence(): AttackSequence {
    return useContext(AttackSequenceContext) ?? INACTIVE;
}

/** Owns the sequence state. Mounted by the board so all three consumers (the
 *  controller button, the click router, the current-attacker ring) share one
 *  source of truth. Auto-resets when it stops being relevant — a new
 *  DECLARE_ATTACKERS window, a confirmed declaration, or leaving the phase —
 *  keyed by `resetKey`. */
export function useAttackSequenceState(resetKey: string): AttackSequence {
    const [order, setOrder] = useState<string[]>([]);
    const [index, setIndex] = useState(0);
    const [active, setActive] = useState(false);
    const [awaiting, setAwaiting] = useState<string[]>([]);

    // Reset when the relevance key changes (setState during render — the
    // official React "adjust state when a prop changes" pattern).
    const [trackedKey, setTrackedKey] = useState(resetKey);
    if (trackedKey !== resetKey) {
        setTrackedKey(resetKey);
        setOrder([]);
        setIndex(0);
        setActive(false);
        setAwaiting([]);
    }

    const toggleAwaiting = useCallback(
        (id: string) =>
            setAwaiting((prev) =>
                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
            ),
        []
    );
    const resolveAwaiting = useCallback(
        (ids: string[]) =>
            setAwaiting((prev) => prev.filter((x) => !ids.includes(x))),
        []
    );

    const begin = useCallback((next: string[]) => {
        setOrder(next);
        setIndex(0);
        setActive(next.length > 0);
    }, []);

    // Just bump the cursor — `stillActive` below deactivates once it passes the
    // last attacker, so `advance` needn't read `order.length` from a closure.
    const advance = useCallback(() => setIndex((prev) => prev + 1), []);

    const reset = useCallback(() => {
        setAwaiting([]);
        setActive(false);
        setOrder([]);
        setIndex(0);
    }, []);

    // Derive active/current from index vs order length each render so `advance`
    // needn't read `order.length` from a stale closure.
    const stillActive = active && index < order.length;
    const currentAttackerId = stillActive ? order[index] : undefined;

    const undecidedAttackerIds = stillActive
        ? [...order.slice(index), ...awaiting]
        : awaiting;

    return {
        awaiting,
        toggleAwaiting,
        resolveAwaiting,
        undecidedAttackerIds,
        choosingTarget: undecidedAttackerIds.length > 0,
        active: stillActive,
        order,
        index,
        currentAttackerId,
        begin,
        advance,
        reset,
    };
}
