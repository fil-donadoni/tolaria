// "This permanent enters with N counters on it" as a REPLACEMENT effect
// (CR 121.6 + CR 614.1c) — issue #1693.
//
// CR 121.6: "If an effect says a permanent enters the battlefield with counters
// on it, those counters are put onto that permanent as it enters." CR 614.1c
// makes that a self-replacement: it changes HOW the object enters, so the
// counters exist the first instant the permanent is observable. Modelling it as
// a `PERMANENT_ENTERED` triggered ability (the pre-#1693 shape) put the
// placement on the stack, gave both players priority with the permanent at zero
// counters, and rendered the clause as a respondable ability.
//
// This suite proves the ENGINE seam — the pure count oracle
// (`resolveEntersWithCounters`, `convex/cards/entersWith.ts`) and its
// application at every permanent-entry site. Per-card coverage lives in each
// set's colour test file; the catalogue-wide guard that no card re-declares the
// clause as a trigger lives in `convex/cards/__tests__/entersWithCounters.test.ts`.
import { describe, it, expect } from "vitest";
import { resolveEntersWithCounters } from "../../cards/entersWith";
import {
    buildSpellContext,
    exileWithAttachments,
    processPendingActionTriggers,
    resolveTopOfStack,
    returnExiledForSource,
    type CardInstanceState,
} from "../state";
import { applyPlayLand } from "../playLand";
import { buildStateFromScenario } from "../scenarioBuilder";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { projectPublicState } from "../../gameProjections";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import type { ScenarioSpec } from "../../debugScenarioSpec";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { driveCopyChoice } from "../../cards/sets/lea/__tests__/helpers";
import { clockworkBeast } from "../../cards/sets/lea/colorless";
import { clone } from "../../cards/sets/lea/blue";
import { rockHydra } from "../../cards/sets/lea/red";
import { everflowingChalice } from "../../cards/sets/wwk/colorless";
import { resurrection } from "../../cards/sets/lea/white";

describe("resolveEntersWithCounters — the count vocabulary (CR 121.6)", () => {
    it("returns an empty delta for a card declaring nothing", () => {
        expect(resolveEntersWithCounters(undefined, {})).toEqual({});
        expect(resolveEntersWithCounters({}, {})).toEqual({});
        expect(resolveEntersWithCounters({ entersWith: {} }, {})).toEqual({});
    });

    it("reads a literal count", () => {
        expect(
            resolveEntersWithCounters(
                { entersWith: { counters: [{ type: "wish", count: 3 }] } },
                {}
            )
        ).toEqual({ wish: 3 });
    });

    it("reads the cast-time X (CR 107.3) and treats an uncast entry as X = 0", () => {
        const def = {
            entersWith: { counters: [{ type: "+1/+1", count: "X" as const }] },
        };
        expect(resolveEntersWithCounters(def, { chosenX: 4 })).toEqual({
            "+1/+1": 4,
        });
        // CR 107.3b — X is 0 anywhere other than on the stack, so a reanimated
        // / tutored permanent enters with none.
        expect(resolveEntersWithCounters(def, {})).toEqual({});
    });

    it("reads the kicker tally (CR 702.33e) and drops a zero", () => {
        const def = {
            entersWith: {
                counters: [{ type: "charge", count: "kicker" as const }],
            },
        };
        expect(resolveEntersWithCounters(def, { kickerCount: 2 })).toEqual({
            charge: 2,
        });
        expect(resolveEntersWithCounters(def, { kickerCount: 0 })).toEqual({});
    });

    it("SUMS repeated entries of the same type — the 'N × kicker' idiom", () => {
        // "If this creature was kicked, it enters with four +1/+1 counters on
        // it" is four `count: "kicker"` entries (Duskwalker / Llanowar Elite /
        // Vodalian Serpent), so the tally 0/1 becomes 0 or 4.
        const def = {
            entersWith: {
                counters: [
                    { type: "+1/+1", count: "kicker" as const },
                    { type: "+1/+1", count: "kicker" as const },
                    { type: "+1/+1", count: "kicker" as const },
                    { type: "+1/+1", count: "kicker" as const },
                ],
            },
        };
        expect(resolveEntersWithCounters(def, { kickerCount: 1 })).toEqual({
            "+1/+1": 4,
        });
        expect(resolveEntersWithCounters(def, { kickerCount: 0 })).toEqual({});
    });

    it("drops non-positive literals rather than recording a zero counter", () => {
        expect(
            resolveEntersWithCounters(
                {
                    entersWith: {
                        counters: [
                            { type: "a", count: 0 },
                            { type: "b", count: -2 },
                            { type: "c", count: 1 },
                        ],
                    },
                },
                {}
            )
        ).toEqual({ c: 1 });
    });
});

