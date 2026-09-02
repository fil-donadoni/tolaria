// Parsing the `{ label, spec }` preset-scenario block out of a PR body
// (ADR 0044, the seeding gap this closes — see `scripts/lib/scenario-block.ts`
// for the measurement that motivated it).
//
// The fixtures below are REAL shapes taken from merged PR bodies, not invented
// ones: the ```json fence, the bare fence holding a JS object literal, the
// "None owed" prose, and the `owner: "p1"` spelling that loads silently onto
// the wrong side of the board. A parser proven only against the shape its
// author had in mind is exactly how the backfill would have missed half the
// corpus.

import { describe, it, expect } from "vitest";
import {
    classifyScenarioSection,
    extractObjects,
    owesScenario,
    parseLooseObject,
    scenarioRefusal,
    scenarioSection,
    validateScenarioCandidate,
} from "../lib/scenario-block";

describe("scenarioSection (heading location)", () => {
    it("captures the section under a Preset scenario heading, up to the next same-level heading", () => {
        const body = [
            "## What changed",
            "stuff",
            "## Preset scenario (ADR 0044)",
            "the block",
            "## Bot reachability",
            "not this",
        ].join("\n");
        expect(scenarioSection(body)).toBe("the block");
    });

    it("keeps a DEEPER sub-heading inside the section (a `### Spec` under it)", () => {
        const body = [
            "## Preset scenario",
            "intro",
            "### Spec",
            "the block",
            "## UI receipt",
            "no",
        ].join("\n");
        expect(scenarioSection(body)).toBe("intro\n### Spec\nthe block");
    });

    it("returns null when the body has no scenario heading at all", () => {
        expect(scenarioSection("## What changed\nstuff")).toBeNull();
    });
});

describe("parseLooseObject (the historical corpus is not JSON)", () => {
    it("parses strict JSON unchanged", () => {
        expect(parseLooseObject('{"a": 1, "b": [2, 3]}')).toEqual({
            a: 1,
            b: [2, 3],
        });
    });

    it("quotes bare identifier keys — the bare-fence JS-literal shape", () => {
        expect(parseLooseObject('{ label: "x", spec: { cards: [] } }')).toEqual(
            {
                label: "x",
                spec: { cards: [] },
            }
        );
    });

    it("converts single-quoted strings and drops trailing commas", () => {
        expect(
            parseLooseObject("{ label: 'x', spec: { cards: [], }, }")
        ).toEqual({ label: "x", spec: { cards: [] } });
    });

    it("does NOT rewrite a colon inside a string value — 'Bot: Titania Orb'", () => {
        // The regex form of "quote the bare keys" mangles exactly this, which
        // is why the parser is a scanner.
        expect(parseLooseObject('{ label: "Bot: Titania Orb" }')).toEqual({
            label: "Bot: Titania Orb",
        });
    });

    it('survives an apostrophe in a double-quoted label — "Bolas\'s Citadel"', () => {
        expect(parseLooseObject('{ label: "Bolas\'s Citadel" }')).toEqual({
            label: "Bolas's Citadel",
        });
    });

    it("escapes a double quote found inside a single-quoted string", () => {
        expect(parseLooseObject("{ label: 'a \"b\" c' }")).toEqual({
            label: 'a "b" c',
        });
    });

    it("leaves non-key identifiers alone (true / null / a bare word value fails loudly)", () => {
        expect(parseLooseObject("{ tapped: true, count: null }")).toEqual({
            tapped: true,
            count: null,
        });
    });
});

describe("extractObjects", () => {
    it("pulls the object out of a ```json fence", () => {
        const section = [
            "```json",
            '{ "label": "L", "spec": { "cards": [] } }',
            "```",
        ].join("\n");
        expect(extractObjects(section)).toEqual([
            { label: "L", spec: { cards: [] } },
        ]);
    });

    it("pulls it out of a BARE fence holding a JS literal (PR #2995's shape)", () => {
        const section = [
            "```",
            '{ label: "Bot — Madness cast window (CR 702.35a)",',
            "  spec: { cards: [",
            '    { name: "Basking Rootwalla", owner: "me", zone: "exile",',
            "      castableFromExile: true } ],",
            '    phase: "PRECOMBAT_MAIN", turn: 3, libraryCount: 20 } }',
            "```",
        ].join("\n");
        const [obj] = extractObjects(section) as Array<Record<string, unknown>>;
        expect(obj.label).toBe("Bot — Madness cast window (CR 702.35a)");
        expect(
            (obj.spec as { cards: Array<{ name: string }> }).cards[0].name
        ).toBe("Basking Rootwalla");
    });

    it("recovers an UNFENCED inline literal when there is no fence at all", () => {
        const section = 'Scenario: { label: "L", spec: { cards: [] } } — done.';
        expect(extractObjects(section)).toEqual([
            { label: "L", spec: { cards: [] } },
        ]);
    });

    it("ignores a prose fence that holds no object", () => {
        expect(extractObjects("```\nnot an object\n```")).toEqual([]);
    });
});

