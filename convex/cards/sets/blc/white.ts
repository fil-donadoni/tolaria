// BLC — white cards, split by colour per ADR 0043. The registry's
// `import * as blc from "./sets/blc"` resolves through blc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { RABBIT_TOKEN } from "../../sharedTokens";

// Jacked Rabbit — {X}{1}{W} Creature — Rabbit Warrior 1/2 (issue #674), the
// catalogue's FIRST Ravenous card (CR 702.156).
//
// Ravenous is one keyword standing for two abilities with different timing
// (CR 702.156a), and each half is declared with the construct that matches
// its timing:
//
//   1. "This creature enters with X +1/+1 counters on it" — a CR 614.1c ETB
//      replacement, applied at RESOLUTION while the creature spell's stack
//      item still carries the announced X. `entersWith` with the `"X"` count
//      is exactly that hook (`cards/entersWith.ts` reads `cast.chosenX`);
//      Walking Ballista (`sets/aer/colorless.ts`) is the reference shape.
//   2. "If X is 5 or more, draw a card when it enters" — a genuine TRIGGERED
//      ability with a CR 603.4d intervening-if. It resolves from the stack
//      LATER, once the creature spell's stack item is gone, so the condition
//      reads `self.chosenXOnCast`: the typed, serialized snapshot
//      `finalizeSpellResolution` writes onto the permanent (the `wasKicked`
//      precedent, issue #1753). Not `{ X: true }` / `ctx.getX()` — that reads
//      the currently-resolving stack item, and the trigger item's inherited
//      `chosenX` is an untyped spread artefact the card serializer drops, so
//      it reads 0 after the save/load that happens between the trigger going
//      on the stack and it resolving. Not the +1/+1 counter count either —
//      that proxy is the anti-pattern issue #1753 retired (a pump spell or
//      -1/-1 annihilation moves it; X never moves).
//
// Expressed inline rather than behind a `ravenous()` factory per the
// closure-on-the-1st-card / extract-on-the-2nd convention; the Mechanics
// Registry row records the shape the next Ravenous card should copy.
//
// The attack trigger's token count reads `$source.power` — the creature's
// EFFECTIVE power through the layer system, so the Ravenous counters (and any
// other pump) are included, which is what "equal to this creature's power"
// means (CR 613). Ouroboroid (`sets/eoe/green.ts`) is the reference shape.
export const jackedRabbit: CardDefinition = {
    id: "2c695df6-6bf2-4e6b-8500-e3116137ca27",
    name: "Jacked Rabbit",
    rarity: "rare",
    // Scryfall: {X}{1}{W}. The generic {1} is a real pip alongside the {X}
    // marker — `ManaCost.generic` coexists with `X` exactly for this shape
    // (precedents: `sets/ice/black.ts` {X}{2}{B}, `sets/jud/blue.ts` {X}{1}{U}).
    manaCost: { X: "X", generic: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Rabbit", "Warrior"],
    power: 1,
    toughness: 2,
    oracleText:
        "Ravenous (This creature enters with X +1/+1 counters on it. If X is 5 or more, draw a card when it enters.)\nWhenever this creature attacks, create a number of 1/1 white Rabbit creature tokens equal to this creature's power.",
    // Ravenous, half 1 (CR 702.156a / 614.1c).
    entersWith: { counters: [{ type: "+1/+1", count: "X" }] },
    triggeredAbilities: [
        // Ravenous, half 2 (CR 702.156a / 603.4d).
        enteredTrigger({
            id: "jacked-rabbit-ravenous-draw",
            oracleText:
                "Ravenous — If X is 5 or more, draw a card when this creature enters.",
            scope: "self",
            // CR 603.4 — an intervening-if is checked TWICE: the ability does
            // not trigger at all if the condition is false when the event
            // occurs (`condition`), and it is checked again on resolution
            // (`interveningIf`). Both legs are declared so an X<5 cast never
            // puts a doomed trigger on the stack in front of the player, and
            // the resolution-time check still holds the CR line.
            //
            // DIVERGENCE (CR 603.10): the `interveningIf` leg below misfires
            // when the rabbit is blinked while this trigger is on the stack.
            // `resolveTopOfStackInner` (`gre/state.ts`) re-evaluates it
            // against the LIVE permanent found by `triggerSourceId`, and a CR
            // 400.7 return reuses the same instance id after
            // `resetBattlefieldTransientState` has deleted `chosenXOnCast` —
            // so an X=6 Ravenous trigger blinked by Ephemerate draws 0 cards
            // instead of 1. The PLS Battlemage cycle (`pls/*.ts`, issue
            // #2015) sidesteps the same bug by moving its resolution-time
            // gate into `effects[]` as an `if { kickerPaid }` branch over the
            // resolving stack item's own record; there is no `chosenX` twin
            // of that predicate today, and the real fix is an engine-level
            // re-entry identity stamp with a wide blast radius.
            // tracked-by: #2042.
            condition: (_event, self) => (self.chosenXOnCast ?? 0) >= 5,
            interveningIf: (_event, self) => (self.chosenXOnCast ?? 0) >= 5,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
        {
            id: "jacked-rabbit-attack-tokens",
            oracleText:
                "Whenever this creature attacks, create a number of 1/1 white Rabbit creature tokens equal to this creature's power.",
            // CR 508.1 — "whenever this creature attacks" fires once, as
            // attackers are declared.
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            effects: [
                {
                    op: "createToken",
                    token: RABBIT_TOKEN,
                    controller: "controller",
                    // CR 613 — effective power at resolution, counters included.
                    count: { ref: "$source.power" },
                },
            ],
        },
    ],
};
