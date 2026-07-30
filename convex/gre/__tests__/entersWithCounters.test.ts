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
    type GameState,
} from "../state";
import { checkSagaSacrificeSBA, checkStateBasedActions } from "../sba";
import { LORE_COUNTER } from "../../cards/abilities/sagas";
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
import { titaniasSong } from "../../cards/sets/atq/green";
import { bloodMoon } from "../../cards/sets/drk/red";

/** History of Benalia (`dom/white.ts`) — the catalogue's first Saga. Referenced
 *  by id (not by import) exactly as `gre/__tests__/sagas.test.ts` does. */
const HISTORY_OF_BENALIA_ID = "d134385d-b01c-41c7-bb2d-30722b44dc5a";

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
        item.kickerPayments = { kicker: 2 };
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

    // CR 614 + CR 121.1 (ADR 0078 §7) — the entry counters are STAMPED before
    // the enters-the-battlefield chokepoint (the CR 122.1c keyword grant has to
    // be on the token when the replacement loop reads it), but the
    // COUNTER_ADDED announcement is DEFERRED until the token actually reaches
    // the battlefield. A token redirected to exile never entered, so nothing
    // was ever put onto a permanent and no "whenever counters are put on ~"
    // ability may see it.
    const TOKEN_EXILER_ID = "test-entry-counter-token-exiler";
    const tokenExilerDef: CardDefinition = {
        id: TOKEN_EXILER_ID,
        name: "Test Token Exiler",
        rarity: "common",
        types: ["Artifact"],
        replacementEffects: [
            {
                id: "test-exile-entering-tokens",
                oracleText: "If a token would enter, exile it instead.",
                eventKind: "enters-battlefield",
                appliesTo: (event) =>
                    event.kind === "enters-battlefield" && event.isToken,
                replace: (event) => {
                    if (event.kind !== "enters-battlefield") {
                        throw new Error("unexpected event kind");
                    }
                    return {
                        kind: "modified",
                        event: { ...event, destination: "exile" },
                    };
                },
            },
        ],
    };

    /** Creates a token carrying one entry counter, optionally under a
     *  replacement that redirects entering tokens to exile. */
    function createCounterToken(withExiler: boolean): {
        state: ReturnType<typeof makeState>;
        tokenId: string;
    } {
        registerTokenDefinition(tokenExilerDef);
        const battlefield = withExiler
            ? [
                  makeInstance(TOKEN_EXILER_ID, {
                      id: "exiler",
                      controllerId: "p1",
                      ownerId: "p1",
                  }),
              ]
            : [];
        const state = makeState({
            players: [makePlayer("p1", { battlefield }), makePlayer("p2")],
        });
        const item = pushSpell(state, resurrection.id, "p1");
        const ctx = buildSpellContext(state, item);
        const [tokenId] = ctx.createToken(
            {
                name: "Deferred Emit Token",
                types: ["Creature"],
                subtypes: ["Construct"],
                power: 1,
                toughness: 1,
                entersWith: { counters: [{ type: "lore", count: 1 }] },
            },
            "p1",
            1
        );
        return { state, tokenId };
    }

    const counterAddedFor = (
        state: ReturnType<typeof makeState>,
        tokenId: string
    ) =>
        (state.pendingEvents ?? []).filter(
            (e) => e.type === "COUNTER_ADDED" && e.instanceId === tokenId
        );

    it("announces the entry counters for a token that really enters", () => {
        const { state, tokenId } = createCounterToken(false);
        expect(state.players[0].battlefield.some((c) => c.id === tokenId)).toBe(
            true
        );
        expect(counterAddedFor(state, tokenId)).toHaveLength(1);
    });

    it("does NOT announce entry counters for a token redirected to exile (CR 614)", () => {
        const { state, tokenId } = createCounterToken(true);
        expect(state.players[0].battlefield.some((c) => c.id === tokenId)).toBe(
            false
        );
        expect(state.players[0].exile.some((c) => c.id === tokenId)).toBe(true);
        expect(counterAddedFor(state, tokenId)).toEqual([]);
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

// ─────────────────────────────────────────────────────────────────────────────
// CR 614.1c + 613.1f — ability-loss suppresses the entry-counter clause
// (issue #1882).
//
// "[This permanent] enters with N counters on it" is a replacement effect
// GENERATED BY AN ABILITY of the permanent. An effect that removes all of a
// permanent's abilities removes that one too, so the permanent enters with NO
// counters at all — the canonical Blood Moon / Dark Depths ruling. Before this
// fix `applyEntersWithCounters` read `entersWith` straight off the
// `CardDefinition` with no gate, so the counters landed regardless.
//
// The gate is a PROBE, not a read of `abilitiesSuppressedBy`: at every entry
// site the permanent is not yet reconciled against the board
// (`applyExistingGrantsTo` runs AFTER the applier), so the materialized field is
// still empty. Each `it` below fails on its own if the probe is reverted.
// ─────────────────────────────────────────────────────────────────────────────

/** A synthetic Humility (CR 613.1f, "all permanents lose all abilities").
 *  Registered rather than imported because NO shipped card strips an
 *  ENCHANTMENT's abilities — Blood Moon hits nonbasic lands, Titania's Song
 *  noncreature artifacts — and the Saga / token-copy cases need one that does.
 *  `registerTokenDefinition` writes to the instance registry only; the shipped
 *  catalogue (`getAllCards`) is a separate static array, so nothing else in the
 *  suite sees this definition. Same device the play-a-land site above uses. */
const HUMILITY_DEF: CardDefinition = {
    id: "test-1882-ability-loss-all",
    name: "Humility (test)",
    rarity: "rare",
    oracleText: "All permanents lose all abilities.",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    staticEffects: [{ kind: "ability-loss", applies: () => true }],
};

/** A synthetic nonbasic Land declaring entry counters — the Urza's Saga shape
 *  (#1884), and the only way to exercise the Blood Moon / CR 305.7 route today
 *  (no shipped Land declares `entersWith`). */
const COUNTER_LAND_DEF: CardDefinition = {
    id: "test-1882-entry-counter-land",
    name: "Entry Counter Land 1882",
    rarity: "rare",
    oracleText: "This land enters with two depletion counters on it.",
    manaCost: {},
    types: ["Land"],
    entersWith: { counters: [{ type: "depletion", count: 2 }] },
};

/** A synthetic noncreature ARTIFACT whose entry counter TYPE names a keyword
 *  (CR 122.1c / 613.4d) — so the suppressed case can assert that the keyword
 *  grant riding on the counter is skipped too, not just the counter itself.
 *  Noncreature so Titania's Song, a real shipped `ability-loss`, reaches it. */
const KEYWORD_COUNTER_ARTIFACT: CardDefinition = {
    id: "test-1882-keyword-counter-artifact",
    name: "Keyword Counter Artifact 1882",
    rarity: "rare",
    oracleText: "This artifact enters with an indestructible counter on it.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    entersWith: { counters: [{ type: "indestructible", count: 1 }] },
};

/** Every `COUNTER_ADDED` still queued for `instanceId`. Zero counters MUST mean
 *  zero events (ADR 0078 §7) — a Saga entering under Humility must not fire
 *  chapter I, and the only thing that would make it fire is a stray
 *  announcement.
 *
 *  Only usable on the TOKEN entry sites: `pendingEvents` is a queue, and the
 *  spell-resolution / play-a-land sites run the trigger scan before returning,
 *  which DRAINS it. On those sites an empty queue proves nothing, so the
 *  announcement is asserted where it is observable instead — through its
 *  consequence, the Saga's chapter I trigger (CR 714.2b), in both directions. */
const counterAddedEventsFor = (state: GameState, instanceId: string) =>
    (state.pendingEvents ?? []).filter(
        (e) => e.type === "COUNTER_ADDED" && e.instanceId === instanceId
    );

function boardWith(...suppressors: CardInstanceState[]): GameState {
    return makeState({
        players: [
            makePlayer("p1", { battlefield: suppressors }),
            makePlayer("p2"),
        ],
    });
}

const humilityInstance = (id = "humility-1") => {
    registerTokenDefinition(HUMILITY_DEF);
    return makeInstance(HUMILITY_DEF.id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
};

describe("ability-loss suppresses entry counters (CR 614.1c + 613.1f, issue #1882)", () => {
    describe("entry site: SPELL RESOLUTION", () => {
        // Titania's Song — a REAL shipped `ability-loss` — vs. Everflowing
        // Chalice, a noncreature artifact whose two charge counters come from
        // the CR 702.33e Multikicker tally. The Song's `applies` predicate is
        // read while the Chalice is still a noncreature artifact (it only
        // becomes a creature once the layer pass runs, after the applier).
        function castChalice(
            battlefield: CardInstanceState[],
            kickerCount = 2
        ) {
            const state = boardWith(...battlefield);
            const item = pushSpell(state, everflowingChalice.id, "p1");
            item.kickerPayments = { kicker: kickerCount };
            resolveTopOfStack(state);
            const live = state.players[0].battlefield.find(
                (c) => c.id === item.id
            )!;
            return { state, live };
        }

        it("enters with ZERO counters under Titania's Song", () => {
            const song = makeInstance(titaniasSong.id, {
                id: "song-1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            });
            const { live } = castChalice([song]);
            expect(live.counters?.charge).toBeUndefined();
        });

        it("NO REGRESSION — the same cast with no ability-loss on the board keeps its counters", () => {
            const { live } = castChalice([]);
            expect(live.counters?.charge).toBe(2);
        });

        it("wire format: the suppressed permanent shows no counters after projectPublicState", () => {
            const song = makeInstance(titaniasSong.id, {
                id: "song-1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            });
            const { state, live } = castChalice([song]);
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === live.id
            )!;
            expect(slim.counters?.charge).toBeUndefined();
        });

        it("the CR 122.1c keyword-counter grant is skipped too", () => {
            // An `indestructible` entry counter grants the keyword. Suppressed,
            // there is no counter, so there is nothing to grant.
            registerTokenDefinition(KEYWORD_COUNTER_ARTIFACT);
            const song = makeInstance(titaniasSong.id, {
                id: "song-1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            });
            const state = boardWith(song);
            const item = pushSpell(state, KEYWORD_COUNTER_ARTIFACT.id, "p1");
            resolveTopOfStack(state);
            const live = state.players[0].battlefield.find(
                (c) => c.id === item.id
            )!;
            expect(live.counters?.indestructible).toBeUndefined();
            expect(live.staticAbilities).not.toContain("indestructible");
        });
    });

    describe("entry site: PLAY A LAND under Blood Moon (CR 305.7)", () => {
        function playCounterLand(battlefield: CardInstanceState[]) {
            registerTokenDefinition(COUNTER_LAND_DEF);
            const land = makeInstance(COUNTER_LAND_DEF.id, {
                id: "land-1882",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
                types: ["Land"],
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { hand: [land], battlefield }),
                    makePlayer("p2"),
                ],
            });
            const entered = applyPlayLand(state, state.players[0], "land-1882");
            return { state, entered: entered! };
        }

        it("a nonbasic land enters with ZERO counters while Blood Moon is out", () => {
            const moon = makeInstance(bloodMoon.id, {
                id: "moon-1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            });
            const { entered } = playCounterLand([moon]);
            expect(entered).not.toBeNull();
            expect(entered.counters?.depletion).toBeUndefined();
        });

        it("NO REGRESSION — the same land with no Blood Moon keeps its counters", () => {
            const { entered } = playCounterLand([]);
            expect(entered.counters?.depletion).toBe(2);
        });
    });

    describe("entry site: a TOKEN COPY (CR 706.2)", () => {
        // The copied card's CR 614.1c clause is a COPIABLE value, so it is an
        // ability OF THE TOKEN — and is therefore suppressed exactly like the
        // original's would be.
        function tokenCopyOfBeast(battlefield: CardInstanceState[]) {
            const source = beastOnBattlefield("source-beast");
            const state = boardWith(...battlefield, source);
            const item = pushSpell(state, resurrection.id, "p1");
            const ctx = buildSpellContext(state, item);
            const tokenId = ctx.createTokenCopyOf("source-beast", "p1")!;
            const token = state.players[0].battlefield.find(
                (c) => c.id === tokenId
            )!;
            return { state, token };
        }

        it("a token copy enters with ZERO counters under a 'loses all abilities' static", () => {
            const { state, token } = tokenCopyOfBeast([humilityInstance()]);
            expect(token.isToken).toBe(true);
            expect(token.counters?.["+1/+0"]).toBeUndefined();
            expect(counterAddedEventsFor(state, token.id)).toEqual([]);
        });

        it("NO REGRESSION — the same token copy with no static keeps the copied counters", () => {
            const { state, token } = tokenCopyOfBeast([]);
            expect(token.counters?.["+1/+0"]).toBe(BEAST_COUNTERS);
            expect(counterAddedEventsFor(state, token.id)).toHaveLength(1);
        });
    });

    describe("entry site: TOKEN CREATION is NOT suppressed (CR 121.6)", () => {
        // The carve-out. "Create a token with N +1/+1 counters on it"
        // (Incubate N) puts those counters on as part of the RESOLVING EFFECT,
        // not via an ability of the token — so no ability-loss can remove them.
        // `createTokenPermanents` opts out via `fromCreatingEffect`.
        it("a token created WITH counters keeps them under a 'loses all abilities' static", () => {
            const state = boardWith(humilityInstance());
            const item = pushSpell(state, resurrection.id, "p1");
            const ctx = buildSpellContext(state, item);
            const [id] = ctx.createToken(
                {
                    name: "Incubator 1882",
                    types: ["Artifact"],
                    entersWith: { counters: [{ type: "+1/+1", count: 2 }] },
                },
                "p1",
                1
            );
            const token = state.players[0].battlefield.find(
                (c) => c.id === id
            )!;
            expect(token.counters?.["+1/+1"]).toBe(2);
            expect(counterAddedEventsFor(state, token.id)).toHaveLength(1);
        });
    });

    describe("a SAGA entering under ability-loss (CR 714.3a + 613.1f)", () => {
        // 714.3a ("this Saga enters with a lore counter on it") is an ability,
        // so a Saga entering while Humility is already out gets ZERO lore
        // counters — and, per the 2026 CR 714.3c / 714.4 gates (both already
        // conditioned on having one or more chapter abilities), then persists
        // INERT: never advanced, never sacrificed.
        function castHistoryOfBenalia(battlefield: CardInstanceState[]) {
            const state = boardWith(...battlefield);
            const item = pushSpell(state, HISTORY_OF_BENALIA_ID, "p1");
            resolveTopOfStack(state);
            const saga = state.players[0].battlefield.find(
                (c) => c.id === item.id
            )!;
            return { state, saga };
        }

        it("enters with ZERO lore counters and never puts chapter I on the stack", () => {
            const { state, saga } = castHistoryOfBenalia([humilityInstance()]);
            expect(saga.subtypes).toContain("Saga"); // identity is the SUBTYPE
            expect(saga.counters?.[LORE_COUNTER]).toBeUndefined();
            processPendingActionTriggers(state);
            expect(
                state.stack.filter((i) => i.triggerSourceId === saga.id)
            ).toEqual([]);
        });

        it("stays on the battlefield, inert (CR 714.4 does not sacrifice it)", () => {
            const { state, saga } = castHistoryOfBenalia([humilityInstance()]);
            expect(checkSagaSacrificeSBA(state)).toBe(false);
            checkStateBasedActions(state);
            expect(state.players[0].battlefield).toContain(saga);
            expect(saga.counters?.[LORE_COUNTER]).toBeUndefined();
        });

        it("NO REGRESSION — with no static the Saga enters at one lore counter and fires chapter I", () => {
            const { state, saga } = castHistoryOfBenalia([]);
            expect(saga.counters?.[LORE_COUNTER]).toBe(1);
            expect(
                state.stack.filter((i) => i.triggerSourceId === saga.id)
            ).toHaveLength(1);
        });
    });
});
