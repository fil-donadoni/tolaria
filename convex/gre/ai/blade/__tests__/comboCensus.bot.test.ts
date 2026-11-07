/**
 * The Combo Census (ADR 0164 § 2, issue #8417): synthetic entries in the corpus
 * shape, played through the real search and the blade's one builder. `produces`
 * is synthetic where it only has to make the entry measured.
 */
import { describe, expect, it } from "vitest";
import {
    censusEntry,
    classifyProduces,
    comboPositionSpec,
    formatComboCensus,
    summarizeComboCensus,
    type ComboCensusEntry,
    type ComboCensusOptions,
    type ComboCensusPiece,
    type ComboCensusRow,
} from "../comboCensus";
import { buildPositionFromSpec } from "../build";
import { checkStateBasedActions } from "../../../sba";
import { tryGetDefinition } from "../../../../cards";

const piece = (
    name: string,
    zone: string,
    state?: ComboCensusPiece["state"]
): ComboCensusPiece => ({
    name,
    zones: [zone],
    quantity: 1,
    ...(state ? { state } : {}),
});

const entry = (
    pieces: ComboCensusPiece[],
    manaNeeded = "",
    produces: string[] = ["Win the game"]
): ComboCensusEntry => ({
    id: pieces.map((p) => p.name).join("+"),
    pieces,
    produces,
    manaNeeded,
});

const OPTIONS: ComboCensusOptions = {
    budgets: [100],
    seeds: [0xb1ade],
    plyCap: 2,
};

const KILL = entry([piece("Fireball", "H")], "{20}{R}");
const LOOP = entry(
    [piece("Intruder Alarm", "B"), piece("Shrieking Drake", "H")],
    "{U}"
);
const NEVER_CASTABLE = entry([piece("Serra Angel", "G")]);

describe("the readings", () => {
    it("Executable: the game ends in the Bot's win within two plies", () => {
        const row = censusEntry(KILL, OPTIONS);
        expect(row.reading).toBe("Executable");
        expect(row.lowestBudget).toBe(100);
    });

    it("Executable names the lowest budget of the ladder that wins", () => {
        const row = censusEntry(KILL, { ...OPTIONS, budgets: [100, 150] });
        expect(row.lowestBudget).toBe(100);
    });

    it("Initiated: the Bot takes the loop's first step and no win follows", () => {
        const row = censusEntry(LOOP, OPTIONS);
        expect(row.reading).toBe("Initiated");
        expect(row.lowestBudget).toBeUndefined();
    });

    it("Untouched: a piece the Bot can never cast is never played", () => {
        const row = censusEntry(NEVER_CASTABLE, OPTIONS);
        expect(row.reading).toBe("Untouched");
        expect(row.lowestBudget).toBeUndefined();
    });

    it("unmeasurable: a non-terminal entry gets no reading, however playable", () => {
        const row = censusEntry(
            { ...KILL, produces: ["Infinite colored mana"] },
            OPTIONS
        );
        expect(row.reading).toBe("unmeasurable");
        expect(row.producesClass).toBe("non-terminal");
        expect(row.lowestBudget).toBeUndefined();
    });

    it("unmeasurable: a piece no card resolves to is not a Bot miss", () => {
        const row = censusEntry(entry([piece("No Such Card", "B")]), OPTIONS);
        expect(row.reading).toBe("unmeasurable");
        expect(row.unmeasurableBecause).toContain("No Such Card");
    });

    it("a lock is measured, so the census can surface it as Untouched", () => {
        const row = censusEntry(
            { ...NEVER_CASTABLE, produces: ["Lock"] },
            OPTIONS
        );
        expect(row.producesClass).toBe("lock");
        expect(row.reading).toBe("Untouched");
    });

    it("two runs read the same row", () => {
        const options = { ...OPTIONS, plyCap: 4 };
        expect(censusEntry(LOOP, options)).toEqual(censusEntry(LOOP, options));
    });
});

describe("classifyProduces", () => {
    it("an entry takes the strongest class among its features", () => {
        expect(classifyProduces(["Lock", "Infinite damage"])).toBe("terminal");
        expect(classifyProduces(["Infinite creature ETB", "Lock"])).toBe(
            "lock"
        );
    });

    it("an unknown feature is non-terminal", () => {
        expect(classifyProduces(["A feature nobody wrote down"])).toBe(
            "non-terminal"
        );
    });

    it("damage that kills no player is non-terminal", () => {
        expect(classifyProduces(["Near-infinite damage to creatures"])).toBe(
            "non-terminal"
        );
    });
});

