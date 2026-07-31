// Planeshift (PLS) — black behavior tests (ADR 0043 colour split, issue #1940).
//
// Warped Devotion reuses `PERMANENT_LEFT` (CR 603.10) via `leftTrigger({
// scope: "any", toZone: "hand" })` plus a new `EVENT_FIELD_REGISTRY` row
// (`PERMANENT_LEFT.ownerId`, ADR 0049) — a genuinely new construct
// combination (a `{ ref: "$event.ownerId" }` read of the LEAVING permanent's
// owner rather than `ctx.controller`) that the auto-generated
// canned-scenario smoke sweep cannot drive: its generator treats ANY
// `{ ref: "$event.*" }` player parameter as "depends on a runtime snapshot"
// and reports an explicit skip (`scenarioGenerator.ts`'s
// `resolveScenarioPlayer`), exactly the signal documented in
// `.claude/rules/gre-development.md` to add a hand-written test — mirroring
// Collapsing Borders' own hand-written test (`inv/__tests__/red.test.ts`)
// for the identical reason. Per the per-Op regime (ADR 0045/0046) this earns
// its own coverage here.

import { describe, it, expect } from "vitest";
import {
    warpedDevotion,
    noxiousVapors,
    lordOfTheUndead,
    sinisterStrength,
    nightscapeFamiliar,
    nightscapeBattlemage,
    phyrexianBloodstock,
} from "../black";
import {
    unsummon,
    savannahLions,
    grizzlyBears,
    island,
    earthquake,
    darkRitual,
} from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveTriggerOrder,
} from "../../../__tests__/setup";
import {
    applyOneTargetSelection,
    advanceTargetGroupOrFinalize,
} from "../../../../game";
import {
    resolveTopOfStack,
    removePermanentTo,
    processPendingActionTriggers,
    buildSpellContext,
    drawCard,
    emitCardDrawn,
    getPlayer,
    getCostModifiers,
    applySourceStaticEffects,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../../../../gre/layers";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { applySacrificeSelection } from "../../../../gre/sacrificeChoice";
import {
    getLegalTargets,
    pendingTargetFiltersFromRequirement,
} from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import { registerTokenDefinition } from "../../..";

/** Resolves an activated ability directly against a real source permanent,
 *  mirroring the per-set shim already used by `inv/__tests__/black.test.ts`
 *  for the identical shape (Lord of the Undead's graveyard-return ability). */
function resolveActivated(
    state: GameState,
    source: ReturnType<typeof makeInstance>,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

/** Answers the head `pendingChoices` entry (a `choice(kind: "choose-hand-card")`
 *  suspension) with the given card instance id (CR 608.2). */
function submitDiscard(state: GameState, cardInstanceId: string): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [cardInstanceId],
    });
}

