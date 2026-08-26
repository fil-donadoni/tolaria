/**
 * Now-view click behaviour (#2630): a traffic light scrolls to its detail
 * section and highlights it, and a remedy command copies to the clipboard.
 *
 * DELEGATED, and installed exactly once. `renderLoopStatus` rewrites
 * `#loop-status-body`'s `innerHTML` on every poll whose payload changed, so a
 * listener bound to a light would be discarded with those nodes — and
 * re-binding per render leaks one listener per element per poll. Both
 * affordances are therefore one listener on the container, matched by
 * `closest()`. The nodes are disposable; the container is not. (Keyboard
 * FOCUS is the other thing that write would destroy — `now-loop-status.js`'s
 * `writeBodyPreservingFocus` carries that, PR #2837 review finding 1.)
 *
 * This is the only Now module that touches the DOM outside a function body's
 * lifetime, and even here nothing runs at import time: `initNowNav()` is
 * called by the transport module after the first render.
 */

/** How long a jumped-to section stays highlighted. */
const FLASH_MS = 1600;
/** How long "copied" replaces the button's label. */
const COPIED_MS = 1200;

const prefersReducedMotion = () =>
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

const flashTimers = new WeakMap();

/**
 * Scroll a section into view and mark it. The mark is a class, not an inline
 * style, so `dashboard.css` can drop the animation under
 * `prefers-reduced-motion` while keeping the (still necessary) static
 * outline — a jump with no visible landing point is exactly what the
 * highlight exists to prevent.
 */
export function jumpToSection(id) {
    const target = document.getElementById(id);
    if (!target) return false;
    target.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
    });
    clearTimeout(flashTimers.get(target));
    // Restart the animation on a repeated click: removing and re-adding in
    // the same frame is a no-op, so the reflow read between them is load-
    // bearing.
    target.classList.remove("ls-flash");
    void target.offsetWidth;
    target.classList.add("ls-flash");
    flashTimers.set(
        target,
        setTimeout(() => target.classList.remove("ls-flash"), FLASH_MS)
    );
    return true;
}

async function copyCommand(button) {
    const text = button.dataset.copy ?? "";
    const label = button.textContent;
    try {
        await navigator.clipboard.writeText(text);
        button.textContent = "copied";
    } catch {
        // A denied clipboard permission must not look like a successful copy.
        button.textContent = "copy failed";
    }
    setTimeout(() => {
        button.textContent = label;
    }, COPIED_MS);
}

let installed = false;

export function initNowNav(root = document.getElementById("loop-status-body")) {
    if (installed || !root) return;
    installed = true;
    root.addEventListener("click", (e) => {
        const light = e.target.closest?.(".ls-light");
        if (light) {
            jumpToSection(light.dataset.target);
            return;
        }
        const copy = e.target.closest?.(".ls-copy");
        if (copy) copyCommand(copy);
    });
}
