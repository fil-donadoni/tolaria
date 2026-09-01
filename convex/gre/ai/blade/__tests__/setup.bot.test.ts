/**
 * Blade `setup` steps — engine-real, or loud (issue #1487, ADR 0070 §4).
 *
 * The value of `setup` is entirely in its invariant: every step runs through
 * the REAL engine, and a step that finds no purchase THROWS rather than
 * building the state "as if". So these tests assert BOTH halves — the step
 * produces the engine's own artefact (a `StackItem` carrying the real
 * `triggeredAbilityId` and `triggerEvent`, indistinguishable from one a
 * genuine ETB produced), and every unsatisfiable step is a hard error.
 */

import { describe, expect, it } from "vitest";
import {
    BladeSetupError,
    applyBladeSetup,
    buildBladeBaseState,
    buildBladeState,
    findBladeScenario,
} from "..";
import { buildStateFromScenario } from "../../../scenarioBuilder";
import { enumerateMoves } from "../../../moves";
import type { GameState } from "../../../state";
import type { ScenarioSpec } from "../../../../debugScenarioSpec";
import { getCardByName } from "../../../../cards";

const DREADNOUGHT = "Phyrexian Dreadnought";
const CHARTER = "charter: Stifles its own Phyrexian Dreadnought trigger";

function build(spec: ScenarioSpec): GameState {
    return buildStateFromScenario(buildBladeBaseState(), spec);
}

describe("blade setup — `etb-trigger` runs the real engine (ADR 0070 §4)", () => {
    it("puts the source's OWN trigger on the stack, as the engine builds it", () => {
        const state = build({
            cards: [
                {
                    name: DREADNOUGHT,
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        });
        expect(state.stack).toHaveLength(0);

        applyBladeSetup(state, {
            label: "t",
            setup: [{ kind: "etb-trigger", card: DREADNOUGHT }],
        });

        expect(state.stack).toHaveLength(1);
        const item = state.stack[0];
        const dread = state.players[0].battlefield.find((c) => c.power === 12)!;
        expect(item.triggerSourceId).toBe(dread.id);
        // The ability id and the triggering event come from the CARD and the
        // engine's own emitter — not from an object literal in the harness.
        expect(item.triggeredAbilityId).toBe(
            "phyrexian-dreadnought-etb-sacrifice"
        );
        expect(item.triggerEvent?.type).toBe("PERMANENT_ENTERED");
        // CR 117.3c — placement hands priority back to the active player, so
        // the seat that owns the Dreadnought may respond to its own trigger.
        expect(state.priorityPlayerId).toBe(state.activePlayerId);
    });

    it("THROWS when no battlefield permanent carries the name (no silent fallback)", () => {
        const state = build({
            cards: [{ name: DREADNOUGHT, owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            libraryCount: 20,
        });
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [{ kind: "etb-trigger", card: DREADNOUGHT }],
            })
        ).toThrow(BladeSetupError);
        expect(state.stack).toHaveLength(0);
    });

    it("THROWS when the named permanent has no enters-the-battlefield trigger", () => {
        // A Grizzly Bears enters and nothing happens. The step cannot be
        // satisfied by the engine, so it fails loudly instead of leaving the
        // search on a position with an empty stack.
        const state = build({
            cards: [
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            libraryCount: 20,
        });
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [{ kind: "etb-trigger", card: "Grizzly Bears" }],
            })
        ).toThrow(/put no triggered ability on the stack/);
    });

    it("THROWS on an ambiguous name rather than picking one", () => {
        const state = build({
            cards: [
                {
                    name: DREADNOUGHT,
                    owner: "me",
                    zone: "battlefield",
                    count: 2,
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            libraryCount: 20,
        });
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [{ kind: "etb-trigger", card: DREADNOUGHT }],
            })
        ).toThrow(/ambiguous/);
    });

    it("`controller` narrows the match to one seat", () => {
        const state = build({
            cards: [
                {
                    name: DREADNOUGHT,
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: DREADNOUGHT,
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            libraryCount: 20,
        });
        applyBladeSetup(state, {
            label: "t",
            setup: [
                { kind: "etb-trigger", card: DREADNOUGHT, controller: "opp" },
            ],
        });
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].controllerId).toBe(state.players[1].id);
    });
});

