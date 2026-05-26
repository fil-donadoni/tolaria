// Pure-helper tests for the pending-choice buffer (ADR 0007). The hook
// itself uses Convex + React state and is exercised at the integration
// level — these tests cover the toggle / key-derivation primitives that
// the hook composes.

import { describe, it, expect } from "vitest";
import {
    CLIENT_BUFFERED_KINDS,
    deriveChoiceKey,
    isClientBufferedKind,
    toggleId,
} from "../usePendingChoiceBuffer";
import type { PendingChoice } from "~/types/game";

function makeChoice(overrides: Partial<PendingChoice> = {}): PendingChoice {
    return {
        stackItemId: "stack-1",
        step: 0,
        choiceId: "p1",
        playerId: "p1",
        kind: "discard-hand",
        zone: "hand",
        count: 1,
        prompt: "test",
        ...overrides,
    };
}

describe("toggleId", () => {
    it("adds the id when absent", () => {
        expect(toggleId([], "a")).toEqual(["a"]);
        expect(toggleId(["b"], "a")).toEqual(["b", "a"]);
    });

    it("removes the id when present", () => {
        expect(toggleId(["a"], "a")).toEqual([]);
        expect(toggleId(["a", "b", "c"], "b")).toEqual(["a", "c"]);
    });

    it("preserves order on add (append to end)", () => {
        expect(toggleId(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    });

    it("preserves order on remove (keeps remaining order)", () => {
        expect(toggleId(["a", "b", "c", "d"], "c")).toEqual(["a", "b", "d"]);
    });

    it("does not mutate the input", () => {
        const input = ["a", "b"];
        toggleId(input, "a");
        toggleId(input, "c");
        expect(input).toEqual(["a", "b"]);
    });
});

describe("deriveChoiceKey", () => {
    it("returns null for undefined input", () => {
        expect(deriveChoiceKey(undefined)).toBeNull();
    });

    it("encodes stackItemId, step, choiceId, playerId", () => {
        const key = deriveChoiceKey(
            makeChoice({
                stackItemId: "S1",
                step: 2,
                choiceId: "C",
                playerId: "p2",
            })
        );
        expect(key).toBe("S1:2:C:p2");
    });

    it("disambiguates two choices that differ only in playerId (mulligan-bottom case)", () => {
        const a = deriveChoiceKey(
            makeChoice({
                stackItemId: "",
                step: 0,
                choiceId: "bottom",
                playerId: "p1",
            })
        );
        const b = deriveChoiceKey(
            makeChoice({
                stackItemId: "",
                step: 0,
                choiceId: "bottom",
                playerId: "p2",
            })
        );
        expect(a).not.toBe(b);
    });

    it("returns the same key for the same identity (stable across renders)", () => {
        const choice = makeChoice();
        expect(deriveChoiceKey(choice)).toBe(deriveChoiceKey(choice));
    });
});

describe("isClientBufferedKind", () => {
    it("returns true for kinds already migrated to client-buffered submit", () => {
        expect(isClientBufferedKind("discard-hand")).toBe(true);
        expect(isClientBufferedKind("untap-pick")).toBe(true);
        expect(isClientBufferedKind("mulligan-bottom")).toBe(true);
    });

    it("returns false for kinds not yet migrated", () => {
        expect(isClientBufferedKind("keep-permanents")).toBe(false);
        expect(isClientBufferedKind("search-library")).toBe(false);
        expect(isClientBufferedKind("may-pay")).toBe(false);
    });

    it("CLIENT_BUFFERED_KINDS matches the predicate", () => {
        for (const k of CLIENT_BUFFERED_KINDS) {
            expect(isClientBufferedKind(k)).toBe(true);
        }
    });
});
