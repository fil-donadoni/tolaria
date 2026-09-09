// ELD — blue cards, split by colour per ADR 0043. The registry's
// `import * as eld from "./sets/eld"` resolves through eld/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { PERMANENT_TYPES } from "../../../gre/constants";

// ─────────────────────────────────────────────────────────────────────────────
// Slice #1337 (PRD #702, ADR 0063) — count-driven SELF-HOST cost reduction.
// CR 601.2f models cost modification applied as the cost is calculated;
// unlike every other `costReduction` consumer (Stone Calendar, Power
// Artifact, Mana Matrix, Planar Gate) — all discovered via a battlefield
// `staticEffects` scan — Emry's reducer is intrinsic to the SPELL being cast,
// which isn't a permanent yet at announcement. `selfCostReduction` is read
// directly off her own `CardDefinition` at the same 601.2f apply site
// (`getCostModifiers`, `gre/state.ts`). "Affinity for artifacts" here is
// authored DATA, not the generalized `affinity` KEYWORD (that keyword +
// convoke + Hogaak are deferred to slice #1338, ADR 0063) — Emry has no
// declared keyword.
// ─────────────────────────────────────────────────────────────────────────────

// Emry, Lurker of the Loch — {2}{U} Legendary Creature — Merfolk Wizard, 1/2
// (ELD). Modern Scryfall oracle text is authoritative (ADR 0004).
//
// The `{T}` ability (issue #1650) is a plain targeted activated ability whose
// target lives in a NON-battlefield zone (CR 601.2c / 400.7): `zone:
// "graveyard"` + `controller: "you"` + `type: "Artifact"` — the same
// requirement shape Regrowth and Necropolis already use. Its effect reuses the
// shipped `grantCastFromGraveyard` Op (issue #1344) rather than adding a
// primitive: the Op's `card` selector was widened from a bare picks ref to the
// full `EffectObjectSelector`, so an announced target slot names the card
// directly (ADR 0045 primitive reuse — generalize, don't add).
//
// `window: "this-turn"` is the ordinary impulse window every "you may cast
// that card this turn" card in this engine uses; `withoutPayingManaCost` is
// deliberately OMITTED — Emry's reminder text is explicit that "You still pay
// its costs. Timing rules still apply." The grant is revoked at CLEANUP.
export const emryLurkerOfTheLoch: CardDefinition = {
    id: "bf4b9a8a-b42a-46fb-b0d0-9cf800f63c8a",
    rarity: "rare",
    name: "Emry, Lurker of the Loch",
    oracleText:
        "Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.)\nWhen Emry enters, mill four cards.\n{T}: Choose target artifact card in your graveyard. You may cast that card this turn. (You still pay its costs. Timing rules still apply.)",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Merfolk", "Wizard"],
    power: 1,
    toughness: 2,
    selfCostReduction: {
        costReduction: {
            perCount: { X: 1 },
            countFilter: { types: "Artifact" },
        },
    },
    triggeredAbilities: [
        enteredTrigger({
            id: "emry-lurker-of-the-loch-etb",
            oracleText: "When Emry enters, mill four cards.",
            scope: "self",
            effects: [{ op: "mill", player: "controller", count: 4 }],
        }),
    ],
    activatedAbilities: [
        {
            id: "emry-lurker-of-the-loch-graveyard-cast",
            oracleText:
                "{T}: Choose target artifact card in your graveyard. You may cast that card this turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Artifact",
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
                },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Slice 1 of ADR 0120 — the INSET SPELL, and the first adventurer card
// (issue #3302, CR 715).
//
// Brazen Borrower // Petty Theft is one card (CR 715.2c): one catalogue row,
// one lockfile row, one anchor. The half printed in the inset frame is declared
// on `insetSpell`, and the engine-visible object for it is the TWIN definition
// `cards/insetSpell.ts` builds under `${id}#adventure` and registers — never a
// second export from this module, which is what `allCards` is built from.
//
// Every capability it needs already exists at HEAD: flash and flying are
// keywords, the block restriction is a `block-restriction` static (CR 509.1b),
// and the Adventure is a `moveZone` bounce (the Boomerang script) behind the
// Banishing Light target shape.
// ─────────────────────────────────────────────────────────────────────────────

// Brazen Borrower — {1}{U}{U} Creature — Faerie Rogue, 3/1 (ELD). Modern
// Scryfall oracle text is authoritative (ADR 0004).
//
// CR 509.1b — "This creature can block only creatures with flying" is a
// BLOCKER-side restriction: `self` is this creature, `opponent` the attacker it
// wants to block. Declared as a static rather than a keyword because no keyword
// exists for it (the Mechanics Registry is the name authority, and it censuses
// none) and because CR 509.1b is where the combat validator reads it.
//
// Guard C — the LAYOUT is not the gap. `SUPPORTED_INSET_LAYOUTS` admits
// `"adventure"` as of this slice, and Petty Theft's own half compiles cleanly
// (its `moveZone` bounce and target requirement below ARE what the grammar
// lowered). What grammar v0 has no slot for is the BLOCK RESTRICTION, which is
// why every other `block-restriction` card in the catalogue (Metathran
// Transport, Stone Spirit, Hipparion, …) sits in Guard C's baseline. A new card
// cannot be added to that baseline, so it names the fragment instead — the
// fragment being the deliverable that ranks the next grammar rule (PRD #2693
// user story 9). A compiled block restriction needs a NEW member on the closed
// `CompiledStaticEffect` union — a JSON-pure descriptor, since a closure cannot
// reach a serialized catalogue row — which is a mechanic of its own and belongs
// on its own diff, the same split ADR 0120 §6 made for Bonecrusher Giant. That
// work is issue #3315; this marker retires with it.
// compiler-gap: "This creature can block only creatures with flying." (#3315)
export const brazenBorrower: CardDefinition = {
    id: "c2089ec9-0665-448f-bfe9-d181de127814",
    rarity: "mythic",
    name: "Brazen Borrower",
    oracleText:
        "Flash\nFlying\nThis creature can block only creatures with flying.",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Faerie", "Rogue"],
    power: 3,
    toughness: 1,
    staticAbilities: ["flash", "flying"],
    staticEffects: [
        {
            kind: "block-restriction",
            id: "brazen-borrower-blocks-only-flying",
            side: "blocker" as const,
            // CR 509.1b — self = Brazen Borrower (blocker), opponent = the
            // attacker it wants to block; the block is legal only when that
            // attacker flies. The block-restriction `PermanentView` carries
            // keywords on `staticAbilities` (cast, mirroring Stone Spirit's
            // mirror-image check in `ice/red.ts`).
            predicate: (_self, opponent) =>
                (
                    (opponent as { staticAbilities?: string[] })
                        .staticAbilities ?? []
                ).includes("flying"),
            oracleText: "Brazen Borrower can block only creatures with flying.",
        },
    ],
    // CR 715.2 — the inset frame. `kind: "adventure"` is what makes the parent
    // offer the cast option at all (CR 715.3); a `"prepare"` half never would
    // (CR 722.3).
    insetSpell: {
        kind: "adventure",
        name: "Petty Theft",
        manaCost: { X: 1, U: 1 },
        types: ["Instant"],
        subtypes: ["Adventure"],
        oracleText:
            "Return target nonland permanent an opponent controls to its owner's hand.",
        // The Banishing Light target shape: the full CR 300.1 permanent-type
        // set minus Land ("nonland permanent"), scoped to the opponent's
        // battlefield.
        targetRequirement: {
            type: [...PERMANENT_TYPES],
            count: 1,
            excludeTypes: ["Land"],
            controller: "opponent",
        },
        // CR 400.7 — the Boomerang script, verbatim.
        effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
    },
};
