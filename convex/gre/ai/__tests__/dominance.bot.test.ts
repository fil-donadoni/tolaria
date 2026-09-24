// Dominance pruning (issue #1887) — the "provably dominated by `pass`" seam.
//
// Every assertion here is a DOMINANCE PROOF, not a heuristic score: the seam
// applies the move on a clone, resolves it to completion and requires exact
// equality with the untouched baseline in every term but the mover's own cost.
// So each case is stated twice — the futile position (pruned) and its NEGATIVE
// CONTROL, the same card in a position where it does something (never pruned).

import { describe, expect, it } from "vitest";
import type { GameState } from "../../state";
import type { Move } from "../../moves";
import { enumerateMoves } from "../../moves";
import { buildBladeState } from "../blade/runner";
import type { BladeScenario } from "../blade/types";
import {
    isDominatedNoOpMove,
    deepEqual,
    dominanceProbeStats,
    resetDominanceProbeStats,
    applyProbeCast,
} from "../dominance";
import { getCardByName, tryGetDefinition } from "../../../cards";
import { searchWithTrace } from "../../search";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";

/** Build a position from a bare `ScenarioSpec`, reusing the blade harness so
 *  these tests and the blade registry entries describe boards the same way. */
function build(
    spec: BladeScenario["spec"],
    setup?: BladeScenario["setup"]
): GameState {
    return buildBladeState({
        label: "dominance-unit",
        spec,
        ...(setup ? { setup } : {}),
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [{ kind: "pass" }] },
    });
}

function me(state: GameState): string {
    return state.players[0].id;
}

function castsOf(state: GameState, name: string, pruned: boolean): Move[] {
    return enumerateMoves(
        state,
        me(state),
        pruned ? { pruneDominatedNoOps: true } : undefined
    ).filter(
        (m) =>
            m.kind === "cast-spell" &&
            cardName(state, m.cardInstanceId) === name
    );
}

/** Instance id → card NAME. Production instances carry `card: { id }` only, so
 *  the name comes from the registry, never from the instance. */
function cardName(state: GameState, instanceId: string): string | undefined {
    for (const p of state.players) {
        for (const zone of [p.hand, p.battlefield, p.graveyard]) {
            const found = zone.find((c) => c.id === instanceId);
            if (found) {
                return tryGetDefinition(
                    (found.card as { id?: string }).id ?? ""
                )?.name;
            }
        }
    }
    return undefined;
}

// ---------------------------------------------------------------------------

