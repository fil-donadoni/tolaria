// BIG — green cards, split by colour per ADR 0043. The registry's
// `import * as big from "./sets/big"` resolves through big/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { diedTrigger } from "../../abilities/triggers/diedTrigger";
import { enteringEffectivePower } from "../../abilities/triggers/shared";
import { GOLEM_TOKEN } from "../../sharedTokens";

// Sandstorm Salvager — {2}{G} Creature — Human Artificer, 1/1 (Cube FREE
// residue token-maker, issue #1304). "When this creature enters, create a
// 3/3 colorless Golem artifact creature token. {2}, {T}: Put a +1/+1 counter
// on each creature token you control. They gain trample until end of turn."
// (CR 603.6a ETB + 701.7 Create; CR 122.6 counter placement + CR 611.2c
// duration-scoped keyword grant, both mass-applied via `forEach` over
// "creature tokens you control", `PermanentFilter.isToken`/`EffectCardFilter.
// isToken`, issue #920.) Fully DSL — every Op here (`createToken`, `forEach`,
// `counters`, `grantAbility`) is already exercised catalogue-wide; the
// `forEach`-bearing activated ability is exempt from the auto-generated
// canned-scenario smoke sweep (`scenarioGenerator.ts` skips every forEach
// script — "covered by the card's own tests") so it gets a hand-written test
// in `sets/big/__tests__/green.test.ts` per gre-development.md's own carve-out.
export const sandstormSalvager: CardDefinition = {
    id: "13b0f27c-a359-4702-833a-82fec161eeec",
    rarity: "mythic",
    name: "Sandstorm Salvager",
    oracleText:
        "When this creature enters, create a 3/3 colorless Golem artifact creature token.\n{2}, {T}: Put a +1/+1 counter on each creature token you control. They gain trample until end of turn.",
    manaCost: { generic: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Artificer"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        enteredTrigger({
            id: "sandstorm-salvager-etb-golem",
            oracleText:
                "When this creature enters, create a 3/3 colorless Golem artifact creature token.",
            scope: "self",
            effects: [
                {
                    op: "createToken",
                    // Shared 3/3 colorless Golem spec (`sharedTokens.ts`) —
                    // extracted on Legion Extruder, the second producer
                    // (issue #2367).
                    token: GOLEM_TOKEN,
                    controller: "controller",
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "sandstorm-salvager-token-buff",
            oracleText:
                "{2}, {T}: Put a +1/+1 counter on each creature token you control. They gain trample until end of turn.",
            cost: { mana: { generic: 2 }, tap: true },
            useStack: true,
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature", isToken: true },
                    },
                    effects: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$each" },
                            count: 1,
                        },
                        {
                            op: "grantAbility",
                            ability: "trample",
                            target: { ref: "$each" },
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    ],
};

// Vaultborn Tyrant — {5}{G}{G} Creature — Dinosaur, 6/6 (Cube FREE wave 3,
// issue #1531/#1525, unblocked by #2364). "Trample\nWhenever this creature or
// another creature you control with power 4 or greater enters, you gain 3
// life and draw a card.\nWhen this creature dies, if it's not a token,
// create a token that's a copy of it, except it's an artifact in addition to
// its other types."
//
// The ETB half mirrors Kavu Lair's own power check (`sets/inv/green.ts`) —
// the event payload carries no power field, so `condition` reads the
// entering permanent's power off the `TriggerStateView` snapshot — but with
// `scope: "yours"` (CR 109.2: "this creature or another creature you
// control" = self ∪ any OTHER creature under the same controller) rather
// than Kavu Lair's `"any"`; the payout is always THIS permanent's own
// controller, so `effects[]` reads `"controller"` directly instead of
// `{ ref: "$event.controllerId" }`.
//
// The dies half was blocked on #2364 (`TokenSpec`/`EffectTokenSpec` had no
// `triggeredAbilities` field at all); now unblocked, it's `SpellContext.
// createTokenCopyOf` (CR 707.2 — Dance of Many's own primitive) rather than a
// hand-authored `createToken` spec: `opts.lastKnownFromGraveyardOrExile`
// (`gre/state.ts`) looks the dead creature up by id in the CURRENT
// graveyard/exile zone at resolution time — it is a live zone search, not a
// last-known-information snapshot of the card as it existed on the
// battlefield. The option was built for Eternalize (#2339), where the
// ACTIVATION COST ("exile this card from your graveyard: …") guarantees the
// source is still sitting in exile when the ability resolves; a triggered
// dies ability has no such guarantee; a card carries no cost, and the dying
// creature can legally leave the graveyard (shuffled into a library, e.g. by
// an opponent's instant-speed Krosan Reclamation — `sets/jud/green.ts`)
// before this trigger resolves. In that case the zone search finds nothing,
// `source` is `undefined`, and `createTokenCopyOf` returns `undefined`
// SILENTLY — no token, no error — which is a narrower behaviour than CR
// 608.2b/707.2 call for (the token should still be created from the
// creature's last-known battlefield characteristics). Known, tracked gap:
// docs/findings/2364-createTokenCopyOf-graveyard-lookup-is-not-lki.md. Fixing
// it for real needs an engine capability this PR does not add (a copy
// source resolvable from a last-known definition id, not a live zone
// lookup). Separately, `opts.additionalTypes: ["Artifact"]` supplies the "except it's an artifact
// in addition to its other types" clause (the SAME `CopyEffectOptions` field
// Copy Artifact documents). `applyCopy` overwrites the token's `card.id` with
// Vaultborn Tyrant's OWN definition id (`gre/copy.ts`), so the token
// presents the real printed definition: its art comes free (no token-print
// lookup, no lockfile entry needed — `resolveCardImageId` only special-cases
// `token:`-prefixed ids, and this one isn't), and `effectiveTriggeredAbilities`
// reads the SAME `triggeredAbilities` array this card itself carries (CR
// 707.2 — a copy has the same abilities the original had) with real,
// working closures — not a re-authored duplicate. `vaultbornTyrantDiesTrigger`'s
// own `condition: (_event, self) => !self.isToken` does real work once the
// token presents it too: `applyCopy` never touches `isToken` (only
// `card.id`/types/subtypes/P-T/staticAbilities/color/mana-cost/art), so the
// condition still reads `true` on the token and the trigger's own `matches`
// returns false for the token's own death — no infinite copy chain, closing
// the exact gap the tracked stub warned about ("no 'if it's not a token'
// self-check without the trigger existing at all").
const vaultbornTyrantEtbTrigger = enteredTrigger({
    id: "vaultborn-tyrant-etb-power-4",
    oracleText:
        "Whenever this creature or another creature you control with power 4 or greater enters, you gain 3 life and draw a card.",
    scope: "yours",
    filter: { types: "Creature" },
    // CR 603.2 / 613.4 (issue #1852) — EFFECTIVE power through the layer
    // pipeline, so a creature entering with +1/+1 counters or under an anthem
    // is weighed at the size it actually enters as.
    condition: (event, _self, state) =>
        (enteringEffectivePower(event, state) ?? 0) >= 4,
    effects: [
        { op: "gainLife", player: "controller", amount: 3 },
        { op: "draw", player: "controller", count: 1 },
    ],
});

const vaultbornTyrantDiesTrigger = diedTrigger({
    id: "vaultborn-tyrant-dies-copy",
    oracleText:
        "When this creature dies, if it's not a token, create a token that's a copy of it, except it's an artifact in addition to its other types.",
    scope: "self",
    condition: (_event, self) => !self.isToken,
    // protocol card: CR 707.2's copy machinery (`applyCopy` id-swap onto the
    // token, carrying the printed definition's real triggered-ability
    // closures and art) has no Effect Script Op exposing `additionalTypes` +
    // `lastKnownFromGraveyardOrExile` together — `createTokenCopy`'s DSL skin
    // (`gre/effects/interpreter.ts`) only maps `except.additionalSubtypes`,
    // not `additionalTypes`. Calling the `SpellContext` primitive directly
    // is a straight one-line composition, not a card-shaped closure.
    resolve: (ctx, _event, deadCreature) => {
        ctx.createTokenCopyOf(
            deadCreature.id,
            ctx.controller,
            deadCreature.id,
            {
                lastKnownFromGraveyardOrExile: true,
                additionalTypes: ["Artifact"],
            }
        );
    },
    // aiEffects (PRD #1423, issue #1431/#2364) — bare `resolve()` closure
    // (no Effect Op exposes `createTokenCopyOf`'s `additionalTypes` +
    // `lastKnownFromGraveyardOrExile` combination, see the comment above), so
    // the bot's value model has nothing to walk without a shadow script.
    // Approximates
    // the real effect closely enough for valuation: a 6/6 trampler token
    // appears (the shadow omits the token's own triggeredAbilities — the
    // valuer doesn't need that fidelity to weigh "a 6/6 trample body
    // re-enters", which is what the death of a 6/6 mythic actually costs the
    // opponent).
    aiEffects: [
        {
            op: "createToken",
            token: {
                name: "Vaultborn Tyrant",
                types: ["Artifact", "Creature"],
                subtypes: ["Dinosaur"],
                power: 6,
                toughness: 6,
                staticAbilities: ["trample"],
            },
            controller: "controller",
        },
    ],
});

export const vaultbornTyrant: CardDefinition = {
    id: "62b3f560-262b-4bc3-9aef-535fd7082c28",
    name: "Vaultborn Tyrant",
    rarity: "mythic",
    oracleText:
        "Trample\nWhenever this creature or another creature you control with power 4 or greater enters, you gain 3 life and draw a card.\nWhen this creature dies, if it's not a token, create a token that's a copy of it, except it's an artifact in addition to its other types.",
    manaCost: { generic: 5, G: 2 },
    types: ["Creature"],
    subtypes: ["Dinosaur"],
    power: 6,
    toughness: 6,
    staticAbilities: ["trample"],
    triggeredAbilities: [vaultbornTyrantEtbTrigger, vaultbornTyrantDiesTrigger],
};

// Ancient Cornucopia — "Whenever you cast a spell that's one or more colors,
// you may gain 1 life for each of that spell's colors. Do this only once
// each turn.\n{T}: Add one mana of any color."
//
// FREED 2026-08-25 (#1841 audit): the old marker read "`TriggeredAbility`
// has no equivalent per-turn-use cap to reuse, and inventing a one-off
// counter for this card alone would be the card-shaped primitive Primitive
// reuse asks to avoid". WRONG at HEAD — `TriggeredAbility.maxTriggersPerTurn`
// exists (`convex/cards/types.ts`), is enforced in `convex/gre/triggers.ts`,
// and ships on an MH3 card. The mana ability is the established any-colour
// `manaChoices` shape.
//
// Residual, and this marker already sanctioned it: the life-gain amount is
// the firing spell's colour count, and SPELL_CAST still has no
// EVENT_FIELD_REGISTRY row — #2066 is shipping one. Until it lands the
// colour-counting half is a scalar-`event` resolve(), which is fine.
// tracked-by: #2761
// export const ancientCornucopia: CardDefinition = {
//     id: "f977975d-0439-4731-b129-270cc4cdbb23",
//     name: "Ancient Cornucopia",
//     rarity: "mythic",
//     manaCost: { X: 2, G: 1 },
//     types: ["Artifact"],
// };

export {};