describe("entry counters apply AS the permanent enters (CR 614.1c)", () => {
    it("a resolving permanent spell is on the battlefield with its counters and no stack item", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, clockworkBeast.id, "p1");
        resolveTopOfStack(state);

        const live = state.players[0].battlefield.find(
            (c) => c.id === item.id
        )!;
        expect(live.counters?.["+1/+0"]).toBe(7);
        // A printed 0/4 reads 7/4 on the very first look — the layer system
        // (CR 613) never sees the zero-counter intermediate state.
        expect(getEffectivePower(state, live)).toBe(7);
        expect(getEffectiveToughness(state, live)).toBe(4);
        // Nothing was put on the stack for the placement.
        expect(state.stack).toEqual([]);
    });

    it("the trigger scan collects nothing for the placement — no priority window at zero counters", () => {
        // CR 614.1c — the replacement is applied BEFORE the permanent is
        // considered to have entered, so draining the PERMANENT_ENTERED
        // notification through the trigger scan puts nothing on the stack:
        // neither player ever receives priority with the permanent holding
        // zero counters, and there is no ability to respond to.
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, clockworkBeast.id, "p1");
        resolveTopOfStack(state);
        expect(state.stack).toEqual([]);
        processPendingActionTriggers(state);
        expect(state.stack).toEqual([]);
        expect(state.pendingChoices ?? []).toEqual([]);
        const live = state.players[0].battlefield.find(
            (c) => c.id === item.id
        )!;
        expect(live.counters?.["+1/+0"]).toBe(7);
    });

    it("reads X chosen at cast time (CR 107.3)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, rockHydra.id, "p1");
        item.chosenX = 3;
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === item.id
        )!;
        expect(live.counters?.["+1/+1"]).toBe(3);
    });

    it("reads the Multikicker tally (CR 702.33e)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, everflowingChalice.id, "p1");
        item.kickerCount = 2;
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === item.id
        )!;
        expect(live.counters?.charge).toBe(2);
    });

    // The clause is not "as this is CAST" — a permanent put onto the
    // battlefield by ANY effect enters with its counters too (CR 121.6 says
    // "enters the battlefield", not "resolves"). Before #1693 this path applied
    // no entry counters at all: `entersWith` was read only at the
    // cast-resolution site, so a reanimated Clockwork Beast entered as a 0/4.
    it("applies on the non-cast entry path too (reanimation / put onto the battlefield)", () => {
        const beast = makeInstance(clockworkBeast.id, {
            id: "beast",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [beast] }),
                makePlayer("p2"),
            ],
        });
        const stackItem = pushSpell(state, resurrection.id, "p1");
        const ctx = buildSpellContext(state, stackItem);
        expect(ctx.returnToBattlefield("p1", "beast", "graveyard")).toBe(true);

        const live = state.players[0].battlefield.find(
            (c) => c.id === "beast"
        )!;
        expect(live.counters?.["+1/+0"]).toBe(7);
        expect(getEffectivePower(state, live)).toBe(7);
    });

    it("wire format: the counters survive projectPublicState with no zero-counter window", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, clockworkBeast.id, "p1");
        resolveTopOfStack(state);

        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === item.id
            )!;
            expect(slim.counters?.["+1/+0"]).toBe(7);
            expect(getEffectivePower(projected, slim)).toBe(7);
            // Nothing for the client to render on the stack / ability list.
            expect(projected.stack).toEqual([]);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-ENTRY-SITE coverage (issue #1693 engine review).
//
// The block above proves the two entry sites the original fix wired. These
// prove the rest of the census: every remaining route a permanent takes onto
// the battlefield runs the SAME shared applier, so the "applied at EVERY
// permanent-entry site" claim in `convex/cards/entersWith.ts` /
// `CardDefinition.entersWith` is literally true rather than aspirational.
// Each `it` fails on its own if that ONE site's applier call is reverted.
// ─────────────────────────────────────────────────────────────────────────────

/** Clockwork Beast's declared entry counters — the reference shape (a plain
 *  literal count, so no cast-time X/kicker is needed to observe it). */
const BEAST_COUNTERS = 7;

function beastOnBattlefield(id = "beast") {
    return makeInstance(clockworkBeast.id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        counters: { "+1/+0": BEAST_COUNTERS },
    });
}

