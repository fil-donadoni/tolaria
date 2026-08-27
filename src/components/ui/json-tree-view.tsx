import { JSONTree } from "react-json-tree";
import { PALETTE_TOKENS, SIGNAL_TOKENS } from "@/lib/design-tokens";

/** JSON tree palette, mapped onto the identity v4 semantic tokens (ADR 0103).
 *  `react-json-tree` needs literal colours, so the values are read from the
 *  typed mirror rather than re-inlined as hexes — a copy-pasted hex is what
 *  let this surface keep rendering the retired Antique Bronze palette (ADR
 *  0007) for two identity slices after #2722 moved every other token
 *  (docs/findings/2722-hardcoded-retired-palette-hexes.md, issue #2734).
 *  Shared by the Debug panel's live state dump (`DebugPanel`) and the
 *  `/admin/bug-reports` detail view's snapshot JSON (issue #2250) — one
 *  viewer, one theme, extracted here on its second use. */
const palette = Object.fromEntries(PALETTE_TOKENS.map((t) => [t.name, t.hex]));
const signal = Object.fromEntries(SIGNAL_TOKENS.map((t) => [t.name, t.hex]));
const theme = {
    scheme: "tolaria",
    base00: "transparent",
    base01: palette["surface-elevated"],
    base02: palette["border-subtle"],
    base03: palette["text-disabled"],
    base04: palette["text-muted"],
    base05: palette["text"],
    base06: palette["parchment"],
    base07: palette["parchment"],
    base08: palette["danger"],
    base09: palette["accent-strong"],
    base0A: palette["accent"],
    base0B: palette["success"],
    base0C: palette["secondary-accent-strong"],
    base0D: palette["secondary-accent"],
    base0E: signal["signal-target"],
    base0F: palette["accent"],
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
