// PLS (Planeshift) — colorless card behavior tests (ADR 0043 colour split).
//
// The Lair cycle (CR 117.3a / 701.16 / 701.24, issue #1938): each land's ETB
// offers a may-pay PERMANENT return leg (ADR 0079 `CostLegs`, issue #1933)
// with a "not $paid" sacrifice fallback (CR 118 "unless"). The `mayPay` +
// `if` + `sacrifice` Op combination is already exercised at the interpreter
// level by `convex/gre/__tests__/may-pay-return-leg.test.ts` (the
// `mayPayReturnLegProbe` fixture carries this exact Oracle shape) — this
// suite is the CARD-level proof the auto-generated smoke test explicitly
// skips (`scenarioGenerator` treats `mayPay`/`sacrifice` as "covered by the
// card's own suspension/resume tests").

import { describe, it, expect } from "vitest";
import {
    crosissCatacombs,
    darigaazsCaldera,
    dromarsCavern,
    meteorCrater,
    rithsGrove,
    starCompass,
    trevasRuins,
} from "../colorless";
import { forest, island, mountain, plains, swamp } from "../../lea/colorless";
import { crawWurm } from "../../lea/green";
import { lightningBolt } from "../../lea/red";
import { quirionExplorer } from "../green";
import { fellwarStone } from "../../drk/colorless";
import {
    getDefinitionProducibleColors,
    getEffectiveManaChoices,
    getManaTapOptionsDetailed,
    getProducibleColors,
} from "../../../../gre/constants";
import { getLegalActions } from "../../../../gre/rules";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { CardDefinition } from "../../../types";
import {
    canPayMayPayCost,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { tapSourceIntoPayment } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";

function lairInstance(def: CardDefinition, id: string): CardInstanceState {
    return makeInstance(def.id, { id, controllerId: "p1", ownerId: "p1" });
}

function nonLairLand(id: string): CardInstanceState {
    return makeInstance(forest.id, { id, controllerId: "p1", ownerId: "p1" });
}

/** Puts a Lair's self-ETB trigger on the stack with its `triggerSourceId` set,
 *  mirroring `fireReturnLegEtb` (`gre/__tests__/fixtures/mayPayReturnLegProbe.ts`). */
function fireLairEtb(
    state: GameState,
    lair: CardInstanceState,
    triggerId: string
): void {
    state.stack.push({
        ...lair,
        zone: "stack",
        castById: lair.controllerId,
        triggeredAbilityId: triggerId,
        triggerSourceId: lair.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: lair.id,
            controllerId: lair.controllerId,
            types: ["Land"],
        } as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
}

const LAIR_CYCLE = [
    {
        def: crosissCatacombs,
        triggerId: "crosiss-catacombs-etb",
        colors: ["U", "B", "R"] as const,
    },
    {
        def: darigaazsCaldera,
        triggerId: "darigaazs-caldera-etb",
        colors: ["B", "R", "G"] as const,
    },
    {
        def: dromarsCavern,
        triggerId: "dromars-cavern-etb",
        colors: ["W", "U", "B"] as const,
    },
    {
        def: rithsGrove,
        triggerId: "riths-grove-etb",
        colors: ["R", "G", "W"] as const,
    },
    {
        def: trevasRuins,
        triggerId: "trevas-ruins-etb",
        colors: ["G", "W", "U"] as const,
    },
];

describe("Planeshift Lair cycle (CR 117.3a / 701.16 / 701.24, issue #1938)", () => {
    for (const { def, triggerId, colors } of LAIR_CYCLE) {
        describe(def.name, () => {
            it("is a Land — Lair with one ETB trigger and one {T} tri-colour mana ability", () => {
                expect(def.types).toEqual(["Land"]);
                expect(def.subtypes).toEqual(["Lair"]);
                expect(def.triggeredAbilities).toHaveLength(1);
                expect(def.triggeredAbilities![0].id).toBe(triggerId);
                const mana = def.activatedAbilities?.[0];
                expect(mana?.cost).toEqual({ tap: true });
                expect(mana?.useStack).toBe(false);
                expect(mana?.manaChoices).toEqual([
                    { [colors[0]]: 1 },
                    { [colors[1]]: 1 },
                    { [colors[2]]: 1 },
                ]);
            });

            it("taps for each of its three colours (CR 605.1a)", () => {
                for (const [index, color] of colors.entries()) {
                    const land = lairInstance(def, "land");
                    const player = makePlayer("p1", { battlefield: [land] });
                    const state = makeState({
                        players: [player, makePlayer("p2")],
                    });
                    state.activePlayerId = "p1";
                    tapSourceIntoPayment(state, player, land, index, []);
                    expect(player.manaPool[color]).toBe(1);
                }
            });

            it("accept: returns the chosen non-Lair land and the Lair survives (CR 118 'unless')", () => {
                const lair = lairInstance(def, "lair");
                const keep = nonLairLand("keep");
                const bounce = nonLairLand("bounce");
                const state = makeState({
                    players: [
                        makePlayer("p1", { battlefield: [lair, keep, bounce] }),
                        makePlayer("p2"),
                    ],
                });
                fireLairEtb(state, lair, triggerId);
                applyMayPaySubmit(state, {
                    playerId: "p1",
                    accept: true,
                    sacrificeIds: ["bounce"],
                });
                const p1 = state.players[0];
                expect(p1.hand.map((c) => c.id)).toEqual(["bounce"]);
                expect(p1.battlefield.map((c) => c.id)).toEqual([
                    "lair",
                    "keep",
                ]);
                expect(p1.graveyard).toHaveLength(0);
            });

            it("decline: sacrifices the Lair with no further prompt (CR 118 'unless')", () => {
                const lair = lairInstance(def, "lair");
                const other = nonLairLand("other");
                const state = makeState({
                    players: [
                        makePlayer("p1", { battlefield: [lair, other] }),
                        makePlayer("p2"),
                    ],
                });
                fireLairEtb(state, lair, triggerId);
                applyMayPaySubmit(state, { playerId: "p1", accept: false });
                const p1 = state.players[0];
                expect(p1.battlefield.map((c) => c.id)).toEqual(["other"]);
                expect(p1.graveyard.some((c) => c.id === "lair")).toBe(true);
                expect(p1.hand).toHaveLength(0);
                expect(state.pendingChoices ?? []).toHaveLength(0);
            });
        });
    }

    it("the cost filter excludes EVERY Lair, not just the entering one", () => {
        const enteringLair = lairInstance(crosissCatacombs, "entering-lair");
        const otherLair = lairInstance(darigaazsCaldera, "other-lair");
        const legalLand = nonLairLand("legal-land");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [enteringLair, otherLair, legalLand],
                }),
                makePlayer("p2"),
            ],
        });
        fireLairEtb(state, enteringLair, "crosiss-catacombs-etb");
        const head = state.pendingChoices![0];
        // Neither the entering Lair nor the pre-existing Lair is offered —
        // only the genuinely non-Lair land.
        expect(head.candidateIds).toEqual(["legal-land"]);
    });

    it("with no legal non-Lair land, the Lair is sacrificed and the choice is still surfaced", () => {
        const lair = lairInstance(crosissCatacombs, "lair");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lair] }),
                makePlayer("p2"),
            ],
        });
        fireLairEtb(state, lair, "crosiss-catacombs-etb");
        const head = state.pendingChoices![0];
        // The offer is still surfaced (CR 118 "unless" — a forced outcome is
        // still information the player must see) even though there is no
        // legal candidate to accept. With zero candidates the return leg's
        // picker never lights up (`mayPaySacrificeChoiceRequired` is false),
        // so `candidateIds` stays unset rather than an empty array.
        expect(head.kind).toBe("may-pay");
        expect(head.candidateIds).toBeUndefined();
        expect(canPayMayPayCost(state, "p1", head.cost!)).toBe(false);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        const p1 = state.players[0];
        expect(p1.graveyard.some((c) => c.id === "lair")).toBe(true);
    });

    it("the prompt and its outcome survive the wire projection (projectPublicState)", () => {
        const lair = lairInstance(crosissCatacombs, "lair");
        const forestLand = nonLairLand("forest-land");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lair, forestLand] }),
                makePlayer("p2"),
            ],
        });
        fireLairEtb(state, lair, "crosiss-catacombs-etb");

        const projected = projectPublicState(state, 1, "p1");
        const head = projected.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.permanentAction).toBe("return");
        expect(head.candidateIds).toEqual(["forest-land"]);

        applyMayPaySubmit(state, {
            playerId: "p1",
            accept: true,
            sacrificeIds: ["forest-land"],
        });
        const afterProjection = projectPublicState(state, 2, "p1");
        const p1 = afterProjection.players[0];
        expect(p1.battlefield.map((c) => c.id)).toEqual(["lair"]);
        expect(p1.hand).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// C6 — Board-derived restricted-colour mana abilities (CR 605.1a, issue #1941).