describe("validateScenarioCandidate", () => {
    const good = {
        label: "Two Innocences",
        spec: {
            cards: [
                {
                    name: "Enduring Innocence",
                    owner: "me",
                    zone: "battlefield",
                },
            ],
            phase: "PRECOMBAT_MAIN",
        },
    };

    it("accepts a well-formed block and normalizes the spec", () => {
        const { candidate, problems } = validateScenarioCandidate(good);
        expect(problems).toEqual([]);
        expect(candidate!.label).toBe("Two Innocences");
        expect(candidate!.spec.cards).toHaveLength(1);
        expect(candidate!.spec.phase).toBe("PRECOMBAT_MAIN");
    });

    it('REJECTS owner: "p1" — normalizeCard maps it to "me" and the board is silently one-sided', () => {
        const { candidate, problems } = validateScenarioCandidate({
            ...good,
            spec: {
                cards: [
                    { name: "Grizzly Bears", owner: "p1" },
                    { name: "Air Elemental", owner: "p2" },
                ],
            },
        });
        expect(candidate).toBeUndefined();
        expect(problems.join(" ")).toContain('owner "p1"');
        expect(problems.join(" ")).toContain('owner "p2"');
    });

    it("rejects an unknown zone rather than letting it be dropped", () => {
        const { candidate, problems } = validateScenarioCandidate({
            ...good,
            spec: { cards: [{ name: "Grizzly Bears", zone: "stack" }] },
        });
        expect(candidate).toBeUndefined();
        expect(problems.join(" ")).toContain('zone "stack"');
    });

    it("rejects an empty board, a missing label and a missing spec", () => {
        expect(
            validateScenarioCandidate({
                label: "L",
                spec: { cards: [] },
            }).problems.join(" ")
        ).toContain("empty");
        expect(
            validateScenarioCandidate({
                spec: { cards: [{ name: "x" }] },
            }).problems.join(" ")
        ).toContain("label");
        expect(
            validateScenarioCandidate({ label: "L" }).problems.join(" ")
        ).toContain("spec");
    });

    it("carries a `prompt` through when present", () => {
        const { candidate } = validateScenarioCandidate({
            ...good,
            prompt: "Bolt one, the other must draw nothing.",
        });
        expect(candidate!.prompt).toBe(
            "Bolt one, the other must draw nothing."
        );
    });
});

