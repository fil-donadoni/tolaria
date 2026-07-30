// IKO — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as iko from "./sets/iko"` resolves through iko/index.ts.

import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Lutri, the Spellchaser — Companion framework tracer card (issue #1391,
// ADR 0064). "Companion — Each nonland card in your starting deck has a
// different name. Flash. When Lutri enters, if you cast it, copy target
// instant or sorcery spell you control. You may choose new targets for the
// copy." (CR 702.139 Companion, CR 702.8 Flash, CR 603.6a ETB, CR 707.10
// copy-a-spell.) Its companion condition is Singleton (`singleton`,
// gre/companion.ts) — the SAME predicate module `selectCompanion` reads at
// game init to auto-declare it into the slot when the controller's Maindeck
// qualifies.
//
// Printed cost is {1}{U/R}{U/R} — TWO HYBRID U/R pips, declared via
// `manaCost.hybrid` (issue #1338) and payable with mana off either colour of
// land (issues #1738/#1739, PRD #1736, landed #1755) — see Figure of Destiny
// (eve/multicolor.ts) for the reference shape. This closes the divergence
// this card previously shipped under (tracked-by #782), the same gap that
// stubbed Deathrite Shaman (rtr/multicolor.ts).
export const lutri: CardDefinition = {
    // Kept as a literal (not imported from `gre/companion.ts`'s `LUTRI_ID`):
    // that module imports `tryGetDefinition` from the card registry
    // (`../cards`), which barrel-imports every set INCLUDING this file —
    // importing `LUTRI_ID` back here would form a real import CYCLE
    // (multicolor.ts → gre/companion.ts → cards/index.ts → multicolor.ts).
    // In a circular ES-module load a plain object-literal property (unlike a
    // live named-import binding) SNAPSHOTS whatever value the cycle had
    // reached at that instant — order-dependent and, in one import order,
    // `undefined`. `gre/companion.ts`'s `LUTRI_ID` const is this exact same
    // literal; kept in sync by `convex/cards/__tests__/mechanicsRegistry.test.ts`'s
    // catalogue sweep (the card must resolve to a registered `companion`
    // condition) plus this file's own card test.
    id: "fb1189c9-7842-466e-8238-1e02677d8494",
    rarity: "rare",
    name: "Lutri, the Spellchaser",
    oracleText:
        "Companion — Each nonland card in your starting deck has a different name. (If this card is your chosen companion, you may put it into your hand from outside the game for {3} as a sorcery.)\nFlash\nWhen Lutri enters, if you cast it, copy target instant or sorcery spell you control. You may choose new targets for the copy.",
    manaCost: {
        generic: 1,
        hybrid: [
            ["U", "R"],
            ["U", "R"],
        ],
    },
    types: ["Creature"],
    // CR 205.4a — type line is "Legendary Creature — Elemental Otter"
    // (Scryfall); the legend rule (CR 704.5j) only applies via this
    // supertype.
    supertypes: ["Legendary"],
    subtypes: ["Elemental", "Otter"],
    power: 3,
    toughness: 2,
    // CR 702.139a / 702.8 — Companion is a Mechanics Registry keyword row
    // (status "implemented", binding gre/companion.ts, Guard A); Flash is
    // the standard instant-speed-casting keyword (already implemented).
    staticAbilities: ["companion", "flash"],
    triggeredAbilities: [
        enteredTrigger({
            id: "lutri-etb",
            oracleText:
                "When Lutri enters, if you cast it, copy target instant or sorcery spell you control. You may choose new targets for the copy.",
            scope: "self",
            // CR 603.4 check-time condition — "if you cast it" reads the
            // `wasCast` flag `finalizeSpellResolution` stamps ONLY at the
            // cast-resolution chokepoint (cards/types.ts
            // `PermanentEnteredEvent.wasCast`), so a Lutri put onto the
            // battlefield any other way (reanimation, a tutor effect, a
            // future flicker) never fires the copy.
            condition: (event) => event.wasCast === true,
            // CR 113 / 114.1 — target an instant or sorcery spell the
            // CONTROLLER of Lutri controls (`controller: "you"`, extended
            // onto spell/ability stack targets alongside the existing
            // battlefield/graveyard/player uses of the same filter — issue
            // #1391). "Up to" is not in the oracle text (a plain "target",
            // not "up to one target"), so `count: 1` — the trigger doesn't
            // go on the stack at all if there is no legal target (CR
            // 603.3c).
            targetRequirement: {
                type: "spell",
                count: 1,
                spellTypeFilter: ["Instant", "Sorcery"],
                controller: "you",
            },
            // protocol card: `copyStackItem`/`requestCopyRetarget` are
            // `SpellContext`-only primitives with NO Effect Script Op
            // wrapper anywhere in the registry (grepped `EFFECT_OP_REGISTRY`
            // for "copy" — zero hits) — copying a spell on the stack is a
            // resolve()-only capability by design across the whole codebase,
            // not a gap specific to this card. Fork (lea/red.ts) is the
            // sole existing precedent and uses the identical shape.
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target || target.type !== "spell") return;
                const copyId = ctx.copyStackItem(target.id);
                if (copyId) ctx.requestCopyRetarget(copyId);
            },
        }),
    ],
};

