// mh2 — multicolor cards (ADR 0043 colour split).
import type {
    CardDefinition,
    SpellContext,
    TargetSelection,
    TokenSpec,
} from "../../types";
import { countDomain, EFFECT_AFFECTS_SELF } from "../../types";
import { INSECT_TOKEN } from "../../sharedTokens";
import { tokenPrintIdFor } from "../../tokenPrintLookup";
import { attacksTrigger } from "../../abilities/triggers/attacksTrigger";

// Master of Death — {1}{U}{B} Creature — Zombie Wizard, 3/1. "When this
// creature enters, surveil 2.\nAt the beginning of your upkeep, if this card
// is in your graveyard, you may pay 1 life. If you do, return it to your
// hand." Authored DSL-first as an Effect Script (ADR 0045), both abilities
// reusing already-shipped Ops:
//   - ETB surveil 2 (CR 701.25): the `scryReorder` Op with `destination:
//     "graveyard"` and `count: 2`, the same shape as the MKM surveil-land
//     cycle (mkm/colorless.ts) and Consider (mid/blue.ts).
//   - Graveyard-zone upkeep recursion (CR 603.6e — `zone: "graveyard"`
//     triggered ability, Squee, Goblin Nabob's shape in mmq/red.ts, CR 117.3a
//     optional cost): `mayPay(cost: { life: 1 })` gates the `moveZone`
//     graveyard → hand self-return on the "if you do" clause. The "if this
//     card is in your graveyard" intervening-if is carried by the graveyard
//     zone scan itself.
export const masterOfDeath: CardDefinition = {
    id: "b9775175-6763-4826-afc8-dc520a235c36",
    name: "Master of Death",
    rarity: "rare",
    oracleText:
        "When this creature enters, surveil 2. (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)\nAt the beginning of your upkeep, if this card is in your graveyard, you may pay 1 life. If you do, return it to your hand.",
    manaCost: { X: 1, U: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie", "Wizard"],
    power: 3,
    toughness: 1,
    triggeredAbilities: [
        {
            id: "master-of-death-etb-surveil",
            oracleText: "When this creature enters, surveil 2.",
            event: "PERMANENT_ENTERED",
            matches: (event, self) =>
                event.type === "PERMANENT_ENTERED" &&
                event.instanceId === self.id,
            effects: [
                {
                    op: "scryReorder",
                    player: "controller",
                    count: 2,
                    destination: "graveyard",
                    prompt: "Surveil 2 — keep cards on top or put them into your graveyard.",
                },
            ],
        },
        {
            id: "master-of-death-upkeep-return",
            oracleText:
                "At the beginning of your upkeep, if this card is in your graveyard, you may pay 1 life. If you do, return it to your hand.",
            event: "PHASE_BEGIN",
            zone: "graveyard",
            matches: (event, self) =>
                event.type === "PHASE_BEGIN" &&
                event.phase === "UPKEEP" &&
                event.activePlayerId === self.controllerId,
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: { life: 1 },
                    prompt: "Pay 1 life to return Master of Death to your hand?",
                    bind: "$return",
                },
                {
                    op: "if",
                    predicate: { binding: "$return" },
                    then: [
                        {
                            op: "moveZone",
                            target: { ref: "$source" },
                            to: "hand",
                        },
                    ],
                },
            ],
        },
    ],
};

