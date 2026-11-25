import { tryGetDefinition } from "../cards";
import { copyExceptName } from "../cards/cardNames";
import type { GameState, StackItem } from "./state";

/** CR 601.2b — "If the spell has a variable cost that will be paid as it's
 *  being cast (such as an {X} in its mana cost; see rule 107.3), the player
 *  announces the value of that variable." CR 602.2b applies the same
 *  announcement to an activated ability. The value is public, so the moment a
 *  stack item carrying `chosenX` is put onto the stack it is written to the
 *  one-slot `lastChoiceAnnouncement` every seat reads (the board's notice
 *  toast, deduped client-side by `key`).
 *
 *  Called by every commit that puts a spell or ability with a chosen X onto
 *  the stack; a no-op for an item without one. A face-down spell is not
 *  announced: its name is hidden (CR 708.2) and no face-down cast has an X. */
export function announceChosenX(state: GameState, item: StackItem): void {
    if (item.chosenX === undefined || item.faceDown) return;
    const name =
        copyExceptName(item) ?? tryGetDefinition(item.card.id as string)?.name;
    const seq = (state.lastChoiceAnnouncement?.seq ?? 0) + 1;
    state.lastChoiceAnnouncement = {
        key: `${seq}:${item.id}:x:chosen-x`,
        seq,
        chooserId: item.castById,
        kind: "chosen-x",
        xValue: item.chosenX,
        ...(name ? { cardName: name } : {}),
        ...(item.abilityId !== undefined ? { isAbility: true } : {}),
    };
}
