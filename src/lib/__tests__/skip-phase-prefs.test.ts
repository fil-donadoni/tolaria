import { describe, it, expect, beforeEach } from "vitest";
import {
    DEFAULT_SKIP_PREFS,
    SKIP_PREFS_KEY,
    isPhaseSkipped,
    loadSkipPrefs,
    saveSkipPrefs,
    shouldAutoPass,
    togglePhaseStop,
    type PhaseSkipPrefs,
} from "../skip-phase-prefs";
import type { AutoPassBlockedCtx } from "../priority";

function makeStorage(): Storage {
    const map = new Map<string, string>();
    return {
        get length() {
            return map.size;
        },
        clear: () => map.clear(),
        getItem: (key: string) => map.get(key) ?? null,
        key: (i: number) => Array.from(map.keys())[i] ?? null,
        removeItem: (key: string) => {
            map.delete(key);
        },
        setItem: (key: string, value: string) => {
            map.set(key, value);
        },
    };
}

describe("loadSkipPrefs", () => {
    let storage: Storage;
    beforeEach(() => {
        storage = makeStorage();
    });

    it("returns defaults when nothing is stored", () => {
        expect(loadSkipPrefs(storage)).toEqual(DEFAULT_SKIP_PREFS);
    });

    it("returns defaults on malformed JSON", () => {
        storage.setItem(SKIP_PREFS_KEY, "not-json");
        expect(loadSkipPrefs(storage)).toEqual(DEFAULT_SKIP_PREFS);
    });

    it("merges stored prefs on top of defaults", () => {
        storage.setItem(
            SKIP_PREFS_KEY,
            JSON.stringify({
                DRAW: { self: false, opponent: false },
                UPKEEP: { self: true, opponent: false },
            })
        );
        const loaded = loadSkipPrefs(storage);
        expect(loaded.DRAW).toEqual({ self: false, opponent: false });
        expect(loaded.UPKEEP).toEqual({ self: true, opponent: false });
        expect(loaded.END_OF_COMBAT).toEqual({ self: true, opponent: true });
    });

    it("ignores unknown phases in stored data", () => {
        storage.setItem(
            SKIP_PREFS_KEY,
            JSON.stringify({ FAKE_PHASE: { self: true, opponent: true } })
        );
        const loaded = loadSkipPrefs(storage) as Record<string, unknown>;
        expect(loaded.FAKE_PHASE).toBeUndefined();
    });
});

describe("saveSkipPrefs + roundtrip", () => {
    it("persists and re-loads identically", () => {
        const storage = makeStorage();
        const prefs = togglePhaseStop(DEFAULT_SKIP_PREFS, "DRAW", "self");
        saveSkipPrefs(prefs, storage);
        expect(loadSkipPrefs(storage)).toEqual(prefs);
    });
});

describe("togglePhaseStop", () => {
    it("adds a stop (sets skip=false) on a default-skipped phase", () => {
        const next = togglePhaseStop(DEFAULT_SKIP_PREFS, "DRAW", "self");
        expect(next.DRAW?.self).toBe(false);
        expect(next.DRAW?.opponent).toBe(true);
    });

    it("toggles idempotently (twice returns original state)", () => {
        const once = togglePhaseStop(
            DEFAULT_SKIP_PREFS,
            "END_STEP",
            "opponent"
        );
        const twice = togglePhaseStop(once, "END_STEP", "opponent");
        expect(twice.END_STEP).toEqual(DEFAULT_SKIP_PREFS.END_STEP);
    });

    it("initializes a phase with no prior entry", () => {
        const next = togglePhaseStop(DEFAULT_SKIP_PREFS, "UPKEEP", "self");
        expect(next.UPKEEP).toEqual({ self: true, opponent: false });
    });
});

describe("isPhaseSkipped", () => {
    it("true when stored skip is true for that side", () => {
        expect(isPhaseSkipped(DEFAULT_SKIP_PREFS, "DRAW", "self")).toBe(true);
    });

    it("false when phase has no entry", () => {
        expect(isPhaseSkipped(DEFAULT_SKIP_PREFS, "UPKEEP", "self")).toBe(
            false
        );
    });
});

describe("shouldAutoPass", () => {
    function makeCtx(
        overrides: Partial<AutoPassBlockedCtx> = {}
    ): AutoPassBlockedCtx {
        return {
            playerId: "p1",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "DRAW",
            stackCount: 0,
            ...overrides,
        };
    }

    const prefs: PhaseSkipPrefs = {
        DRAW: { self: true, opponent: true },
        UPKEEP: { self: false, opponent: false },
    };

    it("true in a self skip phase with priority and clean state", () => {
        expect(shouldAutoPass(makeCtx(), prefs, true)).toBe(true);
    });

    it("false when tab is hidden", () => {
        expect(shouldAutoPass(makeCtx(), prefs, false)).toBe(false);
    });

    it("false when stack is non-empty", () => {
        expect(shouldAutoPass(makeCtx({ stackCount: 1 }), prefs, true)).toBe(
            false
        );
    });

    it("false when we don't have priority", () => {
        expect(
            shouldAutoPass(makeCtx({ priorityPlayerId: "p2" }), prefs, true)
        ).toBe(false);
    });

    it("false when phase is not skippable (UNTAP, CLEANUP)", () => {
        expect(shouldAutoPass(makeCtx({ phase: "UNTAP" }), prefs, true)).toBe(
            false
        );
        expect(shouldAutoPass(makeCtx({ phase: "CLEANUP" }), prefs, true)).toBe(
            false
        );
    });

    it("false when the phase has no skip configured for our side", () => {
        expect(shouldAutoPass(makeCtx({ phase: "UPKEEP" }), prefs, true)).toBe(
            false
        );
    });

    it("reads opponent side when it's the opponent's turn", () => {
        const opponentPrefs: PhaseSkipPrefs = {
            DRAW: { self: false, opponent: true },
        };
        expect(
            shouldAutoPass(
                makeCtx({ activePlayerId: "p2", priorityPlayerId: "p1" }),
                opponentPrefs,
                true
            )
        ).toBe(true);
    });

    it("false when pending cast blocks priority", () => {
        expect(
            shouldAutoPass(
                makeCtx({
                    pendingCast: {
                        playerId: "p2",
                        cardInstanceId: "c",
                        manaCost: {},
                        tappedLandIds: [],
                    },
                }),
                prefs,
                true
            )
        ).toBe(false);
    });

    it("false when an undo is available to us", () => {
        expect(shouldAutoPass(makeCtx({ undoableBy: "p1" }), prefs, true)).toBe(
            false
        );
    });

    it("false when game is over", () => {
        expect(
            shouldAutoPass(
                makeCtx({
                    gameOver: {
                        winnerId: "p1",
                        loserId: "p2",
                        reason: "life",
                    },
                }),
                prefs,
                true
            )
        ).toBe(false);
    });
});
