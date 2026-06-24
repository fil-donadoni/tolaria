/* PROTOTYPE — throwaway. Battlefield identical-permanent stacking (Arena-style).
 *
 * Question: how should N identical permanents collapse into one stack, and how
 * does a stack stay readable when some members are tapped and some untapped?
 *
 * Route: /prototype/stack?variant=A|B|C  (switch via floating bottom bar).
 * Self-contained: mock data + a dumb <CardFace>, no game context / Convex.
 *
 * Stacking identity key (CONFIRMED with user):
 *   stack together iff same card + same isSummoningSick + no attachment +
 *   zero counters + zero damage + no temp P/T mods.  isTapped & manaCommitted
 *   are EXCLUDED from the key (so a land row stays one stack as you tap it).
 *
 * Delete this file + its router entry once a variant wins (fold into
 * board-battlefield.tsx).
 */
import { useSearch, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

const CARD_W = 120;
const CARD_H = 168;

const IMG = (id: string) =>
    `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`;

const ART = {
    forest: "6f1c8cb0-38eb-408b-94e8-16db83999b3b",
    mountain: "eace2c85-976c-425e-9800-5a6ccbd91b56",
    grizzly: "ce2d603a-3231-4a8c-bf39-1617586ea870",
    lions: "d05b92bd-797e-413f-a8b0-32e0937a1ee0",
} as const;

type Perm = {
    id: string;
    art: string;
    name: string;
    isTapped: boolean;
    isSummoningSick: boolean;
    counters: number;
    damage: number;
    power?: number;
    toughness?: number;
};

// ---- mock scene: lands (some tapped) + creatures (one with a +1/+1 counter) --
let n = 0;
const mk = (p: Partial<Perm> & { art: string; name: string }): Perm => ({
    id: `m${n++}`,
    isTapped: false,
    isSummoningSick: false,
    counters: 0,
    damage: 0,
    ...p,
});

const SCENE: Perm[] = [
    // 11 Forest, 2 tapped -> ONE stack of 11 (>8 -> collapses to depth-pile;
    // hover expands to fan). 9 untapped + 2 tapped.
    ...Array.from({ length: 9 }, () => mk({ art: ART.forest, name: "Forest" })),
    mk({ art: ART.forest, name: "Forest", isTapped: true }),
    mk({ art: ART.forest, name: "Forest", isTapped: true }),
    // 3 Mountain untapped -> stack of 3
    ...Array.from({ length: 3 }, () => mk({ art: ART.mountain, name: "Mountain" })),
    // 3 vanilla Grizzly Bears -> stack of 3
    ...Array.from({ length: 3 }, () =>
        mk({ art: ART.grizzly, name: "Grizzly Bears", power: 2, toughness: 2 })
    ),
    // 1 Grizzly Bears with a +1/+1 counter -> SINGLETON (altered state breaks out)
    mk({
        art: ART.grizzly,
        name: "Grizzly Bears",
        power: 2,
        toughness: 2,
        counters: 1,
    }),
    // 2 Savannah Lions, summoning sick -> stack of 2
    ...Array.from({ length: 2 }, () =>
        mk({
            art: ART.lions,
            name: "Savannah Lions",
            power: 2,
            toughness: 1,
            isSummoningSick: true,
        })
    ),
];

// Identity key — everything that must match EXCEPT tap/manaCommitted.
function stackKey(p: Perm): string | null {
    // any altered/instance-specific state -> not stackable (null = own group)
    if (p.counters > 0 || p.damage > 0) return null;
    return [p.name, p.isSummoningSick ? "sick" : "ready"].join("|");
}

type Group = { key: string; members: Perm[] };

function groupBattlefield(perms: Perm[]): Group[] {
    const groups: Group[] = [];
    const byKey = new Map<string, Group>();
    for (const p of perms) {
        const k = stackKey(p);
        if (k === null) {
            groups.push({ key: `solo-${p.id}`, members: [p] });
            continue;
        }
        let g = byKey.get(k);
        if (!g) {
            g = { key: k, members: [] };
            byKey.set(k, g);
            groups.push(g);
        }
        g.members.push(p);
    }
    return groups;
}

// ---- dumb card face (shared low-level primitive; layout differs per variant) -
function CardFace({
    perm,
    style,
}: {
    perm: Perm;
    style?: React.CSSProperties;
}) {
    const isCreature = perm.power !== undefined;
    return (
        <div
            className="absolute rounded-sm overflow-hidden ring-1 ring-black/40 shadow-[0_6px_16px_rgba(0,0,0,0.55)]"
            style={{
                width: CARD_W,
                height: CARD_H,
                transform: perm.isTapped ? "rotate(90deg)" : undefined,
                ...style,
            }}
        >
            <img
                src={IMG(perm.art)}
                alt={perm.name}
                className="w-full h-full object-cover"
                draggable={false}
            />
            {perm.isSummoningSick && (
                <div className="absolute inset-0 bg-[var(--color-surface-base)]/35 pointer-events-none" />
            )}
            {perm.counters > 0 && (
                <div className="absolute top-1 left-1 bg-[var(--color-accent)] text-[var(--color-surface-base)] text-[11px] font-bold px-1 rounded-xs leading-tight">
                    +{perm.counters}/+{perm.counters}
                </div>
            )}
            {isCreature && (
                <div className="absolute bottom-1.5 right-1.5 bg-black text-white text-[10px] font-bold px-1 py-0.5 rounded-xs leading-none">
                    {(perm.power ?? 0) + perm.counters}/
                    {(perm.toughness ?? 0) + perm.counters}
                </div>
            )}
        </div>
    );
}

function CountBadge({ n, label }: { n: number; label?: string }) {
    if (n <= 1) return null;
    return (
        <div className="absolute -top-2 -right-2 z-30 min-w-6 h-6 px-1.5 flex items-center justify-center rounded-full bg-[var(--color-accent-strong)] text-[var(--color-surface-base)] text-sm font-extrabold ring-2 ring-[var(--color-surface-base)] shadow-lg">
            ×{n}
            {label && <span className="ml-0.5 text-[9px]">{label}</span>}
        </div>
    );
}

// ============================ VARIANT A — Fan ================================
// Cards fanned out horizontally so EVERY instance stays individually clickable.
// Confirmed rules:
//  - order inside the stack is always untapped-first then tapped (never
//    interleaved); re-sorted on every tap toggle.
//  - reveal offset clamps so a big stack can't span the whole board; clamping
//    makes mid-stack clicks tighter, so hover-lift is mandatory: the hovered
//    card pops up + rises to the top z so you can read/click the exact one.
//  - tapped members render rotated 90°; a vertical band is reserved so the
//    rotation doesn't clip neighbours.
const FAN_BASE_OFFSET = 34;
const FAN_MAX_WIDTH = 360; // clamp: fan never wider than this
const TAP_BAND = 30; // vertical room reserved for rotated (tapped) cards
const FAN_MAX_CARDS = 8; // >8 -> collapse to depth-pile (hover expands to fan)
const DEPTH = 4; // px diagonal per card in collapsed depth-pile

function fanOffset(count: number): number {
    if (count <= 1) return FAN_BASE_OFFSET;
    const fit = (FAN_MAX_WIDTH - CARD_W) / (count - 1);
    return Math.min(FAN_BASE_OFFSET, fit);
}

// untapped first, then tapped; stable by id within each segment.
function fanOrder(members: Perm[]): Perm[] {
    return [...members].sort((a, b) => {
        if (a.isTapped !== b.isTapped) return a.isTapped ? 1 : -1;
        return a.id.localeCompare(b.id);
    });
}

function FanStack({ group }: { group: Group }) {
    const [hovered, setHovered] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const members = fanOrder(group.members);
    const count = members.length;

    // >8 cards collapse to a tight depth-pile; hovering the pile expands it back
    // into the fan so every instance stays individually selectable.
    const collapsed = count > FAN_MAX_CARDS && !open;

    const off = fanOffset(count);
    const fanWidth = CARD_W + (count - 1) * off;
    const depthWidth = CARD_W + (count - 1) * DEPTH;
    const width = collapsed ? depthWidth : fanWidth;

    return (
        <div
            className="relative"
            style={{ width, height: CARD_H + TAP_BAND, paddingTop: TAP_BAND }}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => {
                setOpen(false);
                setHovered(null);
            }}
        >
            {members.map((p, i) => {
                const lift = !collapsed && hovered === p.id;
                const left = collapsed ? i * DEPTH : i * off;
                return (
                    <div
                        key={p.id}
                        onMouseEnter={() => setHovered(p.id)}
                        onMouseLeave={() =>
                            setHovered((h) => (h === p.id ? null : h))
                        }
                        style={{
                            position: "absolute",
                            left,
                            top: collapsed ? TAP_BAND + i * DEPTH : TAP_BAND,
                            width: CARD_W,
                            height: CARD_H,
                            zIndex: lift ? 999 : i,
                            transform: lift ? "translateY(-16px)" : undefined,
                            transition: "transform 150ms, left 200ms, top 200ms",
                        }}
                    >
                        <CardFace perm={p} style={{ left: 0, top: 0 }} />
                    </div>
                );
            })}
            <CountBadge n={count} />
        </div>
    );
}

