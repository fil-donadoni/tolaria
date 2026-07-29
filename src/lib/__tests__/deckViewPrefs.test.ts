import { describe, it, expect } from "vitest";
import {
    GROUPINGS,
    ORDERINGS,
    DEFAULT_GROUPING,
    DEFAULT_ORDERING,
    loadGrouping,
    saveGrouping,
    loadOrdering,
    saveOrdering,
    loadBasicLandPrintId,
    saveBasicLandPrintId,
    clearBasicLandPrintId,
} from "../deckViewPrefs";

/** Manual in-memory `Storage` mock — mirrors the pattern already established
 *  by `skip-phase-prefs.test.ts` (a `Map` behind the `Storage` interface),
 *  rather than the real jsdom global, so a throwing storage (private mode /
 *  quota, tested below) can be simulated by construction. */
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

/** A `Storage` where every method throws — simulates Safari private mode /
 *  quota-exceeded (acceptance criterion: "A `localStorage` that throws
 *  degrades silently — reads return defaults, writes are best-effort,
 *  nothing crashes"). */
function makeThrowingStorage(): Storage {
    const boom = () => {
        throw new DOMException("QuotaExceededError");
    };
    return {
        get length(): number {
            throw new DOMException("QuotaExceededError");
        },
        clear: boom,
        getItem: boom,
        key: boom,
        removeItem: boom,
        setItem: boom,
    };
}

describe("loadGrouping / saveGrouping (per-Zone, ADR 0075)", () => {
    it("returns the documented default when nothing is stored", () => {
        const storage = makeStorage();
        expect(loadGrouping("main", storage)).toBe(DEFAULT_GROUPING);
        expect(loadGrouping("side", storage)).toBe(DEFAULT_GROUPING);
    });

    it("persists and re-loads identically", () => {
        const storage = makeStorage();
        saveGrouping("main", "color", storage);
        expect(loadGrouping("main", storage)).toBe("color");
    });

    it("keys Maindeck and Sideboard independently — one never leaks into the other", () => {
        const storage = makeStorage();
        saveGrouping("main", "color", storage);
        saveGrouping("side", "type", storage);
        expect(loadGrouping("main", storage)).toBe("color");
        expect(loadGrouping("side", storage)).toBe("type");
    });

    it("follows the tolaria: key convention, namespaced by zone", () => {
        const storage = makeStorage();
        saveGrouping("main", "mv", storage);
        expect(storage.getItem("tolaria:deckViewPrefs:grouping:main")).toBe(
            JSON.stringify("mv")
        );
    });

    it("returns the default on malformed (non-JSON) stored content", () => {
        const storage = makeStorage();
        storage.setItem("tolaria:deckViewPrefs:grouping:main", "not-json{{");
        expect(loadGrouping("main", storage)).toBe(DEFAULT_GROUPING);
    });

    it("returns the default when the stored value is JSON but the wrong type", () => {
        const storage = makeStorage();
        storage.setItem(
            "tolaria:deckViewPrefs:grouping:main",
            JSON.stringify(42)
        );
        expect(loadGrouping("main", storage)).toBe(DEFAULT_GROUPING);

        storage.setItem(
            "tolaria:deckViewPrefs:grouping:side",
            JSON.stringify({ grouping: "mv" })
        );
        expect(loadGrouping("side", storage)).toBe(DEFAULT_GROUPING);
    });

    it("returns the default for a value outside the Grouping vocabulary", () => {
        const storage = makeStorage();
        storage.setItem(
            "tolaria:deckViewPrefs:grouping:main",
            JSON.stringify("banana")
        );
        expect(loadGrouping("main", storage)).toBe(DEFAULT_GROUPING);
    });

    it("accepts every documented Grouping vocabulary member", () => {
        const storage = makeStorage();
        for (const grouping of GROUPINGS) {
            saveGrouping("main", grouping, storage);
            expect(loadGrouping("main", storage)).toBe(grouping);
        }
    });

    it("degrades silently when storage throws on read and write", () => {
        const storage = makeThrowingStorage();
        expect(loadGrouping("main", storage)).toBe(DEFAULT_GROUPING);
        expect(() => saveGrouping("main", "color", storage)).not.toThrow();
    });
});

