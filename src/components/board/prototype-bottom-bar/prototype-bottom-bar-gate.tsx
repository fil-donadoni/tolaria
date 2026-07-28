import { useState } from "react";
import type { Player } from "~/types/game";
import { useIsPortrait } from "~/hooks/useIsPortrait";
import Controller from "../controller";
import PrototypeSwitcher from "./prototype-switcher";
import PrototypeBarVariantA from "./prototype-bar-variant-a";
import PrototypeBarVariantB from "./prototype-bar-variant-b";
import PrototypeBarVariantC from "./prototype-bar-variant-c";
import PrototypeBarVariantD from "./prototype-bar-variant-d";

/** PROTOTYPE — throwaway (bottom-bar redesign audit 2026-07-28).
 *
 *  Plan: three variants of the portrait bottom action bar, switchable via
 *  `?variant=a|b|c` ON the real `/game` route (sub-shape A) — real board, real
 *  `useControllerActions` descriptors, real phase sheet. Dev-only; with no
 *  param (or in production, or landscape) this renders the real
 *  {@link Controller} untouched. Exactly one branch mounts, preserving the
 *  single-`useControllerActions`-instance seam (#335). */
export default function PrototypeBottomBarGate({
    me,
    opponent,
    onOpenMenu,
}: {
    me: Player | undefined;
    opponent: Player | undefined;
    onOpenMenu: () => void;
}) {
    const isPortrait = useIsPortrait();
    const [variant, setVariant] = useState<string | null>(() =>
        import.meta.env.DEV
            ? new URLSearchParams(window.location.search).get("variant")
            : null
    );

    const setParam = (v: string | null) => {
        const url = new URL(window.location.href);
        if (v) url.searchParams.set("variant", v);
        else url.searchParams.delete("variant");
        window.history.replaceState(null, "", url);
        setVariant(v);
    };

    if (!import.meta.env.DEV || !isPortrait || !variant || !me) {
        return <Controller onOpenMenu={onOpenMenu} />;
    }

    const key = variant.toLowerCase();
    return (
        <>
            {key === "b" ? (
                <PrototypeBarVariantB
                    me={me}
                    opponent={opponent}
                    onOpenMenu={onOpenMenu}
                />
            ) : key === "c" ? (
                <PrototypeBarVariantC me={me} onOpenMenu={onOpenMenu} />
            ) : key === "d" ? (
                <PrototypeBarVariantD
                    me={me}
                    opponent={opponent}
                    onOpenMenu={onOpenMenu}
                />
            ) : (
                <PrototypeBarVariantA me={me} onOpenMenu={onOpenMenu} />
            )}
            <PrototypeSwitcher
                current={["b", "c", "d"].includes(key) ? key : "a"}
                onChange={setParam}
                onExit={() => setParam(null)}
            />
        </>
    );
}
