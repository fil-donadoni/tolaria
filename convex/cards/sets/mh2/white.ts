// mh2 — white cards (ADR 0043 colour split).
import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { evokeTrigger } from "../../abilities/evoke";

// TODO(issue #676 stub — Converge is an uncensused ability word: no
// mechanicsRegistry row, and no primitive tracks "the number of colors of
// mana spent to cast this spell" (`noteManaSpent` records per-colour AMOUNT,
// not a distinct-colour COUNT usable as a target's mv comparator). Stop-and-
// issue per gre-development.md; tracked stub.
// export const prismaticEnding: CardDefinition = {
//     id: "825969b9-3c70-4fca-8cab-696e9ca7cdb2",
//     name: "Prismatic Ending",
//     rarity: "uncommon",
//     manaCost: { X: "X", W: 1 },
//     types: ["Sorcery"],
// };

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
export const solitude: CardDefinition = {
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
        handCost: {
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
};

export {};
