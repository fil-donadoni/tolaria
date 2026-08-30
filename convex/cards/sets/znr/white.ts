// ZNR — white cards, split by colour per ADR 0043. The registry's
// `import * as znr from "./sets/znr"` resolves through znr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../../../convex/cards/types";
import { PERMANENT_TYPES } from "../../../../convex/cards/types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";
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

// Skyclave Apparition — {1}{W}{W} Creature — Kor Spirit, 2/2 (issue #2384,
// Cube). "When this creature enters, exile up to one target nonland, nontoken
// permanent you don't control with mana value 4 or less. // When this creature
// leaves the battlefield, the exiled card's owner creates an X/X blue Illusion
// creature token, where X is the mana value of the exiled card."
//
// TWO Oracle sentences = TWO TriggeredAbilities (CLAUDE.md § one Oracle line =
// one TriggeredAbility): an ETB (CR 603.6a) and a leaves-the-battlefield
// trigger (CR 603.10a, which looks back in time).
//
// THE HARD PART (what #679's stub flagged): the two abilities can be
// arbitrarily many turns apart, and by the time the leave-trigger resolves the
// exiled card is — per CR 400.7 — a NEW OBJECT with no relation to the one that
// was exiled; it may also have left exile entirely. So X cannot be a live zone
// lookup. It is read from a LAST-KNOWN-INFORMATION snapshot taken at the
// instant of the exile (CR 608.2h) and carried across the two resolutions by
// the `captureBinding` / `recallCapturedBinding` pair (issue #2384) — the
// $source-keyed write/read couple modelled on `exileWithAttachments` /
// `returnExiledForSource` (ADR 0028). `exile`'s own `bind` snapshots the target
// BEFORE it moves, so the row carries both the mana value AND the owner (CR
// 108.3 — the token goes to the exiled CARD's owner, which is not always the
// opponent: a creature you own but an opponent controls is a legal target).
//
// Two consequences that fall out of reading the SNAPSHOT rather than the card:
//   - a third party moving the exiled card out of exile does not change X;
//   - an ETB that exiled nothing (no legal target, or the optional target was
//     declined) captures nothing, so the leave-trigger's `createToken` finds an
//     unresolved size and creates NO token (CR 608.2b) — which is also what
//     happens if the Apparition leaves the battlefield before its own ETB
//     trigger has resolved.
//
// The exile is PERMANENT — no play-from-exile grant (contrast the
// `grantCastFromExile` family): plain `exile`, and the owner can never play it.
export const skyclaveApparition: CardDefinition = {
    id: "b83cfbaa-7890-4f6f-878b-4edb45677371",
    name: "Skyclave Apparition",
    rarity: "rare",
    oracleText:
        "When this creature enters, exile up to one target nonland, nontoken permanent you don't control with mana value 4 or less.\nWhen this creature leaves the battlefield, the exiled card's owner creates an X/X blue Illusion creature token, where X is the mana value of the exiled card.",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Kor", "Spirit"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "skyclave-apparition-exile",
            oracleText:
                "When this creature enters, exile up to one target nonland, nontoken permanent you don't control with mana value 4 or less.",
            scope: "self",
            // CR 603.3d — a REAL target chosen as the trigger goes on the
            // stack (subject to hexproof / protection / ward), not a
            // resolution-time choice. "up to one" = `count 0..1` (CR 601.2c);
            // "nonland" = every permanent type minus Land; "nontoken" =
            // `isToken: false`; "you don't control" = `controller: "opponent"`
            // (two-seat engine, CLAUDE.md § Out of Scope); "mana value 4 or
            // less" = `mvFilter.max` (CR 202.3).
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                excludeTypes: "Land",
                isToken: false,
                controller: "opponent",
                mvFilter: { max: 4 },
                count: { min: 0, max: 1 },
            },
            effects: [
                // CR 701.13 — a plain exile: the card stays in exile forever,
                // no play-from-exile grant. `bind` snapshots it BEFORE the
                // move, so the row is last-known information (CR 608.2h).
                { op: "exile", target: { target: 0 }, bind: "$exiled" },
                // CR 608.2h / 400.7 — hand that row to the source permanent, so
                // its OWN leave-trigger can still read it after CR 400.7 has
                // made the exiled card a different object.
                { op: "captureBinding", ref: "$exiled" },
            ],
        }),
        leftTrigger({
            id: "skyclave-apparition-token",
            oracleText:
                "When this creature leaves the battlefield, the exiled card's owner creates an X/X blue Illusion creature token, where X is the mana value of the exiled card.",
            scope: "self",
            // No `toZone` — the trigger fires on EVERY exit (died, bounced,
            // exiled, tucked), per the Oracle text.
            effects: [
                // Restore the row the ETB captured. Nothing captured → the
                // binding is never declared → the createToken below finds an
                // unresolved size and does nothing (CR 608.2b).
                { op: "recallCapturedBinding", bind: "$exiled" },
                {
                    op: "createToken",
                    token: {
                        name: "Illusion",
                        types: ["Creature"],
                        subtypes: ["Illusion"],
                        colors: ["U"],
                        // CR 202.3 — X is the exiled card's mana value, read off
                        // the snapshot taken before it left the battlefield.
                        power: { ref: "$exiled.manaValue" },
                        toughness: { ref: "$exiled.manaValue" },
                    },
                    // CR 108.3 — the exiled CARD's owner, not this ability's
                    // controller and not simply "the opponent".
                    controller: { ref: "$exiled.owner" },
                },
            ],
        }),
    ],
};
