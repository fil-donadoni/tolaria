// debugLoadBladeScenario — read-only browser loader for blade scenarios
// (issue #1432, PRD #1423). The mutation (`convex/game.ts`) resolves a
// client-supplied `label` against the code-side registry and applies the
// resolved entry's `spec` to the CURRENT game's state, all through ONE pure
// function: `resolveBladeLoadState` (`convex/gre/ai/blade/runner.ts`). The
// handler is a thin wrapper around it (`ctx` / `assertIsAdmin` / DB
// fetch+persist only) — see that function's doc comment and the mutation's
// own comment in `convex/game.ts` for the shape.
//
// The project has no `convex-test` harness (see
// `convex/__tests__/debugSetupScenario.test.ts`), so the Convex-runtime
// slice of the handler (the `ctx` calls) genuinely cannot be driven from
// here and is covered by convention instead, not by exercising the mutation
// itself:
//   - the admin gate is asserted against the pure decision `isAdminUser`
//     the mutation's `assertIsAdmin(ctx)` is built from (describe block
//     below);
//   - `getLatestGameState`/`saveGameState` (DB fetch/persist) are exercised
//     nowhere in this file — they're generic plumbing shared by every
//     Convex mutation in `convex/game.ts`, not specific to this one.
//
// EVERYTHING ELSE — the `label` → scenario lookup and the state build — is
// NOT a Convex-runtime concern (`resolveBladeLoadState` takes a plain
// `GameState`, no `ctx`), so it needs no stand-in: this file imports and
// calls the exact function `convex/game.ts` calls. A regression in either
// half (e.g. the lookup always returning `BLADE_SCENARIOS[0]` regardless of
// `label`, or a dropped normalization field) breaks these tests directly,
// not a hand-rolled copy of them. The "mutation body throws on an unknown
// label" block near the bottom exercises that same guard through
// `resolveBladeLoadState` itself, on top of `registry.test.ts`'s coverage of
// `findBladeScenario` in isolation.

import { describe, it, expect } from "vitest";
import { isAdminUser } from "../auth";
import type { Doc } from "../_generated/dataModel";
import type { GameState } from "../gre/state";
import { STARTING_LIFE } from "../gre/setup";
import { makePlayer, makeState } from "../cards/__tests__/setup";
import { getCardByName } from "../cards";
import { BLADE_SCENARIOS, findBladeScenario } from "../gre/ai/blade/registry";
import { buildBladeState, resolveBladeLoadState } from "../gre/ai/blade/runner";

/** Thin alias so the tests below read as "run the mutation's body" — this
 *  IS `resolveBladeLoadState`, the same function `convex/game.ts` imports
 *  and calls; not a copy. */
const runMutationBody = resolveBladeLoadState;

function user(isAdmin?: boolean): Doc<"users"> {
    return {
        _id: "user_1" as Doc<"users">["_id"],
        _creationTime: 0,
        nickname: "Tester",
        isAdmin,
    } as Doc<"users">;
}

describe("debugLoadBladeScenario — admin gate (issue #1432)", () => {
    it("rejects a non-admin caller (assertIsAdmin throws before state is touched)", () => {
        expect(isAdminUser(user(false))).toBe(false);
        expect(isAdminUser(user(undefined))).toBe(false);
    });

    it("rejects an unauthenticated caller", () => {
        expect(isAdminUser(null)).toBe(false);
    });

    it("allows an admin caller through the gate (scenario load proceeds unchanged)", () => {
        expect(isAdminUser(user(true))).toBe(true);
    });
});

describe("debugLoadBladeScenario — label resolution (issue #1432)", () => {
    it("resolves a registered label to its entry, mirroring the mutation's lookup", () => {
        for (const scenario of BLADE_SCENARIOS) {
            expect(findBladeScenario(scenario.label)?.spec).toBe(scenario.spec);
        }
    });

    it("resolves an unknown label to undefined — the mutation throws instead of applying a spec", () => {
        expect(findBladeScenario("no such scenario")).toBeUndefined();
    });
});

