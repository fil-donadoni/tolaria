// Overload capability tests (CR 702.96, issue #3215). Built once here and
// reused by every future overload card, mirroring `dash.test.ts` / `evoke.test.ts`
// in structure and scope — but unlike those, this keyword HAS shipped cards, so
// the two real ones (Damn, mh2; Winds of Abandon, mh1) drive the whole path
// instead of a synthetic probe. Covers every surface the mechanic crosses:
//
//   - `def.overload` resolves through the SAME `getAlternativeCost` /
//     `affordableAlternativeCosts` authority as evoke/dash/bestow
//     (`convex/gre/alternativeCost.ts`)
//   - CR 702.96b's "won't require any targets" —
//     `castAdjustedTargetRequirement` (`convex/game.ts`, exported for this)
//   - the real cast-commit seam tags the stack item `overloaded: true` AND
//     pays the OVERLOAD mana, driven over a manually-parked `pendingCast`
//     (this project has no convex-test harness for game.ts mutations, ADR 0001)
//   - the text change itself (CR 702.96a): the same script resolving against
//     one announced target, then against every matching object
//   - CR 702.96b's second sentence — an overloaded spell reaches objects that
//     could NOT have been targeted (hexproof), asserted against the very
//     `getLegalTargets` call that refuses to offer them
//   - CR 608.2b — an overloaded spell has no targets and so cannot fizzle
//   - serialization round-trip and the wire projection of `overloaded`
//   - the authoring guard: an overload card reaching a `{ target: n }` slot
//
// The two seams that read `gre/moves.ts` — cost modifiers folded into the
// OVERLOAD cost, and the Bot seeing both cast modes — live in the sibling
// `overloadMoves.bot.test.ts`, because importing the enumerator puts a file in
// the bot suite (`bot-suite-boundary.test.ts`).

import { describe, it, expect } from "vitest";
import {
    resolveTopOfStack,
    type GameState,
    type StackItem,
    type CardInstanceState,
} from "../state";
import {
    getAlternativeCost,
    affordableAlternativeCosts,
} from "../alternativeCost";
import { getLegalTargets, targetingSourceFromCard } from "../rules";
import {
    overloadAffectedTargets,
    isOverloadAlternativeCost,
} from "../overload";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { compactState, expandState } from "../serialize";
import { validateEffectScript } from "../effects/validate";
import {
    tryAutoCommitPendingCast,
    castAdjustedTargetRequirement,
} from "../../game";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { getCardByName, registerTokenDefinition } from "../../cards";

const DAMN = getCardByName("Damn");
const WINDS = getCardByName("Winds of Abandon");
const BEAR = getCardByName("Grizzly Bears").id;
const PLAINS = getCardByName("Plains").id;
/** A creature with hexproof, built as a registered probe so the test does not
 *  depend on which hexproof BODY happens to be in the catalogue — only on the
 *  keyword, which `isGuardedAgainst` reads off `staticAbilities`. */
const HEXPROOF_PROBE_ID = "test:overload-hexproof-probe";
registerTokenDefinition({
    id: HEXPROOF_PROBE_ID,
    rarity: "common",
    name: "Overload Hexproof Probe",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Elf"],
    power: 2,
    toughness: 2,
    staticAbilities: ["hexproof"],
});

function handCard(cardId: string, id: string, controllerId = "p1") {
    return makeInstance(cardId, {
        id,
        controllerId,
        ownerId: controllerId,
        zone: "hand",
    });
}

function creature(cardId: string, id: string, controllerId: string) {
    return makeInstance(cardId, { id, controllerId, ownerId: controllerId });
}

/** Damn on the stack, cast by p1 — overloaded or with one announced target. */
function damnOnStack(
    state: GameState,
    opts: { overloaded: true } | { targetId: string }
): StackItem {
    const item: StackItem = {
        ...handCard(DAMN.id, "damn"),
        zone: "stack",
        castById: "p1",
        ...("overloaded" in opts
            ? { overloaded: true as const }
            : { targets: [{ type: "permanent" as const, id: opts.targetId }] }),
    };
    state.stack.push(item);
    return item;
}

const boardIds = (state: GameState, seat: 0 | 1) =>
    state.players[seat].battlefield.map((c) => c.id).sort();

// ---------------------------------------------------------------------------

describe("Overload — cost lookup (CR 702.96a, convex/gre/alternativeCost.ts)", () => {
    it("getAlternativeCost resolves def.overload by its own id (reference equality)", () => {
        expect(getAlternativeCost(DAMN, "overload")).toBe(DAMN.overload);
        expect(isOverloadAlternativeCost(DAMN, DAMN.overload)).toBe(true);
    });

    it("a DIFFERENT card's alternative cost with the same id is not an overload cast", () => {
        // Reference equality, not id equality: the marker decides whether the
        // spell's text changes, so an id collision must not be able to trip it.
        expect(isOverloadAlternativeCost(DAMN, WINDS.overload)).toBe(false);
    });

    it("affordableAlternativeCosts offers the overload variant (its mana leg is the cast-legality gate's job, not the picker's)", () => {
        const damnInst = handCard(DAMN.id, "damn");
        const state = makeState({
            players: [makePlayer("p1", { hand: [damnInst] }), makePlayer("p2")],
        });
        const alts = affordableAlternativeCosts(
            state,
            state.players[0],
            damnInst
        );
        expect(alts.map((a) => a.id)).toContain("overload");
    });
});

