// The spell slot (issue #2699) — CR 113.3a instant and sorcery text.
//
// Three halves, and the third is the one that matters.
//
// The GRAMMAR half asserts what each of the four printed shapes reads and — at
// least as often — what it REFUSES: every refusal here is a card this compiler
// declines to misread, and the spell site is where a misread is least
// recoverable. An activated ability read half-right still costs mana to
// activate; a sorcery read half-right does the wrong thing once and is gone.
//
// The LOWERING half asserts the narrowing `lowerSpell.ts` performs, because the
// shared cost sub-grammar deliberately reads more cost atoms than
// `additionalCosts` and `FlashbackCost` can encode, and a dropped cost atom
// makes an unpayable spell castable.
//
// The BEHAVIOURAL half runs a compiled definition through the REAL registry
// seam and the REAL stack. A compiled spell that parses beautifully and
// resolves to nothing would pass both halves above; only pushing it and
// resolving it can tell the difference — the same argument
// `.claude/rules/gre-development.md` § Frontend wiring makes about hand-built
// views, one layer down.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";

/** Black Lotus (`sets/lea/colorless.ts`) — a real artifact for the board. */
const BLACK_LOTUS = "b0faa7f2-b547-42c4-a810-839da50dadfe";
import { resolveTopOfStack } from "../../gre/state";
import { compileCard } from "../compile";
import { groupLines } from "../grammar/lineGroups";
import { routeLine } from "../grammar/router";
import { spellSlot, SPELL_SLOT } from "../grammar/slots/spell";
import { oracleCard, parseContext } from "./fixtures";
import type { OracleCard, ParseContext } from "../types";

// ── Fixtures ───────────────────────────────────────────────────────────────

function spellCard(overrides: Partial<OracleCard> = {}): OracleCard {
    return oracleCard({
        name: "Test Spell",
        manaCost: "{1}{R}",
        typeLine: "Instant",
        power: undefined,
        toughness: undefined,
        ...overrides,
    });
}

function spellCtx(overrides: Partial<OracleCard> = {}): ParseContext {
    return parseContext(spellCard(overrides));
}

const instant = spellCtx();
const sorcery = spellCtx({ typeLine: "Sorcery" });
const creature = parseContext();

/** Compile a whole card and hand back the definition, or throw with the gaps. */
function compiled(card: OracleCard): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `expected a definition, got gaps: ${outcome.gaps
                .map((g) => `${g.fragment} — ${g.reason}`)
                .join(" | ")}`
        );
    return {
        ...(outcome.definition as CardDefinition),
        id: card.oracleId,
        rarity: "common",
    };
}

// ── 1. Plain spell text (CR 113.3a) ────────────────────────────────────────

describe("spell slot — plain spell text (CR 113.3a)", () => {
    it("lowers a targeted sentence onto the CARD, not into an ability", () => {
        const def = compiled(
            spellCard({ oracleText: "Destroy target artifact or enchantment." })
        );
        expect(def.effects).toEqual([{ op: "destroy", target: { target: 0 } }]);
        expect(def.targetRequirement).toEqual({
            type: ["Artifact", "Enchantment"],
            count: 1,
        });
        // The spell site is the card's own; nothing hangs off an ability.
        expect(def.activatedAbilities).toBeUndefined();
    });

    it("folds the CR 701.19c modifier onto the destroy it follows", () => {
        const def = compiled(
            spellCard({
                oracleText: "Destroy target creature. It can't be regenerated.",
            })
        );
        expect(def.effects).toEqual([
            { op: "destroy", target: { target: 0 }, cantBeRegenerated: true },
        ]);
    });

    it("is ALL-CONSUMING: an unread trailing clause fails the line", () => {
        // The competitor's largest documented misparse bucket, at this slot:
        // "Destroy target creature" is a prefix of the line below, and a rule
        // that matched the prefix would silently drop a delayed-trigger clause
        // that changes WHEN the destruction happens.
        const r = spellSlot.run(
            "Destroy target creature at the beginning of the next end step.",
            instant
        );
        expect(r.ok).toBe(false);
    });

    it("refuses spell text on a PERMANENT (CR 113.3a)", () => {
        // Without this guard the slot becomes the catch-all the router forbids
        // and every keyword-less permanent reads as spell text.
        const r = spellSlot.run("Draw a card.", creature);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/CR 113\.3a/);
    });

    it("refuses a CR 602.5 activation restriction — a spell is cast, not activated", () => {
        const r = spellSlot.run(
            "Draw a card. Activate only as a sorcery.",
            sorcery
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/CR 602\.5/);
    });

    it("is the ONLY slot that consumes the line (no ambiguity)", () => {
        const routed = routeLine("Destroy target land.", sorcery);
        expect(routed.ok).toBe(true);
        if (routed.ok) expect(routed.value.slot).toBe(SPELL_SLOT);
    });
});