describe("entry site: a token COPY (CR 706.2 / 707.2, issue #1693)", () => {
    // CR 706.2 — copiable values are the printed values as modified by other
    // copy effects, which INCLUDES the CR 121.6 self-replacement. So a token
    // that's a copy of Clockwork Beast is itself "a permanent that enters with
    // seven +1/+0 counters" and must enter holding them. `createTokenCopyOf`
    // built the token from a 0/0 placeholder spec and never consulted the
    // COPIED definition's `entersWith`, so the token entered at zero and read
    // 0/4 forever.
    function tokenCopyState() {
        const source = beastOnBattlefield("source-beast");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, resurrection.id, "p1");
        const ctx = buildSpellContext(state, item);
        const tokenId = ctx.createTokenCopyOf("source-beast", "p1");
        expect(tokenId).toBeDefined();
        return { state, tokenId: tokenId! };
    }

    it("the token copy enters with the copied card's entry counters", () => {
        const { state, tokenId } = tokenCopyState();
        const token = state.players[0].battlefield.find(
            (c) => c.id === tokenId
        )!;
        expect(token.isToken).toBe(true);
        expect(token.counters?.["+1/+0"]).toBe(BEAST_COUNTERS);
        // A printed 0/4 copy reads 7/4 on the layer system's FIRST look —
        // there is no window in which the token is a 0/4.
        expect(getEffectivePower(state, token)).toBe(BEAST_COUNTERS);
        expect(getEffectiveToughness(state, token)).toBe(4);
    });

    it("wire format: the token copy's counters survive projectPublicState", () => {
        const { state, tokenId } = tokenCopyState();
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === tokenId
        )!;
        expect(slim.counters?.["+1/+0"]).toBe(BEAST_COUNTERS);
        expect(getEffectivePower(projected, slim)).toBe(BEAST_COUNTERS);
    });
});

describe("entry site: a CLONE that copied during its own resolution (CR 707.2, issue #1693)", () => {
    // `finalizeSpellResolution` used to receive the definition its caller
    // captured BEFORE the resolve ran. Clone's `becomeCopyOf` rewrites
    // `item.card.id` mid-resolution, so the entry read Clone's own (empty)
    // `entersWith` and the copy entered with nothing. Re-deriving the
    // definition from the stack item at finalize time is what fixes it.
    function cloneCopyingBeast() {
        const source = beastOnBattlefield("source-beast");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, clone.id, "p1");
        item.id = "clone1";
        driveCopyChoice(state, item, "source-beast");
        return state;
    }

    it("enters with the COPIED card's entry counters, not the copier's", () => {
        const state = cloneCopyingBeast();
        const copy = state.players[0].battlefield.find(
            (c) => c.id === "clone1"
        )!;
        expect((copy.card as { id: string }).id).toBe(clockworkBeast.id);
        expect(copy.counters?.["+1/+0"]).toBe(BEAST_COUNTERS);
        expect(getEffectivePower(state, copy)).toBe(BEAST_COUNTERS);
        expect(getEffectiveToughness(state, copy)).toBe(4);
        // Still a replacement: nothing was put on the stack for the placement.
        expect(state.stack).toEqual([]);
    });

    it("wire format: the clone's copied entry counters survive projectPublicState", () => {
        const state = cloneCopyingBeast();
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "clone1"
        )!;
        expect(slim.counters?.["+1/+0"]).toBe(BEAST_COUNTERS);
        expect(getEffectivePower(projected, slim)).toBe(BEAST_COUNTERS);
    });
});

