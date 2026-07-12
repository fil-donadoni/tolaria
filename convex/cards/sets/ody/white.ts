// ody — white cards (ADR 0043 colour split).

import type { CardDefinition, SpellContext } from "../../types";
import {
    causedByOpponent,
    leftTrigger,
} from "../../abilities/triggers/leftTrigger";

// Karmic Justice — {2}{W} Enchantment (Odyssey #26, rare).
// "Whenever a spell or ability an opponent controls destroys a noncreature
//  permanent you control, you may destroy target permanent that opponent
//  controls."
//
// CR 603.10 leave-the-battlefield trigger keyed on the "destroyed" cause
// (issue #1054): `leftTrigger`'s `condition` gates on `event.cause ===
// "destroy"` (never a sacrifice / bounce / mill) AND `causedByOpponent`
// (`event.causerControllerId` set to a player other than this permanent's
// controller — never the controller's own destroy effect). `scope: "yours"`
// plus the `excludeTypes: "Creature"` filter cover "a noncreature permanent
// you control".
//
// resolve() justification (ADR 0045 DSL-first, protocol-like precedent):
// `TriggeredAbility` carries no `targetRequirement` (ADR 0002) — "target
// permanent that opponent controls" is modelled as a resolution-time
// `choose-permanents` pick over the opponent's battlefield, the established
// idiom for a targeted triggered ability in this engine (Banishing Light
// jou/white.ts, Loran of the Third Path bro/white.ts). The DSL alternative
// (`choice` Op + `destroy` Op referencing the pick via `target: { ref }`)
// does not compose: a `choice` Op's `bind` is a "picks"-family binding while
// `destroy`'s bare `{ ref }` object position statically requires a
// "snapshot"-family binding (`convex/gre/effects/validate.ts`) — the two
// binding shapes aren't interchangeable today, so this is NOT the
// "the Op doesn't exist yet" case, it's a real composition gap.
export const karmicJustice: CardDefinition = {
    id: "c2ffb8e7-7ae3-4846-b3da-ca6b4598eb7c",
    rarity: "rare",
    name: "Karmic Justice",
    oracleText:
        "Whenever a spell or ability an opponent controls destroys a noncreature permanent you control, you may destroy target permanent that opponent controls.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        leftTrigger({
            id: "karmic-justice-destroy",
            oracleText:
                "Whenever a spell or ability an opponent controls destroys a noncreature permanent you control, you may destroy target permanent that opponent controls.",
            scope: "yours",
            filter: { excludeTypes: "Creature" },
            condition: (event, self) =>
                event.cause === "destroy" && causedByOpponent(event, self),
            resolve: (ctx: SpellContext) => {
                const opponentId = ctx.allPlayerIds.find(
                    (p) => p !== ctx.controller
                );
                if (!opponentId) return;
                // "target permanent that opponent controls" — no type
                // restriction, any permanent that opponent controls.
                const candidates = ctx.getBattlefieldIds(opponentId);
                if (candidates.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `karmic-justice-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    zoneOwnerId: opponentId,
                    candidateIds: candidates,
                    count: { min: 0, max: 1 },
                    prompt: "Karmic Justice: destroy target permanent that opponent controls (or none)?",
                });
                if (picks === undefined) return; // suspended for the choice
                for (const id of picks) ctx.destroy({ type: "permanent", id });
            },
        }),
    ],
};
