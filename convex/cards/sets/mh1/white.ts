// mh1 — white cards (ADR 0043 colour split).
import type { CardDefinition, PermanentView } from "../../types";
import { protectionColorModes } from "../../abilities";

// Giver of Runes — {W} Creature — Kor Cleric (issue #684, Cube FREE evasion/
// protection statics). "{T}: Another target creature you control gains
// protection from colorless or from the color of your choice until end of
// turn." (CR 702.16 protection; CR 613.1f temporary keyword grant; CR 700.2
// modal choice; CR 109.2 "another" excludes the source itself.)
export const giverOfRunes: CardDefinition = {
    id: "4e117771-5a8b-4812-b487-32ba34b7f724",
    name: "Giver of Runes",
    rarity: "rare",
    oracleText:
        "{T}: Another target creature you control gains protection from colorless or from the color of your choice until end of turn.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Kor", "Cleric"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "giver-of-runes-protect",
            oracleText:
                "{T}: Another target creature you control gains protection from colorless or from the color of your choice until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            getTargetRequirement: (source: PermanentView) => ({
                type: "Creature",
                count: 1,
                controller: "you",
                excludeInstanceIds: [source.id],
            }),
            effects: [
                {
                    op: "optionChoice",
                    prompt: "Choose colorless or a color",
                    modes: protectionColorModes(["C", "W", "U", "B", "R", "G"]),
                },
            ],
        },
    ],
};

// Ephemerate — {W} Instant (issue #1402, closes the #676 stub). "Exile target
// creature you control, then return it to the battlefield under its owner's
// control. Rebound." Rebound (CR 702.88) shipped as reusable engine infra
// (`convex/gre/rebound.ts`, Mechanics Registry `rebound` now `implemented`) —
// see that module for the full timing model. The blink itself is the #1401
// "exile(bind) + moveZone(ref, battlefield)" idiom, the SAME-resolution shape
// (no `delayedTrigger` wrapper — unlike Liberate/Flickerwisp, which delay the
// return to the next end step, Ephemerate's oracle text has no such delay):
// `exile` the announced target with a `bind`, then an immediate `moveZone`
// resolves the bound ref back via `resolveObjectRef`'s exile-zone fallback,
// returning the card under its OWNER's control by default (no explicit
// `controller` — matches "under its owner's control"). Cast again from exile
// at the caster's next upkeep (Rebound), the fresh copy picks a NEW target.
export const ephemerate: CardDefinition = {
    id: "2da5f3f8-5eef-498f-ba2c-2f3fbc3745aa",
    name: "Ephemerate",
    rarity: "common",
    oracleText:
        "Exile target creature you control, then return it to the battlefield under its owner's control. Rebound. (If you cast this spell from your hand, instead of putting it into your graveyard as it resolves, exile it. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)",
    manaCost: { W: 1 },
    types: ["Instant"],
    staticAbilities: ["rebound"],
    targetRequirement: { type: "Creature", count: 1, controller: "you" },
    effects: [
        { op: "exile", target: { target: 0 }, bind: "$c" },
        { op: "moveZone", target: { ref: "$c" }, to: "battlefield" },
    ],
};

// TODO(issue #676 stub — Overload, CR 702.96, is `planned` in
// mechanicsRegistry.ts: no alternative-cost "change target to each" primitive
// exists. Winds of Abandon's overload mode is core to the card (mass exile
// vs opponents), and its base mode's land-search tail ("its controller
// searches... puts it onto the battlefield tapped") also has no moveZone
// path from a library choice to the battlefield (only graveyard-card →
// battlefield is modelled) — would need a resolve() justified by the
// existing Nature's Lore precedent (ice/green.ts), but Overload blocks the
// whole card regardless. Stop-and-issue; tracked stub.
// export const windsOfAbandon: CardDefinition = {
//     id: "3bb17913-fe4d-4acd-9b75-71f5a90f898b",
//     name: "Winds of Abandon",
//     rarity: "rare",
//     manaCost: { X: 1, W: 1 },
//     types: ["Sorcery"],
// };

export {};
