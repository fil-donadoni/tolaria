// PROTOTYPE — throwaway. Variant keys for the Sideboarding prototype.
export const PROTO_VARIANTS = [
    { key: "0", name: "Current dialog (baseline)" },
    { key: "A", name: "Spread — visual deck + inspector" },
    { key: "B", name: "Swap bench — select, then swap" },
    { key: "C", name: "Ledger — one row per card, copy dial" },
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
