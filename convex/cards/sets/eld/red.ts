// ELD — red cards, split by colour per ADR 0043. The registry's
// `import * as eld from "./sets/eld"` resolves through eld/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, SpellContext } from "../../types";

// Robber of the Rich — {1}{R} Creature — Human Archer Rogue, 2/2, reach,
// haste (Vintage Cube FREE: ETB/dies/attack triggers, issue #679). "Reach,
// haste. Whenever this creature attacks, if defending player has more cards
// in hand than you, exile the top card of their library. During any turn you
// attacked with a Rogue, you may cast that card and you may spend mana as
// though it were mana of any color to cast that spell."
//
// PROTOCOL (impulse-draw off an opponent's library — no Op skin, precedent:
// Elkin Bottle / Ice Cauldron, ice/colorless.ts): composes `peekLibraryTop` +
// `exileFaceDown` + `grantCastFromExile`, same idiom, sourced from the
// defending player's library instead of the caster's own.
//
// SIMPLIFICATIONS (flagged, stacked on the above) (tracked-by: #2785):
//   - "During any turn you attacked with a Rogue" — matching every other
//     shipped impulse card, the cast-permission window is not auto-revoked
//     on a timer (no such primitive exists); the permission persists while
//     the card remains in exile instead of being turn-gated.
//
// CR 609.4b (issue #2890) — "and you may spend mana as though it were mana of
// any color to cast that spell" rides the exile-cast permission as
// `grantCastFromExile`'s `manaSubstitution: "any-color"` opt, so the fixing
// applies to THIS exiled card's cast and to nothing else the caster does.
// "Any COLOR", not "any type": CR 105.1's five colours, colorless never a
// substitution target — a `{C}` pip on the stolen card stays payable only with
// colorless mana (CR 107.4c).
export const robberOfTheRich: CardDefinition = {
    id: "0ecbe097-ba51-42e5-957c-382eb66c08f0",
    name: "Robber of the Rich",
    rarity: "mythic",
    oracleText:
        "Reach, haste\nWhenever this creature attacks, if defending player has more cards in hand than you, exile the top card of their library. During any turn you attacked with a Rogue, you may cast that card and you may spend mana as though it were mana of any color to cast that spell.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Archer", "Rogue"],
    power: 2,
    toughness: 2,
    staticAbilities: ["reach", "haste"],
    triggeredAbilities: [
        {
            id: "robber-of-the-rich-attack",
            oracleText:
                "Whenever this creature attacks, if defending player has more cards in hand than you, exile the top card of their library. During any turn you attacked with a Rogue, you may cast that card and you may spend mana as though it were mana of any color to cast that spell.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            resolve: (ctx: SpellContext) => {
                const defenderId = ctx.allPlayerIds.find(
                    (p) => p !== ctx.controller
                );
                if (!defenderId) return;
                if (
                    ctx.getHandSize(defenderId) <=
                    ctx.getHandSize(ctx.controller)
                ) {
                    return; // CR 603.4 — intervening condition not met
                }
                const top = ctx.peekLibraryTop(defenderId, 1);
                if (top.length === 0) return; // empty library
                const cardId = top[0];
                // CR 406.3 — exiled hidden to the opponent, known to controller.
                ctx.exileFaceDown(
                    defenderId,
                    cardId,
                    "library",
                    ctx.controller
                );
                // Cross-player grant (issue #679 fix): the card is owned by
                // (and stays exiled in) the DEFENDING player's zone, CR
                // 400.7, but the ATTACKING player is granted cast permission.
                // CR 305.9 (issue #1689) — oracle says "you may CAST that
                // card" (not "play"): `includesLand` is deliberately omitted
                // (defaults false) — an exiled LAND under this grant is
                // simply unusable, never a legal land drop.
                // CR 609.4b — the second half of the same sentence: the
                // stolen card may be paid for with mana of any colour.
                ctx.grantCastFromExile(
                    cardId,
                    ctx.controller,
                    defenderId,
                    "while-exiled",
                    {
                        manaSubstitution: "any-color",
                    }
                );
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Slice 2 of ADR 0120 — the second adventurer card (issue #3303, CR 715).
//
// Bonecrusher Giant // Stomp is one card (CR 715.2c), exactly as Brazen
// Borrower // Petty Theft is: one catalogue row, one anchor, the inset half
// declared on `insetSpell` and the engine-visible Adventure object built as the
// TWIN definition under `${id}#adventure` by `cards/insetSpell.ts`.
//
// The one capability this card needed that slice 1 did not have is Stomp's
// FIRST line — "Damage can't be prevented this turn" — which is neither of the
// two anti-prevention shapes that already shipped: `lockDamage` (CR 615.12 /
// 614.9, Whippoorwill) binds the override to ONE RECIPIENT, and the
// `combat-damage-unpreventable` static (Questing Beast, `eld/green.ts`) binds
// it to ONE SOURCE and to combat only. Stomp's line names neither, so it earned
// the game-scoped `suppressDamagePrevention` Op (issue #3303) rather than a
// Guard B marker: ADR 0120 § 6 is explicit that a buildable clause shipped
// behind a marker is chosen debt.
// ─────────────────────────────────────────────────────────────────────────────

// Bonecrusher Giant — {2}{R} Creature — Giant, 4/3 (ELD). Modern Scryfall
// oracle text is authoritative (ADR 0004).
//
// CR 603.2b / 115.5 — "Whenever this creature becomes the target of a spell"
// is the `BECAME_TARGET` event Ward (CR 702.21a) and Leovold already read,
// narrowed twice: to THIS permanent (`event.target.id === self.id`, the
// Sleeping Potion / Ward shape) and to `sourceKind === "spell"` — the Oracle
// text says "a spell", not "a spell or ability", so an activated or triggered
// ability that targets the Giant must NOT ping (issue #2360 is exactly why the
// event carries that discriminator, and why it is required rather than
// defaulted).
//
// "That spell's controller" is the event's own `sourceControllerId`, read
// through the `$event.sourceController` field row this slice censuses
// (EVENT_FIELD_REGISTRY, ADR 0049 — the same shape `SPELL_CAST.caster` and
// `SPELL_KICKED.casterId` already have). No target of its own: the trigger
// announces nothing (CR 603.2), so nothing here is a `targetRequirement`.
//
// The damage is sourced from the resolving TRIGGER stack item, which carries
// the Giant's own characteristics (`buildTriggerItem` spreads `...self`, so
// `describeDamageSource` reads the creature's colours and types) — the same
// path every other shipped creature trigger that deals damage takes. The
// `source` field on `dealDamage` is for the OTHER shape, a bound permanent that
// is not the resolving ability's own source (Backlash's `$c` snapshot).
export const bonecrusherGiant: CardDefinition = {
    id: "ff984a4c-1818-4f8f-a9d7-fce57e77937d", // ELD 115
    rarity: "rare",
    name: "Bonecrusher Giant",
    oracleText:
        "Whenever this creature becomes the target of a spell, this creature deals 2 damage to that spell's controller.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 4,
    toughness: 3,
    triggeredAbilities: [
        {
            id: "bonecrusher-giant-targeted-ping",
            event: "BECAME_TARGET",
            matches: (event, self) =>
                event.type === "BECAME_TARGET" &&
                event.sourceKind === "spell" &&
                event.target.type === "permanent" &&
                event.target.id === self.id,
            oracleText:
                "Whenever this creature becomes the target of a spell, this creature deals 2 damage to that spell's controller.",
            effects: [
                {
                    op: "dealDamage",
                    amount: 2,
                    to: { player: { ref: "$event.sourceController" } },
                },
            ],
        },
    ],
    // CR 715.2 — the inset frame. `kind: "adventure"` is what makes the parent
    // offer the cast option at all (CR 715.3).
    insetSpell: {
        kind: "adventure",
        name: "Stomp",
        manaCost: { X: 1, R: 1 },
        types: ["Instant"],
        subtypes: ["Adventure"],
        oracleText:
            "Damage can't be prevented this turn.\nStomp deals 2 damage to any target.",
        targetRequirement: { type: "any", count: 1 },
        // ORDER IS THE CARD: the lock is armed FIRST, so it covers Stomp's own
        // damage in the same resolution (CR 608.2 — a spell's instructions are
        // followed in the order written). It is game-scoped and symmetric, so
        // it equally unprevents damage dealt to the caster for the rest of the
        // turn — that is the printed card, not an approximation.
        effects: [
            { op: "suppressDamagePrevention" },
            { op: "dealDamage", amount: 2, to: { target: 0 } },
        ],
    },
};
