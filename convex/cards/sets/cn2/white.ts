// CN2 (Conspiracy: Take the Crown, 2016) — white cards, split by colour per ADR 0043. The
// registry's `import * as cn2 from "./sets/cn2"` resolves through
// cn2/index.ts.
import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Palace Jailer — {2}{W}{W} Creature — Human Soldier, 2/2 (CN2, issue #1199).
// "When this creature enters, you become the monarch. When this creature
// enters, exile target creature an opponent controls until an opponent
// becomes the monarch." Two independent ETB triggers (CR 603.6a); order
// between them is immaterial (neither reads the other's outcome).
//
// The FIRST ability ("you become the monarch") is a plain DSL `becomeMonarch`
// Op call — CR 720.2, ADR 0045.
//
// The SECOND ability is a genuinely new "exile until" return condition — not
// "this permanent leaves the battlefield" (the O-Ring / Banishing Light /
// Portable Hole template, all of which stay resolve() in this codebase
// because NO Effect Script Op exists yet for ANY exile-until-condition
// shape), but "an opponent of the exiler becomes the monarch" (CR 720,
// official ruling: ANY opponent qualifies, and Palace Jailer itself leaving
// play does NOT release the hold). protocol card: no Op expresses a
// conditional-exile-until-a-non-source-leaves duration, matching the sibling
// O-Ring-style cards' precedent; `ctx.exileUntilMonarchChanges` (a thin
// SpellContext primitive over `exileWithAttachments` + a new
// `GameState.monarchReturnWatch` release condition consumed by
// `becomeMonarch`) is the smallest primitive that composes the existing
// exile/return machinery with the new release condition rather than
// inventing a card-shaped effect.
export const palaceJailer: CardDefinition = {
    id: "78cef262-c753-4658-b3ec-fec8db47f944",
    rarity: "uncommon",
    name: "Palace Jailer",
    oracleText:
        "When this creature enters, you become the monarch.\nWhen this creature enters, exile target creature an opponent controls until an opponent becomes the monarch.",
    manaCost: { generic: 2, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "palace-jailer-monarch",
            oracleText: "When this creature enters, you become the monarch.",
            scope: "self",
            effects: [{ op: "becomeMonarch" }],
        }),
        enteredTrigger({
            id: "palace-jailer-exile",
            oracleText:
                "When this creature enters, exile target creature an opponent controls until an opponent becomes the monarch.",
            scope: "self",
            // CR 603.3d (issue #1193) — targeted ETB trigger: the target is
            // announced when this ability goes on the stack, not chosen
            // mid-resolution (unlike the older O-Ring-style cards this
            // codebase shipped before #1193 unblocked targeted triggers).
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "opponent",
            },
            resolve: (ctx: SpellContext) => {
                const targetId = ctx.targets?.[0]?.id;
                if (!targetId) return;
                ctx.exileUntilMonarchChanges(targetId);
            },
        }),
    ],
};
