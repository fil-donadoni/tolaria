import { useState } from "react";
import type { PendingTarget, Player, StackItem } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { pendingChoiceRequiresBoardTap } from "~/lib/pending-choice-labels";
import { wantsSpellTarget } from "~/lib/card-utils";
import { PORTRAIT_MIDLINE_TOP } from "~/lib/portrait-board-bands";
import BoardPileChips from "./board-pile-chips";
import StackChip from "./stack-chip";
import GameStack from "./game-stack";

/** Issue #1816 review fixup finding 1 (round 3 correction) — does the ACTIVE
 *  pendingTarget (this viewer's OWN target selection, gated on
 *  `pendingTarget.playerId === viewerPlayerId`) route a click to something on
 *  the mid-board? The ROUND 2 predicate (`types.some((t) => t !== "spell")`)
 *  over-collapsed: it treated ANY type other than the bare literal `"spell"`
 *  as board-bound, which wrongly included `"spell-or-permanent"` and a mixed
 *  array like `["Enchantment", "spell"]` — both of which CAN be satisfied by
 *  an item still inside the stack panel (Magical Hack, Sleight of Mind, Blind
 *  Seer, lace instants, Teferi's Care). Auto-collapsing for those made the
 *  panel disappear as the ONLY surface offering a clickable stack row, with
 *  nothing on the board to tap instead — selection became impossible.
 *
 *  The fix routes through {@link wantsSpellTarget} (`card-utils.ts`) — the
 *  SAME authority `GameStack`'s own `canTargetSpell` gate already uses to
 *  decide whether a stack row is clickable (CR 114.1 / CR 601.2c). Whenever
 *  that authority says the pendingTarget CAN be satisfied by something on the
 *  stack, the panel must stay open — full stop, never collapsed — because it
 *  is the only surface with a clickable stack row. Only a target that can
 *  NEVER land on the stack collapses the panel to clear the board.
 *
 *  A pure `"player"` target (`.claude/rules/gre-development.md` § Exhaustive
 *  target-type matching: every union member handled explicitly) is the other
 *  carve-out (review fixup round 3, finding 4): it resolves on a player
 *  nameplate, a region this narrow panel never overlaps (it anchors between
 *  the midline and the viewer battlefield's own bottom inset — see
 *  `GameStack`'s doc comment) — collapsing buys nothing there and only hides
 *  the stack the player may want to glance at while choosing. */
function pendingTargetWantsBoard(
    pendingTarget: PendingTarget | undefined,
    viewerPlayerId: string
): boolean {
    if (!pendingTarget || pendingTarget.playerId !== viewerPlayerId) {
        return false;
    }
    if (wantsSpellTarget(pendingTarget.targetType)) {
        return false;
    }
    const types = Array.isArray(pendingTarget.targetType)
        ? pendingTarget.targetType
        : [pendingTarget.targetType];
    if (types.length === 1 && types[0] === "player") {
        return false;
    }
    return true;
}

type BoardPortraitChipsProps = {
    /** Opponent and viewer, in either order — the opponent is looked up by
     *  IDENTITY (viewer id from context), never by array position (#1815
     *  review fixup, finding 5): a missing opponent seat left `orderedPlayers`
     *  a 1-element array whose sole (viewer's own) entry landed in the
     *  positional `opponent` slot, mislabeling the viewer's chips as the
     *  opponent's board-level row. */
    orderedPlayers: Player[];
    stackItems: StackItem[];
};

