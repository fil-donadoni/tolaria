import { useCallback, useState } from "react";
import type { CardPreviewView } from "~/components/cards/card-preview-mode-toggle";
import {
    getSessionPreviewView,
    setSessionPreviewView,
} from "~/lib/preview-view-session-store";

/** A controlled card-preview mode that persists the viewer's choice for the
 *  session (issue #9820): seeded from the last mode chosen, written back on
 *  every change, so the next card and the next window open on it. */
export default function useSessionPreviewView(): [
    CardPreviewView,
    (view: CardPreviewView) => void,
] {
    const [view, setView] = useState<CardPreviewView>(getSessionPreviewView);
    const choose = useCallback((next: CardPreviewView) => {
        setSessionPreviewView(next);
        setView(next);
    }, []);
    return [view, choose];
}