describe("entry site: BLINK / flicker return (CR 603.7a, issue #1693)", () => {
    // Tawnos's Coffin-style exile-and-return. `returnExiledForSource` applied
    // the entry replacement (inside `putReanimatedOnBattlefield`) and then
    // OVERWROTE `counters` wholesale with the noted bundle — discarding the
    // entry counters AFTER the trigger scan had already observed them.
    function blinkedBeast(noted: number) {
        const beast = beastOnBattlefield();
        beast.counters = { "+1/+0": noted };
        const coffin = makeInstance(clockworkBeast.id, {
            id: "coffin",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [beast, coffin] }),
                makePlayer("p2"),
            ],
        });
        expect(
            exileWithAttachments(state, "beast", {
                sourceId: "coffin",
                returnTapped: false,
            })
        ).not.toBeNull();
        returnExiledForSource(state, "coffin");
        return state;
    }

    it("keeps the entry counters and ADDS the noted ones back (CR 616.1)", () => {
        // Two replacement effects modify the same entry event: the card's own
        // CR 121.6 self-replacement (seven +1/+0) and the Coffin's "return it
        // with the noted counters on it". Both apply — hence 7 + 2, not 2.
        // Before the fix the noted-counter restore clobbered the entry
        // counters and the beast came back holding only the noted 2.
        const state = blinkedBeast(2);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "beast"
        )!;
        expect(live.counters?.["+1/+0"]).toBe(BEAST_COUNTERS + 2);
        expect(getEffectivePower(state, live)).toBe(BEAST_COUNTERS + 2);
    });

    it("wire format: the blinked permanent's counters survive projectPublicState", () => {
        const state = blinkedBeast(2);
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "beast"
        )!;
        expect(slim.counters?.["+1/+0"]).toBe(BEAST_COUNTERS + 2);
        expect(getEffectivePower(projected, slim)).toBe(BEAST_COUNTERS + 2);
    });
});

describe("entry site: token CREATION (CR 111.9 / 122.1c, issue #1693)", () => {
    // `createToken` used to re-implement the summing loop inline. The drift
    // that bought: it never ran the CR 122.1c / 613.4d keyword-counter grant
    // `applyEntersWithCounters` performs, so a token spec'd with an
    // `indestructible` counter carried the counter but never gained the
    // keyword — the exact class of bug the single-oracle design exists to
    // prevent.
    function tokenWithCounters(
        counters: { type: string; count: number }[]
    ): CardInstanceState {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, resurrection.id, "p1");
        const ctx = buildSpellContext(state, item);
        const [id] = ctx.createToken(
            {
                name: "Entry Counter Token",
                types: ["Creature"],
                subtypes: ["Construct"],
                power: 0,
                toughness: 4,
                entersWith: { counters },
            },
            "p1",
            1
        );
        return state.players[0].battlefield.find((c) => c.id === id)!;
    }

    it("grants the keyword a counter TYPE names (CR 122.1c / 613.4d)", () => {
        const token = tokenWithCounters([{ type: "indestructible", count: 1 }]);
        expect(token.counters?.indestructible).toBe(1);
        expect(token.staticAbilities).toContain("indestructible");
    });

    it("still SUMS repeated entries and drops non-positive counts", () => {
        const token = tokenWithCounters([
            { type: "+1/+1", count: 2 },
            { type: "+1/+1", count: 3 },
            { type: "shield", count: 0 },
        ]);
        expect(token.counters?.["+1/+1"]).toBe(5);
        expect(token.counters?.shield).toBeUndefined();
    });
});