describe("the assembled position", () => {
    const build = (e: ComboCensusEntry) => {
        const state = buildPositionFromSpec(comboPositionSpec(e));
        const [bot, opp] = state.players;
        return { state, bot, opp };
    };
    const defOf = (card: { card: unknown }) =>
        tryGetDefinition((card.card as { id: string }).id);
    const names = (cards: readonly { card: unknown }[]) =>
        cards.map((c) => defOf(c)?.name).sort();

    it("the Bot holds priority in its own main phase, its opponent has nothing", () => {
        const { state, bot, opp } = build(LOOP);
        expect(state.phase).toBe("PRECOMBAT_MAIN");
        expect(state.activePlayerId).toBe(bot.id);
        expect(state.priorityPlayerId).toBe(bot.id);
        expect(opp.battlefield).toEqual([]);
        expect(opp.hand).toEqual([]);
    });

    it("each piece is in its zone, under the Bot's control", () => {
        const { bot } = build(
            entry([
                piece("Serra Angel", "B"),
                piece("Grizzly Bears", "G"),
                piece("Shrieking Drake", "H"),
            ])
        );
        expect(names(bot.graveyard)).toEqual(["Grizzly Bears"]);
        expect(names(bot.hand)).toEqual(["Shrieking Drake"]);
        const angel = bot.battlefield.find(
            (c) => defOf(c)?.name === "Serra Angel"
        );
        expect(angel?.controllerId).toBe(bot.id);
        expect(angel?.isSummoningSick).toBeFalsy();
    });

    it("the lands produce manaNeeded, the colored pips each their own basic", () => {
        const { bot } = build(
            entry([piece("Serra Angel", "B")], "{2}{W}{U} each turn")
        );
        const lands = names(bot.battlefield).filter((n) => n !== "Serra Angel");
        expect(lands).toHaveLength(4);
        expect(lands).toContain("Plains");
        expect(lands).toContain("Island");
    });

    it("the lands cover a hand piece whose cost manaNeeded leaves out", () => {
        const { bot } = build(entry([piece("Serra Angel", "H")]));
        expect(names(bot.battlefield)).toEqual([
            "Plains",
            "Plains",
            "Plains",
            "Plains",
            "Plains",
        ]);
    });

    it("manaNeeded that already pays a hand piece buys no second land base", () => {
        const { bot } = build(entry([piece("Shrieking Drake", "H")], "{U}"));
        expect(names(bot.battlefield)).toEqual(["Island"]);
    });

    it("CR 704.5m: a battlefield Aura enters attached, and survives the check", () => {
        const { state, bot } = build(
            entry([piece("Grizzly Bears", "B"), piece("Splinter Twin", "B")])
        );
        checkStateBasedActions(state);
        expect(names(bot.battlefield)).toContain("Splinter Twin");
    });

    it("both seats draw from a nonbasic, noncreature library", () => {
        const { bot, opp } = build(entry([piece("Serra Angel", "B")]));
        for (const seat of [bot, opp]) {
            expect(seat.library.length).toBeGreaterThan(0);
            for (const card of seat.library) {
                const def = defOf(card);
                expect(def?.types).not.toContain("Creature");
                expect(def?.supertypes ?? []).not.toContain("Basic");
            }
        }
    });

    it("a two-faced piece is placed under its front face", () => {
        const name = "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki";
        expect(
            comboPositionSpec(entry([piece(name, "H")])).cards[0]?.name
        ).toBe("Fable of the Mirror-Breaker");
    });

    it("a transforming back face the combo needs cannot be placed: unmeasurable", () => {
        const name = "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki";
        const row = censusEntry(
            entry([piece(name, "B", { usedFace: 2 })]),
            OPTIONS
        );
        expect(row.reading).toBe("unmeasurable");
        expect(row.unmeasurableBecause).toContain("Reflection of Kiki-Jiki");
    });
});

describe("the report", () => {
    const ROWS: ComboCensusRow[] = [
        {
            id: "1-2",
            pieces: ["Alpha", "Beta"],
            producesClass: "terminal",
            reading: "Executable",
            lowestBudget: 400,
        },
        {
            id: "3-4",
            pieces: ["Gamma", "Delta"],
            producesClass: "terminal",
            reading: "Initiated",
            halts: 1,
        },
        {
            id: "5-6",
            pieces: ["Epsilon", "Zeta"],
            producesClass: "lock",
            reading: "Untouched",
        },
        {
            id: "7-8",
            pieces: ["Eta", "Theta"],
            producesClass: "non-terminal",
            reading: "unmeasurable",
            unmeasurableBecause: "no terminal outcome",
        },
    ];
    const OPTIONS_SHOWN: ComboCensusOptions = {
        budgets: [100, 400],
        seeds: [1, 2],
        plyCap: 16,
    };

    it("groups a fixed row set by reading and class, with its counts", () => {
        expect(formatComboCensus(ROWS, OPTIONS_SHOWN)).toBe(
            [
                "== combo census (ADR 0164) — 4 entries, budgets 100/400, 2 seeds, ply cap 16",
                "  class        entries   Executable    Initiated    Untouched unmeasurable",
                "  terminal           2            1            1            0            0",
                "  lock               1            0            0            1            0",
                "  non-terminal       1            0            0            0            1",
                "  total              4            1            1            1            1",
                "  1 rows with a play-out a halt ended early",
                "",
                "== Executable (1)",
                "-- terminal (1)",
                "  1-2  terminal  Executable  400  Alpha + Beta",
                "",
                "== Initiated (1)",
                "-- terminal (1)",
                "  3-4  terminal  Initiated  -  Gamma + Delta  (1 halted)",
                "",
                "== Untouched (1)",
                "-- lock (1)",
                "  5-6  lock  Untouched  -  Epsilon + Zeta",
                "",
                "== unmeasurable (1)",
                "-- non-terminal (1)",
                "  7-8  non-terminal  unmeasurable  -  Eta + Theta  (no terminal outcome)",
            ].join("\n")
        );
    });

    it("counts each row once per reading and once per class", () => {
        const summary = summarizeComboCensus(ROWS);
        expect(summary.total.entries).toBe(4);
        expect(summary.byClass.terminal.Executable).toBe(1);
        expect(summary.byClass.lock.Untouched).toBe(1);
        expect(summary.halted).toBe(1);
    });
});
