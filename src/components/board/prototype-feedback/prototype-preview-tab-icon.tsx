// PROTOTYPE — throwaway (player-feedback 2026-11, `?pv-preview-tabs=`).
import { Image, Scale, Sparkles } from "lucide-react";
import type { CardPreviewView } from "~/components/cards/card-preview-mode-toggle";

export default function PrototypePreviewTabIcon({
    view,
    size = 16,
}: {
    view: CardPreviewView;
    size?: number;
}) {
    if (view === "computed") return <Sparkles size={size} aria-hidden />;
    if (view === "printed") return <Image size={size} aria-hidden />;
    return <Scale size={size} aria-hidden />;
}