/** An arbitrary "current game" base state, deliberately UNLIKE the blade
 *  harness's synthetic base (real-looking player ids, non-default life
 *  totals, a turn already underway, a leftover library, an already-used land
 *  drop, floating mana, and every other turn-/game-scoped field a real match
 *  can accumulate) — so a match against the harness's built state proves the
 *  loader is base-state-independent, not an artifact of both builds starting
 *  from the same substrate. Every divergent field here is deliberate: they
 *  are exactly the fields `buildStateFromScenario` alone leaves untouched
 *  (issue #1432 review finding #1), PLUS the fields review round 2's
 *  finding #2 found still leaking through a hand-picked 4-field list —
 *  `restrictedMana` (CR 500.4/106.6, `manaPool`'s sibling), per-player and
 *  global `spellsCastThisTurn` (Storm, ADR 0052), `poisonCounters`
 *  (CR 122.1 — 10+ is an instant SBA loss, CR 704.5c), `energyCounters`
 *  (ADR 0032), `skipNextTurn` (CR 614.10), `hasDrawnFromEmpty` (CR 704.5b),
 *  `permanentYouControlledLeftThisTurn` (Revolt, CR 702.RV),
 *  `drawnThisTurn`/`lastDrawnCardId`, and `turnsTaken` (CR 500.1), PLUS the
 *  3 fields review round 3 found STILL leaking through round 2's
 *  per-field-authority DENYLIST (`resetPerTurnFields` + `emptyManaPool`):
 *  `extraTurns` (CR 500.7 — a queued extra turn from the live game would
 *  fire after the loaded position's turn; `resetPerTurnFields` never
 *  touches it), `queuedEndTurn` (a standing pass-turn intent that is
 *  deliberately turn-boundary-crossing, so `resetPerTurnFields` never
 *  clears it either), and `islandSanctuaryProtection` set on the
 *  NON-active player (`resetPerTurnFields` only clears it when it equals
 *  `activePlayerId`, which here is p2 — so a protection flag left on p1
 *  survives). `resolveBladeLoadState` must normalize every one of them
 *  away — proven now by a full-state comparison (see `canonicalizeIdentity`
 *  below), not a hand-picked field list, so this base state is deliberately
 *  adversarial rather than an exhaustive checklist. */
function arbitraryCurrentGameBaseState(): GameState {
    return makeState({
        players: [
            makePlayer("user_abc123-p1", {
                life: 17,
                landsPlayedThisTurn: 1,
                manaPool: { W: 0, U: 0, B: 0, R: 3, G: 0, C: 0 },
                restrictedMana: [{ color: "R", amount: 2 }],
                spellsCastThisTurn: 2,
                poisonCounters: 6,
                energyCounters: 4,
                skipNextTurn: true,
                hasDrawnFromEmpty: true,
                permanentYouControlledLeftThisTurn: true,
                drawnThisTurn: ["stale-drawn-card"],
                lastDrawnCardId: "stale-last-drawn",
                turnsTaken: 12,
            }),
            makePlayer("user_abc123-p2", {
                life: 9,
                poisonCounters: 3,
                energyCounters: 1,
                turnsTaken: 11,
            }),
        ],
        turn: 9,
        activePlayerId: "user_abc123-p2",
        priorityPlayerId: "user_abc123-p2",
        phase: "COMBAT_DAMAGE" as GameState["phase"],
        spellsCastThisTurn: 5,
        // Review round 3, finding 1 — a queued extra turn (CR 500.7).
        extraTurns: ["user_abc123-p1"],
        // Review round 3, finding 2 — a standing pass-turn intent.
        queuedEndTurn: ["user_abc123-p2"],
        // Review round 3, finding 3 — protection on the NON-active player
        // (activePlayerId above is p2, so this is deliberately p1).
        islandSanctuaryProtection: "user_abc123-p1",
    });
}

/**
 * Deep-clones `state` with every PLAYER ID replaced by a positional
 * placeholder (`seat-0`/`seat-1`, by index in `state.players`) and each
 * player's `name`/`bgColor` cleared — the only fields `buildBladeLoadState`
 * deliberately carries over from the live game's identity (issue #1432
 * review round 3, allowlist fix: `convex/gre/ai/blade/runner.ts`).
 *
 * Everything else in the two states being compared MUST come out identical
 * once identity is canonicalized this way, because `buildBladeLoadState`
 * no longer normalizes the live game's snapshot field by field — it
 * constructs the starting position via `buildBladeBaseState()` itself (the
 * exact function the harness uses) and copies across ONLY `id`/`name`/
 * `bgColor`. A `toEqual` on the canonicalized output is therefore an
 * ALLOWLIST-shaped assertion, leak-proof against every `GameState` field —
 * present or added later — not just a hand-picked subset. This is the
 * class of gap round 2's per-field DENYLIST (`resetPerTurnFields` +
 * `emptyManaPool`) left open: `extraTurns`, `queuedEndTurn` and
 * `islandSanctuaryProtection` on the non-active player all leaked through
 * that list silently, and the round-2 `positionSnapshot` this replaces
 * didn't even check them, so the leak passed CI.
 *
 * ID values are replaced by exact string match, not substring — safe here
 * because `state.players[].id` values (`p1`/`p2` or `user_…-p1`/`user_…-p2`)
 * never collide with any other string this state carries (card ids, card
 * names, etc.).
 */
