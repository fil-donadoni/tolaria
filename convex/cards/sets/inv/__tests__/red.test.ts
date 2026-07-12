// Per-card behavior tests for INV red cards (`convex/cards/sets/inv/red.ts`).
// Overload exercises the Kicker capability (CR 702.33) + the `manaValue` value
// member (CR 202.3): the MV threshold for its destroy shifts from 2 to 5 when
// kicked. The generic kicker/value mechanics are proven once in
// convex/gre/__tests__/kicker.test.ts and interpreter.test.ts; here we assert
// the card's specific thresholds are wired.

import { describe, it, expect } from "vitest";
import {
    overload,
    obliterate,
    urzasRage,
    kavuScout,
    collapsingBorders,
    tribalFlames,
    bendOrBreak,
    standOrFall,
} from "../red";
import { registerTokenDefinition } from "../../..";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { validateBlockerEligibility } from "../../../../gre/combat";
import { projectPublicState } from "../../../../gameProjections";
import { mountain, forest, plains, island, swamp } from "../../lea/colorless";
import { savannahLions } from "../../lea";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";

// Synthetic artifacts with controlled mana values.
const ART_MV2 = "test-overload-art-mv2";
const ART_MV4 = "test-overload-art-mv4";
registerTokenDefinition({
    id: ART_MV2,
    name: ART_MV2,
    rarity: "common",
    manaCost: { X: 2 },
    types: ["Artifact"],
});
registerTokenDefinition({
    id: ART_MV4,
    name: ART_MV4,
    rarity: "common",
    manaCost: { X: 4 },
    types: ["Artifact"],
});

function castOverload(kicked: boolean, artId: string) {
    const art = makeInstance(artId, {
        controllerId: "p2",
        ownerId: "p2",
        id: "artifact",
    });
    const state = makeState({
        players: [makePlayer("p1"), makePlayer("p2", { battlefield: [art] })],
    });
    const item: StackItem = pushSpell(state, overload.id, "p1", [
        { type: "permanent", id: "artifact" },
    ]);
    if (kicked) item.kickerCount = 1;
    resolveTopOfStack(state);
    return state.players[1].battlefield.find((c) => c.id === "artifact");
}

describe("Overload (Kicker {2}, CR 702.33 / 202.3)", () => {
    it("unkicked destroys an artifact with mana value 2 or less", () => {
        expect(castOverload(false, ART_MV2)).toBeUndefined();
    });
    it("unkicked does NOT destroy an artifact with mana value 4", () => {
        expect(castOverload(false, ART_MV4)).toBeDefined();
    });
    it("kicked destroys an artifact with mana value up to 5", () => {
        expect(castOverload(true, ART_MV4)).toBeUndefined();
    });
    it("declares the kicker cost {2}", () => {
        expect(overload.kicker).toEqual({ cost: { X: 2 } });
    });
});

// Obliterate — "This spell can't be countered. Destroy all artifacts,
// creatures, and lands. They can't be regenerated." (CR 701.5c, 701.7,
// 701.15c, issue #1065). Same NOT-DSL-migratable shape as Wrath of God /
// Damnation / Jokulhaups (destroyAll + cantBeRegenerated); the card-specific
// assertion here is the artifact+creature+LAND scope and the regen-shield
// bypass. The can't-be-countered MECHANISM itself is proven generically in
// `convex/gre/effects/__tests__/interpreter.test.ts`.
const TEST_ARTIFACT_ID = "test-obliterate-artifact";
registerTokenDefinition({
    id: TEST_ARTIFACT_ID,
    name: TEST_ARTIFACT_ID,
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Artifact"],
});
describe("Obliterate (CR 701.5c can't-be-countered, 701.7 destroy, 701.15c regen suppression)", () => {
    it("destroys every artifact, creature, and land on both battlefields", () => {
        const artifact = makeInstance(TEST_ARTIFACT_ID, {
            id: "artifact",
            controllerId: "p1",
            ownerId: "p1",
        });
        const mountainCard = makeInstance(mountain.id, {
            id: "mtn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lion = makeInstance(forest.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [artifact, mountainCard] }),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, obliterate.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(0);
    });

    it("regeneration shields are NOT consumed — the rider suppresses them", () => {
        const lion = makeInstance(forest.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
            regenerationShields: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, obliterate.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "lion")
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.find((c) => c.id === "lion")
        ).toBeDefined();
    });

    it("declares cantBeCountered", () => {
        expect(obliterate.cantBeCountered).toBe(true);
    });

    // Wire format: the mass-destroy outcome (an emptied battlefield) must
    // survive the GameState → public projection.
    it("wire format: emptied battlefields survive projectPublicState", () => {
        const lion = makeInstance(forest.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, obliterate.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].battlefield).toHaveLength(0);
        expect(
            projected.players[1].graveyard.some((c) => c.id === "lion")
        ).toBe(true);
    });
});

