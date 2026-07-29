// Per-card behavior tests for colorless cards in `convex/cards/sets/mh2/colorless.ts`
// (Modern Horizons 2, split by colour per ADR 0043). Yavimaya, Cradle of
// Growth is the "Forest" mirror of Urborg, Tomb of Yawgmoth
// (`convex/cards/sets/plc/colorless.ts`) — same `subtype-add` static-effect
// shape (CR 305.7, 611). Urborg's test file carries the exhaustive coverage
// (apply/existing-grants/unapply/wire-format); this file only re-confirms the
// additive behavior and the self-mana-ability inference for Yavimaya, per the
// project's per-Op / lighter-mirror testing convention.

import { describe, it, expect } from "vitest";
import { yavimayaCradleOfGrowth, urzasSaga } from "..";
import { swamp, blackVise } from "../../lea";
import { grizzlyBears } from "../../lea/green";
import { ornithopter, mishrasFactory } from "../../atq/colorless";
import { walkingBallista } from "../../aer/colorless";
import { portableHole } from "../../afr/white";
import { bloodMoon } from "../../drk/red";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getDefinition } from "../../..";
import {
    getBasicLandMana,
    getManaTapOptionsDetailed,
    hasManaAbility,
    LAND_TYPES,
} from "../../../../gre/constants";
import {
    applySourceStaticEffects,
    manaCostForCardFilter,
    processPendingActionTriggers,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import {
    advanceSagasAtPrecombatMain,
    effectiveChapterAbilities,
    finalChapter,
    hasChapterAbilityOnStack,
    isSaga,
    LORE_COUNTER,
} from "../../../../gre/sagas";
import { chapterAbilityId } from "../../../abilities/sagas";
import { checkStateBasedActions } from "../../../../gre/sba";
import { applyPlayLand } from "../../../../gre/playLand";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { buildAutoTapSources } from "../../../../gre/autoTap";
import { planManaPayment } from "../../../../gre/moves";
import { getLegalActions } from "../../../../gre/rules";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";

describe("Yavimaya, Cradle of Growth ({T}: Add {G} via basic-land inference — CR 305.7, 611)", () => {
    it("declares exactly one subtype-add static effect matching every land", () => {
        const kinds = (yavimayaCradleOfGrowth.staticEffects ?? []).map(
            (e) => e.kind
        );
        expect(kinds).toEqual(["subtype-add"]);
    });

    it("adds Forest additively to another land already on the battlefield (original subtype NOT replaced)", () => {
        const state = makeState();
        const yavimaya = makeInstance(yavimayaCradleOfGrowth.id, {
            id: "yavimaya-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const otherSwamp = makeInstance(swamp.id, {
            id: "swamp-1",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(yavimaya);
        state.players[1].battlefield.push(otherSwamp);

        applySourceStaticEffects(state, yavimaya);

        expect(otherSwamp.subtypes).toContain("Swamp");
        expect(otherSwamp.subtypes).toContain("Forest");
        expect(otherSwamp.subtypes).toHaveLength(2);
    });

    it("Yavimaya itself can tap for {G} via the free basic-land-type inference", () => {
        const state = makeState();
        const yavimaya = makeInstance(yavimayaCradleOfGrowth.id, {
            id: "yavimaya-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(yavimaya);

        applySourceStaticEffects(state, yavimaya);

        expect(yavimaya.subtypes).toContain("Forest");
        expect(getBasicLandMana(yavimaya)).toBe("G");
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Urza's Saga (issue #1884) — the first real consumer of the Saga framework
// (CR 714, #1879), of indefinite activated grants + granted mana-ability
// visibility (CR 611.2c / 605.1a, #1880) and of `manaCostEquals` (CR 202.3b,
// #1881). Everything below drives the PRODUCTION path: the land drop
// (`applyPlayLand`), the CR 714.3c turn-based action
// (`advanceSagasAtPrecombatMain`), real trigger processing
// (`processPendingActionTriggers`), real resolution (`resolveTopOfStack`) and
// the real SBA sweep (`checkStateBasedActions`).
// ───────────────────────────────────────────────────────────────────────────

/** The Saga on the battlefield with `lore` counters already on it, plus any
 *  extra permanents / library. Built through the shared fixtures so the state
 *  carries a real Expected Input (ADR 0047). */
function sagaBoard(opts: {
    lore?: number;
    battlefield?: CardInstanceState[];
    library?: CardInstanceState[];
    opponentBattlefield?: CardInstanceState[];
}): { state: GameState; saga: CardInstanceState } {
    const saga = makeInstance(urzasSaga.id, {
        id: "saga-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        ...(opts.lore !== undefined
            ? { counters: { [LORE_COUNTER]: opts.lore } }
            : {}),
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [saga, ...(opts.battlefield ?? [])],
                library: opts.library ?? [],
            }),
            makePlayer("p2", { battlefield: opts.opponentBattlefield ?? [] }),
        ],
    });
    return { state, saga: state.players[0].battlefield[0] };
}

/** One CR 714.3c turn-based lore counter, the chapter trigger it raises put on
 *  the stack (CR 603.2), and that chapter resolved — the exact pair
 *  `performPhaseEntry`'s PRECOMBAT_MAIN case runs. */
function tickChapter(state: GameState): void {
    advanceSagasAtPrecombatMain(state);
    processPendingActionTriggers(state);
    resolveTopOfStack(state);
}

/** Resolves a GRANTED activated ability of `source` through the real stack
 *  path. `grantedSourceCardId` is what makes `resolveTopOfStack` read the
 *  template off the granting card's `grantTemplates[]` (CR 113.1). */
function resolveGrantedAbility(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        grantedSourceCardId: urzasSaga.id,
        targets: [],
    });
    resolveTopOfStack(state);
}

describe("Urza's Saga — printed characteristics (CR 205.3h / 205.3i, ADR 0078 §4)", () => {
    it("is BOTH an Enchantment and a Land, with TWO subtypes", () => {
        // The trap this pins: written as the single string "Urza's Saga" the
        // card is not a Saga at all — `isSaga` reads
        // `subtypes.includes("Saga")` — and every other server-side test still
        // passes, silently.
        expect(urzasSaga.types).toEqual(["Enchantment", "Land"]);
        expect(urzasSaga.subtypes).toEqual(["Urza's", "Saga"]);
    });

    it("is recognised as a Saga by the engine's identity predicate", () => {
        const { saga } = sagaBoard({ lore: 1 });
        expect(isSaga(saga)).toBe(true);
    });

    it('"Urza\'s" is a CR 205.3i land type the engine knows', () => {
        // The land half of the subtype pair must be strippable by a CR 305.7
        // land-type-setting effect; only "Saga" rides along (allowlisted in
        // `cards/__tests__/landTypeCoverage.test.ts`).
        expect(LAND_TYPES.has("Urza's")).toBe(true);
        expect(LAND_TYPES.has("Saga")).toBe(false);
    });

    it("has no mana cost and carries the verbatim Scryfall oracle text", () => {
        expect(urzasSaga.manaCost).toEqual({});
        expect(urzasSaga.oracleText).toBe(
            "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\n" +
                'I — This Saga gains "{T}: Add {C}."\n' +
                "II — This Saga gains \"{2}, {T}: Create a 0/0 colorless Construct artifact creature token with 'This token gets +1/+1 for each artifact you control.'\"\n" +
                "III — Search your library for an artifact card with mana cost {0} or {1}, put it onto the battlefield, then shuffle."
        );
    });

    it("desugars into exactly three chapter abilities plus the entry lore counter", () => {
        const def = getDefinition(urzasSaga.id);
        const chapters = (def.triggeredAbilities ?? []).filter(
            (a) => a.chapterNumbers
        );
        expect(chapters.map((a) => a.chapterNumbers)).toEqual([[1], [2], [3]]);
        expect(def.entersWith?.counters).toEqual([
            { type: LORE_COUNTER, count: 1 },
        ]);
        expect(finalChapter(makeInstance(urzasSaga.id))).toBe(3);
    });

    it("exposes the two granted abilities on grantTemplates, NOT as native activated abilities", () => {
        // The Saga must not tap for {C} before chapter I resolves.
        expect(urzasSaga.activatedAbilities).toBeUndefined();
        const mana = urzasSaga.grantTemplates!.find(
            (a) => a.id === "urzas-saga-mana"
        )!;
        expect(mana.useStack).toBe(false); // CR 605.1a — a mana ability
        expect(mana.cost).toEqual({ tap: true });
        expect(mana.manaProduced).toEqual({ C: 1 });
        const construct = urzasSaga.grantTemplates!.find(
            (a) => a.id === "urzas-saga-construct"
        )!;
        expect(construct.useStack).toBe(true);
        expect(construct.cost).toEqual({ tap: true, mana: { X: 2 } });
    });
});

describe("entering the battlefield (CR 714.3a, CR 305.9)", () => {
    function playSaga(battlefield: CardInstanceState[] = []) {
        const inHand = makeInstance(urzasSaga.id, {
            id: "saga-hand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [inHand], battlefield }),
                makePlayer("p2"),
            ],
        });
        const entered = applyPlayLand(state, state.players[0], "saga-hand");
        return { state, entered: entered! };
    }

    it("enters through the land drop with ONE lore counter", () => {
        const { entered } = playSaga();
        expect(entered).not.toBeNull();
        expect(entered.counters?.[LORE_COUNTER]).toBe(1);
    });

    it("chapter I triggers off that entry counter and grants the mana ability", () => {
        const { state, entered } = playSaga();
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(chapterAbilityId([1]));
        resolveTopOfStack(state);
        expect(entered.grantedActivatedAbilities).toEqual([
            { sourceCardId: urzasSaga.id, abilityId: "urzas-saga-mana" },
        ]);
    });

    it("is NOT castable from hand — it is a Land (CR 305.9)", () => {
        const inHand = makeInstance(urzasSaga.id, {
            id: "saga-hand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [inHand] }), makePlayer("p2")],
        });
        const actions = getLegalActions(state, state.players[0], inHand);
        // Land drop only — never a cast (CR 305.9).
        expect(actions).toContain("play");
        expect(actions).not.toContain("cast");
    });
});

describe('chapter I — indefinite "{T}: Add {C}" grant (CR 611.2c / 605.1a, #1880)', () => {
    it("grants the ability with NO duration (it must not expire at end of turn)", () => {
        const { state, saga } = sagaBoard({ lore: 0 });
        tickChapter(state);
        expect(saga.counters?.[LORE_COUNTER]).toBe(1);
        expect(saga.grantedActivatedAbilities).toEqual([
            { sourceCardId: urzasSaga.id, abilityId: "urzas-saga-mana" },
        ]);
        // CR 611.2c — an indefinite grant carries no `duration` key at all.
        expect(
            saga.grantedActivatedAbilities![0] as Record<string, unknown>
        ).not.toHaveProperty("duration");
    });

    it("the GRANTED mana ability is visible to hasManaAbility (invisible before)", () => {
        const { state, saga } = sagaBoard({ lore: 0 });
        expect(hasManaAbility(saga)).toBe(false);
        tickChapter(state);
        expect(hasManaAbility(saga)).toBe(true);
        expect(
            getManaTapOptionsDetailed(saga, "p1", [
                { playerId: "p1", battlefield: state.players[0].battlefield },
            ]).map((o) => o.mana)
        ).toEqual([{ C: 1 }]);
    });

    it("reaches the auto-tap solver as a real source", () => {
        const { state, saga } = sagaBoard({ lore: 0 });
        expect(buildAutoTapSources(state.players[0].battlefield)).toEqual([]);
        tickChapter(state);
        const sources = buildAutoTapSources(state.players[0].battlefield);
        expect(sources.map((s) => s.cardId)).toEqual([saga.id]);
    });

    it("makes an otherwise-unpayable {1} spell payable through the REAL payment planner", () => {
        // `planManaPayment` (gre/moves.ts) is the production auto-tap payment
        // path — it emits the concrete taps the server commits, not a
        // legality hint. Before chapter I the Saga produces nothing, so a {1}
        // cost cannot be covered at all.
        const { state, saga } = sagaBoard({ lore: 0 });
        expect(planManaPayment(state, state.players[0], { X: 1 })).toBeNull();
        tickChapter(state);
        const taps = planManaPayment(state, state.players[0], { X: 1 });
        expect(taps).not.toBeNull();
        expect(taps!.map((t) => t.cardInstanceId)).toEqual([saga.id]);
    });
});

describe("chapter II — the Construct maker (CR 604.3 CDA)", () => {
    /** Both chapters resolved: the Saga has BOTH granted abilities. */
    function throughChapterTwo(extra: CardInstanceState[] = []) {
        const { state, saga } = sagaBoard({ lore: 0, battlefield: extra });
        tickChapter(state); // I
        tickChapter(state); // II
        return { state, saga };
    }

    it("grants the token-making ability, keeping chapter I's grant (both are indefinite)", () => {
        const { saga } = throughChapterTwo();
        expect(saga.counters?.[LORE_COUNTER]).toBe(2);
        expect(saga.grantedActivatedAbilities!.map((g) => g.abilityId)).toEqual(
            ["urzas-saga-mana", "urzas-saga-construct"]
        );
    });

    it("a LONE Construct is 1/1 — it counts itself, so it never dies to the CR 704.5f SBA", () => {
        const { state, saga } = throughChapterTwo();
        resolveGrantedAbility(state, saga, "urzas-saga-construct");
        const token = state.players[0].battlefield.find((c) => c.isToken)!;
        expect(token.subtypes).toContain("Construct");
        expect(token.types).toEqual(["Artifact", "Creature"]);
        expect(getEffectivePower(state, token)).toBe(1);
        expect(getEffectiveToughness(state, token)).toBe(1);
        checkStateBasedActions(state);
        expect(state.players[0].battlefield).toContain(token);
    });

    it("scales with every artifact its controller controls, and ignores the opponent's", () => {
        const mine = makeInstance(ornithopter.id, {
            id: "thopter-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const theirs = makeInstance(ornithopter.id, {
            id: "thopter-2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const { state, saga } = throughChapterTwo([mine]);
        state.players[1].battlefield.push(theirs);
        resolveGrantedAbility(state, saga, "urzas-saga-construct");
        const token = state.players[0].battlefield.find((c) => c.isToken)!;
        // Ornithopter + the token itself = 2. The opponent's is not counted.
        expect(getEffectivePower(state, token)).toBe(2);
        expect(getEffectiveToughness(state, token)).toBe(2);
    });

    it("wire format — the Construct's CDA P/T survives projectPublicState", () => {
        const mine = makeInstance(ornithopter.id, {
            id: "thopter-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const { state, saga } = throughChapterTwo([mine]);
        resolveGrantedAbility(state, saga, "urzas-saga-construct");
        const token = state.players[0].battlefield.find((c) => c.isToken)!;
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === token.id
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});

describe("chapter III — manaCostEquals tutor (CR 202.3b, #1881)", () => {
    /** Library stocked with one card of each interesting cost shape. */
    function libraryOfCandidates(): CardInstanceState[] {
        const lib = (cardId: string, id: string) =>
            makeInstance(cardId, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            });
        return [
            lib(ornithopter.id, "zero-cost"), // {0} artifact — legal
            lib(blackVise.id, "one-cost"), // {1} artifact — legal
            lib(walkingBallista.id, "x-cost"), // {X}{X} artifact — NOT {0}/{1}
            lib(portableHole.id, "colored-cost"), // {W} artifact — mv 1, NOT {1}
            lib(mishrasFactory.id, "artifact-land"), // a Land — no mana cost
            lib(grizzlyBears.id, "nonartifact"), // not an Artifact at all
        ];
    }

    /** Advances to chapter III and stops on the search choice. */
    function toChapterThree() {
        const { state, saga } = sagaBoard({
            lore: 2,
            library: libraryOfCandidates(),
        });
        advanceSagasAtPrecombatMain(state);
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(chapterAbilityId([3]));
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
        return { state, saga, head: state.pendingChoices![0] };
    }

    it("offers ONLY artifacts whose printed mana cost is exactly {0} or {1}", () => {
        const { head } = toChapterThree();
        expect(head.kind).toBe("search-library");
        // Not the {X}{X} artifact (mana value 0, but a VARIABLE cost — the
        // Chalice of the Void / Engineered Explosives ruling), not the {W}
        // one (mana value 1, but not the printed cost {1}), not the Land
        // (no printed land has a mana cost, CR 202.1), not the creature.
        expect([...head.candidateIds!].sort()).toEqual([
            "one-cost",
            "zero-cost",
        ]);
    });

    it("a Land is excluded by the printed-cost carve-out, not merely by the type gate", () => {
        // Belt and braces: the filter's `type: "Artifact"` already rejects
        // Mishra's Factory, but the ruling ("Urza's Saga can't find artifact
        // lands") rests on the COST side — `manaCostForCardFilter` returns
        // undefined for any Land, and `manaCostEquals` fails CLOSED on it.
        expect(
            manaCostForCardFilter(getDefinition(mishrasFactory.id))
        ).toBeUndefined();
        // …while a real printed {0} is a distinct, matchable encoding.
        expect(manaCostForCardFilter(getDefinition(ornithopter.id))).toEqual(
            {}
        );
    });

    it("puts the chosen artifact onto the battlefield and shuffles the library", () => {
        const { state, head } = toChapterThree();
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["zero-cost"],
        });
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "zero-cost"
        );
        expect(state.players[0].library.map((c) => c.id)).not.toContain(
            "zero-cost"
        );
        // `libraryLook: shuffle` ran — the remaining five are still there.
        expect(state.players[0].library).toHaveLength(5);
    });
});

describe("CR 714.4 — the SBA sacrifices AFTER chapter III leaves the stack", () => {
    it("is DEFERRED while the chapter III ability is still on the stack", () => {
        const { state, saga } = sagaBoard({ lore: 2 });
        advanceSagasAtPrecombatMain(state);
        processPendingActionTriggers(state);
        expect(saga.counters?.[LORE_COUNTER]).toBe(3);
        expect(hasChapterAbilityOnStack(state, saga)).toBe(true);
        checkStateBasedActions(state);
        expect(state.players[0].battlefield).toContain(saga);
    });

    it("sacrifices the Saga once that chapter has resolved", () => {
        const { state, saga } = sagaBoard({
            lore: 2,
            library: [
                makeInstance(ornithopter.id, {
                    id: "zero-cost",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "library",
                }),
            ],
        });
        advanceSagasAtPrecombatMain(state);
        processPendingActionTriggers(state);
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["zero-cost"],
        });
        // The fetch happened FIRST, then the Saga is sacrificed.
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "zero-cost"
        );
        checkStateBasedActions(state);
        expect(state.players[0].battlefield).not.toContain(saga);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(saga.id);
    });

    it("is NOT sacrificed one chapter short", () => {
        const { state, saga } = sagaBoard({ lore: 2 });
        checkStateBasedActions(state);
        expect(state.players[0].battlefield).toContain(saga);
    });
});

describe("under Blood Moon (CR 305.7 + the 2026 CR 714 gates, #1882)", () => {
    const moon = () =>
        makeInstance(bloodMoon.id, {
            id: "moon-1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });

    it("enters with ZERO lore counters — CR 714.3a is an ability, and it is suppressed", () => {
        // The catalogue's only real-card instance of the interaction: an
        // `Enchantment Land — Urza's` loses its abilities to CR 305.7's
        // land-type reset, so the entry lore counter is never applied
        // (CR 614.1c, #1882). The pre-#1882 engine gave it 1.
        const inHand = makeInstance(urzasSaga.id, {
            id: "saga-hand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [inHand] }),
                makePlayer("p2", { battlefield: [moon()] }),
            ],
        });
        const entered = applyPlayLand(state, state.players[0], "saga-hand")!;
        expect(entered.counters?.[LORE_COUNTER]).toBeUndefined();
        // …and with no counter there is no chapter I trigger to raise.
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(0);
        expect(entered.grantedActivatedAbilities ?? []).toEqual([]);
    });

    it("does not advance at precombat main and is NOT sacrificed (both CR 714 gates are shut)", () => {
        // Deliberately seeded at 5 lore counters, past what WOULD be its final
        // chapter: under the PRE-2026 rules `finalChapter` collapsed to 0 and
        // the Saga died on the spot ("Blood Moon kills Urza's Saga"). Under
        // the current rules it persists, inert. Do not "fix" this back.
        const { state, saga } = sagaBoard({
            lore: 5,
            opponentBattlefield: [moon()],
        });
        applySourceStaticEffects(state, state.players[1].battlefield[0]);
        expect(effectiveChapterAbilities(saga)).toEqual([]);
        expect(finalChapter(saga)).toBe(0);

        advanceSagasAtPrecombatMain(state);
        expect(saga.counters?.[LORE_COUNTER]).toBe(5); // frozen
        checkStateBasedActions(state);
        expect(state.players[0].battlefield).toContain(saga);
    });

    it("is still a Saga, and taps for {R} as a Mountain", () => {
        const { state, saga } = sagaBoard({
            lore: 1,
            opponentBattlefield: [moon()],
        });
        applySourceStaticEffects(state, state.players[1].battlefield[0]);
        expect(isSaga(saga)).toBe(true); // "Saga" is an enchantment subtype
        expect(saga.subtypes).toContain("Mountain");
        expect(saga.subtypes).not.toContain("Urza's");
        expect(getBasicLandMana(saga)).toBe("R");
    });
});

describe("wire format — lore counters and the granted abilities cross the projection", () => {
    it("the projected Saga keeps its lore count and its granted mana ability", () => {
        // The client never sees `GameState`. If either field is stripped here
        // the board offers no tap-for-mana affordance on the Saga at all —
        // the granted-ability seam #1880's review found three client gaps in.
        // The reducer-side half of this assertion (the real
        // `buildTriggerStateView` / `getStackAbilities` / `hasManaAbility`
        // mirrors) lives in `src/lib/__tests__/urzas-saga.test.ts`, which is
        // the tsconfig project those aliases resolve in.
        const { state, saga } = sagaBoard({ lore: 0 });
        tickChapter(state); // I — grants "{T}: Add {C}"
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === saga.id
        )!;
        expect(slim.counters?.[LORE_COUNTER]).toBe(1);
        expect(slim.grantedActivatedAbilities).toEqual([
            { sourceCardId: urzasSaga.id, abilityId: "urzas-saga-mana" },
        ]);
        // …and the projected instance is still a live {C} source server-side.
        expect(
            getManaTapOptionsDetailed(
                slim as unknown as CardInstanceState,
                "p1",
                [
                    {
                        playerId: "p1",
                        battlefield: projected.players[0]
                            .battlefield as unknown as CardInstanceState[],
                    },
                ]
            ).map((o) => o.mana)
        ).toEqual([{ C: 1 }]);
    });

    it("chapter II's grant also survives the projection", () => {
        const { state, saga } = sagaBoard({ lore: 1 });
        tickChapter(state); // II — grants the Construct maker
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === saga.id
        )!;
        expect(slim.grantedActivatedAbilities?.map((g) => g.abilityId)).toEqual(
            ["urzas-saga-construct"]
        );
    });
});
