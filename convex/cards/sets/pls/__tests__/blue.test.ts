// Planeshift (PLS) — blue behavior tests (ADR 0043 colour split, issue #1945).
//
// Planar Overlay uses the NEW `chooseCategorized` Op (issue #1945). The
// interpreter suite (`gre/effects/__tests__/interpreter.test.ts`) covers the
// Op's general shape (hand/battlefield, sweep, bipartite matching, both
// auto-resolve paths); this file proves the CARD's own script end to end
// through the real resolution path, symmetric across BOTH players in one
// cast (CR 601.2b "each player", APNAP order via `forEach { set: "players"
// }`).

import { describe, it, expect } from "vitest";
import {
    planarOverlay,
    alliedStrategies,
    escapeRoutes,
    gainsay,
    huntingDrake,
    planeswalkersMischief,
    rushingRiver,
    seaSnidd,
    sisaysIngenuity,
    sleepingPotion,
    stormscapeBattlemage,
    stormscapeFamiliar,
    sunkenHope,
    confound,
    waterspoutElemental,
} from "../blue";
import { thornscapeBattlemage } from "../green";
import { urzasRage } from "../../inv/red";
import { stoneRain } from "../../lea/red";
import {
    getLegalTargets,
    pendingTargetFiltersFromRequirement,
    NO_TARGETING_SOURCE,
} from "../../../../gre/rules";
import {
    lowerSpellOnlyFilters,
    SPELL_ONLY_FILTER_KEYS,
} from "../../../../gre/targetFilters";
import type { CardDefinition } from "../../../types";
import {
    plains,
    island,
    tundra,
    mountain,
    swamp,
    grizzlyBears,
    savannahLions,
    scatheZombies,
    lightningBolt,
} from "../../lea";
import { opt } from "../../inv/blue";
import { applyOneTargetSelection } from "../../../../game";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveTriggerOrder,
} from "../../../__tests__/setup";
import {
    applySourceStaticEffects,
    getCostModifiers,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { compactState, expandState } from "../../../../gre/serialize";
import { fireDelayedTriggers } from "../../../../gre/phases";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import type { KickerPayments } from "../../../../gre/kicker";

/** Pushes a triggered ability directly onto the stack (bypassing the real
 *  cast/announcement pipeline) and resolves it — the established shape
 *  every per-colour test file uses for a card-def `TriggeredAbility`
 *  (`inv/__tests__/helpers.ts`'s `resolveTrigger`, PLS red's `bmTrigger`,
 *  issue #1951/PR #2005). `source` carries the ability; `targets` is
 *  pre-announced (CR 603.3d target ANNOUNCEMENT itself is a separate,
 *  already-tested engine concern — `raiseTriggerTargetSelection`,
 *  `gre/rules.ts` — not re-exercised per card here). */
function pushTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"],
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets,
    });
    resolveTopOfStack(state);
}

/** Pushes an activated ability (the card's own, or a `grantTemplates[]`
 *  ability granted to a host via `grantedSourceCardId`) directly onto the
 *  stack and resolves it — mirrors `inv/__tests__/helpers.ts`'s
 *  `resolveActivated`. */
function pushActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = [],
    grantedSourceCardId?: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
        ...(grantedSourceCardId ? { grantedSourceCardId } : {}),
    });
    resolveTopOfStack(state);
}

/** Answers the head `pendingChoices` entry (mirrors
 *  `inv/__tests__/helpers.ts`'s `submitChoice`). */
function submitChoice(state: GameState, cardInstanceIds: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds,
    });
}

/** Drains the stack, resolving every pending item (including any
 *  `trigger-order` PendingChoice a simultaneous same-controller batch
 *  raises — CR 603.3b, ADR 0058). Mirrors `rtr/__tests__/green.test.ts`'s
 *  Worldspine Wurm `drainStack`. */
function drainStack(state: GameState): void {
    let guard = 0;
    while (
        (state.stack.length > 0 || (state.pendingChoices?.length ?? 0) > 0) &&
        guard++ < 10
    ) {
        if (state.pendingChoices?.[0]?.kind === "trigger-order") {
            resolveTriggerOrder(state);
            continue;
        }
        if (state.stack.length === 0) break;
        resolveTopOfStack(state);
    }
}

function submitCategorized(state: GameState, picks: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: picks,
    });
}