// ── 2. Modal spell text (CR 700.2) ─────────────────────────────────────────

describe("spell slot — modal spells (CR 700.2)", () => {
    const MODAL =
        "Choose one —\n• Destroy target artifact.\n• Destroy target land.";

    it("groups the bullets onto the clause above them before routing", () => {
        const grouped = groupLines([
            "Choose one —",
            "• Destroy target artifact.",
            "• Destroy target land.",
        ]);
        expect(grouped.ok).toBe(true);
        if (grouped.ok) expect(grouped.lines).toEqual([MODAL]);
    });

    it("fails a bulleted line with no clause to attach to", () => {
        const grouped = groupLines(["• Destroy target artifact."]);
        expect(grouped.ok).toBe(false);
        if (!grouped.ok) expect(grouped.reason).toMatch(/CR 700\.2/);
    });

    it("gives every mode its OWN target requirement and its own slot 0", () => {
        const def = compiled(spellCard({ oracleText: MODAL }));
        expect(def.modes).toHaveLength(2);
        expect(def.modes?.[0]?.targetRequirement).toEqual({
            type: "Artifact",
            count: 1,
        });
        expect(def.modes?.[1]?.targetRequirement).toEqual({
            type: "Land",
            count: 1,
        });
        // CR 700.2c — each mode's script indexes its OWN requirement, so both
        // are `{ target: 0 }`; a shared counter would make the second mode
        // point at a requirement nothing declares.
        for (const mode of def.modes ?? [])
            expect(mode.effects).toEqual([
                { op: "destroy", target: { target: 0 } },
            ]);
        // CR 700.2 — the body lives on the modes, never beside them.
        expect(def.effects).toBeUndefined();
        expect(def.targetRequirement).toBeUndefined();
    });

    it("gives the modes distinct ids the engine can dispatch on", () => {
        const def = compiled(spellCard({ oracleText: MODAL }));
        const ids = (def.modes ?? []).map((m) => m.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("refuses every head whose ARITY is not exactly one (CR 700.2)", () => {
        // `CardDefinition.modes` is a choose-ONE shape and the engine locks a
        // single `chosenModeId` at announcement, so compiling these into it
        // would ship a spell that does half of what it says.
        for (const head of [
            "Choose one or both —",
            "Choose two —",
            "Choose one or more —",
        ]) {
            const line = `${head}\n• Destroy target artifact.\n• Destroy target land.`;
            expect(spellSlot.run(line, instant).ok).toBe(false);
        }
    });

    it("refuses a mode list with fewer than two modes", () => {
        const r = spellSlot.run(
            "Choose one —\n• Destroy target artifact.",
            instant
        );
        expect(r.ok).toBe(false);
    });

    it("refuses a mode the sentence grammar cannot read, rather than dropping it", () => {
        const r = spellSlot.run(
            "Choose one —\n• Destroy target artifact.\n• Untap all creatures you control.",
            instant
        );
        expect(r.ok).toBe(false);
    });
});

// ── 3. Additional costs (CR 601.2f / 118.8) ────────────────────────────────

describe("spell slot — additional costs (CR 601.2f)", () => {
    it("reads a sacrifice cost onto additionalCosts, not into the effects", () => {
        const def = compiled(
            spellCard({
                oracleText:
                    "As an additional cost to cast this spell, sacrifice a creature.\nDraw a card.",
            })
        );
        expect(def.additionalCosts).toEqual({
            sacrificeFilter: { types: ["Creature"] },
        });
        expect(def.effects).toEqual([
            { op: "draw", player: "controller", count: 1 },
        ]);
    });

    it("reads the discard and pay-life shapes", () => {
        expect(
            compiled(
                spellCard({
                    oracleText:
                        "As an additional cost to cast this spell, discard a card.\nDraw two cards.",
                })
            ).additionalCosts
        ).toEqual({ discard: { filter: {}, count: 1 } });
        expect(
            compiled(
                spellCard({
                    oracleText:
                        "As an additional cost to cast this spell, pay 3 life.\nDraw a card.",
                })
            ).additionalCosts
        ).toEqual({ payLife: 3 });
    });

    it("REFUSES a cost atom `additionalCosts` cannot encode", () => {
        // The grammar reads every atom an activation cost may carry (CR 118.1
        // draws no distinction); the card-level field carries far fewer. A
        // dropped cost atom makes an unpayable spell castable, so the atom with
        // nowhere to land fails the card. "Discard a card at random" is a
        // printed additional cost (3 corpus cards) with no field today.
        const outcome = compileCard(
            spellCard({
                oracleText:
                    "As an additional cost to cast this spell, discard a card at random.\nDraw a card.",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

// ── 4. Flashback (CR 702.34a) ──────────────────────────────────────────────

describe("spell slot — flashback (CR 702.34a)", () => {
    it("attaches a bare mana flashback cost", () => {
        const def = compiled(
            spellCard({
                typeLine: "Sorcery",
                oracleText:
                    "{self} deals 2 damage to any target.\nFlashback {4}{R}",
            })
        );
        expect(def.flashback).toEqual({ X: 4, R: 1 });
        expect(def.effects).toEqual([
            { op: "dealDamage", amount: 2, to: { target: 0 } },
        ]);
    });

    it("reads the em-dash form's non-mana component", () => {
        const def = compiled(
            spellCard({
                oracleText:
                    "{self} deals 1 damage to any target.\nFlashback—Sacrifice a Mountain.",
            })
        );
        expect(def.flashback).toEqual({
            sacrifice: { subtypes: ["Mountain"] },
        });
    });

    it("REFUSES a flashback component `FlashbackCost` cannot encode", () => {
        // Deep Analysis prints "Flashback—{1}{U}, Pay 3 life." and
        // `FlashbackCost` has no life field, so the cost cannot be paid at all.
        const r = spellSlot.run("Flashback—{1}{U}, Pay 3 life.", sorcery);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/pay-life/);
    });
});

// ── 5. X (CR 107.3) ────────────────────────────────────────────────────────

describe("spell slot — X is gated by the printed cost (CR 107.3)", () => {
    it("lowers X when the card's own mana cost has an {X} pip", () => {
        const def = compiled(
            spellCard({
                manaCost: "{X}{R}",
                typeLine: "Sorcery",
                oracleText: "{self} deals X damage to any target.",
            })
        );
        expect(def.effects).toEqual([
            { op: "dealDamage", amount: { X: true }, to: { target: 0 } },
        ]);
    });

    it("REFUSES X when there is no {X} to announce", () => {
        // The failure this gate exists to prevent is silent: an X folded to a
        // number would be a card that resolves and does nothing. Sickening
        // Dreams announces its X through an additional cost, not a pip.
        const outcome = compileCard(
            spellCard({
                manaCost: "{1}{B}{B}",
                typeLine: "Sorcery",
                oracleText: "{self} deals X damage to any target.",
            })
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state === "unparsed")
            expect(outcome.gaps[0]?.reason).toMatch(/CR 107\.3/);
    });
});

// ── 6. Behaviour: the compiled definition actually resolves ────────────────

describe("spell slot — a compiled spell resolves through the real stack", () => {
    it("destroys the announced target (CR 701.8a)", () => {
        const def = compiled(
            spellCard({
                oracleId: "11111111-1111-1111-1111-111111111111",
                name: "Compiled Shatter",
                oracleText: "Destroy target artifact.",
            })
        );
        withTemporaryDefinition(def, () => {
            const victim = makeInstance(BLACK_LOTUS, {
                id: "victim",
                controllerId: "p2",
                ownerId: "p2",
            });
            const state = makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", { battlefield: [victim] }),
                ],
            });
            pushSpell(state, def.id, "p1", [
                { type: "permanent", id: "victim" },
            ]);
            resolveTopOfStack(state);
            expect(
                state.players[1]!.battlefield.map((c) => c.id)
            ).not.toContain("victim");
            expect(state.players[1]!.graveyard.map((c) => c.id)).toContain(
                "victim"
            );
        });
    });

    it("draws for the controller with no target announced (CR 121.1)", () => {
        const def = compiled(
            spellCard({
                oracleId: "22222222-2222-2222-2222-222222222222",
                name: "Compiled Ancestral",
                typeLine: "Sorcery",
                oracleText: "Draw two cards.",
            })
        );
        withTemporaryDefinition(def, () => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        library: [
                            makeInstance(BLACK_LOTUS, {
                                id: "l1",
                                ownerId: "p1",
                                zone: "library",
                            }),
                            makeInstance(BLACK_LOTUS, {
                                id: "l2",
                                ownerId: "p1",
                                zone: "library",
                            }),
                        ],
                    }),
                    makePlayer("p2"),
                ],
            });
            pushSpell(state, def.id, "p1");
            resolveTopOfStack(state);
            expect(state.players[0]!.hand.map((c) => c.id)).toEqual([
                "l1",
                "l2",
            ]);
        });
    });
});
