// MID — white cards, split by colour per ADR 0043. The registry's
// `import * as mid from "./sets/mid"` resolves through mid/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import { EFFECT_AFFECTS_SELF } from "../../types";
import type { CardDefinition } from "../../types";
import { HUMAN_TOKEN } from "../../sharedTokens";

// Cathar Commando — "Flash. {1}, Sacrifice this creature: Destroy target
// artifact or enchantment." (CR 702.8 flash; CR 701.7 destroy; CR 602.1
// activated ability with a sacrifice-self cost.)
export const catharCommando: CardDefinition = {
    id: "98cbc1c2-b76e-4da3-aa43-00e10b2ce532",
    rarity: "common",
    name: "Cathar Commando",
    oracleText:
        "Flash\n{1}, Sacrifice this creature: Destroy target artifact or enchantment.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 3,
    toughness: 1,
    staticAbilities: ["flash"],
    activatedAbilities: [
        {
            id: "cathar-commando-destroy",
            oracleText:
                "{1}, Sacrifice this creature: Destroy target artifact or enchantment.",
            cost: { mana: { X: 1 }, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: ["Artifact", "Enchantment"],
                count: 1,
            },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};

// Adeline, Resplendent Cathar — {1}{W}{W} Legendary Creature — Human Knight,
// */4 (MID 1, issue #2370, Vintage Cube). "Vigilance. Adeline's power is
// equal to the number of creatures you control. Whenever you attack, for
// each opponent, create a 1/1 white Human creature token that's tapped and
// attacking that player or a planeswalker they control."
//
// CORRECTION against the issue's stated target file: Adeline's ONLY printing
// is MID (Innistrad: Midnight Hunt) #1 — she was never printed in VOW
// (Crimson Vow); Scryfall confirms no `vow` entry among her prints. `mid` and
// `vow` are separate, already-populated ADR 0043 colour-split directories in
// this repo (`convex/cards/sets/mid/`, `convex/cards/sets/vow/`), and the
// `id` convention here is the card's OWN printing's Scryfall print id (see
// `catharCommando` above, `98cbc1c2-…` = the MID Cathar Commando print) — so
// she lives here, in `mid/white.ts`, with the MID #1 print id.
//
// Power CDA (CR 604.3/208.2, issue #2370): declared base `power: 0`,
// `toughness: 4` (toughness is a FIXED printed value, not a CDA — only power
// is dynamic). `compute` returns a delta of `{ power: <creature count>,
// toughness: 0 }` over that base, the same `pt-cda` shape Keldon Warlord uses
// (`sets/lea/red.ts`) — EXCEPT Adeline's oracle has no "other": she counts
// herself, so (unlike Keldon Warlord's `p.id !== source.id` exclusion) this
// scan has no self-exclusion clause.
//
// Attack trigger (CR 508.1, issue #2370): "whenever you attack" is the
// Guide-of-Souls shape (`sets/mh3/white.ts`) — `event: "ATTACKERS_DECLARED"`,
// `matches` on `event.attackingPlayerId === self.controllerId` (fires once
// per combat regardless of which/how many creatures attack, NOT the "this
// creature attacks" `attackerIds.includes(self.id)` variant Jacked Rabbit /
// Satya use).
//
// "For each opponent": modeled as a single `createToken` call (`count`
// omitted, defaults to 1), NOT the `forEach` structural construct — verified
// against the type surface, not assumed: `EffectForEachSelector`
// (`cards/types.ts`) has no "opponents" set member (only `players`,
// `permanents`, `graveyard`, `bound`, `targets`), and `EffectPlayerRef`'s own
// `opponentOf` doc (`cards/types.ts`) explicitly records that a
// forEach-with-exclusion alternative for "each opponent" was CONSIDERED AND
// REJECTED in favor of the single-ref `"opponent"` shorthand, because this
// engine is two-player only (CLAUDE.md § Out of Scope) and "each opponent"
// always degenerates to exactly one. Voldaren Epicure's own comment
// (`sets/vow/red.ts`) independently documents the identical convention
// ("the single-opponent shorthand this 2-player engine already uses
// everywhere 'each opponent' appears"). A future 3+ player mode would need a
// real multi-valued selector, not a bigger `forEach`.
//
// Tapped-and-attacking token (CR 508.4): `EffectTokenSpec.entersTapped` /
// `.entersAttacking` (`cards/types.ts`), verified end-to-end before writing
// this card — `createToken`'s interpreter executor
// (`gre/effects/interpreter.ts`) spreads `op.token` (including these two
// flags) verbatim into the `TokenSpec` handed to `SpellContext.createToken`,
// which funnels through the SAME `createTokenPermanents` (`gre/state.ts`)
// regardless of whether the caller used `createToken` or `createTokenCopy` —
// there is no special-cased path only `createTokenCopy` unlocks. Adeline is
// simply the first card to combine plain `createToken` with
// `entersAttacking`; the plumbing needed no changes.
//
// DIVERGENCE (tracked-by: #1865): the token always attacks the DEFENDING
// PLAYER — `markAttacking` (`gre/combat.ts`) only joins `state.combat`, it
// never assigns `combat.attackTargets`, so there is no controller choice of
// a defending planeswalker instead. Unlike Satya (`sets/m3c/multicolor.ts`,
// whose own oracle text is silent on the point), Adeline's oracle text
// EXPLICITLY names the alternative ("that player or a planeswalker they
// control") — but this is the SAME pre-existing, already-tracked engine gap
// #1865 flags on `TokenSpec.entersAttacking`'s own doc comment, not a new
// one this card introduces. In the current two-player engine "the defending
// player" is unambiguous (there is exactly one opponent), so "attacking that
// player" is satisfied by construction; the planeswalker branch stays out of
// scope for this issue, tracked by the existing #1865.
export const adelineResplendentCathar: CardDefinition = {
    id: "18092f68-b96e-4084-9eba-b240d2195d81", // MID 1
    rarity: "rare",
    name: "Adeline, Resplendent Cathar",
    oracleText:
        "Vigilance\nAdeline's power is equal to the number of creatures you control.\nWhenever you attack, for each opponent, create a 1/1 white Human creature token that's tapped and attacking that player or a planeswalker they control.",
    manaCost: { X: 1, W: 2 },
    supertypes: ["Legendary"],
    types: ["Creature"],
    subtypes: ["Human", "Knight"],
    power: 0,
    toughness: 4,
    staticAbilities: ["vigilance"],
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state, ctx) => {
                let count = 0;
                for (const player of state.players) {
                    for (const p of player.battlefield) {
                        if (
                            p.controllerId === source.controllerId &&
                            ctx.isCreature(p)
                        ) {
                            count++;
                        }
                    }
                }
                return { power: count, toughness: 0 };
            },
        },
    ],
    triggeredAbilities: [
        {
            id: "adeline-resplendent-cathar-attack-tokens",
            oracleText:
                "Whenever you attack, for each opponent, create a 1/1 white Human creature token that's tapped and attacking that player or a planeswalker they control.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackingPlayerId === self.controllerId,
            effects: [
                {
                    op: "createToken",
                    token: {
                        ...HUMAN_TOKEN,
                        entersTapped: true,
                        entersAttacking: true,
                    },
                    controller: "controller",
                },
            ],
        },
    ],
};
