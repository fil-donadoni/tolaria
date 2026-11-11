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
// Writes nothing but one Bot Finding report (ADR 0074, Amendment I, issue
// #8900) — `draft-lab-no-mutation.test.ts` allows exactly that one mutation,
// in exactly one file, and forbids every other write surface statically.
import { useState } from "react";
import { useDraftLab } from "@/hooks/useDraftLab";
import SurfaceReadyMarker from "@/components/ui/surface-ready-marker";
import DraftLabControls from "@/components/draft-lab/draft-lab-controls";
import DraftLabSeatTable from "@/components/draft-lab/draft-lab-seat-table";
import DraftLabFocusPanel from "@/components/draft-lab/draft-lab-focus-panel";
import DraftLabBuiltDeckPanel from "@/components/draft-lab/draft-lab-built-deck-panel";
import DraftLabReportFindingForm from "@/components/draft-lab/draft-lab-report-finding-form";
import { draftLabFindingContext } from "@/lib/limited/draftLabBuiltDeck";
import DraftLabModeTabs, {
    type DraftLabMode,
} from "@/components/draft-lab/draft-lab-mode-tabs";
import DraftLabReplayPanel from "@/components/draft-lab/draft-lab-replay-panel";

export default function DraftLabWorkbench() {
    const [mode, setMode] = useState<DraftLabMode>("synthetic");
    const lab = useDraftLab();

    const focusedSeatLabel =
        lab.state?.seats[lab.focusedSeat]?.nickname ??
        `Seat ${lab.focusedSeat + 1}`;
    const focusedBuiltSeat = lab.builtSeats?.find(
        (s) => s.seatIndex === lab.focusedSeat
    );

    const lastPickForFocusedSeat = lab.state
        ? [...lab.state.pickLog]
              .reverse()
              .find((r) => r.seatIndex === lab.focusedSeat)
        : undefined;

    return (
        <>
            {/* `canStart` is exactly `scopeCardProfiles !== undefined`
                (`useDraftLab`): the Card Profile query has answered. */}
            {lab.canStart && <SurfaceReadyMarker />}
            <p className="mt-3 max-w-3xl text-sm text-text-muted">
                {mode === "synthetic"
                    ? "Runs a whole Bot Drafter draft in the browser from a seed — the same picking code the server uses, with the full score breakdown and provenance for every candidate."
                    : "Reconstructs a real completed Draft event from its seed and every seat's stored Pool, and shows what the CURRENT scorer would pick beside what actually happened."}{" "}
                Client-only: nothing here is saved but a Bot Finding report you
                file (ADR 0074).
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
                                {focusedBuiltSeat && (
                                    <DraftLabBuiltDeckPanel
                                        seatLabel={focusedSeatLabel}
                                        built={focusedBuiltSeat}
                                    >
                                        <DraftLabReportFindingForm
                                            // A fresh form per seat and per
                                            // draft: "Reported" belongs to
                                            // one context only.
                                            key={`${lab.state.seed}:${lab.state.packSlots[0]}:${lab.focusedSeat}`}
                                            draftContext={draftLabFindingContext(
                                                lab.state,
                                                lab.focusedSeat
                                            )}
                                        />
                                    </DraftLabBuiltDeckPanel>
                                )}
                                <DraftLabFocusPanel
                                    seatLabel={focusedSeatLabel}
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
