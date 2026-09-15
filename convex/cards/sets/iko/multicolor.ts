// IKO — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as iko from "./sets/iko"` resolves through iko/index.ts.

import type { CardDefinition, SpellContext } from "../../types";
import { CASTABLE_PERMANENT_TYPES } from "../../types";
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
    // CR 702.139a companion / 702.8 flash — Companion is a Mechanics Registry
    // keyword row (status "implemented", binding gre/companion.ts, Guard A);
    // Flash is the standard instant-speed-casting keyword (already implemented).
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
// STATIC, battlefield-derived permission — a row on the one graveyard play
// permission record (ADR 0093): cast only, permanent card types, mana value
// 2 or less, once per turn (the use keyed to THIS source), during its
// controller's own turn only — read live off the battlefield by the single
// resolver `getGraveyardPlayPermissions` (gre/rules.ts). The same bare
// declarative field as Icetill Explorer's, not an activated/triggered ability
// or an Effect Script Op. Lifelink is a standard implemented keyword
// (Mechanics Registry, CR 702.15).
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
    graveyardPlayPermission: {
        actions: ["cast"],
        cardTypes: [...CASTABLE_PERMANENT_TYPES],
        maxManaValue: 2,
        oncePerTurn: true,
        yourTurnOnly: true,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Zirda, the Dawnwaker — the THIRD Vintage Cube companion (with `lutri` and
// `lurrus` above). #1339 shipped the seam this card needed: on triage the
// activated-ability cost-modifier machinery (`StaticCostModifier.costReduction`
// / `minTotalMana`, threaded through `getCostModifiers` into
// `applyCostModifiers`) turned out to be ALREADY wired to the real activation
// path (`convex/game.ts`), exercised by Power Artifact (atq/blue.ts) — the
// stub's comment claiming the seam didn't exist had gone stale. The one
// genuine gap #1339 closed: `appliesToAbility` only ever received the ability's
// SOURCE permanent, never the ability itself, so nothing could express "...
// that aren't mana abilities" — added as its optional fourth argument.
//
// "Abilities you activate that aren't mana abilities cost {2} less to
// activate. This effect can't reduce the mana in that cost to less than one
// mana." (CR 601.2f cost reduction, 118.7 floor, CR 605.1a mana ability —
// `useStack: false`.) Scoped to the CONTROLLER's own abilities
// (`source.controllerId === effectSource.controllerId`, the same "you
// control" shape Stone Calendar's spell-side reduction uses,
// drk/colorless.ts) rather than to a single attached host (Power Artifact's
// Aura scopes via `attachedTo`) — Zirda has no host, it reduces every
// non-mana ability its controller activates, board-wide.
//
// Its companion condition is `permanentHasActivatedAbility`
// (`gre/companion.ts`, built on the shared `everyPermanent` combinator) — the
// SAME predicate module `selectCompanion` reads at game init to auto-declare
// it into the slot when the controller's maindeck qualifies.
//
// Printed cost is {1}{R/W}{R/W} — TWO HYBRID R/W pips, declared via
// `manaCost.hybrid` (issue #1338) exactly like `lutri`/`lurrus` above, in
// place of the stub's earlier `{ generic: 1, R: 1, W: 1 }` placeholder.
//
// "{1}, {T}: Target creature can't block this turn." reuses the already
// exercised `restrictCombat` Op (`restriction: "cant-block"`, ADR 0053) on an
// announced target — the same shape Stun (tmp/red.ts) exercises — so no new
// Op and no hand-written test beyond the catalogue's static sweep + smoke
// test (per-Op regime, `.claude/rules/gre-development.md`).
//
// compiler-gap: "Companion — Each permanent card in your starting deck has an activated ability." (#2693)
// compiler-gap: "Abilities you activate that aren't mana abilities cost {2} less to activate. This effect can't reduce the mana in that cost to less than one mana." (#2693)
// compiler-gap: "{1}, {T}: Target creature can't block this turn." (#2693)
export const zirda: CardDefinition = {
    // Kept as a literal (not imported from `gre/companion.ts`'s `ZIRDA_ID`) —
    // same anti-cycle rationale as `lutri`/`lurrus` above (multicolor.ts →
    // gre/companion.ts → cards/index.ts → multicolor.ts).
    id: "1bd8e61c-2ee8-4243-a848-7008810db8a0",
    rarity: "rare",
    name: "Zirda, the Dawnwaker",
    oracleText:
        "Companion — Each permanent card in your starting deck has an activated ability. (If this card is your chosen companion, you may put it into your hand from outside the game for {3} as a sorcery.)\nAbilities you activate that aren't mana abilities cost {2} less to activate. This effect can't reduce the mana in that cost to less than one mana.\n{1}, {T}: Target creature can't block this turn.",
    manaCost: {
        generic: 1,
        hybrid: [
            ["R", "W"],
            ["R", "W"],
        ],
    },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Elemental", "Fox"],
    power: 3,
    toughness: 3,
    // CR 702.139a — Companion is a Mechanics Registry keyword row with
    // `status: "implemented"` (Guard A).
    staticAbilities: ["companion"],
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToAbility: (source, _ctx, effectSource, ability) =>
                !!effectSource &&
                source.controllerId === effectSource.controllerId &&
                ability?.useStack !== false,
            costReduction: { X: 2 },
            minTotalMana: 1,
        },
    ],
    activatedAbilities: [
        {
            id: "zirda-cant-block",
            oracleText: "{1}, {T}: Target creature can't block this turn.",
            cost: { mana: { X: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "restrictCombat",
                    restriction: "cant-block",
                    target: { target: 0 },
                },
            ],
        },
    ],
};