describe("Overload — an overloaded cast announces NO targets (CR 702.96b)", () => {
    it("castAdjustedTargetRequirement returns undefined for an overload cast, and the printed requirement otherwise", () => {
        expect(
            castAdjustedTargetRequirement(DAMN, undefined, false, false, true)
        ).toBeUndefined();
        expect(
            castAdjustedTargetRequirement(DAMN, undefined, false, false, false)
        ).toEqual(DAMN.targetRequirement);
    });
});

describe("Overload — the cast commit pays the overload cost and stamps the marker (CR 601.2h / 702.96a)", () => {
    function parkedOverloadCast(): GameState {
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [handCard(DAMN.id, "damn")] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        // The overload cost is {2}{W}{W}: four white covers the two pips and
        // the two generic.
        state.players[0].manaPool.W = 4;
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "damn",
            manaCost: { X: 2, W: 2 },
            tappedLandIds: [],
            overloaded: true,
        };
        return state;
    }

    it("commits: pays {2}{W}{W} from the pool and stacks Damn tagged overloaded, with no targets", () => {
        const state = parkedOverloadCast();
        expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
        expect(state.players[0].manaPool.W).toBe(0);
        const item = state.stack.find((s) => s.id === "damn") as StackItem;
        expect(item).toBeDefined();
        expect(item.overloaded).toBe(true);
        // CR 702.96b — no targets were announced, so none are recorded.
        expect(item.targets ?? []).toEqual([]);
    });

    it("does NOT commit while the overload mana is still uncovered", () => {
        const state = parkedOverloadCast();
        state.players[0].manaPool.W = 3;
        expect(tryAutoCommitPendingCast(state, "p1")).toBeNull();
        expect(state.pendingCast).toBeDefined();
    });
});

describe("Damn — one script, two modes (CR 702.96a text change)", () => {
    function boardWithFourCreatures(): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        creature(BEAR, "mine1", "p1"),
                        creature(BEAR, "mine2", "p1"),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        creature(BEAR, "theirs1", "p2"),
                        creature(BEAR, "theirs2", "p2"),
                    ],
                }),
            ],
        });
    }

    it("printed mode: destroys ONLY the announced target", () => {
        const state = boardWithFourCreatures();
        damnOnStack(state, { targetId: "theirs1" });
        resolveTopOfStack(state);
        expect(boardIds(state, 0)).toEqual(["mine1", "mine2"]);
        expect(boardIds(state, 1)).toEqual(["theirs2"]);
    });

    it("overloaded: destroys EVERY creature, the caster's own included (CR 702.96a — 'target' becomes 'each')", () => {
        const state = boardWithFourCreatures();
        damnOnStack(state, { overloaded: true });
        resolveTopOfStack(state);
        expect(boardIds(state, 0)).toEqual([]);
        expect(boardIds(state, 1)).toEqual([]);
    });

    it("overloaded: reaches a HEXPROOF creature that could never have been its target (CR 702.96b)", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [
                        creature(HEXPROOF_PROBE_ID, "safe", "p2"),
                        creature(BEAR, "plain", "p2"),
                    ],
                }),
            ],
        });
        const item = damnOnStack(state, { overloaded: true });
        // The very same requirement, asked the ordinary way, refuses to offer
        // that creature — this is the contrast CR 702.96b draws, and asserting
        // it here is what makes the sweep below a rule rather than a
        // coincidence of the board (hexproof, CR 702.11b).
        const offered = getLegalTargets(
            state,
            DAMN.targetRequirement!,
            targetingSourceFromCard(item, true),
            "p1"
        ).map((t) => t.id);
        expect(offered).toEqual(["plain"]);
        expect(
            overloadAffectedTargets(state, item, "p1")
                .map((t) => t.id)
                .sort()
        ).toEqual(["plain", "safe"]);

        resolveTopOfStack(state);
        expect(boardIds(state, 1)).toEqual([]);
    });

    it("overloaded: a regeneration shield does not save a creature (CR 701.19c — 'can't be regenerated')", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [creature(BEAR, "shielded", "p2")],
                }),
            ],
        });
        state.players[1].battlefield[0].regenerationShields = 1;
        damnOnStack(state, { overloaded: true });
        resolveTopOfStack(state);
        expect(boardIds(state, 1)).toEqual([]);
    });

    it("overloaded into an EMPTY board resolves without fizzling (CR 608.2b — it has no targets to be illegal)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        damnOnStack(state, { overloaded: true });
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        // CR 608.2m — it finished resolving and went to its owner's graveyard,
        // rather than being countered by the game rules.
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("damn");
    });
});

