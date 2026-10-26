// Limited setup logic (PRD #5383, issue #5387): defaults, Sealed rules,
// tolerant load of a corrupt store, fallback for a non-draftable stored
// source, Create payload.
import { afterEach, describe, expect, it } from "vitest";
import type { DraftableSetInfo, PackSourceInfo } from "~/hooks/useLimitedEvent";
import {
    DEFAULT_LIMITED_SETUP,
    LIMITED_SETUP_STORAGE_KEY,
    adjacentSelectableSource,
    applyChange,
    createPayload,
    implementedShare,
    isSourceSelectable,
    limitedSetupSteps,
    loadSetup,
    parseSetup,
    pickTimerVisible,
    reconcileSetup,
    saveSetup,
    seatLimit,
    sourceDisabledReason,
} from "../limitedSetup";

function source(
    key: string,
    over: Partial<PackSourceInfo> & { set?: Partial<DraftableSetInfo> } = {}
): PackSourceInfo {
    const { set, ...rest } = over;
    return {
        key,
        name: key.toUpperCase(),
        description: `About ${key}.`,
        featureCardId: null,
        draftOnly: false,
        draftable: true,
        sets: [
            {
                setCode: key,
                draftable: true,
                missingCardCount: 0,
                sheets: [{ sheetName: "common", coverage: 1, passes: true }],
                ...set,
            },
        ],
        ...rest,
    };
}

const CUBE = source("vintage-cube", {
    name: "Vintage Cube",
    draftOnly: true,
    set: { isCube: true, availableCardCount: 360, sheets: [] },
});
const LEA = source("lea", { name: "Limited Edition Alpha" });
const ICE = source("ice", {
    name: "Ice Age",
    draftable: false,
    set: { draftable: false, missingCardCount: 3 },
});
const SOURCES = [CUBE, LEA, ICE];

afterEach(() => localStorage.clear());

describe("defaults (PRD #5383 stories 17-19)", () => {
    it("opens on Draft · Vintage Cube · 8 seats · Bo3 · pick timer on · Open Decklists off, creatable on arrival", () => {
        expect(createPayload(DEFAULT_LIMITED_SETUP, SOURCES)).toEqual({
            type: "draft",
            seatCount: 8,
            packSource: "vintage-cube",
            sealedBoosterCount: 6,
            timerEnabled: true,
            gamesFormat: "bo3",
            botDifficulty: "medium",
            roundDeadlineMinutes: undefined,
            openDecklists: false,
        });
    });
});

describe("Sealed rules", () => {
    it("disables the cube under Sealed with its reason", () => {
        expect(isSourceSelectable(CUBE, "draft")).toBe(true);
        expect(isSourceSelectable(CUBE, "sealed")).toBe(false);
        expect(sourceDisabledReason(CUBE, "sealed")).toBe("Draft only");
        expect(sourceDisabledReason(CUBE, "draft")).toBeNull();
    });

    it("names the missing cards of a non-draftable source", () => {
        expect(sourceDisabledReason(ICE, "draft")).toBe("3 cards missing");
    });

    it("moves a cube selection to the first Sealed-capable source on switching to Sealed", () => {
        const next = applyChange(
            DEFAULT_LIMITED_SETUP,
            { type: "sealed" },
            SOURCES
        );
        expect(next.type).toBe("sealed");
        expect(next.packSource).toBe("lea");
    });

    it("hides the pick timer and never sends it under Sealed", () => {
        const sealed = applyChange(
            DEFAULT_LIMITED_SETUP,
            { type: "sealed", boostersPerSeat: 4 },
            SOURCES
        );
        expect(pickTimerVisible(sealed)).toBe(false);
        expect(pickTimerVisible(DEFAULT_LIMITED_SETUP)).toBe(true);
        const payload = createPayload(sealed, SOURCES);
        expect(payload?.timerEnabled).toBe(false);
        expect(payload?.sealedBoosterCount).toBe(4);
    });

    it("refuses to create with the cube under Sealed", () => {
        const stale = { ...DEFAULT_LIMITED_SETUP, type: "sealed" as const };
        expect(createPayload(stale, SOURCES)).toBeNull();
    });
});

describe("table bounds", () => {
    it("caps a cube draft at what the implemented pool fills", () => {
        const small = source("vintage-cube", {
            draftOnly: true,
            set: { isCube: true, availableCardCount: 135, sheets: [] },
        });
        const limit = seatLimit(DEFAULT_LIMITED_SETUP, [small]);
        expect(limit).toBeLessThan(8);
        const next = applyChange(DEFAULT_LIMITED_SETUP, { seats: 8 }, [small]);
        expect(next.seats).toBe(limit);
    });

    it("shows a cube table within its limit without shrinking the stored one", () => {
        const small = source("vintage-cube", {
            draftOnly: true,
            set: { isCube: true, availableCardCount: 135, sheets: [] },
        });
        const stored = applyChange(DEFAULT_LIMITED_SETUP, {}, [small, LEA]);
        expect(stored.seats).toBe(8);
        const { setup } = reconcileSetup(stored, [small, LEA]);
        expect(setup.seats).toBe(seatLimit(setup, [small, LEA]));
        const sealedAndBack = applyChange(
            applyChange(stored, { type: "sealed" }, [small, LEA]),
            { type: "draft", packSource: "vintage-cube" },
            [small, LEA]
        );
        expect(sealedAndBack.seats).toBe(8);
    });

    it("keeps the full range for a set draft", () => {
        const setup = applyChange(
            DEFAULT_LIMITED_SETUP,
            { packSource: "lea" },
            SOURCES
        );
        expect(seatLimit(setup, SOURCES)).toBe(8);
    });

    it("clamps seats, boosters and the round deadline into the server's bounds", () => {
        const next = applyChange(
            DEFAULT_LIMITED_SETUP,
            { seats: 1, boostersPerSeat: 0, roundDeadlineMinutes: 100000 },
            SOURCES
        );
        expect(next.seats).toBe(2);
        expect(next.boostersPerSeat).toBeGreaterThanOrEqual(1);
        expect(next.roundDeadlineMinutes).toBeLessThan(100000);
    });

    it("sends a set round deadline", () => {
        const withDeadline = applyChange(
            DEFAULT_LIMITED_SETUP,
            { roundDeadlineMinutes: 30 },
            SOURCES
        );
        expect(createPayload(withDeadline, SOURCES)?.roundDeadlineMinutes).toBe(
            30
        );
    });
});

