// The Draft Lab workbench: everything the route used to render inline, moved
// behind the admin section gate (`AdminRouteGate`). The split is load-bearing,
// not cosmetic — `useDraftLab` (and, in replay mode, `useDraftLabReplay`) call
// `useQuery` against `assertIsAdmin`-gated queries, so those hooks must never
// mount for a non-admin. React forbids calling a hook conditionally, so the
// gate has to live in a PARENT component: `draft-lab.route.tsx` decides, this
// component runs the hooks only once that decision is "admin".
//
// Synthetic mode runs a whole 8-seat bot draft in the browser off the SAME
// pure modules the server picks with (`convex/limited/draftEngine.ts`,
// `botDrafter.ts`), from an arbitrary seed, stepped or auto-played, with the
// full per-candidate score breakdown and its provenance for one focused seat.
// Writes nothing — no Convex mutation is imported anywhere on this page's
// dependency tree (`draft-lab-no-mutation.test.ts` enforces this statically).
import { useState } from "react";
import { useDraftLab } from "@/hooks/useDraftLab";
import DraftLabControls from "@/components/draft-lab/draft-lab-controls";
import DraftLabSeatTable from "@/components/draft-lab/draft-lab-seat-table";
import DraftLabFocusPanel from "@/components/draft-lab/draft-lab-focus-panel";
import DraftLabModeTabs, {
    type DraftLabMode,
} from "@/components/draft-lab/draft-lab-mode-tabs";
import DraftLabReplayPanel from "@/components/draft-lab/draft-lab-replay-panel";

export default function DraftLabWorkbench() {
    const [mode, setMode] = useState<DraftLabMode>("synthetic");
    const lab = useDraftLab();

    const lastPickForFocusedSeat = lab.state
        ? [...lab.state.pickLog]
              .reverse()
              .find((r) => r.seatIndex === lab.focusedSeat)
        : undefined;

    return (
        <>
            <p className="mt-3 max-w-3xl text-sm text-text-muted">
                {mode === "synthetic"
                    ? "Runs a whole Bot Drafter draft in the browser from a seed — the same picking code the server uses, with the full score breakdown and provenance for every candidate."
                    : "Reconstructs a real completed Draft event from its seed and every seat's stored Pool, and shows what the CURRENT scorer would pick beside what actually happened."}{" "}
                Client-only: nothing here is saved (ADR 0074).
            </p>
            <div className="mt-4">
                <DraftLabModeTabs mode={mode} onChange={setMode} />
            </div>

            <div className="mt-8 flex flex-col gap-6">
                {mode === "synthetic" ? (
                    <>
                        <DraftLabControls
                            seedInput={lab.seedInput}
                            onSeedInputChange={lab.setSeedInput}
                            sourceKey={lab.sourceKey}
                            onSourceKeyChange={lab.setSourceKey}
                            state={lab.state}
                            isAutoPlaying={lab.isAutoPlaying}
                            canStart={lab.canStart}
                            onStart={lab.start}
                            onStep={lab.step}
                            onToggleAutoPlay={lab.toggleAutoPlay}
                        />

                        {lab.state && (
                            <>
                                <DraftLabSeatTable
                                    state={lab.state}
                                    focusedSeat={lab.focusedSeat}
                                    onFocusSeat={lab.setFocusedSeat}
                                    getCardProfile={lab.getCardProfile}
                                />
                                <DraftLabFocusPanel
                                    seatLabel={
                                        lab.state.seats[lab.focusedSeat]
                                            ?.nickname ??
                                        `Seat ${lab.focusedSeat + 1}`
                                    }
                                    record={lastPickForFocusedSeat}
                                    getCardProfile={lab.getCardProfile}
                                />
                            </>
                        )}
                    </>
                ) : (
                    <DraftLabReplayPanel />
                )}
            </div>
        </>
    );
}
