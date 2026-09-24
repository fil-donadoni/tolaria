import { describe, it, expect } from "vitest";
import {
    classifyTestBlocks,
    findIdentityBlocks,
    type CardFact,
    type CardFacts,
} from "../lib/identity-test-classifier";

/**
 * Unit test for the identity-test classifier (issue #2363).
 *
 * The classifier's job is to tell a tautology (`expect` over static data, zero
 * calls) from a real test. Both errors are cheap to make and only one is cheap
 * to notice, so the cases below are written in pairs: the identity shape and
 * the nearly identical behavioural shape it must NOT be confused with.
 */

const src = (body: string) =>
    `import { describe, it, expect } from "vitest";\n${body}\n`;

const one = (body: string) => src(`it("t", () => {\n${body}\n});`);

describe("identity-test classifier", () => {
    describe("identity shapes (delete candidates)", () => {
        const identity: [string, string][] = [
            [
                "single scalar field",
                `expect(BLACK_KNIGHT.staticAbilities).toContain("first_strike");`,
            ],
            [
                "compound field literal",
                `expect(DEF.manaCost).toEqual({ generic: 2, white: 1 });`,
            ],
            [
                "multi-line definition snapshot",
                `expect(DEF.power).toBe(1);
                 expect(DEF.toughness).toBe(3);
                 expect(DEF.subtypes).toEqual(["Human", "Wizard"]);
                 expect(DEF.manaCost).toEqual({ black: 2 });`,
            ],
            [
                "nested optional-chain read",
                `expect(DEF.staticEffects?.[0]?.kind).toBe("power_toughness");`,
            ],
            [
                "target-requirement structural snapshot",
                `expect(DEF.targetRequirement).toMatchObject({ type: "creature", count: 1 });`,
            ],
            [
                "collection methods over the definition",
                `const names = DEF.activatedAbilities.map((a) => a.id).sort();
                 expect(names).toEqual(["a", "b"]);`,
            ],
            [
                "JS built-in statics only",
                `expect(Object.keys(DEF.manaCost)).toHaveLength(2);
                 expect(JSON.parse(JSON.stringify(DEF)).id).toBe("x");`,
            ],
            [
                "structuredClone round-trip",
                `const copy = structuredClone(DEF);
                 expect(copy.oracleText).toBe(DEF.oracleText);`,
            ],
            [
                "negated matcher chain",
                `expect(DEF.staticAbilities).not.toContain("flying");`,
            ],
            [
                "outer binding that is plain data",
                `expect(DEF.rarity).toBe("rare");`,
            ],
        ];

        for (const [label, body] of identity) {
            it(`flags: ${label}`, () => {
                const found = findIdentityBlocks("x.test.ts", one(body));
                expect(found, `missed identity shape: ${label}`).toHaveLength(
                    1
                );
            });
        }
    });

    describe("behavioural shapes (must never be flagged)", () => {
        const behavioural: [string, string][] = [
            [
                "fixture builder in the body",
                `const state = makeState({ battlefield: [] });
                 expect(state.players).toHaveLength(2);`,
            ],
            [
                "engine entry point",
                `expect(getLegalTargets(state, spell)).toEqual([]);`,
            ],
            [
                "reducer traversal",
                `const projected = projectPublicState(state, 1, "p1");
                 expect(projected.players[0].hand).toHaveLength(7);`,
            ],
            [
                "unrecognised method call on a value",
                `expect(registry.lookup("x")).toBeDefined();`,
            ],
            [
                "constructor call",
                `const rng = new SeededRandom(1);
                 expect(rng.next()).toBeGreaterThan(0);`,
            ],
            [
                "helper that mutates then asserts",
                `resolveTopOfStack(state);
                 expect(state.stack).toHaveLength(0);`,
            ],
        ];

        for (const [label, body] of behavioural) {
            it(`clears: ${label}`, () => {
                const found = findIdentityBlocks("x.test.ts", one(body));
                expect(found, `false positive: ${label}`).toEqual([]);
            });
        }
    });

    describe("the shared-setup rule", () => {
        it("a block reading an outer binding built by a real call is NOT identity", () => {
            const source = src(`
                const state = makeState({ battlefield: [angel] });
                describe("Serra Angel", () => {
                    it("is 4/4", () => {
                        expect(state.players[0].battlefield[0].power).toBe(4);
                    });
                });
            `);
            const blocks = classifyTestBlocks("x.test.ts", source);
            expect(blocks).toHaveLength(1);
            expect(blocks[0].verdict).toBe("behavioural");
            expect(blocks[0].reason).toContain("makeState");
        });

        it("the same block IS identity when the outer binding is plain data", () => {
            const source = src(`
                const DEF = CARDS.find((c) => c.id === "serra-angel")!;
                describe("Serra Angel", () => {
                    it("is 4/4", () => {
                        expect(DEF.power).toBe(4);
                    });
                });
            `);
            const blocks = classifyTestBlocks("x.test.ts", source);
            expect(blocks[0].verdict).toBe("identity");
        });

        it("resolves the binding through the enclosing describe, not just the module", () => {
            const source = src(`
                describe("outer", () => {
                    const state = buildScenario();
                    describe("inner", () => {
                        it("reads it", () => {
                            expect(state.turn).toBe(1);
                        });
                    });
                });
            `);
            const blocks = classifyTestBlocks("x.test.ts", source);
            expect(blocks[0].verdict).toBe("behavioural");
        });

        it("a shadowing local binding of plain data does not inherit behaviour", () => {
            const source = src(`
                const def = makeState();
                describe("d", () => {
                    const def = CARD_DEFS.serraAngel;
                    it("is 4/4", () => {
                        expect(def.power).toBe(4);
                    });
                });
            `);
            const blocks = classifyTestBlocks("x.test.ts", source);
            expect(blocks[0].verdict).toBe("identity");
        });

        it("a property named like an outer binding does not count as a read", () => {
            const source = src(`
                const state = makeState();
                describe("d", () => {
                    it("is 4/4", () => {
                        expect(DEF.state).toBe("ready");
                    });
                });
            `);
            const blocks = classifyTestBlocks("x.test.ts", source);
            expect(blocks[0].verdict).toBe("identity");
        });
    });

    describe("blocks with no assertion", () => {
        it("is neither identity nor behavioural", () => {
            const blocks = classifyTestBlocks(
                "x.test.ts",
                one(`const unused = DEF.power;`)
            );
            expect(blocks[0].verdict).toBe("no-assertion");
        });

        it("a body that only calls something is behavioural, assertion or not", () => {
            const blocks = classifyTestBlocks(
                "x.test.ts",
                one(`resolveTopOfStack(state);`)
            );
            expect(blocks[0].verdict).toBe("behavioural");
        });
    });

    describe("block bookkeeping", () => {
        it("records title, line and describe chain", () => {
            const source = src(`
                describe("lea/red", () => {
                    describe("Lightning Bolt", () => {
                        it("has the printed cost", () => {
                            expect(DEF.manaCost).toEqual({ red: 1 });
                        });
                    });
                });
            `);
            const blocks = classifyTestBlocks("lea/red.test.ts", source);
            expect(blocks).toHaveLength(1);
            expect(blocks[0]).toMatchObject({
                file: "lea/red.test.ts",
                title: "has the printed cost",
                describeChain: ["lea/red", "Lightning Bolt"],
                verdict: "identity",
            });
            expect(blocks[0].line).toBeGreaterThan(1);
        });

        it("handles it.each / it.skip / test aliases", () => {
            const source = src(`
                it.skip("skipped", () => { expect(DEF.power).toBe(1); });
                test("aliased", () => { expect(DEF.power).toBe(1); });
            `);
            const blocks = classifyTestBlocks("x.test.ts", source);
            expect(blocks.map((b) => b.verdict)).toEqual([
                "identity",
                "identity",
            ]);
        });
    });

    describe("the definition-read rule (issue #4489)", () => {
        const lines = (body: string) =>
            classifyTestBlocks(
                "x.test.ts",
                src(`const bolt = getDefinition("d573ef03-4730-45aa-93dd-e45ac1dbaf4a");
it("t", () => {
    const state = makeState();
${body}
});`)
            )[0];

        it("flags an expect(<cardDef>.field) line inside a behavioural block", () => {
            const b = lines(`    expect(bolt.manaCost).toEqual({ R: 1 });
    expect(state.players[1].life).toBe(20);`);
            expect(b.verdict).toBe("behavioural");
            expect(b.definitionReads).toEqual([5]);
        });

        it("follows neutral methods, an inline lookup, and a field alias", () => {
            const b =
                lines(`    expect(bolt.activatedAbilities.map((a) => a.id)).toEqual([]);
    expect(getCardByName("Serra Angel")!.power).toBe(4);
    const ab = bolt.activatedAbilities[0];
    expect(ab.cost).toBeDefined();`);
            expect(b.definitionReads).toEqual([5, 6, 8]);
        });

        it("does not flag the definition used as the EXPECTED value, or read whole", () => {
            const b =
                lines(`    expect(state.players[0].graveyard[0].definitionId).toBe(bolt.id);
    expect(bolt).toBeDefined();`);
            expect(b.definitionReads).toEqual([]);
        });

        it("treats an import from a card-set module as a definition", () => {
            const blocks = classifyTestBlocks(
                "x.test.ts",
                src(`import { giantGrowth } from "../../cards/sets/lea/green";
it("t", () => {
    const state = makeState();
    expect(giantGrowth.types).toContain("Instant");
});`)
            );
            expect(blocks[0].definitionReads).toEqual([5]);
        });

        it("reports nothing on an identity block — that one is flagged whole", () => {
            const b = classifyTestBlocks(
                "x.test.ts",
                src(`const DEF = { power: 1 };
it("t", () => { expect(DEF.power).toBe(1); });`)
            )[0];
            expect(b.verdict).toBe("identity");
            expect(b.definitionReads).toEqual([]);
        });
    });

    describe("the Op-only class (issue #4489)", () => {
        const BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
        const LIONS = "d05b92bd-797e-413f-a8b0-32e0937a1ee0";
        const facts = (
            owns: Record<string, string | null> = {},
            smokeRun: Record<string, boolean> = {}
        ): CardFacts => {
            const all: CardFact[] = [
                {
                    id: BOLT,
                    name: "Lightning Bolt",
                    ownsCode: null,
                    smokeRun: true,
                },
                {
                    id: LIONS,
                    name: "Savannah Lions",
                    ownsCode: null,
                    smokeRun: false,
                },
            ].map((f) => ({
                ...f,
                ownsCode: owns[f.name] ?? f.ownsCode,
                smokeRun: smokeRun[f.name] ?? f.smokeRun,
            }));
            return {
                byId: (id) => all.find((f) => f.id === id),
                byName: (name) => all.find((f) => f.name === name),
            };
        };
        const header = `const bolt = getDefinition("${BOLT}");
const lions = getDefinition("${LIONS}");
`;
        /** Classify one block (after the two definitions) against `facts`. */
        const opOnly = (
            body: string,
            cards: CardFacts = facts(),
            prelude = ""
        ) =>
            classifyTestBlocks(
                "x.test.ts",
                src(`${header}${prelude}it("t", () => {\n${body}\n});`),
                { cards }
            )[0].opOnly;

        /** The Lightning Bolt block from `lea/__tests__/red.test.ts`. */
        const BOLT_TO_FACE = `    const state = makeState();
    pushSpell(state, bolt.id, "p1", [{ type: "player", id: "p2" }]);
    resolveTopOfStack(state);
    expect(state.players[1].life).toBe(17);`;

        it("flags a block that only casts a pure-DSL card and asserts the Op's outcome", () => {
            expect(opOnly(BOLT_TO_FACE)).toEqual({
                kind: "op-only",
                cards: ["Lightning Bolt"],
            });
        });

        it("names every card the block touches, filler included", () => {
            const v =
                opOnly(`    const lion = makeInstance(lions.id, { id: "lion", controllerId: "p2" });
    const state = makeState({ players: [makePlayer("p1"), makePlayer("p2", { battlefield: [lion] })] });
    pushSpell(state, bolt.id, "p1", [{ type: "permanent", id: "lion" }]);
    resolveTopOfStack(state);
    checkStateBasedActions(state);
    expect(state.players[1].graveyard.map((c) => c.id)).toContain("lion");`);
            expect(v).toEqual({
                kind: "op-only",
                cards: ["Lightning Bolt", "Savannah Lions"],
            });
        });

        it("clears it when a named card owns code", () => {
            expect(
                opOnly(BOLT_TO_FACE, facts({ "Lightning Bolt": "resolve()" }))
            ).toMatchObject({ kind: "cleared", rule: "card-owns-code" });
        });

        it("clears a block naming a card the facts do not cover (a compiled card)", () => {
            expect(
                opOnly(`${BOLT_TO_FACE}
    const other = makeInstance("00000000-0000-4000-8000-000000000000", { id: "x" });
    expect(other.zone).toBe("battlefield");`)
            ).toMatchObject({ kind: "cleared", rule: "unknown-card" });
        });

        it("clears a block whose cards have no smoke-run script (an SBA test on a vanilla fixture)", () => {
            expect(
                opOnly(`    const lion = makeInstance(lions.id, { id: "lion", damageMarked: 2 });
    const state = makeState({ players: [makePlayer("p1", { battlefield: [lion] }), makePlayer("p2")] });
    resolveTopOfStack(state);
    expect(state.players[0].graveyard).toHaveLength(1);`)
            ).toMatchObject({ kind: "cleared", rule: "no-smoke-run-card" });
        });

        it("clears a block that never casts or resolves", () => {
            expect(
                opOnly(`    const lion = makeInstance(bolt.id, { id: "b" });
    const state = makeState({ players: [makePlayer("p1", { hand: [lion] }), makePlayer("p2")] });
    checkStateBasedActions(state);
    expect(state.players[0].hand).toHaveLength(1);`)
            ).toMatchObject({ kind: "cleared", rule: "no-cast-resolve" });
        });

        it("reads the TERMINAL field of an assertion, not any outcome name in it", () => {
            expect(
                opOnly(`    const state = makeState();
    pushSpell(state, bolt.id, "p1", []);
    resolveTopOfStack(state);
    expect(state.players[1].battlefield.find((c) => c.id === "x")?.controllerId).toBe("p1");`)
            ).toMatchObject({ kind: "cleared", rule: "non-outcome-assertion" });
            expect(
                opOnly(`    const state = makeState();
    pushSpell(state, bolt.id, "p1", []);
    resolveTopOfStack(state);
    expect(state.players[1].hand.length).toBe(0);
    expect(state.players[1].graveyard.map((c) => c.id)).toEqual([]);`)
            ).toMatchObject({ kind: "op-only" });
        });

        it("does not trust a vocabulary name aliased onto a foreign export", () => {
            const source =
                src(`${header}import { castWithCosts as pushSpell } from "../../gre/casting";
it("t", () => {\n${BOLT_TO_FACE}\n});`);
            expect(
                classifyTestBlocks("x.test.ts", source, { cards: facts() })[0]
                    .opOnly
            ).toMatchObject({ kind: "cleared", reason: "calls castWithCosts" });
        });

        it("does not trust a vocabulary name redeclared locally below its first use", () => {
            const source = src(`${header}it("t", () => {\n${BOLT_TO_FACE}\n});
function pushSpell(state, id) { collectTriggers(state); }`);
            expect(
                classifyTestBlocks("x.test.ts", source, { cards: facts() })[0]
                    .opOnly
            ).toMatchObject({
                kind: "cleared",
                reason: "calls collectTriggers",
            });
        });

        it("clears a block that names no catalogue card", () => {
            expect(
                opOnly(`    const state = makeState();
    resolveTopOfStack(state);
    expect(state.players[1].life).toBe(17);`)
            ).toMatchObject({ kind: "cleared", rule: "no-catalogue-card" });
        });

        it("clears a block that reaches card-owned code through a call outside the vocabulary", () => {
            expect(
                opOnly(`${BOLT_TO_FACE}
    expect(projectPublicState(state, "p1").players[1].life).toBe(17);`)
            ).toMatchObject({
                kind: "cleared",
                rule: "foreign-call",
                reason: "calls projectPublicState",
            });
        });

        it("clears a block that names card-owned code, even through a vocabulary call", () => {
            expect(
                opOnly(`    const state = makeState();
    pushSpell(state, bolt.id, "p1", [], { kicked: true });
    const kicker = 1;
    resolveTopOfStack(state);
    expect(state.players[1].life).toBe(17 - kicker);`)
            ).toMatchObject({ kind: "cleared", rule: "card-owned-name" });
        });

        it("clears a block asserting something other than an Op outcome", () => {
            expect(
                opOnly(`    const state = makeState();
    pushSpell(state, bolt.id, "p1", []);
    resolveTopOfStack(state);
    expect(state.stack).toHaveLength(0);`)
            ).toMatchObject({ kind: "cleared", rule: "non-outcome-assertion" });
        });

        it("clears a block reading a binding filled in by a beforeEach", () => {
            expect(
                opOnly(
                    `    pushSpell(state, bolt.id, "p1", []);
    resolveTopOfStack(state);
    expect(state.players[1].life).toBe(17);`,
                    facts(),
                    `let state;\nbeforeEach(() => { state = makeState(); });\n`
                )
            ).toMatchObject({ kind: "cleared", rule: "opaque-binding" });
        });

        it("sees through a file-local helper to the calls inside it", () => {
            const pure = `const cast = (id) => { const state = makeState(); pushSpell(state, id, "p1", []); resolveTopOfStack(state); return state; };\n`;
            const owned = `const cast = (id) => { const state = makeState(); pushSpell(state, id, "p1", []); resolveTopOfStack(state); collectTriggers(state); return state; };\n`;
            const body = `    expect(cast(bolt.id).players[1].life).toBe(17);`;
            expect(opOnly(body, facts(), pure)).toMatchObject({
                kind: "op-only",
            });
            expect(opOnly(body, facts(), owned)).toMatchObject({
                kind: "cleared",
                reason: "calls collectTriggers",
            });
        });

        it("sees through an imported test helper only when the caller can read it", () => {
            const source = src(`${header}import { cast } from "./helpers";
it("t", () => {
    expect(cast(bolt.id).players[1].life).toBe(17);
});`);
            const helpers = `export function cast(id) {
    const state = makeState();
    pushSpell(state, id, "p1", []);
    resolveTopOfStack(state);
    return state;
}`;
            const read = (from: string, spec: string) =>
                from === "x.test.ts" && spec === "./helpers"
                    ? helpers
                    : undefined;
            expect(
                classifyTestBlocks("x.test.ts", source, {
                    cards: facts(),
                    readImport: read,
                })[0].opOnly
            ).toEqual({ kind: "op-only", cards: ["Lightning Bolt"] });
            expect(
                classifyTestBlocks("x.test.ts", source, { cards: facts() })[0]
                    .opOnly
            ).toMatchObject({ kind: "cleared", rule: "no-cast-resolve" });
        });

        it("is not evaluated without CardFacts, nor on a non-behavioural block", () => {
            const source = src(`${header}it("t", () => {\n${BOLT_TO_FACE}\n});
it("identity", () => { expect(bolt.manaCost).toEqual({ R: 1 }); });`);
            expect(
                classifyTestBlocks("x.test.ts", source).map((b) => b.opOnly)
            ).toEqual([null, null]);
        });
    });

    describe("titles", () => {
        it("names a template-titled block by its template source, so loop-written blocks stay distinct", () => {
            const [b] = classifyTestBlocks(
                "x.test.ts",
                src(
                    "for (const n of NAMES) { it(`${n} is unique`, () => { expect(1).toBe(1); }); }"
                )
            );
            expect(b.title).toBe("${n} is unique");
        });
    });
});
