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
// sacrifices it." (CR 400.7 reanimation.) STILL BLOCKED — two real engine
// gaps remain. What #920 originally flagged as the blocker (the
// self-transform-and-dynamic-attach pattern) IS genuinely closed: `addSubtype`
// (`convex/gre/state.ts:10425`) turns $source into an Aura mid-resolution;
// `attach` (`types.ts`, executor `convex/gre/effects/interpreter.ts`) targets
// a BOUND ref from the same resolution — Cori-Steel Cutter creates a token,
// binds it (`$monk`), then attaches to `{ ref: "$monk" }` in one script
// (`tdm/red.ts`); and `leftTrigger`/`PERMANENT_LEFT`
// (`convex/cards/abilities/triggers/leftTrigger.ts`) covers the
// sacrifice-on-leave clause. But two clauses beyond that pattern are NOT
// covered: (a) the per-instance enchant restriction (CR 303.4 / 704.5m) —
// `checkAuraAttachmentSBA` (`convex/gre/sba.ts:141`) calls
// `hostMatchesAuraRestriction` (`sba.ts:230-249`), which resolves "enchant
// creature" from the COMPILE-TIME `def.targetRequirement` (`sba.ts:236`), not
// from the instance `addSubtype` just mutated. Necromancy has no cast-time
// `targetRequirement` (its host is chosen by the ETB trigger, CR 303.4i), so
// this returns `false` and the aura is judged illegally attached the instant
// the trigger resolves — `removePermanentTo` bins it right away. This is the
// SAME compile-time-vs-per-instance shape as Carnage's `hasAttackRequirement`
// (`spm/multicolor.ts`) above. Dance of the Dead (`ice/black.ts:409-415`) is
// NOT a usable precedent — it works only because it is PRINTED as an Aura
// with a cast-time `targetRequirement`; giving Necromancy that shape would
// force a target at cast time and diverge from modern Oracle text (ADR
// 0004). (b) the "sacrifice at the beginning of the next cleanup step, if
// cast when a sorcery couldn't have been cast" clause needs a cleanup-step
// delayed trigger and flash-timing memory, neither of which exist:
// `DelayedTriggerTiming` (`convex/cards/types.ts:4411-4416`) offers only
// `next-end-step` / `next-end-of-combat` / `next-draw-step` /
// `next-main-phase` / `next-upkeep` and an instance-scoped leave-watch — no
// cleanup boundary — and nothing in the engine records whether a spell was
// cast when a sorcery couldn't have been.
// tracked-by: #1975
// export const necromancy: CardDefinition = {
//     id: "311a6257-dd77-4bb6-81cb-c8e7862350f3",
//     name: "Necromancy",
//     rarity: "uncommon",
//     manaCost: { X: 2, B: 1 },
//     types: ["Enchantment"],
// };
