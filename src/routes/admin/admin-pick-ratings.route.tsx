// `/admin/pick-ratings` — extracted from the bottom of the Lobby.
import AdminPageFrame from "@/components/admin/admin-page-frame";
import PickRatingsPrototype from "@/components/admin/prototype-profile-pages/pick-ratings-prototype";
import PickRatingAdminPanel from "@/components/lobby/pick-rating-admin-panel";

export default function AdminPickRatingsRoute() {
    // PROTOTYPE — throwaway: ?variant= mounts the page variants.
    const proto =
        import.meta.env.DEV &&
        new URLSearchParams(window.location.search).has("variant");
    return (
        <AdminPageFrame
            wide={proto}
            title="Pick Ratings"
            description="The Bot Drafter's per-scope card ratings (PRD #1296, ADR 0066): the database layer that overrides the checked-in seed file, per Draftable Set or cube."
        >
            {proto ? <PickRatingsPrototype /> : <PickRatingAdminPanel />}
        </AdminPageFrame>
    );
}
