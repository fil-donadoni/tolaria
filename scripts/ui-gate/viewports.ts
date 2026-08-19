/**
 * The Viewport Matrix (ADR 0101, issue #2580).
 *
 * Five, not three. The tablet pair is where the deck builders hid their worst
 * clipping, and `.claude/rules/chrome-debug.md` named only three until this
 * lane existed. The ids are the SAME strings the manual chrome-devtools-mcp
 * `emulate` call uses, so a probe line from the gate and a probe line a human
 * pasted into a PR are directly comparable — and so `budgets.json` keys read
 * the same as the guide.
 */
export interface Viewport {
    /** Budget-file key and output label — matches the `emulate` string. */
    readonly id: string;
    readonly label: string;
    readonly width: number;
    readonly height: number;
    readonly dpr: number;
    readonly mobile: boolean;
}

export const VIEWPORTS: readonly Viewport[] = [
    {
        id: "1440x900x2",
        label: "desktop",
        width: 1440,
        height: 900,
        dpr: 2,
        mobile: false,
    },
    {
        id: "390x844x3",
        label: "phone portrait",
        width: 390,
        height: 844,
        dpr: 3,
        mobile: true,
    },
    {
        id: "844x390x3",
        label: "phone landscape",
        width: 844,
        height: 390,
        dpr: 3,
        mobile: true,
    },
    {
        id: "820x1180x2",
        label: "tablet portrait",
        width: 820,
        height: 1180,
        dpr: 2,
        mobile: true,
    },
    {
        id: "1180x820x2",
        label: "tablet landscape",
        width: 1180,
        height: 820,
        dpr: 2,
        mobile: true,
    },
];

export const VIEWPORT_IDS: readonly string[] = VIEWPORTS.map((v) => v.id);
