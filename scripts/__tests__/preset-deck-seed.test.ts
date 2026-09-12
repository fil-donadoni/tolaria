// Building a Preset Deck payload from a canonical Tier 1 list (issue #3168).
//
// The point of these is the REFUSALS. A seeder that quietly ships a preset the
// Format rejects has not saved anyone typing — the deck reaches the lobby and
// dies at the game-start gate (ADR 0036), where the player discovers it rather
// than the maintainer.

import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { buildPresetPayload, deckColors } from "../lib/preset-deck-seed";
import { readTier1Decks, type Tier1Deck } from "../lib/tier1-decks";
import { tryGetCardByName } from "../../convex/cards";
import { validateDeck } from "../../convex/formats";
import { parseArgs, seedOne } from "../seed-preset-deck";

const resolve = (name: string) => tryGetCardByName(name);
const SUPPLIED = "2026-08-23";

// The canonical list is a git-tracked file, so it belongs to THIS checkout —
// resolved from the test's own location, exactly as `tier1-decks.test.ts`
// does. Reading it from the primary checkout (issue #3187) sent the health
// gate, which runs in a detached worktree at the base tip, to the primary's
// working tree instead — a different branch, without the file.
const ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");

function oathPonza(): Tier1Deck {
    const file = readTier1Decks(ROOT);
    const deck = file.decks.find((d) => d.slug === "oath-ponza");
    if (!deck) throw new Error("oath-ponza missing from the canonical lists");
    return deck;
}

describe("buildPresetPayload — the real Oath Ponza list (issue #3168)", () => {
    it("builds a 60 + 15 payload every card of which resolves", () => {
        const { payload, problems } = buildPresetPayload(
            oathPonza(),
            "premodern",
            SUPPLIED,
            resolve
        );
        expect(problems).toEqual([]);
        expect(payload!.cards).toHaveLength(60);
        expect(payload!.sideboard).toHaveLength(15);
        // Every entry carries a real registry id, not a name echoed back.
        for (const c of [...payload!.cards, ...payload!.sideboard]) {
            expect(resolve(c.cardName)?.id).toBe(c.cardId);
        }
    });

    it("the built payload is legal Premodern through the real validator", () => {
        const { payload } = buildPresetPayload(
            oathPonza(),
            "premodern",
            SUPPLIED,
            resolve
        );
        const legality = validateDeck(
            { cards: payload!.cards, sideboard: payload!.sideboard },
            "premodern"
        );
        expect(legality.reasons).toEqual([]);
        expect(legality.isLegal).toBe(true);
    });

    it("derives the colours from colour identity, WUBRG-ordered", () => {
        const { payload } = buildPresetPayload(
            oathPonza(),
            "premodern",
            SUPPLIED,
            resolve
        );
        // Oath Ponza is RG: Terravore / Sylvan Library / Oath of Druids green,
        // Pyroclasm / Earthquake / Pyroblast red. Ordered R before G.
        expect(payload!.colors).toEqual(["R", "G"]);
        expect(payload!.description).toContain(SUPPLIED);
        expect(payload!.name).toBe("Oath Ponza");
    });
});

describe("buildPresetPayload — refusals (issue #3168)", () => {
    it("refuses an unresolved card name, and names every one of them", () => {
        const deck = oathPonza();
        const broken: Tier1Deck = {
            ...deck,
            main: [
                { count: 4, name: "Nonesuch Bauble" },
                ...deck.main.slice(1),
            ],
            sideboard: [
                { count: 2, name: "Second Nonesuch" },
                ...deck.sideboard.slice(1),
            ],
        };
        const { payload, problems } = buildPresetPayload(
            broken,
            "premodern",
            SUPPLIED,
            resolve
        );
        expect(payload).toBeUndefined();
        // ONE run names both, so a maintainer fixes the list in one pass.
        expect(problems[0]).toContain("Nonesuch Bauble");
        expect(problems[0]).toContain("Second Nonesuch");
    });

    it("refuses a deck the Format rejects, carrying the validator's reasons", () => {
        const deck = oathPonza();
        // Drop a maindeck entry: 56 cards is not a legal Premodern deck.
        const short: Tier1Deck = { ...deck, main: deck.main.slice(1) };
        const { payload, problems } = buildPresetPayload(
            short,
            "premodern",
            SUPPLIED,
            resolve
        );
        expect(payload).toBeUndefined();
        expect(problems.length).toBeGreaterThan(0);
        expect(problems.join(" ")).toMatch(/not legal in premodern/);
    });
});

