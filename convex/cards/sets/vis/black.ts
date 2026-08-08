// VIS — black cards, split by colour per ADR 0043. The registry's
// `import * as vis from "./sets/vis"` resolves through vis/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Vampiric Tutor — {B} Instant. "Search your library for a card, then
// shuffle and put that card on top. You lose 2 life." (CR 701.19 search /
// 701.20 shuffle / 401.4 top-of-library / 119.3 life loss, issue #1125 —
// unblocked by the `moveZone` `to: "library-top"` destination.)
// `count: { min: 0, max: 1 }` is CR 701.19b's fail-to-find allowance (no
// filter — "a card" is any card). The shuffle Op runs BEFORE the
// `library-top` move, mirroring the oracle text's own "then shuffle and put
// that card on top" ordering; the life loss is unconditional and runs last.
export const vampiricTutor: CardDefinition = {
    id: "0a07cba3-2e8d-48ec-a6f8-4d2edfcd833d",
    name: "Vampiric Tutor",
    rarity: "rare",
    manaCost: { B: 1 },
    types: ["Instant"],
    oracleText:
        "Search your library for a card, then shuffle and put that card on top. You lose 2 life.",
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            count: { min: 0, max: 1 },
            prompt: "Search your library for a card.",
            bind: "$picked",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "library",
            to: "library-top",
        },
        { op: "loseLife", player: "controller", amount: 2 },
    ],
};

// Necromancy — {2}{B} Enchantment. "You may cast this spell as though it had
// flash. If you cast it any time a sorcery couldn't have been cast, the
// controller of the permanent it becomes sacrifices it at the beginning of
// the next cleanup step. When this enchantment enters, if it's on the
// battlefield, it becomes an Aura with 'enchant creature put onto the
// battlefield with Necromancy.' Put target creature card from a graveyard
// onto the battlefield under your control and attach this enchantment to it.
// When this enchantment leaves the battlefield, that creature's controller
// sacrifices it." (CR 400.7 reanimation.) STILL BLOCKED — re-audited against
// HEAD 890ebd61 on 2026-08-08 (issue #2392); FOUR engine capabilities are
// missing, one more than #1975 currently scopes. What IS available: the
// reanimation half — `moveZone { target, to: "battlefield", controller:
// "controller", bind: "$reanimated" }` (Portal to Phyrexia's shape,
// `bro/colorless.ts:120-127`); `attach` onto a BOUND ref from the same
// resolution (`tdm/red.ts:130-137`); and `leftTrigger`/`PERMANENT_LEFT`
// (`convex/cards/abilities/triggers/leftTrigger.ts:244`, shape at
// `tsp/colorless.ts:33-42`) for the sacrifice-on-leave clause. CORRECTION to
// the previous note and to #1975's premise: Cori-Steel Cutter is NOT a
// self-transform precedent — it is `createToken` → `mayPay` → `attach` and
// never calls `addSubtype`. `addSubtype` has in fact NEVER been used to turn
// $self into an Aura: both shipped call sites add a CREATURE subtype to
// ANOTHER creature (`bro/colorless.ts:129` Phyrexian, `mh3/white.ts:93`
// Angel), so the self-transform-into-Aura shape is unexercised, not proven.
// The four gaps: (a) per-instance enchant restriction (CR 303.4 / 704.5m) —
// `checkAuraAttachmentSBA` (`convex/gre/sba.ts:141`, call site `sba.ts:166`)
// calls `hostMatchesAuraRestriction` (`sba.ts:247`), which resolves the
// restriction from the COMPILE-TIME `def.targetRequirement` and bails
// `if (!req) return false` (`sba.ts:253-254`) — never from the instance
// `addSubtype` just mutated. Necromancy has no cast-time `targetRequirement`
// (its host is chosen by the ETB trigger, CR 303.4i), so the aura is judged
// illegally attached the instant the trigger resolves and `removePermanentTo`
// bins it. Same compile-time-vs-per-instance shape as Carnage's
// `hasAttackRequirement` (`spm/multicolor.ts`) above and as #1972. Dance of
// the Dead (`ice/black.ts:409-415`) is NOT a usable precedent — it works only
// because it is PRINTED as an Aura with a cast-time `targetRequirement`;
// giving Necromancy that shape would force a target at cast time and diverge
// from modern Oracle text (ADR 0004). (b) no cleanup-step delayed-trigger
// boundary — `DelayedTriggerTiming` (`convex/cards/types.ts:4882-4990`) has
// ten members and none is a cleanup one, and the `case "CLEANUP"` arm
// (`convex/gre/phases.ts:2066-2075`) never calls `fireDelayedTriggers` at all,
// unlike the five phase boundaries that do (`phases.ts:1919,1930,2019,2030,
// 2041,2045`). `next-end-step` is a real behavioural divergence, not a
// synonym (CR 514 cleanup is after the end step). (c) no cast-timing MEMORY —
// nothing anywhere records whether a spell was cast when a sorcery couldn't
// have been (repo-wide grep for the concept returns zero hits), which is the
// condition that arms the sacrifice at all. (d) NOT IN #1975's SCOPE, and the
// reason this card stays blocked even if #1975 lands in full: there is no
// SELF-granted "you may cast this spell as though it had flash". The only
// cast-timing permission in the engine is the PLAYER-scoped Teferi grant
// (`state.castTimingFlashGrants`, `convex/gre/state.ts:3723`; gate
// `hasCastTimingFlashGrant`, `convex/cards/castRestrictions.ts:152`; consumed
// in `castTimingBaseLegal`, `convex/gre/rules.ts:388-403`) — a permission a
// card hands to a PLAYER for a class of spells, not one a card grants itself
// from hand. The same missing primitive is why Breaking Wave
// (`inv/blue.ts:784`) and Saproling Symbiosis (`inv/green.ts:1078`) are also
// commented out. Substituting the plain `flash` keyword would diverge: it
// changes the card's printed characteristics (CR 205.2 / 604), and the second
// Oracle sentence's condition is about the TIMING USED, not about possessing
// the ability. See docs/findings/2392-self-granted-flash-timing-permission.md.
// tracked-by: #1975
// export const necromancy: CardDefinition = {
//     id: "311a6257-dd77-4bb6-81cb-c8e7862350f3",
//     name: "Necromancy",
//     rarity: "uncommon",
//     manaCost: { X: 2, B: 1 },
//     types: ["Enchantment"],
// };