// Grist, the Hunger Tide — {1}{B}{G} Legendary Planeswalker — Grist, loyalty 3.
// Oracle (Scryfall, 2026-08-18):
//   "As long as Grist isn't on the battlefield, it's a 1/1 Insect creature in
//    addition to its other types.
//    +1: Create a 1/1 black and green Insect creature token, then mill a card.
//        If an Insect card was milled this way, put a loyalty counter on Grist
//        and repeat this process.
//    −2: You may sacrifice a creature. When you do, destroy target creature or
//        planeswalker.
//    −5: Each opponent loses life equal to the number of creature cards in your
//        graveyard."
//
// FIRST CLAUSE — an OFF-BATTLEFIELD static, not a CDA. The issue called it a
// characteristic-defining ability, but CR 604.3a(5) excludes an ability that
// "does not set the values of such characteristics only if certain conditions
// are met" — Grist's clause is conditional on the zone, so it is an ordinary
// static ability. It nevertheless functions in hand, library, graveyard, exile
// and on the stack under CR 113.6c ("an ability that states which zones it
// doesn't function in functions everywhere except for the specified zones").
// Declared as `offBattlefieldCharacteristics` and applied by the shared
// zone-characteristics path (`gre/zoneCharacteristics.ts`) — see that module
// for the consumer census. The self-referential case matters: Grist milled
// into ITS OWN controller's graveyard is an Insect card (so the +1 repeats)
// and a creature card (so the −5 counts it).
//
// LOYALTY ABILITIES — ordinary `activatedAbilities` gated by `cost.loyalty`
// (CR 606.2; there is no separate planeswalker-ability type). The engine
// derives the CR 606.3 timing lock, the once-per-turn lock and the CR 606.6
// "can't go below 0" rule from the signed cost alone.
const GRIST_ID = "69af2825-18c2-4463-b6ba-42eaa070ccc1";

/** Grist's Insect token, with the art of Grist's OWN MH2 printing's token
 *  (CLAUDE.md § Card definition checklist art-match rule). Resolved from the
 *  reverse-linked lockfile rather than pinned, but read HERE rather than left
 *  to `createToken`'s fallback because `tokenPrintLookup.test.ts` only sees
 *  DSL `createToken` Ops — a `resolve()`-created token is invisible to it.
 *
 *  Restated as a `TokenSpec` (the imperative `SpellContext.createToken` shape)
 *  rather than spread from the `EffectTokenSpec` constant, because the two
 *  spec types diverge on their ability arrays; the characteristics still come
 *  from the one shared constant, field by field. */
const gristInsectToken: TokenSpec = {
    name: INSECT_TOKEN.name,
    types: INSECT_TOKEN.types,
    subtypes: INSECT_TOKEN.subtypes,
    power: INSECT_TOKEN.power,
    toughness: INSECT_TOKEN.toughness,
    colors: INSECT_TOKEN.colors,
    imagePrintId: tokenPrintIdFor(GRIST_ID, "Insect"),
};

