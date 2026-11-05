// Ingest (CR 702.115): the `getDefinition` expansion seam, real combat damage
// through `applyAllCombatDamage`, the trigger scan, resolution through
// `resolveTopOfStack`, the wire projection, and the compiler's verdict on a
// printed and on a granted ingest.

import { describe, expect, it } from "vitest";
import { projectPublicState } from "../../../gameProjections";
import { validateAbilityEffectScript } from "../../../gre/effects/validate";
import { applyAllCombatDamage } from "../../../gre/phases";
import type { GameState } from "../../../gre/state";
import { checkStateBasedActions } from "../../../gre/sba";
import { resolveTopOfStack } from "../../../gre/state";
import { collectTriggers, placeTriggersOnStack } from "../../../gre/triggers";
import { oracleCard } from "../../../oracle/__tests__/oracle.fixture";
import { compileCard } from "../../../oracle/compile";
import { getDefinition, preloadDefinitions } from "../..";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../__tests__/setup.helper";
import type { CardDefinition } from "../../types";
import {
    INGEST_ORACLE_TEXT,
    INGEST_TRIGGER_ID,
    ingestTrigger,
} from "../ingest";

/** Registers a creature so `getDefinition` runs it through the real expansion
 *  chain, the seam a printed card uses. */
function registerCreature(
    id: string,
    staticAbilities: string[],
    power = 2,
    toughness = 2
): string {
    preloadDefinitions([
        {
            id,
            name: `Synthetic ${id}`,
            rarity: "common",
            manaCost: { X: 2 },
            types: ["Creature"],
            subtypes: [],
            power,
            toughness,
            staticAbilities,
        } as CardDefinition,
    ]);
    return id;
}

const INGEST = registerCreature("synthetic-ingest", ["ingest"]);
const DOUBLE_INGEST = registerCreature("synthetic-double-ingest", [
    "ingest",
    "ingest",
]);
const FRAGILE_TRAMPLER = registerCreature(
    "synthetic-ingest-trampler",
    ["ingest", "trample"],
    6,
    1
);
const VANILLA = registerCreature("synthetic-ingest-vanilla", [], 3, 5);

function library(owner: string, count: number) {
    return Array.from({ length: count }, (_, i) =>
        makeInstance(VANILLA, {
            id: `${owner}-lib-${i}`,
            controllerId: owner,
            ownerId: owner,
            zone: "library",
        })
    );
}

/** p1's `attackerDef` attacking p2, optionally blocked by p2's 3/5. */
function combat(opts: {
    attackerDef: string;
    blocked?: boolean;
    p1Library?: number;
    p2Library?: number;
}): GameState {
    return makeState({
        phase: "COMBAT_DAMAGE",
        activePlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(opts.attackerDef, {
                        id: "attacker",
                        controllerId: "p1",
                        ownerId: "p1",
                        isAttacking: true,
                    }),
                ],
                library: library("p1", opts.p1Library ?? 3),
            }),
            makePlayer("p2", {
                battlefield: opts.blocked
                    ? [
                          makeInstance(VANILLA, {
                              id: "blocker",
                              controllerId: "p2",
                              ownerId: "p2",
                              isBlocking: true,
                          }),
                      ]
                    : [],
                library: library("p2", opts.p2Library ?? 3),
            }),
        ],
        combat: {
            attackerIds: ["attacker"],
            confirmed: true,
            blockerAssignments: opts.blocked ? { blocker: ["attacker"] } : {},
            blockersConfirmed: true,
        },
    });
}

function resolveAll(state: GameState): void {
    resolveTriggerOrder(state);
    let guard = 0;
    while (state.stack.length > 0 && guard++ < 10) resolveTopOfStack(state);
}

const triggerIds = (state: GameState) =>
    state.stack.map((s) => s.triggeredAbilityId);
const libraryIds = (state: GameState, seat: number) =>
    state.players[seat]!.library.map((c) => c.id);
const exileIds = (state: GameState, seat: number) =>
    state.players[seat]!.exile.map((c) => c.id);

