// dsk — black cards (ADR 0043 colour split).
//
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical
// name/cost/types/P-T are from Scryfall (id = DSK paper printing).

import type { CardDefinition, GameEvent } from "../../types";
import { enduringReturnTrigger } from "../../abilities/enduringReturn";

// Overlord of the Balemurk — {3}{B}{B} Enchantment Creature. "Impending 5 —
// {1}{B} (If you cast this spell for its impending cost, it enters with five
// time counters and isn't a creature until the last is removed. At the
// beginning of your end step, remove a time counter from it.) Whenever this
// permanent enters or attacks, mill four cards, then you may return a
// non-Avatar creature card or a planeswalker card from your graveyard to your
// hand." Blocked: keyword **Impending** (CR 702.176) is `status: "planned"`
// (issue #1970).
// tracked-by: #1970
// export const overlordOfTheBalemurk: CardDefinition = {
//     id: "9b911653-7b96-4cf3-a907-13c5c53a14f7",
//     name: "Overlord of the Balemurk",
//     rarity: "mythic",
//     manaCost: { X: 3, B: 2 },
//     types: ["Enchantment", "Creature"],
//     subtypes: ["Avatar", "Horror"],
//     power: 5,
//     toughness: 5,
// };

// Enduring Tenacity — {2}{B}{B} Enchantment Creature — Snake Glimmer, 4/3
// (issue #2085, the DSK "Enduring" cycle; the shared dies-trigger and its
// CR 205.1a / 613.1d derivation live in `abilities/enduringReturn.ts`).
//
// "Whenever you gain life, target opponent loses that much life."
//
// The catalogue's FIRST `LIFE_GAINED` trigger, so it is authored inline rather
// than through a factory (closure on card #1; the second lifegain-watcher is
// what earns a `lifeGainedTrigger` alongside the shipped `lifeLostTrigger`).
// The event is emitted by the single `gainLifeEmitting` choke point
// (`gre/state.ts`) with the POST-replacement amount actually gained, so a
// doubled or prevented gain drains for what really happened (CR 119.3).
//
// "you" is the ability's controller (CR 109.5): `event.playerId ===
// self.controllerId`. Symmetric lifegain by the opponent is not "you gain
// life" and must not fire — the gate is an equality, not a presence check.
//
// CR 603.3d — "target opponent" is announced as the trigger goes on the stack,
// not at resolution, so it is a `targetRequirement` on the ability rather than
// a choice inside the body. With no legal opponent (hexproof from black, an
// opponent already gone) the ability is put on the stack and then "simply
// removed from the stack" — the printed wording, and not the same thing as
// never triggering: anything watching triggers FIRE still sees it.
//
// resolve() justification (ADR 0045 DSL-first): the drained amount is
// `event.amount`, a runtime NUMBER off the firing event. The `EffectValue`
// grammar has literal / ref / count members only, and `$event.<field>` refs
// are censused as `object` / `player` families exclusively
// (`EVENT_FIELD_REGISTRY`, ADR 0049) — there is no number family, so no
// Effect Script can name "that much". This is the SAME documented,
// precedent-covered gap that keeps El-Hajjâj (`sets/arn/black.ts`) and Horned
// Cheetah (`sets/inv/multicolor.ts`) imperative — not an invented shortcut,
// and not a missing Op (the effect itself is the shipped `loseLife`
// primitive). Migratable the day an event-amount `EffectValue` member lands.
//
// Guard C (issue #2701) — the Oracle compiler's grammar has no slot for
// either half of this card yet, so the fragments are named here for the
// corpus backlog PRD #2693 ranks the next grammar rule by. The shared
// dies-trigger fragment is the cycle's, quoted as printed for THIS card;
// Enduring Innocence carries its own line in the
// one-time baseline instead, which only ever shrinks.
// compiler-gap: Whenever you gain life, target opponent loses that much life. (#2693)
// compiler-gap: When Enduring Tenacity dies, if it was a creature, return it to the battlefield under its owner's control. It's an enchantment. (It's not a creature.) (#2693)
export const enduringTenacity: CardDefinition = {
    id: "d5756d4b-3068-412c-8643-880d3459151e",
    name: "Enduring Tenacity",
    rarity: "rare",
    manaCost: { X: 2, B: 2 },
    types: ["Enchantment", "Creature"],
    subtypes: ["Snake", "Glimmer"],
    power: 4,
    toughness: 3,
    oracleText:
        "Whenever you gain life, target opponent loses that much life.\nWhen Enduring Tenacity dies, if it was a creature, return it to the battlefield under its owner's control. It's an enchantment. (It's not a creature.)",
    triggeredAbilities: [
        {
            id: "enduring-tenacity-drain",
            oracleText:
                "Whenever you gain life, target opponent loses that much life.",
            event: "LIFE_GAINED",
            matches: (event: GameEvent, self) =>
                event.type === "LIFE_GAINED" &&
                event.playerId === self.controllerId,
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            resolve: (ctx, event) => {
                if (event.type !== "LIFE_GAINED") return;
                const [target] = ctx.targets;
                // CR 608.2b — the announced player is gone / no longer legal.
                if (!target || target.type !== "player") return;
                ctx.loseLife(target.id, event.amount);
            },
            // aiEffects (PRD #1423, issue #1431/#2364) — a bare `resolve()`
            // body, so the bot's value model has nothing to walk without a
            // shadow script. `amount: 1` is the smallest real drain: the
            // magnitude is whatever was gained, and undervaluing the trigger
            // is the safe direction for a term the search only uses to rank.
            aiEffects: [{ op: "loseLife", player: { target: 0 }, amount: 1 }],
        },
        // The cycle's shared dies-trigger (CR 700.4 / 603.4 intervening-if,
        // CR 205.1a / 613.1d type-line SET) — `abilities/enduringReturn.ts`.
        enduringReturnTrigger({
            id: "enduring-tenacity-return",
            cardName: "Enduring Tenacity",
        }),
    ],
};