// Urza's Rage — "Kicker {8}{R}. This spell can't be countered. Urza's Rage
// deals 3 damage to any target. If this spell was kicked, instead it deals
// 10 damage to that permanent or player and the damage can't be prevented."
// (CR 701.5c, 702.33, 120.1, 615, issue #1065). The `unpreventable` dealDamage
// param and the can't-be-countered mechanism are proven generically in
// `interpreter.test.ts`; this asserts the card's specific 3-vs-10 split and
// declarations.
function castUrzasRage(kicked: boolean) {
    const state = makeState();
    const item: StackItem = pushSpell(state, urzasRage.id, "p1", [
        { type: "player", id: "p2" },
    ]);
    if (kicked) item.kickerCount = 1;
    resolveTopOfStack(state);
    return state.players[1].life;
}
describe("Urza's Rage (Kicker {8}{R}, CR 701.5c / 702.33 / 615)", () => {
    it("unkicked deals 3 damage to any target", () => {
        expect(castUrzasRage(false)).toBe(17); // 20 - 3
    });
    it("kicked deals 10 damage instead", () => {
        expect(castUrzasRage(true)).toBe(10); // 20 - 10
    });
    it("kicked damage can't be prevented — ignores a target prevention shield", () => {
        const state = makeState();
        state.targetPreventionShields = [
            {
                targetType: "player",
                targetId: "p2",
                remaining: 100,
                duration: { phase: "end-of-turn" },
            },
        ];
        const item = pushSpell(state, urzasRage.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.kickerCount = 1;
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(10); // shield ignored
    });
    it("declares the kicker cost {8}{R} and cantBeCountered", () => {
        expect(urzasRage.kicker).toEqual({ cost: { X: 8, R: 1 } });
        expect(urzasRage.cantBeCountered).toBe(true);
    });
    it("wire format: kicked damage survives projectPublicState", () => {
        const state = makeState();
        const item = pushSpell(state, urzasRage.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.kickerCount = 1;
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].life).toBe(10);
    });
});

// ---------------------------------------------------------------------------
// Domain cluster (parent PRD #1063, issue #1066). `{ domain: { of } }` and
// `winGame` each carry their own permanent interpreter test
// (`convex/gre/effects/__tests__/interpreter.test.ts`); the tests below wire
// each RED card to that shared value member / the `pt-cda` construct.
// ---------------------------------------------------------------------------

