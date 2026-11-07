import { vi } from "vitest";
import type { AttackSequence } from "~/hooks/useAttackSequence";

/** A hand-built {@link AttackSequence} for hook tests: the derived fields
 *  (`undecidedAttackerIds`, `choosingTarget`) follow the overrides the way the
 *  real `useAttackSequenceState` computes them. Defaults to the inactive
 *  sequence with nothing awaiting. */
export function makeAttackSequence(
    overrides: Partial<AttackSequence> = {}
): AttackSequence {
    const base: AttackSequence = {
        active: false,
        order: [],
        index: 0,
        currentAttackerId: undefined,
        begin: vi.fn(),
        advance: vi.fn(),
        reset: vi.fn(),
        awaiting: [],
        toggleAwaiting: vi.fn(),
        resolveAwaiting: vi.fn(),
        undecidedAttackerIds: [],
        choosingTarget: false,
        ...overrides,
    };
    if (overrides.undecidedAttackerIds === undefined) {
        base.undecidedAttackerIds = [
            ...(base.active ? base.order.slice(base.index) : []),
            ...base.awaiting,
        ];
    }
    if (overrides.choosingTarget === undefined) {
        base.choosingTarget = base.undecidedAttackerIds.length > 0;
    }
    return base;
}
