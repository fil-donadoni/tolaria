// PROTOTYPE — throwaway (branch prototype/identity-v4). The floating bar that
// flips the knobs. Deliberately ugly (magenta, monospace) so it never reads as
// part of the design under evaluation. ←/→ cycle the frame variant.
import { useEffect, useState } from "react";
import {
    ACCENTS,
    DENSITIES,
    DEFAULTS,
    FRAMES,
    FRAME_LABEL,
    FONTS,
    GROUNDS,
    type IdentitySearch,
    PERMS,
    SURFACES,
} from "./identity-theme";

type Knob = keyof IdentitySearch;

export default function IdentitySwitcher({
    value,
    onChange,
    hideSurface = false,
}: {
    value: Required<IdentitySearch>;
    onChange: (patch: IdentitySearch) => void;
    hideSurface?: boolean;
}) {
    const [collapsed, setCollapsed] = useState(value.surface === "board");

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            if (
                t &&
                (t.tagName === "INPUT" ||
                    t.tagName === "TEXTAREA" ||
                    t.isContentEditable)
            )
                return;
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            const i = FRAMES.indexOf(value.frame);
            const n =
                (i + (e.key === "ArrowRight" ? 1 : -1) + FRAMES.length) %
                FRAMES.length;
            onChange({ frame: FRAMES[n] });
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [value.frame, onChange]);

    if (import.meta.env.PROD) return null;

    const group = <K extends Knob>(
        label: string,
        knob: K,
        options: readonly NonNullable<IdentitySearch[K]>[],
        fmt?: (v: NonNullable<IdentitySearch[K]>) => string
    ) => (
        <span className="g" key={knob}>
            <span>{label}</span>
            {options.map((o) => (
                <button
                    key={String(o)}
                    type="button"
                    aria-pressed={value[knob] === o}
                    onClick={() => onChange({ [knob]: o } as IdentitySearch)}
                >
                    {fmt ? fmt(o) : String(o)}
                </button>
            ))}
        </span>
    );

    if (collapsed) {
        return (
            <div className="psw collapsed">
                <button type="button" onClick={() => setCollapsed(false)}>
                    proto ▸
                </button>
            </div>
        );
    }

    return (
        <div className="psw" role="toolbar" aria-label="Prototype knobs">
            {hideSurface ? null : group("surface", "surface", SURFACES)}
            {group("ground", "ground", GROUNDS)}
            {group("frame", "frame", FRAMES, (f) => FRAME_LABEL[f])}
            {group("accent", "accent", ACCENTS)}
            {group("font", "font", FONTS)}
            {hideSurface
                ? null
                : value.surface === "board"
                  ? group("perms", "perm", PERMS)
                  : group("lobby", "density", DENSITIES)}
            <span className="g">
                <a href="/prototype/identity">identity</a>
                <a href="/prototype/dialogs">dialogs</a>
                <a href={value.surface === "board" ? "/game" : "/"}>
                    ↗ current {value.surface}
                </a>
                <button type="button" onClick={() => onChange({ ...DEFAULTS })}>
                    reset
                </button>
                <button type="button" onClick={() => setCollapsed(true)}>
                    ◂
                </button>
            </span>
        </div>
    );
}
