import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { dauthiVoidwalker } from "../black";
import { registerTokenDefinition } from "../../../index";
import type { GameState, StackItem } from "../../../../gre/state";
import {
    resolveTopOfStack,
    getPlayer,
    discardToGraveyard,
    removeFromZone,
    moveCard,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { validateBlockerEligibility } from "../../../../gre/combat";
import { projectPublicState } from "../../../../gameProjections";
import {
    castRawManaCost,
    assertActivationTimingLegal,
    locateCastSource,
    castZoneOwner,
} from "../../../../game";
import { applyPlayLandFromExile } from "../../../../gre/playLand";

// Synthetic creatures for the fixtures below (`registerTokenDefinition` is
// the shared test-registry injection seam, mirrors the interpreter test
// suite's `BEAR_ID` pattern) — plain 2/2 vanilla creatures unless noted.
for (const id of [
    "test-mh2-black-victim",
    "test-mh2-black-own",
    "test-mh2-black-plain-blocker",
    "test-mh2-black-plain-attacker",
    "test-mh2-black-opp-void",
    "test-mh2-black-opp-plain",
    "test-mh2-black-own-void",
    "test-mh2-black-wire-granted",
    "test-mh2-black-cast-seam",
]) {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Creature"],
        subtypes: ["Bear"],
        power: 2,
        toughness: 2,
    });
}
// A plain Land, for the cross-player play-from-exile primitive test below
// (`applyPlayLandFromExile` / `moveCardAcrossPlayers`).
registerTokenDefinition({
    id: "test-mh2-black-land-seam",
    name: "test-mh2-black-land-seam",
    rarity: "common",
    types: ["Land"],
});

