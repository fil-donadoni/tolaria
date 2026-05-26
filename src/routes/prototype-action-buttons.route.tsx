/**
 * PROTOTYPE — ActionButton palette audit.
 * Shows every tone × state combination plus raw token swatches.
 * Throwaway — delete after decision.
 */

import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import ActionButton from "~/components/board/action-button";

const TONES = ["primary", "secondary", "destructive"] as const;

function ButtonMatrix() {
    return (
        <Panel>
            <PanelHeader title="ActionButton — All States" />
            <PanelBody>
                <div className="grid grid-cols-5 gap-x-6 gap-y-4 items-start">
                    <div className="text-xs text-text-muted font-beleren tracking-wide">
                        Tone
                    </div>
                    <div className="text-xs text-text-muted text-center">
                        Default
                    </div>
                    <div className="text-xs text-text-muted text-center">
                        Hover (simulated)
                    </div>
                    <div className="text-xs text-text-muted text-center">
                        Active (simulated)
                    </div>
                    <div className="text-xs text-text-muted text-center">
                        Disabled
                    </div>

                    {TONES.map((tone) => (
                        <>
                            <div
                                key={`${tone}-label`}
                                className="text-sm text-parchment font-beleren tracking-wide self-center"
                            >
                                {tone}
                            </div>
                            <div
                                key={`${tone}-default`}
                                className="flex justify-center"
                            >
                                <ActionButton
                                    onClick={() => {}}
                                    label={`${tone} btn`}
                                    tone={tone}
                                />
                            </div>
                            <div
                                key={`${tone}-hover`}
                                className="flex justify-center"
                            >
                                <StateSimulated tone={tone} state="hover" />
                            </div>
                            <div
                                key={`${tone}-active`}
                                className="flex justify-center"
                            >
                                <StateSimulated tone={tone} state="active" />
                            </div>
                            <div
                                key={`${tone}-disabled`}
                                className="flex justify-center"
                            >
                                <ActionButton
                                    onClick={() => {}}
                                    label="Disabled"
                                    tone={tone}
                                    disabled
                                />
                            </div>
                        </>
                    ))}
                </div>
            </PanelBody>
        </Panel>
    );
}

function StateSimulated({
    tone,
    state,
}: {
    tone: "primary" | "secondary" | "destructive";
    state: "hover" | "active";
}) {
    const classes: Record<string, Record<string, string>> = {
        hover: {
            primary: "bg-accent-soft/50 border-accent/45 text-accent-strong",
            secondary:
                "bg-secondary-accent-soft/50 border-secondary-accent/45 text-secondary-accent-strong",
            destructive:
                "bg-danger-soft/65 border-danger/45 text-danger-strong",
        },
        active: {
            primary: "bg-accent-soft/65 border-accent/45 text-accent-strong",
            secondary:
                "bg-secondary-accent-soft/65 border-secondary-accent/45 text-secondary-accent-strong",
            destructive:
                "bg-danger-soft/80 border-danger/45 text-danger-strong",
        },
    };
    return (
        <span
            className={`font-beleren tracking-wide px-5 py-2 rounded-sm text-sm border shadow-md inline-flex items-center ${classes[state][tone]}`}
        >
            {tone} {state}
        </span>
    );
}

function ButtonWithShortcuts() {
    return (
        <Panel>
            <PanelHeader title="With Shortcut Hints" />
            <PanelBody>
                <div className="flex flex-wrap gap-3">
                    <ActionButton
                        onClick={() => {}}
                        label="Pass"
                        tone="secondary"
                        shortcut="space"
                    />
                    <ActionButton
                        onClick={() => {}}
                        label="Pass Turn"
                        tone="primary"
                        shortcut="enter"
                    />
                    <ActionButton
                        onClick={() => {}}
                        label="Cancel"
                        tone="destructive"
                        shortcut="U"
                    />
                    <ActionButton
                        onClick={() => {}}
                        label="Confirm"
                        tone="primary"
                        shortcut="enter"
                    />
                </div>
            </PanelBody>
        </Panel>
    );
}

function ButtonSizes() {
    return (
        <Panel>
            <PanelHeader title="Side by Side — In Context" />
            <PanelBody>
                <p className="text-text-muted text-xs mb-2">
                    Action bar simulation (all tones together):
                </p>
                <div className="flex items-center gap-2 bg-surface/60 rounded-sm p-3 border border-border-subtle/40">
                    <ActionButton
                        onClick={() => {}}
                        label="Pass"
                        tone="secondary"
                        shortcut="space"
                    />
                    <ActionButton
                        onClick={() => {}}
                        label="Pass Turn"
                        tone="primary"
                        shortcut="enter"
                    />
                    <ActionButton
                        onClick={() => {}}
                        label="Cancel Cast"
                        tone="destructive"
                        shortcut="U"
                    />
                    <ActionButton
                        onClick={() => {}}
                        label="Disabled"
                        tone="primary"
                        disabled
                    />
                </div>

                <p className="text-text-muted text-xs mt-4 mb-2">
                    Dialog footer simulation:
                </p>
                <div className="flex justify-end gap-2 bg-surface/60 rounded-sm p-3 border border-border-subtle/40">
                    <ActionButton
                        onClick={() => {}}
                        label="Cancel"
                        tone="secondary"
                    />
                    <ActionButton
                        onClick={() => {}}
                        label="Delete"
                        tone="destructive"
                    />
                </div>

                <p className="text-text-muted text-xs mt-4 mb-2">Solo CTA:</p>
                <div className="flex justify-center bg-surface/60 rounded-sm p-3 border border-border-subtle/40">
                    <ActionButton
                        onClick={() => {}}
                        label="Solo Game"
                        tone="primary"
                    />
                </div>
            </PanelBody>
        </Panel>
    );
}

