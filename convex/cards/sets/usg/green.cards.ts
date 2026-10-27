// usg — green cards (ADR 0043 colour split).

import { defineCard } from "../../types";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import type { Color } from "../../types";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";
import { COLOR_OPTIONS, colorChoiceModes } from "../../abilities/chooseColor";

// Argothian Enchantress — "Shroud. Whenever you cast an enchantment spell,
// draw a card." (CR 702.18 shroud; CR 603.2 + 601.2i spell-cast trigger; CR
// 121.1 draw.) The draw is mandatory (contrast the sibling Verduran
// Enchantress' optional "you may draw"), so its effect is a DSL Effect Script
// rather than a resolve() closure (ADR 0045).
//
// The printed shroud is LIVE, not decorative: unlike the paired
// `permanent-guard` staticEffect pattern used by e.g. Blastoderm
// (`nem/green.cards.ts`), `permanentGuard.ts::isGuardedAgainst` also bridges the
// bare `staticAbilities: ["shroud"]` string directly (the `hasShroud`
// helper, mirroring the existing `hasHexproof` bridge for CR 702.11b),
// unfiltered per CR 702.18 — so no separate staticEffect is required here.
// See the Mechanics Registry's shroud row (issue #959) for the catalogue-
// wide fix.
export const argothianEnchantress = defineCard(() => ({
    id: "9ababc1a-515e-4e20-8819-19d84d9b0af5",
    rarity: "rare",
    name: "Argothian Enchantress",
    oracleText:
        "Shroud (This creature can't be the target of spells or abilities.)\nWhenever you cast an enchantment spell, draw a card.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Druid"],
    power: 0,
    toughness: 1,
    staticAbilities: ["shroud"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "argothian-enchantress-draw",
            oracleText: "Whenever you cast an enchantment spell, draw a card.",
            scope: "you",
            filter: { types: "Enchantment" },
            // Mandatory draw, event-independent → DSL Effect Script (ADR 0045).
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
    ],
}));

// Exploration — {G} Enchantment. "You may play an additional land on each of
// your turns." (CR 305.2 — extra land drops.) One additional land drop (total
// 2/turn), the bounded analogue of Fastbond's `extraLandDrops: 999`
// (lea/green.cards.ts).
export const exploration = defineCard(() => ({
    id: "2f09e451-0246-45a2-8bfd-07d3c65ddfe6",
    rarity: "rare",
    name: "Exploration",
    oracleText: "You may play an additional land on each of your turns.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    extraLandDrops: 1,
}));

// Fertile Ground — {1}{G} Enchantment — Aura, enchant land. "Whenever
// enchanted land is tapped for mana, its controller adds an additional one
// mana of any color." (CR 303.4 aura attachment, CR 603.2 PERMANENT_TAPPED
// trigger, CR 605 mana ability.)
//
// NOT DSL-migratable (ADR 0045, twin of Wild Growth, `lea/green.cards.ts`, same
// tranche convention; re-verified against the current engine, 2026-07):
// `tappedTrigger` now DOES have an `effects[]` site, but its script only
// binds the SOURCE's controller (`ctx.controller`) and `$source` — the
// tapped permanent's last-known-info (id, controller, subtypes) is a
// separate payload never threaded into the script (`TappedTriggerArgs.effects`
// doc, `tappedTrigger.ts`). Fertile Ground's recipient is the ENCHANTED
// LAND's controller, who can differ from the Aura's own controller (no
// controller-filter on the target), so this still needs the imperative
// `resolve` callback's `tapped.controllerId`.
// Blocked on: an event-field player ref reachable from a `tappedTrigger`
// script (same gap Wild Growth's own comment documents). tracked-by: #2153
// The runtime colour choice reuses the shared `COLOR_OPTIONS` list
// (`abilities/chooseColor.ts`).

