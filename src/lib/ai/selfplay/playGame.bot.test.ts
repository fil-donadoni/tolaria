// Direct unit tests on `listCandidates` (issue #2689 fixup 2 review, PR
// #2692) — the self-play harness's zone-pick candidate lister. A round-1
// review found it silently returns the WRONG set for two zones instead of
// erroring, which is why a broken allow-list read as a playable game for
// months: the library branch ignored `head.candidateIds` entirely (unlike the
// hand branch), and there was no graveyard branch at all, so a non-targeted
// graveyard pick fell through to the no-zone fallback and always came back
// empty. Both are exercised directly against `listCandidates`, not indirectly
// through a full self-play game, per the per-decision-function testing
// doctrine (`.claude/skills/bot-slice/SKILL.md` § Verification doctrine #2).

import { describe, it, expect } from "vitest";
import { createInitialGameState } from "@convex/gre";
import { presetToPlayerInput } from "./decks";
import { listCandidates } from "./playGame";
import type { PendingChoice } from "@convex/gre";

function basePlayers() {
    return [
        presetToPlayerInput("mono-red-burn", 0, "A"),
        presetToPlayerInput("mono-red-burn", 1, "B"),
    ];
}

function baseChoice(overrides: Partial<PendingChoice>): PendingChoice {
    return {
        stackItemId: "s1",
        step: 0,
        choiceId: "c1",
        playerId: "A",
        kind: "choose-graveyard-card",
        count: 1,
        prompt: "test",
        ...overrides,
    };
}

describe("listCandidates library zone (issue #2689 fixup 2)", () => {
    it("intersects with head.candidateIds instead of returning the whole library", () => {
        const state = createInitialGameState(basePlayers(), 1234);
        const library = state.players[0].library;
        // A production library is 30+ cards deep (40-card deck minus the
        // opening hand). Pick a narrow 2-card allow-list — mirrors Impulse's
        // "look at the top 4" scoped down further by a real card filter.
        const allow = library.slice(0, 2).map((c) => c.id);
        const choice = baseChoice({
            playerId: "A",
            kind: "look-top",
            zone: "library",
            candidateIds: allow,
        });

        const result = listCandidates(state, choice);
        const resultIds = result.map((c) => c.id).sort();

        // The load-bearing assertion: the buggy code (`return
        // zoneOwner.library`) returns a SUPERSET (the whole library, 30+
        // cards) that trivially CONTAINS these 2 ids too — an
        // `expect(...).toEqual(expect.arrayContaining(allow))` shape would
        // pass on the bug. Asserting the exact length AND exact id set is
        // what fails when the intersection is dropped.
        expect(result).toHaveLength(allow.length);
        expect(resultIds).toEqual([...allow].sort());
        expect(library.length).toBeGreaterThan(allow.length);
    });

    it("returns the whole library when no candidateIds allow-list is given", () => {
        const state = createInitialGameState(basePlayers(), 1234);
        const choice = baseChoice({
            playerId: "A",
            kind: "search-library",
            zone: "library",
        });

        const result = listCandidates(state, choice);

        expect(result).toHaveLength(state.players[0].library.length);
    });
});

describe("listCandidates graveyard zone (issue #2689 fixup 2)", () => {
    it("returns the owner's graveyard filtered to head.candidateIds", () => {
        const state = createInitialGameState(basePlayers(), 1234);
        // Move a few real instances into the graveyard for the test — the
        // helper only reads `zoneOwner.graveyard`, not the instance's own
        // `.zone` tag, so this is a faithful stand-in for "cards that died".
        const moved = state.players[0].library.splice(0, 3);
        state.players[0].graveyard.push(...moved);
        const allow = moved.slice(0, 1).map((c) => c.id); // Exhume: count=1

        const choice = baseChoice({
            playerId: "A",
            kind: "choose-graveyard-card",
            zone: "graveyard",
            candidateIds: allow,
        });

        const result = listCandidates(state, choice);

        // Before the fix there was no graveyard branch at all: the choice
        // fell to the no-zone fallback, which filters BATTLEFIELD instances
        // by candidateIds and always returned `[]` for a graveyard pick.
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(allow[0]);
    });
});

