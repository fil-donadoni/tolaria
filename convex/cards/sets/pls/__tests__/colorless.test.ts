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
    draco,
    stratadon,
    darigaazsCaldera,
    dromarsCavern,
    meteorCrater,
    rithsGrove,
    skyshipWeatherlight,
    starCompass,
    trevasRuins,
} from "../colorless";
import {
    forest,
    island,
    mountain,
    plains,
    swamp,
    tundra,
} from "../../lea/colorless";
import { yavimayaCradleOfGrowth } from "../../mh2/colorless";
import { blackLotus } from "../../lea/colorless";
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
    applyCostModifiers,
    applySourceStaticEffects,
    canPayMayPayCost,
    getCostModifiers,
    normalizeManaCost,
    normalizeMayPayCost,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { compactState, expandState } from "../../../../gre/serialize";
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

// ─────────────────────────────────────────────────────────────────────────
// C8f — Skyship Weatherlight (CR 400.7 / 701.13, issue #1947). Introduces
// the `randomExileToHand` Op (a genuinely NEW Op — full test regime, not
// the per-Op smoke-sweep) and the `moveZone` `cards` shape's new
// `linkToSource` flag (a parametrization of an EXISTING Op).
// ─────────────────────────────────────────────────────────────────────────

/** Puts Skyship Weatherlight's self-ETB trigger on the stack, mirroring
 *  `fireLairEtb` above. */
function fireSkyshipEtb(state: GameState, skyship: CardInstanceState): void {
    state.stack.push({
        ...skyship,
        zone: "stack",
        castById: skyship.controllerId,
        triggeredAbilityId: "skyship-weatherlight-etb",
        triggerSourceId: skyship.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: skyship.id,
            controllerId: skyship.controllerId,
            types: ["Artifact"],
        } as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
}

/** Puts Skyship Weatherlight's activated ability on the stack. */
function fireSkyshipActivated(
    state: GameState,
    skyship: CardInstanceState
): void {
    state.stack.push({
        ...skyship,
        zone: "stack",
        castById: skyship.controllerId,
        abilityId: "skyship-weatherlight-random",
        targets: [],
    });
    resolveTopOfStack(state);
}

/** Submits the current head pending choice (search-library pick) with the
 *  given ordered ids, mirroring `ice/__tests__/helpers.ts`'s `submitChoice`. */
function submitLibraryPick(state: GameState, cardInstanceIds: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds,
    });
}