describe("Warped Devotion (CR 603.2 returned-to-hand trigger, issue #1940)", () => {
    it("fires when an OPPONENT's creature is bounced by a spell, and the OPPONENT (not Warped Devotion's controller) discards", () => {
        const bounced = makeInstance(savannahLions.id, {
            id: "bounced",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const p2Filler = makeInstance(grizzlyBears.id, {
            id: "p2-filler",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const devotion = makeInstance(warpedDevotion.id, {
            id: "devotion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [devotion],
                    library: [makeInstance(unsummon.id, { zone: "library" })],
                }),
                makePlayer("p2", { battlefield: [bounced], hand: [p2Filler] }),
            ],
        });
        const unsummonItem = pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bounced" },
        ]);
        // Unsummon resolves (moveZone → returnToHand → removePermanentTo,
        // the shared zone-move funnel), which places Warped Devotion's
        // trigger on the stack automatically (resolveTopOfStack drains
        // pendingEvents via processPendingActionTriggers).
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "warped-devotion-bounce"
        );
        // Warped Devotion's ability resolves; its `choice` Op suspends
        // waiting for the DISCARDING PLAYER's own pick (CR 608.2).
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        // The player who must discard is p2 — the RETURNING permanent's
        // owner — even though Warped Devotion's controller is p1. Proves the
        // ability reads `$event.ownerId`, not `ctx.controller`.
        expect(head.playerId).toBe("p2");
        expect(state.players[1].hand.map((c) => c.id).sort()).toEqual(
            ["bounced", "p2-filler"].sort()
        );
        submitDiscard(state, "p2-filler");
        // The bounced creature itself stays in hand (a real discard-a-card
        // choice, not an auto-pick of the just-returned permanent).
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["bounced"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual([
            "p2-filler",
        ]);
        // p1 (Warped Devotion's own controller) never discards — only the
        // resolved Unsummon spell itself sits in their graveyard.
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            unsummonItem.id,
        ]);

        // Wire format — same assertions survive the projection (both zones
        // are public here: CR 400.3/ADR 0026 made "bounced" known to all,
        // and a graveyard is always public).
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].hand).toHaveLength(1);
        expect(
            projected.players[1].graveyard.some((c) => c.id === "p2-filler")
        ).toBe(true);
    });

    it("fires symmetrically when Warped Devotion's OWN controller bounces their own creature — they discard too", () => {
        const bounced = makeInstance(savannahLions.id, {
            id: "self-bounced",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const p1Filler = makeInstance(grizzlyBears.id, {
            id: "p1-filler",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const devotion = makeInstance(warpedDevotion.id, {
            id: "devotion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [devotion, bounced],
                    hand: [
                        p1Filler,
                        makeInstance(unsummon.id, { zone: "hand" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "self-bounced" },
        ]);
        resolveTopOfStack(state); // Unsummon
        resolveTopOfStack(state); // Warped Devotion — suspends on choice
        expect(state.pendingChoices![0].playerId).toBe("p1");
        submitDiscard(state, "p1-filler");
        expect(
            state.players[0].graveyard.some((c) => c.id === "p1-filler")
        ).toBe(true);
    });

    it("fires once per permanent when one effect returns two permanents simultaneously", () => {
        const bounced1 = makeInstance(savannahLions.id, {
            id: "bounced-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const bounced2 = makeInstance(grizzlyBears.id, {
            id: "bounced-2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const devotion = makeInstance(warpedDevotion.id, {
            id: "devotion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1Filler = makeInstance(grizzlyBears.id, {
            id: "p1-filler-2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p2Filler = makeInstance(savannahLions.id, {
            id: "p2-filler-2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [devotion, bounced1],
                    hand: [p1Filler],
                }),
                makePlayer("p2", {
                    battlefield: [bounced2],
                    hand: [p2Filler],
                }),
            ],
        });
        // Simulates a single resolving effect that bounces BOTH permanents in
        // one step (e.g. a "return each creature" sweep) — every
        // battlefield-sourced bounce, single or bulk, funnels through this
        // same `removePermanentTo` primitive, once per permanent moved.
        removePermanentTo(state, "bounced-1", "hand");
        removePermanentTo(state, "bounced-2", "hand");
        processPendingActionTriggers(state);
        // Two firings of the SAME printed ability auto-order in collection
        // order (ADR 0003) — no player ordering choice is owed, they just
        // land on the stack directly.
        expect(state.stack).toHaveLength(2);

        resolveTopOfStack(state);
        let head = state.pendingChoices![0];
        submitDiscard(
            state,
            head.playerId === "p1" ? "p1-filler-2" : "p2-filler-2"
        );

        resolveTopOfStack(state);
        head = state.pendingChoices![0];
        submitDiscard(
            state,
            head.playerId === "p1" ? "p1-filler-2" : "p2-filler-2"
        );

        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "p1-filler-2"
        );
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            "p2-filler-2"
        );
    });

    it("fires when a permanent is returned to hand as a COST PAYMENT (sacrificeChoice action: return)", () => {
        // `applySacrificeSelection` with `action: "return"` is the exact
        // real-path function backing every return-to-hand alternative /
        // additional cost (Gush/Thwart, Kicker return-costs — CR 118.9 /
        // 701.24). It bounces via `removePermanentTo`, the SAME funnel a
        // spell effect uses, so it fires PERMANENT_LEFT (toZone: "hand")
        // identically — no separate wiring needed for a cost-driven bounce.
        const paidIsland = makeInstance(island.id, {
            id: "island-cost",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const p1Filler = makeInstance(grizzlyBears.id, {
            id: "p1-filler-cost",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const devotion = makeInstance(warpedDevotion.id, {
            id: "devotion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [devotion, paidIsland],
                    hand: [p1Filler],
                }),
                makePlayer("p2"),
            ],
        });
        applySacrificeSelection(state, {
            playerId: "p1",
            reason: "Gush-style return-to-hand cost",
            requirements: [{ filter: { subtypes: "Island" }, count: 1 }],
            picked: ["island-cost"],
            action: "return",
        });
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "warped-devotion-bounce"
        );
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].playerId).toBe("p1");
        submitDiscard(state, "p1-filler-cost");
        expect(
            state.players[0].graveyard.some((c) => c.id === "p1-filler-cost")
        ).toBe(true);
    });

    it("does NOT fire on a real draw (library → hand never touches the battlefield)", () => {
        const devotion = makeInstance(warpedDevotion.id, {
            id: "devotion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [devotion],
                    library: [
                        makeInstance(savannahLions.id, { zone: "library" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const stackBefore = state.stack.length;
        // Real draw path — the same two calls `commitDrawPlan`'s "normal"
        // case makes: `drawCard` actually moves the card library → hand,
        // `emitCardDrawn` queues the real CARD_DRAWN event. No
        // PERMANENT_LEFT is ever involved — the card was never a
        // battlefield permanent.
        expect(drawCard(getPlayer(state, "p1"))).not.toBeNull();
        emitCardDrawn(state, "p1", 1);
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(stackBefore);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("does NOT fire on a real graveyard → hand move (e.g. a Regrowth-style effect)", () => {
        const devotion = makeInstance(warpedDevotion.id, {
            id: "devotion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const inGraveyard = makeInstance(savannahLions.id, {
            id: "gy-card",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [devotion],
                    graveyard: [inGraveyard],
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, grizzlyBears.id, "p1");
        const ctx = buildSpellContext(state, item);
        const stackBefore = state.stack.length;
        // Real zone-move path: `moveCardById` routes through
        // `moveCardWithGraveyardReplacement`, NEVER `removePermanentTo` — a
        // graveyard card isn't a battlefield permanent, so PERMANENT_LEFT
        // never fires regardless of destination zone.
        ctx.moveCardById("p1", "gy-card", "graveyard", "hand");
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(stackBefore);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].hand.some((c) => c.id === "gy-card")).toBe(
            true
        );
    });
});

// Noxious Vapors — new Op (`chooseCategorized`, issue #1945) → full per-Op
// regime: the interpreter suite (`gre/effects/__tests__/interpreter.test.ts`)
// covers the Op's general shape (hand/battlefield, sweep, bipartite matching,
// both auto-resolve paths); this describe proves the CARD's own script end
// to end through the real resolution path, symmetric across BOTH players in
// one cast (CR 601.2b "each player", APNAP order via `forEach { set:
// "players" }`).
const NV_ARTIFACT_ID = "test-pls-nv-artifact";
registerTokenDefinition({
    id: NV_ARTIFACT_ID,
    name: NV_ARTIFACT_ID,
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Artifact"],
});

describe("Noxious Vapors (CR 601.2b / 701.9, issue #1945)", () => {
    it("each player keeps one card of each colour they hold and discards every other nonland card, in APNAP order", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        // TWO white creatures — a real "which one" decision
                        // (a single candidate would auto-resolve with no
                        // prompt, per the forced-pick path). Plus a
                        // colourless artifact and a land.
                        makeInstance(savannahLions.id, {
                            id: "p1-white-a",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                        makeInstance(savannahLions.id, {
                            id: "p1-white-b",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                        makeInstance(NV_ARTIFACT_ID, {
                            id: "p1-artifact",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                        makeInstance(island.id, {
                            id: "p1-island-card",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    hand: [
                        // Green only — p2 has no card of any OTHER colour, a
                        // FORCED (single-candidate) pick that auto-resolves
                        // with no prompt.
                        makeInstance(grizzlyBears.id, {
                            id: "p2-green",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                    ],
                }),
            ],
        });
        pushSpell(state, noxiousVapors.id, "p1");
        // p1's choice is a real decision (two White candidates) — suspends.
        // p2's is FORCED (one card, one colour) and auto-resolves once
        // p1's answer lets the forEach reach it, so only ONE choice is ever
        // raised (CR 608.2b — never prompt for a non-decision).
        expect(resolveTopOfStack(state)).toBeNull();

        // APNAP: the active player (p1, the caster) answers first.
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p1");
        expect(head.kind).toBe("choose-categorized");
        expect(head.zone).toBe("hand");
        // Oracle sequencing: "Each player REVEALS their hand, [then] chooses
        // one card of each color…" — ALL reveals precede ANY choice, so p2's
        // hand is already public to p1 while p1 is still deciding. (Two
        // sibling `forEach { set: "players" }` blocks; folding the reveal into
        // the choice loop would let p1 decide with less information than the
        // card grants.)
        expect(state.players[1].hand[0].knownTo).toEqual(
            expect.arrayContaining(["p1", "p2"])
        );
        expect(state.players[0].hand[0].knownTo).toEqual(
            expect.arrayContaining(["p1", "p2"])
        );
        expect(head.categories).toEqual(
            expect.arrayContaining([
                { label: "White", cardIds: ["p1-white-a", "p1-white-b"] },
            ])
        );
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["p1-white-a"],
        });

        // p2's forced pick auto-resolved in the same pass — nothing left
        // pending.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        // p1 keeps ONE white creature AND the land (lands are never
        // discarded); the other white creature and the colourless artifact
        // are both swept (nonland, not kept).
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual(
            ["p1-island-card", "p1-white-a"].sort()
        );
        // The resolved sorcery itself also lands in its owner's graveyard
        // (CR 608.2m, under its OWN generated instance id) alongside the two
        // swept cards — filter it out by DEFINITION id to isolate the sweep.
        const p1GraveyardSweptIds = state.players[0].graveyard
            .filter((c) => c.card.id !== noxiousVapors.id)
            .map((c) => c.id)
            .sort();
        expect(p1GraveyardSweptIds).toEqual(
            ["p1-artifact", "p1-white-b"].sort()
        );
        expect(
            state.players[0].graveyard.some(
                (c) => c.card.id === noxiousVapors.id
            )
        ).toBe(true);
        // p2 keeps their only card (nothing else to sweep).
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["p2-green"]);
        expect(state.players[1].graveyard).toHaveLength(0);

        // Wire format: the projection agrees with the fat state for both
        // viewers (ADR 0045 GRE testing convention).
        const projectedP1 = projectPublicState(state, 1, "p1");
        expect(projectedP1.players[0].hand.map((c) => c?.id).sort()).toEqual(
            ["p1-island-card", "p1-white-a"].sort()
        );
        const projectedSweptIds = projectedP1.players[0].graveyard
            .filter((c) => c.card.id !== noxiousVapors.id)
            .map((c) => c.id)
            .sort();
        expect(projectedSweptIds).toEqual(["p1-artifact", "p1-white-b"].sort());
    });
});

// Lord of the Undead — a `staticEffects[]` anthem (CR 611 layer 7c) MUST have
// its own hand-written GRE + wire-format test per the project's testing
// convention table (staticEffects[] is outside the Effect Script DSL
// entirely, so the per-Op regime does not cover it) — mirrors Lord of
// Atlantis's own test shape (`lea/__tests__/blue.test.ts`) exactly.
describe("Lord of the Undead (CR 611 layer 7c anthem + CR 400.7 graveyard-return, PLS 44)", () => {
    it("buffs other Zombies +1/+1 but excludes itself and non-Zombies", () => {
        const lord = makeInstance(lordOfTheUndead.id, { id: "lord" });
        const otherZombie = makeInstance(grizzlyBears.id, {
            id: "other-zombie",
            subtypes: ["Zombie"],
        });
        const nonZombie = makeInstance(savannahLions.id, { id: "non-zombie" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [lord, otherZombie, nonZombie],
                }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, otherZombie)).toBe(3);
        expect(getEffectiveToughness(state, otherZombie)).toBe(3);
        expect(getEffectivePower(state, nonZombie)).toBe(2);
        expect(getEffectivePower(state, lord)).toBe(2);
        expect(getEffectiveToughness(state, lord)).toBe(2);

        // Wire format — the same reads survive the projection (ADR 0045 GRE
        // testing convention's mandatory wire-format re-assertion).
        const projected = projectPublicState(state, 1, "p1");
        const slimZombie = projected.players[0].battlefield.find(
            (c) => c.id === "other-zombie"
        )!;
        expect(getEffectivePower(projected, slimZombie)).toBe(3);
        expect(getEffectiveToughness(projected, slimZombie)).toBe(3);
    });

    it("returns a targeted Zombie card from the controller's own graveyard to hand ({1}{B}, {T})", () => {
        const lord = makeInstance(lordOfTheUndead.id, { id: "lord" });
        const gyZombie = makeInstance(grizzlyBears.id, {
            id: "gy-zombie",
            subtypes: ["Zombie"],
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [lord],
                    graveyard: [gyZombie],
                    manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, lord, "lord-of-the-undead-return", [
            { type: "graveyard-card", id: "gy-zombie", playerId: "p1" },
        ]);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["gy-zombie"]);
        expect(state.players[0].graveyard).toHaveLength(0);
    });

    // Issue #1950 review, BLOCKER 2 — `subtypeFilter` on a `zone: "graveyard"`
    // requirement is the FIRST pairing of the two in the catalogue. Proves
    // the single-authority registry gate (`CARD_FILTER_KEYS`) enforces it on
    // BOTH the offered set (`getLegalTargets`) and the accepted set
    // (`applyOneTargetSelection`, the real `selectTarget` logic) — a
    // non-Zombie creature card is neither offered nor accepted.
    it("neither offers nor accepts a non-Zombie creature card as the graveyard-return target", () => {
        const lord = makeInstance(lordOfTheUndead.id, { id: "lord" });
        const gyZombie = makeInstance(grizzlyBears.id, {
            id: "gy-zombie-guard",
            subtypes: ["Zombie"],
            zone: "graveyard",
        });
        const gyBear = makeInstance(grizzlyBears.id, {
            id: "gy-bear-guard",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [lord],
                    graveyard: [gyZombie, gyBear],
                }),
                makePlayer("p2"),
            ],
        });
        const req = lordOfTheUndead.activatedAbilities![0].targetRequirement!;

        // Offered set (`getLegalTargets`): the Bear is never in it.
        const legal = getLegalTargets(state, req, [], "p1");
        const legalIds = legal
            .filter((t) => t.type === "graveyard-card")
            .map((t) => t.id);
        expect(legalIds).toContain("gy-zombie-guard");
        expect(legalIds).not.toContain("gy-bear-guard");

        // Accepted set (`applyOneTargetSelection`, the real `selectTarget`
        // logic): submitting the Bear anyway is rejected, not silently
        // honored — the same `pendingTargetFiltersFromRequirement` carry the
        // real activation path uses.
        state.pendingTarget = {
            playerId: "p1",
            cardInstanceId: "lord",
            targetType: req.type,
            count: 1,
            selected: [],
            kind: "ability",
            abilityId: "lord-of-the-undead-return",
            ...pendingTargetFiltersFromRequirement(req, undefined),
        };
        expect(() =>
            applyOneTargetSelection(state, "p1", {
                targetType: "graveyard-card",
                targetId: "gy-bear-guard",
                targetPlayerId: "p1",
            })
        ).toThrow();
    });
});

// Sinister Strength — an Aura `staticEffects[]` pt-buff + color-grant pair
// (CR 611 layer 7c / layer 5), mandatory hand-written GRE + wire test per the
// same convention as Lord of the Undead above — mirrors Kormus Bell's own
// pt-cda + color-grant pairing (`lea/__tests__/colorless.test.ts`). The
// colour clause is a documented DIVERGENCE (issue #1950 review round 2,
// BLOCKER 1, tracked-by #2009 — see the card's own comment): CR 613.1e makes
// "is black" a layer-5 colour SET, and the engine's only layer-5 static
// effect (`color-grant`) is additive, so the host keeps its printed colour
// AND gains black rather than becoming black outright. This ADDITIVE shape
// was confirmed to DOMINATE shipping no grant at all — every
// `excludeColors`/`colorFilter`/protection interaction a bare grant gets
// wrong, dropping the grant gets wrong too, so the honest fix is to ship the
// grant, not omit it. This test asserts the shipped (additive) behaviour.
describe("Sinister Strength (CR 303.4 aura, layer 7c pt-buff + layer 5 color-grant; colour SET deferred to #2009, PLS 54)", () => {
    it("gives the enchanted creature +3/+1 and ADDS black (colour SET deferred — host keeps its printed colour too)", () => {
        const host = makeInstance(savannahLions.id, { id: "host" });
        const aura = makeInstance(sinisterStrength.id, {
            id: "aura",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        // pt-buff is read live through the layer pipeline (Unholy Strength's
        // own pattern) — no separate "apply" step needed.
        // Savannah Lions is a printed 2/1 (`lea/white.ts`); +3/+1 → 5/2.
        expect(getEffectivePower(state, host)).toBe(5);
        expect(getEffectiveToughness(state, host)).toBe(2);
        // color-grant is a materialized (`grantedColors`) effect, applied via
        // `applySourceStaticEffects` (Kormus Bell's own precedent) rather than
        // read live. Additive (tracked-by #2009): the host is BOTH white
        // (printed) and black (granted), not black-only.
        applySourceStaticEffects(state, aura);
        expect(STATIC_EFFECT_CTX.getColors(host)).toEqual(
            expect.arrayContaining(["W", "B"])
        );

        // Wire format — the pt-buff read survives the projection.
        const projected = projectPublicState(state, 1, "p1");
        const slimHost = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slimHost)).toBe(5);
        expect(getEffectiveToughness(projected, slimHost)).toBe(2);
    });
});

// Nightscape Familiar — a `cost-modifier` static effect scoped to TWO
// colours (CR 601.2f), mirroring Derelor's own dedicated behavior test
// (`fem/__tests__/black.test.ts`) for the identical static-effect kind.
describe("Nightscape Familiar (CR 601.2f cost reduction for blue AND red spells, PLS 48)", () => {
    it("reduces the controller's own blue and red spells by {1}, but not black or an opponent's", () => {
        const familiar = makeInstance(nightscapeFamiliar.id, { id: "fam" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [familiar] }),
                makePlayer("p2"),
            ],
        });
        const myBlueSpell = makeInstance(unsummon.id, {
            id: "my-blue",
            zone: "hand",
        });
        const myRedSpell = makeInstance(earthquake.id, {
            id: "my-red",
            zone: "hand",
        });
        const myBlackSpell = makeInstance(darkRitual.id, {
            id: "my-black",
            zone: "hand",
        });
        const oppBlueSpell = makeInstance(unsummon.id, {
            id: "opp-blue",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        expect(
            getCostModifiers(state, myBlueSpell, "spell").reductionGeneric
        ).toBe(1);
        expect(
            getCostModifiers(state, myRedSpell, "spell").reductionGeneric
        ).toBe(1);
        expect(
            getCostModifiers(state, myBlackSpell, "spell").reductionGeneric
        ).toBe(0);
        expect(
            getCostModifiers(state, oppBlueSpell, "spell").reductionGeneric
        ).toBe(0);
    });

    it("carries a real regenerate activated ability ({1}{B})", () => {
        const familiar = makeInstance(nightscapeFamiliar.id, { id: "fam" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [familiar],
                    manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 1 },
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, familiar, "nightscape-familiar-regen");
        const onField = state.players[0].battlefield.find(
            (c) => c.id === "fam"
        )!;
        expect(onField.regenerationShields ?? 0).toBeGreaterThanOrEqual(1);
    });
});

