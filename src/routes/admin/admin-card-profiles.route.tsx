// `/admin/card-profiles` — extracted from the bottom of the Lobby.
import AdminPageFrame from "@/components/admin/admin-page-frame";
import CardProfilesAdminPanel from "@/components/admin/card-profiles/card-profiles-admin-panel";

export default function AdminCardProfilesRoute() {
    return (
        <AdminPageFrame
            wide
            title="Card Profiles"
            description="Archetypes, Capabilities and Combo Edges per card (ADR 0072), over the LLM-seeded census. Flipping a row to reviewed is the human review act — it is always a deliberate write."
        >
            <CardProfilesAdminPanel />
        </AdminPageFrame>
    );
}