describe("Planar Overlay (CR 601.2b / 400.7, issue #1945)", () => {
    it("lets a DUAL land answer two basic types at once — the 1-land answer is legal (Gatherer ruling)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(plains.id, {
                            id: "p1-plains",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        // A Plains/Island dual — one physical land can cover
                        // BOTH categories in the same nomination.
                        makeInstance(tundra.id, {
                            id: "p1-tundra",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        // An untouched extra Plains — no `sweep`, so it must
                        // survive regardless of which land answers "Plains".
                        makeInstance(plains.id, {
                            id: "p1-plains2",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        // TWO Mountains — a real "which one" decision (a
                        // single candidate would auto-resolve with no
                        // prompt, per the forced-pick path).
                        makeInstance(mountain.id, {
                            id: "p2-mountain-a",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                        makeInstance(mountain.id, {
                            id: "p2-mountain-b",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        pushSpell(state, planarOverlay.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();

        // APNAP: the active player (p1, the caster) answers first.
        let head = state.pendingChoices![0];
        expect(head.playerId).toBe("p1");
        expect(head.kind).toBe("choose-categorized");
        expect(head.zone).toBe("battlefield");
        // Gatherer: "If you have a land which counts as multiple land types,
        // you can choose that land as each of those types. For example, a
        // dual land could be chosen as two of your land types." So the FLOOR
        // is 1 — the Tundra alone answers both Plains and Island — while the
        // ceiling is 2 (a plain Plains for "Plains", the Tundra for
        // "Island"). Forcing min 2 would make the player return two lands the
        // rules never asked for.
        expect(head.count).toEqual({ min: 1, max: 2 });
        expect(head.categoryRule).toBe("cover");
        submitCategorized(state, ["p1-tundra"]);

        // p2 answers next — two Mountains, a real decision (Mountain has 2
        // candidates, so this is NOT the forced-pick path).
        head = state.pendingChoices![0];
        expect(head.playerId).toBe("p2");
        expect(head.count).toEqual({ min: 1, max: 1 });
        submitCategorized(state, ["p2-mountain-a"]);

        expect(state.pendingChoices ?? []).toHaveLength(0);
        // p1: ONLY the dual bounces — both Plains stay on the battlefield
        // (no `sweep`; the Oracle text never mentions the un-nominated
        // lands, and the dual answered the Plains category too).
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["p1-tundra"]);
        expect(state.players[0].battlefield.map((c) => c.id).sort()).toEqual(
            ["p1-plains", "p1-plains2"].sort()
        );
        // p2: the nominated Mountain bounces; the other Mountain is
        // untouched (no `sweep`).
        expect(state.players[1].hand.map((c) => c.id)).toEqual([
            "p2-mountain-a",
        ]);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "p2-mountain-b",
        ]);

        // Wire format: the projection agrees with the fat state for both
        // viewers (ADR 0045 GRE testing convention).
        const projectedP1 = projectPublicState(state, 1, "p1");
        expect(projectedP1.players[0].hand.map((c) => c?.id)).toEqual([
            "p1-tundra",
        ]);
        expect(
            projectedP1.players[0].battlefield.map((c) => c.id).sort()
        ).toEqual(["p1-plains", "p1-plains2"].sort());
        expect(projectedP1.players[1].battlefield.map((c) => c.id)).toEqual([
            "p2-mountain-b",
        ]);
    });

    it("also accepts the 2-land answer — which lands answer which types is the PLAYER's choice", () => {
        // The same board as above: nominating the plain Plains for "Plains"
        // and the dual for "Island" is equally legal, and returns two lands.
        // The rules give the player both answers; the engine must not pick
        // for them.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(plains.id, {
                            id: "p1-plains",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        makeInstance(tundra.id, {
                            id: "p1-tundra",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, planarOverlay.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        expect(state.pendingChoices![0].count).toEqual({ min: 1, max: 2 });
        submitCategorized(state, ["p1-plains", "p1-tundra"]);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual(
            ["p1-plains", "p1-tundra"].sort()
        );
        expect(state.players[0].battlefield).toHaveLength(0);
    });

    it("rejects an answer that leaves a basic land type unanswered", () => {
        // The plain Plains alone answers "Plains" but nothing answers
        // "Island" — an incomplete nomination, rejected server-side.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(plains.id, {
                            id: "p1-plains",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        makeInstance(tundra.id, {
                            id: "p1-tundra",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, planarOverlay.id, "p1");
        resolveTopOfStack(state);
        expect(() => submitCategorized(state, ["p1-plains"])).toThrow(
            /don't answer one category each/
        );
    });

    it("auto-resolves with no prompt for a player with no basic-typed land at all", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(island.id, {
                            id: "p1-island",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                // p2 controls no land at all — the forced/zero-branch skip
                // must not raise a picker for them.
                makePlayer("p2"),
            ],
        });
        pushSpell(state, planarOverlay.id, "p1");
        // p1's single Island is a forced, non-branching pick (one category,
        // one candidate) — auto-resolves; p2 has nothing at all — also
        // auto-resolves. The whole spell completes with no suspend.
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["p1-island"]);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[1].hand).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Free tranche (parent PRD #1935, issue #1949) hand-written coverage. Per
// the per-Op regime, most of this slice's cards need no hand-written test —
// but the auto-generated smoke sweep (`effectScriptSmoke.test.ts`) emits an
// explicit SKIP-with-reason for several of them (a live suspending choice /
// optionChoice / spell-target / runtime-selected-set the canned generator
// can't drive), which is this project's signal to add the hand-written test
// the skip reason names. This block covers every such skip plus both
// `resolve()` sites (mandatory full regime, gre-development.md § Card
// testing convention).
// ─────────────────────────────────────────────────────────────────────────

describe("Allied Strategies (Domain draw, CR 702 preamble)", () => {
    it("target player draws a card for each basic land type among lands they control", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(plains.id, {
                            id: "as-plains",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        makeInstance(island.id, {
                            id: "as-island",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        makeInstance(swamp.id, {
                            id: "as-swamp",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "as-lib1",
                            zone: "library",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        makeInstance(grizzlyBears.id, {
                            id: "as-lib2",
                            zone: "library",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        makeInstance(grizzlyBears.id, {
                            id: "as-lib3",
                            zone: "library",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, alliedStrategies.id, "p1", [
            { type: "player", id: "p1" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(3);
    });

    it("draws zero cards for a target player with no basic land types among their lands", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, alliedStrategies.id, "p1", [
            { type: "player", id: "p1" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(0);
    });
});

describe("Escape Routes (activated bounce, CR 400.7)", () => {
    it("returns a white creature you control to its owner's hand", () => {
        const routes = makeInstance(escapeRoutes.id, {
            id: "routes",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lions = makeInstance(savannahLions.id, {
            id: "er-lions",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [routes, lions] }),
                makePlayer("p2"),
            ],
        });
        pushActivated(state, routes, "escape-routes-bounce", [
            { type: "permanent", id: "er-lions" },
        ]);
        expect(state.players[0].hand.some((c) => c.id === "er-lions")).toBe(
            true
        );
        expect(
            state.players[0].battlefield.some((c) => c.id === "er-lions")
        ).toBe(false);
    });
});

describe("Gainsay (counter target blue spell, CR 701.6a)", () => {
    it("counters a blue spell on the stack", () => {
        const state = makeState();
        const optItem = pushSpell(state, opt.id, "p2");
        pushSpell(state, gainsay.id, "p1", [{ type: "spell", id: optItem.id }]);
        resolveTopOfStack(state);
        expect(state.stack.find((s) => s.id === optItem.id)).toBeUndefined();
    });
});

describe("Hunting Drake (ETB put target red/green creature on owner's library top, CR 603.6a)", () => {
    it("puts the targeted green creature on top of its owner's library", () => {
        const drake = makeInstance(huntingDrake.id, {
            id: "drake",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "hd-bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [drake] }),
                makePlayer("p2", { battlefield: [bear], library: [] }),
            ],
        });
        pushTrigger(
            state,
            drake,
            "hunting-drake-etb",
            {
                type: "PERMANENT_ENTERED",
                instanceId: "drake",
                controllerId: "p1",
                types: drake.types,
            } as StackItem["triggerEvent"],
            [{ type: "permanent", id: "hd-bear" }]
        );
        expect(
            state.players[1].battlefield.some((c) => c.id === "hd-bear")
        ).toBe(false);
        expect(state.players[1].library[0]?.id).toBe("hd-bear");
    });
});

describe("Rushing River (Kicker—Sacrifice a land, additive second target, CR 702.33a)", () => {
    it("unkicked: returns the single target nonland permanent to its owner's hand", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "rr-bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, rushingRiver.id, "p1", [
            { type: "permanent", id: "rr-bear" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].hand.some((c) => c.id === "rr-bear")).toBe(
            true
        );
    });

    it("kicked: returns BOTH announced targets to their owners' hands", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "rr-bear2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const lions = makeInstance(savannahLions.id, {
            id: "rr-lions2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lions] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const item = pushSpell(state, rushingRiver.id, "p1", [
            { type: "permanent", id: "rr-bear2" },
            { type: "permanent", id: "rr-lions2" },
        ]);
        item.kickerPayments = { kicker: 1 };
        resolveTopOfStack(state);
        expect(state.players[1].hand.some((c) => c.id === "rr-bear2")).toBe(
            true
        );
        expect(state.players[0].hand.some((c) => c.id === "rr-lions2")).toBe(
            true
        );
    });

    // MAJOR 4 (PR #2010 review): kicked Rushing River currently lets the
    // human pick the SAME permanent for both target slots (`getLegalTargets`
    // doesn't dedupe across slots of one spell) — pre-existing engine class
    // spanning seven other shipped cards (Dust to Dust, Reckless Spite,
    // Ashes to Ashes, Barrin's Spite, Restock, Sorrow's Path, General
    // Jarkeld). Sibling PR #2005 is implementing the engine-wide dedupe
    // (`rules.ts`/`game.ts`/`card-utils.ts`); no card-level change needed
    // here once it lands. Not exercised by this file — it is a
    // targeting-legality concern, not this card's own resolution.
});

describe("Sea Snidd (target land becomes the basic land type of your choice, CR 305.7)", () => {
    it("changes a target land's subtype to the chosen basic land type", () => {
        const snidd = makeInstance(seaSnidd.id, {
            id: "snidd",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const targetLand = makeInstance(swamp.id, {
            id: "sniddSwamp",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [snidd] }),
                makePlayer("p2", { battlefield: [targetLand] }),
            ],
        });
        pushActivated(state, snidd, "sea-snidd-land-type", [
            { type: "permanent", id: "sniddSwamp" },
        ]);
        submitChoice(state, ["Island"]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "sniddSwamp")
                ?.subtypes
        ).toEqual(["Island"]);
    });
});

describe("Sisay's Ingenuity (Aura ETB draw + activated-grant colour change, CR 611/613.1e)", () => {
    it("draws a card when the Aura enters", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "si-host",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(sisaysIngenuity.id, {
            id: "ingenuity",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "si-host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [aura, host],
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "si-lib",
                            zone: "library",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushTrigger(state, aura, "sisays-ingenuity-etb-draw", {
            type: "PERMANENT_ENTERED",
            instanceId: "ingenuity",
            controllerId: "p1",
            types: aura.types,
        } as StackItem["triggerEvent"]);
        expect(state.players[0].hand.some((c) => c.id === "si-lib")).toBe(true);
    });

    it("the granted ability sets a target creature's colour to the chosen mode (driven via the host, CR 611/613.1e)", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "si-host2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(savannahLions.id, {
            id: "si-target",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        pushActivated(
            state,
            host,
            "sisays-ingenuity-color",
            [{ type: "permanent", id: "si-target" }],
            sisaysIngenuity.id
        );
        submitChoice(state, ["B"]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "si-target")
                ?.colorOverride
        ).toEqual(["B"]);
    });
});

describe("Sleeping Potion (untap lock + becomes-target sacrifice, CR 502.1 / 603.2b)", () => {
    it("taps the enchanted creature when the Aura enters (ETB, resolve())", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "sp-host",
            controllerId: "p2",
            ownerId: "p2",
        });
        const potion = makeInstance(sleepingPotion.id, {
            id: "potion",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "sp-host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [potion] }),
                makePlayer("p2", { battlefield: [host] }),
            ],
        });
        pushTrigger(state, potion, "sleeping-potion-etb-tap", {
            type: "PERMANENT_ENTERED",
            instanceId: "potion",
            controllerId: "p1",
            types: potion.types,
        } as StackItem["triggerEvent"]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "sp-host")
                ?.isTapped
        ).toBe(true);
    });

    it("wire format: the tapped host survives projectPublicState (mandatory — the resolve() effect is board-visible)", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "sp-host-wire",
            controllerId: "p2",
            ownerId: "p2",
        });
        const potion = makeInstance(sleepingPotion.id, {
            id: "potion-wire",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "sp-host-wire",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [potion] }),
                makePlayer("p2", { battlefield: [host] }),
            ],
        });
        pushTrigger(state, potion, "sleeping-potion-etb-tap", {
            type: "PERMANENT_ENTERED",
            instanceId: "potion-wire",
            controllerId: "p1",
            types: potion.types,
        } as StackItem["triggerEvent"]);
        const projected = projectPublicState(state, 1, "p1");
        const slimHost = projected.players[1].battlefield.find(
            (c) => c.id === "sp-host-wire"
        )!;
        expect(slimHost.isTapped).toBe(true);
    });

    it("grants the host does-not-untap unconditionally while the Aura is attached", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "sp-host2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const potion = makeInstance(sleepingPotion.id, {
            id: "potion2",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "sp-host2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [potion] }),
                makePlayer("p2", { battlefield: [host] }),
            ],
        });
        applySourceStaticEffects(state, potion);
        expect(host.staticAbilities).toContain("does-not-untap");
    });

    it("sacrifices itself when the enchanted creature becomes the target of a spell or ability", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "sp-host3",
            controllerId: "p2",
            ownerId: "p2",
        });
        const potion = makeInstance(sleepingPotion.id, {
            id: "potion3",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "sp-host3",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [potion] }),
                makePlayer("p2", { battlefield: [host] }),
            ],
        });
        pushTrigger(state, potion, "sleeping-potion-sacrifice", {
            type: "BECAME_TARGET",
            target: { type: "permanent", id: "sp-host3" },
            targetControllerId: "p2",
            sourceControllerId: "p1",
            sourceInstanceId: "some-spell",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.some((c) => c.id === "potion3")
        ).toBe(false);
        expect(state.players[0].graveyard.some((c) => c.id === "potion3")).toBe(
            true
        );
    });
});

