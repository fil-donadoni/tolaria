// Epic (CR 702.50).
//
// CR 702.50a — "Epic represents two spell abilities, one of which creates a
//               delayed triggered ability. 'Epic' means 'For the rest of the
//               game, you can't cast spells,' and 'At the beginning of each of
//               your upkeeps for the rest of the game, copy this spell except
//               for its epic ability. If the spell has any targets, you may
//               choose new targets for the copy.'"
// CR 702.50b — "A player can't cast spells once a spell with epic they control
//               resolves, but effects (such as the epic ability itself) can
//               still put copies of spells onto the stack."
//
// Both abilities take effect as the spell finishes resolving, so a spell that
// never resolves (countered, or all its targets illegal, CR 608.2b) does
// neither. The lock is a `playerRestrictions` entry, read by the one shared cast
// gate; a copy is put on the stack, not cast, so it never meets that gate
// (CR 707.10).
//
// The spell is gone by the first upkeep, so the delayed trigger holds its own
// snapshot, already without the keyword: "except for its epic ability" is the
// absence of the keyword on every copy. A copy of an epic spell made by anything
// else (a Fork) keeps the ability and locks whoever controls it.
import { allocInstanceId } from "./lookup";
import { addPlayerRestriction } from "./playerRestrictions";
import type {
    DelayedTriggerInstance,
    GameState,
    StackItem,
} from "./state/declarations";

export const EPIC_KEYWORD = "epic";

/** CR 702.50a — the epic abilities of `spell`, which has just resolved. Reads
 *  the keyword off the object rather than its definition: the definition of a
 *  copy still prints epic, and the copy no longer has it. */
export function applyEpicAbilities(state: GameState, spell: StackItem): void {
    if (!spell.staticAbilities?.includes(EPIC_KEYWORD)) return;
    const controller = spell.controllerId;
    addPlayerRestriction(state, controller, "cantCastSpells");
    const spellToCopy = structuredClone(spell);
    spellToCopy.staticAbilities = spell.staticAbilities.filter(
        (keyword) => keyword !== EPIC_KEYWORD
    );
    state.nextDelayedSeq = (state.nextDelayedSeq ?? 0) + 1;
    state.delayedTriggers = [
        ...(state.delayedTriggers ?? []),
        {
            id: `delayed-${state.nextDelayedSeq}`,
            sourceCardId: (spell.card as { id?: string }).id ?? "",
            triggerId: EPIC_KEYWORD,
            controller,
            timing: "each-own-upkeep",
            targetPlayerId: controller,
            payload: {},
            spellToCopy,
        },
    ];
}

/** CR 702.50a — the stack item of one firing, resolved by the cast-copy path
 *  with a count of one: it clones the snapshot under the trigger's controller and
 *  offers new targets (CR 707.10c). The item itself targets nothing, and is not
 *  the spell it copies. */
export function buildEpicCopyTrigger(
    state: GameState,
    t: DelayedTriggerInstance & { spellToCopy: StackItem }
): StackItem {
    return {
        ...t.spellToCopy,
        id: allocInstanceId(state),
        zone: "stack",
        controllerId: t.controller,
        castById: t.controller,
        triggeredAbilityId: EPIC_KEYWORD,
        triggerSourceId: t.spellToCopy.id,
        targets: undefined,
        overloaded: undefined,
        castFromZone: undefined,
        isCopy: undefined,
        castCopySnapshot: structuredClone(t.spellToCopy),
        castCopiesRemaining: 1,
    };
}