describe("Tribal Flames (CR 120.1 damage — X = Domain, issue #1066)", () => {
    it("deals damage equal to the controller's Domain to any target", () => {
        const lands = [plains, island, swamp].map((def, i) =>
            makeInstance(def.id, {
                id: `tf-land-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: lands }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, tribalFlames.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17); // 20 - 3
    });
});

describe("Kavu Scout (CR 604.3 CDA — +1/+0 per Domain, issue #1066)", () => {
    it("gets +1/+0 for each basic land type controlled (printed 0/2 base)", () => {
        const scout = makeInstance(kavuScout.id, {
            id: "scout",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lands = [plains, island].map((def, i) =>
            makeInstance(def.id, {
                id: `ks-land-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [scout, ...lands] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, scout)).toBe(2); // 0 + 2
        expect(getEffectiveToughness(state, scout)).toBe(2); // unchanged
    });

    it("CDA P/T survives the wire projection (mandatory)", () => {
        const scout = makeInstance(kavuScout.id, {
            id: "scout",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lands = [plains, island, swamp, mountain, forest].map((def, i) =>
            makeInstance(def.id, {
                id: `ks-wire-land-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [scout, ...lands] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "scout"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(5); // 0 + 5 (max Domain)
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});

describe("Collapsing Borders (CR 603.6a each-player upkeep — Domain, issue #1066)", () => {
    /** Pushes Collapsing Borders' upkeep trigger onto the stack as if it had
     *  fired on `activePlayerId`'s upkeep (mirrors the manual
     *  triggeredAbilityId/triggerEvent push idiom, `clu/__tests__/red.test.ts`). */
    function fireUpkeep(
        state: GameState,
        borders: ReturnType<typeof makeInstance>,
        activePlayerId: string
    ) {
        state.stack.push({
            ...borders,
            zone: "stack",
            castById: borders.controllerId,
            triggeredAbilityId: "collapsing-borders-upkeep",
            triggerSourceId: borders.id,
            triggerEvent: {
                type: "PHASE_BEGIN",
                phase: "UPKEEP",
                activePlayerId,
            },
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("that player gains life = THEIR OWN Domain, then takes 3 damage — on p2's upkeep", () => {
        const borders = makeInstance(collapsingBorders.id, {
            id: "borders",
            controllerId: "p1",
            ownerId: "p1",
        });
        // p2 controls 2 basic land types; p1 (the enchantment's controller)
        // controls none — proving the read is the SCOPED (upkeep) player's
        // Domain, not the controller's.
        const p2Lands = [plains, island].map((def, i) =>
            makeInstance(def.id, {
                id: `cb-p2-land-${i}`,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [borders] }),
                makePlayer("p2", { battlefield: p2Lands }),
            ],
        });
        fireUpkeep(state, borders, "p2");
        // 20 + 2 (Domain) - 3 (Collapsing Borders damage) = 19
        expect(state.players[1].life).toBe(19);
        expect(state.players[0].life).toBe(20); // p1 untouched this upkeep
    });

    it("fires symmetrically on the controller's OWN upkeep too", () => {
        const borders = makeInstance(collapsingBorders.id, {
            id: "borders",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1Lands = [plains].map((def, i) =>
            makeInstance(def.id, {
                id: `cb-p1-land-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [borders, ...p1Lands] }),
                makePlayer("p2"),
            ],
        });
        fireUpkeep(state, borders, "p1");
        // 20 + 1 (Domain) - 3 = 18
        expect(state.players[0].life).toBe(18);
        expect(state.players[1].life).toBe(20);
    });
});

describe("Bend or Break (CR 701.8 destroy / 701.26 tap, ADR 0053 pile division, issue #1067)", () => {
    it("each player divides their OWN nontoken lands; the opponent chooses; the chosen pile is destroyed, the other tapped — for BOTH players", () => {
        const p1Lands = [
            makeInstance(mountain.id, {
                id: "bob-p1-l1",
                controllerId: "p1",
                ownerId: "p1",
            }),
            makeInstance(forest.id, {
                id: "bob-p1-l2",
                controllerId: "p1",
                ownerId: "p1",
            }),
        ];
        const p2Lands = [
            makeInstance(plains.id, {
                id: "bob-p2-l1",
                controllerId: "p2",
                ownerId: "p2",
            }),
            makeInstance(island.id, {
                id: "bob-p2-l2",
                controllerId: "p2",
                ownerId: "p2",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: p1Lands }),
                makePlayer("p2", { battlefield: p2Lands }),
            ],
        });
        pushSpell(state, bendOrBreak.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended (p1's own divide)

        // --- First divideIntoPiles Op: p1 divides p1's own lands ---
        let head = state.pendingChoices![0];
        expect(head.kind).toBe("divide-piles");
        expect(head.playerId).toBe("p1");
        expect(head.zoneOwnerId).toBe("p1");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["bob-p1-l1"], // pile A = [l1], pile B = [l2]
        });
        head = state.pendingChoices![0];
        expect(head.kind).toBe("pick-pile");
        expect(head.playerId).toBe("p2"); // the opponent chooses
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["A"], // l1 destroyed, l2 tapped
        });

        // --- Second divideIntoPiles Op: p2 divides p2's own lands ---
        expect(state.stack).toHaveLength(1); // still resolving
        head = state.pendingChoices![0];
        expect(head.kind).toBe("divide-piles");
        expect(head.playerId).toBe("p2");
        expect(head.zoneOwnerId).toBe("p2");
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["bob-p2-l1"], // pile A = [l1], pile B = [l2]
        });
        head = state.pendingChoices![0];
        expect(head.kind).toBe("pick-pile");
        expect(head.playerId).toBe("p1"); // the opponent chooses
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["A"], // l1 destroyed, l2 tapped
        });

        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "bob-p1-l2",
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "bob-p1-l2")
                ?.isTapped
        ).toBe(true);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "bob-p1-l1"
        );
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "bob-p2-l2",
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bob-p2-l2")
                ?.isTapped
        ).toBe(true);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            "bob-p2-l1"
        );
    });

    it("excludes token lands from the divided set (CR 701.8, isToken filter)", () => {
        const realLand = makeInstance(mountain.id, {
            id: "bob-real-land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const tokenLand = makeInstance(mountain.id, {
            id: "bob-token-land",
            controllerId: "p1",
            ownerId: "p1",
            isToken: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [realLand, tokenLand] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, bendOrBreak.id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.candidateIds).toEqual(["bob-real-land"]);
    });
});