describe("Winds of Abandon — one script, two modes (CR 702.96a/b)", () => {
    function windsOnStack(
        state: GameState,
        opts: { overloaded: true } | { targetId: string }
    ): StackItem {
        const item: StackItem = {
            ...handCard(WINDS.id, "winds"),
            zone: "stack",
            castById: "p1",
            ...("overloaded" in opts
                ? { overloaded: true as const }
                : {
                      targets: [
                          { type: "permanent" as const, id: opts.targetId },
                      ],
                  }),
        };
        state.stack.push(item);
        return item;
    }

    /** p1 casts; p2 has `n` creatures and `n` basic lands in library. */
    function windsBoard(n: number): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [creature(BEAR, "mine", "p1")],
                }),
                makePlayer("p2", {
                    battlefield: Array.from({ length: n }, (_, i) =>
                        creature(BEAR, `theirs${i}`, "p2")
                    ),
                    library: Array.from({ length: n }, (_, i) =>
                        makeInstance(PLAINS, {
                            id: `lib${i}`,
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "library",
                        })
                    ),
                }),
            ],
        });
    }

    /** Answers every queued search-library prompt with its first candidate. */
    function answerSearches(state: GameState, picks: string[]): void {
        for (const pick of picks) {
            const head = state.pendingChoices?.[0];
            expect(head).toBeDefined();
            applyPendingChoiceSubmit(state, {
                playerId: head!.playerId,
                stackItemId: head!.stackItemId,
                step: head!.step,
                choiceId: head!.choiceId,
                cardInstanceIds: [pick],
            });
        }
    }

    it("printed mode: exiles the one target and its controller searches ONCE", () => {
        const state = windsBoard(2);
        windsOnStack(state, { targetId: "theirs0" });
        resolveTopOfStack(state);
        answerSearches(state, ["lib0"]);
        expect(boardIds(state, 1)).toEqual(["lib0", "theirs1"]);
        expect(state.players[1].exile.map((c) => c.id)).toEqual(["theirs0"]);
        // The fetched land arrives onto the battlefield tapped.
        expect(
            state.players[1].battlefield.find((c) => c.id === "lib0")!.isTapped
        ).toBe(true);
        // Only ONE search happened, so only one land left the library.
        expect(state.players[1].library).toHaveLength(1);
    });

    it("overloaded: exiles every creature the caster does NOT control and searches once PER creature", () => {
        const state = windsBoard(3);
        windsOnStack(state, { overloaded: true });
        resolveTopOfStack(state);
        answerSearches(state, ["lib0", "lib1", "lib2"]);
        // "creature you don't control" is an INTRINSIC filter and survives the
        // rewrite — the caster's own creature is untouched (CR 702.96a changes
        // "target", not the restriction on what may be chosen).
        expect(boardIds(state, 0)).toEqual(["mine"]);
        expect(state.players[1].exile.map((c) => c.id).sort()).toEqual([
            "theirs0",
            "theirs1",
            "theirs2",
        ]);
        // Three creatures exiled → three basic lands, the "for each creature
        // exiled this way" fan-out.
        expect(boardIds(state, 1)).toEqual(["lib0", "lib1", "lib2"]);
    });
});

describe("Overload — the marker survives the wire and the database (issue #3215)", () => {
    function stateWithOverloadedDamn(): GameState {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        damnOnStack(state, { overloaded: true });
        return state;
    }

    it("compact/expand round-trips `overloaded` (PERSISTED_OPTIONAL_KEYS)", () => {
        const restored = expandState(compactState(stateWithOverloadedDamn()));
        expect(restored.stack[0].overloaded).toBe(true);
    });

    it("projectPublicState carries `overloaded` on the stack item", () => {
        const state = stateWithOverloadedDamn();
        const projected = projectPublicState(state, 1, "p1");
        const item = projected.stack.find(
            (s: CardInstanceState) => s.id === "damn"
        );
        expect(item?.overloaded).toBe(true);
    });
});

describe("Overload — authoring guard (validateEffectScript)", () => {
    it("refuses an overload card that reaches its objects through a { target: n } slot", () => {
        const errors = validateEffectScript({
            id: "test:bad-overload",
            name: "Bad Overload",
            types: ["Sorcery"],
            overload: {
                id: "overload",
                description: "Overload {2}{W}{W}",
                mana: { X: 2, W: 2 },
            },
            effects: [{ op: "destroy", target: { target: 0 } }],
        });
        expect(errors.join("\n")).toMatch(/declares overload \(CR 702\.96\)/);
    });

    it("accepts the shipped shape — the guard above is not vacuous", () => {
        expect(validateEffectScript(DAMN)).toEqual([]);
        expect(validateEffectScript(WINDS)).toEqual([]);
    });
});