function TokenSwatches() {
    const tokens = [
        { name: "surface-base", var: "var(--color-surface-base)" },
        { name: "surface", var: "var(--color-surface)" },
        { name: "surface-elevated", var: "var(--color-surface-elevated)" },
        { name: "border-subtle", var: "var(--color-border-subtle)" },
        { name: "border-accent", var: "var(--color-border-accent)" },
        { name: "accent", var: "var(--color-accent)" },
        { name: "accent-strong", var: "var(--color-accent-strong)" },
        { name: "accent-soft", var: "var(--color-accent-soft)" },
        { name: "secondary-accent", var: "var(--color-secondary-accent)" },
        {
            name: "sec-accent-strong",
            var: "var(--color-secondary-accent-strong)",
        },
        {
            name: "sec-accent-soft",
            var: "var(--color-secondary-accent-soft)",
        },
        { name: "danger", var: "var(--color-danger)" },
        { name: "danger-strong", var: "var(--color-danger-strong)" },
        { name: "danger-soft", var: "var(--color-danger-soft)" },
        { name: "parchment", var: "var(--color-parchment)" },
        { name: "text", var: "var(--color-text)" },
        { name: "text-muted", var: "var(--color-text-muted)" },
        { name: "text-disabled", var: "var(--color-text-disabled)" },
    ];

    return (
        <Panel>
            <PanelHeader title="Token Swatches" />
            <PanelBody>
                <div className="grid grid-cols-5 gap-2">
                    {tokens.map((t) => (
                        <div
                            key={t.name}
                            className="flex flex-col items-center gap-1"
                        >
                            <div
                                className="w-12 h-12 rounded-sm border border-border-accent/30"
                                style={{ backgroundColor: t.var }}
                            />
                            <span className="text-[10px] text-text-muted text-center leading-tight">
                                {t.name}
                            </span>
                        </div>
                    ))}
                </div>
            </PanelBody>
        </Panel>
    );
}

function RawToneClasses() {
    const tones = [
        {
            name: "primary",
            bg: "bg-accent-soft/30",
            border: "border-accent/45",
            text: "text-accent-strong",
            hoverBg: "bg-accent-soft/50",
            activeBg: "bg-accent-soft/65",
        },
        {
            name: "secondary",
            bg: "bg-secondary-accent-soft/30",
            border: "border-secondary-accent/45",
            text: "text-secondary-accent-strong",
            hoverBg: "bg-secondary-accent-soft/50",
            activeBg: "bg-secondary-accent-soft/65",
        },
        {
            name: "destructive",
            bg: "bg-danger-soft/45",
            border: "border-danger/45",
            text: "text-danger-strong",
            hoverBg: "bg-danger-soft/65",
            activeBg: "bg-danger-soft/80",
        },
        {
            name: "disabled",
            bg: "bg-surface/40",
            border: "border-border-subtle/40",
            text: "text-text-disabled",
            hoverBg: "—",
            activeBg: "—",
        },
    ];

    return (
        <Panel>
            <PanelHeader title="Tone Class Breakdown" />
            <PanelBody>
                <table className="w-full text-xs text-text-muted">
                    <thead>
                        <tr className="text-left border-b border-border-accent/20">
                            <th className="pb-2 font-beleren text-parchment">
                                Tone
                            </th>
                            <th className="pb-2">bg</th>
                            <th className="pb-2">border</th>
                            <th className="pb-2">text</th>
                            <th className="pb-2">hover bg</th>
                            <th className="pb-2">active bg</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tones.map((t) => (
                            <tr
                                key={t.name}
                                className="border-b border-border-accent/10"
                            >
                                <td className="py-2 font-beleren text-parchment">
                                    {t.name}
                                </td>
                                <td className="py-2 font-mono">{t.bg}</td>
                                <td className="py-2 font-mono">{t.border}</td>
                                <td className="py-2 font-mono">{t.text}</td>
                                <td className="py-2 font-mono">{t.hoverBg}</td>
                                <td className="py-2 font-mono">{t.activeBg}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </PanelBody>
        </Panel>
    );
}

export default function PrototypeActionButtonsRoute() {
    return (
        <div className="min-h-screen bg-surface-base text-text p-6">
            <div className="mx-auto max-w-5xl flex flex-col gap-6">
                <div>
                    <h1 className="font-beleren text-parchment text-2xl tracking-wider mb-1">
                        ActionButton Palette Audit
                    </h1>
                    <p className="text-text-muted text-sm">
                        Every tone × every state. Tweak tokens in index.css,
                        refresh to see changes live.
                    </p>
                </div>

                <ButtonMatrix />
                <ButtonWithShortcuts />
                <ButtonSizes />
                <TokenSwatches />
                <RawToneClasses />
            </div>
        </div>
    );
}
