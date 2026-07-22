import { PERMANENT_TYPES } from "../../types";
import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";
import { holdsExileBundle } from "../../abilities/exileBundle";

// Banishing Light — O-Ring-style exile-until-leaves (Journey into Nyx).
//
// The ETB trigger (CR 603.6a) exiles a chosen nonland permanent an opponent
// controls keyed to this enchantment (ADR 0028 exile-and-return bundle), and
// the leaves-the-battlefield trigger (CR 603.7a) returns it. Crucially this
// exiles ONLY the host (`includeAttachments: false`, CR 701.18): unlike
// Tawnos's Coffin the host's Auras are NOT bundled, so they fall to the
// graveyard via the orphan-aura SBA (CR 704.5n) and its Equipment detaches and
// stays on the battlefield — neither is exiled nor returned. The exiled card is
// surfaced pinned to this enchantment on the board via the mechanism-agnostic
// `exiledByPermanentId` projection link (derived from the `exileHeld` bundle's
// `sourceId`), the same affordance Ice Cauldron's noted card uses.
//
// The return half is an armed delayed trigger: its condition (`holdsExileBundle`,
// shared with the Parallax cycle) gates on the bundle's existence so it never
// fires with nothing held.
export const banishingLight: CardDefinition = {
    id: "fbaa4800-30cc-4a80-a6cc-9a24ada9eb40",
    rarity: "uncommon",
    name: "Banishing Light",
    oracleText:
        "When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        // CR 603.6a — ETB trigger. CR 603.3d — "exile target nonland permanent
        // an opponent controls" is a REAL target chosen when the trigger is put
        // on the stack (issue #1193 machinery, `raiseTriggerTargetSelection` in
        // gre/rules.ts), NOT a resolution-time `requestChoice`. That makes it
        // subject to hexproof / protection / ward and fires "becomes the target
        // of an ability" triggers, which the old choice-as-target workaround
        // silently skipped. `type: PERMANENT_TYPES minus Land` = "nonland
        // permanent" (the Boomerang idiom); `controller: "opponent"` scopes the
        // candidate set to the opponent's battlefield; `count 1` = one
        // mandatory target. The resolve() then reads the announced target and
        // performs the host-only exile.
        enteredTrigger({
            id: "banishing-light-exile",
            oracleText:
                "When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.",
            scope: "self",
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                count: 1,
                excludeTypes: "Land",
                controller: "opponent",
            },
            // CR 701.18 — host-only exile (auras die to the orphan-aura SBA,
            // equipment detaches); ADR 0028 arms the return keyed to `$source`.
            // The `exileWithAttachments` Op reads the announced target
            // (`{ target: 0 }`) and defaults `includeAttachments`/`returnTapped`
            // to false — the host-only O-Ring shape (ADR 0045 DSL-first).
            effects: [{ op: "exileWithAttachments", target: { target: 0 } }],
        }),
        leftTrigger({
            // CR 603.7a — return the exiled permanent when this leaves play.
            id: "banishing-light-return",
            oracleText:
                "When this enchantment leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
            scope: "self",
            condition: holdsExileBundle,
            effects: [{ op: "returnExiledForSource" }],
        }),
    ],
};
