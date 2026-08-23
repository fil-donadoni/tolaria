// PROTOTYPE — throwaway (branch prototype/identity-v4). The "engine view"
// skin for #2704: how the engine read a card, rendered from the REAL
// CardDefinition (tryGetDefinition) as a tree of nodes + chips. Purely
// presentational; the real implementation lives in #2704.
import { tryGetDefinition } from "@convex/cards";

type Node = {
    label: string;
    kind: string;
    chips: [string, string][];
    children?: Node[];
};

function chipify(v: unknown): string {
    if (v == null) return "—";
    if (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean"
    )
        return String(v);
    if (Array.isArray(v)) return v.map(chipify).join(", ");
    if (typeof v === "object") {
        const o = v as Record<string, unknown>;
        if ("target" in o) return `target #${String(o.target)}`;
        if ("type" in o)
            return `${String(o.type)}${o.count ? ` ×${String(o.count)}` : ""}`;
        return Object.entries(o)
            .map(([k, x]) => `${k}: ${chipify(x)}`)
            .join(" · ");
    }
    return String(v);
}

function opsToNodes(effects: unknown): Node[] {
    if (!Array.isArray(effects)) return [];
    return effects.map((e) => {
        const o = (e ?? {}) as Record<string, unknown>;
        const op = String(o.op ?? "?");
        const chips: [string, string][] = Object.entries(o)
            .filter(
                ([k]) =>
                    k !== "op" &&
                    k !== "effects" &&
                    k !== "then" &&
                    k !== "else"
            )
            .map(([k, v]) => [k, chipify(v)]);
        const children = [
            ...opsToNodes(o.effects),
            ...opsToNodes(o.then),
            ...opsToNodes(o.else),
        ];
        return {
            label: op,
            kind: "EFF",
            chips,
            children: children.length ? children : undefined,
        };
    });
}

export function engineTree(cardId: string): {
    name: string;
    oracle: string;
    type: string;
    mana: string[];
    nodes: Node[];
    protocol: boolean;
    coverage: string;
} | null {
    const d = tryGetDefinition(cardId) as unknown as
        | Record<string, unknown>
        | undefined;
    if (!d) return null;
    const nodes: Node[] = [];
    const mana = Object.entries(
        (d.manaCost as Record<string, number>) ?? {}
    ).flatMap(([k, n]) =>
        k === "generic" ? [String(n)] : Array.from({ length: n }, () => k)
    );
    const statics = (d.staticAbilities as string[] | undefined) ?? [];
    for (const k of statics) nodes.push({ label: k, kind: "KW", chips: [] });
    if (d.targetRequirement)
        nodes.push({
            label: "target",
            kind: "TGT",
            chips: [["filter", chipify(d.targetRequirement)]],
        });
    if (Array.isArray(d.effects)) nodes.push(...opsToNodes(d.effects));
    const trig =
        (d.triggeredAbilities as Record<string, unknown>[] | undefined) ?? [];
    for (const t of trig)
        nodes.push({
            label: "triggered",
            kind: "TRG",
            chips: [
                ["event", chipify(t.event)],
                ...(t.targetRequirement
                    ? [
                          ["target", chipify(t.targetRequirement)] as [
                              string,
                              string,
                          ],
                      ]
                    : []),
            ],
            children: t.resolve
                ? [{ label: "hand-written resolve()", kind: "RES", chips: [] }]
                : opsToNodes(t.effects),
        });
    const act =
        (d.activatedAbilities as Record<string, unknown>[] | undefined) ?? [];
    for (const a of act)
        nodes.push({
            label: "activated",
            kind: "ACT",
            chips: [
                ["cost", chipify(a.cost)],
                ...(a.targetRequirement
                    ? [
                          ["target", chipify(a.targetRequirement)] as [
                              string,
                              string,
                          ],
                      ]
                    : []),
            ],
            children: a.resolve
                ? [{ label: "hand-written resolve()", kind: "RES", chips: [] }]
                : opsToNodes(a.effects),
        });
    const protocol =
        typeof d.resolve === "function" ||
        trig.some((t) => typeof t.resolve === "function") ||
        act.some((a) => typeof a.resolve === "function");
    if (protocol)
        nodes.push({
            label: "protocol card — hand-written resolve()",
            kind: "RES",
            chips: [],
        });
    const total = nodes.length;
    return {
        name: String(d.name),
        oracle: String(d.oracleText ?? ""),
        type: Array.isArray(d.types)
            ? (d.types as string[]).join(" ") +
              (Array.isArray(d.subtypes) && (d.subtypes as string[]).length
                  ? " — " + (d.subtypes as string[]).join(" ")
                  : "")
            : "",
        mana,
        nodes,
        protocol,
        coverage: protocol ? "hand-written" : `${total}/${total}`,
    };
}

function NodeRow({ n, depth }: { n: Node; depth: number }) {
    return (
        <div className="px-node" style={{ ["--d" as string]: depth }}>
            <div className="px-node-head">
                <span className={`px-kind k-${n.kind.toLowerCase()}`}>
                    {n.kind}
                </span>
                <span className="px-op">{n.label}</span>
            </div>
            {n.chips.length ? (
                <div className="px-chips">
                    {n.chips.map(([k, v]) => (
                        <span key={k} className="px-chip">
                            <i>{k}</i> {v}
                        </span>
                    ))}
                </div>
            ) : null}
            {n.children?.map((c, i) => (
                <NodeRow key={i} n={c} depth={depth + 1} />
            ))}
        </div>
    );
}

export default function IdentityEnginePanel({ cardId }: { cardId: string }) {
    const t = engineTree(cardId);
    if (!t)
        return (
            <div className="px-engine">
                <div className="p-eyebrow">Engine</div>
                <div className="p-muted">
                    No definition for this print in the engine.
                </div>
            </div>
        );
    return (
        <div className="px-engine">
            <div className="px-engine-head">
                <span className="p-eyebrow strong">Engine view</span>
                <span className={`pchip ${t.protocol ? "pending" : "self"}`}>
                    {t.protocol ? "protocol" : `DSL · ${t.coverage}`}
                </span>
            </div>
            <div className="px-bar">
                <i style={{ width: t.protocol ? "100%" : "100%" }} />
            </div>
            <div className="px-tree">
                {t.nodes.map((n, i) => (
                    <NodeRow key={i} n={n} depth={0} />
                ))}
            </div>
            <div className="px-engine-foot">
                <button
                    type="button"
                    className="pb ghost"
                    style={{ height: 30, padding: "0 10px" }}
                >
                    Report a problem ↗
                </button>
                <button
                    type="button"
                    className="pb ghost"
                    style={{ height: 30, padding: "0 10px" }}
                >
                    Scryfall rulings ↗
                </button>
            </div>
        </div>
    );
}
