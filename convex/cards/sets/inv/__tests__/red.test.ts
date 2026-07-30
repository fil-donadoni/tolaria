// Per-card behavior tests for INV red cards (`convex/cards/sets/inv/red.ts`).
// Overload exercises the Kicker capability (CR 702.33) + the `manaValue` value
// member (CR 202.3): the MV threshold for its destroy shifts from 2 to 5 when
// kicked. The generic kicker/value mechanics are proven once in
// convex/gre/__tests__/kicker.test.ts and interpreter.test.ts; here we assert
// the card's specific thresholds are wired.
//
// Pouncing Kavu exercises the kicker → entersWith-counters →
// wasKicked-gated keyword-grant chain (issue #1716), the exact Duskwalker
// template (inv/black.ts) — a novel-enough composition to warrant its own
// assertion, including revert-sensitive regressions for the two failure
// modes the old counter-count proxy had.
//
// First-printing audit (ADR 0041): some cards exercised below were first
// implemented as part of this INV tranche but are REPRINTS — their
// definitions now live in their earliest-paper-printing home sets, and INV
// keeps only a `CardPrint`. The behaviour suites stay with the tranche that
// authored them and import the definition from its home module.

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
    pouncingKavu,
    kavuRunner,
} from "../red";
import { stun } from "../../tmp/red";
import { registerTokenDefinition } from "../../..";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    applySourceStaticEffects,
    unapplySourceStaticEffects,
    removePermanentTo,
    putReanimatedSetOnBattlefield,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    validateBlockerEligibility,
    validateAttackerEligibility,
} from "../../../../gre/combat";
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
    if (kicked) item.kickerPayments = { kicker: 1 };
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
        expect(overload.kickers).toEqual([
            { id: "kicker", description: "Kicker {2}", mana: { X: 2 } },
        ]);
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
    if (kicked) item.kickerPayments = { kicker: 1 };
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
        item.kickerPayments = { kicker: 1 };
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(10); // shield ignored
    });
    it("declares the kicker cost {8}{R} and cantBeCountered", () => {
        expect(urzasRage.kickers).toEqual([
            {
                id: "kicker",
                description: "Kicker {8}{R}",
                mana: { X: 8, R: 1 },
            },
        ]);
        expect(urzasRage.cantBeCountered).toBe(true);
    });
    it("wire format: kicked damage survives projectPublicState", () => {
        const state = makeState();
        const item = pushSpell(state, urzasRage.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.kickerPayments = { kicker: 1 };
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

describe("Stun (CR 509.1b block restriction + cantrip draw, issue #1285)", () => {
    it("restricts the target creature from blocking this turn and draws a card", () => {
        const target = makeInstance(savannahLions.id, {
            id: "stun-target",
            controllerId: "p2",
            ownerId: "p2",
        });
        const attacker = makeInstance(savannahLions.id, {
            id: "stun-attacker",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [attacker],
                    library: [makeInstance(mountain.id, { id: "stun-lib-1" })],
                }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        pushSpell(state, stun.id, "p1", [
            { type: "permanent", id: "stun-target" },
        ]);
        resolveTopOfStack(state);

        const resolvedTarget = state.players[1].battlefield.find(
            (c) => c.id === "stun-target"
        )!;
        expect(resolvedTarget.cantBlockThisTurn).toBe(true);
        expect(
            validateBlockerEligibility(attacker, resolvedTarget, [
                resolvedTarget,
            ]).eligible
        ).toBe(false);
        expect(state.players[0].hand.map((c) => c.id)).toContain("stun-lib-1");
    });
});

describe("Pouncing Kavu (Kicker → two +1/+1 counters + haste; CR 702.33 / 122.1 / 702.10, issue #1716)", () => {
    function enterKicked(kicked: boolean) {
        const state = makeState();
        const item = pushSpell(state, pouncingKavu.id, "p1");
        if (kicked) item.kickerPayments = { kicker: 1 };
        resolveTopOfStack(state);
        return state;
    }

    it("kicked: enters with two +1/+1 counters and haste", () => {
        const state = enterKicked(true);
        const kavu = state.players[0].battlefield.find(
            (c) => c.card.id === pouncingKavu.id
        )!;
        expect(kavu.counters?.["+1/+1"]).toBe(2);
        expect(kavu.wasKicked).toBe(true);
        expect(kavu.staticAbilities).toContain("haste");
    });

    it("not kicked: no counters, no haste, wasKicked unset", () => {
        const state = enterKicked(false);
        const kavu = state.players[0].battlefield.find(
            (c) => c.card.id === pouncingKavu.id
        )!;
        expect(kavu.counters?.["+1/+1"] ?? 0).toBe(0);
        expect(kavu.wasKicked).toBeUndefined();
        expect(kavu.staticAbilities).not.toContain("haste");
    });

    // Revert-sensitive regressions (issue #1716): before the fix, the
    // `keyword-grant` gated on `(target.counters?.["+1/+1"] ?? 0) >= 2` — an
    // exact proxy for "was kicked" ONLY at the instant `entersWith` placed the
    // counters. Forcing a re-materialization (`unapplySourceStaticEffects` +
    // `applySourceStaticEffects`, what `refreshCounterGatedStatics` does
    // internally for any counter-dependent grant) exposes the proxy's two
    // failure modes directly against the real production apply path — these
    // fail if the `applies` predicate is reverted to read `target.counters`.
    it("(regression) unkicked, later pumped to 2+ +1/+1 counters externally: still does not gain haste", () => {
        const state = enterKicked(false);
        const kavu = state.players[0].battlefield.find(
            (c) => c.card.id === pouncingKavu.id
        )!;
        expect(kavu.staticAbilities).not.toContain("haste");
        // Simulate an unrelated pump spell (one of 40+ catalogue "+1/+1"
        // sources) landing 2 counters on the never-kicked Kavu post-ETB.
        kavu.counters = { "+1/+1": 2 };
        unapplySourceStaticEffects(state, kavu);
        applySourceStaticEffects(state, kavu);
        expect(kavu.staticAbilities).not.toContain("haste");
    });

    it("(regression) kicked, then all +1/+1 counters annihilated (CR 704.5q): keeps haste", () => {
        const state = enterKicked(true);
        const kavu = state.players[0].battlefield.find(
            (c) => c.card.id === pouncingKavu.id
        )!;
        expect(kavu.staticAbilities).toContain("haste");
        // Simulate -1/-1 counter annihilation wiping the +1/+1 counters.
        delete kavu.counters?.["+1/+1"];
        unapplySourceStaticEffects(state, kavu);
        applySourceStaticEffects(state, kavu);
        expect(kavu.staticAbilities).toContain("haste");
    });

    // Revert-sensitive regressions (issue #1753, PR #1753 review finding 1):
    // `wasKicked` (and the stray runtime `kickerPayments` a resolved stack item
    // still carries) must NOT survive a CR 400.7 zone change. Both drive the
    // real production apply path — `removePermanentTo` /
    // `putReanimatedSetOnBattlefield` (which funnel through
    // `resetBattlefieldTransientState`) and `resolveTopOfStack` (which runs
    // `finalizeSpellResolution`'s ETB snapshot) — not a hand-built view.
    it("(regression) bounced to hand and recast unkicked: does not inherit stale wasKicked/haste", () => {
        const state = enterKicked(true);
        const kavu = state.players[0].battlefield.find(
            (c) => c.card.id === pouncingKavu.id
        )!;
        expect(kavu.wasKicked).toBe(true);

        // CR 400.7 — bounce the kicked Kavu to hand, the shared
        // battlefield-departure chokepoint (`removePermanentTo`).
        const bounced = removePermanentTo(state, kavu.id, "hand");
        expect(bounced).not.toBeNull();
        const handCard = state.players[0].hand.find((c) => c.id === kavu.id)!;
        expect(handCard.wasKicked).toBeUndefined();
        expect(
            (handCard as { kickerPayments?: Record<string, number> })
                .kickerPayments
        ).toBeUndefined();

        // Recast UNKICKED, mirroring the real stack-item build
        // (`announceCast`/`finalizeTargetSelection`, convex/game.ts):
        // `{ ...spellCard, castById, ...(kickerPayments ? { kickerPayments } : {}) }`
        // — no `kickerPayments` key at all when the new cast is not kicked, so a
        // leaked field on `spellCard` would ride straight through the spread.
        const recast: StackItem = { ...handCard, castById: "p1" };
        state.stack.push(recast);
        resolveTopOfStack(state);

        const recastKavu = state.players[0].battlefield.find(
            (c) => c.card.id === pouncingKavu.id
        )!;
        expect(recastKavu.counters?.["+1/+1"] ?? 0).toBe(0);
        expect(recastKavu.wasKicked).toBeUndefined();
        expect(recastKavu.staticAbilities).not.toContain("haste");
    });

    it("(regression) reanimated after being kicked: does not return with stale haste", () => {
        const state = enterKicked(true);
        const kavu = state.players[0].battlefield.find(
            (c) => c.card.id === pouncingKavu.id
        )!;
        expect(kavu.wasKicked).toBe(true);
        expect(kavu.staticAbilities).toContain("haste");

        // CR 400.7 — send the kicked Kavu to the graveyard (same
        // battlefield-departure chokepoint). Unlike the hand/library branch,
        // `removePermanentTo` deliberately does NOT clear `wasKicked` here —
        // graveyard/exile preserve historical state — so it is cleared at
        // REANIMATION time instead, via the real production entry path
        // (`putReanimatedSetOnBattlefield` — shared by `returnToBattlefield`
        // and every reanimation-style ENTRY, per
        // `resetBattlefieldTransientState`'s own doc).
        const sent = removePermanentTo(state, kavu.id, "graveyard");
        expect(sent).not.toBeNull();
        expect(sent!.wasKicked).toBe(true);

        const gy = state.players[0].graveyard;
        const idx = gy.findIndex((c) => c.id === kavu.id);
        const [reanimated] = gy.splice(idx, 1);
        const entered = putReanimatedSetOnBattlefield(state, [
            { card: reanimated, controllerId: "p1" },
        ]);
        expect(entered).toEqual([kavu.id]);

        const reanimatedKavu = state.players[0].battlefield.find(
            (c) => c.card.id === pouncingKavu.id
        )!;
        expect(reanimatedKavu.wasKicked).toBeUndefined();
        expect(reanimatedKavu.staticAbilities).not.toContain("haste");
    });

    // Wire format (mandatory for a new CardInstanceState field, issue #1716,
    // `.claude/rules/gre-development.md` § Frontend wiring analysis): the
    // materialized "haste" keyword — the client-visible effect of
    // `wasKicked` — must survive `projectPublicState`'s slim reshape.
    it("kicked haste grant survives projectPublicState (wire format)", () => {
        const state = enterKicked(true);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.card.id === pouncingKavu.id
        )!;
        expect(slim.wasKicked).toBe(true);
        expect(slim.staticAbilities).toContain("haste");
    });
});

describe("Kavu Runner (board-state-conditional haste; CR 611.2c, issue #1095)", () => {
    function makeKavuRunnerState() {
        const kavu = makeInstance(kavuRunner.id, {
            controllerId: "p1",
            ownerId: "p1",
            id: "kavu-runner",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kavu] }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, kavu);
        return { state, kavu };
    }

    function addOpponentLions(state: GameState) {
        const lions = makeInstance(savannahLions.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "opp-lions",
        });
        state.players[1].battlefield.push(lions);
        return lions;
    }

    it("has haste when no opponent controls a white or blue creature", () => {
        const { kavu } = makeKavuRunnerState();
        expect(kavu.staticAbilities).toContain("haste");
    });

    // `keyword-grant` is MATERIALIZED at apply time (not recomputed at every
    // read like `pt-buff`), so the "as long as" gate only stays live because
    // the real production SBA path (`checkStateBasedActions` →
    // `refreshCounterGatedStatics`, generalized in issue #1095 to also sweep
    // `keyword-grant`s that declare a `condition`) re-runs `applies`/
    // `condition` every SBA pass. Exercised via `checkStateBasedActions`
    // (not a direct `refreshCounterGatedStatics` call) so this test would go
    // red if the wiring at `gre/sba.ts` ever dropped that call.
    it("loses haste once an opponent controls a white creature (re-evaluated via checkStateBasedActions)", () => {
        const { state, kavu } = makeKavuRunnerState();
        expect(kavu.staticAbilities).toContain("haste");

        addOpponentLions(state);
        checkStateBasedActions(state);

        expect(kavu.staticAbilities).not.toContain("haste");
    });

    it("regains haste once the opposing white creature leaves the battlefield", () => {
        const { state, kavu } = makeKavuRunnerState();
        addOpponentLions(state);
        checkStateBasedActions(state);
        expect(kavu.staticAbilities).not.toContain("haste");

        state.players[1].battlefield = state.players[1].battlefield.filter(
            (c) => c.id !== "opp-lions"
        );
        checkStateBasedActions(state);

        expect(kavu.staticAbilities).toContain("haste");
    });

    // Wire format (mandatory, `.claude/rules/gre-development.md` § Frontend
    // wiring analysis): the materialized "haste" keyword must survive
    // `projectPublicState`'s slim reshape, both while present and once the
    // board-state gate has removed it.
    it("haste presence/absence survives projectPublicState (wire format)", () => {
        const { state, kavu } = makeKavuRunnerState();

        const projectedWithHaste = projectPublicState(state, 1, "p1");
        const slimWithHaste = projectedWithHaste.players[0].battlefield.find(
            (c) => c.id === kavu.id
        )!;
        expect(slimWithHaste.staticAbilities).toContain("haste");

        addOpponentLions(state);
        checkStateBasedActions(state);

        const projectedNoHaste = projectPublicState(state, 2, "p1");
        const slimNoHaste = projectedNoHaste.players[0].battlefield.find(
            (c) => c.id === kavu.id
        )!;
        expect(slimNoHaste.staticAbilities).not.toContain("haste");
    });

    // The card's entire user-visible point: haste lets it attack the turn it
    // enters, bypassing summoning sickness (CR 702.10b), and ONLY while the
    // board-state gate holds. Asserted through `validateAttackerEligibility`
    // (not a hand-rolled `staticAbilities` check) so this proves the real
    // combat-eligibility path, not just the materialized keyword array —
    // deleting the `refreshCounterGatedStatics` call at `gre/sba.ts:725`
    // would leave this test red (still eligible before SBA runs, but the
    // post-SBA assertion below would then wrongly stay eligible too).
    it("can attack despite summoning sickness while the gate holds, and loses that eligibility once it lapses (validateAttackerEligibility)", () => {
        const kavu = makeInstance(kavuRunner.id, {
            controllerId: "p1",
            ownerId: "p1",
            id: "kavu-runner",
            isSummoningSick: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kavu] }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, kavu);

        expect(validateAttackerEligibility(kavu)).toEqual({ eligible: true });

        addOpponentLions(state);
        checkStateBasedActions(state);

        expect(validateAttackerEligibility(kavu)).toEqual({
            eligible: false,
            reason: "Creature has summoning sickness",
        });
    });
});