// Lurrus of the Dream-Den — Companion framework (issue #1392, ADR 0064).
// "Companion — Each permanent card in your starting deck has mana value 2 or
// less. Lifelink. Once during each of your turns, you may cast a permanent
// spell with mana value 2 or less from your graveyard." (CR 702.139
// Companion, CR 702.15 Lifelink, CR 702.139/305.1-analog the STATIC
// graveyard-permanent-cast permission below.) Its companion condition is
// `permanentManaValueAtMost2` (`gre/companion.ts`, built on the shared
// `everyPermanent` combinator) — the SAME predicate module `selectCompanion`
// reads at game init to auto-declare it into the slot when the controller's
// Maindeck qualifies.
//
// Printed cost is {1}{W/B}{W/B} — TWO HYBRID W/B pips, declared via
// `manaCost.hybrid` (issue #1338) and payable with mana off either colour of
// land (issues #1738/#1739, PRD #1736, landed #1755) — see Figure of Destiny
// (eve/multicolor.ts) for the reference shape. This closes the divergence
// this card previously shipped under (tracked-by #782), the same gap that
// stubbed Deathrite Shaman (rtr/multicolor.ts) and previously narrowed Lutri
// (`lutri` above, same file).
//
// The graveyard-cast ability ("Once during each of your turns, you may cast
// a permanent spell with mana value 2 or less from your graveyard") is a
// STATIC, battlefield-derived permission — `castsPermanentsFromGraveyard:
// { maxManaValue: 2 }`, read live off the battlefield by
// `canCastPermanentFromGraveyardByPermission` (gre/rules.ts), mirroring how
// Icetill Explorer's `playsLandsFromGraveyard: true` is a bare declarative
// field, not an activated/triggered ability or an Effect Script Op. Lifelink
// is a standard implemented keyword (Mechanics Registry, CR 702.15).
export const lurrus: CardDefinition = {
    // Kept as a literal (not imported from `gre/companion.ts`'s `LURRUS_ID`):
    // same import-cycle rationale as `lutri` above (multicolor.ts →
    // gre/companion.ts → cards/index.ts → multicolor.ts). `gre/companion.ts`'s
    // `LURRUS_ID` const is this exact same literal; kept in sync by
    // `convex/cards/__tests__/mechanicsRegistry.test.ts`'s catalogue sweep
    // plus this file's own card test.
    id: "5ad36fb2-c44e-4085-ba0d-54277841ad3a",
    rarity: "rare",
    name: "Lurrus of the Dream-Den",
    oracleText:
        "Companion — Each permanent card in your starting deck has mana value 2 or less. (If this card is your chosen companion, you may put it into your hand from outside the game for {3} as a sorcery.)\nLifelink\nOnce during each of your turns, you may cast a permanent spell with mana value 2 or less from your graveyard.",
    manaCost: {
        generic: 1,
        hybrid: [
            ["W", "B"],
            ["W", "B"],
        ],
    },
    types: ["Creature"],
    // CR 205.4a — type line is "Legendary Creature — Cat Nightmare"
    // (Scryfall); the legend rule (CR 704.5j) only applies via this
    // supertype.
    supertypes: ["Legendary"],
    subtypes: ["Cat", "Nightmare"],
    power: 3,
    toughness: 2,
    // CR 702.139a / 702.15 — Companion and Lifelink are both Mechanics
    // Registry keyword rows with `status: "implemented"` (Guard A).
    staticAbilities: ["companion", "lifelink"],
    castsPermanentsFromGraveyard: { maxManaValue: 2 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Zirda, the Dawnwaker — the THIRD Vintage Cube companion (with `lutri` and
// `lurrus` above), deliberately NOT shipped. ADR 0064 scoped the Companion
// slice to "framework + Lutri + Lurrus; Zirda is a stop-and-issue stub":
//
//   "Abilities you activate that aren't mana abilities cost {2} less to
//    activate. This effect can't reduce the mana in that cost to less than
//    one mana."
//
// is a genuine new COST-SYSTEM capability on a seam the engine does not have.
// The ability-activation path reads `ability.cost.mana` raw; ADR 0063's cost
// modifier seam covers CAST costs only, and this clause additionally carries
// an unusual ">= one mana" floor (CR 601.2f / 118.7 — the reduction may not
// take the remaining mana cost below a single mana symbol, generic or
// coloured). Shipping Zirda with that clause silently inert is exactly the
// Guard-A anti-pattern (`.claude/rules/gre-development.md` — a card that
// declares a mechanic it does not have ships functional-looking and dead),
// so the card stays commented until the capability lands. Its companion
// condition would be `everyPermanent((def) => hasActivatedAbility(def))` —
// the `everyPermanent` combinator (gre/companion.ts) already exists and was
// factored out for exactly this second consumer.
//
// Stop-and-issue per gre-development.md; tracked-by: #1339.
// export const zirda: CardDefinition = {
//     id: "1bd8e61c-2ee8-4243-a848-7008810db8a0",
//     rarity: "rare",
//     name: "Zirda, the Dawnwaker",
//     oracleText:
//         "Companion — Each permanent card in your starting deck has an activated ability. (If this card is your chosen companion, you may put it into your hand from outside the game for {3} as a sorcery.)\nAbilities you activate that aren't mana abilities cost {2} less to activate. This effect can't reduce the mana in that cost to less than one mana.\n{1}, {T}: Target creature can't block this turn.",
//     // DIVERGENCE (tracked-by: #1339): printed cost is {1}{R/W}{R/W} — two
//     // HYBRID R/W pips. #782 (the land-based-hybrid-payment gap narrowed on
//     // `lutri`/`lurrus` above) is now closed, so this would use `manaCost.hybrid`
//     // like they do if shipped — but Zirda stays commented for the SEPARATE,
//     // still-open #1339 (the cost-reduction-ability gap above). Declared here
//     // as {1}{R}{W} pending that.
//     manaCost: { generic: 1, R: 1, W: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Elemental", "Fox"],
//     power: 3,
//     toughness: 3,
//     staticAbilities: ["companion"],
// };