describe("blade setup — `resolve-top` runs the real resolution path", () => {
    it("resolves the trigger, leaving the CR 118 punisher choice live", () => {
        const state = build({
            cards: [
                {
                    name: DREADNOUGHT,
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        });
        applyBladeSetup(state, {
            label: "t",
            setup: [
                { kind: "etb-trigger", card: DREADNOUGHT },
                { kind: "resolve-top" },
            ],
        });
        // The decision the trigger creates: the may-pay choice node the search
        // must traverse (issue #1425). Reached by running the engine, not by
        // constructing a `pendingChoices` entry.
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        // Real engine behaviour, and the reason `resolve-top` does not assert
        // an emptied stack: a resolution that raises a pending choice SUSPENDS
        // with its item still on the stack and finishes when the choice is
        // submitted (CR 608.2 / ADR 0037).
        expect(state.stack).toHaveLength(1);
    });

    it("THROWS on an empty stack", () => {
        const state = build({
            cards: [{ name: "Grizzly Bears", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            libraryCount: 20,
        });
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [{ kind: "resolve-top" }],
            })
        ).toThrow(BladeSetupError);
    });
});

describe("blade setup — wired into the build pipeline", () => {
    it("the charter entry's built state has its trigger on the stack", () => {
        const scenario = findBladeScenario(CHARTER)!;
        expect(scenario).toBeDefined();
        const state = buildBladeState(scenario);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "phyrexian-dreadnought-etb-sacrifice"
        );
        // Stifle is castable in response: the {U} is on an untapped Island.
        expect(state.players[0].battlefield.some((c) => !c.isTapped)).toBe(
            true
        );
    });

    it("a scenario with no `setup` is untouched", () => {
        const state = build({
            cards: [{ name: "Forest", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            libraryCount: 20,
        });
        const before = JSON.stringify(state);
        applyBladeSetup(state, { label: "t" });
        expect(JSON.stringify(state)).toBe(before);
    });
});

/**
 * `activate` (issue #1491) — the step that reaches a decision only a real
 * ACTIVATION can open: a fetchland's live search-library choice (CR 701.23).
 *
 * The invariant it has to earn is the no-copy one (ADR 0070 §4). The step
 * calls `activateAbilityOnState` (`convex/game.ts`), which IS the mutation's
 * own body — so the costs asserted below (tap, 1 life, sacrifice) are paid by
 * the production path, not by a setup-side re-implementation of CR 602.1.
 */
const DELTA = "Polluted Delta";

describe("blade setup — `activate` runs the real activation path (ADR 0070 §4)", () => {
    function fetchlandBoard(): GameState {
        return build({
            cards: [
                { name: DELTA, owner: "me", zone: "battlefield" },
                { name: "Island", owner: "me", zone: "library" },
                { name: "Swamp", owner: "me", zone: "library" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
        });
    }

    it("pays the REAL cost (CR 602.1) and puts the ability on the stack", () => {
        const state = fetchlandBoard();
        expect(state.players[0].life).toBe(20);

        applyBladeSetup(state, {
            label: "t",
            setup: [{ kind: "activate", card: DELTA }],
        });

        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].abilityId).toBe("polluted-delta-fetch");
        // Every leg of "{T}, Pay 1 life, Sacrifice this land" really happened.
        expect(state.players[0].life).toBe(19);
        expect(
            state.players[0].battlefield.some(
                (c) => (c.card as { id?: string }).id !== undefined
            )
        ).toBe(false);
        expect(state.players[0].graveyard).toHaveLength(1);
    });

    it("resolving it opens the search-library choice the entry decides on", () => {
        const state = fetchlandBoard();
        applyBladeSetup(state, {
            label: "t",
            setup: [{ kind: "activate", card: DELTA }, { kind: "resolve-top" }],
        });
        const choice = state.pendingChoices?.[0];
        expect(choice?.kind).toBe("search-library");
        expect(choice?.playerId).toBe(state.players[0].id);
    });

    it("THROWS when no battlefield permanent carries the name", () => {
        const state = build({
            cards: [{ name: DELTA, owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
        });
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [{ kind: "activate", card: DELTA }],
            })
        ).toThrow(BladeSetupError);
        expect(state.stack).toHaveLength(0);
    });

    it("THROWS on an ambiguous name rather than picking one", () => {
        const state = build({
            cards: [
                { name: DELTA, owner: "me", zone: "battlefield", count: 2 },
            ],
            phase: "PRECOMBAT_MAIN",
        });
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [{ kind: "activate", card: DELTA }],
            })
        ).toThrow(/ambiguous/);
    });

    it("THROWS on an unknown ability id", () => {
        const state = fetchlandBoard();
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [{ kind: "activate", card: DELTA, ability: "nope" }],
            })
        ).toThrow(/no stack-using activated ability with id "nope"/);
    });

    it("THROWS when the card has only mana abilities (CR 605.1a)", () => {
        const state = build({
            cards: [{ name: "Forest", owner: "me", zone: "battlefield" }],
            phase: "PRECOMBAT_MAIN",
        });
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [{ kind: "activate", card: "Forest" }],
            })
        ).toThrow(/no stack-using activated ability/);
    });

    it("THROWS — not falls back — when the real path REJECTS the activation", () => {
        const state = fetchlandBoard();
        // The activator no longer holds priority: `activateAbilityOnState`
        // rejects it exactly as the mutation would, and the step surfaces that
        // rejection instead of placing the ability by hand.
        state.priorityPlayerId = state.players[1].id;
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [{ kind: "activate", card: DELTA }],
            })
        ).toThrow(/the real activation path rejected it/);
        expect(state.stack).toHaveLength(0);
    });

    it("THROWS when the activation stops at a payment decision instead of the stack", () => {
        // Jayemdae Tome's "{4}, {T}: Draw a card" with no mana source on the
        // board enters `pendingActivation` (the human would now tap lands).
        // That is not a position `setup` can walk forward on its own, so it
        // fails loudly rather than searching a half-activated state.
        const state = build({
            cards: [
                {
                    name: "Jayemdae Tome",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
        });
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [{ kind: "activate", card: "Jayemdae Tome" }],
            })
        ).toThrow(/put nothing on the stack/);
    });
});

