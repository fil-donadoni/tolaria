// `/admin/pick-ratings` — extracted from the bottom of the Lobby.
import AdminPageFrame from "@/components/admin/admin-page-frame";
import PickRatingsAdminPanel from "@/components/admin/pick-ratings/pick-ratings-admin-panel";

export default function AdminPickRatingsRoute() {
    return (
        <AdminPageFrame
            title="Pick Ratings"
            description="The Bot Drafter's per-scope card ratings (PRD #1296, ADR 0066): the database layer that overrides the checked-in seed file, per Draftable Set or cube."
        >
            <PickRatingsAdminPanel />
        </AdminPageFrame>
    );
}
