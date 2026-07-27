// `/admin/scenarios` — the scenario library as a page (was reachable only from
// the in-game Debug blade). Renamed from "debug scenarios": a saved board setup
// is a reusable starting position, and the same rows are the natural substrate
// for puzzles ("win this turn from here"), not merely a debugging aid.
import AdminPageFrame from "@/components/admin/admin-page-frame";
import ScenariosAdminPanel from "@/components/admin/scenarios-admin-panel";

export default function AdminScenariosRoute() {
    return (
        <AdminPageFrame
            title="Scenarios"
            description="Saved board setups (ADR 0044). Create or edit a spec, promote a row to golden so it survives cleanup, regenerate or vary one from its stored prompt, and prune the ephemeral rest. Loading a scenario into a board still happens in-game, from the Debug panel."
        >
            <ScenariosAdminPanel />
        </AdminPageFrame>
    );
}
