// PROTOTYPE — throwaway. Local state every event variant shares: the phase
// (seeded from ?phase=), the waiting-phase viewpoint, the Games tab and the
// simulated Open Decklists event setting.
import { useMemo, useState } from "react";
import {
    PHASES,
    phaseIndex,
    seatsFor,
    type EventPhase,
    type MockSeat,
} from "./event-mock";

export type EventTab = "event" | "review";
export type Viewpoint = "creator" | "visitor";

function readPhase(): EventPhase {
    const p = new URLSearchParams(window.location.search).get("phase");
    return PHASES.find((x) => x.key === p)?.key ?? "waiting";
}

function writePhase(p: EventPhase) {
    const params = new URLSearchParams(window.location.search);
    params.set("phase", p);
    window.history.replaceState(null, "", `?${params.toString()}`);
}

export interface EventProto {
    phase: EventPhase;
    setPhase: (p: EventPhase) => void;
    viewpoint: Viewpoint;
    setViewpoint: (v: Viewpoint) => void;
    tab: EventTab;
    setTab: (t: EventTab) => void;
    openDecklists: boolean;
    setOpenDecklists: (v: boolean) => void;
    seats: MockSeat[];
    /** Tabs [Event] [Review the table] exist from Games on. */
    hasTabs: boolean;
    /** Started: the creator's close action becomes "Close event". */
    started: boolean;
    log: (what: string) => void;
}

export function useEventProto(): EventProto {
    const [phase, setPhaseState] = useState<EventPhase>(readPhase);
    const [viewpoint, setViewpoint] = useState<Viewpoint>("creator");
    const [tab, setTab] = useState<EventTab>("event");
    const [openDecklists, setOpenDecklists] = useState(false);
    const seats = useMemo(
        () => seatsFor(phase, viewpoint === "creator"),
        [phase, viewpoint]
    );
    const hasTabs = phaseIndex(phase) >= 3;
    return {
        phase,
        setPhase: (p) => {
            setPhaseState(p);
            writePhase(p);
            if (phaseIndex(p) < 3) setTab("event");
        },
        viewpoint,
        setViewpoint,
        tab: hasTabs ? tab : "event",
        setTab,
        openDecklists,
        setOpenDecklists,
        seats,
        hasTabs,
        started: phase !== "waiting",
        log: (what) => console.info("[proto event]", what),
    };
}
