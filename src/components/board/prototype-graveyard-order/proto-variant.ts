// PROTOTYPE — throwaway. Variant list + URL-backed `?variant=` state.
import { useState } from "react";

export const GRAVEYARD_PROTO_VARIANTS = [
    { key: "0", name: "Current grid" },
    { key: "A", name: "Rows · per-card placeholders" },
    { key: "B", name: "Fan · outline placeholders" },
    { key: "C", name: "Cascade · run strips" },
];

function readVariant(): string {
    const v = new URLSearchParams(window.location.search).get("variant");
    return GRAVEYARD_PROTO_VARIANTS.some((x) => x.key === v) ? v! : "A";
}

export function useGraveyardProtoVariant(): [string, (k: string) => void] {
    const [variant, setVariant] = useState(readVariant);
    const set = (k: string) => {
        const url = new URL(window.location.href);
        url.searchParams.set("variant", k);
        window.history.replaceState(window.history.state, "", url);
        setVariant(k);
    };
    return [variant, set];
}