describe("Ingest — the combat-damage trigger (CR 702.115a)", () => {
    it("expands the bare string into one damage trigger", () => {
        const triggered = getDefinition(INGEST).triggeredAbilities ?? [];
        expect(triggered.map((t) => t.id)).toEqual([INGEST_TRIGGER_ID]);
        expect(triggered[0].oracleText).toBe(INGEST_ORACLE_TEXT);
    });

    it("passes the catalogue-wide ability script validator", () => {
        expect(
            validateAbilityEffectScript(
                ingestTrigger(),
                "Ingest",
                "DAMAGE_DEALT"
            )
        ).toEqual([]);
    });

    it("exiles the top card of the damaged player's library, and only that card", () => {
        const state = combat({ attackerDef: INGEST });
        const [top, ...rest] = libraryIds(state, 1);
        applyAllCombatDamage(state, {});
        expect(triggerIds(state)).toEqual([INGEST_TRIGGER_ID]);
        // On the stack, not resolved: the library is untouched (CR 603.3).
        expect(exileIds(state, 1)).toEqual([]);
        resolveAll(state);
        expect(exileIds(state, 1)).toEqual([top]);
        expect(libraryIds(state, 1)).toEqual(rest);
        expect(exileIds(state, 0)).toEqual([]);
        expect(libraryIds(state, 0)).toHaveLength(3);
    });

    it("does not trigger on combat damage dealt only to a blocking creature", () => {
        const state = combat({ attackerDef: INGEST, blocked: true });
        applyAllCombatDamage(state, { attacker: { blocker: 2 } });
        expect(triggerIds(state)).not.toContain(INGEST_TRIGGER_ID);
    });

    it("does not trigger on noncombat damage to a player", () => {
        const state = combat({ attackerDef: INGEST });
        const triggers = collectTriggers(state, [
            {
                type: "DAMAGE_DEALT",
                sourceInstanceId: "attacker",
                sourceControllerId: "p1",
                target: { type: "player", id: "p2" },
                amount: 2,
                isCombat: false,
            },
        ]);
        expect(triggers).toHaveLength(0);
    });

    it("does not trigger on another creature's combat damage", () => {
        const state = combat({ attackerDef: VANILLA });
        applyAllCombatDamage(state, {});
        expect(triggerIds(state)).not.toContain(INGEST_TRIGGER_ID);
    });

    it("'that player' is the damaged player: redirected to the controller, the controller exiles", () => {
        const state = combat({ attackerDef: INGEST });
        const ownTop = libraryIds(state, 0)[0];
        placeTriggersOnStack(
            state,
            collectTriggers(state, [
                {
                    type: "DAMAGE_DEALT",
                    sourceInstanceId: "attacker",
                    sourceControllerId: "p1",
                    target: { type: "player", id: "p1" },
                    amount: 2,
                    isCombat: true,
                },
            ])
        );
        resolveAll(state);
        expect(exileIds(state, 0)).toEqual([ownTop]);
        expect(exileIds(state, 1)).toEqual([]);
    });

    it("still triggers when the creature dies in the same combat damage (CR 603.2)", () => {
        const state = combat({ attackerDef: FRAGILE_TRAMPLER, blocked: true });
        const top = libraryIds(state, 1)[0];
        // Lethal on the 3/5 blocker, the rest tramples over; the blocker's 3
        // damage kills the 6/1 attacker at the same time.
        applyAllCombatDamage(state, { attacker: { blocker: 5, p2: 1 } });
        expect(state.players[1]!.life).toBe(19);
        expect(triggerIds(state)).toEqual([INGEST_TRIGGER_ID]);
        checkStateBasedActions(state);
        expect(state.players[0]!.battlefield.map((c) => c.id)).not.toContain(
            "attacker"
        );
        resolveAll(state);
        expect(exileIds(state, 1)).toEqual([top]);
    });

    it("resolves as a clean no-op on an empty library (CR 608.2b)", () => {
        const state = combat({ attackerDef: INGEST, p2Library: 0 });
        applyAllCombatDamage(state, {});
        expect(triggerIds(state)).toEqual([INGEST_TRIGGER_ID]);
        resolveAll(state);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(exileIds(state, 1)).toEqual([]);
    });

    it("reaches the client: the stack object, then the exiled card face up to both seats", () => {
        const state = combat({ attackerDef: INGEST });
        const top = libraryIds(state, 1)[0];
        applyAllCombatDamage(state, {});
        const onStack = projectPublicState(state, 0, "p1");
        expect(onStack.stack[0]?.triggeredAbilityId).toBe(INGEST_TRIGGER_ID);
        resolveAll(state);
        for (const viewer of ["p1", "p2"]) {
            const view = projectPublicState(state, 0, viewer);
            const damaged = view.players.find((p) => p.id === "p2")!;
            expect(damaged.exile.map((c) => c.id)).toEqual([top]);
            expect(damaged.exile[0]?.card.id).toBe(VANILLA);
        }
    });
});

describe("Ingest — multiple instances trigger separately (CR 702.115b)", () => {
    it("two instances exile two cards, with no ordering prompt between identical triggers", () => {
        const state = combat({ attackerDef: DOUBLE_INGEST });
        const [first, second, third] = libraryIds(state, 1);
        applyAllCombatDamage(state, {});
        expect(triggerIds(state)).toEqual([
            INGEST_TRIGGER_ID,
            INGEST_TRIGGER_ID,
        ]);
        resolveTopOfStack(state);
        expect(exileIds(state, 1)).toEqual([first]);
        resolveTopOfStack(state);
        expect(exileIds(state, 1)).toEqual([first, second]);
        expect(libraryIds(state, 1)).toEqual([third]);
    });
});

describe("Ingest — the compiler's verdict (ADR 0105)", () => {
    it("releases a printed ingest, carrying the keyword the seam expands", () => {
        const outcome = compileCard(
            oracleCard({
                oracleText: `Devoid (This card has no color.)\nFlying\n${INGEST_ORACLE_TEXT}`,
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition.staticAbilities).toEqual([
            "devoid",
            "flying",
            "ingest",
        ]);
    });

    it("keeps a granted ingest in quarantine: a grant never reaches the expander", () => {
        const outcome = compileCard(
            oracleCard({
                typeLine: "Enchantment",
                manaCost: "{4}{W}{W}",
                power: undefined,
                toughness: undefined,
                oracleText: "Creatures you control have ingest.",
            })
        );
        expect(outcome.state).toBe("quarantine");
        if (outcome.state !== "quarantine") return;
        expect(outcome.reasons.map((r) => r.kind)).toEqual([
            "ungrantable-keyword",
        ]);
    });
});