describe("classifyScenarioSection", () => {
    it("spec — a json fence under the heading", () => {
        const body = [
            "## Preset scenario (ADR 0044)",
            "```json",
            '{ "label": "L", "spec": { "cards": [{ "name": "Grizzly Bears" }] } }',
            "```",
        ].join("\n");
        const v = classifyScenarioSection(body);
        expect(v.kind).toBe("spec");
        expect(v.candidate!.label).toBe("L");
    });

    it("none — the shipped 'None owed' phrasings", () => {
        for (const prose of [
            "**None owed.** Compiled rows are not hydrated yet.",
            "None. Pure comment change, no gameplay surface.",
            "**None registrable yet, deliberately.** This ships an engine capability.",
            "Nothing owed here — pure refactor.",
            "N/A — docs only.",
        ]) {
            const v = classifyScenarioSection(`## Preset scenario\n${prose}`);
            expect(v.kind, prose).toBe("none");
        }
    });

    it("recovers the UNBRACED pair — `label:` and `spec: {…}` with no enclosing object (PR #2897's shape)", () => {
        const body = [
            "## Preset scenario (ADR 0044)",
            "```",
            "label: North Star fixes an off-colour cast (CR 609.4b)",
            "spec: {",
            '  "cards": [{ "name": "North Star", "owner": "me", "zone": "battlefield" }],',
            '  "phase": "PRECOMBAT_MAIN"',
            "}",
            "```",
        ].join("\n");
        const v = classifyScenarioSection(body);
        expect(v.kind).toBe("spec");
        expect(v.candidate!.label).toBe(
            "North Star fixes an off-colour cast (CR 609.4b)"
        );
        expect(v.candidate!.spec.cards).toHaveLength(1);
    });

    it("does NOT recover a `spec` that is prose rather than an object (PR #2941)", () => {
        const body = [
            "## Preset scenario",
            "```",
            '{ label: "Cube — Bone Shards", spec: "p1 battlefield: Plains, Island" }',
            "```",
        ].join("\n");
        expect(classifyScenarioSection(body).kind).toBe("malformed");
    });

    it("does NOT accept a spec with no `cards` at all (PR #2915 invented a `combat` field)", () => {
        const body = [
            "## Preset scenario",
            "```json",
            '{ "label": "L", "spec": { "phase": "COMBAT_DAMAGE", "combat": { "attackerIds": ["atk"] } } }',
            "```",
        ].join("\n");
        const v = classifyScenarioSection(body);
        expect(v.kind).toBe("malformed");
        expect(v.problems!.join(" ")).toContain("cards");
    });

    it("malformed — the section names a label but nothing parses", () => {
        const body = [
            "## Preset scenario",
            "label: see the issue for the board (not reproduced here)",
        ].join("\n");
        expect(classifyScenarioSection(body).kind).toBe("malformed");
    });

    it('malformed — a block that parses but carries owner: "p1"', () => {
        const body = [
            "## Preset scenario",
            "```",
            '{ label: "L", spec: { cards: [{ name: "Grizzly Bears", owner: "p1" }] } }',
            "```",
        ].join("\n");
        const v = classifyScenarioSection(body);
        expect(v.kind).toBe("malformed");
        expect(v.problems!.join(" ")).toContain('owner "p1"');
    });

    it("absent — no section, and no bare block anywhere", () => {
        expect(classifyScenarioSection("## What changed\nstuff").kind).toBe(
            "absent"
        );
    });

    it("absent — a section that discusses scenarios without owing or declining one", () => {
        const body = "## Preset scenario\nSee the runbook for how to load it.";
        expect(classifyScenarioSection(body).kind).toBe("absent");
    });

    it("recovers a bare block in a body with NO heading (older PRs)", () => {
        const body =
            'Scenario to register: { label: "L", spec: { cards: [{ name: "Mountain" }] } }';
        expect(classifyScenarioSection(body).kind).toBe("spec");
    });
});

describe("owesScenario", () => {
    it("card definitions and the engine owe one", () => {
        expect(owesScenario(["convex/cards/sets/dsk/white.ts"])).toBe(true);
        expect(owesScenario(["convex/gre/state.ts"])).toBe(true);
    });

    it("a TEST-only engine diff does not", () => {
        expect(
            owesScenario([
                "convex/gre/__tests__/state.test.ts",
                "convex/cards/sets/dsk/__tests__/white.test.ts",
            ])
        ).toBe(false);
    });

    it("docs, scripts and src do not", () => {
        expect(
            owesScenario([
                "docs/adr/0044-x.md",
                "scripts/land.ts",
                "src/components/board/Hand.tsx",
                "package.json",
            ])
        ).toBe(false);
    });

    it("a MIXED diff owes one — one gameplay path is enough", () => {
        expect(owesScenario(["docs/x.md", "convex/gre/layers.ts"])).toBe(true);
    });
});

describe("scenarioRefusal", () => {
    const spec = classifyScenarioSection(
        '## Preset scenario\n```json\n{ "label": "L", "spec": { "cards": [{ "name": "Mountain" }] } }\n```'
    );

    it("allows a gameplay diff that carries a valid spec", () => {
        expect(scenarioRefusal(spec, true)).toBeNull();
    });

    it("allows a gameplay diff that explicitly declines one", () => {
        const none = classifyScenarioSection("## Preset scenario\nNone owed.");
        expect(scenarioRefusal(none, true)).toBeNull();
    });

    it("REFUSES a gameplay diff with no scenario section", () => {
        const absent = classifyScenarioSection("## What changed\nstuff");
        expect(scenarioRefusal(absent, true)).toContain("no preset scenario");
    });

    it("allows a NON-gameplay diff with no scenario section", () => {
        const absent = classifyScenarioSection("## What changed\nstuff");
        expect(scenarioRefusal(absent, false)).toBeNull();
    });

    it("REFUSES a malformed block even when the diff owes nothing — someone meant to ship one", () => {
        const bad = classifyScenarioSection(
            '## Preset scenario\n```\n{ label: "L", spec: { cards: [{ name: "Mountain", owner: "p1" }] } }\n```'
        );
        expect(scenarioRefusal(bad, false)).toContain("does not load");
    });
});
