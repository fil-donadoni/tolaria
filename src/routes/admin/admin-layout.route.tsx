// `/admin` layout route: the one gate for the whole admin section. Every page
// under it renders inside this `Outlet`, so a new admin route is gated by
// existing — there is no per-page check to forget.
import { Outlet } from "@tanstack/react-router";
import AdminRouteGate from "@/components/chrome/admin-route-gate";

export default function AdminLayoutRoute() {
    return (
        <AdminRouteGate>
            <Outlet />
        </AdminRouteGate>
    );
}
