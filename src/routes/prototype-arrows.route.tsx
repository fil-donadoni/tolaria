/**
 * PROTOTYPE — target/combat arrow aesthetics for the spatial board (PRD #249).
 * Throwaway — delete after the arrow-look decision is captured in NOTES / ADR.
 *
 * Route: /prototype/arrows
 * Switch the arrow VARIANT (look) and the SCENARIO (what is connected) from the
 * floating bottom bar. Hover any card / stack pill / arrow to highlight its
 * connected elements: stack scenarios = direct 1-hop, combat scenarios = the
 * whole transitive cluster. Non-highlighted arrows dim.
 *
 * Unified single arrow colour for every kind (gold accent tokens):
 *   --color-accent #c8a060   --color-accent-strong #e0c08a
 */

import { useMemo, useState } from "react";

const ACCENT = "#c8a060";
const ACCENT_STRONG = "#e0c08a";
const ACCENT_SOFT = "#7a5a2e";

// ---------------------------------------------------------------------------
// Scenario model
// ---------------------------------------------------------------------------

type NodeKind = "stack" | "permanent" | "player";
type Node = {
    id: string;
    kind: NodeKind;
    label: string;
    sub?: string;
    x: number; // top-left, board px
    y: number;
    w: number;
    h: number;
};
type Edge = { from: string; to: string };
type Scenario = {
    key: string;
    label: string;
    /** "stack" → direct 1-hop highlight; "combat" → transitive cluster. */
    mode: "stack" | "combat";
    nodes: Node[];
    edges: Edge[];
};

const CARD_W = 104;
const CARD_H = 146;
const PILL_W = 150;
const PILL_H = 52;
const NAME_W = 120;
const NAME_H = 56;

function card(id: string, label: string, x: number, y: number): Node {
    return { id, kind: "permanent", label, x, y, w: CARD_W, h: CARD_H };
}
function pill(id: string, label: string, sub: string, x: number, y: number): Node {
    return { id, kind: "stack", label, sub, x, y, w: PILL_W, h: PILL_H };
}
function nameplate(id: string, label: string, life: string, x: number, y: number): Node {
    return { id, kind: "player", label, sub: life, x, y, w: NAME_W, h: NAME_H };
}

const SCENARIOS: Scenario[] = [
    {
        key: "stack-board",
        label: "Stack → board",
        mode: "stack",
        nodes: [
            nameplate("opp", "Opponent", "17", 440, 24),
            pill("bolt", "Lightning Bolt", "instant · 3 dmg", 425, 250),
            card("bears", "Grizzly Bears", 250, 470),
        ],
        // Bolt split between a permanent and the opposing player (demo: 2 arrows).
        edges: [
            { from: "bolt", to: "bears" },
            { from: "bolt", to: "opp" },
        ],
    },
    {
        key: "stack-stack",
        label: "Stack → stack (counter)",
        mode: "stack",
        nodes: [
            pill("counter", "Counterspell", "instant", 560, 230),
            pill("bolt", "Lightning Bolt", "instant", 300, 360),
        ],
        edges: [{ from: "counter", to: "bolt" }],
    },
    {
        key: "combat-simple",
        label: "Combat · 1 vs 2",
        mode: "combat",
        nodes: [
            card("att", "Serra Angel", 450, 90),
            card("blkA", "Grizzly Bears", 300, 460),
            card("blkB", "Wall of Stone", 600, 460),
        ],
        // blocker → attacker.
        edges: [
            { from: "blkA", to: "att" },
            { from: "blkB", to: "att" },
        ],
    },
    {
        key: "combat-band",
        label: "Combat · banding",
        mode: "combat",
        nodes: [
            card("att1", "Benalish Hero", 360, 90),
            card("att2", "Master of the Hunt", 560, 90),
            card("blk1", "Sengir Vampire", 300, 470),
            card("blk2", "Craw Wurm", 540, 470),
        ],
        // Band shares blockers → one transitive cluster of all four.
        edges: [
            { from: "blk1", to: "att1" },
            { from: "blk1", to: "att2" },
            { from: "blk2", to: "att2" },
        ],
    },
];

