import { use, type ReactNode } from "react";
import type { CatalogueGateMode } from "~/lib/catalogueGateMode";
import { loadCatalogueGate } from "~/lib/catalogueGateLoader";

/** The catalogue gate around `children`, read through `use()`: synchronous
 *  once its chunk has loaded (the Setup flow prefetches it), suspending to
 *  the caller's boundary until then (issue #5584). `mode` is the route's
 *  (issue #5615): `game` awaits the packed corpus only. */
export default function CatalogueGateFrame({
    mode,
    children,
}: {
    mode: CatalogueGateMode;
    children: ReactNode;
}) {
    const CatalogueGate = use(loadCatalogueGate());
    // One module-level component for the whole document (the memoised chunk's
    // default export), never one made per render — what the rule guards.
    // eslint-disable-next-line react-hooks/static-components
    return <CatalogueGate mode={mode}>{children}</CatalogueGate>;
}
