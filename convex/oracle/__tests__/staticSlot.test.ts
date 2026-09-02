// The static slot (issue #2700) — CR 113.3d continuous static abilities
// written as sentences rather than as keywords.
//
// Two halves, and the second is the one that matters. The grammar half asserts
// what each frame reads and — at least as often — what it REFUSES, because
// every refusal here is a card this compiler declines to misread. The
// behavioural half runs the compiled definition through the REAL registry seam
// and the REAL layer system, so an anthem that parses beautifully and buffs
// nobody cannot pass: `.claude/rules/gre-development.md` § Frontend wiring is
// explicit that a `staticEffects[]` claim owes a wire assertion traversing
// `projectPublicState`, not a hand-built view.

import { describe, expect, it } from "vitest";
import {
    resolveCompiledStatic,
    type CompiledStaticEffect,
} from "../../cards/compiledStatics";
import { withTemporaryDefinition } from "../../cards/registry";
import type {
    CardDefinition,
    PermanentView,
    StaticEffectContext,
} from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";
import { getEffectivePower, getEffectiveToughness } from "../../gre/layers";
import { compileCard } from "../compile";
import { routeLine } from "../grammar/router";
import { staticSlot, STATIC_SLOT } from "../grammar/slots/staticSlot";
import type { OracleCard, ParseContext } from "../types";
import { SELF_MARKER } from "../normalize";

// ── Fixtures ───────────────────────────────────────────────────────────────

const ctx: ParseContext = {
    card: {
        oracleId: "x",
        name: "Test",
        manaCost: "",
        typeLine: "Enchantment",
        oracleText: "",
    },
    typeLine: { types: ["Enchantment"], supertypes: [], subtypes: [] },
    selfMarker: SELF_MARKER,
};

function clause(line: string): unknown {
    const parsed = staticSlot.run(line, ctx);
    expect(parsed.ok, `expected "${line}" to parse`).toBe(true);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.value.kind).toBe("static");
    if (parsed.value.kind !== "static") throw new Error("wrong IR kind");
    return parsed.value.clause;
}

function refusal(line: string): string {
    const parsed = staticSlot.run(line, ctx);
    expect(parsed.ok, `expected "${line}" to be REFUSED`).toBe(false);
    return parsed.ok ? "" : parsed.reason;
}

function oracle(
    over: Partial<OracleCard> & { oracleText: string }
): OracleCard {
    return {
        oracleId: "test",
        name: "Test Card",
        manaCost: "{2}",
        typeLine: "Enchantment",
        ...over,
    };
}

/** The compiled definition, or a thrown reason — never a half-read card. */
function compiled(card: OracleCard): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed") {
        throw new Error(
            `unparsed: ${outcome.gaps.map((g) => g.reason).join("; ")}`
        );
    }
    return { ...outcome.definition, id: card.oracleId, rarity: "common" };
}

// ── Frame: anthem / lord (CR 613.1e, layer 7c) ─────────────────────────────

describe("anthem and lord (CR 613.1e)", () => {
    it("reads a colour anthem into a layer-7c buff", () => {
        expect(clause("White creatures get +1/+1.")).toEqual({
            kind: "pt-buff",
            filter: { types: ["Creature"], colors: ["W"] },
            power: 1,
            toughness: 1,
        });
    });

    it("reads a controller-scoped anthem (CR 109.5 — 'you')", () => {
        expect(clause("Creatures you control get +2/+0.")).toEqual({
            kind: "pt-buff",
            filter: { types: ["Creature"], controllerRelation: "you" },
            power: 2,
            toughness: 0,
        });
    });

    it("supplies the card type a bare subtype implies (CR 205.3m)", () => {
        // The catalogue's tribal lords all open `applies` with
        // `ctx.isCreature(target)` before looking at the subtype; the filter
        // has to say the same thing or the two encodings differ.
        expect(clause("Goblins you control get +1/+1.")).toEqual({
            kind: "pt-buff",
            filter: {
                types: ["Creature"],
                subtypes: ["Goblin"],
                controllerRelation: "you",
            },
            power: 1,
            toughness: 1,
        });
    });

    it("reads a penalty anthem (a negative modifier is not a special case)", () => {
        expect(clause("All creatures get -1/-1.")).toEqual({
            kind: "pt-buff",
            filter: { types: ["Creature"] },
            power: -1,
            toughness: -1,
        });
    });

    it("strips a leading 'All' and nothing else (CR 109.1)", () => {
        // "All creatures" and "Creatures" describe the same set, so the two
        // must produce the SAME filter — a difference would mean the word was
        // read as a qualifier it is not.
        expect(clause("All creatures get +1/+1.")).toEqual(
            clause("Creatures get +1/+1.")
        );
    });

    it("REFUSES a singular subject — the sentence it would half-read", () => {
        // "Enchanted creature gets +1/+1." is attached-scope (CR 303.4), which
        // this grammar does not encode. Accepting it as a board-wide anthem
        // would buff every creature in play.
        expect(refusal("Enchanted creature gets +1/+1.")).toBeTruthy();
        expect(refusal("Equipped creature gets +2/+0.")).toBeTruthy();
        expect(refusal("This creature gets +1/+1.")).toBeTruthy();
    });

    it("REFUSES an 'as long as' clause rather than dropping it (CR 611.2c)", () => {
        // The dropped-condition misparse: the buff would apply unconditionally.
        expect(
            refusal(
                "Creatures you control get +1/+1 as long as you control a Plains."
            )
        ).toBeTruthy();
    });

    it("REFUSES a filter the predicate could not evaluate", () => {
        // A `PermanentView` carries no `staticAbilities`, so a `requireAbility`
        // filter would match NOTHING at run time — silently, and the symptom
        // (an anthem that buffs nobody) is indistinguishable from an anthem
        // nobody looked at. Refused at lowering instead.
        expect(refusal("Creatures with flying get +1/+1.")).toContain(
            "not expressible"
        );
    });
});