describe("listCandidates exile zone (issue #2689 fixup 3)", () => {
    it("returns the owner's exile filtered to head.candidateIds", () => {
        const state = createInitialGameState(basePlayers(), 1234);
        // Move a few real instances into exile — mirrors the graveyard test
        // above; the helper only reads `zoneOwner.exile`, not the instance's
        // own `.zone` tag.
        const moved = state.players[0].library.splice(0, 3);
        state.players[0].exile.push(...moved);
        const allow = moved.slice(0, 1).map((c) => c.id); // Dauthi Voidwalker: count=1

        const choice = baseChoice({
            playerId: "A",
            kind: "choose-exile-card",
            zone: "exile",
            candidateIds: allow,
        });

        const result = listCandidates(state, choice);

        // Before this fixup there was no exile branch at all: the choice
        // fell to the no-zone fallback, which filters BATTLEFIELD instances
        // by candidateIds and finds none (an exile pick's candidateIds is
        // always non-empty per the field doc), tripping the untagged-zone
        // throw instead of returning the exile card.
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(allow[0]);
    });
});

describe("listCandidates library eligibleIds (issue #2689 fixup 3)", () => {
    it("narrows a look-distribute keep pool to eligibleIds, not just candidateIds", () => {
        const state = createInitialGameState(basePlayers(), 1234);
        const library = state.players[0].library;
        // Narset shape: look at the top 4 (candidateIds — the whole window,
        // shown face-up), but only 1 of them is noncreature/nonland and thus
        // keep-eligible (eligibleIds) — the rest may only be bottomed.
        const looked = library.slice(0, 4).map((c) => c.id);
        const eligible = [looked[0]];

        const choice = baseChoice({
            playerId: "A",
            kind: "look-distribute",
            zone: "library",
            candidateIds: looked,
            eligibleIds: eligible,
        });

        const result = listCandidates(state, choice);
        const resultIds = result.map((c) => c.id).sort();

        // The load-bearing assertion: the un-fixed code returns the full
        // candidateIds-filtered window (4 cards) — a SUPERSET that trivially
        // CONTAINS the 1 eligible id too, so an
        // `expect(...).toEqual(expect.arrayContaining(eligible))` shape
        // would pass on the bug. Exact length + exact id set is what fails
        // when the eligibleIds conjunct is dropped.
        expect(result).toHaveLength(1);
        expect(resultIds).toEqual(eligible);
        expect(looked.length).toBeGreaterThan(eligible.length);
    });

    it("does not apply eligibleIds outside the library zone", () => {
        // `eligibleIds` is documented as look-distribute-only, which is
        // library-only by construction (`PendingChoice.eligibleIds` doc,
        // gre/state.ts) — pins that the collapsed owner-zone branch doesn't
        // accidentally apply the conjunct to hand/graveyard/exile too, where
        // the resolver never checks it.
        const state = createInitialGameState(basePlayers(), 1234);
        const moved = state.players[0].library.splice(0, 2);
        state.players[0].graveyard.push(...moved);
        const allow = moved.map((c) => c.id);

        const choice = baseChoice({
            playerId: "A",
            kind: "choose-graveyard-card",
            zone: "graveyard",
            candidateIds: allow,
            eligibleIds: [allow[0]],
        });

        const result = listCandidates(state, choice);
        expect(result).toHaveLength(2);
    });
});

describe("listCandidates no-zone fallback diagnostic (issue #2689 fixup 2)", () => {
    it("does not throw for trigger-order — candidateIds there are stack item ids, never permanents", () => {
        // CR 603.3b — reproduced live via mono-r-aggro vs br-reanimator, seed
        // 64, orientation 0/1 (both guard-stopped with `resolution-error`
        // before this exemption existed): the loud "untagged zone" diagnostic
        // added alongside the library/graveyard fixes fired on EVERY
        // trigger-order choice, because its `candidateIds` name stack items,
        // not permanents, and can never be found by filtering the
        // battlefield. `resolvePending` never reads this function's return
        // for this kind (it submits `head.candidateIds` directly), so the
        // right behavior is the pre-existing silent `[]`, not a throw.
        const state = createInitialGameState(basePlayers(), 1234);
        const choice = baseChoice({
            playerId: "A",
            kind: "trigger-order",
            candidateIds: ["stack-item-1", "stack-item-2"],
            count: 2,
        });

        expect(() => listCandidates(state, choice)).not.toThrow();
        expect(listCandidates(state, choice)).toEqual([]);
    });

    it("throws when a real permanent-shaped candidateIds allow-list resolves to nothing", () => {
        // The genuine "untagged zone" bug shape (what the graveyard branch's
        // absence looked like before it was added): a zone-pick choice whose
        // `candidateIds` name real objects, but the fallback can't find any
        // of them because they live in a zone this function doesn't check.
        const state = createInitialGameState(basePlayers(), 1234);
        const choice = baseChoice({
            playerId: "A",
            kind: "choose-damage-target",
            candidateIds: ["not-a-real-id"],
            count: 1,
        });

        expect(() => listCandidates(state, choice)).toThrow(/untagged zone/);
    });
});