describe("Stand or Fall (CR 603.6a combat-begin trigger / 509.1b block restriction, ADR 0053 pile division, issue #1067)", () => {
    function fireCombatBegin(
        state: GameState,
        source: ReturnType<typeof makeInstance>,
        activePlayerId: string
    ) {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: source.controllerId,
            triggeredAbilityId: "stand-or-fall-divide",
            triggerSourceId: source.id,
            triggerEvent: {
                type: "PHASE_BEGIN",
                phase: "BEGINNING_OF_COMBAT",
                activePlayerId,
            },
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("on the controller's own turn, divides the DEFENDING (opponent's) creatures; the opponent chooses; the OTHER pile can't block", () => {
        const enchantment = makeInstance(standOrFall.id, {
            id: "sof",
            controllerId: "p1",
            ownerId: "p1",
        });
        const creatures = ["sof-1", "sof-2"].map((id) =>
            makeInstance(savannahLions.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const attacker = makeInstance(savannahLions.id, {
            id: "sof-attacker",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [enchantment, attacker],
                }),
                makePlayer("p2", { battlefield: creatures }),
            ],
        });
        // scope: "your" — fires on the enchantment's OWN controller's turn.
        fireCombatBegin(state, enchantment, "p1");
        const divide = state.pendingChoices![0];
        expect(divide.kind).toBe("divide-piles");
        expect(divide.playerId).toBe("p1"); // the controller divides
        expect(divide.zoneOwnerId).toBe("p2"); // the defending player's creatures
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: divide.stackItemId,
            step: divide.step,
            choiceId: divide.choiceId,
            cardInstanceIds: ["sof-1"],
        });

        const pick = state.pendingChoices![0];
        expect(pick.kind).toBe("pick-pile");
        expect(pick.playerId).toBe("p2"); // the defending player chooses
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: ["A"], // choose pile A (sof-1) — may block
        });

        const chosen = state.players[1].battlefield.find(
            (c) => c.id === "sof-1"
        )!;
        const other = state.players[1].battlefield.find(
            (c) => c.id === "sof-2"
        )!;
        const attackerCard = state.players[0].battlefield.find(
            (c) => c.id === "sof-attacker"
        )!;
        expect(chosen.cantBlockThisTurn).toBeUndefined();
        expect(
            validateBlockerEligibility(attackerCard, chosen, [chosen, other])
                .eligible
        ).toBe(true);
        expect(other.cantBlockThisTurn).toBe(true);
        expect(
            validateBlockerEligibility(attackerCard, other, [chosen, other])
                .eligible
        ).toBe(false);
    });
});