describe("isDominatedNoOpMove — sweepers (CR 608.2, issue #1887)", () => {
    it("proves Damnation on a creature-free board is dominated by pass", () => {
        const state = build({
            cards: [{ name: "Damnation", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        const casts = castsOf(state, "Damnation", false);
        expect(casts.length).toBeGreaterThan(0);
        for (const move of casts) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(true);
        }
    });

    it("NEGATIVE CONTROL: Damnation with creatures out is never dominated", () => {
        const state = build({
            cards: [
                { name: "Damnation", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        const casts = castsOf(state, "Damnation", false);
        expect(casts.length).toBeGreaterThan(0);
        for (const move of casts) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(false);
        }
    });

    it("drops the futile Damnation from the pruned enumeration, keeps pass", () => {
        const state = build({
            cards: [{ name: "Damnation", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        const pruned = enumerateMoves(state, me(state), {
            pruneDominatedNoOps: true,
        });
        expect(castsOf(state, "Damnation", true)).toHaveLength(0);
        expect(pruned.some((m) => m.kind === "pass")).toBe(true);
        expect(pruned.length).toBeGreaterThan(0);
    });

    it("keeps the useful Damnation in the pruned enumeration", () => {
        const state = build({
            cards: [
                { name: "Damnation", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        expect(castsOf(state, "Damnation", true).length).toBeGreaterThan(0);
    });
});

describe("isDominatedNoOpMove — edicts (CR 700.2 modal, issue #1887)", () => {
    it("proves every Sheoldred's Edict mode is a no-op against an empty board", () => {
        const state = build({
            cards: [{ name: "Sheoldred's Edict", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        const casts = castsOf(state, "Sheoldred's Edict", false);
        expect(casts.length).toBeGreaterThan(0);
        for (const move of casts) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(true);
        }
        expect(castsOf(state, "Sheoldred's Edict", true)).toHaveLength(0);
    });

    it("NEGATIVE CONTROL: keeps the Edict when the opponent has a creature", () => {
        const state = build({
            cards: [
                { name: "Sheoldred's Edict", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        expect(
            castsOf(state, "Sheoldred's Edict", true).length
        ).toBeGreaterThan(0);
    });
});

describe("isDominatedNoOpMove — activated abilities (CR 602.2, issue #1887)", () => {
    const salvagerSpec: BladeScenario["spec"] = {
        cards: [
            {
                name: "Sandstorm Salvager",
                owner: "me",
                zone: "battlefield",
                summoningSick: false,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 4,
        libraryCount: 20,
    };

    function activationsOf(state: GameState, pruned: boolean): Move[] {
        return enumerateMoves(
            state,
            me(state),
            pruned ? { pruneDominatedNoOps: true } : undefined
        ).filter(
            (m) =>
                m.kind === "activate-ability" &&
                m.abilityId === "sandstorm-salvager-token-buff"
        );
    }

    it("proves the Salvager's token buff is a no-op with no tokens out", () => {
        const state = build(salvagerSpec);
        const activations = activationsOf(state, false);
        expect(activations.length).toBeGreaterThan(0);
        for (const move of activations) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(true);
        }
        expect(activationsOf(state, true)).toHaveLength(0);
    });

    it("NEGATIVE CONTROL: keeps the buff once a Golem token is on the board", () => {
        // The token arrives through the card's OWN ETB trigger, resolved by the
        // real engine — no hand-seeded token (ADR 0070 §4).
        const state = build(salvagerSpec, [
            { kind: "etb-trigger", card: "Sandstorm Salvager" },
            { kind: "resolve-top" },
        ]);
        expect(state.players[0].battlefield.some((c) => c.isToken)).toBe(true);
        const activations = activationsOf(state, false);
        expect(activations.length).toBeGreaterThan(0);
        for (const move of activations) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(false);
        }
        expect(activationsOf(state, true).length).toBeGreaterThan(0);
    });
});

describe("isDominatedNoOpMove — reanimation into a creature-less graveyard (issue #2490)", () => {
    // Shallow Grave's `moveZone` positional scan finds no creature to return,
    // so `$revived` never binds — before the fix, the `delayedTrigger` Op
    // scheduled "exile it" anyway, leaving an inert `delayedTriggers[]` entry
    // as the ONLY difference from `pass` (the moveZone/grantAbility/exile
    // that touch board state all no-op on their own, CR 608.2b). That residue
    // used to defeat this exact proof.
    it("proves Shallow Grave into a creature-less graveyard is dominated by pass", () => {
        const state = build({
            cards: [{ name: "Shallow Grave", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        });
        const casts = castsOf(state, "Shallow Grave", false);
        expect(casts.length).toBeGreaterThan(0);
        for (const move of casts) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(true);
        }
        expect(castsOf(state, "Shallow Grave", true)).toHaveLength(0);
    });

    // NEGATIVE CONTROL against the OTHER wrong fix (blanket-ignoring
    // `delayedTriggers` in `IGNORED_STATE_KEYS` — do not do this, see
    // dominance.ts's own comment on that list): Battle Cry cast with no white
    // creature on the caster's battlefield. "Untap all white creatures you
    // control" iterates an empty set (no board diff at all), so the ENTIRE
    // observable delta from `pass` is the scheduled "this-turn-creature-blocks"
    // delayed trigger itself (no `capture`, so this fix's own guard cannot
    // touch it either) — a real, armed effect, not residue. A blanket ignore
    // of `delayedTriggers` would make this scenario indistinguishable from
    // `pass` and wrongly prune it; comparing the field (the actual fix)
    // keeps it.
    it("NEGATIVE CONTROL: Battle Cry with no white creatures out still arms its delayed trigger — never dominated", () => {
        const state = build({
            cards: [{ name: "Battle Cry", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        });
        const myBattlefield = state.players.find(
            (p) => p.id === me(state)
        )!.battlefield;
        expect(
            myBattlefield.some((c) => {
                const def = tryGetDefinition(
                    (c.card as { id?: string }).id ?? ""
                );
                return def?.types.includes("Creature") ?? false;
            })
        ).toBe(false);
        const casts = castsOf(state, "Battle Cry", false);
        expect(casts.length).toBeGreaterThan(0);
        for (const move of casts) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(false);
        }
        expect(castsOf(state, "Battle Cry", true).length).toBeGreaterThan(0);
    });

    // The MASS shape of the same class (issue #2715, PRD #2693). Shallow Grave
    // above is a positional single-card scan; Replenish is a `forEach` over the
    // whole graveyard resolved `simultaneous`, so its no-op path is an EMPTY
    // ITERATION (CR 608.2c — the instructions are followed as written, and an
    // instruction over an empty set does nothing) rather than an unbound
    // `$revived` — a different
    // interpreter route to the same "nothing observable changed" verdict, and
    // the payoff card of a whole Premodern Tier 1 list.
    it("proves Replenish into an enchantment-less graveyard is dominated by pass", () => {
        const state = build({
            cards: [
                { name: "Replenish", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        });
        const casts = castsOf(state, "Replenish", false);
        expect(casts.length).toBeGreaterThan(0);
        for (const move of casts) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(true);
        }
        expect(castsOf(state, "Replenish", true)).toHaveLength(0);
    });

    it("NEGATIVE CONTROL: Replenish with three enchantments in the graveyard is never dominated", () => {
        const state = build({
            cards: [
                { name: "Replenish", owner: "me", zone: "hand" },
                { name: "Opalescence", owner: "me", zone: "graveyard" },
                { name: "Parallax Wave", owner: "me", zone: "graveyard" },
                { name: "Seal of Cleansing", owner: "me", zone: "graveyard" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        });
        const casts = castsOf(state, "Replenish", false);
        expect(casts.length).toBeGreaterThan(0);
        for (const move of casts) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(false);
        }
        expect(castsOf(state, "Replenish", true).length).toBeGreaterThan(0);
    });

    it("NEGATIVE CONTROL: Shallow Grave with a creature in the graveyard is never dominated — the cast IS chosen", () => {
        const state = build({
            cards: [
                { name: "Shallow Grave", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "graveyard",
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        });
        const casts = castsOf(state, "Shallow Grave", false);
        expect(casts.length).toBeGreaterThan(0);
        for (const move of casts) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(false);
        }
        expect(castsOf(state, "Shallow Grave", true).length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Review finding 1 (issue #1905): the mover's MANA POOL is a delta, not a cost.
// ---------------------------------------------------------------------------

describe("rituals are never dominated — the pool is a delta (issue #1905)", () => {
    // A position that CANNOT pass by accident: the same hand also holds a
    // genuine no-op (Damnation on a creature-free board). If the pool ever goes
    // back on the mover's ignore list the ritual is pruned while Damnation
    // stays pruned, so the `dominated` assertion below is the discriminator —
    // "nothing here is prunable" would fail the Damnation half instead.
    const spec = (ritual: string): BladeScenario["spec"] => ({
        cards: [
            { name: ritual, owner: "me", zone: "hand" },
            { name: "Damnation", owner: "me", zone: "hand" },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 8,
        libraryCount: 20,
    });

    for (const ritual of ["Dark Ritual", "Cabal Ritual"]) {
        it(`${ritual} adds mana, so it is never proved dominated by pass`, () => {
            const state = build(spec(ritual));
            const casts = castsOf(state, ritual, false);
            expect(casts.length).toBeGreaterThan(0);
            for (const move of casts) {
                expect(isDominatedNoOpMove(state, me(state), move)).toBe(false);
            }
            // …and it SURVIVES the pruned enumeration the bot paths use.
            expect(castsOf(state, ritual, true).length).toBeGreaterThan(0);
        });

        it(`${ritual} shares its position with a genuine no-op that IS pruned`, () => {
            // The discriminator: the same board, the same enumeration, one
            // move dropped and one kept. A pruner that kept everything (or
            // dropped everything) fails one half or the other.
            const state = build(spec(ritual));
            expect(castsOf(state, "Damnation", true)).toHaveLength(0);
            expect(castsOf(state, ritual, true).length).toBeGreaterThan(0);
        });
    }

    it("Cabal Ritual is kept on BOTH sides of its threshold branch", () => {
        // The `if` predicate picks {B}{B}{B}{B}{B} at seven cards in the
        // graveyard and {B}{B}{B} below it — both are mana, both are deltas.
        const state = build({
            cards: [
                { name: "Cabal Ritual", owner: "me", zone: "hand" },
                ...Array.from({ length: 7 }, () => ({
                    name: "Dark Ritual",
                    owner: "me" as const,
                    zone: "graveyard" as const,
                })),
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 8,
            libraryCount: 20,
        });
        expect(state.players[0].graveyard.length).toBeGreaterThanOrEqual(7);
        expect(castsOf(state, "Cabal Ritual", true).length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Re-review (issue #1905): an ADDITIONAL COST the probe never pays.
// ---------------------------------------------------------------------------

describe("additional-cost spells are never probed (CR 118.3, issue #1905)", () => {
    // Same bug class as the rituals above, reached through a cost instead of a
    // resolution: `applyProbeCast` pays no additional cost, so the sacrificed
    // creature is never snapshotted on the stack item,
    // `getAdditionalSacrificeMv()` returns `undefined`, the `resolve` early-
    // returns and the probe sees a zero pool delta — a ritual "proved"
    // dominated. `isProbeEligibleMove` must refuse the probe outright.
    // Sheoldred's Edict rides along in the SAME hand as the discriminator: on
    // this board (opponent has no permanent and no card in hand) every one of
    // its modes is a genuine no-op and MUST still be dropped. A pruner that
    // simply kept everything fails that half; a pruner that dropped everything
    // fails the ritual half.
    const spec = (ritual: string): BladeScenario["spec"] => ({
        cards: [
            { name: ritual, owner: "me", zone: "hand" },
            { name: "Sheoldred's Edict", owner: "me", zone: "hand" },
            // Fuel for the additional cost — without a creature to sacrifice
            // the cast is not even enumerated.
            {
                name: "Grizzly Bears",
                owner: "me",
                zone: "battlefield",
                summoningSick: false,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 8,
        libraryCount: 20,
    });

    for (const ritual of ["Sacrifice", "Burnt Offering"]) {
        it(`${ritual} pays its value as a COST, so it survives the pruned enumeration`, () => {
            const state = build(spec(ritual));
            const casts = castsOf(state, ritual, false);
            expect(casts.length).toBeGreaterThan(0);
            for (const move of casts) {
                expect(isDominatedNoOpMove(state, me(state), move)).toBe(false);
            }
            expect(castsOf(state, ritual, true).length).toBe(casts.length);
            // The discriminator: the same enumeration still drops a real no-op.
            expect(castsOf(state, "Sheoldred's Edict", true)).toHaveLength(0);
        });
    }
});

// ---------------------------------------------------------------------------
// Review finding 2 (issue #1905): the all-branches choice/mode quantifier.
// ---------------------------------------------------------------------------

describe("mid-resolution choice quantifier (CR 601.2b, issue #1905)", () => {
    // Searing Rays ({2}{R} sorcery) suspends MID-RESOLUTION on an `optionChoice`
    // ("choose a color"), unlike Sheoldred's Edict whose modes are picked at
    // CAST time and enumerated as separate `chosenModeId` moves. Each mode then
    // deals damage equal to a creature count — so the position decides whether
    // the branch is a no-op, which is exactly what the quantifier is for.
    const spec = (opponentCreature?: string): BladeScenario["spec"] => ({
        cards: [
            { name: "Searing Rays", owner: "me", zone: "hand" },
            ...(opponentCreature
                ? [
                      {
                          name: opponentCreature,
                          owner: "opp" as const,
                          zone: "battlefield" as const,
                          summoningSick: false,
                      },
                  ]
                : []),
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 6,
        libraryCount: 20,
    });

    it("ALL branches no-op → pruned, and the branches were really opened", () => {
        const state = build(spec());
        const casts = castsOf(state, "Searing Rays", false);
        expect(casts.length).toBeGreaterThan(0);
        resetDominanceProbeStats();
        for (const move of casts) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(true);
        }
        // Without this the test could not tell "every colour proved a no-op"
        // from "the probe never reached the choice at all" — the exact hole the
        // review flagged. Five colours per probe.
        const opened = dominanceProbeStats().choiceBranches;
        expect(opened).toBeGreaterThanOrEqual(5 * casts.length);
        expect(castsOf(state, "Searing Rays", true)).toHaveLength(0);
    });

    it("ONE useful branch → kept (a single green creature is enough)", () => {
        // Grizzly Bears is green: the Green branch deals 1 to its controller,
        // the other four branches are still no-ops. One counterexample must
        // defeat the universal quantifier.
        const state = build(spec("Grizzly Bears"));
        const casts = castsOf(state, "Searing Rays", false);
        expect(casts.length).toBeGreaterThan(0);
        resetDominanceProbeStats();
        for (const move of casts) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(false);
        }
        expect(dominanceProbeStats().choiceBranches).toBeGreaterThan(0);
        expect(castsOf(state, "Searing Rays", true).length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Review finding 3 (issue #1905): the probe must not scale with the search.
// ---------------------------------------------------------------------------

describe("probe cost is O(root moves), not O(iterations) (issue #1905)", () => {
    const spec: BladeScenario["spec"] = {
        cards: [
            { name: "Damnation", owner: "me", zone: "hand" },
            { name: "Dark Ritual", owner: "me", zone: "hand" },
            { name: "Lightning Bolt", owner: "me", zone: "hand" },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 8,
        landCount: 8,
        libraryCount: 30,
    };

    it("a longer search runs exactly as many probes as a short one", () => {
        // The regression this pins: probing inside `keyedMovesFor` ran at every
        // tree node of every iteration — 1682 probed enumerations for a
        // 300-iteration search, 42.6% of its wall clock. Since the budget is
        // ITERATION-based that is a straight ~1.75× think-time regression, and
        // a wall-clock assertion would be too flaky to pin it. The probe COUNT
        // is deterministic, so assert on that: it is a function of the root
        // move list alone.
        const state = build(spec);
        const pid = me(state);

        resetDominanceProbeStats();
        searchWithTrace(state, pid, { iterations: 40 }, 7);
        const short = dominanceProbeStats().probes;

        resetDominanceProbeStats();
        searchWithTrace(state, pid, { iterations: 400 }, 7);
        const long = dominanceProbeStats().probes;

        expect(short).toBeGreaterThan(0);
        expect(long).toBe(short);
        // …and one root enumeration's worth, nothing more.
        resetDominanceProbeStats();
        enumerateMoves(state, pid, { pruneDominatedNoOps: true });
        expect(short).toBe(dominanceProbeStats().probes);
    }, 60000);

    // The scenario above has NO choice node, so it can only ever see the
    // CAST-level probe. `isNoOpChoiceAnswer` (issue #1888) shares
    // `stats.probes` but is reached from `dslChoicePrior`, which runs at every
    // in-tree choice-node visit of every iteration — it went back to
    // O(iterations) (42 probes @ 40 vs 401 @ 400) while this describe stayed
    // green, which is exactly why the invariant needs a choice-node scenario to
    // be pinned at all (PR #1914 review finding 1).
    it("…including at a live CHOICE node, which the priors visit every iteration", () => {
        // Chrome Mox's imprint trigger resolved: "you MAY exile a nonartifact,
        // nonland card from your hand" (CR 608.2b) — a live `choose-hand-card`
        // node at the ROOT, so every iteration descends through it and scores
        // its candidates' priors.
        const state = buildBladeState({
            label: "dominance-unit-imprint",
            spec: {
                cards: [
                    { name: "Chrome Mox", owner: "me", zone: "battlefield" },
                    { name: "Lightning Bolt", owner: "me", zone: "hand" },
                    { name: "Dark Ritual", owner: "me", zone: "hand" },
                    {
                        name: "Mountain",
                        owner: "me",
                        zone: "battlefield",
                        count: 2,
                    },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 3,
                libraryCount: 20,
            },
            setup: [
                { kind: "etb-trigger", card: "Chrome Mox" },
                { kind: "resolve-top" },
            ],
            bot: "me",
            budget: { iterations: 1 },
            tier: "must",
            expect: { moves: [{ kind: "pass" }] },
        });
        const pid = me(state);
        // Guard the guard: without a live choice node this test would be the
        // same blind spot it exists to close.
        expect(state.pendingChoices?.[0]?.kind).toBe("choose-hand-card");
        expect(state.pendingChoices?.[0]?.playerId).toBe(pid);

        resetDominanceProbeStats();
        searchWithTrace(state, pid, { iterations: 40 }, 7);
        const short = dominanceProbeStats().probes;

        resetDominanceProbeStats();
        searchWithTrace(state, pid, { iterations: 400 }, 7);
        const long = dominanceProbeStats().probes;

        expect(short).toBeGreaterThan(0);
        expect(long).toBe(short);
    }, 60000);

    it("the dominated move is kept out of the TREE, not just the move list", () => {
        // `selectRootMove` picks among the root's CHILD EDGES, so pruning the
        // root `moves` list alone would leave the no-op openable, visited and
        // selectable. The root deny-set is what actually removes it.
        const state = build({
            cards: [{ name: "Damnation", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        const pid = me(state);
        const { move, trace } = searchWithTrace(
            state,
            pid,
            { iterations: 120 },
            11
        );
        expect(move?.kind).not.toBe("cast-spell");
        const damnations = (trace?.candidates ?? []).filter(
            (c) =>
                c.move.kind === "cast-spell" &&
                cardName(state, c.move.cardInstanceId) === "Damnation"
        );
        expect(damnations).toHaveLength(0);
    }, 60000);
});

describe("dominance pruning guards (issue #1887)", () => {
    it("is OFF by default — the human legal-actions surface keeps every legal cast", () => {
        const state = build({
            cards: [{ name: "Damnation", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        expect(castsOf(state, "Damnation", false).length).toBeGreaterThan(0);
    });

    it("never prunes a land drop", () => {
        const state = build({
            cards: [{ name: "Swamp", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        });
        const pruned = enumerateMoves(state, me(state), {
            pruneDominatedNoOps: true,
        });
        expect(pruned.some((m) => m.kind === "play-land")).toBe(true);
    });

    it("never prunes a permanent spell — board presence is a real delta", () => {
        const state = build({
            cards: [{ name: "Chrome Mox", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        });
        const casts = castsOf(state, "Chrome Mox", false);
        expect(casts.length).toBeGreaterThan(0);
        for (const move of casts) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(false);
        }
    });

    it("never empties the move list — pass always survives", () => {
        const state = build({
            cards: [{ name: "Damnation", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        const pruned = enumerateMoves(state, me(state), {
            pruneDominatedNoOps: true,
        });
        expect(pruned.length).toBeGreaterThan(0);
        expect(pruned[0]).toEqual({ kind: "pass" });
    });

    it("the probe is pure — the caller's state is byte-identical afterwards", () => {
        const state = build({
            cards: [{ name: "Damnation", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        const before = structuredClone(
            JSON.parse(JSON.stringify(state)) as unknown
        );
        const casts = castsOf(state, "Damnation", false);
        for (const move of casts) isDominatedNoOpMove(state, me(state), move);
        const after = JSON.parse(JSON.stringify(state)) as unknown;
        expect(deepEqual(before, after)).toBe(true);
    });
});

// issue #2420 — the probe's own `applyTapPlan` (a THIRD independent copy,
// kept isolated from `search.ts`/`applyMove.ts` by this module's own design)
// must also route an `abilityId` tapPlan entry to the OTHER permanent, never
// the enumerated source. A wrong model here isn't cosmetic: `isNoOpDelta`
// compares tap state to decide dominance pruning, so a mistakenly-tapped Urza
// could mask a real cost/benefit delta for a probed cast.
describe("applyProbeCast — Urza's tapOtherFilter mana ability (issue #2420)", () => {
    it("never taps Urza itself on the probe board; taps the OTHER artifact instead", () => {
        const urzaId = getCardByName("Urza, Lord High Artificer").id;
        const artifactId = getCardByName("Ornithopter").id;
        const spellId = getCardByName("Brainstorm").id;

        const urza = makeInstance(urzaId, {
            id: "urza",
            controllerId: "p1",
            ownerId: "p1",
        });
        const art = makeInstance(artifactId, {
            id: "art",
            controllerId: "p1",
            ownerId: "p1",
        });
        const spell = makeInstance(spellId, {
            id: "spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const probe = makeState({
            players: [
                makePlayer("p1", { hand: [spell], battlefield: [urza, art] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });

        const ok = applyProbeCast(probe, "p1", {
            kind: "cast-spell",
            cardInstanceId: "spell",
            targets: [],
            confirmTargets: false,
            tapPlan: [
                {
                    cardInstanceId: "urza",
                    abilityId: "urza-lha-mana",
                    tapOtherIds: ["art"],
                },
            ],
        });

        expect(ok).toBe(true);
        const p1 = probe.players.find((p) => p.id === "p1")!;
        expect(p1.battlefield.find((c) => c.id === "urza")!.isTapped).toBe(
            false
        );
        expect(p1.battlefield.find((c) => c.id === "art")!.isTapped).toBe(true);
    });
});

// Issue #4478 — the probe's tap plan on the COMMON leg: a plain land entry
// taps exactly the source the enumerator planned for the cost and nothing
// else, and credits nothing to the pool (the coarse model `isNoOpDelta`
// relies on to compare pools). Pinned through the public `applyProbeCast`
// so the retirement of the probe's private copy (issue #4444) keeps it.
describe("applyProbeCast — the tap plan taps the planned sources only (issue #4478)", () => {
    it("a {U} cast on Island + Mountain + Forest taps the Island alone and leaves the pool empty", () => {
        const land = (name: string, id: string) =>
            makeInstance(getCardByName(name).id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
            });
        const spell = makeInstance(getCardByName("Brainstorm").id, {
            id: "spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const probe = makeState({
            players: [
                makePlayer("p1", {
                    hand: [spell],
                    battlefield: [
                        land("Mountain", "mountain"),
                        land("Island", "island"),
                        land("Forest", "forest"),
                    ],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const cast = enumerateMoves(probe, "p1").find(
            (m): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell" && m.cardInstanceId === "spell"
        );
        expect(cast?.tapPlan.map((t) => t.cardInstanceId)).toEqual(["island"]);

        expect(applyProbeCast(probe, "p1", cast!)).toBe(true);

        const p1 = probe.players.find((p) => p.id === "p1")!;
        const tapped = p1.battlefield
            .filter((c) => c.isTapped)
            .map((c) => c.id);
        expect(tapped).toEqual(["island"]);
        expect(
            Object.values(p1.manaPool).reduce((a, b) => a + (b ?? 0), 0)
        ).toBe(0);
    });
});

describe("the probe applies CAST MODES (CR 601.2b, issue #3215)", () => {
    // The probe is the FIFTH build-a-StackItem-from-a-cast site, and the one
    // place where dropping a cast mode is worse than mis-valuing the line: this
    // seam decides LEGALITY, so an unstamped mode makes the move disappear.
    //
    // An overloaded Damn resolves against `forEach { set: "targets" }`, whose
    // member set is the announced targets — empty, because CR 702.96b says an
    // overloaded spell announces none. Without the `overloaded` stamp the probe
    // therefore resolved a spell that destroyed NOTHING, proved it a no-op, and
    // pruned the only cast the bot could afford. Stamped, the same probe wipes
    // the opponent's board and the move survives.
    const overloadSpec: BladeScenario["spec"] = {
        cards: [
            { name: "Damn", owner: "me", zone: "hand" },
            { name: "Plains", owner: "me", zone: "battlefield" },
            { name: "Plains", owner: "me", zone: "battlefield" },
            { name: "Plains", owner: "me", zone: "battlefield" },
            { name: "Plains", owner: "me", zone: "battlefield" },
            { name: "Craw Wurm", owner: "opp", zone: "battlefield" },
            { name: "Craw Wurm", owner: "opp", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 6,
        libraryCount: 20,
    };

    it("an overloaded cast is NOT pruned — it destroys every creature the probe can see", () => {
        const state = build(overloadSpec);
        const unpruned = castsOf(state, "Damn", false);
        const overload = unpruned.find(
            (m) => m.kind === "cast-spell" && m.alternativeCostId === "overload"
        )!;
        expect(overload).toBeDefined();
        expect(isDominatedNoOpMove(state, me(state), overload)).toBe(false);
        // …and it therefore survives the pruning enumeration the search runs.
        expect(
            castsOf(state, "Damn", true).some(
                (m) =>
                    m.kind === "cast-spell" &&
                    m.alternativeCostId === "overload"
            )
        ).toBe(true);
    });

    it("applyProbeCast stamps the mode, so the probe board is the board the cast really produces", () => {
        const state = build(overloadSpec);
        const overload = castsOf(state, "Damn", false).find(
            (m): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell" && m.alternativeCostId === "overload"
        )!;
        const probe = buildBladeState({
            label: "dominance-unit",
            spec: overloadSpec,
            bot: "me",
            budget: { iterations: 1 },
            tier: "must",
            expect: { moves: [{ kind: "pass" }] },
        });
        expect(applyProbeCast(probe, me(probe), overload as never)).toBe(true);
        const item = probe.stack.find((s) => s.id === overload.cardInstanceId);
        expect(item?.overloaded).toBe(true);
    });
});

// ---------------------------------------------------------------------------

/** Every `activate-ability` move of `ability` on `name`, from the raw or the
 *  pruned enumeration. */
function activationsOf(
    state: GameState,
    name: string,
    pruned: boolean
): Move[] {
    return enumerateMoves(
        state,
        me(state),
        pruned ? { pruneDominatedNoOps: true } : undefined
    ).filter(
        (m) =>
            m.kind === "activate-ability" &&
            cardName(state, m.cardInstanceId) === name
    );
}

/** The one variant of `moves` whose single target is `targetName`. */
function aimedAt(
    state: GameState,
    moves: Move[],
    targetName: string
): Move | undefined {
    return moves.find(
        (m) =>
            m.kind === "activate-ability" &&
            m.targets.length === 1 &&
            cardName(state, m.targets[0].id ?? "") === targetName
    );
}

describe("isDominatedNoOpMove — self-sacrifice activations (CR 608.2b, issue #3424)", () => {
    // The bot gave up a permanent to a targeted-removal ability whose only
    // legal target was the ability's OWN SOURCE: targets are chosen at
    // announcement (CR 601.2c via 602.2b) and costs are paid after
    // (CR 601.2h), so the source is already in the graveyard when the ability
    // tries to resolve and it is countered for having no legal target
    // (CR 608.2b). The engine half is correct and is pinned as such in
    // `gre/__tests__/self-sacrifice-cost-fizzle.test.ts`; what was missing was
    // any seam that refused the MOVE.
    const selfTargetOnly = {
        // Seal of Cleansing — "Sacrifice this enchantment: Destroy target
        // artifact or enchantment." The opponent controls neither, and the
        // mover controls no other artifact or enchantment, so the Seal itself
        // is the only legal target the announcement has.
        cards: [
            {
                name: "Seal of Cleansing",
                owner: "me" as const,
                zone: "battlefield" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 4,
        libraryCount: 20,
    };

    it("proves the self-targeted activation dominated by pass", () => {
        const state = build(selfTargetOnly);
        const moves = activationsOf(state, "Seal of Cleansing", false);
        expect(moves).toHaveLength(1);
        expect(isDominatedNoOpMove(state, me(state), moves[0])).toBe(true);
    });

    it("drops it from the pruned enumeration, leaving only pass", () => {
        const state = build(selfTargetOnly);
        const pruned = enumerateMoves(state, me(state), {
            pruneDominatedNoOps: true,
        });
        expect(activationsOf(state, "Seal of Cleansing", true)).toHaveLength(0);
        expect(pruned.every((m) => m.kind === "pass")).toBe(true);
    });

    it("NEGATIVE CONTROL: a legal opponent-side target keeps it, and the own-source variant still goes", () => {
        const state = build({
            ...selfTargetOnly,
            cards: [
                ...selfTargetOnly.cards,
                {
                    name: "Jayemdae Tome",
                    owner: "opp" as const,
                    zone: "battlefield" as const,
                },
            ],
        });
        const raw = activationsOf(state, "Seal of Cleansing", false);
        const atTome = aimedAt(state, raw, "Jayemdae Tome");
        const atSelf = aimedAt(state, raw, "Seal of Cleansing");
        expect(atTome).toBeDefined();
        expect(atSelf).toBeDefined();
        expect(isDominatedNoOpMove(state, me(state), atTome as Move)).toBe(
            false
        );
        expect(isDominatedNoOpMove(state, me(state), atSelf as Move)).toBe(
            true
        );
        const pruned = activationsOf(state, "Seal of Cleansing", true);
        expect(aimedAt(state, pruned, "Jayemdae Tome")).toBeDefined();
        expect(aimedAt(state, pruned, "Seal of Cleansing")).toBeUndefined();
    });

    it("proves a CREATURE source's self-targeted activation dominated too", () => {
        // Mogg Fanatic — "Sacrifice this creature: It deals 1 damage to any
        // target." Aimed at itself the same CR 608.2b counter applies, and the
        // departure ALSO bumps `deathsThisTurn` and stamps `lastKnownCopiable`
        // — the two echoes of the cost the compare has to forgive alongside the
        // zone move itself, or no creature source could ever be proved.
        const state = build({
            cards: [
                {
                    name: "Mogg Fanatic",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        });
        const atSelf = aimedAt(
            state,
            activationsOf(state, "Mogg Fanatic", false),
            "Mogg Fanatic"
        );
        expect(atSelf).toBeDefined();
        expect(isDominatedNoOpMove(state, me(state), atSelf as Move)).toBe(
            true
        );
    });

    it("proves it by PAYING the sacrifice, not by resolving the ability", () => {
        // The discriminating board for the probe's cost payment. A 3/3 Mogg
        // Fanatic (two +1/+1 counters) aimed at itself:
        //
        //   * paying the cost first — what the engine does, CR 601.2h — puts
        //     the Fanatic in the graveyard, leaves the ability with no legal
        //     target and counters it (CR 608.2b). Pure cost: dominated.
        //   * NOT paying it leaves the Fanatic on the battlefield, so the
        //     ability resolves and deals it 1 damage, which a 3/3 shrugs off.
        //     The probe then ends with the source still on the battlefield and
        //     nothing in the graveyard to account for — unprovable, not pruned.
        //
        // So this case is `true` only while `applyProbeActivation` really pays
        // the sacrifice; with the payment removed it goes `false`, which is
        // what a 1/1 Fanatic cannot show (damage kills it and both routes end
        // in the graveyard).
        const state = build({
            cards: [
                {
                    name: "Mogg Fanatic",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    summoningSick: false,
                    counters: { "+1/+1": 2 },
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        });
        const atSelf = aimedAt(
            state,
            activationsOf(state, "Mogg Fanatic", false),
            "Mogg Fanatic"
        );
        expect(atSelf).toBeDefined();
        expect(isDominatedNoOpMove(state, me(state), atSelf as Move)).toBe(
            true
        );
    });

    it("NEGATIVE CONTROL: the payoff that IS the payment survives — a death trigger", () => {
        // Enduring Renewal — "Whenever a creature is put into your graveyard
        // from the battlefield, return it to your hand." The self-targeted
        // Mogg Fanatic still resolves to nothing, but PAYING the cost now
        // returns the Fanatic to hand, so the announcement is no longer a pure
        // loss. This is the exemption the old cost-shape refusal existed to
        // protect, and it is now protected by the PROBE paying the sacrifice
        // for real rather than by refusing to look.
        const state = build({
            cards: [
                {
                    name: "Mogg Fanatic",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                    summoningSick: false,
                },
                {
                    name: "Enduring Renewal",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        });
        const atSelf = aimedAt(
            state,
            activationsOf(state, "Mogg Fanatic", false),
            "Mogg Fanatic"
        );
        expect(atSelf).toBeDefined();
        expect(isDominatedNoOpMove(state, me(state), atSelf as Move)).toBe(
            false
        );
    });
});

describe("the last deferral window, end to end (issue #3424)", () => {
    // The prune is what this pair measures, at the one window where the bot
    // actively WANTS to spend a deferred activation rather than hold it: the
    // opponent's end step (`last-window-fire`, `search.ts`). Both boards are
    // the same Seal of Cleansing in the same window; the only difference is
    // whether the opponent controls anything the Seal can legally hit.
    const window = {
        phase: "END_STEP",
        activePlayer: "opp" as const,
        priority: "me" as const,
        turn: 5,
        landCount: 4,
        libraryCount: 20,
    };
    const seal = {
        name: "Seal of Cleansing",
        owner: "me" as const,
        zone: "battlefield" as const,
    };
    const tome = {
        name: "Jayemdae Tome",
        owner: "opp" as const,
        zone: "battlefield" as const,
    };

    it("with no legal opponent-side target the bot passes, on every seed", () => {
        const state = build({ ...window, cards: [seal] });
        for (const seed of [0, 1, 2]) {
            resetDominanceProbeStats();
            const picked = searchWithTrace(
                build({ ...window, cards: [seal] }),
                me(state),
                { iterations: 200 },
                seed
            );
            // The verdict alone cannot tell "the prune removed the only
            // activation" from "the search happened to prefer pass" — the same
            // blind spot `stats.choiceBranches` exists to close one level down.
            // Assert the probe RAN at the root as well as the outcome.
            expect(dominanceProbeStats().probes).toBeGreaterThan(0);
            expect(picked.move?.kind).toBe("pass");
        }
    });

    it("with one legal opponent-side target it fires, aimed at the opponent", () => {
        const state = build({ ...window, cards: [seal, tome] });
        const tomeId = state.players[1].battlefield[0].id;
        for (const seed of [0, 1, 2]) {
            const picked = searchWithTrace(
                build({ ...window, cards: [seal, tome] }),
                me(state),
                { iterations: 200 },
                seed
            );
            const move = picked.move;
            expect(move?.kind).toBe("activate-ability");
            expect(
                move?.kind === "activate-ability" &&
                    move.targets.map((t) => t.id)
            ).toEqual([tomeId]);
        }
    }, 60000);
});

describe("deepEqual (issue #1887)", () => {
    it("treats an absent key and an explicit undefined as equal", () => {
        expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
        expect(deepEqual({ a: 1 }, { a: 1, b: 0 })).toBe(false);
    });

    it("is order-independent on keys and order-SENSITIVE on arrays", () => {
        expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
        expect(deepEqual([1, 2], [2, 1])).toBe(false);
    });

    it("compares nested structures by value", () => {
        expect(deepEqual({ a: [{ b: 1 }] }, { a: [{ b: 1 }] })).toBe(true);
        expect(deepEqual({ a: [{ b: 1 }] }, { a: [{ b: 2 }] })).toBe(false);
    });
});