// ── Frame: keyword grant (CR 613.1f, layer 6) ──────────────────────────────

describe("keyword grant (CR 613.1f)", () => {
    it("reads a tribal keyword grant", () => {
        expect(clause("Goblins you control have haste.")).toEqual({
            kind: "keyword-grant",
            filter: {
                types: ["Creature"],
                subtypes: ["Goblin"],
                controllerRelation: "you",
            },
            keyword: {
                registryId: "haste",
                ability: "haste",
                status: "implemented",
            },
        });
    });

    it("REFUSES a word the Mechanics Registry does not carry", () => {
        // The registry is the single name authority (CLAUDE.md § Card
        // Definition System); an invented keyword would ship an inert grant.
        expect(refusal("Goblins you control have moxie.")).toBeTruthy();
    });

    it("REFUSES a parameterised keyword rather than dropping its parameter", () => {
        expect(
            refusal("Creatures you control have protection from red.")
        ).toBeTruthy();
    });
});

// ── Frame: cost modifier (CR 601.2f) ───────────────────────────────────────

describe("cost modifier (CR 601.2f)", () => {
    it("reads a board-wide tax", () => {
        expect(clause("Spells cost {1} more to cast.")).toEqual({
            kind: "cost-modifier",
            spells: {},
            direction: "more",
            amount: 1,
        });
    });

    it("reads a typed, controller-scoped discount", () => {
        expect(clause("Goblin spells you cast cost {1} less to cast.")).toEqual(
            {
                kind: "cost-modifier",
                spells: { subtypes: ["Goblin"], controller: "you" },
                direction: "less",
                amount: 1,
            }
        );
    });

    it("reads an opponent-scoped tax", () => {
        expect(
            clause("Spells your opponents cast cost {2} more to cast.")
        ).toEqual({
            kind: "cost-modifier",
            spells: { controller: "opponents" },
            direction: "more",
            amount: 2,
        });
    });

    it("REFUSES a spell class it has no vocabulary for", () => {
        expect(
            refusal("Kicked spells you cast cost {1} less to cast.")
        ).toBeTruthy();
    });
});

// ── Frame: entry riders (CR 614.1c / 121.6) ────────────────────────────────

describe("entry riders (CR 614.1c)", () => {
    it("reads the bare enters-tapped line", () => {
        expect(clause("This land enters tapped.")).toEqual({
            kind: "enters-tapped",
        });
    });

    it("reads the counters clause instead of dropping it (CR 121.6)", () => {
        // The prefix-match defect in its most concrete form: a rule with an
        // optional tail would return the bare reading above for this line, and
        // Hickory Woodlot would enter with no depletion counters at all.
        expect(
            clause("This land enters tapped with two depletion counters on it.")
        ).toEqual({
            kind: "enters-tapped",
            counters: { type: "depletion", count: 2 },
        });
    });

    it("REFUSES an enters-tapped line about another permanent (CR 109.2)", () => {
        expect(
            refusal("Lands your opponents control enter tapped.")
        ).toBeTruthy();
    });
});

// ── Frame: the untap marker (CR 502.1) ─────────────────────────────────────

