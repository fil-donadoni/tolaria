// Convoke / `payWith` cast-cost framework (CR 702.51, CR 601.2f/601.2g — issue
// #1338, PRD #702, ADR 0063). Covers the whole path in one file:
//   - GRE unit: the `gre/payWith.ts` convoke primitives + the coverage greedy +
//     the `coloredCostLeftover` castability probe (convoke pseudo-sources +
//     can't-spend-mana source exclusion + guild-hybrid pip matching).
//   - Integration: `recordConvokeCreaturePick` + `tryAutoCommitPendingCast` —
//     the functions the `selectConvokeCreatures` mutation calls — including the
//     creature TAP and the delve-picker chaining at commit.
//   - Wire format: the convoke picker survives `projectPublicState`, and the
//     can't-spend-mana castability crosses the projection.
//
// Hogaak, Arisen Necropolis ({5}{B/G}{B/G}, mh1/multicolor.ts) is the first card
// to ship convoke, guild-hybrid pips, `cantSpendManaToCast`, and the intrinsic
// `castableFromOwnGraveyard` permission.

import { describe, it, expect } from "vitest";
import {
    buildConvokeCreatureChoice,
    convokeEligibleCreatures,
    coverColoredAndHybridPips,
    spellHasConvoke,
} from "../gre/payWith";
import { getLegalActions } from "../gre/rules";
import {
    applyConvokeCreatureSelection,
    recordConvokeCreaturePick,
    tryAutoCommitPendingCast,
    recordCastExileCostPick,
} from "../game";
import { getCardByName } from "../cards";
import { manaValue } from "../gre/constants";
import { getColorsFromCost } from "../cards/colors";
import type { Color } from "../cards/types";
import type { PendingCast } from "../gre/state";
import { projectPublicState } from "../gameProjections";
import { compactState, expandState } from "../gre/serialize";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";

const HOGAAK = getCardByName("Hogaak, Arisen Necropolis").id;
const CRAW_WURM = getCardByName("Craw Wurm").id; // mono-green creature
const DRUDGE_SKELETONS = getCardByName("Drudge Skeletons").id; // mono-black
const EARTH_ELEMENTAL = getCardByName("Earth Elemental").id; // mono-red
const SWAMP = getCardByName("Swamp").id;
const DISRUPT = getCardByName("Disrupt")?.id ?? "no-disrupt";

