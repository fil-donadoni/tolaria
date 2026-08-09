// ori — blue cards (ADR 0043 colour split).
//
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical
// name/cost/types/P-T/loyalty are from Scryfall (id = ORI paper printing).

import type { CardDefinition } from "../../types";
import { JACE_TELEPATH_UNBOUND_EMBLEM_ID } from "../../emblems";

// ─────────────────────────────────────────────────────────────────────────
// Jace, Vryn's Prodigy // Jace, Telepath Unbound (issue #2380)
// ─────────────────────────────────────────────────────────────────────────
//
// The tracer for the exile-and-return-transformed template (CR 712 / 400.7):
// "{T}: Draw a card, then discard a card. If there are five or more cards in
// your graveyard, exile Jace, then return him to the battlefield transformed
// under his owner's control."
//
// The flip clause is the new `exileAndReturnTransformed` Op — emphatically NOT
// the shipped `transform` Op, which flips a permanent IN PLACE (CR 712.8a) and
// therefore preserves the object's identity. Here the permanent really leaves
// the battlefield and really comes back, so CR 400.7 applies and what returns
// is a NEW object: its counters are gone, its Auras and Equipment have fallen
// off, its "enters the battlefield" triggers fire again, and anything holding a
// reference to the creature (a target on the stack) no longer finds it. The
// back face is a PLANESWALKER, so it enters with its own CR 306.5b starting
// loyalty — five — carried on `backFace.loyalty`.
//
// The single Oracle sentence is ONE activated ability, sequenced left to right:
// draw, then the discard pick, then the graveyard-count check. Order matters —
// the just-discarded card counts toward the five (CR 608.2 resolves an ability's
// instructions in written order), which is exactly what makes a 4-card
// graveyard flip Jace on the same activation.
//
// Every Op in the front face is already exercised except the flip itself
// (`draw`, `choice`/`choose-hand-card`, `discard`, the `if` construct with a
// graveyard-count comparison), so the per-Op regime applies: the new Op earns
// the hand-written tests, the rest ride the catalogue sweeps.
//
// Back face (Jace, Telepath Unbound, starting loyalty 5):
//   • +1 — "Up to one target creature gets -2/-0 until your next turn."
//     `pump` with `{ phase: "untap", player: "controller" }`, the engine's
//     encoding of "until your next turn" (CR 502.1 — the effect ends as the
//     controller's next untap step begins; precedent: Orcish Farmer's
//     land-type change, ice/red.ts).
//   • −3 — "You may cast target instant or sorcery card from your graveyard
//     this turn. If that spell would be put into your graveyard, exile it
//     instead." `grantCastFromGraveyard` with the impulse `this-turn` window
//     plus the `exilesOnResolve` rider (issue #2380), which routes through the
//     SAME `exileOnResolve` stack-item flag Flashback's CR 702.34a exile uses.
//   • −9 — the emblem (`emblem` Op, `convex/cards/emblems.ts`).
//
// The back face's `activatedAbilities` are JSON-encoded into the synthesized
// back-face definition id (`tokenDefinitionId`), so every one of them must be
// pure data — no `getTargetRequirement` closure, no `resolve()`. All three are.
export const jaceVrynsProdigy: CardDefinition = {
    id: "02d6d693-f1f3-4317-bcc0-c21fa8490d38",
    name: "Jace, Vryn's Prodigy",
    rarity: "mythic",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    supertypes: ["Legendary"],
    power: 0,
    toughness: 2,
    oracleText:
        "{T}: Draw a card, then discard a card. If there are five or more cards in your graveyard, exile Jace, then return him to the battlefield transformed under his owner's control.",
    activatedAbilities: [
        {
            id: "jace-vryns-prodigy-loot",
            oracleText:
                "{T}: Draw a card, then discard a card. If there are five or more cards in your graveyard, exile Jace, then return him to the battlefield transformed under his owner's control.",
            cost: { tap: true },
            useStack: true,
            effects: [
                { op: "draw", player: "controller", count: 1 },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card.",
                    bind: "$discard",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discard" },
                },
                {
                    // Checked AFTER the discard (CR 608.2, written order), so
                    // the card just discarded counts toward the five.
                    op: "if",
                    predicate: {
                        left: {
                            count: {
                                zone: "graveyard",
                                controller: "controller",
                            },
                        },
                        op: "ge",
                        right: 5,
                    },
                    then: [
                        {
                            op: "exileAndReturnTransformed",
                            target: { ref: "$source" },
                        },
                    ],
                },
            ],
        },
    ],
    backFace: {
        name: "Jace, Telepath Unbound",
        types: ["Planeswalker"],
        subtypes: ["Jace"],
        supertypes: ["Legendary"],
        // CR 306.5b — starting loyalty, placed as the returning permanent
        // ENTERS the battlefield (`stageReanimatedOnBattlefield`, gre/state.ts).
        loyalty: 5,
        // CR 712.2 — a back face's colour is fixed by its own printed
        // characteristics. Jace, Telepath Unbound has no mana cost, so its
        // colour comes from the card's colour indicator (blue).
        colors: ["U"],
        oracleText:
            '+1: Up to one target creature gets -2/-0 until your next turn.\n−3: You may cast target instant or sorcery card from your graveyard this turn. If that spell would be put into your graveyard, exile it instead.\n−9: You get an emblem with "Whenever you cast a spell, target opponent mills five cards."',
        // A real double-faced Scryfall print shares ONE id across both faces;
        // `backFaceAsTokenSpec` stamps `imagePrintFace: "back"` so the image
        // layer requests the back-face CDN path (issue #1595).
        imagePrintId: "02d6d693-f1f3-4317-bcc0-c21fa8490d38",
        activatedAbilities: [
            {
                id: "jace-telepath-unbound-plus1",
                cost: { loyalty: 1 },
                useStack: true,
                oracleText:
                    "+1: Up to one target creature gets -2/-0 until your next turn.",
                // "UP TO one" (CR 601.2c) — an unfilled slot resolves to
                // undefined and the `pump` Op skips (CR 608.2b).
                targetRequirement: {
                    type: "Creature",
                    count: { min: 0, max: 1 },
                },
                effects: [
                    {
                        op: "pump",
                        target: { target: 0 },
                        power: -2,
                        toughness: 0,
                        // CR 502.1 — "until your next turn": the effect ends as
                        // the ability's controller's next untap step begins.
                        duration: { phase: "untap", player: "controller" },
                    },
                ],
            },
            {
                id: "jace-telepath-unbound-minus3",
                cost: { loyalty: -3 },
                useStack: true,
                oracleText:
                    "−3: You may cast target instant or sorcery card from your graveyard this turn. If that spell would be put into your graveyard, exile it instead.",
                targetRequirement: {
                    type: ["Instant", "Sorcery"],
                    count: 1,
                    zone: "graveyard",
                    controller: "you",
                },
                effects: [
                    {
                        op: "grantCastFromGraveyard",
                        card: { target: 0 },
                        player: "controller",
                        window: "this-turn",
                        exilesOnResolve: true,
                    },
                ],
            },
            {
                id: "jace-telepath-unbound-minus9",
                cost: { loyalty: -9 },
                useStack: true,
                oracleText:
                    '−9: You get an emblem with "Whenever you cast a spell, target opponent mills five cards."',
                effects: [
                    { op: "emblem", emblem: JACE_TELEPATH_UNBOUND_EMBLEM_ID },
                ],
            },
        ],
    },
};