/**
 * `activate`'s `target` field (issue #2306) — the second half of the step,
 * for a TARGETED ability the raw `activateAbilityOnState` path above can
 * never reach the stack for: it always opens `pendingTarget` (never
 * auto-resolved, even with one legal target), which is exactly the "stopped
 * at a payment/target decision" throw the tests above pin. Mother of Runes
 * ("{T}: Target creature you control gains protection from the colour of
 * your choice…") is the motivating card: its colour choice (the position
 * issue #2306's blade entries assert on) does not exist until the ability
 * is on the stack.
 */
describe("blade setup — `activate`'s `target` field reaches a targeted ability's stack (issue #2306)", () => {
    function motherBoard(extra: ScenarioSpec["cards"] = []): GameState {
        return build({
            cards: [
                {
                    name: "Mother of Runes",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                ...extra,
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
        });
    }

    it("funds a real target selection through enumerateMoves/applyMoveInSearch and reaches the stack", () => {
        const state = motherBoard();
        applyBladeSetup(state, {
            label: "t",
            setup: [
                {
                    kind: "activate",
                    card: "Mother of Runes",
                    target: "Mother of Runes",
                },
            ],
        });
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].abilityId).toBe("mother-of-runes-protect");
        // The REAL target-commit path ran (not a hand-placed stack item):
        // targets are populated, and no pendingTarget is left dangling.
        expect(state.stack[0].targets).toHaveLength(1);
        expect(state.pendingTarget).toBeUndefined();
    });

    it("resolving it opens the colour-mode choice the #2306 blade entries decide on", () => {
        const state = motherBoard();
        applyBladeSetup(state, {
            label: "t",
            setup: [
                {
                    kind: "activate",
                    card: "Mother of Runes",
                    target: "Mother of Runes",
                },
                { kind: "resolve-top" },
            ],
        });
        const choice = state.pendingChoices?.[0];
        expect(choice?.kind).toBe("option-pick");
        expect(choice?.options?.map((o) => o.id).sort()).toEqual([
            "protection-black",
            "protection-blue",
            "protection-green",
            "protection-red",
            "protection-white",
        ]);
    });

    it("THROWS when no legal activation targets `target`", () => {
        // Mother's ability requires "you control" — an opponent's creature is
        // never a legal target, so no candidate survives the narrowing.
        const state = motherBoard([
            {
                name: "Grizzly Bears",
                owner: "opp",
                zone: "battlefield",
                summoningSick: false,
            },
        ]);
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [
                    {
                        kind: "activate",
                        card: "Mother of Runes",
                        target: "Grizzly Bears",
                    },
                ],
            })
        ).toThrow(
            /"Mother of Runes" has no legal activation targeting "Grizzly Bears"/
        );
        expect(state.stack).toHaveLength(0);
    });

    it("THROWS on an ambiguous target name rather than guessing", () => {
        // Two Grizzly Bears the caster controls: the target NAME resolves to
        // two distinct legal activations, and the step refuses to pick one.
        const state = motherBoard([
            {
                name: "Grizzly Bears",
                owner: "me",
                zone: "battlefield",
                summoningSick: false,
                count: 2,
            },
        ]);
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [
                    {
                        kind: "activate",
                        card: "Mother of Runes",
                        target: "Grizzly Bears",
                    },
                ],
            })
        ).toThrow(/still target "Grizzly Bears"/);
    });
});

