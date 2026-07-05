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

// TODO(issue #679 stub — Skyclave Apparition's leave trigger needs to size a
// replacement token off the mana value of a card THIS SOURCE exiled earlier
// in the game (arbitrarily many turns prior) and that no longer exists
// anywhere in the game (CR 400.7 — an exiled permanent that leaves exile
// becomes a new object; nothing keeps its mana value queryable). The only
// SpellContext channel that carries a value forward from an ETB exile to a
// later leave-trigger is the `exileWithAttachments` / `returnExiledForSource`
// bundle (ADR 0028) — and that channel is wired ONLY for a return-to-
// BATTLEFIELD host (Tawnos's Coffin shape, `resolve()` re-enters the SAME
// card under its owner's control), not for "read a stored number, then
// create an unrelated token." `addCounter` stores a number on a permanent
// but only for that permanent's own remaining lifetime on the battlefield —
// by the time Skyclave Apparition's OWN leave-trigger fires, the same
// last-known-info snapshot semantics that make `self` usable for e.g.
// `power`/`controllerId` (CR 603.10) are not exercised anywhere in this
// codebase for `counters`, so relying on it here would be new, untested
// engine behavior rather than a card-definition composition. Flagged in
// convex/cards/sets/mrd/colorless.ts (Chrome Mox) at authoring time. Stop-
// and-issue per gre-development.md; tracked stub.
// export const skyclaveApparition: CardDefinition = {
//     id: "b83cfbaa-7890-4f6f-878b-4edb45677371",
//     name: "Skyclave Apparition",
//     rarity: "rare",
//     manaCost: { X: 1, W: 2 },
//     types: ["Creature"],
//     subtypes: ["Kor", "Spirit"],
//     power: 2,
//     toughness: 2,
// };
