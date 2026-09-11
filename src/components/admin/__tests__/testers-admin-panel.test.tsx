// `/admin/testers` — the page that grants the role a Verdict comes from
// (issue #3402, PRD #3397, ADR 0124 §1).
//
// The assertion worth having here is the ADMIN ROW. An admin may give Verdicts
// whether or not the flag is set, so a control bound to the EFFECTIVE role
// would render "Revoke", write `false`, and render "Revoke" again — the shape
// of bug that looks like a broken button and is really two questions wearing
// one name. The button must always state the FLAG, and the row must say in
// words why the flag does not decide for an admin.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TestersAdminPanel from "../testers-admin-panel";

const setTesterRole = vi.fn();
let rows: unknown;

vi.mock("convex/react", () => ({
    useQuery: (query: { _name: string }) =>
        query._name === "listUserRoles" ? rows : undefined,
    useMutation: (fn: { _name: string }) =>
        fn._name === "setTesterRole" ? setTesterRole : vi.fn(),
}));

vi.mock("@convex/_generated/api", () => {
    const leaf = (name: string): unknown =>
        new Proxy(
            { _name: name },
            {
                get: (target, prop) =>
                    prop === "_name" || typeof prop === "symbol"
                        ? Reflect.get(target, prop)
                        : leaf(String(prop)),
            }
        );
    return { api: leaf("") };
});

const ROWS = [
    {
        _id: "u-admin",
        nickname: "Ada",
        email: "ada@example.com",
        isAdmin: true,
        isTester: true,
        testerFlag: false,
    },
    {
        _id: "u-tester",
        nickname: "Tessa",
        isAdmin: false,
        isTester: true,
        testerFlag: true,
    },
    {
        _id: "u-plain",
        nickname: "Plain",
        isAdmin: false,
        isTester: false,
        testerFlag: false,
    },
];

beforeEach(() => {
    setTesterRole.mockReset();
    setTesterRole.mockResolvedValue(null);
    rows = ROWS;
});

describe("TestersAdminPanel (issue #3402)", () => {
    it("counts the accounts that may give Verdicts", () => {
        render(<TestersAdminPanel />);
        expect(screen.getByText("2 of 3 may give Verdicts")).toBeTruthy();
    });

    it("states the FLAG on every button, including an admin's", () => {
        render(<TestersAdminPanel />);
        // Ada is an admin with the flag off: she may give Verdicts, and the
        // button still offers to GRANT — because that is what it writes.
        expect(screen.getAllByText("Grant tester")).toHaveLength(2);
        expect(screen.getAllByText("Revoke tester")).toHaveLength(1);
        expect(
            screen.getByText(
                "May give Verdicts — every admin is a tester, flag or not"
            )
        ).toBeTruthy();
        expect(screen.getByText("May not give Verdicts")).toBeTruthy();
    });

    it("writes the NEGATION of the flag, not of the effective role", async () => {
        render(<TestersAdminPanel />);
        fireEvent.click(screen.getAllByText("Grant tester")[0]);
        await waitFor(() =>
            expect(setTesterRole).toHaveBeenCalledWith({
                userId: "u-admin",
                isTester: true,
            })
        );
    });

    it("revokes from an account that carries the flag", async () => {
        render(<TestersAdminPanel />);
        fireEvent.click(screen.getByText("Revoke tester"));
        await waitFor(() =>
            expect(setTesterRole).toHaveBeenCalledWith({
                userId: "u-tester",
                isTester: false,
            })
        );
    });

    it("disables the button while the mutation is in flight", async () => {
        let release: () => void = () => {};
        setTesterRole.mockImplementation(
            () =>
                new Promise<null>((resolve) => {
                    release = () => resolve(null);
                })
        );
        render(<TestersAdminPanel />);
        const button = screen.getByText("Revoke tester");
        fireEvent.click(button);
        const saving = await screen.findByText("Saving…");
        expect((saving.closest("button") as HTMLButtonElement).disabled).toBe(
            true
        );
        release();
        await waitFor(() =>
            expect(screen.getByText("Revoke tester")).toBeTruthy()
        );
    });

    it("surfaces a refused write instead of swallowing it", async () => {
        setTesterRole.mockRejectedValue(new Error("Forbidden: admin only"));
        render(<TestersAdminPanel />);
        fireEvent.click(screen.getByText("Revoke tester"));
        expect(await screen.findByText("Forbidden: admin only")).toBeTruthy();
    });

    it("says so while the roster is loading", () => {
        rows = undefined;
        render(<TestersAdminPanel />);
        expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
    });
});
