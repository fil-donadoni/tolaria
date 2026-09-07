// MMQ — black cards, split by colour per ADR 0043. The registry's
// `import * as mmq from "./sets/mmq"` resolves through mmq/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition, SpellContext } from "../../types";
import { CREATURE_SUBTYPES } from "../../../oracle/grammar/shared/subtypes";

// Snuff Out — {3}{B} Instant. "If you control a Swamp, you may pay 4 life rather
// than pay this spell's mana cost. Destroy target nonblack creature. It can't be
// regenerated." (CR 118.9 alternative pitch cost — a pay-life leg gated on a
// control condition; CR 119.4 pay life; CR 701.8 destroy; CR 701.19c
// regeneration suppression; CR 202.2 colour restriction.)
//
// The alternative cost is a censusless CR 118.9 rules concept (no keyword name):
// a `payLife: 4` leg with a `condition: control a Swamp`. The colour gate on the
// target rides `excludeColors` on the TargetRequirement. The "can't be
// regenerated" rider is not expressible as a declarative Op (it is a
// destroy-time flag on the primitive), so — matching the shipped Dark Banishing
// / Terror pattern (ice/black.ts, lea/black.ts) — the effect stays `resolve()`.
// protocol card: `ctx.destroy(target, { cantBeRegenerated: true })` has no
// Effect Script Op (the destroy Op carries no regeneration-suppression flag).
export const snuffOut: CardDefinition = {
    id: "18a3cca1-e50e-49b6-9e1a-f86640e3b177", // MMQ 162
    rarity: "common",
    name: "Snuff Out",
    oracleText:
        "If you control a Swamp, you may pay 4 life rather than pay this spell's mana cost.\nDestroy target nonblack creature. It can't be regenerated.",
    manaCost: { X: 3, B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1, excludeColors: "B" },
    alternativeCosts: [
        {
            id: "pitch-pay-4-life",
            description: "Pay 4 life",
            life: 4,
            condition: { kind: "control", filter: { subtypes: "Swamp" } },
        },
    ],
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target) ctx.destroy(target, { cantBeRegenerated: true });
    },
};

// Conspiracy — {3}{B}{B} Enchantment. "As this enchantment enters, choose a
// creature type. Creatures you control are the chosen type. The same is true
// for creature spells you control and creature cards you own that aren't on
// the battlefield." (MMQ is the earliest paper printing, ADR 0041 — the card
// is better known from its Time Spiral timeshifted reprint.)
//
// CR 614.1c / 614.12a — "as this enchantment enters, choose …" is a
// self-replacement applied BEFORE the permanent enters, so it is
// `entersWith.asEnters`'s `subtypes` kind (the shape Illusionary Terrain,
// `sets/ice/blue.ts`, established), never a `PERMANENT_ENTERED` trigger: a
// trigger would go on the stack and let priority pass with the type not yet
// chosen. The answer lands on `CardInstanceState.chosenSubtypes`.
//
// The option list is CR 205.3m's own creature-type table, imported from the
// single place this repo transcribes it (`oracle/grammar/shared/subtypes.ts`,
// re-derived from the vendored Comprehensive Rules by
// `scripts/__tests__/oracle-subtypes.test.ts`, so a `bun run cr:sync` that
// brings in a new creature type reds the gate instead of silently leaving it
// unpickable). A local copy would rot the day Wizards prints a new type.
//
// CR 205.1b / 613.1d layer 4 — "are the chosen type" REPLACES the creature
// types rather than adding to them, so this is the `subtype-set` kind in its
// computed-output `subtypesFor` form, reading the chosen type off the source
// instance exactly as Illusionary Terrain reads its chosen pair. Returning
// null leaves a target untouched: before the choice is answered, for every
// noncreature, and for every creature its controller does not control.
//
// Two clauses this card ships without and one marker covers them: the CR 205.1b
// creature-type family narrowing is not modelled (tracked-by: #3162), so a LAND
// creature (Dryad Arbor) routes through the shipped CR 305.7 land branch and
// keeps its creature type while losing its land type; and the third sentence —
// creature spells and creature cards outside the battlefield — is inert,
// because the layer 2-5 derivation walks battlefields and the command zone only.
//
// CR 613.8b (issue #2068) — this card's layer-4 effect and Life and Limb's are
// mutually dependent (each changes what the other applies to), so they form the
// dependency LOOP the rule's last sentence exists for and are applied in
// timestamp order relative to each other. That order is now a decision the
// dependency system reaches, not the only thing the engine could do.
// compiler-gap: As this enchantment enters, choose a creature type. (#2693)
// compiler-gap: Creatures you control are the chosen type. The same is true for creature spells you control and creature cards you own that aren't on the battlefield. (#2693)
export const conspiracy: CardDefinition = {
    id: "411c9f22-2df0-4a63-b2be-fa02612a6ef8",
    rarity: "rare",
    name: "Conspiracy",
    oracleText:
        "As this enchantment enters, choose a creature type.\nCreatures you control are the chosen type. The same is true for creature spells you control and creature cards you own that aren't on the battlefield.",
    manaCost: { X: 3, B: 2 },
    types: ["Enchantment"],
    entersWith: {
        asEnters: [
            { kind: "subtypes", from: [...CREATURE_SUBTYPES], count: 1 },
        ],
    },
    staticEffects: [
        {
            kind: "subtype-set",
            // CR 613.8a clause (b) — reads whether the target is a CREATURE,
            // a card type, and never its subtypes. Life and Limb's `type-add`
            // writes card types, so this effect waits for it; this effect
            // writes the subtypes Life and Limb's own predicate reads, so that
            // one waits for this. Mutual: CR 613.8b's dependency loop, resolved
            // back to timestamp order.
            reads: ["types"],
            subtypesFor: (target, source, ctx) => {
                const chosen = source.chosenSubtypes?.[0];
                if (chosen === undefined) return null;
                if (!ctx.isCreature(target)) return null;
                if (target.controllerId !== source.controllerId) return null;
                return [chosen];
            },
        },
    ],
};