/** Portrait chip overlay (#336) — the phone replacement for the desktop
 *  right-edge control column. The space-eating pile columns and the always-on
 *  floating stack panel are gone; instead:
 *
 *  - opponent's graveyard / library / exile collapse to a chip row pinned
 *    top-left (clear of the opponent life pill on the top-right),
 *  - a stack chip sits at the right of the midline — the neutral band between
 *    the two battlefields — and toggles the EXISTING {@link GameStack} overlay,
 *    which is OPEN BY DEFAULT the instant the stack is non-empty (issue
 *    #1816): the chip only tracks whether the player explicitly collapsed
 *    THIS stack run, a preference that resets — panel open again — the next
 *    time a genuinely NEW item is pushed (review fixup finding 3: keyed on the
 *    IDENTITY of what's on the stack, not `stackItems.length` — a stack that
 *    stays the same length across a same-transaction resolve→trigger, or that
 *    GROWS because an opponent's counterspell answers a spell the player had
 *    already collapsed, both reopen too, so an incoming counterspell is never
 *    hidden).
 *
 *  **The panel auto-collapses while resolving the active choice/target
 *  requires tapping the mid-board itself (review fixup finding 1)** — an Echo
 *  / cumulative-upkeep may-pay's mana leg, any `zone: "battlefield"` choice,
 *  or this viewer's own pendingTarget landing on a permanent all need the
 *  board visible to finish, and the stack item they belong to stays ON the
 *  stack throughout (CR 601.2c / 608.2), so the panel would otherwise sit
 *  over the very permanents the flow needs tapped. This is NOT recorded into
 *  `userClosed` — it's a plain computed condition read fresh every render, so
 *  the moment the flow ends the condition goes false and the panel reverts to
 *  whatever `userClosed` already said, with no explicit "restore" step.
 *
 *  **The VIEWER's own graveyard / library / exile are NOT mounted here any
 *  more (#1815 review fixup).** An earlier revision mirrored the opponent's
 *  row to the bottom-left, anchored above the hand band — reviewed and
 *  reverted: on a 667×106 phone the reserved band tops out at ~37px while the
 *  chip row needs 44px (`min-h-11`), so it either overlapped the battlefield's
 *  own back row or starved the card-width floor (≥44px) that same band
 *  budget guarantees elsewhere (`portrait-board-bands.ts`). The viewer's row
 *  now mounts INLINE in the controller bottom bar instead
 *  (`controller-bottom-bar.tsx`, `BoardPileChips`'s `compact` mode) — see that
 *  module's doc comment for the full account, including the accepted
 *  opponent-top / viewer-in-bar asymmetry.
 *
 *  This is still the sole portrait mount of {@link BoardPileChips} for the
 *  OPPONENT'S seat. The viewer's own mount (in the bottom bar) is likewise the
 *  sole mount of `PlayerLibrary` / `PlayerGraveyard` / `PlayerExile` for that
 *  seat, which matters beyond display: those own the BLOCKING pile choice
 *  surfaces (`LibraryOrderPicker`, the `forceOpen` pile grids for library
 *  search / graveyard / exile picks). Because the bar is always mounted AND
 *  always visible (no `hidden` wrapper, no drawer to open), those surfaces
 *  are on-screen the instant a choice goes pending — no force-open plumbing
 *  needed; there is nothing to force open any more.
 *
 *  Every chip opens the EXISTING reveal / stack view (the pile components in
 *  controlled-open mode, the stack panel toggled) — nothing is rebuilt. Mounted
 *  only on the portrait branch; landscape/desktop keep {@link BoardPiles}.
 *  View layer only. */
