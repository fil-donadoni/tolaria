// NEO — red cards, split by colour per ADR 0043. The registry's
// `import * as neo from "./sets/neo"` resolves through neo/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, EffectTokenSpec } from "../../types";
import { EFFECT_TREASURE_TOKEN } from "../../sharedTokens";

// ─────────────────────────────────────────────────────────────────────────
// Fable of the Mirror-Breaker // Reflection of Kiki-Jiki (issue #2399)
// ─────────────────────────────────────────────────────────────────────────
//
// The first Saga in the catalogue that TRANSFORMS (CR 714 + CR 712), and the
// first card needing a token to carry its OWN attack trigger.
//
// Three clauses, three already-shipped seams plus one earned extension:
//
//   I   — `createToken` with an `EffectTokenSpec.triggeredAbilities` entry
//         (issue #2364). The descriptor's `event` vocabulary
//         (`TokenTriggeredEventKind`) covered only `PERMANENT_ENTERED` /
//         `CREATURE_DIED`; the type's own doc comment says to extend it "when
//         a card actually needs a new self-scoped token trigger kind", and
//         this is that card. `ATTACKERS_DECLARED` joins it, dispatching to a
//         new `attacksTrigger` factory (CR 508.1m) that is self-scoped by
//         construction (CR 109.2) — the Treasure appears when THAT TOKEN
//         attacks, never when Fable or a sibling creature does.
//   II  — `choice` (up to two, `count: { min: 0, max: 2 }`) → `discard` →
//         `forEach { set: "bound", ref: "$disc" }` drawing ONE per discarded
//         card. "Draw that many" is not an `EffectValue` the grammar can read
//         off a picks list, but it does not have to be: iterating the picks
//         and drawing one per member is CR-identical (CR 121.2 — "draw two
//         cards" is two sequential draws) and scales to 0/1/2 for free.
//   III — `exileAndReturnTransformed` (CR 712.14a). Fable says "under YOUR
//         control", where the shipped ORI flip-walker template says "under his
//         OWNER's control", so the Op grew an optional `controller` (issue
//         #2399); every prior caller keeps the owner default.
//
// CR 714.4's sacrifice SBA never fires here: chapter III is on the stack when
// the lore count reaches the final chapter (the SBA's own "isn't the source of
// a chapter ability that has triggered but not yet left the stack" clause), and
// by the time it has left, the Saga is no longer on the battlefield — it is a
// NEW object (CR 400.7) showing a back face with no chapter abilities.
//
// Back face — Reflection of Kiki-Jiki is an Enchantment Creature, NOT a
// Planeswalker, so no `loyalty`. Its ability is `createTokenCopy` with CR
// 707.2's `except` clause plus a `delayedTrigger` sacrifice, the Satya,
// Aetherflux Genius shape. "except it has HASTE" needed one new `except` key
// (`additionalStaticAbilities`): the keyword is a COPIABLE value, so a copy of
// the copy has haste too, which a post-hoc `grantAbility` would not give.
//
// The legend rule (CR 704.5j) correctly never applies to the copy: the clause
// restricts the target to a NONLEGENDARY creature, so the token it makes is
// nonlegendary by construction. That restriction is `excludeSupertypes:
// "Legendary"`, and "ANOTHER" is `excludeSource` — the back face cannot copy
// itself.

/** The chapter-I token (CR 111.1 / 707.2). "2/2 red Goblin Shaman creature
 *  token with 'Whenever this token attacks, create a Treasure token.'"
 *
 *  Card-local rather than a `sharedTokens.ts` entry: Fable is its only
 *  producer in the catalogue, and the art-match rule wants the token
 *  associated with the PRODUCING card's own printing — resolved per producer
 *  from the Scryfall reverse-link lockfile (`generated/token-prints.json`) by
 *  `tokenPrintIdFor`, so no `imagePrintId` is pinned here. Promote it to
 *  `sharedTokens.ts` when a second producer ships (extract after the second).
 *
 *  The carried trigger is a `TokenTriggeredAbility` descriptor — JSON-pure,
 *  always CR 109.2 self-scoped — rebuilt into a real `TriggeredAbility` by
 *  `resolveTokenTriggeredAbilities` at the `createToken` Op executor AND by
 *  the cold-decode path, from the same factory table. The Treasure it makes is
 *  the shared `EFFECT_TREASURE_TOKEN` (one Treasure identity across the
 *  catalogue), whose own art is pinned on the spec. */
const GOBLIN_SHAMAN_TOKEN: EffectTokenSpec = {
    name: "Goblin Shaman",
    types: ["Creature"],
    subtypes: ["Goblin", "Shaman"],
    power: 2,
    toughness: 2,
    colors: ["R"],
    triggeredAbilities: [
        {
            id: "goblin-shaman-attacks-treasure",
            oracleText: "Whenever this token attacks, create a Treasure token.",
            // CR 508.1m — "Any abilities that trigger on attackers being
            // declared trigger." CR 508.4 is the deliberate non-case: a token
            // that ENTERS attacking was never declared, emits no
            // `ATTACKERS_DECLARED`, and correctly makes no Treasure.
            event: "ATTACKERS_DECLARED",
            effects: [
                {
                    op: "createToken",
                    token: EFFECT_TREASURE_TOKEN,
                    controller: "controller",
                },
            ],
        },
    ],
};

