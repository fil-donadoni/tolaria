// PROTOTYPE — throwaway (player-feedback 2026-11, `?pv-preview-tabs=A|B|C`).
import type { CardPreviewView } from "~/components/cards/card-preview-mode-toggle";

export type PrototypePreviewTab = { key: CardPreviewView; label: string };

export type PrototypePreviewTabsProps = {
    mode: CardPreviewView;
    onChange: (mode: CardPreviewView) => void;
    tabs: PrototypePreviewTab[];
    /** Print the Rulings tab would load — lets a variant badge the count. */
    rulingsPrintId?: string | null;
};
