// Board view preferences (issue #7429): the per-device battlefield grouping
// knob degrades to "stacked" on anything it cannot read, and round-trips what
// it writes.
import { describe, it, expect } from "vitest";
import {
    DEFAULT_BATTLEFIELD_GROUPING,
    loadBattlefieldGrouping,
    saveBattlefieldGrouping,
} from "../boardViewPrefs";

const KEY = "tolaria:boardViewPrefs:battlefieldGrouping";

function memoryStorage(seed: Record<string, string> = {}): Storage {
    const data = new Map(Object.entries(seed));
    return {
        get length() {
            return data.size;
        },
        clear: () => data.clear(),
        getItem: (k) => data.get(k) ?? null,
        key: (i) => [...data.keys()][i] ?? null,
        removeItem: (k) => void data.delete(k),
        setItem: (k, v) => void data.set(k, v),
    };
}

const throwing = {
    getItem: () => {
        throw new Error("denied");
    },
    setItem: () => {
        throw new Error("quota");
    },
} as unknown as Storage;

describe("battlefield grouping preference (issue #7429)", () => {
    it("defaults to stacked when unset", () => {
        expect(DEFAULT_BATTLEFIELD_GROUPING).toBe("stacked");
        expect(loadBattlefieldGrouping(memoryStorage())).toBe("stacked");
    });

    it("round-trips separate", () => {
        const storage = memoryStorage();
        saveBattlefieldGrouping("separate", storage);
        expect(loadBattlefieldGrouping(storage)).toBe("separate");
    });

    it("falls back to stacked on corrupt or out-of-vocabulary content", () => {
        expect(loadBattlefieldGrouping(memoryStorage({ [KEY]: "{oops" }))).toBe(
            "stacked"
        );
        expect(
            loadBattlefieldGrouping(memoryStorage({ [KEY]: '"fanned"' }))
        ).toBe("stacked");
    });

    it("never throws on inaccessible storage", () => {
        expect(loadBattlefieldGrouping(throwing)).toBe("stacked");
        expect(() =>
            saveBattlefieldGrouping("separate", throwing)
        ).not.toThrow();
    });
});
