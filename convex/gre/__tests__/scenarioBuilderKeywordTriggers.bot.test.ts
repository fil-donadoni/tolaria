// Issue #9875 — an ENGINE-OWNED keyword trigger on the declared stack: the
// reflexive cast-trigger of Rebound (CR 702.88a) and Madness (CR 702.35a), the
// delayed exile of Warp (CR 702.185a). No card definition declares any of
// them, so the item carries neither `abilityId` nor `triggeredAbilityId` —
// only a marker naming its subject's instance id — and the spec declares it by
// keyword and subject (`kind: "keywordTrigger"`).
//
// Every LIVE position here is put on the stack by the ENGINE (the real
// resolution, the real delayed-trigger firing, the real post-action trigger
// scan), never by a hand-written item: a round trip asserted against a
// hand-built marker would prove nothing about the object a game produces.
//
// A `.bot.test.ts` because `ai/blade/baseState` is a bot-only module
// (`scripts/__tests__/bot-suite-boundary.test.ts`).

import { describe, expect, it } from "vitest";
import { buildBladeBaseState } from "../ai/blade/baseState";
import {
    buildVerdictPosition,
    candidateMoves,
} from "../ai/verdicts/candidates";
import { lowerDecision } from "../ai/verdicts/lowering";
import {
    stackFingerprint,
    stackRebuildMismatch,
    type SeatOf,
} from "../ai/verdicts/stackFingerprint";
import { describeMove } from "../describeMove";
import { lightningBolt } from "../../cards/sets/lea/red.cards";
import {
    buildStateFromScenario,
    specFromState,
    STACK_DROPPED_PREFIX,
} from "../scenarioBuilder";
import {
    discardToGraveyard,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../state";
import { advancePhase, fireDelayedTriggers } from "../phases";
import { pushSpell } from "../../cards/__tests__/setup.helper";
import { getDefinition } from "../../cards";
import { ephemerate } from "../../cards/sets/mh1/white.cards";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import { pinnacleEmissary } from "../../cards/sets/eoe/multicolor.cards";
import { normalizeScenarioSpec } from "../../debugScenarioSpec";
import type { CardInstanceState, GameState, StackItem } from "../state";
import type { ScenarioSpec } from "../../debugScenarioSpec";

const baskingRootwalla = getDefinition("1a67768a-6cd9-4163-b941-752f29c87a8d");

const QUIET: Pick<ScenarioSpec, "phase" | "turn" | "landCount"> & {
    libraryCount: number;
} = { phase: "PRECOMBAT_MAIN", turn: 5, landCount: 0, libraryCount: 20 };

function build(spec: ScenarioSpec): GameState {
    return buildStateFromScenario(buildBladeBaseState(), spec);
}

function lowerAndRebuild(live: GameState) {
    const lowered = specFromState(live, { mySeatId: live.players[0].id });
    return {
        ...lowered,
        rebuilt:
            lowered.spec.stack === undefined ? undefined : build(lowered.spec),
    };
}

/** CR 702.88a — Ephemerate cast from hand resolves, is exiled by Rebound, and
 *  its delayed trigger fires at the caster's next upkeep: the reflexive
 *  cast-trigger is on the stack, the card still in exile. */
function reboundTriggerOnStack(extra: ScenarioSpec["cards"] = []): GameState {
    const state = build({
        ...QUIET,
        cards: [{ name: grizzlyBears().name, owner: "me" }, ...extra],
    });
    const me = state.players[0];
    const spell = pushSpell(state, ephemerate().id, me.id, [
        { type: "permanent", id: me.battlefield[0].id },
    ]);
    spell.reboundFromHand = true;
    resolveTopOfStack(state);
    for (let i = 0; i < 40 && state.stack.length === 0; i++) {
        advancePhase(state);
    }
    return state;
}

/** CR 702.35a — Basking Rootwalla is discarded, exiled by Madness, and the
 *  post-action trigger scan puts its reflexive cast-trigger on the stack. */
function madnessTriggerOnStack(): GameState {
    const state = build({
        ...QUIET,
        cards: [{ name: baskingRootwalla.name, owner: "me", zone: "hand" }],
    });
    const me = state.players[0];
    discardToGraveyard(state, me.id, me.hand[0].id, {
        kind: "effect",
        controllerId: me.id,
    });
    processPendingActionTriggers(state);
    return state;
}

/** CR 702.185a — Pinnacle Emissary resolves cast for its warp cost, and the
 *  delayed exile it scheduled fires at the next end step. */
function warpTriggerOnStack(): GameState {
    const state = build({
        ...QUIET,
        cards: [{ name: pinnacleEmissary().name, owner: "me", zone: "hand" }],
    });
    const me = state.players[0];
    const [card] = me.hand.splice(0, 1);
    state.stack.push({
        ...card,
        zone: "stack",
        castById: me.id,
        warped: true,
    } as StackItem);
    resolveTopOfStack(state);
    fireDelayedTriggers(state, "next-end-step");
    return state;
}

/** What resolving the top object did, in names and seats — never instance
 *  ids, which each build allocates for itself. */
function resolutionOutcome(state: GameState) {
    resolveTopOfStack(state);
    const me = state.players[0];
    const flags = (card: CardInstanceState) => ({
        id: (card.card as { id?: string }).id,
        reboundExiled: card.reboundExiled,
        madnessExiled: card.madnessExiled,
        castable: card.castableFromExileBy === me.id,
        free: card.castFromExileWithoutPayingManaCost,
        warpedOut: card.warpExiledOnTurn === state.turn,
    });
    return {
        stack: state.stack.length,
        exile: me.exile.map(flags),
        battlefield: me.battlefield.map((c) => (c.card as { id?: string }).id),
        choices: (state.pendingChoices ?? []).map((choice) => ({
            kind: choice.kind,
            mine: choice.playerId === me.id,
            subject: choice.subjectCardId,
            prompt: choice.prompt,
        })),
        reboundWindow: state.reboundCastWindow?.ownerId === me.id,
        madnessWindow: state.madnessCastWindow?.ownerId === me.id,
        priorityMine: state.priorityPlayerId === me.id,
    };
}

describe("a Rebound cast-trigger on the stack round-trips (CR 702.88a, issue #9875)", () => {
    it("is declared by keyword and subject, and the card keeps `reboundExiled`", () => {
        const live = reboundTriggerOnStack();
        expect(live.stack).toHaveLength(1);
        expect(live.stack[0].reboundTrigger).toBeDefined();

        const { spec, dropped, rebuilt } = lowerAndRebuild(live);
        expect(spec.stack).toEqual([
            {
                kind: "keywordTrigger",
                name: ephemerate().name,
                controller: "me",
                keyword: "rebound",
                subject: {
                    zone: "exile",
                    name: ephemerate().name,
                    seat: "me",
                },
            },
        ]);
        expect(spec.cards).toContainEqual(
            expect.objectContaining({
                name: ephemerate().name,
                zone: "exile",
                reboundExiled: true,
            })
        );
        expect(dropped.join("\n")).not.toContain("reboundExiled");
        expect(dropped.join("\n")).not.toContain(STACK_DROPPED_PREFIX);

        // The marker is stamped with the REBUILT subject's instance id.
        const exiled = rebuilt!.players[0].exile[0];
        expect(rebuilt!.stack).toHaveLength(1);
        expect(rebuilt!.stack[0].reboundTrigger).toBe(exiled.id);
    });

    it("resolves to the same cast window as the live trigger", () => {
        const live = reboundTriggerOnStack();
        const { rebuilt } = lowerAndRebuild(live);
        const outcome = resolutionOutcome(live);
        expect(outcome.choices).toEqual([
            expect.objectContaining({ kind: "rebound-cast", mine: true }),
        ]);
        expect(outcome.reboundWindow).toBe(true);
        expect(outcome.exile).toEqual([
            expect.objectContaining({ castable: true, free: true }),
        ]);
        expect(resolutionOutcome(rebuilt!)).toEqual(outcome);
    });

    it("survives the stored-row normalizer unchanged", () => {
        const { spec } = lowerAndRebuild(reboundTriggerOnStack());
        const stored = normalizeScenarioSpec(JSON.parse(JSON.stringify(spec)));
        expect(stored.stack).toEqual(spec.stack);
        expect(stored.cards).toContainEqual(
            expect.objectContaining({ reboundExiled: true })
        );
    });
});

describe("a Madness cast-trigger on the stack round-trips (CR 702.35a, issue #9875)", () => {
    it("is declared by keyword and subject, and resolves to the same cast window", () => {
        const live = madnessTriggerOnStack();
        expect(live.stack).toHaveLength(1);
        expect(live.stack[0].madnessTrigger).toBeDefined();

        const { spec, dropped, rebuilt } = lowerAndRebuild(live);
        expect(spec.stack).toEqual([
            {
                kind: "keywordTrigger",
                name: baskingRootwalla.name,
                controller: "me",
                keyword: "madness",
                subject: {
                    zone: "exile",
                    name: baskingRootwalla.name,
                    seat: "me",
                },
            },
        ]);
        expect(dropped.join("\n")).not.toContain("madnessExiled");
        expect(rebuilt!.stack[0].madnessTrigger).toBe(
            rebuilt!.players[0].exile[0].id
        );

        const outcome = resolutionOutcome(live);
        expect(outcome.choices).toEqual([
            expect.objectContaining({ kind: "madness-cast", mine: true }),
        ]);
        expect(outcome.madnessWindow).toBe(true);
        expect(resolutionOutcome(rebuilt!)).toEqual(outcome);
    });
});

describe("a Warp exile trigger on the stack round-trips (CR 702.185a, issue #9875)", () => {
    it("is declared by keyword and subject, and exiles the same permanent", () => {
        const live = warpTriggerOnStack();
        expect(live.stack).toHaveLength(1);
        expect(live.stack[0].warpTrigger).toBe(
            live.players[0].battlefield[0].id
        );

        const { spec, rebuilt } = lowerAndRebuild(live);
        expect(spec.stack).toEqual([
            {
                kind: "keywordTrigger",
                name: pinnacleEmissary().name,
                controller: "me",
                keyword: "warp",
                subject: {
                    zone: "battlefield",
                    name: pinnacleEmissary().name,
                    seat: "me",
                },
            },
        ]);
        // CR 400.7 — the marker `applyWarpExile` re-checks rides the card.
        expect(spec.cards).toContainEqual(
            expect.objectContaining({
                name: pinnacleEmissary().name,
                warped: true,
            })
        );
        expect(rebuilt!.stack[0].warpTrigger).toBe(
            rebuilt!.players[0].battlefield[0].id
        );

        const outcome = resolutionOutcome(live);
        expect(outcome.battlefield).toEqual([]);
        expect(outcome.exile).toEqual([
            expect.objectContaining({
                id: pinnacleEmissary().id,
                warpedOut: true,
            }),
        ]);
        expect(resolutionOutcome(rebuilt!)).toEqual(outcome);
    });
});

describe("a keyword trigger the spec cannot declare is refused (issue #9875)", () => {
    it("refuses a subject that left the zone its keyword expects, naming it (CR 400.7)", () => {
        const live = reboundTriggerOnStack();
        const me = live.players[0];
        // An intervening effect moved the exiled card: the trigger will do
        // nothing, and the spec has no subject to stamp it with.
        const [card] = me.exile.splice(0, 1);
        me.graveyard.push({ ...card, zone: "graveyard" });

        const { spec, dropped, stackBlockers } = lowerAndRebuild(live);
        expect(spec.stack).toBeUndefined();
        expect(stackBlockers).toEqual([
            {
                item: `me ${ephemerate().name} trigger:rebound`,
                field: "subject:rebound",
            },
        ]);
        const note = dropped.find((d) => d.startsWith(STACK_DROPPED_PREFIX));
        expect(note).toContain(
            `its subject, the ${ephemerate().name} its rebound trigger acts on`
        );
    });

    it("refuses a face-down subject (CR 708.2)", () => {
        const live = warpTriggerOnStack();
        live.players[0].battlefield[0].faceDown = true;
        const { spec, stackBlockers } = lowerAndRebuild(live);
        expect(spec.stack).toBeUndefined();
        expect(stackBlockers).toContainEqual({
            item: `me ${pinnacleEmissary().name} trigger:warp`,
            field: "subject:warp",
        });
    });

    it("labels its residue `trigger:<keyword>`, never `spell`, and excuses no announcement field", () => {
        const live = madnessTriggerOnStack();
        live.stack[0].isCopy = true;
        live.stack[0].chosenX = 2;
        const { spec, stackBlockers } = lowerAndRebuild(live);
        expect(spec.stack).toBeUndefined();
        const item = `me ${baskingRootwalla.name} trigger:madness`;
        expect(stackBlockers).toEqual([
            { item, field: "chosenX" },
            { item, field: "isCopy" },
        ]);
    });

    it("refuses an item whose owner is not its controller's seat", () => {
        const live = reboundTriggerOnStack();
        live.stack[0].ownerId = live.players[1].id;
        const { spec, stackBlockers } = lowerAndRebuild(live);
        expect(spec.stack).toBeUndefined();
        expect(stackBlockers).toContainEqual({
            item: `me ${ephemerate().name} trigger:rebound`,
            field: "ownerId",
        });
    });

    it("refuses a marker of another keyword by name", () => {
        const live = reboundTriggerOnStack();
        const item = live.stack[0] as StackItem & Record<string, unknown>;
        item.someFutureKeywordTrigger = item.reboundTrigger;
        delete item.reboundTrigger;
        const { spec, stackBlockers } = lowerAndRebuild(live);
        expect(spec.stack).toBeUndefined();
        expect(stackBlockers).toContainEqual({
            item: `me ${ephemerate().name} spell`,
            field: "someFutureKeywordTrigger",
        });
    });
});

describe("the builder and the normalizer refuse an incoherent keyword trigger (issue #9875)", () => {
    const declared = (): ScenarioSpec =>
        lowerAndRebuild(reboundTriggerOnStack()).spec;

    it("throws on a subject the board does not hold", () => {
        const spec = declared();
        spec.cards = spec.cards.filter((card) => card.zone !== "exile");
        expect(() => build(spec)).toThrow(/the subject of stack index 0/);
    });

    it("throws on an entry with no subject, or one outside the keyword's zone", () => {
        const noSubject = declared();
        delete noSubject.stack![0].subject;
        expect(() => build(noSubject)).toThrow(/with no subject/);

        const wrongZone = declared();
        wrongZone.stack![0].subject = {
            zone: "graveyard",
            name: ephemerate().name,
            seat: "me",
        };
        expect(() => build(wrongZone)).toThrow(/looks for the card in exile/);
    });

    it("drops the whole stack of a stored row whose keyword trigger is malformed", () => {
        const raw = (patch: Record<string, unknown>) => {
            const spec = JSON.parse(JSON.stringify(declared()));
            Object.assign(spec.stack[0], patch);
            return normalizeScenarioSpec(spec).stack;
        };
        expect(raw({})).toHaveLength(1);
        expect(raw({ keyword: "storm" })).toBeUndefined();
        expect(raw({ keyword: undefined })).toBeUndefined();
        expect(
            raw({
                subject: {
                    zone: "battlefield",
                    name: ephemerate().name,
                    seat: "me",
                },
            })
        ).toBeUndefined();
        expect(raw({ x: 2 })).toBeUndefined();
        // …and the two fields are a `keywordTrigger`'s alone.
        expect(raw({ kind: "spell" })).toBeUndefined();
    });
});

describe("the verdict lowering judges a decision over a keyword trigger (issue #9875)", () => {
    it("lowers the reported shape — a Rebound trigger on the stack at upkeep — instead of refusing `stack-not-lowerable`", () => {
        // A Bolt in hand, so the position offers a second move to prefer.
        const live = reboundTriggerOnStack([
            { name: lightningBolt().name, owner: "me", zone: "hand" },
            { name: "Mountain", owner: "me" },
        ]);
        const botId = live.players[0].id;
        expect(live.phase).toBe("UPKEEP");
        expect(live.priorityPlayerId).toBe(botId);

        const [first] = candidateMoves(live, botId);
        const outcome = lowerDecision(live, botId, describeMove(first, live));
        if (!outcome.ok) {
            throw new Error(`refused ${outcome.kind}: ${outcome.error}`);
        }
        expect(outcome.lowered.spec.stack).toEqual([
            expect.objectContaining({
                kind: "keywordTrigger",
                keyword: "rebound",
            }),
        ]);
        const rebuilt = buildVerdictPosition(outcome.lowered.spec);
        expect(rebuilt.stack).toHaveLength(1);
        expect(rebuilt.stack[0].reboundTrigger).toBe(
            rebuilt.players[0].exile[0].id
        );
    });
});

describe("the stack fingerprint sees a keyword trigger's subject (issue #9875)", () => {
    const seats = (state: GameState): SeatOf => {
        const me = state.players[0].id;
        return (playerId) => (playerId === me ? "me" : "opp");
    };

    it("names the keyword and the subject, never `spell`", () => {
        const live = reboundTriggerOnStack();
        expect(stackFingerprint(live, seats(live))).toEqual([
            `me ${ephemerate().name} trigger:rebound subject=exile:me ${ephemerate().name} {awaiting} targets[] x=-`,
        ]);
    });

    it("reports a rebuild whose subject lost the flag the resolution reads (CR 702.88a)", () => {
        const live = reboundTriggerOnStack();
        const { rebuilt } = lowerAndRebuild(live);
        expect(
            stackRebuildMismatch(live, seats(live), rebuilt!, seats(rebuilt!))
        ).toBeNull();
        delete rebuilt!.players[0].exile[0].reboundExiled;
        expect(
            stackRebuildMismatch(live, seats(live), rebuilt!, seats(rebuilt!))
        ).toContain("trigger:rebound subject=exile:me");
    });
});
