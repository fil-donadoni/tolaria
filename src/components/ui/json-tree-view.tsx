import { JSONTree } from "react-json-tree";

/** JSON tree palette, mapped onto the Antique Bronze semantic tokens (ADR 0007)
 *  so a state dump reads as part of the design system instead of the stock
 *  Monokai scheme. `react-json-tree` needs literal colours, so the token
 *  values are inlined here — keep in sync with `@theme` in `src/index.css`.
 *  Shared by the Debug panel's live state dump (`DebugPanel`) and the
 *  `/admin/bug-reports` detail view's snapshot JSON (issue #2250) — one
 *  viewer, one theme, extracted here on its second use. */
const theme = {
    scheme: "tolaria",
    base00: "transparent",
    base01: "#241d12" /* surface-elevated */,
    base02: "#2e2516" /* border-subtle */,
    base03: "#968a68" /* text-disabled */,
    base04: "#b7a984" /* text-muted */,
    base05: "#e9e0cb" /* text */,
    base06: "#f3ead2" /* parchment */,
    base07: "#f3ead2" /* parchment */,
    base08: "#b1473a" /* danger */,
    base09: "#ecc878" /* accent-strong */,
    base0A: "#c9a24b" /* accent */,
    base0B: "#6fa05a" /* success */,
    base0C: "#9cc6d4" /* secondary-accent-strong */,
    base0D: "#5f97a8" /* secondary-accent */,
    base0E: "#a78bfa" /* signal-target */,
    base0F: "#c9a24b" /* accent */,
};

/** Pretty-printed, collapsible JSON. `react-json-tree` is already a project
 *  dependency (the Debug panel's state dump) — reusing it here shares one
 *  theme instead of growing a second implementation. */
export default function JsonTreeView({ data }: { data: unknown }) {
    return (
        <JSONTree
            data={data}
            theme={theme}
            invertTheme={false}
            // Collapsed by default — expand on demand.
            shouldExpandNodeInitially={() => false}
        />
    );
}