describe("deckColors (CR 202.2 colour identity)", () => {
    it("unions identities and orders them WUBRG", () => {
        const defs = [
            "Pyroblast", // R
            "Sylvan Library", // G
            "Counterspell", // U
        ]
            .map(resolve)
            .filter((d): d is NonNullable<typeof d> => d !== null);
        expect(defs).toHaveLength(3);
        expect(deckColors(defs)).toEqual(["U", "R", "G"]);
    });

    it("a colourless deck has no colours", () => {
        const defs = ["Mishra's Factory", "Wasteland"]
            .map(resolve)
            .filter((d): d is NonNullable<typeof d> => d !== null);
        expect(defs).toHaveLength(2);
        expect(deckColors(defs)).toEqual([]);
    });
});

// `--all` — the sweep (issue #3254). The last card of a decklist is landed by
// a card slice whose own diff has no idea it was the last one, so nothing in
// the pipeline noticed Parallax Replenish reaching 21/21. The sweep is what a
// reader runs to find out; these are its offline halves (argument parsing and
// the seedable/blocked classification), which need no deployment.
describe("seed:preset argument parsing (issue #3254)", () => {
    it("reads a bare slug", () => {
        expect(parseArgs(["oath-ponza"])).toEqual({
            slug: "oath-ponza",
            all: false,
            dryRun: false,
            target: "local",
        });
    });

    it("reads --all", () => {
        expect(parseArgs(["--all"])).toEqual({
            slug: "",
            all: true,
            dryRun: false,
            target: "local",
        });
    });

    it("carries --dry-run through both shapes", () => {
        expect(parseArgs(["oath-ponza", "--dry-run"]).dryRun).toBe(true);
        expect(parseArgs(["--all", "--dry-run"]).dryRun).toBe(true);
    });

    // A slug AND --all is ambiguous — seed that one, or every one? Refusing is
    // the only answer that cannot silently do the wrong thing.
    it("refuses a slug together with --all", () => {
        expect(() => parseArgs(["oath-ponza", "--all"])).toThrow(/not both/);
    });

    it("refuses an empty invocation", () => {
        expect(() => parseArgs([])).toThrow(/usage/);
    });
});

describe("seed:preset --all classification (issue #3254)", () => {
    const file = readTier1Decks(ROOT);

    // `--dry-run` is what makes this offline: `seedOne` builds and validates
    // the payload and returns without touching a deployment.
    const rows = file.decks.map((d) =>
        seedOne(d, file.source.suppliedOn, true)
    );

    it("classifies every canonical list as seedable or blocked, never failed", () => {
        expect(rows).toHaveLength(file.decks.length);
        expect(rows.map((r) => r.state).filter((s) => s === "failed")).toEqual(
            []
        );
        for (const row of rows) {
            expect(["seedable", "blocked"]).toContain(row.state);
        }
    });

    it("Oath Ponza is seedable — every card of it is implemented", () => {
        const row = rows.find((r) => r.slug === "oath-ponza")!;
        expect(row.state).toBe("seedable");
        expect(row.problems).toBeUndefined();
    });

    // A deck whose cards can never resolve, so this assertion is stable
    // whatever the canonical file says today. The first draft asserted over the
    // REAL file's blocked half and was vacuous: with the blocked branch
    // disabled every deck classified as `seedable`, the blocked array went
    // empty, and a loop over an empty array passes. Proven by breaking it.
    it("classifies a deck with an unresolvable card as blocked, naming it", () => {
        const impossible: Tier1Deck = {
            slug: "impossible",
            name: "Impossible",
            main: [{ count: 60, name: "Nonexistent Card ZZZ" }],
            sideboard: [{ count: 15, name: "Nonexistent Card YYY" }],
        };
        const row = seedOne(impossible, file.source.suppliedOn, true);
        expect(row.state).toBe("blocked");
        expect(row.problems?.join("\n")).toContain("Nonexistent Card ZZZ");
        expect(row.problems?.join("\n")).toContain("Nonexistent Card YYY");
    });

    it("every blocked list in the canonical file names its blockers", () => {
        for (const row of rows.filter((r) => r.state === "blocked")) {
            expect(row.problems?.join("\n")).toMatch(/unknown card name\(s\)/);
        }
    });
});
