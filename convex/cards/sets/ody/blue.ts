// ody — blue cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).
import type { CardDefinition } from "../../types";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";

// Upheaval — {4}{U}{U} Sorcery. "Return all permanents to their owners'
// hands." (CR 400.7 zone change / CR 111.7 a bounced token ceases to exist,
// SBA-enforced.) A `forEach` sweep over EVERY permanent on EVERY battlefield
// (no `controller` scope — "all permanents", not "permanents you control";
// no `filter` — every type, not just creatures) + `moveZone` per member. This
// is the FIRST card to pair `forEach`'s `$each` with `moveZone`'s
// target-shape (`to: "hand"`) — a new construct combination earning its own
// interpreter test (`convex/gre/effects/__tests__/interpreter.test.ts`,
// "forEach + moveZone — mass bounce").
export const upheaval: CardDefinition = {
    id: "9e201229-34a6-48c8-a07c-d8aefcf5f8a7",
    name: "Upheaval",
    rarity: "rare",
    oracleText: "Return all permanents to their owners' hands.",
    manaCost: { X: 4, U: 2 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: { set: "permanents", zone: "battlefield" },
            effects: [{ op: "moveZone", target: { ref: "$each" }, to: "hand" }],
        },
    ],
};

// Standstill — {1}{U} Enchantment. "When a player casts a spell, sacrifice
// this enchantment. If you do, each of that player's opponents draws three
// cards."
//
// CR 603.2 / 601.2i — the head is `spellCastTrigger({ scope: "any" })`: the
// trigger watches EVERY caster, not just the controller's own spells, which is
// the whole point of the card (an opponent who casts anything hands the
// Standstill player three cards). Nothing about the head is card-shaped — the
// sphere cycle already ships this exact scope.
//
// CR 118.12 — "[Do something]. If [a player] does, [effect]" makes the action a
// COST paid at resolution, and the clause "checks whether the player chose to
// pay an optional cost or started to pay a mandatory cost". THIS card is the
// rule's own worked example: "an ability is activated that exiles Standstill.
// When Standstill's ability resolves, you're unable to pay the 'sacrifice
// Standstill' cost. No player will draw cards."
//
// CR 701.21 / 608.2h — that cost check is the SACRIFICE Op's own bind, read
// back by `boundMatchesFilter`. `sacrifice` binds ONLY when the object
// resolved on the battlefield (`interpreter.ts` — `resolveObjectRef` re-checks
// presence before the primitive runs), so a Standstill removed in response to
// its own trigger sacrifices nothing, captures nothing, and the predicate's
// own `if (!snap) return false` short-circuit reads false: no draw. The same
// bind-then-read idiom Agatha's Soul Cauldron (`woe/colorless.ts`) and Minsc &
// Boo (`clb/multicolor.ts`) already use, with no boolean Op and no new
// predicate form.
//
// The filter is EMPTY on purpose. Every other `boundMatchesFilter` site asks
// what the snapshot WAS (Minsc & Boo's "if the sacrificed creature was a
// Hamster"); CR 118.12 asks only whether the cost was paid, so the honest
// predicate constrains no characteristic at all. A `{ type: "Enchantment" }`
// filter would read as an equivalent tautology and is not one — `StaticTypeRemove`
// (`kind: "type-remove"`, layer 4, `gre/layers2to5.ts`) is a shipped
// type-STRIPPING form, so a card type is not something this gate may lean on.
//
// CR 109.5 / 102.1 — "each of that player's opponents" is
// `{ opponentOf: { ref: "$event.caster" } }`: the ALREADY-CENSUSED
// `SPELL_CAST.caster` player field (EVENT_FIELD_REGISTRY, ADR 0049) wrapped in
// the already-censused controller-relative complement (issue #1568). It is NOT
// "you" — when Standstill's own controller casts a spell, the cards go to the
// OPPONENT. In this engine's two-seat scope (ADR 0010) the plural degenerates
// to one player, the same collapse `"opponent"` itself relies on.
//
// The Oracle compiler (PRD #2693) cannot read this line back: grammar v0 has
// no sacrifice sentence at all, no cross-sentence "If you do" conditional, and
// `playerRef.ts` refuses "that player" anaphora outright by design.
// compiler-gap: "When a player casts a spell, sacrifice this enchantment. If you do, each of that player's opponents draws three cards." (#2693)
export const standstill: CardDefinition = {
    id: "3ede3f6f-e642-4fe4-aa37-0f01cdf4d149",
    name: "Standstill",
    rarity: "uncommon",
    oracleText:
        "When a player casts a spell, sacrifice this enchantment. If you do, each of that player's opponents draws three cards.",
    manaCost: { X: 1, U: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "standstill-cast",
            oracleText:
                "When a player casts a spell, sacrifice this enchantment. If you do, each of that player's opponents draws three cards.",
            scope: "any",
            effects: [
                {
                    op: "sacrifice",
                    target: { ref: "$source" },
                    bind: "$sacrificed",
                },
                {
                    op: "if",
                    predicate: {
                        boundMatchesFilter: { ref: "$sacrificed" },
                        filter: {},
                    },
                    then: [
                        {
                            op: "draw",
                            player: { opponentOf: { ref: "$event.caster" } },
                            count: 3,
                        },
                    ],
                },
            ],
        }),
    ],
};
