// ZNR — white cards, split by colour per ADR 0043. The registry's
// `import * as znr from "./sets/znr"` resolves through znr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../../../convex/cards/types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Luminarch Aspirant — {1}{W} Creature — Human Cleric, 1/1 (issue #681, Cube
// FREE +1/+1 counters). "At the beginning of combat on your turn, put a
// +1/+1 counter on target creature you control." (CR 603.6a combat-begin
// trigger via `phaseTrigger`; CR 122 counter placement.)
//
// protocol: `TriggeredAbility` has no `targetRequirement` field — CR 603.3d
// announce-time targeting is not modeled for triggered abilities in this
// engine, and the Effect Script grammar has no bridge from a `choice` Op's
// "picks" binding into an object-position Op (`counters`/`pump`/`dealDamage`/
// ...): `forEach { set: "bound" }` only accepts a delayedTrigger LIST capture
// (ADR 0049) and a bare object ref only accepts a "snapshot" family binding
// (see `convex/gre/effects/validate.ts`). Every existing "target creature"
// triggered ability in this pool (Oubliette, Tourach's Chant in
// `sets/arn/black.ts` / `sets/fem/black.ts`) resolves this the SAME way —
// a resolution-time `choose-permanents` pick via `resolve()`, not a true
// announced target. This is the established project-wide simplification for
// the shape, not an invented one-off; the underlying structural gap (no
// trigger-level targetRequirement / no choice→object-position bridge) is
// tracked as a capability follow-up in tolaria#917.
export const luminarchAspirant: CardDefinition = {
    id: "fe964e7e-e2c5-4263-889d-0a531eb51442",
    name: "Luminarch Aspirant",
    rarity: "rare",
    oracleText:
        "At the beginning of combat on your turn, put a +1/+1 counter on target creature you control.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        phaseTrigger({
            id: "luminarch-aspirant-counter",
            oracleText:
                "At the beginning of combat on your turn, put a +1/+1 counter on target creature you control.",
            phase: "BEGINNING_OF_COMBAT",
            scope: "your",
            resolve: (ctx, _event, scopedPlayerId) => {
                const candidates = ctx.getBattlefieldIds(scopedPlayerId, {
                    types: "Creature",
                });
                if (candidates.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: scopedPlayerId,
                    choiceId: `luminarch-aspirant-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    zoneOwnerId: scopedPlayerId,
                    filter: { types: "Creature" },
                    count: 1,
                    prompt: "Put a +1/+1 counter on target creature you control.",
                });
                if (picks === undefined) return; // suspended for the choice
                const targetId = picks[0];
                if (!targetId) return;
                ctx.addCounter({ type: "permanent", id: targetId }, "+1/+1", 1);
            },
        }),
    ],
};
