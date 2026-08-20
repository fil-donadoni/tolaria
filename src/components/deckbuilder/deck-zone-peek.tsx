import { useState } from "react";
import type { ColumnId } from "@convex/deckLayout";
import PeekPanel from "~/components/editing/peek-panel";
import InspectOverlay from "~/components/editing/inspect-overlay";
import ActionSheet from "~/components/ui/action-sheet";
import type { EditingSurfaceAction } from "~/components/editing/editing-surface-action";
import type { DeckZoneSelection } from "./deckZoneSelection";

export interface DeckZonePeekProps {
    /** The selected card, or `null` for "nothing selected". */
    selection: DeckZoneSelection | null;
    /** One line under the name — the surface's own summary. */
    subtitle?: string;
    /** Dismiss the panel (a DISMISSAL, not a deselection — the parent decides
     *  whether the card stays selected). */
    onClose: () => void;
    /** The surface's own CTAs, rendered FIRST and in order: "→ Side",
     *  "★ Featured", … The panel appends "Move to…" and "Inspect" itself,
     *  because those two are the same on every deck zone. */
    actions: readonly EditingSurfaceAction[];
    /** Records a Card Pin. Presence (with a non-empty
     *  {@link DeckZoneSelection.columns}) is what offers "Move to…". */
    onPin?: (cardId: string, columnId: ColumnId, pinKey: string) => void;
    /** Card currently open in the Inspect Overlay, if any — as a full
     *  {@link DeckZoneSelection}, not a bare id. Held by the PARENT because a
     *  right click opens it with no selection at all (issue #2584's pointer
     *  path to Inspect), and carried as a selection because the overlay's own
     *  CTA row is derived from the inspected CARD: deriving it from the
     *  touch-only selection instead left "★ Featured" unreachable at every
     *  pointer viewport (PR #2641 review, blocker 2). */
    inspecting?: DeckZoneSelection | null;
    /** The surface's CTAs for the INSPECTED card — the same set
     *  {@link DeckZonePeekProps.actions} holds for the selected one, built by
     *  the parent from one function so the two rows cannot drift. */
    inspectActions: readonly EditingSurfaceAction[];
    onInspect: (selection: DeckZoneSelection) => void;
    onCloseInspect: () => void;
}

/**
 * The deck zones' adoption of the Peek Panel / Inspect Overlay (issue #2584,
 * PRD #2405 D16) — the FIRST consumer of the #2583 gesture primitives outside
 * the Draft Room (`docs/findings/2583-gesture-engine-ships-with-no-consumer.md`).
 *
 * It exists because two surfaces render a PAIR of `DeckZoneSurface`s — the
 * deckbuilder (`DeckZonesSurface`) and the Draft Room's pool
 * (`LimitedDraftPool`) — and both need exactly one panel for the two zones.
 * Zone-owned panels would mean two open at once; a second copy of the wiring
 * would mean the two surfaces' CTA sets drifting apart.
 *
 * The CTA set is [surface CTAs] + "Move to…" + "Inspect". The last two are
 * appended here rather than by each caller precisely because they are NOT
 * surface-specific: "Move to…" pins through the SAME `onPin` seam a drag
 * resolves to (`deckZoneDrag.ts`), and "Inspect" is the read path that
 * replaced the removed long-press preview.
 *
 * "Move to…" opens an `ActionSheet` rather than the popover the per-tile menu
 * used (`DeckCardMoveMenu`, retired by this issue): the trigger is now a CTA
 * in a bottom sheet / right rail, not a 20px button anchored to a card, so
 * there is nothing to anchor a popover to.
 */
export default function DeckZonePeek({
    selection,
    subtitle,
    onClose,
    actions,
    onPin,
    inspecting,
    inspectActions,
    onInspect,
    onCloseInspect,
}: DeckZonePeekProps) {
    const [pickingColumn, setPickingColumn] = useState(false);

    const canMove = !!onPin && !!selection && selection.columns.length > 0;

    const peekActions: readonly EditingSurfaceAction[] = selection
        ? [
              ...actions,
              ...(canMove
                  ? [
                        {
                            label: "Move to…",
                            onSelect: () => setPickingColumn(true),
                        },
                    ]
                  : []),
              {
                  label: "Inspect",
                  onSelect: () => onInspect(selection),
              },
          ]
        : [];

    // The overlay's own CTA row is the panel's minus "Inspect" (already
    // inspecting) and minus "Move to…" (its sheet would paint under the
    // overlay's scrim), each closing the overlay after firing — otherwise a
    // "→ Side" tap moves the card and leaves a full-screen read of a card that
    // is no longer where the player is looking. Same rule the Draft Room
    // established in #2583.
    const overlayActions: readonly EditingSurfaceAction[] = inspectActions.map(
        (action) => ({
            ...action,
            onSelect: () => {
                action.onSelect();
                onCloseInspect();
            },
        })
    );

    return (
        <>
            {selection && (
                <PeekPanel
                    cardId={selection.cardId}
                    name={selection.cardName}
                    subtitle={subtitle}
                    actions={peekActions}
                    onClose={onClose}
                />
            )}

            {inspecting && (
                <InspectOverlay
                    cardId={inspecting.cardId}
                    actions={overlayActions}
                    onClose={onCloseInspect}
                />
            )}

            {selection && (
                <ActionSheet
                    open={pickingColumn}
                    onClose={() => setPickingColumn(false)}
                    items={selection.columns.map((column) => ({
                        key: column.id,
                        label: column.label,
                        onSelect: () => {
                            onPin?.(
                                selection.cardId,
                                column.id,
                                selection.pinKey
                            );
                            setPickingColumn(false);
                        },
                    }))}
                />
            )}
        </>
    );
}
