import { Outlet } from "@tanstack/react-router";
import CatalogueGate from "~/components/ui/catalogue-gate";

// Layout of every route that can read the card registry (issue #4854): the
// gate holds its children back until the catalogue is hydrated. Lives in its
// own lazy chunk so the entry never imports the catalogue.
export default function CatalogueGatedRoute() {
    return (
        <CatalogueGate>
            <Outlet />
        </CatalogueGate>
    );
}
