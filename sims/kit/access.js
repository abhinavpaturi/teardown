// Two things a visitor shouldn't have to ask for: controls that work from the keyboard, and a page that holds still when they've
// told their system to reduce motion. kit/shell.js does both for you; a page with its own loop calls these.
export const prefersStill = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Everything under root that shows a pointer cursor becomes a button to a screen reader and the Tab key. Call it once the console exists. */
export function enableKeyboard(root) {
  const style = document.createElement('style');
  style.textContent = '[role=button]:focus-visible,button:focus-visible{outline:2px solid currentColor;outline-offset:2px}';
  document.head.appendChild(style);
  const pointer = (el) => getComputedStyle(el).cursor === 'pointer';
  for (const el of root.querySelectorAll('*')) {
    if (!pointer(el) || el.matches('button,a[href],input,select,textarea,summary,label') || (el.parentElement && pointer(el.parentElement))) continue;
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
  }
  root.addEventListener('keydown', (e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.altKey || e.ctrlKey || e.metaKey) return;
    const el = e.target.closest?.('[role=button]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    // the kit's controls listen for either a press or a click, and a press is what hands the page over from the tour
    for (const type of ['pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true}));
    el.click();
  });
}