describe("Stormscape Battlemage (Kicker {A} and/or {B}, two independent conditionOnSelf-gated ETB triggers, CR 702.33a, issue #1937)", () => {
    function triggerEventFor(bm: CardInstanceState): StackItem["triggerEvent"] {
        return {
            type: "PERMANENT_ENTERED",
            instanceId: bm.id,
            controllerId: bm.controllerId,
            types: bm.types,
        } as StackItem["triggerEvent"];
    }

    function withKickerPayments(
        bm: CardInstanceState,
        payments: Record<string, number>
    ): void {
        (
            bm as CardInstanceState & { kickerPayments?: KickerPayments }
        ).kickerPayments = payments;
    }

    it("unkicked: neither trigger does anything even though the destroy trigger still announces a target", () => {
        const bm = makeInstance(stormscapeBattlemage.id, {
            id: "bm1",
            controllerId: "p1",
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bm], life: 20 }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        pushTrigger(
            state,
            bm,
            "stormscape-battlemage-white-kicker",
            triggerEventFor(bm)
        );
        expect(state.players[0].life).toBe(20);

        pushTrigger(
            state,
            bm,
            "stormscape-battlemage-black-kicker",
            triggerEventFor(bm),
            [{ type: "permanent", id: "victim1" }]
        );
        expect(
            state.players[1].battlefield.some((c) => c.id === "victim1")
        ).toBe(true);
    });

    it("kicked with only the {W} kicker: gains 3 life; the destroy trigger does nothing", () => {
        const bm = makeInstance(stormscapeBattlemage.id, {
            id: "bm2",
            controllerId: "p1",
        });
        withKickerPayments(bm, { "kicker-w": 1 });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bm], life: 20 }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        pushTrigger(
            state,
            bm,
            "stormscape-battlemage-white-kicker",
            triggerEventFor(bm)
        );
        expect(state.players[0].life).toBe(23);

        pushTrigger(
            state,
            bm,
            "stormscape-battlemage-black-kicker",
            triggerEventFor(bm),
            [{ type: "permanent", id: "victim2" }]
        );
        expect(
            state.players[1].battlefield.some((c) => c.id === "victim2")
        ).toBe(true);
    });

    it("kicked with only the {2}{B} kicker: destroys the target nonblack creature; no life gained", () => {
        const bm = makeInstance(stormscapeBattlemage.id, {
            id: "bm3",
            controllerId: "p1",
        });
        withKickerPayments(bm, { "kicker-b": 1 });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim3",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bm], life: 20 }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        pushTrigger(
            state,
            bm,
            "stormscape-battlemage-white-kicker",
            triggerEventFor(bm)
        );
        expect(state.players[0].life).toBe(20);

        pushTrigger(
            state,
            bm,
            "stormscape-battlemage-black-kicker",
            triggerEventFor(bm),
            [{ type: "permanent", id: "victim3" }]
        );
        expect(
            state.players[1].battlefield.some((c) => c.id === "victim3")
        ).toBe(false);
        expect(state.players[1].graveyard.some((c) => c.id === "victim3")).toBe(
            true
        );
    });

    it("kicked with BOTH kickers: gains 3 life AND destroys the target", () => {
        const bm = makeInstance(stormscapeBattlemage.id, {
            id: "bm4",
            controllerId: "p1",
        });
        withKickerPayments(bm, { "kicker-w": 1, "kicker-b": 1 });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim4",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bm], life: 20 }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        pushTrigger(
            state,
            bm,
            "stormscape-battlemage-white-kicker",
            triggerEventFor(bm)
        );
        expect(state.players[0].life).toBe(23);

        pushTrigger(
            state,
            bm,
            "stormscape-battlemage-black-kicker",
            triggerEventFor(bm),
            [{ type: "permanent", id: "victim4" }]
        );
        expect(
            state.players[1].battlefield.some((c) => c.id === "victim4")
        ).toBe(false);
    });

    // MAJOR 3 (PR #2010 review): `selfAdditionalCostPaid` (blue.ts) reads a
    // currently-UNTYPED, unserialized stray `kickerPayments` field on the
    // resolving permanent — tracked-by #2014 (sibling PR promoting it to a
    // typed, serialized `CardInstanceState`/`PermanentView` field). This
    // proves the REAL production path — cast through the actual cast
    // pipeline (`pushSpell` + `item.kickerPayments`, exactly like every
    // other kicker card's test), the payment record arriving via
    // `StackItem.kickerPayments` (which the compact serializer DOES persist
    // while the item sits on the stack — `serialize.ts`'s
    // `compactStackItem`) — survives an ACTUAL `compactState`/`expandState`
    // round-trip taken BEFORE the creature resolves. That is the only
    // DB-save boundary the real engine ever exercises between casting and
    // this card's own immediate ETB trigger scan: both the creature's
    // resolution and the trigger scan it triggers run SYNCHRONOUSLY inside
    // one `resolveTopOfStack` call, with no save in between (`CLAUDE.md` §
    // Action flow — the engine saves only at a STABLE point, after triggers
    // are already placed). If a future change (e.g. #2014 relocating the
    // read, or a card copying this pattern via `interveningIf` instead of
    // `conditionOnSelf`) breaks that synchronous guarantee, this is the test
    // that should catch it.
    it("survives a real serializeState/deserializeState round-trip taken while the kicked cast still sits on the stack", () => {
        const bm = makeInstance(stormscapeBattlemage.id, {
            id: "bm5",
            controllerId: "p1",
            zone: "hand",
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim5",
            controllerId: "p2",
            ownerId: "p2",
        });
        let state = makeState({
            players: [
                makePlayer("p1", { hand: [bm], life: 20 }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        const item = pushSpell(state, stormscapeBattlemage.id, "p1", [
            { type: "permanent", id: "victim5" },
        ]);
        item.id = "bm5";
        item.kickerPayments = { "kicker-w": 1, "kicker-b": 1 };

        // Round-trip WHILE the kicked creature spell is still on the stack —
        // `kickerPayments` is a `StackItem` field and IS persisted at this
        // point (`compactStackItem`).
        state = expandState(compactState(state));

        drainStack(state);
        // The destroy trigger's own target requirement ("target nonblack
        // creature") has TWO legal candidates once Stormscape Battlemage
        // itself has resolved onto the battlefield (it is nonblack too) —
        // not the sole-candidate auto-select case (CR 603.3d) — so a real
        // `kind: "trigger"` PendingTarget is raised. Pin it to the intended
        // victim, then keep draining.
        if (state.pendingTarget) {
            applyOneTargetSelection(state, "p1", {
                targetType: "permanent",
                targetId: "victim5",
            });
            drainStack(state);
        }

        // The white-kicker trigger's own gain-life effect is enough to prove
        // this test's actual point (kickerPayments surviving the round-trip
        // all the way to the `{ additionalCostPaid }` read): it needs no target, so
        // it is unaffected by the separate real-target-selection plumbing
        // (`applyOneTargetSelection`) the black-kicker trigger's OWN
        // "target nonblack creature" additionally goes through once
        // Stormscape Battlemage itself becomes a second legal candidate.
        expect(state.players[0].life).toBe(23);
    });
});

// CR 603.4 per-Kicker check-time gate (issue #2015). The `pushTrigger`-based
// rows above force each ability onto the stack and therefore only exercise the
// RESOLUTION-time `{ additionalCostPaid }` gate. These rows go through the REAL cast
// path — push the creature SPELL, let it enter, let `collectTriggers` decide —
// which is the only place the check-time gate is observable. Stormscape
// Battlemage originally shipped with NO check-time gate at all, so a
// {W}-kicked-only cast still announced the {2}{B} trigger's "target nonblack
// creature" and emitted a real `BECAME_TARGET` against it.
describe("Stormscape Battlemage — CR 603.4 per-Kicker check-time gate (issue #2015)", () => {
    function castKickedWith(payments?: KickerPayments): {
        state: GameState;
        triggersOnStack: string[];
    } {
        const victim = makeInstance(grizzlyBears.id, {
            id: "gate-victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        const item = pushSpell(state, stormscapeBattlemage.id, "p1");
        if (payments) item.kickerPayments = payments;
        resolveTopOfStack(state);
        resolveTriggerOrder(state); // CR 603.3b, only raised when BOTH fire
        return {
            state,
            triggersOnStack: state.stack
                .map((s) => s.triggeredAbilityId)
                .filter((id): id is string => id !== undefined),
        };
    }

    function becameTargetEvents(state: GameState) {
        return (state.pendingEvents ?? []).filter(
            (e) => e.type === "BECAME_TARGET"
        );
    }

    it("unkicked: NEITHER trigger reaches the stack", () => {
        const { state, triggersOnStack } = castKickedWith();
        expect(triggersOnStack).toEqual([]);
        expect(state.pendingTarget).toBeUndefined();
        expect(becameTargetEvents(state)).toEqual([]);
        expect(state.players[0].life).toBe(20);
    });

    it("kicked with {W} ONLY: the life trigger reaches the stack; the {2}{B} destroy trigger does NOT, and targets nothing", () => {
        const { state, triggersOnStack } = castKickedWith({ "kicker-w": 1 });
        expect(triggersOnStack).toEqual(["stormscape-battlemage-white-kicker"]);
        expect(state.pendingTarget).toBeUndefined();
        expect(becameTargetEvents(state)).toEqual([]);
        expect(
            state.players[1].battlefield.some((c) => c.id === "gate-victim")
        ).toBe(true);
    });

    it("kicked with {2}{B} ONLY: the destroy trigger reaches the stack; the {W} life trigger does NOT", () => {
        const { state, triggersOnStack } = castKickedWith({ "kicker-b": 1 });
        expect(triggersOnStack).toEqual(["stormscape-battlemage-black-kicker"]);
        // "target nonblack creature" has two legal candidates (the Battlemage
        // itself is nonblack), so a real PendingTarget is owed — pin it.
        expect(state.pendingTarget?.targetType).toBe("Creature");
        applyOneTargetSelection(state, "p1", {
            targetType: "permanent",
            targetId: "gate-victim",
        });
        drainStack(state);
        expect(state.players[0].life).toBe(20); // no phantom life gain
        expect(
            state.players[1].battlefield.some((c) => c.id === "gate-victim")
        ).toBe(false);
    });

    it("kicked with BOTH Kickers: both triggers reach the stack", () => {
        const { triggersOnStack } = castKickedWith({
            "kicker-w": 1,
            "kicker-b": 1,
        });
        expect(triggersOnStack.sort()).toEqual([
            "stormscape-battlemage-black-kicker",
            "stormscape-battlemage-white-kicker",
        ]);
    });
});

describe("Stormscape Familiar (cost-modifier: white AND black spells cost {1} less, CR 601.2f)", () => {
    it("reduces the controller's OWN white spell by {1}", () => {
        const familiar = makeInstance(stormscapeFamiliar.id, {
            id: "familiar",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [familiar] }),
                makePlayer("p2"),
            ],
        });
        const whiteSpell = makeInstance(savannahLions.id, {
            id: "lionsSpell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const mods = getCostModifiers(state, whiteSpell, "spell");
        expect(mods.reductionGeneric).toBe(1);
    });

    it("reduces the controller's OWN black spell by {1}", () => {
        const familiar = makeInstance(stormscapeFamiliar.id, {
            id: "familiar2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [familiar] }),
                makePlayer("p2"),
            ],
        });
        const blackSpell = makeInstance(scatheZombies.id, {
            id: "zombieSpell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const mods = getCostModifiers(state, blackSpell, "spell");
        expect(mods.reductionGeneric).toBe(1);
    });

    it("does NOT reduce a green spell (neither white nor black)", () => {
        const familiar = makeInstance(stormscapeFamiliar.id, {
            id: "familiar3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [familiar] }),
                makePlayer("p2"),
            ],
        });
        const greenSpell = makeInstance(grizzlyBears.id, {
            id: "bearSpell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const mods = getCostModifiers(state, greenSpell, "spell");
        expect(mods.reductionGeneric).toBe(0);
    });

    it("does NOT reduce the opponent's white spell", () => {
        const familiar = makeInstance(stormscapeFamiliar.id, {
            id: "familiar4",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [familiar] }),
                makePlayer("p2"),
            ],
        });
        const oppWhiteSpell = makeInstance(savannahLions.id, {
            id: "oppLions",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const mods = getCostModifiers(state, oppWhiteSpell, "spell");
        expect(mods.reductionGeneric).toBe(0);
    });
});

describe("Sunken Hope (each-player-upkeep mandatory return, CR 603.6a)", () => {
    it("the active player returns a creature they control to its owner's hand", () => {
        const hope = makeInstance(sunkenHope.id, {
            id: "hope",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "shBear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hope, bear] }),
                makePlayer("p2"),
            ],
        });
        pushTrigger(state, hope, "sunken-hope-upkeep", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        submitChoice(state, ["shBear"]);
        expect(state.players[0].hand.some((c) => c.id === "shBear")).toBe(true);
    });

    it("a player with no creatures gets no picker (auto no-op, CR 608.2b)", () => {
        const hope = makeInstance(sunkenHope.id, {
            id: "hope2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hope] }),
                makePlayer("p2"),
            ],
        });
        pushTrigger(state, hope, "sunken-hope-upkeep", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });
});

describe("Planeswalker's Mischief (protocol: reveal-random + grantCastFromExile + delayed return, CR 701.20a/601.3/603.7a)", () => {
    it("reveals the opponent's single card at random; an instant/sorcery is exiled with a free, until-next-end-step cast permission", () => {
        const misch = makeInstance(planeswalkersMischief.id, {
            id: "misch",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bolt = makeInstance(lightningBolt.id, {
            id: "bolt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [misch] }),
                makePlayer("p2", { hand: [bolt] }),
            ],
        });
        pushActivated(state, misch, "planeswalkers-mischief-reveal", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].hand).toHaveLength(0);
        const exiled = state.players[1].exile.find((c) => c.id === "bolt");
        expect(exiled).toBeDefined();
        expect(exiled?.castableFromExileBy).toBe("p1");
        expect(exiled?.castFromExileWithoutPayingManaCost).toBe(true);
    });

    it("does NOT exile a revealed creature card", () => {
        const misch = makeInstance(planeswalkersMischief.id, {
            id: "misch2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear-hand",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [misch] }),
                makePlayer("p2", { hand: [bear] }),
            ],
        });
        pushActivated(state, misch, "planeswalkers-mischief-reveal", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].hand.some((c) => c.id === "bear-hand")).toBe(
            true
        );
        expect(state.players[1].exile).toHaveLength(0);
    });

    it("returns the exiled card to its owner's hand at the next end step if it was never cast", () => {
        const misch = makeInstance(planeswalkersMischief.id, {
            id: "misch3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bolt = makeInstance(lightningBolt.id, {
            id: "bolt3",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [misch] }),
                makePlayer("p2", { hand: [bolt] }),
            ],
        });
        pushActivated(state, misch, "planeswalkers-mischief-reveal", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].exile.some((c) => c.id === "bolt3")).toBe(true);
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        expect(state.players[1].exile.some((c) => c.id === "bolt3")).toBe(
            false
        );
        expect(state.players[1].hand.some((c) => c.id === "bolt3")).toBe(true);
    });

    it("wire format: the exiled card with cast permission survives projectPublicState (mandatory — board-visible)", () => {
        const misch = makeInstance(planeswalkersMischief.id, {
            id: "misch4",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bolt = makeInstance(lightningBolt.id, {
            id: "bolt4",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [misch] }),
                makePlayer("p2", { hand: [bolt] }),
            ],
        });
        pushActivated(state, misch, "planeswalkers-mischief-reveal", [
            { type: "player", id: "p2" },
        ]);
        const projected = projectPublicState(state, 1, "p1");
        const slimExiled = projected.players[1].exile.find(
            (c) => c.id === "bolt4"
        );
        expect(slimExiled).toBeDefined();
        expect(slimExiled?.castableFromExileBy).toBe("p1");
    });
});

