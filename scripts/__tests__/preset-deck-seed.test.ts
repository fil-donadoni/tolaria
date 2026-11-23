// Building a Preset Deck payload from a canonical Tier 1 list (issue #3168).
//
// The point of these is the REFUSALS. A seeder that quietly ships a preset the
// Format rejects has not saved anyone typing — the deck reaches the lobby and
// dies at the game-start gate (ADR 0036), where the player discovers it rather
// than the maintainer.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildPresetPayload, deckColors } from "../lib/preset-deck-seed";
import {
    deckPlayability,
    readTier1Decks,
    tier1Reports,
    type DeckPlayability,
    type Tier1Deck,
    validateDecks,
} from "../lib/tier1-decks";
import { tryGetCardByName } from "../../convex/cards";
import { validateDeck } from "../../convex/formats";
import { buildSeedPresetRow } from "../../convex/decks";
import {
    parseArgs,
    PRESET_SOURCES,
    resolveListName,
    seedOne,
    sourcedDecks,
    type SourcedDeck,
} from "../seed-preset-deck";
import {
    readMetagameDecks,
    readModernMetagameDecks,
    withCarriedFeaturedCard,
    type MetagameDeckFile,
} from "../premodern-metagame-import";
import { parseLockfile } from "../lib/oracle-lockfile";
import { poolOracleIds } from "../oracle-compile";

const resolve = (name: string) => tryGetCardByName(name);
const SUPPLIED = "2026-08-23";

// The canonical list is a git-tracked file, so it belongs to THIS checkout —
// resolved from the test's own location, exactly as `tier1-decks.test.ts`
// does. Reading it from the primary checkout (issue #3187) sent the health
// gate, which runs in a detached worktree at the base tip, to the primary's
// working tree instead — a different branch, without the file.
const ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");

const LOCK = parseLockfile(
    readFileSync(join(ROOT, "data", "oracle-compiled.json"), "utf8")
);
const POOL = poolOracleIds();
const PREMODERN = PRESET_SOURCES.find((s) => s.format === "premodern")!;
const MODERN = PRESET_SOURCES.find((s) => s.format === "modern")!;

/** A real list as the sweep sees it: its source and its lockfile playability. */
function sourced(deck: Tier1Deck, source = PREMODERN): SourcedDeck {
    const [report] = tier1Reports({ decks: [deck] }, LOCK, POOL);
    return { deck, source, playability: deckPlayability(deck, report) };
}

/** A playability count fixed by hand — for a list the lockfile cannot read. */
function counted(
    deck: Tier1Deck,
    playability: Partial<DeckPlayability> = {}
): SourcedDeck {
    return {
        deck,
        source: PREMODERN,
        playability: {
            main: 60,
            mainTotal: 60,
            side: 15,
            sideTotal: 15,
            missing: [],
            ...playability,
        },
    };
}

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
    const rows = file.decks.map((d) => seedOne(sourced(d), true));

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
        // Counted 75/75 by hand: the lockfile cannot read these names, so
        // the registry is the gate this exercises.
        const row = seedOne(counted(impossible), true);
        expect(row.state).toBe("blocked");
        expect(row.problems?.join("\n")).toContain("Nonexistent Card ZZZ");
        expect(row.problems?.join("\n")).toContain("Nonexistent Card YYY");
    });

    // The 75/75 gate (issue #8453): a list whose every name RESOLVES is still
    // blocked while one copy is not playable, and says which card.
    it("blocks a resolvable list below 75/75, naming the first missing card", () => {
        const deck = oathPonza();
        const [first] = tier1Reports({ decks: [deck] }, LOCK, POOL)[0].cards;
        const row = seedOne(
            counted(deck, {
                side: 14,
                missing: [{ ...first, state: "unparsed", blocker: "x" }],
            }),
            true
        );
        expect(row.state).toBe("blocked");
        expect(row.problems?.[0]).toBe(
            "74/75 playable (main 60/60, side 14/15) — published at 75/75"
        );
        expect(row.problems?.[1]).toBe(`missing: ${first.name} (unparsed: x)`);
    });

    it("every blocked list in the canonical file names its blockers", () => {
        const silent = rows
            .filter((r) => r.state === "blocked")
            .filter(
                (r) =>
                    !/unknown card name\(s\)/.test(r.problems?.join("\n") ?? "")
            );
        expect(silent).toEqual([]);
    });
});

