// PROTOTYPE — throwaway. Shared "click the cluster → open a graveyard-style
// pile" dialog, reused by all three attachment-cluster variants. Wraps the real
// `CardsPile` in its controlled mode so the prototype uses the exact reveal
// surface the graveyard/exile zones already ship.
import type { MockAttachment } from "./mock-attachment-data";
import CardsPile from "../board/cards-pile";

export default function AttachmentPileDialog({
    title,
    attachments,
    open,
    onOpenChange,
}: {
    title: string;
    attachments: MockAttachment[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    return (
        <CardsPile
            cards={attachments.map((a) => a.card)}
            title={title}
            layout="grid"
            open={open}
            onOpenChange={onOpenChange}
        />
    );
}
