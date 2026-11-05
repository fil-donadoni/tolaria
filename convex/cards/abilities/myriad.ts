// Myriad (CR 702.116) — a TRIGGERED-ability keyword that reaches a permanent
// printed or through a grant (Legion Loyalty, Blade of Selves), so the trigger
// comes from the live keyword multiset (`liveKeywordTriggers.ts`), never from
// the definition: each occurrence is one instance, which is CR 702.116b.
//
// CR 702.116a: "Whenever this creature attacks, for each opponent other than
// defending player, you may create a token that's a copy of this creature
// that's tapped and attacking that player or a planeswalker they control. If
// one or more tokens are created this way, exile the tokens at end of combat."
// CR 702.116b: "If a creature has multiple instances of myriad, each triggers
// separately."
//
// THE BODY DOES NOTHING, AND THAT IS THE RULE: in a two-player game the
// nonactive player is the defending player (CR 506.2), so the set "each
// opponent other than defending player" has no member and no token is ever
// offered. This engine plays two-player games only (docs/PROJECT.md § Fuori
// scope), so the token creation and its delayed exile are unreachable, and no
// Op is written for a branch that cannot run.
//
// THE TRIGGER STILL EXISTS: myriad is a triggered ability whatever its effect
// comes to, so it goes on the stack the next time a player would receive
// priority (CR 603.3), where it can be responded to and resolves doing nothing.

import type { TriggeredAbility } from "../types";
import { attacksTrigger } from "./triggers/attacksTrigger";

export const MYRIAD_KEYWORD = "myriad";

/** Stable ability id: resolution reads the ability back off the live multiset by
 *  id, and two instances sharing a `triggerOrderKey` (`gre/triggers.ts`)
 *  auto-order, since nothing separates their outcomes (ADR 0003). */
export const MYRIAD_TRIGGER_ID = "myriad";

/** CR 702.116a rules text for the trigger, as printed in reminder text. */
export const MYRIAD_ORACLE_TEXT =
    "Myriad (Whenever this creature attacks, for each opponent other than defending player, you may create a token copy that's tapped and attacking that player or a planeswalker they control. Exile the tokens at end of combat.)";

/** CR 702.116a — the attack trigger of one instance of myriad. */
export const MYRIAD_TRIGGER: TriggeredAbility = attacksTrigger({
    id: MYRIAD_TRIGGER_ID,
    oracleText: MYRIAD_ORACLE_TEXT,
    scope: "self",
    // protocol card: `effects[]` must be non-empty (`validateEffectOpList`)
    // and no no-op Op exists, nor should one be invented for a body the
    // rules leave empty. Stays resolve() as an intentional no-op.
    resolve: () => {
        // No opponent other than defending player: nothing to create.
    },
});
