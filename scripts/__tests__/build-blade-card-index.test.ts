// The blade card index builder (issue #4177, review finding B1):
// card name → the `moves` entries asserting the bot's CORRECT play acts with
// it. Pure fixtures — no import of the real registry (`bot-suite-boundary.test.ts`'s
// `convex/gre/ai/` prefix; `scripts/lib/blade-card-index.ts` is registry-free
// by design).
import { describe, it, expect } from "vitest";
import {
    buildBladeCardIndex,
    buildBladeReproducers,
    type IndexableBladeScenario,
} from "../lib/blade-card-index";

describe("buildBladeCardIndex", () => {
    it("indexes a card named by a `moves` matcher's `card` field", () => {
        const scenarios: IndexableBladeScenario[] = [
            {
                label: "bolt to the face",
                tier: "must",
                expect: { moves: [{ card: "Lightning Bolt" }] },
            },
        ];
        expect(buildBladeCardIndex(scenarios)).toEqual({
            "Lightning Bolt": [
                { label: "bolt to the face", tier: "must", needsSetup: false },
            ],
        });
    });

    it("indexes every name in a `moves` matcher's `cards` field too", () => {
        const scenarios: IndexableBladeScenario[] = [
            {
                label: "declares both attackers",
                tier: "must",
                expect: {
                    moves: [{ cards: ["Grizzly Bears", "Runeclaw Bear"] }],
                },
            },
        ];
        const index = buildBladeCardIndex(scenarios);
        expect(Object.keys(index).sort()).toEqual([
            "Grizzly Bears",
            "Runeclaw Bear",
        ]);
    });

    it("never indexes a card from a `forbidden` expectation — that asserts what the bot must NOT do", () => {
        const scenarios: IndexableBladeScenario[] = [
            {
                label: "dominance: does not cast into an empty board",
                tier: "must",
                expect: {
                    forbidden: [{ kind: "cast-spell", card: "Damnation" }],
                },
            },
        ];
        expect(buildBladeCardIndex(scenarios)).toEqual({});
    });

    it("never indexes a card from a `predicate` expectation — it names no card at all", () => {
        const scenarios: IndexableBladeScenario[] = [
            {
                label: "flooded land earns no development bonus",
                tier: "stretch",
                expect: {},
            },
        ];
        expect(buildBladeCardIndex(scenarios)).toEqual({});
    });

    it("never indexes a card that merely sits on the board — spec.cards is not the source", () => {
        const scenarios = [
            {
                label: "opponent holds a trick",
                tier: "must",
                expect: { moves: [{ card: "Prodigal Sorcerer" }] },
                // A real entry also carries `spec.cards` naming other cards on
                // the board (e.g. the opponent's Giant Growth in hand) — the
                // index must never pick those up.
                spec: { cards: [{ name: "Giant Growth" }] },
            },
        ] as unknown as IndexableBladeScenario[];
        expect(buildBladeCardIndex(scenarios)).toEqual({
            "Prodigal Sorcerer": [
                {
                    label: "opponent holds a trick",
                    tier: "must",
                    needsSetup: false,
                },
            ],
        });
    });

    it("marks an entry needing setup steps, and one needing only a revisit", () => {
        const scenarios: IndexableBladeScenario[] = [
            {
                label: "with setup",
                tier: "must",
                expect: { moves: [{ card: "Fetchland" }] },
                setup: [{ kind: "resolve-top" }],
            },
            {
                label: "with revisit only",
                tier: "stretch",
                expect: { moves: [{ card: "Fetchland" }] },
                revisit: [{ kind: "pass" }],
            },
            {
                label: "plain board",
                tier: "must",
                expect: { moves: [{ card: "Fetchland" }] },
            },
        ];
        const entries = buildBladeCardIndex(scenarios)["Fetchland"]!;
        expect(entries.find((e) => e.label === "with setup")!.needsSetup).toBe(
            true
        );
        expect(
            entries.find((e) => e.label === "with revisit only")!.needsSetup
        ).toBe(true);
        expect(entries.find((e) => e.label === "plain board")!.needsSetup).toBe(
            false
        );
    });

    it("collects several entries for the same card, sorted by label", () => {
        const scenarios: IndexableBladeScenario[] = [
            {
                label: "entry two",
                tier: "stretch",
                expect: { moves: [{ card: "Mother of Runes" }] },
            },
            {
                label: "entry one",
                tier: "must",
                expect: { moves: [{ card: "Mother of Runes" }] },
            },
        ];
        expect(buildBladeCardIndex(scenarios)["Mother of Runes"]).toEqual([
            { label: "entry one", tier: "must", needsSetup: false },
            { label: "entry two", tier: "stretch", needsSetup: false },
        ]);
    });

    it("sorts card names for a stable diff", () => {
        const scenarios: IndexableBladeScenario[] = [
            {
                label: "z",
                tier: "must",
                expect: { moves: [{ card: "Zombie" }] },
            },
            { label: "a", tier: "must", expect: { moves: [{ card: "Ape" }] } },
        ];
        expect(Object.keys(buildBladeCardIndex(scenarios))).toEqual([
            "Ape",
            "Zombie",
        ]);
    });
});

describe("buildBladeReproducers (issue #4178)", () => {
    const expect_ = { moves: [{ card: "X" }] };

    it("keeps the spec of a plain-board entry and nulls one that needs setup or revisit", () => {
        expect(
            buildBladeReproducers([
                {
                    label: "plain",
                    tier: "must",
                    expect: expect_,
                    spec: { a: 1 },
                },
                {
                    label: "setup",
                    tier: "must",
                    expect: expect_,
                    spec: { a: 2 },
                    setup: [{}],
                },
                {
                    label: "revisit",
                    tier: "stretch",
                    expect: expect_,
                    spec: { a: 3 },
                    revisit: [{}],
                },
            ])
        ).toEqual({ plain: { a: 1 }, setup: null, revisit: null });
    });

    it("covers exactly the entries the card index covers — no `moves`, no reproducer", () => {
        expect(
            buildBladeReproducers([
                { label: "forbidden only", tier: "must", expect: {}, spec: {} },
            ])
        ).toEqual({});
    });
});