export const gristTheHungerTide: CardDefinition = {
    id: GRIST_ID,
    name: "Grist, the Hunger Tide",
    rarity: "mythic",
    oracleText:
        "As long as Grist isn't on the battlefield, it's a 1/1 Insect creature in addition to its other types.\n+1: Create a 1/1 black and green Insect creature token, then mill a card. If an Insect card was milled this way, put a loyalty counter on Grist and repeat this process.\n−2: You may sacrifice a creature. When you do, destroy target creature or planeswalker.\n−5: Each opponent loses life equal to the number of creature cards in your graveyard.",
    manaCost: { X: 1, B: 1, G: 1 },
    types: ["Planeswalker"],
    supertypes: ["Legendary"],
    subtypes: ["Grist"],
    loyalty: 3,
    // CR 113.6c — functions in every zone EXCEPT the battlefield.
    offBattlefieldCharacteristics: {
        addTypes: ["Creature"],
        addSubtypes: ["Insect"],
        power: 1,
        toughness: 1,
    },
    activatedAbilities: [
        {
            id: "grist-the-hunger-tide-plus1",
            oracleText:
                "+1: Create a 1/1 black and green Insect creature token, then mill a card. If an Insect card was milled this way, put a loyalty counter on Grist and repeat this process.",
            cost: { loyalty: 1 },
            useStack: true,
            // protocol card: an UNBOUNDED conditional repeat. "…and repeat this
            // process" re-runs the whole create/mill/check sequence an
            // unpredictable number of times, terminated only by the first
            // non-Insect mill or by an empty library (CR 701.17b). The Effect
            // Script DSL deliberately freezes exactly four structural
            // constructs — bind / ref / if / forEach (ADR 0045/0046) — none of
            // which is a loop, and `forEach` iterates a KNOWN collection, so no
            // composition of them expresses "repeat until a runtime condition
            // fails". Adding a fifth construct is a user-level architecture
            // decision, not an implementer's; every individual STEP here
            // already exists as an Op (`createToken`, `mill` + `bind`,
            // `boundMatchesFilter`, `addCounter`), so this is the loop and
            // nothing else. `aiEffects` below gives the bot one iteration's
            // worth of the same script to valuate.
            aiEffects: [
                {
                    op: "createToken",
                    token: INSECT_TOKEN,
                    controller: "controller",
                },
                { op: "mill", player: "controller", count: 1 },
            ],
            resolve: (ctx: SpellContext) => {
                const self: TargetSelection = {
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                };
                // Each pass mills at least one card or stops, so the finite
                // library bounds the loop (CR 701.17b — a player can't mill
                // more cards than their library holds).
                for (;;) {
                    ctx.createToken(gristInsectToken, ctx.controller);
                    // CR 701.17a — `millCards` returns only the cards that
                    // genuinely reached the graveyard, so a CR 614 redirect to
                    // exile (or an empty library) reads as "no card was milled"
                    // and ends the process.
                    const milled = ctx.millCards(ctx.controller, 1);
                    const milledId = milled[0];
                    if (milledId === undefined) return;
                    // CR 701.17c — a milled card is found in the public zone it
                    // moved to. The graveyard snapshot carries the zone-aware
                    // subtypes, so a milled Grist counts as an Insect card.
                    const milledCard = ctx
                        .getGraveyardCards(ctx.controller)
                        .find((c) => c.id === milledId);
                    if (!milledCard?.subtypes.includes("Insect")) return;
                    // CR 122.1 — the extra loyalty counter is on top of the +1
                    // cost already paid at activation. A no-op if Grist has
                    // left the battlefield (CR 608.2b); the loop repeats either
                    // way, since the oracle gates the repeat on the MILL, not
                    // on the counter.
                    ctx.addCounter(self, "loyalty", 1);
                }
            },
        },
        {
            id: "grist-the-hunger-tide-minus2",
            oracleText:
                "−2: You may sacrifice a creature. When you do, destroy target creature or planeswalker.",
            cost: { loyalty: -2 },
            useStack: true,
            // "When you do" is a CR 603.12 reflexive triggered ability: a
            // SEPARATE stack object whose target is announced only after the
            // sacrifice happened (distinct from "if you do", which stays in the
            // same resolution). The Minsc & Boo shape (`clb/multicolor.ts`),
            // here with an OPTIONAL `count: { min: 0, max: 1 }` because Grist
            // says "you MAY sacrifice" (the Gut, True Soul Zealot shape,
            // `clb/red.ts`).
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: "controller",
                    zone: "battlefield",
                    filter: { type: "Creature" },
                    count: { min: 0, max: 1 },
                    prompt: "You may sacrifice a creature (Grist, the Hunger Tide).",
                    bind: "$sacPick",
                },
                { op: "sacrifice", permanents: { ref: "$sacPick" } },
                {
                    op: "if",
                    predicate: { picksNonEmpty: { ref: "$sacPick" } },
                    then: [
                        {
                            op: "reflexiveTrigger",
                            oracleText:
                                "When you do, destroy target creature or planeswalker.",
                            targetRequirement: {
                                type: ["Creature", "Planeswalker"],
                                count: 1,
                            },
                            effects: [{ op: "destroy", target: { target: 0 } }],
                        },
                    ],
                },
            ],
        },
        {
            id: "grist-the-hunger-tide-minus5",
            oracleText:
                "−5: Each opponent loses life equal to the number of creature cards in your graveyard.",
            cost: { loyalty: -5 },
            useStack: true,
            // CR 118.2 life loss driven by an `EffectCountSpec` over the
            // controller's graveyard. A Grist in that graveyard counts itself:
            // CR 113.6c makes it a creature card there.
            effects: [
                {
                    op: "loseLife",
                    player: "opponent",
                    amount: {
                        count: {
                            zone: "graveyard",
                            controller: "controller",
                            filter: { type: "Creature" },
                        },
                    },
                },
            ],
        },
    ],
};