function VariantA({ groups }: { groups: Group[] }) {
    return (
        <Row title="A — Fan orizzontale (ordine stappate→tappate, hover-lift)">
            {groups.map((g) => (
                <FanStack key={g.key} group={g} />
            ))}
        </Row>
    );
}

// ===================== VARIANT B — Dual-count piles ==========================
// At most TWO footprints per group regardless of N: one upright representative
// (×untapped) and, only if any member is tapped, one rotated representative
// (×tapped). Tightest footprint; tap state shown by which pile + its count.
function VariantB({ groups }: { groups: Group[] }) {
    return (
        <Row title="B — Pila compatta + doppio conteggio">
            {groups.map((g) => {
                const untapped = g.members.filter((p) => !p.isTapped);
                const tapped = g.members.filter((p) => p.isTapped);
                return (
                    <div key={g.key} className="flex items-center gap-3">
                        {untapped.length > 0 && (
                            <div
                                className="relative"
                                style={{ width: CARD_W, height: CARD_H }}
                            >
                                <CardFace perm={untapped[0]} style={{ left: 0 }} />
                                <CountBadge n={untapped.length} />
                            </div>
                        )}
                        {tapped.length > 0 && (
                            <div
                                className="relative"
                                style={{ width: CARD_H, height: CARD_W }}
                            >
                                <CardFace
                                    perm={tapped[0]}
                                    style={{ left: (CARD_H - CARD_W) / 2, top: (CARD_W - CARD_H) / 2 }}
                                />
                                <CountBadge n={tapped.length} />
                            </div>
                        )}
                    </div>
                );
            })}
        </Row>
    );
}

