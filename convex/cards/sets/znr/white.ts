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
// TARGETING (CR 603.3d, issue #1193): "target creature you control" is a REAL
// target chosen when the trigger is put on the stack — declared as a
// `targetRequirement` on the TriggeredAbility (engine:
// `raiseTriggerTargetSelection` in gre/rules.ts), NOT a resolution-time
// `requestChoice`. That makes it subject to hexproof / protection / ward and
// fires "becomes the target of an ability" triggers, which the old
// choice-as-target workaround silently skipped. `phaseTrigger` supplies the
// step/scope/matches plumbing; the `targetRequirement` is merged onto the
// returned ability.
//
// Migrated resolve()→effects[] (ADR 0045, PRD #795): the `counters` Op
// (`action: "add"`, "+1/+1", `count: 1`) targeting the announced slot
// (`{ target: 0 }`) is a thin declarative skin over the exact
// `ctx.addCounter` call this closure made; skipped when the target is gone
// (CR 608.2b), matching the old `if (!target) return` guard.
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
        {
            // `phaseTrigger` (CR 603.6a) supplies the PHASE_BEGIN narrowing,
            // `scope: "your"` filter, and matches plumbing; the CR 603.3d
            // `targetRequirement` is merged on below (PhaseTriggerArgs has no
            // target field). "target creature you control" =
            // `{ type: "Creature", count: 1, controller: "you" }`.
            ...phaseTrigger({
                id: "luminarch-aspirant-counter",
                oracleText:
                    "At the beginning of combat on your turn, put a +1/+1 counter on target creature you control.",
                phase: "BEGINNING_OF_COMBAT",
                scope: "your",
                effects: [
                    {
                        op: "counters",
                        action: "add",
                        counter: "+1/+1",
                        target: { target: 0 },
                        count: 1,
                    },
                ],
            }),
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
        },
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
