// PROTOTYPE — throwaway. The variant keys both prototype hosts share.
export const PROTO_VARIANTS = [
    { key: "A", name: "Workbench — rail · table · inspector" },
    { key: "B", name: "Sweep board — one catalogue row at a time" },
    { key: "C", name: "Focus — one card, queue below" },
    { key: "D", name: "Workbench + focus dialog, collapsible rail" },
] as const;

export type ProtoVariantKey = (typeof PROTO_VARIANTS)[number]["key"];

export function readVariant(): ProtoVariantKey {
    const v = new URLSearchParams(window.location.search).get("variant");
    return (PROTO_VARIANTS.find((p) => p.key === v)?.key ??
        "A") as ProtoVariantKey;
}

export function writeVariant(key: string): void {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", key);
    window.history.replaceState(null, "", url.toString());
}