export default function BoardPortraitChips({
    orderedPlayers,
    stackItems,
}: BoardPortraitChipsProps) {
    const { playerId, pendingChoices, pendingTarget } = useGameContext();
    const opponent = orderedPlayers.find((p) => p.id !== playerId);
    // Issue #1816 — the panel is OPEN BY DEFAULT whenever the stack is
    // non-empty; the chip only tracks whether the player has explicitly
    // collapsed THIS stack run. `userClosed` starts false, so a fresh mount
    // with an already non-empty stack (the common case: navigating onto a
    // board mid-resolution) shows the panel with no tap required.
    const [userClosed, setUserClosed] = useState(false);

    // Issue #1816 review fixup findings 3 & 4 — reopen on the IDENTITY of
    // what's on the stack (a genuinely NEW item id that wasn't there a moment
    // ago), not on `stackItems.length`, and do the reset DURING RENDER rather
    // than a `useEffect` — the same "adjust state when a prop changes"
    // pattern `useMinimizedChoiceState` already uses
    // (https://react.dev/reference/react/useState#storing-information-from-previous-renders)
    // — so there is no dropped frame where the panel commits stale-closed and
    // an effect corrects it a tick later.
    //
    // `stackItems.length` alone missed two real cases: a resolve+trigger in
    // the SAME transaction (stack goes [A] → [B], length constant at 1 — no
    // 0-crossing for a length-only check to catch), and an incoming
    // counterspell answering a spell the player had already collapsed
    // ([A] → [Counterspell, A], length 1 → 2 — growth, but still no
    // 0-crossing). The fix: reopen on ANY new push — an id present now that
    // was NOT in the immediately-previous render's stack — which covers
    // 0 → n (the original "a new run starts open" AC) AND both cases above
    // (the review's explicit "awareness" ask: the player must see an
    // incoming counterspell even if they'd closed the panel on the spell it
    // answers). Purely SHRINKING (an item resolves off, nothing new arrives)
    // is not a push and leaves the collapse preference untouched.
    const currentStackIds = stackItems.map((item) => item.id);
    const [prevStackIds, setPrevStackIds] = useState<string[]>(currentStackIds);
    const hasNewPush = currentStackIds.some((id) => !prevStackIds.includes(id));
    if (hasNewPush || currentStackIds.length !== prevStackIds.length) {
        setPrevStackIds(currentStackIds);
    }
    if (hasNewPush) {
        setUserClosed(false);
    }

    // Issue #1816 review fixup finding 1 — see the module doc comment above:
    // a BLOCKING mitigation, not a preference, so it is deliberately kept
    // OUT of `userClosed` and just recomputed fresh every render.
    //
    // `pendingChoices?.[0]` (review fixup round 3, note 5) — NOT a `.find`
    // over the queue: `pendingChoices` is FIFO-ordered (only the head is ever
    // actionable; a later entry is queued behind it, not concurrently live),
    // and the SAME `[0]` + explicit `.playerId === viewer` gate is how
    // `board.tsx` itself reads this field everywhere it does (see its
    // `pendingChoices[0].playerId === ...` call sites) — this mirrors that
    // established convention rather than diverging with a `.find`.
    const activeChoice = pendingChoices?.[0];
    const autoCollapsedForBoardTap =
        (!!activeChoice &&
            activeChoice.playerId === playerId &&
            pendingChoiceRequiresBoardTap(activeChoice)) ||
        pendingTargetWantsBoard(pendingTarget, playerId);

    const stackOpen =
        stackItems.length > 0 && !userClosed && !autoCollapsedForBoardTap;

    return (
        <>
            {/* #1867 — vertical column pinned top-RIGHT, not a horizontal
                top-left row: the row (~180px of `min-w-14` chips) overlapped
                the opponent's top-center compact nameplate on phone widths.
                Top-right is clear of it, and clear of the stack chip too
                (that sits at the midline, well below this ~140px column). */}
            {opponent && (
                <div
                    className="absolute right-2 top-2 z-30"
                    data-testid="pile-chips-row-opponent"
                >
                    <BoardPileChips player={opponent} vertical />
                </div>
            )}

            {/* The midline is the shared band boundary (#1760), which sits
                half the bottom bar's clearance above the viewport centre — not
                a literal `top-1/2`, or the chip would drift into the viewer's
                battlefield.
                z-chip (issue #1813 review fixup round 2, #1823) — NOT
                z-modal-top. A centered pending-choice banner now renders at
                the lower `z-banner` tier (`usePromptBannerPosition`), and
                `z-chip` sits one rung above it so this chip stays tappable
                regardless of what prompt is showing — but strictly BELOW
                `z-modal`, so a real blocking modal (trigger-order-prompt,
                mana-choice-picker, the reveal overlays) still wins outright
                rather than the chip painting through its scrim. See
                `src/index.css`'s `--z-banner`/`--z-chip`/`--z-modal` comment
                for the full 3-rung rationale. */}
            <div
                className={`absolute right-2 ${PORTRAIT_MIDLINE_TOP} z-chip -translate-y-1/2`}
                data-testid="stack-chip-row"
            >
                <StackChip
                    count={stackItems.length}
                    open={stackOpen}
                    onToggle={() => {
                        // Review fixup round 3, note 6 — a tap during the
                        // BLOCKING auto-collapse (see the module doc comment)
                        // is a no-op for `stackOpen` either way (the panel
                        // stays closed regardless of `userClosed`), but
                        // WITHOUT this guard it still silently FLIPS
                        // `userClosed`. That flip is invisible in the moment
                        // (nothing on screen changes) yet corrupts the
                        // preference for later: once the auto-collapse
                        // condition clears, the panel would stay wrongly
                        // closed (a stray true `userClosed`) or wrongly open
                        // (a stray false one from a second accidental tap)
                        // instead of reverting to whatever the player
                        // actually intended. Ignoring the tap outright keeps
                        // `userClosed` exactly as the player last
                        // deliberately left it.
                        if (autoCollapsedForBoardTap) return;
                        setUserClosed((v) => !v);
                    }}
                />
            </div>

            {/* The stack overlay is the EXISTING panel, toggled by the chip
                instead of being always-on. `elevated` (issue #1813 review
                fixup, #1823) puts it at the SAME `z-chip` tier as the chip
                above — opening the stack is an explicit player action; it
                must out-rank the (lower) centered pending-choice banner, but
                — like the chip — stay below any real blocking modal.
                `narrow` (issue #1816) is the SAME portrait-only distinction:
                since this panel is now open by DEFAULT (not only after a
                tap), it renders narrower and clearance-bound to the midline /
                viewer-battlefield-bottom instead of the desktop's vertically
                centered, vh-capped box — see `GameStack`'s own doc comment. */}
            {stackOpen && stackItems.length > 0 && (
                <GameStack stack={stackItems} elevated narrow />
            )}
        </>
    );
}
