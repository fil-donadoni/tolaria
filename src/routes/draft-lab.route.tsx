// `/admin/draft-lab` — Draft Lab (issue #1612/#1613, ADR 0074, PRD #1607
// slices 5-6). A client-only developer surface that runs a whole Bot Drafter
// draft in the browser and shows the scorer's per-candidate breakdown. Writes
// nothing.
//
// Admin-only, and the gate is NOT here: the page lives under `/admin`, whose
// layout route wraps every child in `AdminRouteGate` (404 for a non-admin, no
// explanation — an admin surface shouldn't confirm its own existence). Two
// consequences worth stating, because they are load-bearing:
//
//  - The workbench is a separate component (`DraftLabWorkbench`) rather than
//    this file's body. React forbids conditional hooks, so the only way its
//    hooks never mount for a non-admin is for the gate to sit in a PARENT — and
//    those hooks call `assertIsAdmin`-gated queries
//    (`listScopeCardProfiles`, `listScopeCardRatingsForReplay`).
//  - The UI gate is cosmetic on its own; those two queries are the real
//    boundary, guarded by `scripts/__tests__/draft-lab-admin-gating.test.ts`.
import AmbientPageGround from "@/components/ui/ambient-page-ground";
import DraftLabWorkbench from "@/components/draft-lab/draft-lab-workbench";

export default function DraftLabRoute() {
    return (
        <div className="relative">
            <AmbientPageGround />
            <div className="relative z-10 mx-auto max-w-6xl px-6 py-8">
                <header>
                    <p className="text-label">developer surface</p>
                    <h1 className="heading-panel mt-1 text-left text-3xl">
                        Draft Lab
                    </h1>
                    <span className="panel-rule mt-3 block h-px w-full" />
                </header>
                <DraftLabWorkbench />
            </div>
        </div>
    );
}