// Star Compass and Meteor Crater declare `ActivatedAbility.manaColorSource`
// descriptors that exercise the two orthogonal axes: WHICH permanents
// contribute (a `PermanentFilter` — a BASIC land you control vs. ANY permanent
// you control) and HOW each yields a colour (`"produces"`, CR 106.4 — what it
// could tap for — vs. `"isColor"`, CR 105.2 — what colour it IS). Assertions
// drive the shared authorities (`getEffectiveManaChoices`,
// `getManaTapOptionsDetailed`), not the descriptor in isolation.
// ─────────────────────────────────────────────────────────────────────────────

/** The `battlefields` argument every board-derived mana consumer takes. */
function manaBoards(state: GameState) {
    return state.players.map((p) => ({
        playerId: p.id,
        battlefield: p.battlefield,
    }));
}

function manaChoicesFor(
    state: GameState,
    source: CardInstanceState,
    controllerId: string
) {
    return getEffectiveManaChoices(source, controllerId, manaBoards(state));
}

describe("Star Compass (CR 110.5b + 605.1a / 106.4 — colours YOUR basic lands could produce)", () => {
    it("is a {2} artifact that enters tapped, with the modern oracle text", () => {
        expect(starCompass.manaCost).toEqual({ X: 2 });
        expect(starCompass.types).toEqual(["Artifact"]);
        expect(starCompass.entersTapped).toBe(true);
        expect(starCompass.oracleText).toBe(
            "This artifact enters tapped.\n{T}: Add one mana of any color that a basic land you control could produce."
        );
    });

    it("is a mana ability — resolves immediately, never uses the stack (CR 605.3a)", () => {
        const ability = starCompass.activatedAbilities![0];
        expect(ability.useStack).toBe(false);
        expect(ability.cost).toEqual({ tap: true });
    });

    it("offers one mana of each colour the controller's BASIC lands produce", () => {
        const compass = makeInstance(starCompass.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        compass,
                        makeInstance(forest.id, { controllerId: "p1" }),
                        makeInstance(island.id, { controllerId: "p1" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(manaChoicesFor(state, compass, "p1")).toEqual([
            { U: 1 },
            { G: 1 },
        ]);
    });

    it("ignores NONBASIC lands (a Lair produces three colours and contributes none)", () => {
        const compass = makeInstance(starCompass.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        compass,
                        // Crosis's Catacombs taps for {U}/{B}/{R} but has no
                        // Basic supertype (CR 205.4a).
                        makeInstance(crosissCatacombs.id, {
                            controllerId: "p1",
                        }),
                        makeInstance(plains.id, { controllerId: "p1" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(manaChoicesFor(state, compass, "p1")).toEqual([{ W: 1 }]);
    });

    it("ignores the OPPONENT's basic lands (CR 109.5 — 'you')", () => {
        const compass = makeInstance(starCompass.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [compass] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(mountain.id, { controllerId: "p2" }),
                    ],
                }),
            ],
        });
        expect(manaChoicesFor(state, compass, "p1")).toEqual([]);
        expect(
            getManaTapOptionsDetailed(compass, "p1", manaBoards(state))
        ).toHaveLength(0);
    });

    it("the restricted colour set is visible to the castability gate", () => {
        const bolt = makeInstance(lightningBolt.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const compass = makeInstance(starCompass.id, { controllerId: "p1" });
        // The controller's only land is TAPPED, so Star Compass is the only
        // available source — but a tapped land still "could produce" its
        // colour (CR 106.4), so the compass reads {R} off it.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [bolt],
                    battlefield: [
                        compass,
                        makeInstance(mountain.id, {
                            controllerId: "p1",
                            isTapped: true,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(getLegalActions(state, state.players[0], bolt)).toContain(
            "cast"
        );

        // Swap the tapped Mountain for a tapped Forest: the compass now offers
        // only {G} and Bolt is correctly reported NOT castable.
        state.players[0].battlefield[1] = makeInstance(forest.id, {
            controllerId: "p1",
            isTapped: true,
        });
        expect(getLegalActions(state, state.players[0], bolt)).not.toContain(
            "cast"
        );
    });

    it("survives the wire projection — the client's picker matches the server's list", () => {
        const compass = makeInstance(starCompass.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        compass,
                        makeInstance(swamp.id, { controllerId: "p1" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const onFat = manaChoicesFor(state, compass, "p1");
        expect(onFat).toEqual([{ B: 1 }]);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === compass.id
        )! as unknown as CardInstanceState;
        expect(
            getEffectiveManaChoices(
                slim,
                "p1",
                projected.players.map((p) => ({
                    playerId: p.id,
                    battlefield:
                        p.battlefield as unknown as CardInstanceState[],
                }))
            )
        ).toEqual(onFat);
    });
});

describe("Meteor Crater (CR 605.1a / 105.2 — a COLOUR OF a permanent you control)", () => {
    it("is a land with the modern oracle text", () => {
        expect(meteorCrater.manaCost).toEqual({});
        expect(meteorCrater.types).toEqual(["Land"]);
        expect(meteorCrater.oracleText).toBe(
            "{T}: Choose a color of a permanent you control. Add one mana of that color."
        );
    });

    it("is a mana ability — resolves immediately, never uses the stack (CR 605.3a)", () => {
        const ability = meteorCrater.activatedAbilities![0];
        expect(ability.useStack).toBe(false);
        expect(ability.cost).toEqual({ tap: true });
    });

    it("reads what a permanent IS, not what it produces — a Forest contributes nothing", () => {
        const crater = makeInstance(meteorCrater.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        crater,
                        // A Forest taps for {G} but is a COLOURLESS land
                        // (CR 202.2 — no mana cost, no colour), so the
                        // "isColor" derivation reads nothing off it.
                        makeInstance(forest.id, { controllerId: "p1" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(manaChoicesFor(state, crater, "p1")).toEqual([]);
        expect(
            getManaTapOptionsDetailed(crater, "p1", manaBoards(state))
        ).toHaveLength(0);
    });

    it("offers the colours of ANY permanent the controller has, not just lands", () => {
        const crater = makeInstance(meteorCrater.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        crater,
                        // {3}{G} — a green permanent (CR 202.2).
                        makeInstance(crawWurm.id, { controllerId: "p1" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(manaChoicesFor(state, crater, "p1")).toEqual([{ G: 1 }]);
    });

    it("ignores the OPPONENT's permanents (CR 109.5 — 'you')", () => {
        const crater = makeInstance(meteorCrater.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [crater] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(crawWurm.id, { controllerId: "p2" }),
                    ],
                }),
            ],
        });
        expect(manaChoicesFor(state, crater, "p1")).toEqual([]);
    });

    it("survives the wire projection — the client's picker matches the server's list", () => {
        const crater = makeInstance(meteorCrater.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        crater,
                        makeInstance(crawWurm.id, { controllerId: "p1" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const onFat = manaChoicesFor(state, crater, "p1");
        expect(onFat).toEqual([{ G: 1 }]);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === crater.id
        )! as unknown as CardInstanceState;
        expect(
            getEffectiveManaChoices(
                slim,
                "p1",
                projected.players.map((p) => ({
                    playerId: p.id,
                    battlefield:
                        p.battlefield as unknown as CardInstanceState[],
                }))
            )
        ).toEqual(onFat);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// CR 106.4 — a DESCRIPTOR mana ability's static `manaChoices` is a no-board
// FALLBACK, not a "could produce" claim. Unioning it into
// `producibleColorsFromAbilities` made every `manaColorSource` permanent read
// as a WUBRG source, so a lone Meteor Crater (which right now can produce
// NOTHING — its controller has no other permanent) inflated every CR 106.4
// consumer: Quirion Explorer / Fellwar Stone offered all five colours, and the
// castability gate reported Lightning Bolt castable off illegal mana
// (CR 605.1a). The `"produces"` read is now descriptor-AWARE — it evaluates
// the contributing permanent's own `manaColorSource` against the SAME board,
// bounded at one level of nesting (`MAX_NESTED_MANA_COLOR_SOURCE_DEPTH`).
// ─────────────────────────────────────────────────────────────────────────────
describe("descriptor sources don't inflate CR 106.4 'could produce' (issue #1941)", () => {
    /** p2's only permanent is a Meteor Crater — a Land whose colour set is
     *  board-derived and currently EMPTY (p2 controls no other permanent). */
    function boardWithLoneMeteorCrater(mine: CardInstanceState) {
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(meteorCrater.id, { controllerId: "p2" }),
                    ],
                }),
            ],
        });
    }

    it("Quirion Explorer offers nothing off an opponent's lone Meteor Crater", () => {
        const explorer = makeInstance(quirionExplorer.id, {
            controllerId: "p1",
        });
        const state = boardWithLoneMeteorCrater(explorer);
        expect(manaChoicesFor(state, explorer, "p1")).toEqual([]);
        expect(
            getManaTapOptionsDetailed(explorer, "p1", manaBoards(state))
        ).toHaveLength(0);
    });

    it("Fellwar Stone offers nothing off an opponent's lone Meteor Crater", () => {
        const stone = makeInstance(fellwarStone.id, { controllerId: "p1" });
        const state = boardWithLoneMeteorCrater(stone);
        expect(manaChoicesFor(state, stone, "p1")).toEqual([]);
    });

    it("Lightning Bolt is NOT castable off the inflated colour set", () => {
        const bolt = makeInstance(lightningBolt.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const explorer = makeInstance(quirionExplorer.id, {
            controllerId: "p1",
        });
        const state = boardWithLoneMeteorCrater(explorer);
        state.players[0].hand = [bolt];
        expect(getLegalActions(state, state.players[0], bolt)).not.toContain(
            "cast"
        );
    });

    it("one level of nesting IS honoured — an opponent's Meteor Crater next to a green creature is a green source", () => {
        const explorer = makeInstance(quirionExplorer.id, {
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [explorer] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(meteorCrater.id, { controllerId: "p2" }),
                        makeInstance(crawWurm.id, { controllerId: "p2" }),
                    ],
                }),
            ],
        });
        expect(manaChoicesFor(state, explorer, "p1")).toEqual([{ G: 1 }]);
    });

    it("definition-level 'could produce' reports no colour for a board-derived source", () => {
        // Off a battlefield there is no board to read, so a descriptor source
        // contributes nothing — NOT the five-colour fallback list (which the
        // limited drafter's Fixing Value term would read as perfect fixing).
        expect(getDefinitionProducibleColors(meteorCrater).size).toBe(0);
        expect(getDefinitionProducibleColors(starCompass).size).toBe(0);
        expect(getDefinitionProducibleColors(quirionExplorer).size).toBe(0);
        expect(getDefinitionProducibleColors(fellwarStone).size).toBe(0);
        // The instance-level twin agrees when given no board.
        expect(getProducibleColors(makeInstance(meteorCrater.id)).size).toBe(0);
    });
});