// ---------------------------------------------------------------------------
// Highlight resolution
// ---------------------------------------------------------------------------

/** Returns the set of node ids + edge indices highlighted when `hoverId` is
 *  hovered. `null` hover → everything active (no dimming). */
function resolveHighlight(
    scn: Scenario,
    hoverId: string | null,
    hoverEdge: number | null
): { nodes: Set<string>; edges: Set<number> } | null {
    if (hoverId == null && hoverEdge == null) return null;

    // Seed from the hovered element.
    const seedNodes = new Set<string>();
    const seedEdges = new Set<number>();
    if (hoverEdge != null) {
        seedEdges.add(hoverEdge);
        seedNodes.add(scn.edges[hoverEdge].from);
        seedNodes.add(scn.edges[hoverEdge].to);
    }
    if (hoverId != null) seedNodes.add(hoverId);

    if (scn.mode === "stack") {
        // Direct 1-hop: the hovered node + every edge touching it + far ends.
        const nodes = new Set(seedNodes);
        const edges = new Set(seedEdges);
        scn.edges.forEach((e, i) => {
            if (seedNodes.has(e.from) || seedNodes.has(e.to)) {
                edges.add(i);
                nodes.add(e.from);
                nodes.add(e.to);
            }
        });
        return { nodes, edges };
    }

    // Combat: transitive connected component (union-find over all edges).
    const parent = new Map<string, string>();
    const find = (a: string): string => {
        parent.set(a, parent.get(a) ?? a);
        let r = a;
        while (parent.get(r) !== r) r = parent.get(r)!;
        return r;
    };
    const union = (a: string, b: string) => parent.set(find(a), find(b));
    scn.nodes.forEach((n) => parent.set(n.id, n.id));
    scn.edges.forEach((e) => union(e.from, e.to));

    const roots = new Set<string>();
    seedNodes.forEach((id) => roots.add(find(id)));
    const nodes = new Set<string>();
    scn.nodes.forEach((n) => {
        if (roots.has(find(n.id))) nodes.add(n.id);
    });
    const edges = new Set<number>();
    scn.edges.forEach((e, i) => {
        if (roots.has(find(e.from))) edges.add(i);
    });
    return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

type Pt = { x: number; y: number };
function center(n: Node): Pt {
    return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
}
/** Anchor on the node's perimeter pointing toward `toward` (so arrows touch the
 *  edge, not the centre). Simple box-intersection. */
function edgeAnchor(n: Node, toward: Pt): Pt {
    const c = center(n);
    const dx = toward.x - c.x;
    const dy = toward.y - c.y;
    if (dx === 0 && dy === 0) return c;
    const hw = n.w / 2;
    const hh = n.h / 2;
    const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
    const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
    const s = Math.min(sx, sy);
    return { x: c.x + dx * s, y: c.y + dy * s };
}

const BOW = 0.16;
function bezier(from: Pt, to: Pt): { d: string; cx: number; cy: number } {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    const cx = mx + (-dy / len) * len * BOW;
    const cy = my + (dx / len) * len * BOW;
    return { d: `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`, cx, cy };
}

// ---------------------------------------------------------------------------
// Arrow variants — each renders ONE arrow given endpoints + dim/active state
// ---------------------------------------------------------------------------

type Variant = "taper" | "gradient-flow" | "engraved" | "pulse";

type ArrowProps = {
    id: string;
    from: Pt;
    to: Pt;
    active: boolean; // not dimmed
    emphasized: boolean; // directly hovered → thicker/brighter
};

function ArrowTaper({ from, to, active, emphasized }: ArrowProps) {
    const { d } = bezier(from, to);
    const w = emphasized ? 5 : 3.5;
    return (
        <g
            opacity={active ? 1 : 0.18}
            style={{ transition: "opacity 140ms" }}
            filter="url(#softShadow)"
        >
            <path
                d={d}
                fill="none"
                stroke={emphasized ? ACCENT_STRONG : ACCENT}
                strokeWidth={w}
                strokeLinecap="round"
                markerEnd="url(#head-taper)"
            />
        </g>
    );
}

function ArrowGradientFlow({ id, from, to, active, emphasized }: ArrowProps) {
    const { d } = bezier(from, to);
    return (
        <g
            opacity={active ? 1 : 0.16}
            style={{ transition: "opacity 140ms" }}
            filter="url(#softShadow)"
        >
            {/* base */}
            <path
                d={d}
                fill="none"
                stroke={`url(#grad-${id})`}
                strokeWidth={emphasized ? 5 : 3.5}
                strokeLinecap="round"
                markerEnd="url(#head-grad)"
            />
            {/* drifting dashes — direction of travel */}
            <path
                d={d}
                fill="none"
                stroke={ACCENT_STRONG}
                strokeWidth={emphasized ? 2.2 : 1.6}
                strokeLinecap="round"
                strokeDasharray="2 16"
                opacity={0.9}
            >
                <animate
                    attributeName="stroke-dashoffset"
                    from="36"
                    to="0"
                    dur="1.1s"
                    repeatCount="indefinite"
                />
            </path>
        </g>
    );
}

function ArrowEngraved({ from, to, active, emphasized }: ArrowProps) {
    const { d } = bezier(from, to);
    return (
        <g opacity={active ? 1 : 0.2} style={{ transition: "opacity 140ms" }}>
            {/* outer engraved channel */}
            <path
                d={d}
                fill="none"
                stroke={ACCENT_SOFT}
                strokeWidth={emphasized ? 8 : 6}
                strokeLinecap="round"
                opacity={0.55}
            />
            {/* inner bright filament */}
            <path
                d={d}
                fill="none"
                stroke={emphasized ? ACCENT_STRONG : ACCENT}
                strokeWidth={emphasized ? 2.6 : 1.8}
                strokeLinecap="round"
                markerEnd="url(#head-engraved)"
            />
        </g>
    );
}

function ArrowPulse({ id, from, to, active, emphasized }: ArrowProps) {
    const { d } = bezier(from, to);
    return (
        <g
            opacity={active ? 1 : 0.16}
            style={{ transition: "opacity 140ms" }}
            filter="url(#softShadow)"
        >
            <path
                d={d}
                fill="none"
                stroke={`url(#grad-${id})`}
                strokeWidth={emphasized ? 4.5 : 3}
                strokeLinecap="round"
                markerEnd="url(#head-grad)"
            />
            {/* travelling energy dot */}
            <circle r={emphasized ? 4 : 3} fill={ACCENT_STRONG}>
                <animateMotion dur="1.4s" repeatCount="indefinite" path={d} />
            </circle>
        </g>
    );
}

function Arrow(props: ArrowProps & { variant: Variant }) {
    switch (props.variant) {
        case "taper":
            return <ArrowTaper {...props} />;
        case "gradient-flow":
            return <ArrowGradientFlow {...props} />;
        case "engraved":
            return <ArrowEngraved {...props} />;
        case "pulse":
            return <ArrowPulse {...props} />;
    }
}

// ---------------------------------------------------------------------------
// Node chrome
// ---------------------------------------------------------------------------

function NodeBox({
    n,
    active,
    hovered,
    onEnter,
    onLeave,
}: {
    n: Node;
    active: boolean;
    hovered: boolean;
    onEnter: () => void;
    onLeave: () => void;
}) {
    const base =
        "absolute flex flex-col items-center justify-center text-center select-none cursor-pointer";
    const ring = hovered
        ? `0 0 0 2px ${ACCENT_STRONG}, 0 8px 24px rgba(0,0,0,.5)`
        : active
          ? `0 0 0 1px ${ACCENT_SOFT}, 0 6px 18px rgba(0,0,0,.45)`
          : "0 4px 12px rgba(0,0,0,.4)";

    if (n.kind === "stack") {
        return (
            <div
                className={base}
                onMouseEnter={onEnter}
                onMouseLeave={onLeave}
                style={{
                    left: n.x,
                    top: n.y,
                    width: n.w,
                    height: n.h,
                    opacity: active ? 1 : 0.4,
                    transition: "opacity 140ms, box-shadow 140ms",
                    borderRadius: 10,
                    background:
                        "linear-gradient(160deg,#1c1d24 0%,#121319 100%)",
                    border: `1px solid ${ACCENT_SOFT}`,
                    boxShadow: ring,
                    color: "#e8e3d4",
                    padding: 6,
                }}
            >
                <span className="text-[12px] font-semibold leading-tight">
                    {n.label}
                </span>
                {n.sub && (
                    <span className="text-[9px] uppercase tracking-wider text-white/45">
                        {n.sub}
                    </span>
                )}
            </div>
        );
    }

    if (n.kind === "player") {
        return (
            <div
                className={base}
                onMouseEnter={onEnter}
                onMouseLeave={onLeave}
                style={{
                    left: n.x,
                    top: n.y,
                    width: n.w,
                    height: n.h,
                    opacity: active ? 1 : 0.4,
                    transition: "opacity 140ms, box-shadow 140ms",
                    borderRadius: 8,
                    background: "linear-gradient(160deg,#15161c,#0e0f14)",
                    border: `1px solid ${ACCENT_SOFT}`,
                    boxShadow: ring,
                    color: "#e8e3d4",
                }}
            >
                <span className="text-[18px] font-bold leading-none">
                    {n.sub}
                </span>
                <span className="text-[10px] text-white/55">{n.label}</span>
            </div>
        );
    }

    // permanent card
    return (
        <div
            className={base}
            onMouseEnter={onEnter}
            onMouseLeave={onLeave}
            style={{
                left: n.x,
                top: n.y,
                width: n.w,
                height: n.h,
                opacity: active ? 1 : 0.4,
                transition: "opacity 140ms, box-shadow 140ms",
                borderRadius: 8,
                background:
                    "linear-gradient(165deg,#2a2620 0%,#15120d 70%,#0d0b07 100%)",
                border: `1px solid ${hovered ? ACCENT_STRONG : ACCENT_SOFT}`,
                boxShadow: ring,
                color: "#efe9da",
                padding: 8,
            }}
        >
            <div
                style={{
                    width: "100%",
                    height: 70,
                    borderRadius: 4,
                    background:
                        "linear-gradient(135deg,#4a4030,#241f17)",
                    marginBottom: 6,
                    border: `1px solid ${ACCENT_SOFT}`,
                }}
            />
            <span className="text-[11px] font-semibold leading-tight">
                {n.label}
            </span>
        </div>
    );
}

// ---------------------------------------------------------------------------
// SVG defs (markers, gradients, shadow)
// ---------------------------------------------------------------------------

function Defs({ edgeIds }: { edgeIds: string[] }) {
    return (
        <defs>
            <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow
                    dx="0"
                    dy="1"
                    stdDeviation="2.2"
                    floodColor="#000"
                    floodOpacity="0.45"
                />
            </filter>
            {(["taper", "grad", "engraved"] as const).map((k) => (
                <marker
                    key={k}
                    id={`head-${k}`}
                    markerWidth="7"
                    markerHeight="7"
                    refX="5"
                    refY="3.2"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                >
                    <path
                        d="M0,0 L7,3.2 L0,6.4 Q2.6,3.2 0,0 Z"
                        fill={k === "engraved" ? ACCENT_STRONG : ACCENT}
                    />
                </marker>
            ))}
            {edgeIds.map((id) => (
                <linearGradient
                    key={id}
                    id={`grad-${id}`}
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="1"
                >
                    <stop offset="0%" stopColor={ACCENT_SOFT} />
                    <stop offset="55%" stopColor={ACCENT} />
                    <stop offset="100%" stopColor={ACCENT_STRONG} />
                </linearGradient>
            ))}
        </defs>
    );
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const VARIANTS: [Variant, string][] = [
    ["taper", "Solid taper"],
    ["gradient-flow", "Gradient flow"],
    ["engraved", "Engraved (Zelda)"],
    ["pulse", "Pulse dot"],
];

export default function PrototypeArrowsRoute() {
    const [variant, setVariant] = useState<Variant>("gradient-flow");
    const [scnKey, setScnKey] = useState(SCENARIOS[0].key);
    const [hoverId, setHoverId] = useState<string | null>(null);
    const [hoverEdge, setHoverEdge] = useState<number | null>(null);

    const scn = SCENARIOS.find((s) => s.key === scnKey)!;
    const nodeById = useMemo(
        () => Object.fromEntries(scn.nodes.map((n) => [n.id, n])),
        [scn]
    );
    const hl = useMemo(
        () => resolveHighlight(scn, hoverId, hoverEdge),
        [scn, hoverId, hoverEdge]
    );

    const arrows = scn.edges.map((e, i) => {
        const a = nodeById[e.from];
        const b = nodeById[e.to];
        const from = edgeAnchor(a, center(b));
        const to = edgeAnchor(b, center(a));
        const active = hl ? hl.edges.has(i) : true;
        const emphasized = hoverEdge === i;
        return { id: `${e.from}-${e.to}-${i}`, i, from, to, active, emphasized };
    });

    return (
        <div
            className="fixed inset-0 overflow-hidden"
            style={{
                backgroundImage:
                    "radial-gradient(ellipse at 50% 35%, #15212e 0%, #0a0a0c 65%)",
            }}
        >
            <div
                className="absolute"
                style={{ left: 0, top: 0, right: 0, bottom: 0 }}
            >
                {/* arrows under cards? no — overlay above, but pointer passes
                    except the hit-stroke. z above cards. */}
                {scn.nodes.map((n) => (
                    <NodeBox
                        key={n.id}
                        n={n}
                        active={hl ? hl.nodes.has(n.id) : true}
                        hovered={hoverId === n.id}
                        onEnter={() => setHoverId(n.id)}
                        onLeave={() => setHoverId(null)}
                    />
                ))}

                <svg
                    className="absolute inset-0 h-full w-full"
                    style={{ pointerEvents: "none", overflow: "visible", zIndex: 60 }}
                >
                    <Defs edgeIds={arrows.map((a) => a.id)} />
                    {arrows.map((a) => (
                        <g key={a.id}>
                            {/* wide invisible hit-stroke → only the line grabs
                                hover; rest of card stays clickable */}
                            <path
                                d={bezier(a.from, a.to).d}
                                fill="none"
                                stroke="transparent"
                                strokeWidth={18}
                                style={{ pointerEvents: "stroke", cursor: "pointer" }}
                                onMouseEnter={() => setHoverEdge(a.i)}
                                onMouseLeave={() => setHoverEdge(null)}
                            />
                            <Arrow
                                variant={variant}
                                id={a.id}
                                from={a.from}
                                to={a.to}
                                active={a.active}
                                emphasized={a.emphasized}
                            />
                        </g>
                    ))}
                </svg>
            </div>

            {/* control bar */}
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-4 px-4 py-3 rounded-lg bg-zinc-900/85 backdrop-blur border border-white/10 text-zinc-200 text-xs shadow-2xl">
                <div className="flex rounded overflow-hidden border border-white/15">
                    {VARIANTS.map(([v, label]) => (
                        <button
                            key={v}
                            type="button"
                            onClick={() => setVariant(v)}
                            className={`px-3 py-1.5 cursor-pointer transition-colors ${
                                variant === v
                                    ? "bg-amber-600/80 text-white"
                                    : "bg-transparent hover:bg-white/10"
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <div className="flex rounded overflow-hidden border border-white/15">
                    {SCENARIOS.map((s) => (
                        <button
                            key={s.key}
                            type="button"
                            onClick={() => setScnKey(s.key)}
                            className={`px-3 py-1.5 cursor-pointer transition-colors ${
                                scnKey === s.key
                                    ? "bg-emerald-600/80 text-white"
                                    : "bg-transparent hover:bg-white/10"
                            }`}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] text-[11px] text-white/45">
                PROTOTYPE · hover a card / pill / arrow — stack = 1-hop, combat =
                whole cluster
            </div>
        </div>
    );
}
