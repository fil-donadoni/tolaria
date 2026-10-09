// PROTOTYPE — throwaway. What every home variant renders, precomputed once.
import type { LobbyDeck } from "~/lib/deckTypes";
import { limitedEventStatusChip } from "~/lib/limitedEventStatus";
import { limitedEventName } from "~/lib/limitedEventName";
import type { LimitedEventSummaryView } from "~/hooks/useLimitedEvent";
import { firstOpenStep, stepsFor, type MatchSetup } from "./match-setup-logic";

const CHIP_LABEL = {
    open: "Waiting for players",
    drafting: "Draft",
    building: "Deckbuilding",
    playing: "Games",
    done: "Done",
} as const;

export interface ProtoTableRow {
    id: string;
    kind: "Constructed" | "Limited";
    /** Second line: "Constructed · vs Bot" / "Limited". */
    detail: string;
    name: string;
    phase: string;
    art: string | null;
}

export interface ProtoHomeData {
    lastMatch: {
        summary: string;
        myArt: string | null;
        oppArt: string | null;
        myName: string;
        oppName: string;
    } | null;
    tables: ProtoTableRow[];
    userDecks: LobbyDeck[];
    presetDecks: LobbyDeck[];
}

export interface ProtoHomeActions {
    onConstructed: () => void;
    onLimited: () => void;
    onReplay: () => void;
    onEditLast: () => void;
    onOpenDeck: (presetId: string) => void;
    onNewDeck: () => void;
}

export type ProtoHomeProps = { data: ProtoHomeData } & ProtoHomeActions;

export const PLAY_ART = {
    constructed: "/img/lobby-bg/05.webp",
    limited: "/img/lobby-bg/06.webp",
} as const;

export function buildHomeData(
    last: MatchSetup,
    decks: LobbyDeck[],
    activeMatch: {
        name: string;
        phase: string;
        art: string | null;
        detail: string;
    } | null,
    events: LimitedEventSummaryView[]
): ProtoHomeData {
    const steps = stepsFor(last, decks);
    const complete = firstOpenStep(steps) === steps.length;
    const my = decks.find((d) => d.presetId === last.myDeckId);
    const opp = last.opponentDeckId
        ? decks.find((d) => d.presetId === last.opponentDeckId)
        : my;
    return {
        lastMatch:
            complete && my
                ? {
                      summary: steps
                          .filter((s) => s.key !== "myDeck" && s.key !== "opponentDeck")
                          .map((s) => s.summary)
                          .join(" · "),
                      myArt: my.featuredCardId,
                      oppArt: opp?.featuredCardId ?? null,
                      myName: my.name,
                      oppName: last.opponentDeckId ? (opp?.name ?? "?") : "Mirror",
                  }
                : null,
        tables: [
            ...(activeMatch
                ? [{ id: "match", kind: "Constructed" as const, ...activeMatch }]
                : []),
            ...events.map((e) => ({
                id: e._id,
                kind: "Limited" as const,
                name: limitedEventName(e),
                detail: "Limited",
                phase: CHIP_LABEL[limitedEventStatusChip(e)],
                art: null,
            })),
        ],
        userDecks: decks.filter((d) => d.kind === "user"),
        presetDecks: decks.filter((d) => d.kind === "preset"),
    };
}

/** Art for a Your Tables row: the deck's art for a match, a lobby image for
 *  an event (events carry no deck art yet). */
export const tableArt = (t: ProtoTableRow, i: number) =>
    t.art
        ? { cards: [t.art] }
        : { image: `/img/lobby-bg/0${((i + 2) % 8) + 1}.webp` };
