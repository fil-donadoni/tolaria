// The behavioural gold harness (issue #2703) — the swap seam and the id graft.
//
// What is worth testing here is NOT "does a card pass": that is the report's
// job (`bun run oracle:behavioural`), it costs one vitest process per card, and
// it moves every time the grammar does. What is worth pinning is the harness's
// own honesty, because both of its failure modes are silent:
//
//   a VACUOUS GREEN — the swap does not happen, the card's tests pass against
//   the hand-written definition they always passed against, and a working
//   closure gets retired on the strength of a run that never saw the compiler;
//
//   a SPURIOUS RED — the twin is behaviourally identical but wears a different
//   ability id, the test cannot find the ability, nothing resolves, and a
//   correct compilation is reported as a misread.
//
// Every assertion below is one of those two.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards/catalogue";
import { getDefinition, preloadDefinitions } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    assertSwapped,
    BehaviouralSwapError,
    parseSwapIds,
    resolveSwapTwins,
} from "../behavioural";
import { compiledTwin } from "../gold";

describe("behavioural swap — every failure is loud (issue #2703)", () => {
    it("refuses an env var that names no card", () => {
        // A driver typo must not read as "nothing to swap, all green".
        expect(() => parseSwapIds("   ")).toThrow(BehaviouralSwapError);
        expect(() => parseSwapIds(",, ,")).toThrow(/names no card id/);
    });

    it("drops blank entries but keeps the real ones", () => {
        expect(parseSwapIds(" a , ,b ")).toEqual(["a", "b"]);
    });

    it("refuses an id that is not a hand-written card", () => {
        expect(() => resolveSwapTwins(["not-a-real-card"])).toThrow(
            /is not a card in the hand-written catalogue/
        );
    });

    it("refuses a card the compiler cannot read, naming the fragment", () => {
        // Word of Command is the canonical protocol card (ADR 0045) — grammar
        // v0 does not read it, and the harness must say so rather than fall
        // back to the hand-written definition.
        const card = getCardByName("Word of Command");
        expect(compiledTwin(card).ok).toBe(false);
        expect(() => resolveSwapTwins([card.id])).toThrow(
            /did not compile — unparsed/
        );
    });

    it("reds when the registry does not actually serve the twin", () => {
        // The anti-vacuity assertion, exercised without performing the swap:
        // a twin that was compiled but never registered must not read as a
        // successful swap just because the definitions look alike.
        const card = getCardByName("Royal Assassin");
        const twin = compiledTwin(card);
        expect(twin.ok).toBe(true);
        if (!twin.ok) return;
        expect(() =>
            assertSwapped([
                {
                    id: card.id,
                    name: card.name,
                    raw: twin.raw,
                    expanded: twin.definition,
                },
            ])
        ).toThrow(/the swap did not take, and this run proves nothing/);
    });

    it("passes once the twin IS what the registry serves", () => {
        // The same assertion's positive half, restored afterwards so no later
        // file in this worker (node runs `isolate: false`) sees the twin.
        const card = getCardByName("Royal Assassin");
        const twin = compiledTwin(card);
        expect(twin.ok).toBe(true);
        if (!twin.ok) return;
        const swap = {
            id: card.id,
            name: card.name,
            raw: twin.raw,
            expanded: twin.definition,
        };
        try {
            preloadDefinitions([twin.raw]);
            expect(() => assertSwapped([swap])).not.toThrow();
        } finally {
            preloadDefinitions([card]);
        }
        expect(getDefinition(card.id)).toBe(card);
    });
});

describe("compiled twin — ability ids are grafted, not invented (issue #2703)", () => {
    it("keeps the hand-written ACTIVATED ability id", () => {
        // Royal Assassin's own test pushes `abilityId: "royal-assassin-destroy"`
        // onto the stack. The compiler would name it `royal-assassin-ability`,
        // and the ability would never be found — a spurious red on a card whose
        // compiled body is exactly right.
        const card = getCardByName("Royal Assassin");
        const twin = compiledTwin(card);
        expect(twin.ok).toBe(true);
        if (!twin.ok) return;
        expect(twin.definition.activatedAbilities?.map((a) => a.id)).toEqual(
            card.activatedAbilities?.map((a) => a.id)
        );
    });

    it("keeps the hand-written TRIGGERED ability id, through the descriptor", () => {
        // The trigger case is not the activated case: the compiler emits a
        // JSON descriptor (`compiledTriggeredAbilities`, issue #2698) that
        // `expandCompiledTriggers` rebuilds at the registry seam, so a graft
        // applied to `triggeredAbilities` on the compiler's raw output finds
        // nothing and silently does nothing. That defect reported four cards as
        // behavioural disagreements when all four twins were identical.
        const card = getCardByName("Juzám Djinn");
        const twin = compiledTwin(card);
        expect(twin.ok).toBe(true);
        if (!twin.ok) return;
        expect(twin.definition.triggeredAbilities?.map((a) => a.id)).toEqual(
            card.triggeredAbilities?.map((a) => a.id)
        );
    });

    it("does NOT graft when the compiler read a different number of abilities", () => {
        // A count difference is a real behavioural difference — the twin must
        // keep it so the behavioural run reds on it, rather than have it
        // papered over by a positional graft.
        const card = getCardByName("Royal Assassin");
        const twin = compiledTwin(card);
        expect(twin.ok).toBe(true);
        if (!twin.ok) return;
        const extraAbility: CardDefinition = {
            ...card,
            activatedAbilities: [
                ...(card.activatedAbilities ?? []),
                ...(card.activatedAbilities ?? []),
            ],
        };
        const mismatched = compiledTwin(extraAbility);
        expect(mismatched.ok).toBe(true);
        if (!mismatched.ok) return;
        expect(mismatched.definition.activatedAbilities).toHaveLength(1);
        expect(mismatched.definition.activatedAbilities?.[0].id).not.toBe(
            card.activatedAbilities?.[0].id
        );
    });
});
