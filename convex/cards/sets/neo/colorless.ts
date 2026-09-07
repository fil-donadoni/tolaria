// NEO — colorless cards, split by colour per ADR 0043. The registry's
// `import * as neo from "./sets/neo"` resolves through neo/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { channelAbility } from "../../abilities/channel";
import { LAND_SUBTYPE_MANA } from "../../../gre/constants";

// CR 601.2f self-host reduction (ADR 0096) — "This ability costs {1} less to
// activate for each legendary creature you control." Shared by both channel
// lands below: the SAME `CostReductionAmount` the ADR 0096 test names as its
// own worked example (`abilitySelfCostReduction.test.ts`). Generic-only
// (CR 601.2f), floored at zero by the shared resolver — never touches either
// land's coloured pip.
const LEGENDARY_CREATURE_COUNT = {
    perCount: { X: 1 },
    countFilter: { types: "Creature", supertypes: "Legendary" },
} as const;

// Boseiju, Who Endures — Legendary Land. "{T}: Add {G}.\nChannel — {1}{G},
// Discard this card: Destroy target artifact, enchantment, or nonbasic land
// an opponent controls. That player may search their library for a land
// card with a basic land type, put it onto the battlefield, then shuffle.
// This ability costs {1} less to activate for each legendary creature you
// control." (Scryfall oracle, NEO, issue #2290.)
//
// Target (CR 601.2c/2b): "artifact, enchantment, or nonbasic land an
// opponent controls" is `type: ["Artifact", "Enchantment", "Land"]` +
// `excludeSupertypes: "Basic"` (Wasteland's "nonbasic land" shape — the
// exclusion is a no-op on the Artifact/Enchantment branches, since only a
// Land ever carries the Basic supertype, CR 205.4a) + `controller:
// "opponent"`.
//
// The destroy's snapshot idiom (issue #2287) is what makes "that player"
// resolvable AFTER the permanent leaves: `bind: "$destroyed"` captures the
// object's controller/owner BEFORE `ctx.destroy` runs, so the trailing
// `{ ref: "$destroyed.controller" }` reads CR 608.2h last-known information
// regardless of whether the destroy actually removed the permanent
// (indestructible) — the bind happens unconditionally, pre-effect, exactly
// like Agonizing Demise's `$slain` (`inv/multicolor.ts`).
//
// "That player MAY search" (not a compulsory search that may merely fail to
// find) is the cost-free `mayPay` yes/no gate (CR 117.3a, issue #680) wrapped
// around the WHOLE search+shuffle tail via `if($search)`: declining skips the
// search and the shuffle entirely (CR 701.19 never begins), matching
// Formidable Speaker's `mayPay` + `if($discarded)` shape (`ecl/green.ts`)
// exactly. Once accepted, the search itself may still fail to find nothing
// (`count: { min: 0, max: 1 }`, CR 701.19b) — Nature's Lore's compulsory-
// search shape (`ice/green.ts`) — before the mandatory post-search shuffle.
//
// "a land card with a basic land type" (NOT "a basic land card" — a Triome or
// a dual with a basic land type qualifies, CR 305.6/205.3i) is
// `subtype: Object.keys(LAND_SUBTYPE_MANA)` — the five basic land subtypes,
// OR-matched (`EffectCardFilter.subtype`'s array semantics, issue #677) —
// never `supertype: "Basic"`, which would wrongly exclude a dual.
//
// compiler-gap: Channel — {1}{G}, Discard this card: Destroy target artifact, enchantment, or nonbasic land an opponent controls. That player may search their library for a land card with a basic land type, put it onto the battlefield, then shuffle. This ability costs {1} less to activate for each legendary creature you control. (#2693)
export const boseijuWhoEndures: CardDefinition = {
    id: "2135ac5a-187b-4dc9-8f82-34e8d1603416",
    name: "Boseiju, Who Endures",
    rarity: "rare",
    types: ["Land"],
    supertypes: ["Legendary"],
    manaCost: {},
    oracleText:
        "{T}: Add {G}.\nChannel — {1}{G}, Discard this card: Destroy target artifact, enchantment, or nonbasic land an opponent controls. That player may search their library for a land card with a basic land type, put it onto the battlefield, then shuffle. This ability costs {1} less to activate for each legendary creature you control.",
    activatedAbilities: [
        {
            id: "boseiju-mana",
            oracleText: "{T}: Add {G}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ G: 1 }),
            manaProduced: { G: 1 },
        },
        channelAbility({
            id: "boseiju-channel",
            cost: { X: 1, G: 1 },
            oracleText:
                "Channel — {1}{G}, Discard this card: Destroy target artifact, enchantment, or nonbasic land an opponent controls. That player may search their library for a land card with a basic land type, put it onto the battlefield, then shuffle. This ability costs {1} less to activate for each legendary creature you control.",
            targetRequirement: {
                type: ["Artifact", "Enchantment", "Land"],
                excludeSupertypes: "Basic",
                controller: "opponent",
                count: 1,
            },
            selfReduction: LEGENDARY_CREATURE_COUNT,
            effects: [
                {
                    op: "destroy",
                    target: { target: 0 },
                    bind: "$destroyed",
                },
                {
                    op: "mayPay",
                    player: { ref: "$destroyed.controller" },
                    prompt: "Search your library for a land card with a basic land type?",
                    bind: "$search",
                },
                {
                    op: "if",
                    predicate: { binding: "$search" },
                    then: [
                        {
                            op: "choice",
                            kind: "search-library",
                            player: { ref: "$destroyed.controller" },
                            zone: "library",
                            filter: {
                                type: "Land",
                                subtype: Object.keys(LAND_SUBTYPE_MANA),
                            },
                            count: { min: 0, max: 1 },
                            prompt: "Search your library for a land card with a basic land type (or none).",
                            bind: "$found",
                        },
                        {
                            op: "moveZone",
                            cards: { ref: "$found" },
                            player: { ref: "$destroyed.controller" },
                            from: "library",
                            to: "battlefield",
                        },
                        {
                            op: "libraryLook",
                            action: "shuffle",
                            player: { ref: "$destroyed.controller" },
                        },
                    ],
                },
            ],
        }),
    ],
};

