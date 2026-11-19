import InspectOverlay from "~/components/editing/inspect-overlay";
import type { CardPreviewView } from "~/components/cards/card-preview-mode-toggle";
import type { SideboardPoolRow, SideboardZone } from "~/lib/sideboard-pool";

/** The phone's card read (issue #9820): the editing surfaces' Inspect
 *  Overlay with the four moves — the primary one moves the card OUT of where
 *  it is — and ‹ › stepping over the visible pool (Maindeck first, then the
 *  Sideboard-only cards). */
export default function SideboardInspect({
    row,
    order,
    onGo,
    onClose,
    onMove,
    disabled,
    view,
    onViewChange,
}: {
    row: SideboardPoolRow;
    order: SideboardPoolRow[];
    onGo: (cardId: string) => void;
    onClose: () => void;
    onMove: (cardId: string, to: SideboardZone, all: boolean) => void;
    disabled: boolean;
    view: CardPreviewView;
    onViewChange: (view: CardPreviewView) => void;
}) {
    const i = order.findIndex((r) => r.cardId === row.cardId);
    const prev = i > 0 ? order[i - 1] : undefined;
    const next = i >= 0 ? order[i + 1] : undefined;
    return (
        <InspectOverlay
            cardId={row.cardId}
            onClose={onClose}
            view={view}
            onViewChange={onViewChange}
            onStep={{
                previous: prev ? () => onGo(prev.cardId) : undefined,
                next: next ? () => onGo(next.cardId) : undefined,
            }}
            actions={[
                {
                    label: `All${row.side > 1 ? ` ${row.side}` : ""} → Maindeck`,
                    onSelect: () => onMove(row.cardId, "main", true),
                    disabled: disabled || row.side < 2,
                },
                {
                    label: "1 → Maindeck",
                    onSelect: () => onMove(row.cardId, "main", false),
                    disabled: disabled || row.side === 0,
                    primary: row.main === 0,
                },
                {
                    label: "1 → Sideboard",
                    onSelect: () => onMove(row.cardId, "side", false),
                    disabled: disabled || row.main === 0,
                    primary: row.main > 0,
                },
                {
                    label: `All${row.main > 1 ? ` ${row.main}` : ""} → Sideboard`,
                    onSelect: () => onMove(row.cardId, "side", true),
                    disabled: disabled || row.main < 2,
                },
            ]}
        />
    );
}