// Territorial Kavu — {R}{G} Creature — Kavu, printed */*. "Domain —
// Territorial Kavu's power and toughness are each equal to the number of basic
// land types among lands you control.\nWhenever this creature attacks, choose
// one —\n• Discard a card. If you do, draw a card.\n• Exile up to one target
// card from a graveyard."
//
// P/T (CR 604.3 characteristic-defining ability, CR 305.6 basic land types):
// the Nightmare convention (`lea/black.ts`) — a printed 0/0 base plus a
// self-scoped `pt-cda` whose `compute` IS the whole stat line, through the
// shared `countDomain` helper every other Domain site reads. A CDA functions
// in all zones (CR 604.3), and the layer pipeline is what the public-state
// projection re-asserts the P/T from, so the client reads the same number the
// engine does. At Domain 0 the creature is a 0/0 and dies to SBA — that is the
// card, not a gap.
//
// The attack trigger is MODAL (CR 603.3c / 700.2b): its controller announces
// exactly one mode as the ability is PUT ON THE STACK, before targets, and "if
// one of the modes would be illegal (due to an inability to choose legal
// targets, for example), that mode can't be chosen". Both modes here are
// always choosable — the discard mode targets nothing, and "up to one target"
// is legal with zero targets — so the announcement is a real two-way prompt
// every combat. `attacksTrigger` grew a `modes` passthrough for this card, the
// same {@link AbilityMode} list `enteredTrigger` already forwards for a modal
// ETB (Deceiver Exarch, `nph/blue.ts`): a modal trigger differs only in WHICH
// event puts it on the stack.
export const territorialKavu: CardDefinition = {
    id: "2605df98-0b02-4aab-bc36-01e93c693743",
    rarity: "rare",
    name: "Territorial Kavu",
    oracleText:
        "Domain — Territorial Kavu's power and toughness are each equal to the number of basic land types among lands you control.\nWhenever this creature attacks, choose one —\n• Discard a card. If you do, draw a card.\n• Exile up to one target card from a graveyard.",
    manaCost: { R: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 0,
    toughness: 0,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                const domain = countDomain(state, source.controllerId);
                return { power: domain, toughness: domain };
            },
        },
    ],
    triggeredAbilities: [
        attacksTrigger({
            id: "territorial-kavu-attacks",
            oracleText:
                "Whenever this creature attacks, choose one —\n• Discard a card. If you do, draw a card.\n• Exile up to one target card from a graveyard.",
            scope: "self",
            modes: [
                {
                    id: "loot",
                    label: "Discard a card. If you do, draw a card",
                    oracleText: "Discard a card. If you do, draw a card.",
                    // "If you do" needs no `if` construct: an empty hand leaves
                    // the `choice` with no candidates, so `$disc` is never
                    // captured, the `discard` Op is skipped (CR 608.2b — the
                    // effect does as much as it can) and the `forEach` over the
                    // binding iterates nothing. The draw therefore happens
                    // exactly when a card was actually discarded, which IS the
                    // clause (the Fable of the Mirror-Breaker shape,
                    // `neo/red.ts`). The draw runs AFTER the discard in written
                    // order, so the discarded card cannot be drawn back.
                    effects: [
                        {
                            op: "choice",
                            kind: "discard-hand",
                            player: "controller",
                            zone: "hand",
                            count: 1,
                            prompt: "Discard a card",
                            bind: "$disc",
                        },
                        {
                            op: "discard",
                            player: "controller",
                            cards: { ref: "$disc" },
                        },
                        {
                            op: "forEach",
                            select: { set: "bound", ref: "$disc" },
                            effects: [
                                { op: "draw", player: "controller", count: 1 },
                            ],
                        },
                    ],
                },
                {
                    id: "exile-from-graveyard",
                    label: "Exile up to one target card from a graveyard",
                    oracleText: "Exile up to one target card from a graveyard.",
                    // "up to one target": `{ min: 0, max: 1 }` lets the
                    // controller announce zero targets without the mode
                    // becoming illegal (the Wrenn and Six +1 shape,
                    // `mh1/multicolor.ts`). `type: "card"` + `zone: "graveyard"`
                    // with no `controller` is "a graveyard" — either player's
                    // (the field defaults to "any").
                    targetRequirement: {
                        type: "card",
                        count: { min: 0, max: 1 },
                        zone: "graveyard",
                    },
                    // A graveyard card is not a permanent, so the exile is a
                    // `moveZone` to exile — the shape that Op's own docstring
                    // names for exactly this clause — not the battlefield-only
                    // `exile` Op.
                    effects: [
                        {
                            op: "moveZone",
                            target: { target: 0 },
                            to: "exile",
                        },
                    ],
                },
            ],
        }),
    ],
};