// Otawara, Soaring City — Legendary Land. "{T}: Add {U}.\nChannel — {3}{U},
// Discard this card: Return target artifact, creature, enchantment or
// planeswalker to its owner's hand. This ability costs {1} less to activate
// for each legendary creature you control." (Scryfall oracle, NEO, issue
// #2290.)
//
// No `controller` restriction (unlike Boseiju) — the printed target includes
// the activating player's OWN permanents, so `targetRequirement` omits it
// (defaults to any controller). Bounce is the target-based `moveZone` shape
// (`{ op: "moveZone", target, to: "hand" }`) — the SAME Op Witch Hunter's
// "Return target creature an opponent controls to its owner's hand"
// (`drk/white.ts`) uses; the destination always resolves to the target's
// OWNER's hand (CR 400.7), matching "to its owner's hand" verbatim.
//
// Reuses ONLY already-exercised Ops (`moveZone`) — no hand-written per-card
// test needed beyond the catalogue-wide static sweep + generated smoke test
// (per-Op regime, `.claude/rules/gre-development.md`); the novel
// controller-of-object-as-acting-player shape that earns Boseiju its
// hand-written test does not appear here.
//
// compiler-gap: Channel — {3}{U}, Discard this card: Return target artifact, creature, enchantment or planeswalker to its owner's hand. This ability costs {1} less to activate for each legendary creature you control. (#2693)
export const otawaraSoaringCity: CardDefinition = {
    id: "486d7edc-d983-41f0-8b78-c99aecd72996",
    name: "Otawara, Soaring City",
    rarity: "rare",
    types: ["Land"],
    supertypes: ["Legendary"],
    manaCost: {},
    oracleText:
        "{T}: Add {U}.\nChannel — {3}{U}, Discard this card: Return target artifact, creature, enchantment or planeswalker to its owner's hand. This ability costs {1} less to activate for each legendary creature you control.",
    activatedAbilities: [
        {
            id: "otawara-mana",
            oracleText: "{T}: Add {U}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ U: 1 }),
            manaProduced: { U: 1 },
        },
        channelAbility({
            id: "otawara-channel",
            cost: { X: 3, U: 1 },
            oracleText:
                "Channel — {3}{U}, Discard this card: Return target artifact, creature, enchantment or planeswalker to its owner's hand. This ability costs {1} less to activate for each legendary creature you control.",
            targetRequirement: {
                type: ["Artifact", "Creature", "Enchantment", "Planeswalker"],
                count: 1,
            },
            selfReduction: LEGENDARY_CREATURE_COUNT,
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        }),
    ],
};