describe("entry site: PLAY A LAND (CR 305, issue #1693)", () => {
    // `settleEnteredLand` — the shared post-move settlement behind all four
    // play-a-land routes (hand / exile / graveyard / post-pay-choice) — was a
    // full entry site with no applier at all. Latent for the shipped
    // catalogue (no printed Land declares `entersWith`), so the site is proven
    // with a synthetic Land definition: the point is that the SITE applies the
    // replacement, not that a particular card reaches it today.
    const LAND_DEF: CardDefinition = {
        id: "test-entry-counter-land",
        name: "Entry Counter Land",
        rarity: "common",
        oracleText:
            "Entry Counter Land enters with two depletion counters on it.",
        manaCost: {},
        types: ["Land"],
        entersWith: { counters: [{ type: "depletion", count: 2 }] },
    };

    it("a land played from hand enters with its declared counters", () => {
        registerTokenDefinition(LAND_DEF);
        const land = makeInstance(LAND_DEF.id, {
            id: "land1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            types: ["Land"],
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [land] }), makePlayer("p2")],
        });
        const entered = applyPlayLand(state, state.players[0], "land1");
        expect(entered).not.toBeNull();
        expect(entered!.counters?.depletion).toBe(2);
        // The replacement, not a trigger: nothing on the stack for it.
        expect(state.stack).toEqual([]);
        // Survives the wire.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "land1"
        )!;
        expect(slim.counters?.depletion).toBe(2);
    });
});

describe("entry site: put onto the battlefield WITH a pending pay-choice (CR 614.12, issue #1693)", () => {
    // `stageReanimatedOnBattlefield`'s `entersTappedUnlessPay` branch pushes
    // the permanent onto the battlefield and `return false`s to await the
    // stackless land-entry choice — jumping OVER the applier that used to sit
    // below it, and `finalizeLandEntry`'s effect-entry completion never
    // compensated. Moving the applier above the branch covers both exits.
    // Latent for the shipped catalogue (no card declares both clauses), so
    // again proven with a synthetic definition.
    const SHOCK_DEF: CardDefinition = {
        id: "test-entry-counter-shockland",
        name: "Entry Counter Shockland",
        rarity: "rare",
        oracleText:
            "As Entry Counter Shockland enters, you may pay 2 life. If you don't, it enters tapped. It enters with two depletion counters on it.",
        manaCost: {},
        types: ["Land"],
        entersTappedUnlessPay: { life: 2 },
        entersWith: { counters: [{ type: "depletion", count: 2 }] },
    };

    it("applies the counters even though the branch returns early for the choice", () => {
        registerTokenDefinition(SHOCK_DEF);
        const shock = makeInstance(SHOCK_DEF.id, {
            id: "shock1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
            types: ["Land"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [shock] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, resurrection.id, "p1");
        const ctx = buildSpellContext(state, item);
        ctx.returnToBattlefield("p1", "shock1", "graveyard");

        const live = state.players[0].battlefield.find(
            (c) => c.id === "shock1"
        )!;
        // The pay-choice is pending (the entry is deferred) — and the entry
        // counters are ALREADY on, because the replacement doesn't wait for it.
        expect(
            (state.pendingChoices ?? []).some(
                (c) => c.kind === "land-entry-tapped"
            )
        ).toBe(true);
        expect(live.counters?.depletion).toBe(2);
    });
});

describe("debug scenario boards default to the declared entry counters (issue #1693)", () => {
    // Not an entry site — a scenario PLACES a permanent — but the debug board
    // that exists to demo this fix reproduced the original symptom: a staged
    // Clockwork Beast sat there as a 0/4.
    it("a staged permanent gets its entersWith counters when the spec omits them", () => {
        const spec: ScenarioSpec = {
            cards: [
                {
                    name: clockworkBeast.name,
                    owner: "me",
                    zone: "battlefield",
                },
            ],
        };
        const state = buildStateFromScenario(makeState(), spec);
        const staged = state.players[0].battlefield[0];
        expect(staged.counters?.["+1/+0"]).toBe(BEAST_COUNTERS);
        expect(getEffectivePower(state, staged)).toBe(BEAST_COUNTERS);
    });

    it("an EXPLICIT counter spec still wins over the default", () => {
        const spec: ScenarioSpec = {
            cards: [
                {
                    name: clockworkBeast.name,
                    owner: "me",
                    zone: "battlefield",
                    counters: { "+1/+0": 2 },
                },
            ],
        };
        const state = buildStateFromScenario(makeState(), spec);
        expect(state.players[0].battlefield[0].counters?.["+1/+0"]).toBe(2);
    });
});
