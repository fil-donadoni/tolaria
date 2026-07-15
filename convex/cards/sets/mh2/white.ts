// mh2 — white cards (ADR 0043 colour split).
import type {
    CardDefinition,
    SpellContext,
    TargetSelection,
} from "../../types";
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
// (convex/cards/abilities/evoke.ts). The ETB "exile up to one OTHER target
// creature" picks across BOTH battlefields — like Loran of the Third Path
// (bro/white.ts), the DSL `choice` Op's battlefield candidates are limited to
// the chooser's own permanents (interpreter `choiceCandidates`), so this stays
// `resolve()` (justification: cross-controller battlefield choice, same gap
// Loran already documents; not a new Op — `ctx.requestChoice({allControllers})`
// already exists and is already used this way). `excludeInstanceIds` keeps
// Solitude itself off the candidate list ("other"). Life gain reads the
// target's power BEFORE exile (CR 613 last-known information).
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
            // protocol: cross-controller battlefield choice — see module comment.
            resolve: (ctx: SpellContext) => {
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `solitude-etb-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    filter: {
                        types: ["Creature"],
                        excludeInstanceIds: [ctx.sourceInstanceId],
                    },
                    allControllers: true,
                    count: { min: 0, max: 1 },
                    prompt: "Exile up to one other target creature (or none).",
                });
                if (picks === undefined) return; // suspended on the choice
                for (const id of picks) {
                    const target: TargetSelection = { type: "permanent", id };
                    const power = ctx.getPower(target);
                    const controllerId = ctx.getController(target);
                    ctx.exile(target);
                    ctx.gainLife(controllerId, Math.max(0, power));
                }
            },
        }),
        evokeTrigger("Solitude"),
    ],
};

export {};