describe("Skyship Weatherlight (CR 400.7 / 701.13, issue #1947)", () => {
    describe("ETB — search for any number of artifact and/or creature cards, exile + link, then shuffle", () => {
        function libraryOf(owner: "p1" | "p2") {
            return [
                makeInstance(blackLotus.id, {
                    id: "lotus",
                    controllerId: owner,
                    ownerId: owner,
                    zone: "library",
                }),
                makeInstance(crawWurm.id, {
                    id: "wurm",
                    controllerId: owner,
                    ownerId: owner,
                    zone: "library",
                }),
                makeInstance(lightningBolt.id, {
                    id: "bolt",
                    controllerId: owner,
                    ownerId: owner,
                    zone: "library",
                }),
                makeInstance(forest.id, {
                    id: "forest1",
                    controllerId: owner,
                    ownerId: owner,
                    zone: "library",
                }),
            ];
        }

        it("offers only the artifact/creature cards as candidates (instants and lands are excluded)", () => {
            const skyship = makeInstance(skyshipWeatherlight.id, {
                id: "skyship",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [skyship],
                        library: libraryOf("p1"),
                    }),
                    makePlayer("p2"),
                ],
            });
            fireSkyshipEtb(state, skyship);
            const head = state.pendingChoices![0];
            expect(head.kind).toBe("search-library");
            expect(new Set(head.candidateIds)).toEqual(
                new Set(["lotus", "wurm"])
            );
            // "any number" — clamped down to the 2 matching candidates, not
            // the unbounded Number.MAX_SAFE_INTEGER the card declares.
            expect(head.count).toEqual({ min: 0, max: 2 });
        });

        it("exiling BOTH matches links each to Skyship Weatherlight and shuffles the rest back into the library", () => {
            const skyship = makeInstance(skyshipWeatherlight.id, {
                id: "skyship",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [skyship],
                        library: libraryOf("p1"),
                    }),
                    makePlayer("p2"),
                ],
            });
            fireSkyshipEtb(state, skyship);
            submitLibraryPick(state, ["lotus", "wurm"]);
            expect(state.pendingChoices ?? []).toHaveLength(0);
            // Both moved to the OWNER's exile, linked to Skyship Weatherlight.
            const exileIds = state.players[0].exile.map((c) => c.id).sort();
            expect(exileIds).toEqual(["lotus", "wurm"]);
            for (const c of state.players[0].exile) {
                expect(c.exiledBySourceId).toBe("skyship");
            }
            // The non-matching cards stay in the library (shuffled — order
            // not asserted).
            expect(state.players[0].library.map((c) => c.id).sort()).toEqual([
                "bolt",
                "forest1",
            ]);
        });

        it("choosing ZERO is legal — the search may find nothing exiled (2004-10-04 ruling)", () => {
            const skyship = makeInstance(skyshipWeatherlight.id, {
                id: "skyship",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [skyship],
                        library: libraryOf("p1"),
                    }),
                    makePlayer("p2"),
                ],
            });
            fireSkyshipEtb(state, skyship);
            submitLibraryPick(state, []);
            expect(state.players[0].exile).toHaveLength(0);
            expect(state.players[0].library).toHaveLength(4);
        });
    });

    describe("activated ability — {4},{T}: random pick from the linked pile to its OWNER's hand", () => {
        it("with an empty pile the ability is still activatable and simply does nothing (CR 608.2b)", () => {
            const skyship = makeInstance(skyshipWeatherlight.id, {
                id: "skyship",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [skyship] }),
                    makePlayer("p2"),
                ],
            });
            expect(() => fireSkyshipActivated(state, skyship)).not.toThrow();
            expect(state.players[0].hand).toHaveLength(0);
        });

        it("a single linked card is picked deterministically and moves to its OWNER's hand — even when that owner is NOT the activating player", () => {
            const skyship = makeInstance(skyshipWeatherlight.id, {
                id: "skyship",
                controllerId: "p1",
                ownerId: "p1",
            });
            // CR 400.7 — the linked card sits in P2's exile (an opponent's
            // card the source somehow exiled), proving the destination is
            // the card's OWN owner, not p1 (the activating controller).
            const decoy = makeInstance(crawWurm.id, {
                id: "decoy",
                controllerId: "p2",
                ownerId: "p2",
                zone: "exile",
            });
            const linked = makeInstance(blackLotus.id, {
                id: "linked",
                controllerId: "p2",
                ownerId: "p2",
                zone: "exile",
            });
            linked.exiledBySourceId = "skyship";
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [skyship] }),
                    makePlayer("p2", { exile: [decoy, linked] }),
                ],
            });
            fireSkyshipActivated(state, skyship);
            expect(state.players[1].hand.map((c) => c.id)).toEqual(["linked"]);
            // p1 (the activator) never receives it.
            expect(state.players[0].hand).toHaveLength(0);
            // The unlinked decoy never moves — only the linked pile is
            // eligible, never a card exiled by anything else.
            expect(state.players[1].exile.map((c) => c.id)).toEqual(["decoy"]);
        });

        it("a SECOND Skyship Weatherlight's pile is entirely disjoint — never picks from another source's exile", () => {
            const skyshipA = makeInstance(skyshipWeatherlight.id, {
                id: "skyshipA",
                controllerId: "p1",
                ownerId: "p1",
            });
            const skyshipB = makeInstance(skyshipWeatherlight.id, {
                id: "skyshipB",
                controllerId: "p1",
                ownerId: "p1",
            });
            const linkedToA = makeInstance(blackLotus.id, {
                id: "linkedA",
                controllerId: "p1",
                ownerId: "p1",
                zone: "exile",
            });
            linkedToA.exiledBySourceId = "skyshipA";
            const linkedToB = makeInstance(crawWurm.id, {
                id: "linkedB",
                controllerId: "p1",
                ownerId: "p1",
                zone: "exile",
            });
            linkedToB.exiledBySourceId = "skyshipB";
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [skyshipA, skyshipB],
                        exile: [linkedToA, linkedToB],
                    }),
                    makePlayer("p2"),
                ],
            });
            fireSkyshipActivated(state, skyshipA);
            // Only A's linked card (the sole candidate in A's pile) moved.
            expect(state.players[0].hand.map((c) => c.id)).toEqual(["linkedA"]);
            expect(state.players[0].exile.map((c) => c.id)).toEqual([
                "linkedB",
            ]);
        });

        it("the retrieved card survives the wire projection (owner sees it in hand)", () => {
            const skyship = makeInstance(skyshipWeatherlight.id, {
                id: "skyship",
                controllerId: "p1",
                ownerId: "p1",
            });
            const linked = makeInstance(blackLotus.id, {
                id: "linked",
                controllerId: "p1",
                ownerId: "p1",
                zone: "exile",
            });
            linked.exiledBySourceId = "skyship";
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [skyship],
                        exile: [linked],
                    }),
                    makePlayer("p2"),
                ],
            });
            fireSkyshipActivated(state, skyship);
            expect(state.players[0].hand.map((c) => c.id)).toEqual(["linked"]);
            const projected = projectPublicState(state, 1, "p1");
            expect(projected.players[0].hand.map((c) => c?.card.id)).toContain(
                blackLotus.id
            );
        });

        it("stamps and pick both survive a serializer round trip (CR 400.7 pile persistence)", () => {
            const skyship = makeInstance(skyshipWeatherlight.id, {
                id: "skyship",
                controllerId: "p1",
                ownerId: "p1",
            });
            const linkedA = makeInstance(blackLotus.id, {
                id: "linkedA",
                controllerId: "p1",
                ownerId: "p1",
                zone: "exile",
            });
            linkedA.exiledBySourceId = "skyship";
            const linkedB = makeInstance(crawWurm.id, {
                id: "linkedB",
                controllerId: "p1",
                ownerId: "p1",
                zone: "exile",
            });
            linkedB.exiledBySourceId = "skyship";
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [skyship],
                        exile: [linkedA, linkedB],
                    }),
                    makePlayer("p2"),
                ],
            });
            const round = expandState(compactState(state));
            const roundExile = round.players[0].exile;
            expect(roundExile).toHaveLength(2);
            for (const c of roundExile) {
                expect(c.exiledBySourceId).toBe("skyship");
            }
        });
    });

    describe("Skyship Weatherlight leaving the battlefield (CR 400.7 — the pile does not return)", () => {
        it("the remaining exiled cards stay in exile — they are not returned when the source is destroyed", () => {
            const skyship = makeInstance(skyshipWeatherlight.id, {
                id: "skyship",
                controllerId: "p1",
                ownerId: "p1",
            });
            const linked = makeInstance(blackLotus.id, {
                id: "linked",
                controllerId: "p1",
                ownerId: "p1",
                zone: "exile",
            });
            linked.exiledBySourceId = "skyship";
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [skyship],
                        exile: [linked],
                    }),
                    makePlayer("p2"),
                ],
            });
            removePermanentTo(state, "skyship", "graveyard", "destroy");
            // The card is still sitting in exile — CR 400.7 / the official
            // 2004-10-04 ruling: "If this card leaves the battlefield, the
            // remaining cards that were exiled don't come back."
            expect(state.players[0].exile.map((c) => c.id)).toContain("linked");
            expect(state.players[0].hand).toHaveLength(0);
            expect(state.players[0].library).toHaveLength(0);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// C3 — Domain-driven cost reduction (CR 601.2f / 702 preamble, issue #1958).