describe("untap-step marker (CR 502.1)", () => {
    it("reads the self-scoped line", () => {
        expect(
            clause("This artifact doesn't untap during your untap step.")
        ).toEqual({ kind: "does-not-untap" });
    });

    it("REFUSES the host-scoped line — a different sentence", () => {
        // "during ITS CONTROLLER's untap step" is what an Aura says about the
        // permanent it enchants; the marker means the source's own step.
        expect(
            refusal(
                "Enchanted creature doesn't untap during its controller's untap step."
            )
        ).toBeTruthy();
    });
});

// ── The slot's contract in the router ──────────────────────────────────────

describe("the static slot in the router", () => {
    it("is the unique consumer of every frame it reads", () => {
        for (const line of [
            "White creatures get +1/+1.",
            "Goblins you control have haste.",
            "Spells cost {1} more to cast.",
            "This land enters tapped.",
            "This artifact doesn't untap during your untap step.",
        ]) {
            const routed = routeLine(line, ctx);
            expect(
                routed.ok,
                `${line}: ${routed.ok ? "" : routed.reason}`
            ).toBe(true);
            if (routed.ok) expect(routed.value.slot).toBe(STATIC_SLOT);
        }
    });

    it("does not shadow a bare keyword line", () => {
        const routed = routeLine("Flying", ctx);
        expect(routed.ok).toBe(true);
        if (routed.ok) expect(routed.value.slot).toBe("keyword-line");
    });
});

// ── Lowering: the definition the compiler emits ────────────────────────────

describe("lowering", () => {
    it("emits an anthem as a JSON descriptor, never a closure", () => {
        const definition = compiled(
            oracle({ oracleText: "White creatures get +1/+1." })
        );
        expect(definition.compiledStaticEffects).toEqual([
            {
                kind: "pt-buff",
                filter: { types: ["Creature"], colors: ["W"] },
                power: 1,
                toughness: 1,
            },
        ]);
        expect(definition.staticEffects).toBeUndefined();
        // The lockfile invariant: what the compiler emits IS its own JSON.
        expect(JSON.parse(JSON.stringify(definition))).toEqual(definition);
    });

    it("emits entry riders as CR 614.1c fields, not as a continuous effect", () => {
        const definition = compiled(
            oracle({
                name: "Hickory Woodlot",
                manaCost: "",
                typeLine: "Land",
                oracleText:
                    "Hickory Woodlot enters tapped with two depletion counters on it.",
            })
        );
        expect(definition.entersTapped).toBe(true);
        expect(definition.entersWith).toEqual({
            counters: [{ type: "depletion", count: 2 }],
        });
        expect(definition.compiledStaticEffects).toBeUndefined();
    });

    it("emits the untap marker as a static ability string", () => {
        const definition = compiled(
            oracle({
                typeLine: "Artifact",
                oracleText:
                    "This artifact doesn't untap during your untap step.",
            })
        );
        expect(definition.staticAbilities).toEqual(["does-not-untap"]);
    });

    it("QUARANTINES a grant of a keyword the engine has not implemented", () => {
        // CR 702.1 — a granted keyword is censused exactly like a printed one.
        // Without this the card would ship `ready` with a grant that does
        // nothing, which is the Guard A shape (#962) one level removed.
        const outcome = compileCard(
            oracle({ oracleText: "Creatures you control have intimidate." })
        );
        expect(outcome.state).toBe("quarantine");
        if (outcome.state !== "quarantine") return;
        expect(outcome.reasons.map((r) => r.kind)).toContain(
            "planned-mechanic"
        );
    });
});

// ── Behaviour: the compiled card in the real engine ────────────────────────

const CRUSADE_ID = "compiled-crusade-2700";
const LION_ID = "compiled-lion-2700";
const BEAR_ID = "compiled-bear-2700";

/** A vanilla creature, compiled from its own type line — no grammar involved. */
function vanilla(id: string, name: string, cost: string): CardDefinition {
    return {
        ...compiled({
            oracleId: id,
            name,
            manaCost: cost,
            typeLine: "Creature — Cat",
            oracleText: "",
            power: "2",
            toughness: "1",
        }),
        id,
    };
}