describe("seed:preset --all over the metagame lists (issue #6675)", () => {
    // The release ships these 25 lists as production Preset Decks, so the
    // sweep's guarantee is pinned here: every one builds a payload.
    const file = readMetagameDecks(ROOT);

    it("reads the 25 metagame lists, stiflenought under its own slug", () => {
        expect(file.decks).toHaveLength(25);
        const slugs = file.decks.map((d) => d.slug);
        expect(slugs).toContain("stiflenought");
        expect(slugs).not.toContain("deck-1");
    });

    // A list with a card nobody has built yet is BLOCKED, never a failure: the
    // deploy sweep re-tries it every build and it seeds itself once its last
    // card lands. The count moves up as cards land, so it is never pinned.
    const unresolvedOf = (deck: Tier1Deck): string[] =>
        [
            ...new Set([...deck.main, ...deck.sideboard].map((r) => r.name)),
        ].filter((name) => resolve(name) === null);

    it("every playable list builds a legal Premodern 60 + 15 payload", () => {
        expect(file.decks.some((d) => unresolvedOf(d).length === 0)).toBe(true);
        for (const deck of file.decks) {
            if (unresolvedOf(deck).length > 0) continue;
            const { payload, problems } = buildPresetPayload(
                deck,
                "premodern",
                "mtgtop8.com",
                resolve
            );
            expect({ slug: deck.slug, problems }).toEqual({
                slug: deck.slug,
                problems: [],
            });
            expect(payload!.cards).toHaveLength(60);
            expect(payload!.sideboard).toHaveLength(15);
        }
    });

    // Zero blocked lists is a legal outcome (every card has landed), so the
    // loop's own count is asserted rather than left to a per-list expect.
    it("every other list is reported blocked, naming its unresolved cards", () => {
        const blockedRows = [];
        for (const deck of file.decks) {
            const unresolved = unresolvedOf(deck);
            if (unresolved.length === 0) continue;
            const row = seedOne(sourced(deck), true);
            expect(row.state).toBe("blocked");
            expect(row.problems?.join("\n")).toContain(unresolved.join(", "));
            blockedRows.push(row);
        }
        expect(blockedRows).toHaveLength(
            file.decks.filter((d) => unresolvedOf(d).length > 0).length
        );
    });
});

describe("seed row slug (issue #6675)", () => {
    it("keeps the canonical slug when the archetype name slugifies elsewhere", () => {
        for (const [slug, name] of [
            ["goblin", "Goblins"],
            ["burn", "Sligh/Burn"],
            ["oath-ponza", "Oath of Druids"],
        ]) {
            expect(buildSeedPresetRow({ name }, slug).slug).toBe(slug);
        }
    });
});

