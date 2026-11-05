// Split second (CR 702.61).
//
// CR 702.61a — "Split second is a static ability that functions only while the
//              spell with split second is on the stack. 'Split second' means 'As
//              long as this spell is on the stack, players can't cast other
//              spells or activate abilities that aren't mana abilities.'"
// CR 702.61b — "Players may activate mana abilities and take special actions
//              while a spell with split second is on the stack. Triggered
//              abilities trigger and are put on the stack as normal while a
//              spell with split second is on the stack."
// CR 702.61c — "Multiple instances of split second on the same spell are
//              redundant."
//
// Nothing is materialized: the lock is read off the stack, so it starts and ends
// with the spell. It reaches every consumer through the two shared gates, which
// the server, the Bot's enumerator and the wire's `legalActions` already read:
// `castProhibitionReason` for a cast, casts during resolution included, and
// `activationPreconditionViolation` for an activation. Special actions and land
// plays read neither, and triggers are untouched (CR 702.61b).
//
// The read is the object's own `staticAbilities`, so a split or Adventure spell
// has the keyword only if the half on the stack does (`castAsSplitHalf`), a
// face-down spell has none (CR 708.2, `turnFaceDown`), and a copy of the spell has
// it (CR 707.2). `isSpellStackItem` excludes an ability on the stack, whose item
// spreads its source's fields, so a permanent with the keyword locks nothing.

import { isSpellStackItem } from "../../gre/constants";

export const SPLIT_SECOND_KEYWORD = "split second";

/** The stack as both the engine and the wire's slim items carry it. */
export interface SplitSecondStackView {
    stack?: ReadonlyArray<{
        abilityId?: string;
        triggeredAbilityId?: string;
        delayedTriggerId?: string;
        staticAbilities?: ReadonlyArray<string>;
    }>;
}

/** CR 702.61a — true while a spell with split second is on the stack. */
export function splitSecondSpellOnStack(state: SplitSecondStackView): boolean {
    return (
        state.stack?.some(
            (item) =>
                isSpellStackItem(item) &&
                item.staticAbilities?.includes(SPLIT_SECOND_KEYWORD) === true
        ) ?? false
    );
}

/** The player ids the client must treat as unable to activate non-mana abilities
 *  right now: the Abeyance turn lock (CR 602.1 / 605.1a), or every player while
 *  CR 702.61a holds. A UI hint only; the server gates stay the authority. */
export function nonManaActivationLockedPlayers(
    state: SplitSecondStackView & {
        players: ReadonlyArray<{ id: string }>;
        cannotActivateAbilitiesThisTurn?: string[];
    }
): string[] | undefined {
    return splitSecondSpellOnStack(state)
        ? state.players.map((p) => p.id)
        : state.cannotActivateAbilitiesThisTurn;
}