/** `n` cards in p1's graveyard as delve fuel. */
function fuel(n: number, prefix = "gy") {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(SWAMP, {
            id: `${prefix}${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        })
    );
}

/** A board with Hogaak in `zone`, the given untapped creatures, `gyCount`
 *  graveyard fuel, and `lands` untapped Swamps. */
function board(opts: {
    creatures?: string[];
    gyCount?: number;
    lands?: number;
    hogaakZone?: "hand" | "graveyard";
}) {
    const zone = opts.hogaakZone ?? "hand";
    const hogaak = makeInstance(HOGAAK, {
        id: "hogaak",
        controllerId: "p1",
        ownerId: "p1",
        zone,
    });
    const creatures = (opts.creatures ?? []).map((cardId, i) =>
        makeInstance(cardId, {
            id: `cr${i}`,
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    const lands = Array.from({ length: opts.lands ?? 0 }, (_, i) =>
        makeInstance(SWAMP, { id: `land${i}`, controllerId: "p1" })
    );
    const gy = fuel(opts.gyCount ?? 0);
    const p1 = makePlayer("p1", {
        hand: zone === "hand" ? [hogaak] : [],
        graveyard: zone === "graveyard" ? [hogaak, ...gy] : gy,
        battlefield: [...creatures, ...lands],
    });
    const state = makeState({
        players: [p1, makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
    return { state, player: state.players[0], hogaak };
}

describe("Hogaak card definition (CR 202.3f / 105.2 — issue #1338)", () => {
    it("declares convoke, delve, trample and the can't-spend-mana / graveyard-cast flags", () => {
        const def = getCardByName("Hogaak, Arisen Necropolis");
        expect(def.staticAbilities).toEqual(
            expect.arrayContaining(["convoke", "delve", "trample"])
        );
        expect(def.cantSpendManaToCast).toBe(true);
        expect(def.castableFromOwnGraveyard).toBe(true);
    });

    it("has mana value 7 — each guild-hybrid pip counts 1 (CR 202.3f)", () => {
        expect(
            manaValue(getCardByName("Hogaak, Arisen Necropolis").manaCost)
        ).toBe(7);
    });

    it("is both black and green — a {B/G} pip is both colours (CR 105.2)", () => {
        const colors = getColorsFromCost(
            getCardByName("Hogaak, Arisen Necropolis").manaCost
        );
        expect(colors.sort()).toEqual(["B", "G"]);
    });
});

describe("convoke keyword recognition + eligibility (CR 702.51)", () => {
    it("reads convoke off the card definition", () => {
        const { hogaak } = board({});
        expect(spellHasConvoke(hogaak)).toBe(true);
    });

    it("eligible creatures = the caster's UNTAPPED creatures (summoning sickness irrelevant)", () => {
        const { player } = board({ creatures: [CRAW_WURM, DRUDGE_SKELETONS] });
        // A freshly-cast (summoning-sick) creature still convokes — convoke
        // taps no `{T}` activation cost, so CR 602.5a never applies to it.
        expect(
            convokeEligibleCreatures(player)
                .map((c) => c.id)
                .sort()
        ).toEqual(["cr0", "cr1"]);
    });

    it("excludes a tapped creature", () => {
        const { player } = board({ creatures: [CRAW_WURM, DRUDGE_SKELETONS] });
        player.battlefield[0].isTapped = true;
        expect(convokeEligibleCreatures(player).map((c) => c.id)).toEqual([
            "cr1",
        ]);
    });
});

describe("coverColoredAndHybridPips — the shared greedy (CR 702.51a / 202.1a)", () => {
    const B = new Set<Color>(["B"]);
    const G = new Set<Color>(["G"]);
    const R = new Set<Color>(["R"]);

    it("matches guild-hybrid pips to sources of either colour, leftover → generic", () => {
        // Two {B/G} pips + three generic: 2 coloured sources pay the hybrids,
        // the other 3 sources survive for generic.
        const leftover = coverColoredAndHybridPips([B, G, R, R, R], {}, [
            ["B", "G"],
            ["B", "G"],
        ]);
        expect(leftover).toBe(3);
    });

    it("returns null when no source can pay a hybrid pip", () => {
        expect(coverColoredAndHybridPips([R, R], {}, [["B", "G"]])).toBeNull();
    });

    it("pays single-colour pips first, then hybrids", () => {
        expect(coverColoredAndHybridPips([B, G], { B: 1 }, [["B", "G"]])).toBe(
            0
        );
    });
});

describe("convoke picker construction — Arena prompt policy (ADR 0063)", () => {
    it("forces the two hybrid pips and bounds max by all payable pips", () => {
        const { player, hogaak } = board({
            creatures: [CRAW_WURM, DRUDGE_SKELETONS, CRAW_WURM],
            gyCount: 5, // delve covers the full generic, so ONLY the hybrids are forced
        });
        const choice = buildConvokeCreatureChoice(player, hogaak, { X: 5 });
        // min = 2 (the two {B/G} pips must be convoked under can't-spend-mana;
        // the 5 generic are all delve-coverable so they add nothing to min);
        // max = min(3 creatures, 2 hybrid + 5 generic).
        expect(choice?.min).toBe(2);
        expect(choice?.max).toBe(3);
        expect(choice?.hybridPips).toEqual([
            ["B", "G"],
            ["B", "G"],
        ]);
    });

    it("returns undefined when the caster controls no creatures", () => {
        const { player, hogaak } = board({});
        expect(
            buildConvokeCreatureChoice(player, hogaak, { X: 5 })
        ).toBeUndefined();
    });
});

// Regression for the review-blocking stall (issue #1338 review): under
// can't-spend-mana the forced convoke minimum omitted the generic pips delve
// CANNOT cover. On a natural Hogaak board (fuel < remaining generic) the delve
// picker was forced to N but capped below its fuel, so `manaCost.X` never
// reached 0 and `tryAutoCommitPendingCast` parked the cast forever — a hard bot
// stall with no owed choice and no legal pass. The forced minimum must be
// coloured + hybrid pips PLUS `max(0, generic − delve fuel)`.
describe("forced minimum covers the generic delve can't pay (CR 601.2f — #1338 review)", () => {
    it("raises min when delve fuel is STRICTLY LESS than the generic after the hybrids", () => {
        // {5}{B/G}{B/G}: 2 hybrids + 5 generic. 3 delve fuel covers only 3 of the
        // generic → the other 2 generic pips can ONLY be convoked. min = 2 + 2 = 4.
        const { player, hogaak } = board({
            creatures: [
                CRAW_WURM,
                DRUDGE_SKELETONS,
                CRAW_WURM,
                DRUDGE_SKELETONS,
            ],
            gyCount: 3,
        });
        const choice = buildConvokeCreatureChoice(player, hogaak, { X: 5 });
        expect(choice?.min).toBe(4);
        expect(choice?.max).toBe(4);
    });

    it("forces ALL generic onto convoke when there is no delve fuel", () => {
        // 0 fuel → every generic pip must be convoked: min = 2 hybrids + 5 generic.
        const { player, hogaak } = board({
            creatures: Array(7).fill(CRAW_WURM),
            gyCount: 0,
        });
        const choice = buildConvokeCreatureChoice(player, hogaak, { X: 5 });
        expect(choice?.min).toBe(7);
        expect(choice?.max).toBe(7);
    });

    it("convoke+delve together fully pay the cost through the real commit path — Hogaak lands, no land tapped, no infinite park", () => {
        const b = board({
            creatures: [
                CRAW_WURM,
                DRUDGE_SKELETONS,
                CRAW_WURM,
                DRUDGE_SKELETONS,
            ],
            gyCount: 3,
            lands: 4,
        });
        // Park the cast with the REAL built picker (min raised to 4).
        const choice = buildConvokeCreatureChoice(b.player, b.hogaak, { X: 5 });
        expect(choice?.min).toBe(4);
        b.state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "hogaak",
            manaCost: { X: 5 },
            tappedLandIds: [],
            convokeCreatureChoice: choice,
        };

        // Tap the forced 4 creatures: 2 pay the hybrids, 2 pay down generic
        // (5 → 3); delve is then forced to exactly the 3 available fuel cards.
        recordConvokeCreaturePick(b.state, "p1", ["cr0", "cr1", "cr2", "cr3"]);
        expect(b.state.pendingCast!.manaCost.X).toBe(3);
        expect(
            b.state.pendingCast!.exileFromGraveyardChoice?.offsetGeneric
        ).toEqual({ min: 3, max: 3 });

        recordCastExileCostPick(b.state, "p1", ["gy0", "gy1", "gy2"]);
        expect(b.state.pendingCast!.manaCost.X).toBe(0);

        tryAutoCommitPendingCast(b.state, "p1");

        // Cost fully paid → Hogaak resolves onto the stack, cast un-parked.
        expect(b.state.pendingCast).toBeUndefined();
        expect(b.state.stack).toHaveLength(1);
        expect(b.state.stack[0].card.id).toBe(HOGAAK);
        // All four creatures tapped for convoke (CR 702.51a).
        expect(
            b.player.battlefield
                .filter((c) => c.isTapped)
                .map((c) => c.id)
                .sort()
        ).toEqual(["cr0", "cr1", "cr2", "cr3"]);
        // No land tapped — can't-spend-mana forbids it (CR 601.2f).
        expect(
            b.player.battlefield
                .filter((c) => c.id.startsWith("land"))
                .every((c) => !c.isTapped)
        ).toBe(true);
    });
});

describe("castability probe — convoke + delve + can't-spend-mana (CR 601.2f)", () => {
    it("offers 'cast' from HAND when 2 B/G creatures + 5 delve fuel cover the whole cost", () => {
        const { state, player, hogaak } = board({
            creatures: [CRAW_WURM, DRUDGE_SKELETONS],
            gyCount: 5,
        });
        expect(getLegalActions(state, player, hogaak)).toContain("cast");
    });

    it("withholds 'cast' when the two coloured pips can't be convoked (only a red creature)", () => {
        const { state, player, hogaak } = board({
            creatures: [EARTH_ELEMENTAL],
            gyCount: 20,
        });
        expect(getLegalActions(state, player, hogaak)).not.toContain("cast");
    });

    it("withholds 'cast' when the generic can't be covered (2 creatures, no delve fuel)", () => {
        const { state, player, hogaak } = board({
            creatures: [CRAW_WURM, DRUDGE_SKELETONS],
            gyCount: 0,
        });
        expect(getLegalActions(state, player, hogaak)).not.toContain("cast");
    });

    it("never lets a land pay a pip — lands present but no creatures = uncastable", () => {
        const { state, player, hogaak } = board({ lands: 10, gyCount: 20 });
        expect(getLegalActions(state, player, hogaak)).not.toContain("cast");
    });

    it("offers 'cast' from the GRAVEYARD via the intrinsic permission (CR 601.3e)", () => {
        const { state, player, hogaak } = board({
            creatures: [CRAW_WURM, DRUDGE_SKELETONS],
            gyCount: 5,
            hogaakZone: "graveyard",
        });
        expect(getLegalActions(state, player, hogaak)).toContain("cast");
    });
});

/** A parked Hogaak cast: manaCost {X:5}, convoke picker open. */
function parkedCast(opts: {
    creatures: string[];
    gyCount: number;
    lands?: number;
    hogaakZone?: "hand" | "graveyard";
}) {
    const b = board(opts);
    const pendingCast: PendingCast = {
        playerId: "p1",
        cardInstanceId: "hogaak",
        manaCost: { X: 5 },
        tappedLandIds: [],
        convokeCreatureChoice: {
            min: 2,
            max: Math.min(opts.creatures.length, 7),
            hybridPips: [
                ["B", "G"],
                ["B", "G"],
            ],
        },
    };
    b.state.pendingCast = pendingCast;
    return { ...b, pendingCast };
}

describe("recordConvokeCreaturePick — validation + coverage (CR 702.51a)", () => {
    it("taps hybrids with 2 B/G creatures and leaves the generic to delve", () => {
        const { state, pendingCast } = parkedCast({
            creatures: [CRAW_WURM, DRUDGE_SKELETONS],
            gyCount: 5,
        });
        recordConvokeCreaturePick(state, "p1", ["cr0", "cr1"]);
        expect(pendingCast.convokeCreatureChoice?.pickedCreatureIds).toEqual([
            "cr0",
            "cr1",
        ]);
        // No generic paid by convoke (both creatures went to hybrids).
        expect(pendingCast.manaCost.X).toBe(5);
        // The delve picker was opened on the remaining {5} generic, forced full
        // (can't-spend-mana leaves mana unable to pay any of it).
        expect(pendingCast.exileFromGraveyardChoice?.offsetGeneric).toEqual({
            min: 5,
            max: 5,
        });
    });

    it("convoking EXTRA creatures pays down the generic too", () => {
        const { state, pendingCast } = parkedCast({
            creatures: [CRAW_WURM, DRUDGE_SKELETONS, CRAW_WURM, CRAW_WURM],
            gyCount: 5,
        });
        recordConvokeCreaturePick(state, "p1", ["cr0", "cr1", "cr2", "cr3"]);
        // 2 hybrids + 2 generic → X drops to 3, delve picks up the last 3.
        expect(pendingCast.manaCost.X).toBe(3);
        expect(pendingCast.exileFromGraveyardChoice?.offsetGeneric).toEqual({
            min: 3,
            max: 3,
        });
    });

    it("rejects fewer than the forced minimum", () => {
        const { state } = parkedCast({
            creatures: [CRAW_WURM, DRUDGE_SKELETONS],
            gyCount: 5,
        });
        expect(() => recordConvokeCreaturePick(state, "p1", ["cr0"])).toThrow(
            /at least 2/
        );
    });

    it("rejects a creature set that can't colour-cover the hybrid pips", () => {
        const { state } = parkedCast({
            creatures: [EARTH_ELEMENTAL, EARTH_ELEMENTAL],
            gyCount: 5,
        });
        expect(() =>
            recordConvokeCreaturePick(state, "p1", ["cr0", "cr1"])
        ).toThrow(/can't cover/);
    });

    it("rejects a tapped creature", () => {
        const { state, player } = parkedCast({
            creatures: [CRAW_WURM, DRUDGE_SKELETONS],
            gyCount: 5,
        });
        player.battlefield[0].isTapped = true;
        expect(() =>
            recordConvokeCreaturePick(state, "p1", ["cr0", "cr1"])
        ).toThrow(/already tapped/);
    });

    it("rejects a permanent that is not a creature", () => {
        const { state } = parkedCast({
            creatures: [CRAW_WURM, DRUDGE_SKELETONS],
            gyCount: 5,
            lands: 1,
        });
        expect(() =>
            recordConvokeCreaturePick(state, "p1", ["cr0", "land0"])
        ).toThrow(/not a creature/);
    });

    it("rejects a duplicate creature", () => {
        const { state } = parkedCast({
            creatures: [CRAW_WURM, DRUDGE_SKELETONS],
            gyCount: 5,
        });
        expect(() =>
            recordConvokeCreaturePick(state, "p1", ["cr0", "cr0"])
        ).toThrow(/Duplicate/);
    });

    it("leaves the creatures UNTAPPED until commit", () => {
        const { state, player } = parkedCast({
            creatures: [CRAW_WURM, DRUDGE_SKELETONS],
            gyCount: 5,
        });
        recordConvokeCreaturePick(state, "p1", ["cr0", "cr1"]);
        expect(player.battlefield.every((c) => !c.isTapped)).toBe(true);
    });
});

describe("Hogaak commit — convoke → delve → NO mana (CR 601.2f/601.2g)", () => {
    it("blocks commit while the convoke picker is unanswered", () => {
        const { state } = parkedCast({
            creatures: [CRAW_WURM, DRUDGE_SKELETONS],
            gyCount: 5,
        });
        tryAutoCommitPendingCast(state, "p1");
        expect(state.pendingCast).toBeDefined();
        expect(state.stack).toHaveLength(0);
    });

    it("casts Hogaak from HAND via 2 convoke creatures + 5 delve, tapping NO land", () => {
        const { state, player } = parkedCast({
            creatures: [CRAW_WURM, DRUDGE_SKELETONS],
            gyCount: 5,
            lands: 4,
        });
        recordConvokeCreaturePick(state, "p1", ["cr0", "cr1"]);
        recordCastExileCostPick(state, "p1", [
            "gy0",
            "gy1",
            "gy2",
            "gy3",
            "gy4",
        ]);
        expect(state.pendingCast!.manaCost.X).toBe(0);

        tryAutoCommitPendingCast(state, "p1");

        expect(state.pendingCast).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].card.id).toBe(HOGAAK);
        // The two creatures are tapped (CR 702.51a).
        expect(
            player.battlefield
                .filter((c) => c.isTapped)
                .map((c) => c.id)
                .sort()
        ).toEqual(["cr0", "cr1"]);
        // The five fuel cards left the graveyard for exile (CR 702.66b).
        expect(player.exile).toHaveLength(5);
        // NO land was tapped — can't-spend-mana forbids it (CR 601.2f).
        expect(
            player.battlefield
                .filter((c) => c.id.startsWith("land"))
                .every((c) => !c.isTapped)
        ).toBe(true);
    });

    it("casts Hogaak from the GRAVEYARD (intrinsic permission), landing on the stack", () => {
        const { state } = parkedCast({
            creatures: [
                CRAW_WURM,
                DRUDGE_SKELETONS,
                CRAW_WURM,
                CRAW_WURM,
                CRAW_WURM,
                DRUDGE_SKELETONS,
                CRAW_WURM,
            ],
            gyCount: 0,
            hogaakZone: "graveyard",
        });
        // All seven pips convoked (2 hybrid + 5 generic), no delve needed.
        recordConvokeCreaturePick(state, "p1", [
            "cr0",
            "cr1",
            "cr2",
            "cr3",
            "cr4",
            "cr5",
            "cr6",
        ]);
        expect(state.pendingCast!.manaCost.X).toBe(0);
        expect(state.pendingCast!.exileFromGraveyardChoice).toBeUndefined();

        tryAutoCommitPendingCast(state, "p1");

        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].card.id).toBe(HOGAAK);
    });
});

describe("persistence — the convoke picker survives a DB round trip", () => {
    it("round-trips convokeCreatureChoice through compact/expand", () => {
        const { state } = parkedCast({
            creatures: [CRAW_WURM, DRUDGE_SKELETONS],
            gyCount: 5,
        });
        recordConvokeCreaturePick(state, "p1", ["cr0", "cr1"]);
        const restored = expandState(compactState(state));
        expect(
            restored.pendingCast?.convokeCreatureChoice?.pickedCreatureIds
        ).toEqual(["cr0", "cr1"]);
        expect(restored.pendingCast?.convokeCreatureChoice?.hybridPips).toEqual(
            [
                ["B", "G"],
                ["B", "G"],
            ]
        );
    });
});

describe("wire format — the convoke picker + castability cross the projection", () => {
    it("projectPublicState carries convokeCreatureChoice to the client dialog", () => {
        const { state } = parkedCast({
            creatures: [CRAW_WURM, DRUDGE_SKELETONS],
            gyCount: 5,
        });
        const projected = projectPublicState(state, 1, "p1");
        const cc = projected.pendingCast?.convokeCreatureChoice;
        expect(cc?.min).toBe(2);
        expect(cc?.hybridPips).toEqual([
            ["B", "G"],
            ["B", "G"],
        ]);
        expect(cc?.pickedCreatureIds).toBeUndefined();
    });

    it("ungrays Hogaak on the wire when convoke + delve make it payable", () => {
        const { state } = board({
            creatures: [CRAW_WURM, DRUDGE_SKELETONS],
            gyCount: 5,
        });
        const projected = projectPublicState(state, 1, "p1");
        const me = projected.players.find((p) => p.id === "p1")!;
        expect(me.hand[0]!.legalActions).toContain("cast");
    });

    // Silence the unused-import guard when Disrupt is absent from the catalogue.
    void DISRUPT;
});

// issue #1660, third round — the previous fixup's `opts.autoResolve` boolean
// on `buildDelveExileChoice` turned OFF the #1660 short-circuit for the
// convoke-chained delve leg entirely (to keep `recordConvokeCreaturePick`
// pure), which silently reopened the exact bug on Hogaak: a fully-forced
// delve pick chained off convoke landed on `pendingCast` unresolved, blocking
// `tryAutoCommitPendingCast` and leaving `cast-exile-cost-dialog.tsx` open
// with only Confirm/Cancel — issue #1660 verbatim, merely relocated from the
// single-leg cast path to the convoke path. Nothing above this point drove
// that user-facing outcome: every existing test in this file either asserts
// the picker STAYS unresolved after `recordConvokeCreaturePick` (correct —
// that step must stay a pure record) or hand-picks the delve cards via
// `recordCastExileCostPick` instead of letting the forced pick resolve
// itself. This block closes that gap: it drives the actual
// `selectConvokeCreatures` commit seam — `recordConvokeCreaturePick` →
// `collapseForcedDelvePick` → `tryAutoCommitPendingCast`, in that order,
// exactly as the mutation's handler calls them — and asserts the picker
// never has to be shown to the player.
//
// Drives `applyConvokeCreatureSelection` — the pure core extracted out of the
// `selectConvokeCreatures` mutation (issue #1660 gap fixup) — rather than
// hand-re-listing its three steps (`recordConvokeCreaturePick` →
// `collapseForcedDelvePick` → `tryAutoCommitPendingCast`). Calling the actual
// extracted function, instead of reimplementing its sequence here, is what
// pins the production call site: deleting the `collapseForcedDelvePick` call
// from `applyConvokeCreatureSelection` now fails this test. The mid-record
// "still unresolved" shape is already covered by the
// `recordConvokeCreaturePick — validation + coverage` describe block above
// (e.g. "taps hybrids with 2 B/G creatures and leaves the generic to
// delve"), so this block only needs to assert the seam's end-to-end outcome.
describe("selectConvokeCreatures commit seam — collapses a forced delve leg (issue #1660, round 3)", () => {
    it("2 B/G creatures + exactly 5 graveyard fuel: the chained delve leg pre-fills instead of opening a picker", () => {
        // The project has no convex-test harness (see the file header / the
        // no-convex-test-harness precedent catalogued across `__tests__/`),
        // so — mirroring `delveCastCost.test.ts`'s equivalent seam test for
        // the single-leg `finalizeTargetSelection` path — this drives
        // `applyConvokeCreatureSelection`, the exact pure core
        // `selectConvokeCreatures`'s handler now delegates to, rather than
        // the mutation itself.
        const { state, player, pendingCast } = parkedCast({
            creatures: [CRAW_WURM, DRUDGE_SKELETONS],
            gyCount: 5,
        });

        applyConvokeCreatureSelection(state, "p1", ["cr0", "cr1"]);

        expect(
            pendingCast.exileFromGraveyardChoice?.pickedCardIds?.slice().sort()
        ).toEqual(["gy0", "gy1", "gy2", "gy3", "gy4"]);
        expect(pendingCast.manaCost.X).toBe(0);

        // The user-facing outcome: no picker was ever shown — the cast
        // committed in one shot, same as the single-leg delve path.
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].card.id).toBe(HOGAAK);
        expect(player.graveyard).toHaveLength(0);
        expect(player.exile).toHaveLength(5);
    });
});