// Draco ({16}, {2} less per basic land type) and Stratadon ({10}, {1} less)
// declare `selfCostReduction` in the `countMode: "domain"` shape. Assertions
// drive the SHARED CR 601.2f authority (`getCostModifiers` +
// `applyCostModifiers`) that the payment path, the castability probe, the
// auto-tap solver and the bot's move enumerator all route through — never a
// bespoke Domain calculation.
// ─────────────────────────────────────────────────────────────────────────────

/** Mirrors game.ts's plain hand-cast cost calc: normalize the printed cost,
 *  then fold in cost modifiers (battlefield scan + self-host) — the exact pair
 *  of functions the real cast site calls. */
function effectiveCastCost(
    state: GameState,
    def: CardDefinition,
    controllerId = "p1"
): Record<string, number> {
    const spellView = makeInstance(def.id, {
        id: `${def.id}-spell-view`,
        controllerId,
        zone: "hand",
    });
    const cost = normalizeManaCost(def.manaCost ?? {});
    applyCostModifiers(cost, getCostModifiers(state, spellView, "spell"));
    return cost;
}

/** A board where `p1` controls one land of each of the first `n` basic types —
 *  i.e. exactly Domain `n`. */
function boardWithDomain(n: number, controllerId: "p1" | "p2" = "p1") {
    const lands = [plains, island, swamp, mountain, forest]
        .slice(0, n)
        .map((def, i) =>
            makeInstance(def.id, {
                id: `dom-land-${i}`,
                controllerId,
                ownerId: controllerId,
            })
        );
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: controllerId === "p1" ? lands : [],
            }),
            makePlayer("p2", {
                battlefield: controllerId === "p2" ? lands : [],
            }),
        ],
    });
}

