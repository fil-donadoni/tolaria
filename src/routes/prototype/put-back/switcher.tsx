// PROTOTYPE switcher — floating bottom bar to flip between variants via ?variant=.
// Hidden in production builds. Throwaway.
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

export const VARIANTS = ["A", "B", "C"] as const;
export type Variant = (typeof VARIANTS)[number];
const NAMES: Record<Variant, string> = {
    A: "Extended Portent strip",
    B: "Two-panel vertical",
    C: "Click-select + order tray",
};

export default function PrototypeSwitcher({ current }: { current: Variant }) {
    const navigate = useNavigate();
    const go = (dir: number) => {
        const i = VARIANTS.indexOf(current);
        const next = VARIANTS[(i + dir + VARIANTS.length) % VARIANTS.length];
        navigate({ to: "/prototype/put-back", search: { variant: next } });
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA") return;
            if (e.key === "ArrowLeft") go(-1);
            if (e.key === "ArrowRight") go(1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    if (import.meta.env.PROD) return null;

    return (
        <div className="fixed bottom-4 left-1/2 z-[200] flex -translate-x-1/2 items-center gap-3 rounded-full border border-accent bg-black/90 px-4 py-2 shadow-xl">
            <button
                type="button"
                onClick={() => go(-1)}
                className="text-accent hover:text-white"
            >
                ←
            </button>
            <span className="font-beleren text-sm tracking-wide text-white">
                {current} — {NAMES[current]}
            </span>
            <button
                type="button"
                onClick={() => go(1)}
                className="text-accent hover:text-white"
            >
                →
            </button>
        </div>
    );
}
