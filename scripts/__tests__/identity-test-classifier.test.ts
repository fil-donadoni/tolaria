import { describe, it, expect } from "vitest";
import {
    classifyTestBlocks,
    findIdentityBlocks,
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
});