describe("seed:preset over the Modern lists (issue #8453)", () => {
    const file = readModernMetagameDecks(ROOT);
    const rows = file.decks.map((d) => ({
        sd: sourced(d, MODERN),
        row: seedOne(sourced(d, MODERN), true),
    }));

    it("publishes every 75/75 list as a legal Modern 60 + 15, blocks the rest naming a card", () => {
        expect(rows).toHaveLength(10);
        for (const { sd, row } of rows) {
            const full =
                sd.playability.main + sd.playability.side ===
                sd.playability.mainTotal + sd.playability.sideTotal;
            if (full) {
                expect({ slug: row.slug, row }).toEqual({
                    slug: row.slug,
                    row: { slug: row.slug, name: row.name, state: "seedable" },
                });
            } else {
                expect(row.state).toBe("blocked");
                expect(row.problems?.[1]).toBe(
                    `missing: ${sd.playability.missing[0].name} (${sd.playability.missing[0].state}${sd.playability.missing[0].blocker ? `: ${sd.playability.missing[0].blocker}` : ""})`
                );
            }
        }
        // At least one list publishes — the reason this ticket exists.
        expect(rows.some(({ row }) => row.state === "seedable")).toBe(true);
    });

    it("builds a Modern payload described as the Modern metagame", () => {
        const { sd } = rows.find(({ row }) => row.state === "seedable")!;
        const { payload } = buildPresetPayload(
            sd.deck,
            "modern",
            MODERN.origin,
            resolveListName
        );
        expect(payload?.format).toBe("modern");
        expect(payload?.description).toBe(
            `Modern metagame — list from ${MODERN.origin}.`
        );
    });

    // A hand-written double-faced card is registered under its FRONT face;
    // the lists spell it by its combined name (Boros Energy's Ajani).
    it("resolves a hand-written double-faced card by its combined name", () => {
        const front = tryGetCardByName("Ajani, Nacatl Pariah");
        expect(front).not.toBeNull();
        expect(
            tryGetCardByName("Ajani, Nacatl Pariah // Ajani, Nacatl Avenger")
        ).toBeNull();
        expect(
            resolveListName("Ajani, Nacatl Pariah // Ajani, Nacatl Avenger")?.id
        ).toBe(front!.id);
    });

    // One bad list blocks ONLY itself (the deploy sweep must not die on it).
    it("refuses a slug two lists share — the later list only, as blocked", () => {
        const one = (format: "premodern" | "modern"): MetagameDeckFile => ({
            source: { supplier: "x", format, note: "" },
            decks: [oathPonza()],
        });
        const [first, second] = sourcedDecks(
            [
                { source: PREMODERN, file: one("premodern") },
                { source: MODERN, file: one("modern") },
            ],
            LOCK,
            POOL
        );
        expect(first.refusal).toBeUndefined();
        expect(second.refusal).toMatch(
            /duplicate Preset Deck slug "oath-ponza"/
        );
        const row = seedOne(second, true);
        expect(row.state).toBe("blocked");
        expect(row.problems?.[0]).toMatch(/duplicate Preset Deck slug/);
    });

    it("a list naming a card the lockfile cannot resolve blocks itself, not the sweep", () => {
        const bad: Tier1Deck = {
            ...oathPonza(),
            slug: "bad",
            main: [
                { count: 59, name: "Forest" },
                { count: 1, name: "Not A Real Card" },
            ],
        };
        const rows = sourcedDecks(
            [
                {
                    source: MODERN,
                    file: {
                        source: { supplier: "x", format: "MO", note: "" },
                        decks: [bad, oathPonza()],
                    },
                },
            ],
            LOCK,
            POOL
        );
        expect(rows).toHaveLength(2);
        expect(rows[0].refusal).toMatch(/Not A Real Card/);
        expect(rows[1].refusal).toBeUndefined();
    });

    it("reads every canonical file without a slug collision (issue #10515)", () => {
        const all = sourcedDecks(
            PRESET_SOURCES.map((source) => ({
                source,
                file: source.read(ROOT),
            })),
            LOCK,
            POOL
        );
        // Ten modern-metagame archetypes + the owner's eleven further lists of
        // data/modern-preset-decks.json (Tron joined with issue #10608), none
        // refused for a shared slug.
        const modern = all.filter((d) => d.source.format === "modern");
        expect(modern).toHaveLength(21);
        expect(modern.filter((d) => d.refusal !== undefined)).toEqual([]);
    });
});

describe("Featured Card of a canonical list (issue #10234)", () => {
    it("the payload carries the list's featuredCard as its Card ID", () => {
        const deck = { ...oathPonza(), featuredCard: "Oath of Druids" };
        const { payload } = buildPresetPayload(
            deck,
            "premodern",
            SUPPLIED,
            resolve
        );
        expect(payload!.featuredCardId).toBe(resolve("Oath of Druids")!.id);
        expect(
            payload!.cards.some((c) => c.cardId === payload!.featuredCardId)
        ).toBe(true);
    });

    it("a list naming no featuredCard sends no override", () => {
        const deck: Tier1Deck = { ...oathPonza(), featuredCard: undefined };
        const { payload } = buildPresetPayload(
            deck,
            "premodern",
            SUPPLIED,
            resolve
        );
        expect(payload).not.toHaveProperty("featuredCardId");
    });

    it("refuses a featuredCard that is not a maindeck entry", () => {
        const deck = oathPonza();
        const sideOnly = deck.sideboard.find(
            (s) => !deck.main.some((m) => m.name === s.name)
        )!.name;
        expect(() =>
            validateDecks([{ ...deck, featuredCard: sideOnly }], "x.json")
        ).toThrow(/featuredCard.*is not a maindeck entry/);
    });

    it("every metagame list names its Featured Card, never a basic land", () => {
        const basics = new Set([
            "Plains",
            "Island",
            "Swamp",
            "Mountain",
            "Forest",
        ]);
        for (const deck of [
            ...readMetagameDecks(ROOT).decks,
            ...readModernMetagameDecks(ROOT).decks,
        ]) {
            expect({
                slug: deck.slug,
                set: deck.featuredCard !== undefined,
            }).toEqual({
                slug: deck.slug,
                set: true,
            });
            expect(basics.has(deck.featuredCard!)).toBe(false);
        }
    });

    it("a metagame refresh keeps the pick while the card is still in the main", () => {
        const deck: Tier1Deck = { ...oathPonza(), featuredCard: undefined };
        expect(
            withCarriedFeaturedCard(deck, "Oath of Druids").featuredCard
        ).toBe("Oath of Druids");
        expect(
            withCarriedFeaturedCard(deck, "Not In This List").featuredCard
        ).toBeUndefined();
        expect(withCarriedFeaturedCard(deck, undefined)).toBe(deck);
    });
});
