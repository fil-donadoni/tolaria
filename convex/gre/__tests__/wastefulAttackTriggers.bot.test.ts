// `isWastefulAttack` counts the value the declaration's own trigger batch
// produces (CR 508.1m, 508.2): an attack that kills nothing and deals no
// damage is still worth making when an attack trigger or a "becomes tapped"
// payoff nets the attacker something, and still wasteful when the batch
// hurts the attacker or helps only the defender. Derived from the Effect
// Script valuation, never from a card list (ADR 0102).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { isWastefulAttack } from "../search";
import type { Move } from "../moves";
import type { GameState } from "../state";

const MAGDA = getCardByName("Magda, Brazen Outlaw");
const DWARF = "ea9a38b1-4676-425a-b40d-4fb478966024";
const TAMIYO = getCardByName("Tamiyo, Inquisitive Student");
const SPIDER = getCardByName("Giant Spider").id; // 2/4 reach
const IRONROOT = getCardByName("Ironroot Treefolk").id; // 3/5

const mk = (cardId: string, id: string, controllerId: string) =>
    makeInstance(cardId, {
        id,
        controllerId,
        ownerId: controllerId,
        isSummoningSick: false,
    });

function attackState(
    mine: ReturnType<typeof mk>[],
    theirs: ReturnType<typeof mk>[]
): GameState {
    return makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: mine }),
            makePlayer("p2", { battlefield: theirs }),
        ],
        combat: {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

const swing = (...attackerIds: string[]): Move => ({
    kind: "declare-attackers",
    attackerIds,
});

describe("isWastefulAttack — the declaration's trigger value (issue #3788)", () => {
    // 0-power flier into a reach blocker: no damage, no dead blocker — only
    // the "attacks, investigate" trigger can make this attack worth making.
    const tamiyoBoard = () =>
        attackState(
            [mk(TAMIYO.id, "tamiyo", "p1")],
            [mk(SPIDER, "spider", "p2")]
        );

    it("does NOT fire when an attack trigger nets the attacker value", () => {
        expect(isWastefulAttack(tamiyoBoard(), swing("tamiyo"))).toBe(false);
    });

    it("FIRES when the same attacker has no attack trigger", () => {
        const bare: CardDefinition = { ...TAMIYO, triggeredAbilities: [] };
        withTemporaryDefinition(bare, () => {
            expect(isWastefulAttack(tamiyoBoard(), swing("tamiyo"))).toBe(true);
        });
    });

    it("FIRES when the attacker's own trigger hands the opponent a card", () => {
        const hostile: CardDefinition = {
            ...TAMIYO,
            triggeredAbilities: TAMIYO.triggeredAbilities!.map((t) => ({
                ...t,
                effects: [{ op: "draw", player: "opponent", count: 1 }],
            })),
        };
        withTemporaryDefinition(hostile, () => {
            expect(isWastefulAttack(tamiyoBoard(), swing("tamiyo"))).toBe(true);
        });
    });

    it("FIRES when only the defender's trigger fires on the attack", () => {
        const punisher: CardDefinition = {
            ...getCardByName("Giant Spider"),
            triggeredAbilities: [
                {
                    id: "punisher-on-attack",
                    oracleText: "Whenever a creature attacks, draw a card.",
                    event: "ATTACKERS_DECLARED",
                    matches: (event) => event.type === "ATTACKERS_DECLARED",
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        };
        withTemporaryDefinition(punisher, () => {
            const bare: CardDefinition = { ...TAMIYO, triggeredAbilities: [] };
            withTemporaryDefinition(bare, () => {
                expect(isWastefulAttack(tamiyoBoard(), swing("tamiyo"))).toBe(
                    true
                );
            });
        });
    });

    it("does NOT fire on a tap payoff: Magda's Dwarves make Treasures when they attack", () => {
        const state = attackState(
            [mk(MAGDA.id, "magda", "p1"), mk(DWARF, "dwarf", "p1")],
            [mk(IRONROOT, "wall", "p2")]
        );
        // Magda alone would die to the 3/5; only the Dwarf's swing is under
        // test, and it makes a Treasure on tapping.
        expect(isWastefulAttack(state, swing("dwarf"))).toBe(false);
    });

    it("does NOT fire when two distinct triggers wait on an ordering choice (CR 603.3b)", () => {
        // Magda's tap payoff beside an attack trigger on the same controller:
        // the batch is held in `pendingTriggerBatch`, not on the stack.
        const both: CardDefinition = {
            ...TAMIYO,
            subtypes: [...(TAMIYO.subtypes ?? []), "Dwarf"],
        };
        withTemporaryDefinition(both, () => {
            const state = attackState(
                [mk(MAGDA.id, "magda", "p1"), mk(TAMIYO.id, "tamiyo", "p1")],
                [mk(SPIDER, "spider", "p2")]
            );
            expect(isWastefulAttack(state, swing("tamiyo"))).toBe(false);
        });
    });
});
