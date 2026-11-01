// mh2 — white cards (ADR 0043 colour split).
import { defineCard, PERMANENT_TYPES, type SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { evokeTrigger } from "../../abilities/evoke";

// Prismatic Ending — {X}{W} Sorcery (MH2 uncommon). "Converge — Exile target
// nonland permanent if its mana value is less than or equal to the number of
// colors of mana spent to cast this spell." Converge is an ability word (CR
// 207.2c, no rules meaning of its own): `noteManaSpent: true` records the mana
// paid, `{ colorsSpentToCast: true }` folds it to a distinct-colour count (CR
// 105.1, colorless never counts). The mana-value gate is resolution-time (the
// target is legal regardless), so an `if` over the target's `manaValue`
// (issue #7211). A copy reads 0 colours (CR 707.10).
// hand-tail: nonland permanent if its mana value is less than or equal to the number of colors of mana spent to cast this spell (#7246)
export const prismaticEnding = defineCard(() => ({
    id: "825969b9-3c70-4fca-8cab-696e9ca7cdb2",
    rarity: "uncommon",
    name: "Prismatic Ending",
    oracleText:
        "Converge — Exile target nonland permanent if its mana value is less than or equal to the number of colors of mana spent to cast this spell.",
    manaCost: { X: "X", W: 1 },
    types: ["Sorcery"],
    noteManaSpent: true,
    targetRequirement: {
        type: [...PERMANENT_TYPES],
        count: 1,
        excludeTypes: "Land",
    },
    effects: [
        {
            op: "if",
            predicate: {
                left: { manaValue: { of: { target: 0 } } },
                op: "le",
                right: { colorsSpentToCast: true },
            },
            then: [{ op: "exile", target: { target: 0 } }],
        },
    ],
}));

// Solitude — {3}{W}{W} Creature Elemental Incarnation, 3/2 (Vintage Cube,
// issue #900). "Flash. Lifelink. When this creature enters, exile up to one
// other target creature. That creature's controller gains life equal to its
// power. Evoke—Exile a white card from your hand." CR 702.74 Evoke: the alt
// cast is a pure HAND leg (`evoke`, reusing `AlternativeCost`'s `handCost`
// shape — no new plumbing), and the sacrifice-on-ETB half is `evokeTrigger`
// (convex/cards/abilities/evoke.ts).
//
// TARGETING (CR 603.3d, issue #1193): "exile up to one OTHER target creature"
// is a REAL target chosen when the ETB trigger is put on the stack — declared
// as a `targetRequirement` on the TriggeredAbility (`raiseTriggerTargetSelection`
// in gre/rules.ts), NOT a resolution-time `requestChoice`. That makes it subject
// to hexproof / protection / ward and fires "becomes the target of an ability"
// triggers, which the old choice-as-target workaround silently skipped.
// `type: "Creature"` picks across BOTH battlefields ("target creature", no
// controller restriction); `excludeSource` drops Solitude itself ("other");
// `count 0..1` = "up to one". The resolve() then reads the announced slot via
// `ctx.targets[0]`; life gain reads the target's power BEFORE exile (CR 613
// last-known information).
export const solitude = defineCard(() => ({
    id: "47a6234f-309f-4e03-9263-66da48b57153",
    rarity: "mythic",
    name: "Solitude",
    oracleText:
        "Flash\nLifelink\nWhen this creature enters, exile up to one other target creature. That creature's controller gains life equal to its power.\nEvoke—Exile a white card from your hand.",
    manaCost: { X: 3, W: 2 },
    types: ["Creature"],
    subtypes: ["Elemental", "Incarnation"],
    power: 3,
    toughness: 2,
    staticAbilities: ["flash", "lifelink"],
    evoke: {
        id: "evoke",
        description: "Evoke—Exile a white card from your hand",
        hand: {
            action: "exile",
            requirements: [{ filter: { color: "W" }, count: 1 }],
        },
    },
    triggeredAbilities: [
        enteredTrigger({
            id: "solitude-etb",
            oracleText:
                "When this creature enters, exile up to one other target creature. That creature's controller gains life equal to its power.",
            scope: "self",
            // CR 603.3d — "up to one OTHER target creature": a real target
            // chosen when the trigger is put on the stack (see module comment).
            // `excludeSource` drops Solitude herself ("other"); `count 0..1` =
            // "up to one". Any controller's creature is eligible.
            targetRequirement: {
                type: "Creature",
                count: { min: 0, max: 1 },
                excludeSource: true,
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return; // "up to one": none chosen / CR 608.2b none legal
                const power = ctx.getPower(target);
                const controllerId = ctx.getController(target);
                ctx.exile(target);
                ctx.gainLife(controllerId, Math.max(0, power));
            },
        }),
        evokeTrigger("Solitude"),
    ],
}));

export {};
