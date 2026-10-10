// PROTOTYPE — throwaway (branch prototype/limited-flow, never merged).
// Limited flow UI prototype: four surfaces, each with structurally different
// variants. URL is the truth: /limited?proto=<surface>&variant=<key>
// (&phase=<waiting|drafting|building|playing|finished> on the event surface).
// Mock data only (proto-cards.ts) — no mutations, no Convex reads.
import { useState, type ComponentType } from "react";
import { cn } from "~/lib/utils";
import PrototypeSwitcher from "./prototype-switcher";
import { HUB_VARIANTS } from "./hub/hub-variants";
import { SETUP_VARIANTS } from "./setup/setup-variants";
import { EVENT_VARIANTS } from "./event/event-variants";
import { BUILDER_VARIANTS } from "./builder/builder-variants";

export interface ProtoVariant {
    key: string;
    name: string;
    Component: ComponentType;
}

const SURFACES: { key: string; label: string; variants: ProtoVariant[] }[] = [
    { key: "hub", label: "/limited", variants: HUB_VARIANTS },
    { key: "setup", label: "/limited/new", variants: SETUP_VARIANTS },
    { key: "event", label: "/limited/{id}", variants: EVENT_VARIANTS },
    { key: "builder", label: "Deck builder", variants: BUILDER_VARIANTS },
];

function readParam(name: string): string | null {
    return new URLSearchParams(window.location.search).get(name);
}

function writeParams(patch: Record<string, string | null>) {
    const params = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
        if (v === null) params.delete(k);
        else params.set(k, v);
    }
    window.history.replaceState(null, "", `?${params.toString()}`);
}

export default function LimitedFlowPrototype() {
    const [surfaceKey, setSurfaceKey] = useState(readParam("proto") ?? "hub");
    const surface = SURFACES.find((s) => s.key === surfaceKey) ?? SURFACES[0];
    const [variantKey, setVariantKey] = useState(
        readParam("variant") ?? surface.variants[0].key
    );
    const variant =
        surface.variants.find((v) => v.key === variantKey) ??
        surface.variants[0];

    const pickSurface = (key: string) => {
        const next = SURFACES.find((s) => s.key === key) ?? SURFACES[0];
        setSurfaceKey(next.key);
        setVariantKey(next.variants[0].key);
        writeParams({ proto: next.key, variant: next.variants[0].key });
    };
    const pickVariant = (key: string) => {
        setVariantKey(key);
        writeParams({ variant: key });
    };

    return (
        <div className="flex min-h-full flex-col gap-3 px-4 pb-28 pt-3">
            <nav className="flex flex-wrap gap-1 self-center rounded-full border border-fuchsia-600/60 bg-fuchsia-950/40 p-1 text-xs font-semibold">
                {SURFACES.map((s) => (
                    <button
                        key={s.key}
                        type="button"
                        onClick={() => pickSurface(s.key)}
                        className={cn(
                            "rounded-full px-3 py-1",
                            s.key === surface.key
                                ? "bg-fuchsia-600 text-white"
                                : "text-fuchsia-200"
                        )}
                    >
                        {s.label}
                    </button>
                ))}
            </nav>
            <variant.Component key={`${surface.key}-${variant.key}`} />
            <PrototypeSwitcher
                variants={surface.variants}
                current={variant.key}
                onChange={pickVariant}
            />
        </div>
    );
}
