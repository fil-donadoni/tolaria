// PROTOTYPE — throwaway spike, not meant to survive past a design decision.
// Answers: "what should the mana-choice dialog look like?" (issue #2920).
// Three structurally different redesigns of `mana-choice-picker.tsx`, switchable
// via `?variant=A|B|C`. Read-only — no real game state, no mutations. Delete
// this route + its entry in router.tsx once a variant is folded into the real
// component, or keep it on a throwaway branch per the `prototype` skill.
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { Color, ManaCost } from "~/types/cards";
import { colors } from "~/types/cards";
import { getColorOverrideDisplay } from "~/lib/color-override";
import { Panel } from "~/components/ui/panel";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";

type PickerProps = {
    choices: ManaCost[];
    onSelect: (index: number) => void;
    onCancel: () => void;
};

function expandPips(cost: ManaCost): Color[] {
    return colors.flatMap((c) => Array.from({ length: cost[c] ?? 0 }, () => c));
}

function optionLabel(pips: Color[]): string {
    if (!pips.length) return "No mana";
    const names = pips.map((c) => getColorOverrideDisplay([c])?.name ?? c);
    // Collapse repeats ("White, White" -> "White x2") so a fixed {W}{W}
    // option reads as one clause instead of a stutter.
    const counted = new Map<string, number>();
    for (const n of names) counted.set(n, (counted.get(n) ?? 0) + 1);
    return [...counted.entries()]
        .map(([n, count]) => (count > 1 ? `${n} x${count}` : n))
        .join(" + ");
}

// ── Variant A — Labeled rows ───────────────────────────────────────────────
// Closest evolution of the shipped picker: same vertical stack of full-width
// rows, but the label is real, visible text (not a duplicated tooltip) sitting
// next to the icons. Icon-first hierarchy, label as confirmation.
function VariantA({ choices, onSelect, onCancel }: PickerProps) {
    return (
        <>
            <div
                className="fixed inset-0 z-hud modal-scrim"
                onClick={onCancel}
            />
            <div className="fixed z-modal left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <Panel
                    density="compact"
                    className="flex flex-col gap-2 p-3 min-w-64"
                >
                    {choices.map((cost, i) => {
                        const pips = expandPips(cost);
                        const label = optionLabel(pips);
                        return (
                            <button
                                key={i}
                                onClick={() => onSelect(i)}
                                aria-label={`Add ${label}`}
                                className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2 cursor-pointer ring-1 ring-white/15 transition-colors hover:bg-white/15 hover:ring-white/30"
                            >
                                <span className="flex shrink-0 gap-0.5">
                                    {pips.length ? (
                                        pips.map((c, p) => (
                                            <img
                                                key={p}
                                                src={`/img/symbols/${c}.svg`}
                                                alt=""
                                                className="size-6 shrink-0"
                                            />
                                        ))
                                    ) : (
                                        <span className="flex size-6 items-center justify-center text-xs font-semibold text-text/80">
                                            0
                                        </span>
                                    )}
                                </span>
                                <span className="text-sm text-text/90">
                                    {label}
                                </span>
                            </button>
                        );
                    })}
                </Panel>
            </div>
        </>
    );
}

