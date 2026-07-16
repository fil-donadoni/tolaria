// PROTOTYPE — throwaway route (`/prototype/attachments`). Sub-shape B: the
// attachment-cluster visual has no existing populated page to embed in
// (reproducing Parallax Wave holding 3 creatures + a multi-aura creature in a
// live game is expensive), so it lives on its own throwaway route with mock
// data. Three structurally-different variants of "host + multiple satellites",
// switchable via `?variant=` and the floating bar. Delete the whole
// `src/components/prototype/` dir + this route once a variant wins.
import { getRouteApi } from "@tanstack/react-router";
import { MOCK_HOSTS } from "~/components/prototype/mock-attachment-data";
import PrototypeSwitcher, {
    type VariantEntry,
} from "~/components/prototype/prototype-switcher";
import AttachmentClusterVariantA from "~/components/prototype/attachment-cluster-variant-a";
import AttachmentClusterVariantB from "~/components/prototype/attachment-cluster-variant-b";
import AttachmentClusterVariantC from "~/components/prototype/attachment-cluster-variant-c";

const VARIANTS: VariantEntry[] = [
    { key: "A", name: "Corner fan" },
    { key: "B", name: "Bottom tray shelf" },
    { key: "C", name: "Collapsed proxy pile" },
];

const routeApi = getRouteApi("/prototype/attachments");

export default function PrototypeAttachmentsRoute() {
    const { variant } = routeApi.useSearch();
    const navigate = routeApi.useNavigate();
    const current = variant ?? "A";

    const Cluster =
        current === "B"
            ? AttachmentClusterVariantB
            : current === "C"
              ? AttachmentClusterVariantC
              : AttachmentClusterVariantA;

    return (
        <div className="min-h-screen w-full bg-[radial-gradient(ellipse_at_top,#1c2530,#0b0e12)] text-white">
            <div className="mx-auto max-w-6xl px-6 py-10">
                <h1 className="text-lg font-bold">
                    Attachment cluster — prototype
                </h1>
                <p className="mt-1 max-w-2xl text-sm text-white/60">
                    A permanent holding multiple satellites (auras stacked on a
                    creature, or creatures held in exile by Parallax Wave).
                    Today only the topmost is visible. Each variant
                    fans/collapses the cluster and opens a graveyard-style pile
                    on click. Flip variants with the bar below or ← / →.
                </p>

                <div className="mt-12 flex flex-wrap gap-x-16 gap-y-20 pt-6">
                    {MOCK_HOSTS.map((host) => (
                        <div
                            key={host.host.id}
                            className="flex flex-col items-center gap-3"
                        >
                            <Cluster host={host} />
                            <span className="text-xs text-white/50">
                                {host.label}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            <PrototypeSwitcher
                variants={VARIANTS}
                current={current}
                onChange={(key) =>
                    navigate({ search: { variant: key }, replace: true })
                }
            />
        </div>
    );
}
