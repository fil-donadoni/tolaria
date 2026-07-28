// BOK — colorless cards, split by colour per ADR 0043. The registry's
// `import * as bok from "./sets/bok"` resolves through bok/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { equipAbility } from "../../abilities/equipment";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";

// Umezawa's Jitte (issue #1341, parent PRD #620; depends on the Equipment
// spine #776/ADR 0065). The card ships the two engine capabilities #1341
// exists for, both of which the base subsystem deliberately excluded:
//
//  1. **`$host`** — the DSL selector for the source's `attachedTo`. "Equipped
//     creature gets +2/+2" acts on the equipped creature, which is NOT a
//     target (CR 115.10 — it's named by the ability's own text), so it needs
//     no target slot; `{ ref: "$host" }` reads the attachment at resolution
//     and the Op skips when the Jitte is unattached (CR 608.2b). Reusable by
//     every "regenerate enchanted creature"-shaped aura ability.
//  2. **Per-mode modal targeting** (`ActivatedAbility.modes`, CR 700.2 +
//     602.2b) — the activator locks a mode in at ANNOUNCEMENT, before targets
//     (CR 601.2b), and only that mode's `targetRequirement` is declared
//     (CR 700.2d). Without it the ability-level requirement would wrongly
//     force a creature target on the "+2/+2" and "gain 2 life" modes too.
//     Deliberately NOT the DSL `optionChoice` Op: that picks its mode DURING
//     resolution, which cannot lock a target at announcement and gives the
//     opponent no window to respond to the chosen mode.
//
// The rest is pre-existing: the combat-damage trigger keyed on the EQUIPPED
// creature (the Jitte itself never deals combat damage), charge counters on
// the Equipment via the `counters` Op, and an instant-speed
// `cost.removeCounter` activation whose frontend affordability gate the
// catalogue sweep already covers.
export const umezawasJitte: CardDefinition = {
    id: "3b6e5956-f795-451b-bb24-56462d1ced27",
    name: "Umezawa's Jitte",
    rarity: "rare",
    oracleText:
        "Whenever equipped creature deals combat damage, put two charge counters on Umezawa's Jitte.\nRemove a charge counter from Umezawa's Jitte: Choose one —\n• Equipped creature gets +2/+2 until end of turn.\n• Target creature gets -1/-1 until end of turn.\n• You gain 2 life.\nEquip {2}",
    manaCost: { generic: 2 },
    types: ["Artifact"],
    supertypes: ["Legendary"],
    subtypes: ["Equipment"],
    triggeredAbilities: [
        damageDealtTrigger({
            id: "umezawas-jitte-charge",
            oracleText:
                "Whenever equipped creature deals combat damage, put two charge counters on Umezawa's Jitte.",
            // The damage source is the EQUIPPED creature — not the Jitte, and
            // not "a creature you control": a control-change effect can move
            // the host to an opponent while the Equipment stays attached
            // (CR 301.5c) and the trigger still fires. `any` scope plus the
            // explicit host check below is the only combination that models
            // that faithfully.
            source: "any",
            // CR 510 — combat damage only. The Oracle text has NO "to a
            // player" clause, so damage dealt to a blocking creature counts
            // too: no `target` discriminator here.
            isCombat: true,
            condition: (event, self) =>
                self.attachedTo !== undefined &&
                event.sourceInstanceId === self.attachedTo,
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "charge",
                    target: { ref: "$source" },
                    count: 2,
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            // CR 602.2b / 700.2 — instant speed (no `sorcerySpeedOnly`); the
            // whole cost is the counter removal (CR 122.6), and the mode is
            // locked in at announcement.
            id: "umezawas-jitte-modes",
            oracleText:
                "Remove a charge counter from Umezawa's Jitte: Choose one — • Equipped creature gets +2/+2 until end of turn. • Target creature gets -1/-1 until end of turn. • You gain 2 life.",
            cost: { removeCounter: { type: "charge", count: 1 } },
            useStack: true,
            modes: [
                {
                    id: "pump-equipped",
                    label: "Equipped creature gets +2/+2",
                    oracleText:
                        "Equipped creature gets +2/+2 until end of turn.",
                    // No `targetRequirement` — the equipped creature is named
                    // by the text, not targeted (CR 115.10).
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$host" },
                            power: 2,
                            toughness: 2,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
                {
                    id: "shrink-target",
                    label: "Target creature gets -1/-1",
                    oracleText: "Target creature gets -1/-1 until end of turn.",
                    // CR 700.2d — only THIS mode declares a target.
                    targetRequirement: { type: "Creature", count: 1 },
                    effects: [
                        {
                            op: "pump",
                            target: { target: 0 },
                            power: -1,
                            toughness: -1,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
                {
                    id: "gain-life",
                    label: "You gain 2 life",
                    oracleText: "You gain 2 life.",
                    effects: [
                        { op: "gainLife", player: "controller", amount: 2 },
                    ],
                },
            ],
        },
        equipAbility({
            id: "umezawas-jitte-equip",
            cost: { generic: 2 },
            oracleText: "Equip {2}",
        }),
    ],
};