function canonicalizeIdentity(state: GameState): GameState {
    const idMap = new Map(state.players.map((p, i) => [p.id, `seat-${i}`]));
    const canonical = JSON.parse(
        JSON.stringify(state, (_key, value) =>
            typeof value === "string" && idMap.has(value)
                ? idMap.get(value)
                : value
        )
    ) as GameState;
    for (const p of canonical.players) {
        p.name = "";
        p.bgColor = "";
    }
    return canonical;
}

describe("debugLoadBladeScenario — loaded position matches the harness's built state (issue #1432)", () => {
    for (const scenario of BLADE_SCENARIOS) {
        it(`"${scenario.label}" — same label through the mutation body, different base state, same resulting position`, () => {
            const harnessState = buildBladeState(scenario);
            const loaderState = runMutationBody(
                arbitraryCurrentGameBaseState(),
                scenario.label
            );

            // Full-state comparison (minus the deliberately-carried-over
            // identity fields) — leak-proof against every `GameState`
            // field, not a hand-picked subset (issue #1432 review round 3).
            expect(canonicalizeIdentity(loaderState)).toEqual(
                canonicalizeIdentity(harnessState)
            );
        });
    }

    it("normalizes active/priority player to the 'me' seat and life to the starting total", () => {
        const scenario = BLADE_SCENARIOS[0];
        const harnessState = buildBladeState(scenario);
        const loaderState = runMutationBody(
            arbitraryCurrentGameBaseState(),
            scenario.label
        );

        expect(loaderState.activePlayerId).toBe(loaderState.players[0].id);
        expect(loaderState.priorityPlayerId).toBe(loaderState.players[0].id);
        expect(loaderState.players[0].life).toBe(STARTING_LIFE);
        expect(loaderState.players[1].life).toBe(STARTING_LIFE);
        expect(loaderState.players[0].landsPlayedThisTurn ?? 0).toBe(0);
        expect(
            Object.values(loaderState.players[0].manaPool).every((v) => v === 0)
        ).toBe(true);
        // issue #1432 review round 2, finding #2 — these leaked through the
        // prior fixup's 4-field list.
        expect(loaderState.players[0].restrictedMana).toBeUndefined();
        expect(loaderState.players[0].spellsCastThisTurn ?? 0).toBe(0);
        expect(loaderState.spellsCastThisTurn).toBeUndefined();
        expect(loaderState.players[0].poisonCounters ?? 0).toBe(0);
        expect(loaderState.players[1].poisonCounters ?? 0).toBe(0);
        expect(loaderState.players[0].energyCounters ?? 0).toBe(0);
        expect(loaderState.players[0].skipNextTurn).toBeUndefined();
        expect(loaderState.players[0].hasDrawnFromEmpty).toBeUndefined();
        expect(
            loaderState.players[0].permanentYouControlledLeftThisTurn
        ).toBeUndefined();
        // NOT undefined: `buildBladeBaseState` itself goes through
        // `createInitialGameState`'s opening-hand `drawCard` calls (7 draws
        // per player, `gre/setup.ts`), which stamps these two as a SIDE
        // EFFECT of dealing the mulligan hand — the harness's own "fresh"
        // state is not empty here, so the loader shouldn't be either. What
        // matters is that it matches the harness's own value, not the live
        // game's stale one (`arbitraryCurrentGameBaseState` seeds
        // `"stale-drawn-card"`/`"stale-last-drawn"` on player 0 above).
        expect(loaderState.players[0].drawnThisTurn).toEqual(
            harnessState.players[0].drawnThisTurn
        );
        expect(loaderState.players[0].lastDrawnCardId).toBe(
            harnessState.players[0].lastDrawnCardId
        );
        expect(loaderState.players[0].turnsTaken).toBe(1);
        expect(loaderState.players[1].turnsTaken).toBeUndefined();
        // issue #1432 review round 3 — these leaked through round 2's
        // per-field-authority DENYLIST (`resetPerTurnFields` never touches
        // `extraTurns`/`queuedEndTurn`, and only clears
        // `islandSanctuaryProtection` when it equals `activePlayerId`, which
        // `arbitraryCurrentGameBaseState` deliberately sets it to NOT).
        expect(loaderState.extraTurns).toBeUndefined();
        expect(loaderState.queuedEndTurn).toBeUndefined();
        expect(loaderState.islandSanctuaryProtection).toBeUndefined();
    });
});