/**
 * `activate` resolves POST-LAYER abilities (issue #1522, CR 611.2a/613.1f
 * layer 6) — not the static `CardDefinition` alone. Two directions:
 *   - a native ability another permanent's continuous static effect GRANTED
 *     to this instance must be activatable, even though it never appears on
 *     the target's own printed `CardDefinition`;
 *   - a native ability a "loses all abilities" continuous effect SUPPRESSES
 *     must still be rejected, exactly as `activateAbilityOnState`'s own
 *     `resolveActivatedAbility` check rejects it in a live game.
 */
describe("blade setup — `activate` resolves post-layer abilities (issue #1522)", () => {
    const MASTER = "Zombie Master";
    const ZOMBIE = "Scathe Zombies";

    it("activates an ability GRANTED by another permanent's static effect, absent from the target's own CardDefinition", () => {
        const state = build({
            cards: [
                { name: MASTER, owner: "me", zone: "battlefield" },
                {
                    name: ZOMBIE,
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            // Both cards are black — a Swamp per seat (CR 202.2 color-match
            // seeding, `scenarioBuilder.ts`) pays the granted "{B}: Regenerate".
            landCount: 1,
        });
        const zombie = state.players[0].battlefield.find(
            (c) => c.power === 2 && c.toughness === 2
        )!;
        // The grant lands on the INSTANCE (`applySourceStaticEffects`,
        // replayed once per source by `buildStateFromScenario`) — confirm the
        // fixture actually exercises the granted path, not a coincidental
        // native one.
        expect(zombie.grantedActivatedAbilities?.length).toBeGreaterThan(0);
        expect((getCardByName(ZOMBIE).activatedAbilities ?? []).length).toBe(0);
        // `activate` only walks a position whose costs commit immediately
        // (setup.ts's own documented scope); pre-fund the {B} so this fixture
        // isolates the ABILITY-LOOKUP fix (issue #1522) from the separate,
        // pre-existing "mana already covered" limitation on the step.
        state.players[0].manaPool.B = 1;

        applyBladeSetup(state, {
            label: "t",
            setup: [{ kind: "activate", card: ZOMBIE }],
        });

        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].abilityId).toBe("zombie-master-regenerate");
    });

    it("STILL THROWS via the real path when the ability is statically suppressed (CR 613.1f)", () => {
        const state = build({
            cards: [{ name: DELTA, owner: "me", zone: "battlefield" }],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
        });
        const delta = state.players[0].battlefield.find(
            (c) => (c.card as { id?: string }).id !== undefined
        )!;
        // Simulate a "loses all abilities" continuous effect (Titania's Song
        // shape) already applied to this permanent — the same field
        // `applySourceStaticEffects` writes for a live suppression source.
        delta.abilitiesSuppressedBy = [
            { sourceId: "some-suppressing-source-id", seq: 1 },
        ];

        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [{ kind: "activate", card: DELTA }],
            })
        ).toThrow(/no stack-using activated ability/);
        expect(state.stack).toHaveLength(0);
    });
});

