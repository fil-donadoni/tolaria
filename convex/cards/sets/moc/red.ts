// MOC — red cards, split by colour per ADR 0043. The registry's
// `import * as moc from "./sets/moc"` resolves through moc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { dashTrigger } from "../../abilities/dash";
import { backupTrigger } from "../../abilities/triggers/backupTrigger";

// Death-Greeter's Champion — {2}{R} Creature — Human Warrior, 2/1 (MOC 30,
// Vintage Cube FREE wave 3: keyword-residue creatures, issue #1527, closes
// #1322/#917 residue). Un-stubbed now that both blocking keywords are
// `implemented`: Dash (CR 702.109, issue #1314) and Backup (CR 702.165,
// issue #1315). "Dash {3}{R}\nBackup 1 (When this creature enters, put a
// +1/+1 counter on target creature. If that's another creature, it gains
// the following ability until end of turn.)\nDouble strike."
//
// DSL-first (ADR 0045) — entirely factory-composed, no per-card resolve():
//   - Dash: `CardDefinition.dash` (the `AlternativeCost` mana-leg shape) +
//     `dashTrigger(name)` (`abilities/dash.ts`) for the haste-grant +
//     next-end-step return. First catalogue card to actually consume Dash
//     end to end (the mechanic was previously proven only by a synthetic
//     probe, `gre/__tests__/dash.test.ts`).
//   - Backup 1: `backupTrigger(1, ["double strike"])` — the SAME factory
//     Consuming Aetherborn (`mom/black.ts`) already proved, granting the
//     card's own printed ability (double strike) to a non-self target.
export const deathGreetersChampion: CardDefinition = {
    id: "7cb2b582-1c45-4bb2-8aef-59a71a5a9e94", // MOC 30
    name: "Death-Greeter's Champion",
    rarity: "rare",
    oracleText:
        "Dash {3}{R} (You may cast this spell for its dash cost. If you do, it gains haste, and it's returned from the battlefield to its owner's hand at the beginning of the next end step.)\nBackup 1 (When this creature enters, put a +1/+1 counter on target creature. If that's another creature, it gains the following ability until end of turn.)\nDouble strike",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Warrior"],
    power: 2,
    toughness: 1,
    dash: { id: "dash", description: "Dash {3}{R}", mana: { X: 3, R: 1 } },
    // CR 702.165c — "backup 1" is board-visible reminder data; "double
    // strike" is the card's OWN printed ability (both applies to itself
    // always, per CR 702.9, AND is what backupTrigger(1, [...]) grants a
    // non-self target).
    staticAbilities: ["backup 1", "double strike"],
    triggeredAbilities: [
        backupTrigger(1, ["double strike"]),
        dashTrigger("Death-Greeter's Champion"),
    ],
};