// Waterspout Elemental (CR 702.33 single Kicker, CR 603.4 intervening-if
// ETB, CR 400.7 mass bounce, CR 614.10 skip-turn, issue #1957) — introduces
// the `skipNextTurn` Op AND the `excludeSource` forEach-selector field, so
// per the DSL-first authoring rule (new Op / new construct combination) this
// card earns its own hand-written coverage beyond the catalogue-wide smoke
// sweep (whose generator explicitly skips `skipNextTurn` — see
// `scenarioGenerator.ts`).
describe("Waterspout Elemental (single Kicker ETB — bounce + skip, PLS 38, issue #1957)", () => {
    it("unkicked: the ETB trigger never fires — no bounce, no stack item, no skip (CR 603.4)", () => {
        const oppCreature = makeInstance(grizzlyBears.id, {
            id: "we-opp-creature",
            controllerId: "p2",
            ownerId: "p2",
        });
        const ownCreature = makeInstance(savannahLions.id, {
            id: "we-own-creature",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ownCreature] }),
                makePlayer("p2", { battlefield: [oppCreature] }),
            ],
        });
        pushSpell(state, waterspoutElemental.id, "p1");
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        // Both creatures are untouched — neither bounced.
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual(
            expect.arrayContaining(["we-own-creature"])
        );
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual(
            expect.arrayContaining(["we-opp-creature"])
        );
        // Waterspout Elemental itself entered normally.
        expect(
            state.players[0].battlefield.some(
                (c) => (c.card as { id: string }).id === waterspoutElemental.id
            )
        ).toBe(true);
        expect(state.players[0].skipNextTurn).toBeUndefined();
    });

    it("kicked: bounces ALL OTHER creatures (both players'), skips Waterspout Elemental itself, and the controller skips their next turn (CR 400.7 / 614.10)", () => {
        const oppCreature = makeInstance(grizzlyBears.id, {
            id: "we2-opp-creature",
            controllerId: "p2",
            ownerId: "p2",
        });
        const ownCreature = makeInstance(savannahLions.id, {
            id: "we2-own-creature",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ownCreature] }),
                makePlayer("p2", { battlefield: [oppCreature] }),
            ],
        });
        const item = pushSpell(state, waterspoutElemental.id, "p1");
        item.kickerPayments = { kicker: 1 };
        resolveTopOfStack(state); // Waterspout Elemental enters, ETB trigger lands
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "waterspout-elemental-kicked"
        );
        resolveTopOfStack(state); // trigger resolves
        expect(state.stack).toHaveLength(0);

        // Both OTHER creatures are bounced to their OWNERS' hands...
        expect(
            state.players[0].hand.some((c) => c.id === "we2-own-creature")
        ).toBe(true);
        expect(
            state.players[1].hand.some((c) => c.id === "we2-opp-creature")
        ).toBe(true);
        expect(state.players[0].battlefield).toHaveLength(1);
        expect(state.players[1].battlefield).toHaveLength(0);

        // ...but Waterspout Elemental itself is EXCLUDED from the bounce
        // (excludeSource) — still on the battlefield, not in a hand.
        const wsOnField = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === waterspoutElemental.id
        );
        expect(wsOnField).toBeDefined();

        // The controller skips their next turn (CR 614.10) — a count of 1.
        expect(state.players[0].skipNextTurn).toBe(1);

        // Wire format — the bounced creatures and the skip count are visible
        // client-side.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[1].hand.some((c) => c?.id === "we2-opp-creature")
        ).toBe(true);
        expect(projected.players[0].skipNextTurn).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Confound — SPELL-PROPERTY target filters
