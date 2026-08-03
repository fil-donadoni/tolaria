// Shared Equipment ability shapes (CR 301.5, ADR 0065's unified attachment
// model). Equipment reuses the Aura plumbing wholesale: `attachedTo` for host
// tracking, `AURA_AFFECTS_HOST` for the grant, `checkAttachmentSBA` for the
// detach — so the only card-facing repetition worth factoring out is the two
// printed keyword shells every Equipment carries.

import type { EffectOp, ManaCost, ActivatedAbility } from "../types";
import type { TriggeredAbility } from "../types";
import { PHYREXIAN_GERM_TOKEN } from "../sharedTokens";
import { enteredTrigger } from "./triggers/enteredTrigger";

/** Builds an `Equip {cost}` activated ability (CR 702.6).
 *
 *  CR 702.6a/702.6e — Equip is an activated ability of the Equipment that
 *  targets a creature its controller controls and is activatable **only as a
 *  sorcery**. The body is the generic `attach` Op (CR 701.3), the single
 *  attachment primitive ADR 0065 settled on; `Equip` is just its shell, the
 *  same way Reconfigure (Lion Sash, `neo/white.ts`) is.
 *
 *  Extracted on the rule of two (see `feedback_extract_after_second`): the
 *  identical literal was already inline on Bonesplitter (`mrd/colorless.ts`),
 *  Skullclamp (`dst/colorless.ts`), Cori-Steel Cutter (`tdm/red.ts`) and
 *  Glimmer Lens (`otj/colorless.ts`) before the Living Weapon cards (#1340)
 *  and Umezawa's Jitte (#1341) added four more. */
export function equipAbility(args: {
    /** Ability id — conventionally `<card-slug>-equip`. */
    id: string;
    /** The printed Equip cost (CR 702.6a). */
    cost: ManaCost;
    /** Printed reminder-free oracle line, e.g. `"Equip {1}{R}"`. */
    oracleText: string;
}): ActivatedAbility {
    return {
        // CR 702.6e — Equip is sorcery-speed-only and targets a creature its
        // controller controls (CR 702.6a). The controller restriction binds
        // only at activation: once attached, the Equipment rides its host
        // through a control change (CR 301.5c, ADR 0065).
        id: args.id,
        oracleText: args.oracleText,
        cost: { mana: args.cost },
        sorcerySpeedOnly: true,
        targetRequirement: { type: "Creature", count: 1, controller: "you" },
        useStack: true,
        effects: [{ op: "attach", target: { target: 0 } }],
    };
}

/** Builds the Living Weapon triggered ability (CR 702.92).
 *
 *  CR 702.92a — "Living weapon" means "When this Equipment enters, create a
 *  0/0 black Phyrexian Germ creature token, then attach this Equipment to
 *  it." One self-ETB trigger, two Ops, and NOTHING equipment-specific in the
 *  engine: the `createToken` Op's `bind` snapshots the just-created token
 *  (there is no announced-target form for an object that didn't exist when
 *  the ability was put on the stack, CR 601.2b) and the generic `attach` Op
 *  reads it back — the exact `createToken`→`attach` chain Cori-Steel Cutter
 *  (`tdm/red.ts`) already exercises, minus the "you may" leg (living weapon's
 *  attach is forced, and costs no Equip mana).
 *
 *  On the far side: when the Equipment later detaches (host gone, or the
 *  Equipment itself leaves), the Germ is an unbuffed 0/0 and dies to the
 *  zero-toughness SBA (CR 704.5f), while the Equipment detaches in place and
 *  stays on the battlefield (CR 704.5q, ADR 0065). Both are pre-existing
 *  engine behavior — living weapon adds no new detach path. */
export function livingWeapon(args: {
    /** Ability id — conventionally `<card-slug>-living-weapon`. */
    id: string;
}): TriggeredAbility {
    return enteredTrigger({
        id: args.id,
        oracleText:
            "Living weapon (When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it.)",
        scope: "self",
        effects: [
            {
                op: "createToken",
                // Shared spec — art is auto-resolved per producing card from
                // the token-print lockfile, so each printing gets its own Germ.
                token: PHYREXIAN_GERM_TOKEN,
                controller: "controller",
                bind: "$germ",
            },
            { op: "attach", target: { ref: "$germ" } },
        ] satisfies EffectOp[],
    });
}