describe("blade setup — the fetch-target charter entry (issue #1491)", () => {
    const FETCH = "charter: fetches the land that makes its removal castable";

    it("its built state faces the live search-library choice", () => {
        const scenario = findBladeScenario(FETCH)!;
        expect(scenario).toBeDefined();
        const state = buildBladeState(scenario);
        const choice = state.pendingChoices?.[0];
        expect(choice?.kind).toBe("search-library");
        // Exactly two answers are reachable — the Island and the Swamp. The
        // leftover synthetic-deck Plains are in the library but unfetchable,
        // which is why the entry sets no `libraryCount`.
        const me = state.players[0];
        const fetchable = me.library.filter((c) =>
            (c.subtypes ?? []).some((s) => s === "Island" || s === "Swamp")
        );
        expect(fetchable).toHaveLength(2);
        // And the consequence the entry rests on: the Mountain alone cannot
        // cast Terror, so the Swamp is the only line to the removal.
        expect(me.hand).toHaveLength(1);
        expect(me.battlefield).toHaveLength(1);
    });
});

/**
 * `cast` (issue #1490) — the step that reaches a RESPONSE position: a spell on
 * the stack that only a real cast can put there.
 *
 * Its invariant is the no-copy one (ADR 0070 §4), earned through the production
 * legality gate `enumerateMoves` (only legal casts, only for the priority
 * holder) plus the search's own `applyMoveInSearch`. A cast the engine would
 * not offer is simply absent → the step throws, never hand-builds a StackItem.
 */
describe("blade setup — `cast` runs the real cast pipeline (ADR 0070 §4)", () => {
    function boltBoard(tapped = false): GameState {
        return build({
            cards: [
                { name: "Mountain", owner: "me", zone: "battlefield", tapped },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
        });
    }

    it("casts the named spell onto the stack, unresolved, and hands the responder priority", () => {
        const state = boltBoard();
        expect(state.stack).toHaveLength(0);

        applyBladeSetup(state, {
            label: "t",
            setup: [
                {
                    kind: "cast",
                    card: "Lightning Bolt",
                    by: "me",
                    target: "opp",
                },
            ],
        });

        expect(state.stack).toHaveLength(1);
        // The `target` really pinned the cast: Bolt is aimed at the opp seat.
        expect(state.stack[0].targets?.[0]?.id).toBe(state.players[1].id);
        // CR 117 — the real cast auto-passes the caster's priority, so the
        // responder (opp) holds it and may answer. Not a hand-built stack item.
        expect(state.priorityPlayerId).toBe(state.players[1].id);
    });

    it("THROWS when the named card is nowhere legal to cast", () => {
        const state = boltBoard();
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [{ kind: "cast", card: "Counterspell", by: "me" }],
            })
        ).toThrow(BladeSetupError);
        expect(state.stack).toHaveLength(0);
    });

    it("THROWS when the caster can't pay for it (engine offers no legal cast)", () => {
        const state = boltBoard(true); // Mountain tapped → no {R}
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [
                    {
                        kind: "cast",
                        card: "Lightning Bolt",
                        by: "me",
                        target: "opp",
                    },
                ],
            })
        ).toThrow(/no legal cast/);
        expect(state.stack).toHaveLength(0);
    });

    it("THROWS when `x` matches no legal cast", () => {
        const state = build({
            cards: [
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                },
                { name: "Disintegrate", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
        });
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [
                    {
                        kind: "cast",
                        card: "Disintegrate",
                        by: "me",
                        target: "opp",
                        x: 99, // unaffordable
                    },
                ],
            })
        ).toThrow(/no legal cast with X = 99/);
    });

    it("THROWS on an ambiguous cast rather than guessing (many X / targets match)", () => {
        const state = build({
            cards: [
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                },
                { name: "Disintegrate", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
        });
        // No `target`/`x`: Disintegrate offers X = 0..2 against both players —
        // several legal casts. The step refuses to pick one.
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [{ kind: "cast", card: "Disintegrate", by: "me" }],
            })
        ).toThrow(/still match/);
    });
});