// Nightscape Battlemage — the plural-Kicker "and/or" flagship (CR 702.33,
// ADR 0079, issue #1950). New construct combination — a triggered ability's
// own `condition`/`interveningIf` reading the new `PermanentView.kickerPayments`
// field — that the catalogue-wide auto-generated smoke sweep cannot drive
// (its generator explicitly skips any script reading `kickerPaid`/
// `kickerCount`, and this card's per-Kicker gate lives OUTSIDE `effects[]`
// entirely, in the trigger's own `condition`/`interveningIf` callbacks). Per
// the per-Op regime (ADR 0045/0046) this earns its own coverage here, mirroring
// Jacked Rabbit's own hand-written intervening-if test
// (`blc/__tests__/white.test.ts`) for the identical one-shot-fact shape.
describe("Nightscape Battlemage (CR 702.33 plural Kicker — two independent ETB triggers, PLS 47)", () => {
    it("fires NEITHER ETB trigger when cast unkicked", () => {
        const oppCreature = makeInstance(grizzlyBears.id, {
            id: "opp-creature",
            controllerId: "p2",
            ownerId: "p2",
        });
        const land = makeInstance(island.id, { id: "a-land" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2", { battlefield: [oppCreature] }),
            ],
        });
        pushSpell(state, nightscapeBattlemage.id, "p1");
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "opp-creature",
        ]);
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "a-land"
        );
    });

    it("fires ONLY the bounce trigger when kicked with just its {2}{U} kicker", () => {
        const oppCreature = makeInstance(grizzlyBears.id, {
            id: "opp-creature",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [oppCreature] }),
            ],
        });
        const item = pushSpell(state, nightscapeBattlemage.id, "p1");
        item.kickerPayments = { "kicker-u": 1 };
        resolveTopOfStack(state); // creature resolves, ETB trigger lands
        // "Up to two" (CR 601.2c min:0) never auto-selects even with a single
        // legal candidate — the caster's own explicit pick, then finalize.
        expect(state.pendingTarget).toBeDefined();
        applyOneTargetSelection(state, "p1", {
            targetType: "permanent",
            targetId: "opp-creature",
        });
        advanceTargetGroupOrFinalize(state, state.pendingTarget!, "p1");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "nightscape-battlemage-bounce"
        );
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        expect(state.players[1].hand.some((c) => c.id === "opp-creature")).toBe(
            true
        );
        expect(state.players[1].battlefield).toHaveLength(0);

        // Wire format — the bounced creature is visible in the projected hand.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[1].hand.some((c) => c?.id === "opp-creature")
        ).toBe(true);
    });

    it("fires ONLY the destroy-land trigger when kicked with just its {2}{R} kicker", () => {
        const land = makeInstance(island.id, {
            id: "opp-land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        const item = pushSpell(state, nightscapeBattlemage.id, "p1");
        item.kickerPayments = { "kicker-r": 1 };
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "nightscape-battlemage-destroy-land"
        );
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(
            state.players[1].graveyard.some((c) => c.id === "opp-land")
        ).toBe(true);
    });

    it("fires BOTH ETB triggers independently when kicked with both kickers", () => {
        const oppCreature = makeInstance(grizzlyBears.id, {
            id: "opp-creature-both",
            controllerId: "p2",
            ownerId: "p2",
        });
        const land = makeInstance(island.id, {
            id: "opp-land-both",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [oppCreature, land] }),
            ],
        });
        const item = pushSpell(state, nightscapeBattlemage.id, "p1");
        item.kickerPayments = { "kicker-u": 1, "kicker-r": 1 };
        resolveTopOfStack(state);
        // Two simultaneous triggers under the SAME controller (p1) suspend on
        // a CR 603.3b trigger-order choice (ADR 0058) before landing; the
        // bounce trigger's own "up to two" target (CR 601.2c min:0) then
        // raises its own pendingTarget in turn (chained, one at a time).
        resolveTriggerOrder(state);
        if (state.pendingTarget) {
            applyOneTargetSelection(state, "p1", {
                targetType: "permanent",
                targetId: "opp-creature-both",
            });
            advanceTargetGroupOrFinalize(state, state.pendingTarget!, "p1");
        }
        expect(state.stack).toHaveLength(2);
        resolveTopOfStack(state);
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        expect(
            state.players[1].hand.some((c) => c.id === "opp-creature-both")
        ).toBe(true);
        expect(
            state.players[1].graveyard.some((c) => c.id === "opp-land-both")
        ).toBe(true);
    });
});