export const fableOfTheMirrorBreaker: CardDefinition = {
    id: "24c0d87b-0049-4beb-b9cb-6f813b7aa7dc",
    name: "Fable of the Mirror-Breaker",
    rarity: "rare",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    subtypes: ["Saga"],
    oracleText:
        '(As this Saga enters and after your draw step, add a lore counter.)\nI — Create a 2/2 red Goblin Shaman creature token with "Whenever this token attacks, create a Treasure token."\nII — You may discard up to two cards. If you do, draw that many cards.\nIII — Exile this Saga, then return it to the battlefield transformed under your control.',
    chapterAbilities: [
        {
            chapters: [1],
            oracleText:
                'I — Create a 2/2 red Goblin Shaman creature token with "Whenever this token attacks, create a Treasure token."',
            effects: [
                {
                    op: "createToken",
                    token: GOBLIN_SHAMAN_TOKEN,
                    controller: "controller",
                },
            ],
        },
        {
            chapters: [2],
            oracleText:
                "II — You may discard up to two cards. If you do, draw that many cards.",
            effects: [
                {
                    // "up to two" (CR 601.2c-style optional range) — a range
                    // `count` lets the controller pick 0, 1 or 2, and 0 picks
                    // makes both following Ops no-ops, which IS the "if you
                    // do" conditional. No `if` construct is needed.
                    op: "choice",
                    kind: "discard-hand",
                    player: "controller",
                    zone: "hand",
                    count: { min: 0, max: 2 },
                    prompt: "Discard up to two cards",
                    bind: "$disc",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$disc" },
                },
                {
                    // "draw that many cards" — one draw per DISCARDED card,
                    // iterating the picks binding. CR 121.2 makes "draw N
                    // cards" N sequential draws, so this is not an
                    // approximation of the clause, it IS the clause. Runs (tracked-by: #2785)
                    // AFTER the discard (CR 608.2, written order), so the
                    // discarded cards cannot be drawn back.
                    op: "forEach",
                    select: { set: "bound", ref: "$disc" },
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        },
        {
            chapters: [3],
            oracleText:
                "III — Exile this Saga, then return it to the battlefield transformed under your control.",
            effects: [
                {
                    op: "exileAndReturnTransformed",
                    target: { ref: "$source" },
                    // "under YOUR control" — the chapter ability's controller,
                    // not the card's owner (CR 712.14a says only that it
                    // enters with its back face up; who it enters under is the
                    // Oracle clause's own wording).
                    controller: "controller",
                },
            ],
        },
    ],
    backFace: {
        name: "Reflection of Kiki-Jiki",
        types: ["Enchantment", "Creature"],
        subtypes: ["Goblin", "Shaman"],
        power: 2,
        toughness: 2,
        // CR 712.2 — a back face's colour comes from its own printed
        // characteristics. Reflection of Kiki-Jiki has no mana cost, so its
        // colour is the card's colour indicator: red.
        colors: ["R"],
        oracleText:
            "{1}, {T}: Create a token that's a copy of another target nonlegendary creature you control, except it has haste. Sacrifice it at the beginning of the next end step.",
        // A real double-faced Scryfall print shares ONE id across both faces;
        // `backFaceAsTokenSpec` stamps `imagePrintFace: "back"` so the image
        // layer requests the back-face CDN path.
        imagePrintId: "24c0d87b-0049-4beb-b9cb-6f813b7aa7dc",
        activatedAbilities: [
            {
                id: "reflection-of-kiki-jiki-copy",
                oracleText:
                    "{1}, {T}: Create a token that's a copy of another target nonlegendary creature you control, except it has haste. Sacrifice it at the beginning of the next end step.",
                cost: { mana: { X: 1 }, tap: true },
                useStack: true,
                targetRequirement: {
                    type: "Creature",
                    count: 1,
                    controller: "you",
                    // "NONLEGENDARY" (CR 205.4a) — the reason the legend rule
                    // (CR 704.5j) never bites the copy.
                    excludeSupertypes: "Legendary",
                    // "ANOTHER" — never this permanent itself.
                    excludeSource: true,
                },
                effects: [
                    {
                        op: "createTokenCopy",
                        source: { target: 0 },
                        controller: "controller",
                        // CR 707.2's "except" clause. Haste is a COPIABLE
                        // value of the token, not a layer-6 grant.
                        except: { additionalStaticAbilities: ["haste"] },
                        bind: "$copy",
                    },
                    {
                        // "Sacrifice it at the beginning of the next end
                        // step." A delayed triggered ability (CR 603.7a),
                        // scheduled as the copy is created and carrying the
                        // copy's identity across to fire time. Guarded on the
                        // copy actually existing (CR 608.2b — the source may
                        // have left the battlefield before this Op ran, in
                        // which case `$copy` was never bound and no phantom
                        // trigger is scheduled).
                        op: "if",
                        predicate: {
                            objectMatchesFilter: { ref: "$copy" },
                            filter: { type: "Creature" },
                        },
                        then: [
                            {
                                op: "delayedTrigger",
                                timing: "next-end-step",
                                oracleText:
                                    "Sacrifice it at the beginning of the next end step.",
                                capture: { $token: { ref: "$copy" } },
                                effects: [
                                    {
                                        op: "sacrifice",
                                        target: { ref: "$token" },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    },
};
