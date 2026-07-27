// `/admin/card-profiles` — extracted from the bottom of the Lobby.
import AdminPageFrame from "@/components/admin/admin-page-frame";
import CardProfileAdminPanel from "@/components/lobby/card-profile-admin-panel";

export default function AdminCardProfilesRoute() {
    return (
        <AdminPageFrame
            title="Card Profiles"
            description="Archetypes, Capabilities and Combo Edges per card (ADR 0072), over the LLM-seeded census. Flipping a row to reviewed is the human review act — it is always a deliberate write."
        >
            <CardProfileAdminPanel />
        </AdminPageFrame>
    );
}