describe("tolerant load", () => {
    it("falls back to the defaults for every unreadable store", () => {
        for (const raw of [null, "", "{", "null", "[]", '"x"', "42"]) {
            expect(parseSetup(raw)).toEqual(DEFAULT_LIMITED_SETUP);
        }
    });

    it("keeps the well-formed fields and defaults the rest", () => {
        const parsed = parseSetup(
            JSON.stringify({
                type: "sealed",
                packSource: "lea",
                seats: 99,
                gamesFormat: 2,
                pickTimer: "yes",
                boostersPerSeat: 4,
                roundDeadlineMinutes: -5,
                openDecklists: true,
            })
        );
        expect(parsed).toEqual({
            ...DEFAULT_LIMITED_SETUP,
            type: "sealed",
            packSource: "lea",
            boostersPerSeat: 4,
            openDecklists: true,
        });
    });

    it("round-trips a saved setup", () => {
        const setup = applyChange(
            DEFAULT_LIMITED_SETUP,
            { type: "sealed", seats: 4, gamesFormat: 1, openDecklists: true },
            SOURCES
        );
        saveSetup(setup);
        expect(loadSetup()).toEqual(setup);
    });

    it("loads the defaults from a corrupt localStorage entry", () => {
        localStorage.setItem(LIMITED_SETUP_STORAGE_KEY, "{not json");
        expect(loadSetup()).toEqual(DEFAULT_LIMITED_SETUP);
    });
});

describe("fallback for a stored Pack Source that is no longer draftable", () => {
    it("selects the first usable source and says so", () => {
        const { setup, note } = reconcileSetup(
            { ...DEFAULT_LIMITED_SETUP, packSource: "ice" },
            SOURCES
        );
        expect(setup.packSource).toBe("vintage-cube");
        expect(note).toContain("Ice Age");
        expect(note).toContain("Vintage Cube");
    });

    it("also covers a source the catalogue dropped", () => {
        const { setup, note } = reconcileSetup(
            { ...DEFAULT_LIMITED_SETUP, packSource: "gone" },
            SOURCES
        );
        expect(setup.packSource).toBe("vintage-cube");
        expect(note).toContain("gone");
    });

    it("keeps a usable stored source with no note", () => {
        const stored = { ...DEFAULT_LIMITED_SETUP, packSource: "lea" };
        expect(reconcileSetup(stored, SOURCES)).toEqual({
            setup: stored,
            note: null,
        });
    });

    it("changes nothing before the catalogue loads", () => {
        expect(reconcileSetup(DEFAULT_LIMITED_SETUP, [])).toEqual({
            setup: DEFAULT_LIMITED_SETUP,
            note: null,
        });
    });
});

describe("showcase helpers", () => {
    it("steps previous/next over the usable sources, wrapping", () => {
        expect(
            adjacentSelectableSource(SOURCES, "draft", "vintage-cube", 1)?.key
        ).toBe("lea");
        expect(adjacentSelectableSource(SOURCES, "draft", "lea", 1)?.key).toBe(
            "vintage-cube"
        );
        expect(
            adjacentSelectableSource(SOURCES, "draft", "vintage-cube", -1)?.key
        ).toBe("lea");
        expect(adjacentSelectableSource(SOURCES, "sealed", "lea", 1)?.key).toBe(
            "lea"
        );
        expect(adjacentSelectableSource([], "draft", "lea", 1)).toBeUndefined();
    });

    it("reports the implemented share, none for the cube", () => {
        const partial = source("drk", {
            set: {
                sheets: [
                    { sheetName: "a", coverage: 1, passes: true },
                    { sheetName: "b", coverage: 0.5, passes: true },
                ],
            },
        });
        expect(implementedShare(partial)).toBeCloseTo(0.75);
        expect(implementedShare(CUBE)).toBeNull();
    });

    it("answers every rail row from the setup", () => {
        expect(limitedSetupSteps(DEFAULT_LIMITED_SETUP, SOURCES)).toEqual([
            { key: "type", title: "Type", answer: "Draft" },
            { key: "packSource", title: "Pack Source", answer: "Vintage Cube" },
            {
                key: "table",
                title: "Table",
                answer: "8 seats · Bo3 · Medium · timer",
            },
        ]);
    });
});
