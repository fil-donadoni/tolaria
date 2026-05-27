/**
 * PROTOTYPE — visual approaches for colorOverride indicator.
 * Throwaway — delete after decision.
 *
 * 2 variants (C and D), one card per original color + artifact + land +
 * simulated multicolor. Each laced to all 5 colors.
 */

import { useState } from "react";
import { getImageUrl } from "~/lib/images";

// MTG canonical frame colors (sampled from Alpha card scans)
const LACE_COLORS = [
    {
        code: "W",
        name: "White",
        solid: "#f0e6b8",
        inner: "rgba(240,230,184,0.60)",
        outerGlow: "rgba(240,230,184,0.25)",
    },
    {
        code: "U",
        name: "Blue",
        solid: "#0a6faa",
        inner: "rgba(10,111,170,0.55)",
        outerGlow: "rgba(10,111,170,0.25)",
    },
    {
        code: "B",
        name: "Black",
        solid: "#5c3d6e",
        inner: "rgba(92,61,110,0.60)",
        outerGlow: "rgba(92,61,110,0.30)",
    },
    {
        code: "R",
        name: "Red",
        solid: "#c83c2e",
        inner: "rgba(200,60,46,0.55)",
        outerGlow: "rgba(200,60,46,0.25)",
    },
    {
        code: "G",
        name: "Green",
        solid: "#1a734a",
        inner: "rgba(26,115,74,0.55)",
        outerGlow: "rgba(26,115,74,0.25)",
    },
] as const;

// Multicolor gradient: Gold frame
const MULTI = {
    name: "Multicolor",
    solid: "#c9a84c",
    inner: "rgba(201,168,76,0.55)",
    outerGlow: "rgba(201,168,76,0.25)",
};

// One card per original color + artifact + land
const CARDS = [
    {
        label: "White creature",
        id: "36204ddd-ddf7-4b44-ae3c-b4a5a41ac9cb",
        name: "Serra Angel",
    },
    {
        label: "Blue creature",
        id: "fefbf149-f988-4f8b-9f53-56f5878116a6",
        name: "Mahamoti Djinn",
    },
    {
        label: "Black creature",
        id: "510840f4-7c0e-4b47-8ebf-23c20cac4bd9",
        name: "Sengir Vampire",
    },
    {
        label: "Red creature",
        id: "f8ac5006-91bd-4803-93da-f87cf196dd2f",
        name: "Shivan Dragon",
    },
    {
        label: "Green creature",
        id: "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb",
        name: "Llanowar Elves",
    },
    {
        label: "Artifact",
        id: "d05b92bd-797e-413f-a8b0-32e0937a1ee0",
        name: "Sol Ring",
    },
    {
        label: "Land",
        id: "6f1c8cb0-38eb-408b-94e8-16db83999b3b",
        name: "Forest",
    },
    {
        label: "Multicolor (simulated)",
        id: "717f6d10-9144-4ade-9ac6-a481cc66b875",
        name: "Badlands",
    },
];

type Variant = "C" | "D";
type ColorDef = {
    name: string;
    solid: string;
    inner: string;
    outerGlow: string;
    code?: string;
};

const W = 120;
const H = Math.round(W * 1.4);

function CardSlot({
    scryfallId,
    cardName,
    label,
    color,
    variant,
}: {
    scryfallId: string;
    cardName: string;
    label: string;
    color?: ColorDef;
    variant: Variant;
}) {
    const isOriginal = !color;
    return (
        <div
            className="flex flex-col items-center gap-1.5"
            style={{ width: W }}
        >
            <div
                className="relative"
                style={{
                    width: W,
                    height: H,
                    borderRadius: "7%",
                    overflow: "hidden",
                }}
            >
                <img
                    src={getImageUrl(scryfallId)}
                    alt={cardName}
                    className="w-full h-full object-cover block"
                    draggable={false}
                />

                {/* Variant C: frame gradient overlay */}
                {!isOriginal && variant === "C" && (
                    <div
                        className="absolute inset-0 pointer-events-none"
                        style={{
                            boxShadow: `inset 0 0 0 4px ${color.inner}`,
                            background: `
                                linear-gradient(180deg, ${color.inner} 0%, transparent 22%),
                                linear-gradient(0deg, ${color.inner} 0%, transparent 22%),
                                linear-gradient(90deg, ${color.inner} 0%, transparent 18%),
                                linear-gradient(270deg, ${color.inner} 0%, transparent 18%)
                            `,
                        }}
                    />
                )}

                {/* Variant D: mana pip + subtle frame edge */}
                {!isOriginal && variant === "D" && (
                    <>
                        <div
                            className="absolute inset-0 pointer-events-none"
                            style={{
                                boxShadow: `inset 0 0 0 3px ${color.inner.replace(/[\d.]+\)$/, "0.35)")}`,
                            }}
                        />
                        {color.code && (
                            <div className="absolute top-1.5 left-1.5 z-10">
                                <img
                                    src={`/img/symbols/${color.code}.svg`}
                                    alt={color.name}
                                    className="w-5 h-5 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
                                    draggable={false}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>
            <span className="text-[11px] leading-tight text-center text-zinc-300">
                {label}
            </span>
        </div>
    );
}

export default function PrototypeColorOverride() {
    const [variant, setVariant] = useState<Variant>("C");

    const allTargetColors: ColorDef[] = [
        ...LACE_COLORS.map((c) => ({ ...c, code: c.code as string })),
        { ...MULTI, code: undefined },
    ];

    return (
        <div className="min-h-screen bg-[var(--color-surface-base)] text-zinc-200 p-6 pb-24">
            <h1 className="text-lg font-bold mb-1 text-[var(--color-accent)]">
                colorOverride Visual Indicator
            </h1>
            <p className="text-sm text-zinc-400 mb-6">
                Each row: original card (left), then laced to W / U / B / R / G
                / multicolor.
            </p>

            {CARDS.map((card) => (
                <div key={card.id} className="mb-8">
                    <h2 className="text-xs font-semibold text-zinc-500 mb-2.5 uppercase tracking-wider">
                        {card.label}
                    </h2>
                    <div className="flex flex-wrap gap-3 items-start">
                        <CardSlot
                            scryfallId={card.id}
                            cardName={card.name}
                            label={card.name}
                            variant={variant}
                        />
                        {allTargetColors.map((color) => (
                            <CardSlot
                                key={color.name}
                                scryfallId={card.id}
                                cardName={card.name}
                                label={`→ ${color.name}`}
                                color={color}
                                variant={variant}
                            />
                        ))}
                    </div>
                </div>
            ))}

            {/* Bottom bar — high contrast */}
            <div className="fixed bottom-0 left-0 right-0 bg-[var(--color-surface-base)] border-t border-zinc-700/60 px-4 py-3 flex items-center justify-center gap-3 z-50">
                {(["C", "D"] as Variant[]).map((v) => (
                    <button
                        key={v}
                        onClick={() => setVariant(v)}
                        className={`px-5 py-2 rounded text-sm font-semibold transition-colors ${
                            variant === v
                                ? "bg-[var(--color-accent)] text-[var(--color-surface-base)]"
                                : "bg-zinc-700 text-zinc-200 hover:bg-zinc-600"
                        }`}
                    >
                        {v === "C" ? "C: Frame Gradient" : "D: Mana Badge"}
                    </button>
                ))}
            </div>
        </div>
    );
}
