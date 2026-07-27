// /draft-lab — Draft Lab synthetic mode (issue #1612, ADR 0074, PRD #1607
// slice 5). A client-only developer surface: runs a whole 8-seat bot draft in
// the browser off the SAME pure modules the server picks with
// (`convex/limited/draftEngine.ts`/`botDrafter.ts`), from an arbitrary seed,
// stepped or auto-played, with the full per-candidate score breakdown and its
// provenance for one focused seat. Writes nothing — no Convex mutation is
// imported anywhere on this page's dependency tree
// (`draft-lab-no-mutation.test.ts` enforces this statically).
import AmbientPageGround from "@/components/ui/ambient-page-ground";
import { useDraftLab } from "@/hooks/useDraftLab";
import DraftLabControls from "@/components/draft-lab/draft-lab-controls";
import DraftLabSeatTable from "@/components/draft-lab/draft-lab-seat-table";
import DraftLabFocusPanel from "@/components/draft-lab/draft-lab-focus-panel";

export default function DraftLabRoute() {
    const lab = useDraftLab();

    const lastPickForFocusedSeat = lab.state
        ? [...lab.state.pickLog]
              .reverse()
              .find((r) => r.seatIndex === lab.focusedSeat)
        : undefined;

    return (
        <div className="relative min-h-dvh bg-surface-base text-text">
            <AmbientPageGround />
            <div className="relative z-10 mx-auto max-w-6xl px-4 py-10 sm:px-8">
                <header>
                    <p className="text-label">
                        developer surface — synthetic mode
                    </p>
                    <h1 className="heading-panel mt-1 text-left text-3xl">
                        Draft Lab
                    </h1>
                    <span className="panel-rule mt-3 block h-px w-full" />
                    <p className="mt-3 max-w-3xl text-sm text-text-muted">
                        Runs a whole Bot Drafter draft in the browser from a
                        seed — the same picking code the server uses, with the
                        full score breakdown and provenance for every candidate.
                        Client-only: nothing here is saved (ADR 0074).
                    </p>
                </header>

                <div className="mt-8 flex flex-col gap-6">
                    <DraftLabControls
                        seedInput={lab.seedInput}
                        onSeedInputChange={lab.setSeedInput}
                        sourceKey={lab.sourceKey}
                        onSourceKeyChange={lab.setSourceKey}
                        state={lab.state}
                        isAutoPlaying={lab.isAutoPlaying}
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
                </div>
            </div>
        </div>
    );
}