describe("a compiled anthem in the layer system (CR 613.1e)", () => {
    const crusade = {
        ...compiled(
            oracle({
                oracleId: CRUSADE_ID,
                name: "Compiled Crusade",
                manaCost: "{W}{W}",
                oracleText: "White creatures get +1/+1.",
            })
        ),
        id: CRUSADE_ID,
    };
    const lion = vanilla(LION_ID, "Compiled Lion", "{W}");
    const bear = vanilla(BEAR_ID, "Compiled Bear", "{G}");

    function withCards<T>(fn: () => T): T {
        return withTemporaryDefinition(crusade, () =>
            withTemporaryDefinition(lion, () =>
                withTemporaryDefinition(bear, fn)
            )
        );
    }

    it("buffs a matching creature and leaves a non-matching one alone", () => {
        withCards(() => {
            const white = makeInstance(LION_ID, { id: "white" });
            const green = makeInstance(BEAR_ID, { id: "green" });
            const source = makeInstance(CRUSADE_ID, { id: "anthem" });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [white, green, source],
                    }),
                    makePlayer("p2"),
                ],
            });
            expect(getEffectivePower(state, white)).toBe(3);
            expect(getEffectiveToughness(state, white)).toBe(2);
            // The negative half is the one that fails when a filter is dropped.
            expect(getEffectivePower(state, green)).toBe(2);
            expect(getEffectiveToughness(state, green)).toBe(1);
        });
    });

    it("wire format: the buff survives projectPublicState", () => {
        withCards(() => {
            const white = makeInstance(LION_ID, { id: "white" });
            const source = makeInstance(CRUSADE_ID, { id: "anthem" });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [white, source] }),
                    makePlayer("p2"),
                ],
            });
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0]?.battlefield.find(
                (c) => c.id === "white"
            );
            expect(slim).toBeDefined();
            expect(getEffectivePower(projected, slim!)).toBe(3);
        });
    });
});

// ── The descriptors' predicates, in isolation ──────────────────────────────

describe("resolveCompiledStatic (cards/compiledStatics.ts)", () => {
    const context: StaticEffectContext = {
        getColors: (card) => (card.subtypes.includes("Goblin") ? ["R"] : []),
        isCreature: (card) => card.types.includes("Creature"),
        hasSubtype: (card, subtype) => card.subtypes.includes(subtype),
        hasSupertype: () => false,
        getManaValue: () => 0,
        getPrintedTypes: (card) => [...card.types],
        getName: () => "",
        getCounterCount: () => 0,
    };

    function view(
        over: Partial<PermanentView> & { id: string }
    ): PermanentView {
        return {
            controllerId: "p1",
            ownerId: "p1",
            types: ["Creature"],
            subtypes: [],
            isTapped: false,
            card: {},
            ...over,
        };
    }

    const grant: CompiledStaticEffect = {
        kind: "keyword-grant",
        filter: {
            types: ["Creature"],
            subtypes: ["Goblin"],
            controllerRelation: "you",
        },
        keyword: "haste",
    };

    it("scopes 'you control' to the SOURCE's controller (CR 109.5)", () => {
        const resolved = resolveCompiledStatic(grant);
        expect(resolved.kind).toBe("keyword-grant");
        if (resolved.kind !== "keyword-grant") return;
        const source = view({ id: "warchief", subtypes: ["Goblin"] });
        const mine = view({ id: "mine", subtypes: ["Goblin"] });
        const theirs = view({
            id: "theirs",
            subtypes: ["Goblin"],
            controllerId: "p2",
        });
        const notAGoblin = view({ id: "elf", subtypes: ["Elf"] });
        expect(resolved.applies(mine, source, context)).toBe(true);
        expect(resolved.applies(theirs, source, context)).toBe(false);
        expect(resolved.applies(notAGoblin, source, context)).toBe(false);
        // A lord grants to ITSELF when it matches its own filter (CR 611.2).
        expect(resolved.applies(source, source, context)).toBe(true);
    });

    it("fails CLOSED on a controller-scoped cost modifier with no source", () => {
        const resolved = resolveCompiledStatic({
            kind: "cost-modifier",
            spells: { subtypes: ["Goblin"], controller: "you" },
            reduction: 1,
        });
        expect(resolved.kind).toBe("cost-modifier");
        if (resolved.kind !== "cost-modifier") return;
        const spell = view({ id: "spell", subtypes: ["Goblin"] });
        const source = view({ id: "warchief" });
        expect(resolved.appliesToSpell?.(spell, context, source)).toBe(true);
        // No source ⇒ no "you" ⇒ no discount. The other direction would hand
        // every player the discount.
        expect(resolved.appliesToSpell?.(spell, context, undefined)).toBe(
            false
        );
        expect(
            resolved.appliesToSpell?.(
                view({ id: "spell", subtypes: ["Goblin"], controllerId: "p2" }),
                context,
                source
            )
        ).toBe(false);
    });

    it("reduces only the generic portion of a cost (CR 601.2f)", () => {
        const resolved = resolveCompiledStatic({
            kind: "cost-modifier",
            spells: {},
            reduction: 2,
        });
        if (resolved.kind !== "cost-modifier") throw new Error("wrong kind");
        expect(resolved.costReduction).toEqual({ X: 2 });
        expect(resolved.costIncrease).toBeUndefined();
    });
});