describe("Domain-driven self cost-reduction (CR 601.2f / 702 preamble, issue #1958)", () => {
    it.each([
        [0, 16, 10],
        [1, 14, 9],
        [2, 12, 8],
        [3, 10, 7],
        [4, 8, 6],
        [5, 6, 5],
    ])(
        "Domain %i → Draco costs {%i} and Stratadon costs {%i}",
        (domain, dracoCost, stratadonCost) => {
            const state = boardWithDomain(domain);
            expect(effectiveCastCost(state, draco)).toEqual({ X: dracoCost });
            expect(effectiveCastCost(state, stratadon)).toEqual({
                X: stratadonCost,
            });
        }
    );

    it("counts basic land TYPES, not lands — three Forests are Domain 1, not 3", () => {
        const forests = [0, 1, 2].map((i) =>
            makeInstance(forest.id, {
                id: `forest-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: forests }),
                makePlayer("p2"),
            ],
        });
        // Domain 1 → {2} off Draco, {1} off Stratadon. A permanent-COUNT
        // reduction would have taken {6} / {3} here.
        expect(effectiveCastCost(state, draco)).toEqual({ X: 14 });
        expect(effectiveCastCost(state, stratadon)).toEqual({ X: 9 });
    });

    it("one dual land contributes BOTH of its basic types (CR 305.6) — Tundra alone is Domain 2", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(tundra.id, {
                            id: "tundra-1",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(tundra.subtypes).toEqual(["Plains", "Island"]);
        expect(effectiveCastCost(state, draco)).toEqual({ X: 12 });
        expect(effectiveCastCost(state, stratadon)).toEqual({ X: 8 });
    });

    it("reads land types through the layer pipeline — a layer-4 subtype ADD counts (CR 613.1d)", () => {
        const islandLand = makeInstance(island.id, {
            id: "island-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const yavimaya = makeInstance(yavimayaCradleOfGrowth.id, {
            id: "yavimaya-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [islandLand, yavimaya] }),
                makePlayer("p2"),
            ],
        });
        // Before the static applies, only the printed Island subtype exists.
        expect(effectiveCastCost(state, draco)).toEqual({ X: 14 });
        // "Each land is a Forest in addition to its other types" — the real
        // layer-4 apply pass, not a hand-edited `subtypes` array.
        applySourceStaticEffects(state, yavimaya);
        expect(islandLand.subtypes).toContain("Forest");
        // Island + Forest = Domain 2 → {4} off Draco.
        expect(effectiveCastCost(state, draco)).toEqual({ X: 12 });
        expect(effectiveCastCost(state, stratadon)).toEqual({ X: 8 });
    });

    it("counts only the CASTER's own lands, never an opponent's (CR 601.2f 'you control')", () => {
        const state = boardWithDomain(5, "p2");
        expect(effectiveCastCost(state, draco, "p1")).toEqual({ X: 16 });
        expect(effectiveCastCost(state, stratadon, "p1")).toEqual({ X: 10 });
    });

    it("counts by CONTROLLER, not owner — a stolen land still feeds its controller's Domain (CR 110.4)", () => {
        // The Forest is OWNED by p2 but sits under p1's control; it is parked
        // in p2's battlefield array, which is exactly the shape a control
        // change leaves behind, so a `player.battlefield`-only scan would
        // miss it.
        const stolen = makeInstance(forest.id, {
            id: "stolen-forest",
            controllerId: "p1",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [stolen] }),
            ],
        });
        expect(effectiveCastCost(state, draco, "p1")).toEqual({ X: 14 });
        expect(effectiveCastCost(state, draco, "p2")).toEqual({ X: 16 });
    });

    it("is generic-only and never goes below zero (CR 601.2f / 118.9)", () => {
        // Draco at Domain 5 reduces by {10}. Applied to a hypothetical
        // {1}{U}{U} cost, the single generic pip is removed and the coloured
        // pips are untouched — the reduction never underflows into them.
        const state = boardWithDomain(5);
        const spellView = makeInstance(draco.id, {
            id: "draco-spell-view",
            controllerId: "p1",
            zone: "hand",
        });
        const modifiers = getCostModifiers(state, spellView, "spell");
        expect(modifiers.reductionGeneric).toBe(10);
        const cost: Record<string, number> = { X: 1, U: 2 };
        applyCostModifiers(cost, modifiers);
        expect(cost).toEqual({ U: 2 });
    });

    it("castability: NOT offered at Domain 0, offered once Domain makes it affordable", () => {
        function stateWithDracoInHand(domain: number) {
            const lands = [plains, island, swamp, mountain, forest]
                .slice(0, domain)
                .map((def, i) =>
                    makeInstance(def.id, {
                        id: `cast-land-${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                );
            const dracoCard = makeInstance(draco.id, {
                id: "draco-hand",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            return makeState({
                players: [
                    makePlayer("p1", {
                        hand: [dracoCard],
                        battlefield: lands,
                        // Six colourless floating — enough for the Domain-5
                        // price of {6}, nowhere near the printed {16}.
                        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 6 },
                    }),
                    makePlayer("p2"),
                ],
            });
        }
        const poor = stateWithDracoInHand(0);
        expect(
            getLegalActions(poor, poor.players[0], poor.players[0].hand[0])
        ).not.toContain("cast");

        const rich = stateWithDracoInHand(5);
        expect(
            getLegalActions(rich, rich.players[0], rich.players[0].hand[0])
        ).toContain("cast");

        // The flip survives the wire projection (GRE → UI full path).
        const projected = projectPublicState(rich, 1, "p1");
        const projectedDraco = projected.players[0]
            .hand[0] as CardInstanceState;
        expect(
            getLegalActions(
                projected as unknown as GameState,
                projected.players[0] as never,
                projectedDraco
            )
        ).toContain("cast");
    });
});

/** Puts Draco's upkeep trigger on the stack as if it had fired on its
 *  controller's upkeep, then resolves — mirroring `fireLairEtb` above and the
 *  Collapsing Borders `fireUpkeep` idiom (`inv/__tests__/red.test.ts`). */
function fireDracoUpkeep(state: GameState, dracoPerm: CardInstanceState): void {
    state.stack.push({
        ...dracoPerm,
        zone: "stack",
        castById: dracoPerm.controllerId,
        triggeredAbilityId: "draco-upkeep",
        triggerSourceId: dracoPerm.id,
        triggerEvent: {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: dracoPerm.controllerId,
        } as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
}

/** Draco on the battlefield plus `domain` distinct basic land types and
 *  `mana` colourless floating. */
function dracoUpkeepBoard(domain: number, mana: number) {
    const dracoPerm = makeInstance(draco.id, {
        id: "draco-perm",
        controllerId: "p1",
        ownerId: "p1",
    });
    const lands = [plains, island, swamp, mountain, forest]
        .slice(0, domain)
        .map((def, i) =>
            makeInstance(def.id, {
                id: `upkeep-land-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [dracoPerm, ...lands],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: mana },
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
    });
    return { state, dracoPerm };
}

describe("Draco upkeep — {10} reduced by {2} per basic land type (CR 118 'unless', issue #1958)", () => {
    it.each([
        [0, 10],
        [1, 8],
        [3, 4],
        [4, 2],
    ])("Domain %i prices the upkeep at {%i}", (domain, owed) => {
        const { state, dracoPerm } = dracoUpkeepBoard(domain, 0);
        fireDracoUpkeep(state, dracoPerm);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.playerId).toBe("p1");
        expect(
            normalizeManaCost(normalizeMayPayCost(head.cost!).mana ?? {})
        ).toEqual({ X: owed });
    });

    it("Domain 5 floors the upkeep at {0} — never negative (CR 118.9)", () => {
        const { state, dracoPerm } = dracoUpkeepBoard(5, 0);
        fireDracoUpkeep(state, dracoPerm);
        const head = state.pendingChoices![0];
        // {10} - 5 × {2} = {0}; `reduceGenericMana` drops the generic entry
        // entirely rather than emitting a negative one.
        expect(normalizeMayPayCost(head.cost!).mana ?? {}).toEqual({});
        expect(canPayMayPayCost(state, "p1", head.cost!)).toBe(true);
    });

    it("paying keeps Draco and spends the reduced amount", () => {
        // Domain 3 → {4} owed; exactly {4} floating.
        const { state, dracoPerm } = dracoUpkeepBoard(3, 4);
        fireDracoUpkeep(state, dracoPerm);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(
            state.players[0].battlefield.some((c) => c.id === dracoPerm.id)
        ).toBe(true);
        expect(state.players[0].manaPool.C).toBe(0);
        expect(state.players[0].graveyard).toHaveLength(0);
    });

    it("declining sacrifices Draco (CR 701.16)", () => {
        const { state, dracoPerm } = dracoUpkeepBoard(3, 4);
        fireDracoUpkeep(state, dracoPerm);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(
            state.players[0].battlefield.some((c) => c.id === dracoPerm.id)
        ).toBe(false);
        expect(
            state.players[0].graveyard.some((c) => c.id === dracoPerm.id)
        ).toBe(true);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("the priced prompt survives the wire projection (projectPublicState)", () => {
        const { state, dracoPerm } = dracoUpkeepBoard(2, 0);
        fireDracoUpkeep(state, dracoPerm);
        const projected = projectPublicState(state, 1, "p1");
        const head = projected.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        // {10} - 2 × {2} = {6} — the price the client renders, not the
        // printed {10}.
        expect(
            normalizeManaCost(normalizeMayPayCost(head.cost!).mana ?? {})
        ).toEqual({ X: 6 });
    });
});
