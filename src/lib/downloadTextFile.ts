/** Hands the viewer `text` as a file named `fileName` to save — a Blob URL
 *  clicked through a detached anchor, revoked right after. */
export function downloadTextFile(
    fileName: string,
    text: string,
    type = "application/json"
): void {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}