// Phyrexian Bloodstock — the FIRST leaves-the-battlefield trigger in the
// catalogue with a CR 603.3d announcement-time target (`leftTrigger`'s
// `targetRequirement`, added this issue mirroring
// `EnteredTriggerArgs.targetRequirement` exactly). New construct combination
// for the `leftTrigger` factory — earns its own coverage here per the same
// per-Op-regime rationale as Nightscape Battlemage above.
describe("Phyrexian Bloodstock (CR 603.10 leaves-the-battlefield trigger with a target, PLS 50)", () => {
    it("destroys a targeted white creature when it leaves the battlefield", () => {
        const bloodstock = makeInstance(phyrexianBloodstock.id, {
            id: "bloodstock",
        });
        const whiteCreature = makeInstance(savannahLions.id, {
            id: "white-victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bloodstock] }),
                makePlayer("p2", { battlefield: [whiteCreature] }),
            ],
        });
        removePermanentTo(state, "bloodstock", "graveyard");
        processPendingActionTriggers(state);
        // A single legal target (CR 603.3d) auto-selects — the trigger lands
        // on the stack ready to resolve, mirroring Palace Jailer's own
        // sole-legal-target precedent (`cn2/__tests__/white.test.ts`).
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "phyrexian-bloodstock-ltb"
        );
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(
            state.players[1].graveyard.some((c) => c.id === "white-victim")
        ).toBe(true);

        // Wire format — the destroyed creature's absence survives the
        // projection.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].battlefield).toHaveLength(0);
    });
});
