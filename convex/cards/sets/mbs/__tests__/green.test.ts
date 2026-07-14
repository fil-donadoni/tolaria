// MBS — per-card behavior tests for green cards in
// `convex/cards/sets/mbs/green.ts` (set split by colour, ADR 0043).
//
// Green Sun's Zenith reuses ALREADY-EXERCISED Ops (`choice`, `moveZone`,
// `libraryLook`) plus the new `shuffleSelfIntoLibrary` Op and the new dynamic
// `manaValueAtMost: { X: true }` filter construct — both of which have their
// OWN dedicated interpreter tests (per-Op regime,
// `.claude/rules/gre-development.md`). This card-level test is the signal
// the per-Op regime calls for explicitly: the catalogue-wide canned-scenario
// smoke generator (`effectScriptSmoke.test.ts`) SKIPS this script (both
// `moveZone` and `shuffleSelfIntoLibrary` are explicit-skip Ops — see
// `scenarioGenerator.ts`), so a hand-written end-to-end test is the actual
// behavioral guarantor for the FULL composed script, not just its Ops in
// isolation.

import { describe, it, expect } from "vitest";
import { greenSunsZenith } from "../green";
import { llanowarElves, giantSpider } from "../../lea/green";
import { scatheZombies } from "../../lea/black";
import { forest } from "../../lea/colorless";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";

describe("Green Sun's Zenith (CR 701.23 search / 400.7 / 701.24 shuffle / 608.2m self-redirect, issue #898)", () => {
    it("finds a green creature card with mana value X or less, puts it onto the battlefield, then shuffles both libraries and itself into the owner's library", () => {
        const elves = makeInstance(llanowarElves.id, {
            id: "elves1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        }); // green, mana value 1 — matches at X = 1
        const spider = makeInstance(giantSpider.id, {
            id: "spider1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        }); // green, mana value 4 — too expensive at X = 1
        const zombies = makeInstance(scatheZombies.id, {
            id: "zombies1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        }); // creature, mana value 3, but not green — excluded by color
        const woods = makeInstance(forest.id, {
            id: "forest1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        }); // not a creature at all — excluded by type
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [elves, spider, zombies, woods],
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, greenSunsZenith.id, "p1");
        item.chosenX = 1;
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
        const head = state.pendingChoices![0];
        // Only Llanowar Elves matches all three filter dimensions at once
        // (Creature, green, mana value ≤ 1).
        expect(head.candidateIds).toEqual(["elves1"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["elves1"],
        });
        // The found creature entered the battlefield.
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "elves1"
        );
        // The remaining library cards are still there (multiset preserved
        // apart from the picked creature), PLUS Green Sun's Zenith itself —
        // the "Shuffle ~ into its owner's library" self-redirect (CR 608.2m
        // default overridden, issue #898) instead of the graveyard.
        const libIds = state.players[0].library.map((c) => c.id).sort();
        expect(libIds).toEqual(
            ["forest1", "spider1", "zombies1", item.id].sort()
        );
        // Not in the graveyard.
        expect(
            state.players[0].graveyard.find((c) => c.id === item.id)
        ).toBeUndefined();
    });

    it("fails to find (no green creature at mana value X or less) but still shuffles itself into the library", () => {
        const spider = makeInstance(giantSpider.id, {
            id: "spider2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        }); // green, mana value 4 — too expensive at X = 0
        const state = makeState({
            players: [
                makePlayer("p1", { library: [spider] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, greenSunsZenith.id, "p1");
        item.chosenX = 0; // no chosen X — the default
        const resolved = resolveTopOfStack(state);
        // Zero candidates auto-resolves without suspending (CR 608.2b).
        expect(resolved).not.toBeNull();
        expect(state.pendingChoices).toBeUndefined();
        // Nothing entered the battlefield.
        expect(state.players[0].battlefield.length).toBe(0);
        // Green Sun's Zenith still redirects itself into the (shuffled)
        // library — the self-redirect is unconditional, independent of
        // whether the search found anything.
        const libIds = state.players[0].library.map((c) => c.id).sort();
        expect(libIds).toEqual(["spider2", item.id].sort());
        expect(
            state.players[0].graveyard.find((c) => c.id === item.id)
        ).toBeUndefined();
    });
});
