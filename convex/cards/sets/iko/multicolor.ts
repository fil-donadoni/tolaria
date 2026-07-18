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
// DIVERGENCE (tracked-by: #782): Lutri's printed cost is {1}{U/R}{U/R} — TWO
// HYBRID U/R pips. `ManaCost` (cards/types.ts) has no hybrid-pip
// representation at all (no `hybrid`/alternate-pip field, only fixed
// per-colour counts) — the exact gap that stubs Deathrite Shaman
// (rtr/multicolor.ts, also tracked-by #782). Declared here as the closest
// faithful NON-hybrid narrowing — {1}{U}{R} (`generic: 1, U: 1, R: 1`) —
// which never permits an illegal cast, only forbids some legal ones a
// hybrid-flexible deck (e.g. mono-red or mono-blue heavy) could otherwise
// make. This keeps the Companion FRAMEWORK (the point of #1391 — slot,
// auto-declare, {3} summon special action) fully exercisable end-to-end
// through a real, castable card while the underlying hybrid-mana capability
// remains its own tracked gap, consistent with the existing #782 precedent.
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
    manaCost: { generic: 1, U: 1, R: 1 },
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
