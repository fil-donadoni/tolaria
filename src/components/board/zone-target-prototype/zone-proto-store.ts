// PROTOTYPE (zone-target highlight) — the active variant, readable from
// components the prototype root does not render (the real stack row, for B2).
import { useSyncExternalStore } from "react";

const EVENT = "zoneproto:change";

function read(): string | null {
    if (!import.meta.env.DEV) return null;
    const q = new URLSearchParams(window.location.search);
    return q.has("zoneProto") ? (q.get("variant") ?? null) : null;
}

export function notifyZoneProto() {
    window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
    window.addEventListener(EVENT, cb);
    return () => window.removeEventListener(EVENT, cb);
}

export function useZoneProtoVariant(): string | null {
    return useSyncExternalStore(subscribe, read, () => null);
}