describe("blade setup — the modal-choice charter entry (issue #1490)", () => {
    const MODAL =
        "charter: picks the modal mode that survives a lethal red spell";

    it("faces a lethal red spell on the stack with the bot on priority", () => {
        const scenario = findBladeScenario(MODAL)!;
        expect(scenario).toBeDefined();
        const state = buildBladeState(scenario);
        // A red spell (Disintegrate) is on the stack, unresolved.
        expect(state.stack).toHaveLength(1);
        // The bot is "opp" (players[1]); it holds priority to respond.
        const botId = state.players[1].id;
        expect(state.priorityPlayerId).toBe(botId);
        // Lethal by force: 20 damage into a 20-life bot (CR 104.3a).
        expect(state.players[1].life).toBe(20);
        expect(state.stack[0].chosenX).toBe(20);
    });

    it("offers BOTH modes as legal casts — the losing mode is present, not absent", () => {
        // The whole trap issue #1490 names: a test that passes because the
        // losing mode was removed (no legal target) proves nothing. Here Counter
        // (target the red spell) AND Destroy (target the red 1/1) are BOTH legal,
        // so the bot choosing Counter is a real choice.
        const scenario = findBladeScenario(MODAL)!;
        const state = buildBladeState(scenario);
        const botId = state.players[1].id;
        const casts = enumerateMoves(state, botId).filter(
            (m) => m.kind === "cast-spell"
        );
        const modes = new Set(
            casts.map((m) => (m.kind === "cast-spell" ? m.chosenModeId : ""))
        );
        expect(modes.has("counter")).toBe(true);
        expect(modes.has("destroy")).toBe(true);
        // A one-option list would be a vacuous pass; both modes are offered.
        expect(casts.length).toBeGreaterThanOrEqual(2);
    });
});

describe("blade setup — `know-library-top` grants ADR 0026 knowledge (issue #1524)", () => {
    /** The position a scry KEEP leaves behind: the top card known to its own
     *  controller, everything below it not. */
    const board = (): ScenarioSpec => ({
        cards: [
            {
                name: "Lightning Bolt",
                owner: "me",
                zone: "library",
                position: 1,
            },
            { name: "Mountain", owner: "me", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        libraryCount: 20,
    });

    it("stamps `knownTo` on exactly the requested run, through the real primitive", () => {
        const state = build(board());
        applyBladeSetup(state, {
            label: "t",
            setup: [{ kind: "know-library-top", count: 2 }],
        });
        const library = state.players[0].library;
        expect(library[0].knownTo).toEqual([state.players[0].id]);
        expect(library[1].knownTo).toEqual([state.players[0].id]);
        // …and nothing below the run.
        expect(library[2].knownTo).toBeUndefined();
        // The library itself is untouched (a knowledge grant moves no card).
        expect(String(library[0].card.id)).toBe(
            getCardByName("Lightning Bolt").id
        );
    });

    it("defaults to one card, and to the library's own owner as the knower", () => {
        const state = build(board());
        applyBladeSetup(state, {
            label: "t",
            setup: [{ kind: "know-library-top" }],
        });
        expect(state.players[0].library[0].knownTo).toEqual([
            state.players[0].id,
        ]);
        expect(state.players[0].library[1].knownTo).toBeUndefined();
    });

    it("`of` + `knower` express a FATESEAL — the opponent's top, known to me", () => {
        const state = build(board());
        applyBladeSetup(state, {
            label: "t",
            setup: [{ kind: "know-library-top", of: "opp", knower: "me" }],
        });
        expect(state.players[1].library[0].knownTo).toEqual([
            state.players[0].id,
        ]);
        // The bot's OWN top is untouched — the step named the other library.
        expect(state.players[0].library[0].knownTo).toBeUndefined();
    });

    it("THROWS when the library is shorter than the run, rather than granting nothing", () => {
        const state = build({
            cards: [{ name: "Mountain", owner: "me", zone: "battlefield" }],
            phase: "PRECOMBAT_MAIN",
            libraryCount: 1,
        });
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [{ kind: "know-library-top", count: 3 }],
            })
        ).toThrow(BladeSetupError);
    });
});

describe("blade setup — `know-library-top` rejects a run it cannot grant", () => {
    it("THROWS on count < 1 rather than granting nothing quietly", () => {
        for (const count of [0, -1]) {
            const state = build({
                cards: [{ name: "Mountain", owner: "me", zone: "battlefield" }],
                phase: "PRECOMBAT_MAIN",
                libraryCount: 20,
            });
            expect(() =>
                applyBladeSetup(state, {
                    label: "t",
                    setup: [{ kind: "know-library-top", count }],
                })
            ).toThrow(BladeSetupError);
        }
    });
});