// ── Variant B — Swatch grid ────────────────────────────────────────────────
// Grid of square tiles, colour-forward instead of icon-forward: each tile's
// background is the option's own colour (a diagonal split for a two-colour
// combo), the mana symbol sits on top of it, and the label is a caption below.
// Different information hierarchy than A — colour reads before symbol.
function VariantB({ choices, onSelect, onCancel }: PickerProps) {
    return (
        <>
            <div
                className="fixed inset-0 z-hud modal-scrim"
                onClick={onCancel}
            />
            <div className="fixed z-modal left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <Panel density="compact" className="p-3">
                    <div className="grid grid-cols-3 gap-2 max-w-72">
                        {choices.map((cost, i) => {
                            const pips = expandPips(cost);
                            const label = optionLabel(pips);
                            const swatches = pips.length
                                ? pips.map(
                                      (c) =>
                                          getColorOverrideDisplay([c])?.solid ??
                                          "#666"
                                  )
                                : ["#333"];
                            const background =
                                swatches.length > 1
                                    ? `linear-gradient(135deg, ${swatches[0]} 50%, ${swatches[1]} 50%)`
                                    : swatches[0];
                            return (
                                <button
                                    key={i}
                                    onClick={() => onSelect(i)}
                                    aria-label={`Add ${label}`}
                                    className="flex flex-col items-center gap-1 rounded-lg p-2 cursor-pointer ring-1 ring-white/15 transition-transform hover:scale-[1.04] hover:ring-white/40"
                                    style={{ background }}
                                >
                                    <span className="flex gap-0.5 rounded bg-black/30 px-1 py-0.5">
                                        {pips.length ? (
                                            pips.map((c, p) => (
                                                <img
                                                    key={p}
                                                    src={`/img/symbols/${c}.svg`}
                                                    alt=""
                                                    className="size-5 shrink-0"
                                                />
                                            ))
                                        ) : (
                                            <span className="flex size-5 items-center justify-center text-xs font-semibold text-white">
                                                0
                                            </span>
                                        )}
                                    </span>
                                    <span className="text-[10px] font-semibold text-white drop-shadow">
                                        {label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </Panel>
            </div>
        </>
    );
}

// ── Variant C — Compact segmented strip ────────────────────────────────────
// A single horizontal wrapping row of small chips (a segmented-control feel),
// radically more compact than a vertical list — meant for the common
// single-colour-of-N case (Pentad Prism's 5 options) without scrolling, while
// still reading a combo as one chip with two symbols.
function VariantC({ choices, onSelect, onCancel }: PickerProps) {
    return (
        <>
            <div
                className="fixed inset-0 z-hud modal-scrim"
                onClick={onCancel}
            />
            <div className="fixed z-modal left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <Panel density="compact" className="p-2">
                    <div className="flex flex-wrap gap-1.5 max-w-80">
                        {choices.map((cost, i) => {
                            const pips = expandPips(cost);
                            const label = optionLabel(pips);
                            return (
                                <button
                                    key={i}
                                    onClick={() => onSelect(i)}
                                    aria-label={`Add ${label}`}
                                    className="flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 cursor-pointer ring-1 ring-white/15 transition-colors hover:bg-white/15"
                                >
                                    {pips.length
                                        ? pips.map((c, p) => (
                                              <img
                                                  key={p}
                                                  src={`/img/symbols/${c}.svg`}
                                                  alt=""
                                                  className="size-4 shrink-0"
                                              />
                                          ))
                                        : null}
                                    <span className="text-xs text-text/90">
                                        {pips.length ? label : "No mana"}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </Panel>
            </div>
        </>
    );
}

const VARIANTS = {
    A: { component: VariantA, name: "Labeled rows" },
    B: { component: VariantB, name: "Swatch grid" },
    C: { component: VariantC, name: "Segmented strip" },
} as const;
type VariantKey = keyof typeof VARIANTS;
const VARIANT_KEYS = Object.keys(VARIANTS) as VariantKey[];

// Two sample choice sets mirroring the real callers: a single-colour-of-N
// pick (Pentad Prism, 5 options) and a fixed multi-pip combo alongside plain
// singles (the {U}{B}-style ability the real picker's comment describes).
const SAMPLES: Record<string, ManaCost[]> = {
    "pentad-prism": [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
    "combo-and-singles": [{ U: 1 }, { B: 1 }, { U: 1, B: 1 }, {}],
};

function PrototypeSwitcher({
    variant,
    onChange,
}: {
    variant: VariantKey;
    onChange: (v: VariantKey) => void;
}) {
    const cycle = useCallback(
        (dir: 1 | -1) => {
            const idx = VARIANT_KEYS.indexOf(variant);
            const next =
                VARIANT_KEYS[
                    (idx + dir + VARIANT_KEYS.length) % VARIANT_KEYS.length
                ];
            onChange(next);
        },
        [variant, onChange]
    );

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            const target = e.target as HTMLElement | null;
            if (
                target &&
                (target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.isContentEditable)
            )
                return;
            if (e.key === "ArrowLeft") cycle(-1);
            if (e.key === "ArrowRight") cycle(1);
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [cycle]);

    return (
        <div className="fixed bottom-4 left-1/2 z-[9999] -translate-x-1/2 flex items-center gap-3 rounded-full bg-black/80 px-4 py-2 text-sm text-white shadow-lg ring-1 ring-white/20">
            <button
                onClick={() => cycle(-1)}
                className="cursor-pointer px-1 hover:text-accent-strong"
                aria-label="Previous variant"
            >
                ←
            </button>
            <span className="font-semibold">
                {variant} — {VARIANTS[variant].name}
            </span>
            <button
                onClick={() => cycle(1)}
                className="cursor-pointer px-1 hover:text-accent-strong"
                aria-label="Next variant"
            >
                →
            </button>
        </div>
    );
}

export default function PrototypeManaChoiceDialogRoute() {
    useDocumentTitle("Prototype — mana-choice dialog");
    const search = useSearch({ strict: false }) as {
        variant?: string;
        sample?: string;
    };
    const navigate = useNavigate();
    const variant: VariantKey =
        search.variant && search.variant in VARIANTS
            ? (search.variant as VariantKey)
            : "A";
    const sampleKey =
        search.sample && search.sample in SAMPLES
            ? search.sample
            : "pentad-prism";
    const [open, setOpen] = useState(true);

    const setVariant = useCallback(
        (v: VariantKey) => {
            void navigate({
                to: ".",
                search: (prev) => ({ ...prev, variant: v }),
            });
        },
        [navigate]
    );
    const setSample = useCallback(
        (key: string) => {
            void navigate({
                to: ".",
                search: (prev) => ({ ...prev, sample: key }),
            });
        },
        [navigate]
    );

    if (process.env.NODE_ENV === "production") {
        return (
            <div className="p-8 text-text-muted">
                Prototype route — disabled in production builds.
            </div>
        );
    }

    const VariantComponent = VARIANTS[variant].component;

    return (
        <div className="relative flex min-h-screen flex-col items-center justify-center gap-6 bg-surface-base p-8 text-text">
            <div className="text-center">
                <p className="text-label">prototype — issue #2920</p>
                <h1 className="heading-panel mt-1 text-2xl">
                    Mana-choice dialog redesign
                </h1>
                <p className="mt-2 max-w-md text-sm text-text-muted">
                    Three layouts for the picker shown by abilities like Pentad
                    Prism. Flip variants with the bar below (or ←/→).
                </p>
            </div>

            <div className="flex gap-2">
                {Object.keys(SAMPLES).map((key) => (
                    <button
                        key={key}
                        onClick={() => setSample(key)}
                        className={`cursor-pointer rounded-full px-3 py-1 text-xs ring-1 transition-colors ${
                            sampleKey === key
                                ? "bg-accent-soft/40 ring-accent-strong text-accent-strong"
                                : "bg-white/5 ring-white/15 hover:bg-white/10"
                        }`}
                    >
                        {key === "pentad-prism"
                            ? "Pentad Prism (5 singles)"
                            : "Combo + singles"}
                    </button>
                ))}
            </div>

            {!open && (
                <button
                    onClick={() => setOpen(true)}
                    className="cursor-pointer rounded-lg bg-accent-soft/40 px-4 py-2 text-sm ring-1 ring-accent-strong"
                >
                    Reopen dialog
                </button>
            )}

            {open && (
                <VariantComponent
                    choices={SAMPLES[sampleKey]}
                    onSelect={() => setOpen(false)}
                    onCancel={() => setOpen(false)}
                />
            )}

            <PrototypeSwitcher variant={variant} onChange={setVariant} />
        </div>
    );
}
