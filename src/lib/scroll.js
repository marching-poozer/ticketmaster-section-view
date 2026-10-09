/**
 * Bring `el` into view by scrolling the nearest scroller around it (looking out through shadow roots), and nothing
 * else: never the page itself. On a page taller than the window, scrolling the document moves everything (the map, the
 * header) which is not what anyone asked for. Returns whether a scroller was found.
 */
export function scrollIntoScroller(el) {
  const parentOf = function (node) {
    return node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
  };
  let node = parentOf(el);
  while (node && node !== document.body && node !== document.documentElement) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && node.scrollHeight > node.clientHeight) {
      const box = node.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      const margin = 8;
      let delta = 0;
      if (rect.top < box.top + margin) delta = rect.top - box.top - margin;
      else if (rect.bottom > box.bottom - margin) delta = Math.min(rect.bottom - box.bottom + margin, rect.top - box.top - margin);
      if (delta !== 0) {
        if (typeof node.scrollTo === 'function') node.scrollTo({ top: node.scrollTop + delta, behavior: 'smooth' });
        else node.scrollTop += delta;
      }
      return true;
    }
    node = parentOf(node);
  }
  return false;
}
