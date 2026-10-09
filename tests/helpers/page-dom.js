import fs from 'node:fs';
import path from 'node:path';

/** Replace the document body with an extension page's real markup (scripts not run). vitest runs from the project root. */
export function loadPageDom(file) {
  const html = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script').forEach((n) => n.remove());
  document.body.innerHTML = doc.body.innerHTML;
}

export const loadOptionsDom = () => loadPageDom('src/options/options.html');
