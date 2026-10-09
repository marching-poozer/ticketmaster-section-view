// The manifest is easy to get quietly wrong: a module the content script imports but that is not
// listed as web-accessible fails to load in the browser, and nothing here would notice otherwise.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const files = (dir) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.js')).map((f) => `${dir}/${f}`);
const accessible = new Set(manifest.web_accessible_resources.flatMap((r) => r.resources));
const isAccessible = (file) => accessible.has(file) || accessible.has(path.dirname(file) + '/*.js');

describe('manifest', () => {
  it('lists every module the content scripts can import as web-accessible', () => {
    const classic = new Set(manifest.content_scripts.flatMap((c) => c.js));
    const modules = [...files('src/content'), ...files('src/lib')].filter((f) => !classic.has(f));
    const missing = modules.filter((f) => !isAccessible(f));
    expect(missing).toEqual([]);
  });

  it('only lists files that exist', () => {
    const concrete = [...accessible].filter((r) => !r.includes('*'));
    expect(concrete.filter((f) => !fs.existsSync(path.join(root, f)))).toEqual([]);
    manifest.content_scripts.forEach((c) => c.js.forEach((f) => expect(fs.existsSync(path.join(root, f))).toBe(true)));
  });

  it('starts watching the page\'s requests early, and loads the rest when the page is idle', () => {
    const byFile = Object.fromEntries(manifest.content_scripts.map((c) => [c.js[0], c.run_at]));
    expect(byFile['src/content/early.js']).toBe('document_start');
    expect(byFile['src/content/loader.js']).toBe('document_idle');
  });

  it('runs both on the same sites', () => {
    const [first, second] = manifest.content_scripts;
    expect(first.matches).toEqual(second.matches);
  });

  it('asks for no more than storage (settings) and contextMenus (the on/off item in the toolbar icon\'s menu)', () => {
    expect(manifest.permissions).toEqual(['storage', 'contextMenus']);
    expect(manifest.host_permissions).toBeUndefined();
  });
});