// Dauthi Voidwalker — {1}{B} Creature Dauthi Rogue, 3/2, shadow (MH2 81,
// issue #1156). Two abilities:
//  1. "Shadow. If a card would be put into an opponent's graveyard from
//     anywhere, exile it with a void counter on it instead." The redirect
//     MECHANISM (the `"graveyard-bound"` ReplacementEventKind + apply-loop
//     hook) is already exhaustively tested against a synthetic Dauthi-shaped
//     permanent in `gre/__tests__/graveyardBoundReplacement.test.ts` — this
//     suite only proves DAUTHI'S OWN `replacementEffects[]` entry is wired
//     correctly (a sanity/wiring check, not a re-test of the mechanism).
//  2. "{T}, Sacrifice this creature: Choose an exiled card an opponent owns
//     with a void counter on it. You may play it this turn without paying
//     its mana cost. Activate only as a sorcery." — the genuinely new
//     surface this issue ships: the `choose-exile-card` choice kind, the
//     `hasCounter` filter, `sorcerySpeedOnly`, and the free-cast waiver.
describe("Dauthi Voidwalker (CR 601.3e / 702.28, issue #1156)", () => {
    it("is a {1}{B} 3/2 Dauthi Rogue with shadow", () => {
        expect(dauthiVoidwalker.manaCost).toEqual({ B: 2 });
        expect(dauthiVoidwalker.types).toEqual(["Creature"]);
        expect(dauthiVoidwalker.subtypes).toEqual(["Dauthi", "Rogue"]);
        expect(dauthiVoidwalker.power).toBe(3);
        expect(dauthiVoidwalker.toughness).toBe(2);
        expect(dauthiVoidwalker.staticAbilities).toContain("shadow");
    });

    describe("ability 1 — graveyard-bound void-exile (shipped mechanism, issue #1145)", () => {
        it("redirects an OPPONENT's discarded card into exile with a void counter instead of the graveyard", () => {
            const dauthi = makeInstance(dauthiVoidwalker.id, {
                id: "dauthi1",
                controllerId: "p1",
                ownerId: "p1",
            });
            const oppCard = makeInstance("test-mh2-black-victim", {
                id: "victim1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
                types: ["Creature"],
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [dauthi] }),
                    makePlayer("p2", { hand: [oppCard] }),
                ],
            });
            const ok = discardToGraveyard(state, "p2", "victim1");
            expect(ok).toBe(true);
            const p2 = getPlayer(state, "p2");
            expect(p2.graveyard.some((c) => c.id === "victim1")).toBe(false);
            const exiled = p2.exile.find((c) => c.id === "victim1");
            expect(exiled).toBeDefined();
            expect(exiled!.counters).toEqual({ void: 1 });
        });

        it("does NOT redirect Dauthi's own controller's cards (CR 400.7 — scoped to an OPPONENT's graveyard)", () => {
            const dauthi = makeInstance(dauthiVoidwalker.id, {
                id: "dauthi2",
                controllerId: "p1",
                ownerId: "p1",
            });
            const ownCard = makeInstance("test-mh2-black-own", {
                id: "own1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
                types: ["Creature"],
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [dauthi],
                        hand: [ownCard],
                    }),
                    makePlayer("p2"),
                ],
            });
            discardToGraveyard(state, "p1", "own1");
            const p1 = getPlayer(state, "p1");
            expect(p1.graveyard.some((c) => c.id === "own1")).toBe(true);
            expect(p1.exile.some((c) => c.id === "own1")).toBe(false);
        });
    });

    describe("shadow (CR 702.28b) — bidirectional evasion", () => {
        it("can only be blocked by a creature with shadow", () => {
            const dauthi = makeInstance(dauthiVoidwalker.id, {
                id: "dauthiAtk",
                controllerId: "p1",
                ownerId: "p1",
            });
            const plainBlocker = makeInstance("test-mh2-black-plain-blocker", {
                id: "blocker1",
                controllerId: "p2",
                ownerId: "p2",
                types: ["Creature"],
                power: 2,
                toughness: 2,
            });
            const shadowBlocker = makeInstance(dauthiVoidwalker.id, {
                id: "blocker2",
                controllerId: "p2",
                ownerId: "p2",
            });
            expect(
                validateBlockerEligibility(dauthi, plainBlocker, [
                    plainBlocker,
                    shadowBlocker,
                ]).eligible
            ).toBe(false);
            expect(
                validateBlockerEligibility(dauthi, shadowBlocker, [
                    plainBlocker,
                    shadowBlocker,
                ]).eligible
            ).toBe(true);
        });

        it("can only block a creature with shadow (the reverse half — a shadow creature can't block a non-shadow attacker)", () => {
            const dauthi = makeInstance(dauthiVoidwalker.id, {
                id: "dauthiBlk",
                controllerId: "p2",
                ownerId: "p2",
            });
            const plainAttacker = makeInstance(
                "test-mh2-black-plain-attacker",
                {
                    id: "attacker1",
                    controllerId: "p1",
                    ownerId: "p1",
                    types: ["Creature"],
                    power: 2,
                    toughness: 2,
                }
            );
            const result = validateBlockerEligibility(plainAttacker, dauthi, [
                dauthi,
            ]);
            expect(result.eligible).toBe(false);
        });
    });

    describe("ability 2 — {T}, Sacrifice: free-cast an opponent's void-countered exile card (issue #1156)", () => {
        it("declares {T}+sacrifice cost and sorcerySpeedOnly", () => {
            const ability = dauthiVoidwalker.activatedAbilities?.[0];
            expect(ability).toBeDefined();
            expect(ability!.cost).toEqual({ tap: true, sacrifice: true });
            expect(ability!.sorcerySpeedOnly).toBe(true);
            expect(ability!.useStack).toBe(true);
        });

        it("chooses the void-countered card an OPPONENT owns and grants a free cast — filtering out a plain exiled card and the caster's OWN void-countered card", () => {
            const dauthi = makeInstance(dauthiVoidwalker.id, {
                id: "dauthi3",
                controllerId: "p1",
                ownerId: "p1",
            });
            const oppVoidCard = makeInstance("test-mh2-black-opp-void", {
                id: "oppVoid1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "exile",
                types: ["Creature"],
                counters: { void: 1 },
            });
            const oppPlainExiled = makeInstance("test-mh2-black-opp-plain", {
                id: "oppPlain1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "exile",
                types: ["Creature"],
            });
            const ownVoidCard = makeInstance("test-mh2-black-own-void", {
                id: "ownVoid1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "exile",
                types: ["Creature"],
                counters: { void: 1 },
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [dauthi],
                        exile: [ownVoidCard],
                    }),
                    makePlayer("p2", {
                        exile: [oppVoidCard, oppPlainExiled],
                    }),
                ],
            });
            // Simulate the {T}, Sacrifice cost already paid, and push the
            // ability onto the stack (mirrors `activateAbility`'s commit).
            state.stack.push({
                ...dauthi,
                zone: "stack",
                castById: "p1",
                abilityId: "dauthi-voidwalker-cast",
                targets: [],
            } as StackItem);
            expect(resolveTopOfStack(state)).toBeNull(); // suspended on the choice

            const head = state.pendingChoices![0];
            expect(head.kind).toBe("choose-exile-card");
            expect(head.zoneOwnerId).toBe("p2");
            // Only the opponent's VOID-countered card is eligible — not the
            // opponent's plain exiled card, and not the caster's OWN
            // void-countered card (zoneOwnerId scopes the zone read to p2).
            expect(head.candidateIds).toEqual(["oppVoid1"]);

            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["oppVoid1"],
            });
            expect(state.pendingChoices).toBeUndefined();

            const granted = getPlayer(state, "p2").exile.find(
                (c) => c.id === "oppVoid1"
            )!;
            expect(granted.castableFromExileBy).toBe("p1");
            expect(granted.castableFromExileUntilTurn).toBe(state.turn);
            expect(granted.castFromExileWithoutPayingManaCost).toBe(true);
            // CR 601.3e (issue #1156) — the ONE place a cast's mana cost is
            // computed returns an empty cost for the granted card.
            expect(castRawManaCost(state, granted, "exile")).toEqual({});

            const untouchedOwn = getPlayer(state, "p1").exile.find(
                (c) => c.id === "ownVoid1"
            )!;
            expect(untouchedOwn.castableFromExileBy).toBeUndefined();
        });

        it("assertActivationTimingLegal rejects activation outside sorcery timing", () => {
            const ability = dauthiVoidwalker.activatedAbilities![0];
            const dauthi = makeInstance(dauthiVoidwalker.id, {
                id: "dauthi4",
                controllerId: "p1",
                ownerId: "p1",
            });
            const combatState: GameState = makeState({
                players: [
                    makePlayer("p1", { battlefield: [dauthi] }),
                    makePlayer("p2"),
                ],
                phase: "DECLARE_ATTACKERS",
            });
            expect(() =>
                assertActivationTimingLegal(combatState, dauthi, ability)
            ).toThrow(/sorcery/i);

            const mainState: GameState = makeState({
                players: [
                    makePlayer("p1", { battlefield: [dauthi] }),
                    makePlayer("p2"),
                ],
                phase: "PRECOMBAT_MAIN",
            });
            expect(() =>
                assertActivationTimingLegal(mainState, dauthi, ability)
            ).not.toThrow();
        });

        it("wire format: the caster's projected legalActions on the granted (opponent-owned) card include 'cast' with an EMPTY mana pool", () => {
            const dauthi = makeInstance(dauthiVoidwalker.id, {
                id: "dauthi5",
                controllerId: "p1",
                ownerId: "p1",
            });
            const grantedCard = makeInstance("test-mh2-black-wire-granted", {
                id: "granted1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "exile",
                types: ["Creature"],
                counters: { void: 1 },
                castableFromExileBy: "p1",
                castableFromExileUntilTurn: 1,
                castFromExileWithoutPayingManaCost: true,
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [dauthi],
                        // Empty pool — the cast is legal ONLY because it's free.
                        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                    }),
                    makePlayer("p2", { exile: [grantedCard] }),
                ],
            });
            const projected = projectPublicState(state, 1, "p1");
            const projGranted = projected.players[1].exile.find(
                (c) => c.id === "granted1"
            )!;
            expect(projGranted.legalActions).toContain("cast");

            // The OPPONENT's own view of the same card carries no affordance
            // — the grant is the caster's alone.
            const projectedForOpp = projectPublicState(state, 1, "p2");
            const projGrantedOpp = projectedForOpp.players[1].exile.find(
                (c) => c.id === "granted1"
            )!;
            expect(projGrantedOpp.legalActions).toBeUndefined();
        });

        it("casts the granted card FROM THE OPPONENT'S EXILE for free — the real cross-player cast-commit seam (issue #1156 chokepoint fix)", () => {
            const grantedCard = makeInstance("test-mh2-black-cast-seam", {
                id: "castSeam1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "exile",
                types: ["Creature"],
                counters: { void: 1 },
                castableFromExileBy: "p1",
                castFromExileWithoutPayingManaCost: true,
            });
            const state = makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", { exile: [grantedCard] }),
                ],
            });

            // Drive the REAL cast-source resolution `announceCast` uses.
            const caster = getPlayer(state, "p1");
            const src = locateCastSource(state, caster, "castSeam1");
            expect(src.zone).toBe("exile");
            expect(src.card?.id).toBe("castSeam1");
            // CR 601.3e — the free-cast waiver zeroes the cost entirely, even
            // though the caster's pool is empty.
            expect(castRawManaCost(state, src.card!, src.zone)).toEqual({});

            // Commit: the card is removed from the OPPONENT's exile (the
            // actual zone it sits in), not the caster's own — the chokepoint
            // fix this issue ships (`findCastableExileCard` / `locateCastSource`
            // used to be same-player-only).
            const owner = castZoneOwner(state, caster, "castSeam1", src.zone);
            expect(owner.id).toBe("p2");
            const removed = owner.exile.find((c) => c.id === "castSeam1");
            expect(removed).toBeDefined();
            const stackItem: StackItem = {
                ...owner.exile.splice(
                    owner.exile.findIndex((c) => c.id === "castSeam1"),
                    1
                )[0],
                castById: "p1",
                targets: [],
            };
            state.stack.push(stackItem);
            resolveTopOfStack(state);

            // A plain creature resolves onto the CASTER's battlefield (CR
            // 601.2i — the caster controls what they cast), never the
            // opponent's.
            expect(
                getPlayer(state, "p1").battlefield.some(
                    (c) => c.id === "castSeam1"
                )
            ).toBe(true);
            expect(
                getPlayer(state, "p2").battlefield.some(
                    (c) => c.id === "castSeam1"
                )
            ).toBe(false);
        });

        it("plays a granted LAND from the opponent's exile onto the CASTER's own battlefield (cross-player applyPlayLandFromExile)", () => {
            const grantedLand = makeInstance("test-mh2-black-land-seam", {
                id: "landSeam1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "exile",
                counters: { void: 1 },
                castableFromExileBy: "p1",
                castFromExileWithoutPayingManaCost: true,
            });
            const state = makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", { exile: [grantedLand] }),
                ],
            });
            const p1 = getPlayer(state, "p1");
            const result = applyPlayLandFromExile(state, p1, "landSeam1");
            expect(result).not.toBeNull();
            // The land leaves the OPPONENT's exile (the actual zone it was
            // in) and lands on the CASTER's own battlefield.
            expect(
                getPlayer(state, "p2").exile.some((c) => c.id === "landSeam1")
            ).toBe(false);
            expect(
                getPlayer(state, "p1").battlefield.some(
                    (c) => c.id === "landSeam1"
                )
            ).toBe(true);
            expect(
                getPlayer(state, "p2").battlefield.some(
                    (c) => c.id === "landSeam1"
                )
            ).toBe(false);
            // The play-from-exile permission flags are consumed on entry.
            const entered = getPlayer(state, "p1").battlefield.find(
                (c) => c.id === "landSeam1"
            )!;
            expect(entered.castableFromExileBy).toBeUndefined();
            expect(entered.castFromExileWithoutPayingManaCost).toBeUndefined();
            // CR 122.1e / 400.7 — the void counter ceases to exist when the
            // land leaves exile; it must NOT ride onto the battlefield.
            expect(entered.counters?.void).toBeUndefined();
        });
    });

    // CR 122.1e / 400.7 — a counter exists only on the object in its current
    // zone; a zone change makes a new object with no counters. Dauthi's
    // void-countered card, once played, must shed its void counter.
    describe("void counter is stripped when the card leaves exile (CR 122.1e / 400.7)", () => {
        it("casting a void-countered card from exile to the stack drops the void counter (removeFromZone)", () => {
            const oppVoidCard = makeInstance("test-mh2-black-cast-seam", {
                id: "voidLeaveExile1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "exile",
                types: ["Creature"],
                counters: { void: 1 },
                castableFromExileBy: "p1",
                castFromExileWithoutPayingManaCost: true,
            });
            const state = makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", { exile: [oppVoidCard] }),
                ],
            });
            // The real cast-commit path removes the card from its actual exile
            // owner (`applyMove.ts` / `search.ts` both call `removeFromZone`).
            const moved = removeFromZone(
                getPlayer(state, "p2"),
                "voidLeaveExile1",
                "exile"
            );
            expect(moved.zone).toBe("stack");
            expect(moved.counters?.void).toBeUndefined();
        });

        it("returning a void-countered card from exile to hand drops the void counter (generic moveCard)", () => {
            const voidCard = makeInstance("test-mh2-black-opp-void", {
                id: "voidToHand1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "exile",
                types: ["Creature"],
                counters: { void: 1 },
            });
            const state = makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", { exile: [voidCard] }),
                ],
            });
            const moved = moveCard(
                getPlayer(state, "p2"),
                "voidToHand1",
                "exile",
                "hand"
            );
            expect(moved.zone).toBe("hand");
            expect(moved.counters?.void).toBeUndefined();
        });
    });

    // CR 122.1 / 400.7 — marked damage is battlefield-only transient state; a
    // creature that dies (Lightning Bolt), is void-exiled and recast enters as
    // a NEW object with 0 marked damage. It must NOT re-enter pre-damaged and
    // die instantly to SBA (issue: recast creature came back with 3 damage on
    // 2 toughness yet alive).
    describe("battlefield-transient state is stripped when a card is recast from exile (CR 122.1 / 400.7)", () => {
        it("a creature recast from exile enters with no marked damage (does not carry its pre-death damage)", () => {
            const bolted = makeInstance("test-mh2-black-cast-seam", {
                id: "recast1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "exile",
                types: ["Creature"],
                // Prior battlefield life: 3 marked damage from Lightning Bolt,
                // preserved as last-known-information through the void-exile.
                damageMarked: 3,
                castableFromExileBy: "p1",
                castFromExileWithoutPayingManaCost: true,
            });
            const state = makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", { exile: [bolted] }),
                ],
            });
            // Real cast-commit path: exile → stack via `removeFromZone`.
            const moved = removeFromZone(
                getPlayer(state, "p2"),
                "recast1",
                "exile"
            );
            state.stack.push({
                ...moved,
                castById: "p1",
                targets: [],
            } as StackItem);
            resolveTopOfStack(state);

            // The 2/2 resolves onto the CASTER's battlefield ALIVE — its stale
            // 3 marked damage did not ride along, so SBA does not destroy it.
            const entered = getPlayer(state, "p1").battlefield.find(
                (c) => c.id === "recast1"
            );
            expect(entered).toBeDefined();
            expect(entered!.damageMarked).toBeUndefined();
            expect(
                getPlayer(state, "p2").graveyard.some((c) => c.id === "recast1")
            ).toBe(false);
        });
    });
});