describe("loadOrdering / saveOrdering (per-Zone, ADR 0075)", () => {
    it("returns the documented default when nothing is stored", () => {
        const storage = makeStorage();
        expect(loadOrdering("main", storage)).toBe(DEFAULT_ORDERING);
        expect(loadOrdering("side", storage)).toBe(DEFAULT_ORDERING);
    });

    it("persists and re-loads identically", () => {
        const storage = makeStorage();
        saveOrdering("side", "rarity", storage);
        expect(loadOrdering("side", storage)).toBe("rarity");
    });

    it("keys Maindeck and Sideboard independently", () => {
        const storage = makeStorage();
        saveOrdering("main", "mv", storage);
        saveOrdering("side", "color", storage);
        expect(loadOrdering("main", storage)).toBe("mv");
        expect(loadOrdering("side", storage)).toBe("color");
    });

    it("follows the tolaria: key convention, namespaced by zone", () => {
        const storage = makeStorage();
        saveOrdering("side", "name", storage);
        expect(storage.getItem("tolaria:deckViewPrefs:ordering:side")).toBe(
            JSON.stringify("name")
        );
    });

    it("returns the default on malformed (non-JSON) stored content", () => {
        const storage = makeStorage();
        storage.setItem("tolaria:deckViewPrefs:ordering:main", "{not-json");
        expect(loadOrdering("main", storage)).toBe(DEFAULT_ORDERING);
    });

    it("returns the default when the stored value is JSON but the wrong type", () => {
        const storage = makeStorage();
        storage.setItem(
            "tolaria:deckViewPrefs:ordering:main",
            JSON.stringify(["name"])
        );
        expect(loadOrdering("main", storage)).toBe(DEFAULT_ORDERING);
    });

    it("returns the default for a value outside the Ordering vocabulary", () => {
        const storage = makeStorage();
        storage.setItem(
            "tolaria:deckViewPrefs:ordering:main",
            JSON.stringify("power")
        );
        expect(loadOrdering("main", storage)).toBe(DEFAULT_ORDERING);
    });

    it("accepts every documented Ordering vocabulary member", () => {
        const storage = makeStorage();
        for (const ordering of ORDERINGS) {
            saveOrdering("side", ordering, storage);
            expect(loadOrdering("side", storage)).toBe(ordering);
        }
    });

    it("degrades silently when storage throws on read and write", () => {
        const storage = makeThrowingStorage();
        expect(loadOrdering("side", storage)).toBe(DEFAULT_ORDERING);
        expect(() => saveOrdering("side", "rarity", storage)).not.toThrow();
    });
});

describe("loadBasicLandPrintId / saveBasicLandPrintId / clearBasicLandPrintId (ADR 0075)", () => {
    it("returns null (no override) when nothing is stored", () => {
        const storage = makeStorage();
        expect(loadBasicLandPrintId("Plains", storage)).toBeNull();
    });

    it("persists and re-loads identically", () => {
        const storage = makeStorage();
        saveBasicLandPrintId("Island", "lea-island-1", storage);
        expect(loadBasicLandPrintId("Island", storage)).toBe("lea-island-1");
    });

    it("keys every subtype independently", () => {
        const storage = makeStorage();
        saveBasicLandPrintId("Swamp", "lea-swamp-2", storage);
        saveBasicLandPrintId("Mountain", "leb-mountain-1", storage);
        expect(loadBasicLandPrintId("Swamp", storage)).toBe("lea-swamp-2");
        expect(loadBasicLandPrintId("Mountain", storage)).toBe(
            "leb-mountain-1"
        );
        expect(loadBasicLandPrintId("Forest", storage)).toBeNull();
    });

    it("follows the tolaria: key convention, namespaced by subtype", () => {
        const storage = makeStorage();
        saveBasicLandPrintId("Forest", "lea-forest-3", storage);
        expect(
            storage.getItem("tolaria:deckViewPrefs:basicLandArt:Forest")
        ).toBe(JSON.stringify("lea-forest-3"));
    });

    it("clears a stored preference back to null", () => {
        const storage = makeStorage();
        saveBasicLandPrintId("Plains", "lea-plains-1", storage);
        clearBasicLandPrintId("Plains", storage);
        expect(loadBasicLandPrintId("Plains", storage)).toBeNull();
    });

    it("returns null on malformed (non-JSON) stored content", () => {
        const storage = makeStorage();
        storage.setItem(
            "tolaria:deckViewPrefs:basicLandArt:Plains",
            "not-json{{"
        );
        expect(loadBasicLandPrintId("Plains", storage)).toBeNull();
    });

    it("returns null when the stored value is JSON but the wrong type", () => {
        const storage = makeStorage();
        storage.setItem(
            "tolaria:deckViewPrefs:basicLandArt:Plains",
            JSON.stringify(123)
        );
        expect(loadBasicLandPrintId("Plains", storage)).toBeNull();

        storage.setItem(
            "tolaria:deckViewPrefs:basicLandArt:Island",
            JSON.stringify(null)
        );
        expect(loadBasicLandPrintId("Island", storage)).toBeNull();
    });

    it("degrades silently when storage throws on read, write and clear", () => {
        const storage = makeThrowingStorage();
        expect(loadBasicLandPrintId("Plains", storage)).toBeNull();
        expect(() =>
            saveBasicLandPrintId("Plains", "lea-plains-1", storage)
        ).not.toThrow();
        expect(() => clearBasicLandPrintId("Plains", storage)).not.toThrow();
    });
});

describe("default localStorage argument", () => {
    it("uses window.localStorage when no storage is injected", () => {
        localStorage.clear();
        expect(loadGrouping("main")).toBe(DEFAULT_GROUPING);
        saveGrouping("main", "type", localStorage);
        expect(loadGrouping("main")).toBe("type");
        localStorage.clear();
    });
});