//
// Home set = earliest paper printing (ADR 0041) = Urza's Saga; it was first
// implemented against the INV reprint, which filed it under the
// wrong home set and rendered the wrong art. That printing now rides along
// as a `CardPrint` in `inv/green.cards.ts`.
export const fertileGround = defineCard(() => ({
    id: "091dda35-59e5-456d-8804-61513a610aed", // USG 252
    rarity: "common",
    name: "Fertile Ground",
    oracleText:
        "Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional one mana of any color.",
    manaCost: { X: 1, G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    triggeredAbilities: [
        tappedTrigger({
            id: "fertile-ground-extra-mana",
            oracleText:
                "Whenever enchanted land is tapped for mana, its controller adds an additional one mana of any color.",
            scope: "any",
            forMana: true,
            manaAbility: true, // CR 605.1b / 605.4 — resolves without the stack
            // CR 605.4 — predictive extra-mana descriptor: the enchanted land
            // yields one additional mana of any colour (chosen at resolve). The
            // castability gate models it as fully flexible; the auto-tap solver
            // treats it as generic (it can't pre-encode the colour choice).
            manaBonusForPotential: {
                appliesTo: "host",
                amount: { kind: "anyColor", count: 1 },
            },
            condition: (event, self) =>
                !!self.attachedTo && event.permanentId === self.attachedTo,
            resolve: (ctx, _event, tapped) => {
                const chosen = ctx.requestOptionChoice({
                    playerId: tapped.controllerId,
                    choiceId: `fertile-ground-${ctx.sourceInstanceId}`,
                    options: COLOR_OPTIONS,
                    prompt: "Fertile Ground: add one mana of which color?",
                });
                if (chosen === undefined) return; // suspended
                ctx.addManaTo(tapped.controllerId, {
                    [chosen as Color]: 1,
                });
            },
            // aiEffects (PRD #1423, issue #1519) — this ability is a bare
            // `resolve()` closure (the runtime colour choice + the
            // cross-player `tapped.controllerId` recipient have no Op skin
            // reachable from a `tappedTrigger` script, see the NOT
            // DSL-migratable note above), so the bot's `cardValueById`/
            // `latentValue` value model has nothing to walk without a
            // shadow. `addMana` (issue #850) only takes a fixed per-colour
            // map — "any colour" isn't a static amount — so the shadow picks
            // one representative pip (`{ C: 1 }`); `OP_VALUERS.addMana` sums
            // total pips regardless of colour, so this scores identically to
            // the real "any one colour" grant (same shape as Wild Growth's
            // fixed-`{G:1}` twin, `lea/green.cards.ts`).
            aiEffects: [{ op: "addMana", mana: { C: 1 } }],
        }),
    ],
}));

// Carpet of Flowers — {G} Enchantment. "At the beginning of each of your main
// phases, if you haven't added mana with this ability this turn, you may add X
// mana of any one color, where X is the number of Islands target opponent
// controls." (CR 603.2 phase-begin trigger over BOTH main phases — one Oracle
// line, one ability; CR 603.3d the opponent is targeted as the trigger goes on
// the stack; CR 106.1 + CR 500.5 the mana is added to the controller's pool.)
//
// The colour is one `optionChoice` mode per colour (`colorChoiceModes`), each
// an `addMana` whose amount is a `count` of the targeted opponent's Islands read
// at resolution. "Haven't added mana with this ability this turn" is
// `maxTriggersPerTurn: 1` (a per-source tally), made exact by the `matches`
// gate: the ability only triggers while the opponent has an Island, so a
// zero-Island main phase adds nothing and does not spend the turn's one use.
// The "you may" is not offered: unspent mana has no cost, so adding is never
// worse than declining, and a decline would spend the use for nothing.
export const carpetOfFlowers = defineCard(() => ({
    id: "93abb48a-85f2-432d-8602-0a1d17fbb409",
    rarity: "uncommon",
    name: "Carpet of Flowers",
    oracleText:
        "At the beginning of each of your main phases, if you haven't added mana with this ability this turn, you may add X mana of any one color, where X is the number of Islands target opponent controls.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "carpet-of-flowers-main-phase",
            oracleText:
                "At the beginning of each of your main phases, if you haven't added mana with this ability this turn, you may add X mana of any one color, where X is the number of Islands target opponent controls.",
            event: "PHASE_BEGIN",
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            maxTriggersPerTurn: 1,
            matches: (event, self, state) =>
                event.type === "PHASE_BEGIN" &&
                (event.phase === "PRECOMBAT_MAIN" ||
                    event.phase === "POSTCOMBAT_MAIN") &&
                event.activePlayerId === self.controllerId &&
                !!state?.players.some(
                    (p) =>
                        p.id !== self.controllerId &&
                        p.battlefield.some((c) => c.subtypes.includes("Island"))
                ),
            effects: [
                {
                    op: "optionChoice",
                    prompt: "Carpet of Flowers: add mana of which color?",
                    modes: colorChoiceModes((color) => [
                        {
                            op: "addMana",
                            mana: {
                                [color]: {
                                    count: {
                                        zone: "battlefield",
                                        controller: { target: 0 },
                                        filter: { subtype: "Island" },
                                    },
                                },
                            },
                        },
                    ]),
                },
            ],
        },
    ],
}));
