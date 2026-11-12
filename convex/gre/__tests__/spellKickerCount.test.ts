import { describe, it, expect } from "vitest";
import { resolveTopOfStack, type GameState } from "../state";
import {
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition, EffectOp } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";

/**
 * `{ spellKickerCount: { of: { target: N } } }` — how many times a TARGETED
 * spell was kicked (CR 702.33d), read off that spell's stack item as the
 * resolving spell follows its instructions (CR 608.2c).
 *
 * The permanent test of the `EffectValue` member: the value read through the
 * REAL resolution path, the kicked / unkicked / non-kicker-payment split
 * (ADR 0085), the raw Multikicker count, and the outcome through
 * `projectPublicState`.
 */

/** "Counter target spell if it was kicked [at least `times` times]." */
const counterIfKicked = (times: number): EffectOp[] => [
    {
        op: "if",
        predicate: {
            left: { spellKickerCount: { of: { target: 0 } } },
            op: "ge",
            right: times,
        },
        then: [{ op: "counter", target: { target: 0 } }],
    },
];

const COUNTER_IF_KICKED_ID = "test-counter-if-kicked";
registerTokenDefinition({
    id: COUNTER_IF_KICKED_ID,
    name: COUNTER_IF_KICKED_ID,
    rarity: "uncommon",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    effects: counterIfKicked(1),
} satisfies CardDefinition);

const COUNTER_IF_KICKED_TWICE_ID = "test-counter-if-kicked-twice";
registerTokenDefinition({
    id: COUNTER_IF_KICKED_TWICE_ID,
    name: COUNTER_IF_KICKED_TWICE_ID,
    rarity: "uncommon",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    effects: counterIfKicked(2),
} satisfies CardDefinition);

/** The spell being targeted — a vanilla sorcery owned by p2. */
const VICTIM_ID = "test-kicker-victim";
registerTokenDefinition({
    id: VICTIM_ID,
    name: VICTIM_ID,
    rarity: "common",
    manaCost: { X: 1, R: 1 },
    types: ["Sorcery"],
    effects: [{ op: "draw", player: "controller", count: 1 }],
});

function board(): GameState {
    return makeState({
        players: [makePlayer("p1"), makePlayer("p2")],
    });
}

/** p2's victim on the stack with the given payment records, p1's counter on
 *  top of it, then one resolution. */
function resolveAgainst(
    records: {
        kickerPayments?: Record<string, number>;
        unkickedCostPayments?: Record<string, number>;
    },
    counterId = COUNTER_IF_KICKED_ID
) {
    const state = board();
    const victim = pushSpell(state, VICTIM_ID, "p2");
    Object.assign(victim, records);
    pushSpell(state, counterId, "p1", [{ type: "spell", id: victim.id }]);
    resolveTopOfStack(state);
    return { state, victimId: victim.id };
}

const onStack = (state: GameState, id: string) =>
    state.stack.some((s) => s.id === id);
const inP2Graveyard = (state: GameState, id: string) =>
    state.players[1].graveyard.some((c) => c.id === id);

describe("spellKickerCount — a targeted spell's kicker count (CR 702.33d / 608.2c)", () => {
    it("a kicked target is countered", () => {
        const { state, victimId } = resolveAgainst({
            kickerPayments: { kicker: 1 },
        });
        expect(onStack(state, victimId)).toBe(false);
        expect(inP2Graveyard(state, victimId)).toBe(true);
    });

    it("an unkicked target stays on the stack — the spell resolves and does nothing", () => {
        const { state, victimId } = resolveAgainst({});
        expect(onStack(state, victimId)).toBe(true);
        expect(state.stack).toHaveLength(1);
    });

    it("a non-kicker additional cost (offspring, replicate) is not a kick (ADR 0085)", () => {
        const { state, victimId } = resolveAgainst({
            unkickedCostPayments: { offspring: 1 },
        });
        expect(onStack(state, victimId)).toBe(true);
    });

    it("reads the raw count: a Multikicker paid twice clears a `ge 2` gate, once does not (CR 702.33e)", () => {
        const once = resolveAgainst(
            { kickerPayments: { kicker: 1 } },
            COUNTER_IF_KICKED_TWICE_ID
        );
        expect(onStack(once.state, once.victimId)).toBe(true);
        const twice = resolveAgainst(
            { kickerPayments: { kicker: 2 } },
            COUNTER_IF_KICKED_TWICE_ID
        );
        expect(onStack(twice.state, twice.victimId)).toBe(false);
    });

    it("the outcome survives the wire projection", () => {
        const kicked = resolveAgainst({ kickerPayments: { kicker: 1 } });
        const projected = projectPublicState(kicked.state, 1, "p1");
        expect(projected.stack.some((s) => s.id === kicked.victimId)).toBe(
            false
        );
        expect(
            projected.players[1].graveyard.some((c) => c.id === kicked.victimId)
        ).toBe(true);

        const unkicked = resolveAgainst({});
        const projectedUnkicked = projectPublicState(unkicked.state, 1, "p1");
        expect(
            projectedUnkicked.stack.some((s) => s.id === unkicked.victimId)
        ).toBe(true);
    });
});