// ====================== VARIANT C — Depth pile + hover ======================
// Cards stacked in a tight diagonal (poker-chip depth), single card footprint,
// total ×N badge. Tapped members live in a separate small adjacent depth pile,
// so the main pile stays a clean upright stack. (Hover-expand would fan it out
// in the real impl; static here.)
function VariantC({ groups }: { groups: Group[] }) {
    const D = 4; // px diagonal per card
    const depth = (members: Perm[], rotated: boolean) => {
        const span = (members.length - 1) * D;
        const box = rotated
            ? { width: CARD_H + span, height: CARD_W + span }
            : { width: CARD_W + span, height: CARD_H + span };
        return (
            <div className="relative" style={box}>
                {members.map((p, i) => (
                    <CardFace
                        key={p.id}
                        perm={p}
                        style={{
                            left: rotated
                                ? i * D - (CARD_H - CARD_W) / 2
                                : i * D,
                            top: rotated
                                ? i * D + (CARD_H - CARD_W) / 2
                                : i * D,
                            zIndex: i,
                        }}
                    />
                ))}
                <CountBadge n={members.length} />
            </div>
        );
    };
    return (
        <Row title="C — Depth pile (gettoni)">
            {groups.map((g) => {
                const untapped = g.members.filter((p) => !p.isTapped);
                const tapped = g.members.filter((p) => p.isTapped);
                return (
                    <div key={g.key} className="flex items-start gap-3">
                        {untapped.length > 0 && depth(untapped, false)}
                        {tapped.length > 0 && depth(tapped, true)}
                    </div>
                );
            })}
        </Row>
    );
}

function Row({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <div>
            <h2 className="text-[var(--color-text-muted)] text-sm font-semibold mb-6">
                {title}
            </h2>
            <div className="flex flex-wrap items-start gap-x-10 gap-y-12">
                {children}
            </div>
        </div>
    );
}

const VARIANTS = {
    A: { name: "Fan orizzontale", Comp: VariantA },
    B: { name: "Pila compatta + doppio conteggio", Comp: VariantB },
    C: { name: "Depth pile (gettoni)", Comp: VariantC },
} as const;
type VKey = keyof typeof VARIANTS;
const KEYS = Object.keys(VARIANTS) as VKey[];

function Switcher({ current }: { current: VKey }) {
    const navigate = useNavigate();
    const go = (k: VKey) =>
        navigate({ to: "/prototype/stack", search: { variant: k } });
    const cycle = (dir: 1 | -1) => {
        const i = KEYS.indexOf(current);
        go(KEYS[(i + dir + KEYS.length) % KEYS.length]);
    };
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement;
            if (/INPUT|TEXTAREA/.test(t.tagName) || t.isContentEditable) return;
            if (e.key === "ArrowLeft") cycle(-1);
            if (e.key === "ArrowRight") cycle(1);
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    });
    return (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2 rounded-full bg-[var(--color-surface-elevated)] ring-2 ring-[var(--color-accent)] shadow-xl text-[var(--color-text)]">
            <button onClick={() => cycle(-1)} className="px-2 text-lg">
                ←
            </button>
            <span className="text-sm font-semibold min-w-56 text-center">
                {current} — {VARIANTS[current].name}
            </span>
            <button onClick={() => cycle(1)} className="px-2 text-lg">
                →
            </button>
        </div>
    );
}

export default function PrototypeStackRoute() {
    const search = useSearch({ from: "/prototype/stack" }) as {
        variant?: VKey;
    };
    const current: VKey = search.variant ?? "A";
    const groups = groupBattlefield(SCENE);
    const { Comp } = VARIANTS[current];
    return (
        <div className="min-h-screen bg-[var(--color-surface-base)] p-12 pb-28">
            <p className="text-[var(--color-text-muted)] text-xs mb-2 uppercase tracking-wide">
                PROTOTYPE · battlefield stacking · {SCENE.length} permanents →{" "}
                {groups.length} groups
            </p>
            <Comp groups={groups} />
            {import.meta.env.MODE !== "production" && (
                <Switcher current={current} />
            )}
        </div>
    );
}