// (CR 114.1 / 109.2 / 608.2b, ADR 0068, issue #1956)
//
// Confound restricts its target by a property of the CANDIDATE SPELL — the
// targets it itself chose — rather than by the candidate's own
// characteristics. It is declared as a registry descriptor, so
// `getLegalTargets` (offered set) and `applyOneTargetSelection` (the
// `selectTarget` mutation's accepted set) run the identical predicate.
//
// `spellWasKicked` is the registry's OTHER spell-property filter and is
// exercised here through a SYNTHETIC requirement, not a card: Ertai's Trickery
// (the card that motivated it) is a tracked stub, because "counter target
// spell if it was kicked" is a CR 608.2a intervening condition, not a
// targeting restriction — see the stub note in `../blue.ts` (tracked-by:
// #2044). The filter itself stays covered so the descriptor, its client mirror
// and every census consumer keep a live proof.
//
// The tests below are written one-per-row from the PRODUCER CENSUS of every
// site that consumes a spell-target filter, INCLUDING the must-NOT rows (a
// spell-only filter must never reach the permanent/player kinds, and must never
// be carried onto a non-spell requirement). Tests derived from the
// implementation cannot falsify the implementation's assumptions.
// ─────────────────────────────────────────────────────────────────────────────

describe("Confound — spell-property target filters (issue #1956)", () => {
    const CONFOUND_REQ = confound.targetRequirement!;
    /** Synthetic — no shipped card declares `spellWasKicked` (see the section
     *  note above, tracked-by: #2044). Keeps the registry filter proven. */
    const KICKED_REQ: NonNullable<CardDefinition["targetRequirement"]> = {
        type: "spell",
        count: 1,
        spellWasKicked: true,
    };

    /** p1 casts the counterspell; p2 owns the creature/land the candidate
     *  spells point at. */
    function board(): GameState {
        return makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", {
                    life: 20,
                    battlefield: [
                        makeInstance(grizzlyBears.id, {
                            id: "bear",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                        makeInstance(island.id, {
                            id: "isle",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
    }

    const offered = (state: GameState, req = CONFOUND_REQ) =>
        getLegalTargets(state, req, NO_TARGETING_SOURCE, "p1").map((t) => t.id);

    /** The REAL accepted-set path: builds the `PendingTarget` with the same
     *  shared carry `announceCast` uses, then drives the exported
     *  `applyOneTargetSelection` (the `selectTarget` mutation's own body).
     *  Returns true when the submission is accepted. */
    function accepts(
        state: GameState,
        req: NonNullable<CardDefinition["targetRequirement"]>,
        spellId: string
    ): boolean {
        const probe: GameState = {
            ...state,
            pendingTarget: {
                playerId: "p1",
                cardInstanceId: "counterspell-source",
                targetType: req.type,
                // Open-ended max so a successful pick does NOT auto-finalize
                // into the cast-commit path (which needs a real hand card this
                // probe never seeds) — same convention as
                // `convex/__tests__/distinctTargets.test.ts`. The filter gate
                // under test runs strictly before finalization.
                count: { min: 1, max: 2 },
                selected: [],
                ...pendingTargetFiltersFromRequirement(req, undefined),
            },
        };
        try {
            applyOneTargetSelection(probe, "p1", {
                targetType: "spell",
                targetId: spellId,
            });
            return true;
        } catch {
            return false;
        }
    }

    // ── Confound: `spellTargetsTypeFilter` (row: getLegalTargets spell branch)

    it("Confound OFFERS a spell that targets a creature (CR 114.1)", () => {
        const state = board();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        expect(offered(state)).toContain(bolt.id);
    });

    it("Confound does NOT offer a spell that targets only a PLAYER", () => {
        const state = board();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        expect(offered(state)).not.toContain(bolt.id);
    });

    it("Confound does NOT offer an UNTARGETED spell (fail-closed on no targets)", () => {
        const state = board();
        const untargeted = pushSpell(state, planarOverlay.id, "p2", []);
        expect(offered(state)).not.toContain(untargeted.id);
    });

    it("Confound does NOT offer a spell targeting a NON-creature permanent (CR 109.2)", () => {
        const state = board();
        const rain = pushSpell(state, stoneRain.id, "p2", [
            { type: "permanent", id: "isle" },
        ]);
        expect(offered(state)).not.toContain(rain.id);
    });

    it("Confound stops offering a spell whose creature target has LEFT the battlefield (CR 608.2b)", () => {
        const state = board();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        expect(offered(state)).toContain(bolt.id);
        state.players[1].battlefield = state.players[1].battlefield.filter(
            (c) => c.id !== "bear"
        );
        expect(offered(state)).not.toContain(bolt.id);
    });

    // ── `spellWasKicked` (synthetic requirement — CR 702.33a)

    it("spellWasKicked OFFERS a kicked spell and NOT an unkicked one (CR 702.33a)", () => {
        const state = board();
        const kicked = pushSpell(state, urzasRage.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        kicked.kickerPayments = { kicker: 1 };
        const unkicked = pushSpell(state, urzasRage.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        const ids = offered(state, KICKED_REQ);
        expect(ids).toContain(kicked.id);
        expect(ids).not.toContain(unkicked.id);
    });

    it("spellWasKicked reads the PER-KICKER record — a two-Kicker card qualifies on EITHER leg (ADR 0079)", () => {
        for (const payments of [
            { "kicker-r": 1 },
            { "kicker-w": 1 },
            { "kicker-r": 1, "kicker-w": 1 },
        ] as KickerPayments[]) {
            const state = board();
            const bm = pushSpell(state, thornscapeBattlemage.id, "p2", []);
            bm.kickerPayments = payments;
            expect(offered(state, KICKED_REQ)).toContain(bm.id);
        }
        // …and an all-zero record is NOT kicked (the record, not its presence,
        // is what counts).
        const state = board();
        const bm = pushSpell(state, thornscapeBattlemage.id, "p2", []);
        bm.kickerPayments = { "kicker-r": 0, "kicker-w": 0 };
        expect(offered(state, KICKED_REQ)).not.toContain(bm.id);
    });

    // ── Offered set == accepted set (ADR 0068's whole point). Sweeps EVERY
    //    stack item through BOTH authorities and asserts they agree — the
    //    single assertion the Phelia bug class cannot survive.

    it("offered set and accepted set are IDENTICAL for both filters (ADR 0068)", () => {
        const state = board();
        const targetsCreature = pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        const targetsPlayer = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        const targetsLand = pushSpell(state, stoneRain.id, "p2", [
            { type: "permanent", id: "isle" },
        ]);
        const untargeted = pushSpell(state, planarOverlay.id, "p2", []);
        const kicked = pushSpell(state, urzasRage.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        kicked.kickerPayments = { kicker: 1 };

        const all = [
            targetsCreature,
            targetsPlayer,
            targetsLand,
            untargeted,
            kicked,
        ];
        for (const req of [CONFOUND_REQ, KICKED_REQ]) {
            const offeredIds = new Set(offered(state, req));
            for (const item of all) {
                expect({
                    id: item.id,
                    accepted: accepts(state, req, item.id),
                }).toEqual({
                    id: item.id,
                    accepted: offeredIds.has(item.id),
                });
            }
        }
        // Sanity: the sweep is not vacuous in either direction.
        expect(offered(state, CONFOUND_REQ).sort()).toEqual(
            [targetsCreature.id, kicked.id].sort()
        );
        expect(offered(state, KICKED_REQ)).toEqual([kicked.id]);
    });

    // ── Carry (`pendingTargetFiltersFromRequirement`) + its must-NOT row

    it("the shared carry propagates both filters onto the PendingTarget", () => {
        const c = pendingTargetFiltersFromRequirement(CONFOUND_REQ, undefined);
        expect(c.spellTargetsTypeFilter).toEqual(["Creature"]);
        const t = pendingTargetFiltersFromRequirement(KICKED_REQ, undefined);
        expect(t.spellWasKicked).toBe(true);
    });

    it("must NOT carry a spell-only filter onto a non-spell requirement", () => {
        const carried = pendingTargetFiltersFromRequirement(
            {
                type: "Creature",
                count: 1,
                spellTargetsTypeFilter: "Creature",
                spellWasKicked: true,
            },
            undefined
        );
        expect(carried.spellTargetsTypeFilter).toBeUndefined();
        expect(carried.spellWasKicked).toBeUndefined();
    });

    it("must NOT filter PERMANENT targets — a spell-kind filter is inert on the permanent kind", () => {
        const state = board();
        const ids = getLegalTargets(
            state,
            {
                type: "Creature",
                count: 1,
                spellTargetsTypeFilter: "Creature",
                spellWasKicked: true,
            },
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(ids).toEqual(["bear"]);
    });

    // ── The retarget producers (Fork copy / resolution-time retarget) delegate
    //    to `lowerSpellOnlyFilters`; assert the delegate is COMPLETE, which is
    //    what stops those producers from dropping a filter one at a time.

    it("lowerSpellOnlyFilters carries EVERY spell-only key (retarget producers, ADR 0068)", () => {
        const lowered = lowerSpellOnlyFilters(
            {
                type: "spell",
                count: 1,
                spellStackKind: "any",
                stackSourceTypeFilter: "Artifact",
                spellTargetsInstanceIds: ["x"],
                spellTypeFilter: "Instant",
                spellExcludeTypeFilter: "Creature",
                spellCreaturePtFilter: { maxPowerOrToughness: 2 },
                spellSingleTargetingController: true,
                spellWouldDestroyLandYouControl: true,
                spellTargetsTypeFilter: "Creature",
                spellWasKicked: true,
            },
            undefined
        );
        expect(Object.keys(lowered).sort()).toEqual(
            [...SPELL_ONLY_FILTER_KEYS].sort()
        );
    });

    // ── Resolution (CR 608.2b fizzle + the unconditional draw)

    it("Confound counters its target and draws a card", () => {
        const state = board();
        state.players[0].library = [
            makeInstance(island.id, {
                id: "lib1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        pushSpell(state, confound.id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state);
        expect(state.stack.some((s) => s.id === bolt.id)).toBe(false);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["lib1"]);
    });

    it("Confound STILL draws when the target can't be countered (CR 113.6g — separate Oracle sentence)", () => {
        const state = board();
        state.players[0].library = [
            makeInstance(island.id, {
                id: "lib1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const rage = pushSpell(state, urzasRage.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        pushSpell(state, confound.id, "p1", [{ type: "spell", id: rage.id }]);
        resolveTopOfStack(state);
        // Urza's Rage survives the counter attempt…
        expect(state.stack.some((s) => s.id === rage.id)).toBe(true);
        // …and the draw happens regardless.
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["lib1"]);
    });

    it("Confound is countered on resolution once its target left the stack (CR 608.2b) — and draws nothing", () => {
        const state = board();
        state.players[0].library = [
            makeInstance(island.id, {
                id: "lib1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        const cf = pushSpell(state, confound.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        // Someone else countered the Bolt first: Confound's only target has
        // left the stack, so Confound is countered by the game rules and no
        // part of it — including the draw — happens.
        state.stack = state.stack.filter((s) => s.id !== bolt.id);
        resolveTopOfStack(state);
        expect(state.stack.some((s) => s.id === cf.id)).toBe(false);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.card.id)).toContain(
            confound.id
        );
    });

    // CR 608.2b — "a target that's no longer legal" is NOT only one that left
    // its zone: a target that no longer MEETS the targeting requirements is
    // illegal too. A Bolt whose creature target died has stopped being "a
    // spell that targets a creature", so Confound's only target is illegal and
    // Confound is countered by the game rules — the Bolt is NOT countered and
    // no part of Confound happens, including the draw. This test previously
    // enshrined the opposite (Bolt countered, card drawn) as the engine's
    // documented "zone existence only" gate scope; `targetLegalityGate` now
    // re-runs the spell-property restrictions for SPELL-kind targets.
    it("Confound is countered when its target lost the spell PROPERTY after announcement (CR 608.2b)", () => {
        const state = board();
        state.players[0].library = [
            makeInstance(island.id, {
                id: "lib1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        const cf = pushSpell(state, confound.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        state.players[1].battlefield = state.players[1].battlefield.filter(
            (c) => c.id !== "bear"
        );
        resolveTopOfStack(state);
        // Confound fizzled…
        expect(state.stack.some((s) => s.id === cf.id)).toBe(false);
        expect(state.players[0].graveyard.map((c) => c.card.id)).toContain(
            confound.id
        );
        // …so the Bolt survives and nothing is drawn.
        expect(state.stack.some((s) => s.id === bolt.id)).toBe(true);
        expect(state.players[0].hand).toHaveLength(0);
    });

    // …and the re-check must not OVER-fizzle: a target that still satisfies
    // the restriction resolves normally. (The gate's two documented
    // narrowings live in `spellTargetStillMeetsRestrictions`, `gre/state.ts`:
    // cross-kind filters — `mvFilter` above all, X-resolved at ANNOUNCEMENT —
    // are not re-derived, and a resolving ABILITY keeps the
    // zone-existence-only behaviour because its requirement is frequently
    // pinned dynamically at trigger time, e.g. Ward.)
    it("the CR 608.2b re-check does not fizzle a target that still qualifies", () => {
        const state = board();
        state.players[0].library = [
            makeInstance(island.id, {
                id: "lib1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        // The Bolt keeps targeting a creature, so the spell-only half still
        // holds and Confound resolves normally.
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        pushSpell(state, confound.id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state);
        expect(state.stack.some((s) => s.id === bolt.id)).toBe(false);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["lib1"]);
    });

    // ── Wire format (row: projectPublicState / SlimStackItem). The filters read
    //    `targets` and `kickerPayments` OFF THE STACK ITEM — if the projection
    //    dropped either, the client would compute a different offered set.

    it("wire format: the projection preserves the stack fields both filters read", () => {
        const state = board();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        const rage = pushSpell(state, urzasRage.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        rage.kickerPayments = { kicker: 1 };
        const projected = projectPublicState(state, 1, "p1");
        const slimBolt = projected.stack.find((s) => s.id === bolt.id)!;
        const slimRage = projected.stack.find((s) => s.id === rage.id)!;
        expect(slimBolt.targets).toEqual([{ type: "permanent", id: "bear" }]);
        expect(slimRage.kickerPayments).toEqual({ kicker: 1 });
    });
});
