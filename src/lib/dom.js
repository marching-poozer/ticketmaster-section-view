/**
 * Tiny element builder: h('div', { class: 'x', text: 'hi', on: { click } }, ...children).
 * Text goes in via textContent / text nodes, never innerHTML.
 */
export function h(tag, props, ...children) {
  const node = document.createElement(tag);
  Object.entries(props || {}).forEach(function ([key, value]) {
    if (value == null) return;
    if (key === 'text') node.textContent = value;
    else if (key === 'on') Object.entries(value).forEach(function ([evt, fn]) { node.addEventListener(evt, fn); });
    else node.setAttribute(key, value);
  });
  node.append(...children.flat().filter(function (c) { return c != null && c !== false; }));
  return node;
}
