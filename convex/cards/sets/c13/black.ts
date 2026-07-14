// c13 — black cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).
import type { CardDefinition } from "../../types";

// Toxic Deluge — {2}{B} Sorcery. "As an additional cost to cast this spell,
// pay X life. All creatures get -X/-X until end of turn." (CR 118.4 pay-X-life
// additional cost — already shipped via `additionalCosts.payXLife`, Fire
// Covenant; CR 611.2 temporary P/T reduction — the `pump` Op, forEach/battlefield
// sweep idiom already shipped, Pyroclasm-style; CR 611.2 negative amount now
// expressible via the `negate`-wrapped chosen-cost X, issue #926.) SHIPPED
// (issue #926) — the forEach sweep has NO `controller` (every player's
// battlefield, since the effect is "ALL creatures", not "creatures you
// control"); `power`/`toughness` are `{ negate: { X: true } }`, the SIGNED
// value grammar's negation of the chosen-cost X (CR 107.3 / 601.2b) —
// unblocked by #926's `EffectSignedValue`/`EffectNegatedValue` grammar
// extension (`convex/cards/types.ts`). Reuses only already-exercised
// constructs (forEach/pump/X/negate all carry their own interpreter tests —
// `convex/gre/effects/__tests__/interpreter.test.ts`), so this card earns no
// hand-written GRE test per the per-Op regime EXCEPT that the catalogue's
// auto-generated smoke test cannot faithfully scenario-ize a `pump` whose
// power/toughness are not a plain number literal (an explicit, documented
// skip — `convex/gre/effects/scenarioGenerator.ts`), so a hand-written test
// lives in `convex/cards/sets/c13/__tests__/black.test.ts` per the "explicit
// skip is the signal to add one" rule.
export const toxicDeluge: CardDefinition = {
    id: "564caf57-4ba5-4993-a35e-945699c94eb7",
    name: "Toxic Deluge",
    rarity: "rare",
    oracleText:
        "As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn.",
    manaCost: { X: 2, B: 1 },
    types: ["Sorcery"],
    additionalCosts: { payXLife: true },
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature" },
            },
            effects: [
                {
                    op: "pump",
                    target: { ref: "$each" },
                    power: { negate: { X: true } },
                    toughness: { negate: { X: true } },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
