import { useEffect } from 'react';

/**
 * Defence in depth for the "app is frozen" class of bug.
 *
 * Radix's modal layers (menus, dialogs, selects) park `pointer-events: none`
 * on <body> while they are open and restore the previous value on close. If a
 * second layer mounts while the first is closing — which is exactly what
 * happens when a menu item's onSelect kicks off an async action that
 * re-renders the tree — the second layer captures "none" as the value to
 * restore, and <body> keeps it after every layer is gone. The renderer is
 * still running and repainting, but every click in the window is swallowed,
 * so it reads as a hard freeze that only a reload clears.
 *
 * The individual menus are non-modal now (see Sidebar.tsx), which removes the
 * known trigger. This guard catches anything that still slips through — a new
 * Radix primitive, a version bump, a dialog nested in a menu — by clearing the
 * lock once no layer is actually open. It only ever removes a lock that
 * nothing is asking for, so a legitimately open modal is left alone.
 */
export function usePointerEventsGuard(): void {
  useEffect(() => {
    const OPEN_LAYER_SELECTOR = [
      '[role="menu"]',
      '[role="dialog"]',
      '[role="alertdialog"]',
      '[role="listbox"]',
      '[data-radix-popper-content-wrapper]',
      '[data-state="open"][data-radix-menu-content]',
    ].join(',');

    let frame = 0;

    const check = (): void => {
      frame = 0;
      if (document.body.style.pointerEvents !== 'none') {
        return;
      }
      if (document.querySelector(OPEN_LAYER_SELECTOR)) {
        return;
      }
      document.body.style.removeProperty('pointer-events');
    };

    // Re-check on the frame after a mutation so Radix's own cleanup, which
    // runs in the same commit, always gets to go first.
    const schedule = (): void => {
      if (frame === 0) {
        frame = requestAnimationFrame(check);
      }
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });
    observer.observe(document.body, { childList: true });

    return () => {
      observer.disconnect();
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
    };
  }, []);
}