/**
 * GRE → `game.ts` integration coverage for the `setup` step (issue #1487
 * review finding #1).
 *
 * `buildBladeLoadState` now runs `applyBladeSetup` after
 * `buildStateFromScenario` (`convex/gre/ai/blade/runner.ts`), which is what
 * puts the charter entry's ETB trigger on the stack via the REAL engine
 * (`emitPermanentEntered` → `processPendingActionTriggers`) rather than a
 * hand-built `StackItem`. `setup.bot.test.ts` asserts that only for
 * `buildBladeState` — the in-process SUITE path, which builds its seats as
 * `p1`/`p2`. The mutation path differs precisely in seat identity: it
 * overrides both seats with the LIVE game's user ids, and `seatPlayerId`
 * ("me"/"opponent") is index-based, so a suite-path assertion cannot stand in
 * for it. The block below drives the exact function `debugLoadBladeScenario`
 * calls, under seat ids that are deliberately NOT `p1`/`p2`.
 */
describe("debugLoadBladeScenario — a `setup`-carrying entry loads its engine-built stack (issue #1487)", () => {
    const CHARTER_LABEL = "charter: Stifles its own Phyrexian Dreadnought trigger";

    it("loads the charter entry with its ETB trigger on the stack under non-p1/p2 seat ids", () => {
        const base = arbitraryCurrentGameBaseState();
        // Guards the premise of this whole block: if the base state ever
        // reverts to `p1`/`p2`, the identity half of the assertion below
        // becomes vacuous and the suite-path test WOULD stand in for it.
        expect(base.players.map((p) => p.id)).toEqual([
            "user_abc123-p1",
            "user_abc123-p2",
        ]);
        expect(findBladeScenario(CHARTER_LABEL)?.setup).toBeDefined();

        const loaded = runMutationBody(base, CHARTER_LABEL);

        // The `setup` step ran on the MUTATION path, not just the suite path.
        expect(loaded.stack).toHaveLength(1);
        expect(loaded.stack[0].triggeredAbilityId).toBe(
            "phyrexian-dreadnought-etb-sacrifice"
        );
        // …and the engine-produced stack item belongs to the LIVE game's seat,
        // not the harness's discarded `p1`. This is the half `buildBladeState`
        // cannot prove, because it never builds any seat but `p1`/`p2`.
        expect(loaded.stack[0].controllerId).toBe("user_abc123-p1");
        expect(loaded.stack[0].ownerId).toBe("user_abc123-p1");
        // (`card` is already slim here — `{ id }` only, as it is on the wire —
        // so cards are identified by definition id, not by name.)
        const dreadnought = loaded.players[0].battlefield.find(
            (c) => c.card.id === getCardByName("Phyrexian Dreadnought").id
        );
        expect(dreadnought).toBeDefined();
        expect(loaded.stack[0].triggerSourceId).toBe(dreadnought!.id);
        // The answer is castable in response — the position is the one the
        // blade entry's `expect` was written against, not merely a board with
        // a trigger parked on it.
        expect(
            loaded.players[0].hand.some(
                (c) => c.card.id === getCardByName("Stifle").id
            )
        ).toBe(true);
        expect(loaded.players[0].battlefield.some((c) => !c.isTapped)).toBe(
            true
        );
    });
});

describe("debugLoadBladeScenario — mutation body throws on an unknown label (issue #1432)", () => {
    it("mirrors the mutation's own guard, not just the pure findBladeScenario lookup", () => {
        expect(() =>
            runMutationBody(arbitraryCurrentGameBaseState(), "no such scenario")
        ).toThrow("Unknown blade scenario: no such scenario");
    });
});
