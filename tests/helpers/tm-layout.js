import fs from 'node:fs';
import path from 'node:path';

const REAL_PANE = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/quickpicks-pane.html'), 'utf8');

// Heights of #quickpicks' children above the list (upsell banner, an empty
// button, the results/sort/chips block, the delivery note), as on the live site.
const HEADER_HEIGHTS = [50, 0, 130, 120];
const PANE_TOP = 100;

/**
 * The real layout chain around the real #quickpicks pane (see
 * tests/fixtures/ticketmaster-ie-layout-chain.json), in the jsdom document.
 * jsdom has no layout, so geometry is faked: the pane starts at y=100, the four
 * header blocks stack from there, and the list begins at y=400 (300px into the
 * pane) when the pane is scrolled to the top.
 *
 * `headerGeometry: false` leaves the header blocks with no size (as jsdom
 * would), which makes the layout look unpinnable.
 */
export function buildTicketmasterPage({ mainPosition = 'relative', headerGeometry = true } = {}) {
  document.body.innerHTML =
    '<div id="__next"><div class="row">' +
    '<aside aria-label="Seat Map">map</aside>' +
    `<main id="main-content" style="position:${mainPosition}"><div class="scroller" style="overflow-y:auto"><div id="list-view" style="display:contents">${REAL_PANE}</div></div></main>` +
    '</div></div>';
  const main = document.getElementById('main-content');
  const scroller = main.querySelector('.scroller');
  const quickpicks = document.getElementById('quickpicks');
  const wrapper = document.getElementById('quickpicks-list').parentElement;
  const blocks = Array.from(quickpicks.children).filter((child) => !child.contains(wrapper));

  const rect = (top, height) => ({ top, bottom: top + height, left: 0, right: 413, width: 413, height });
  main.getBoundingClientRect = () => rect(PANE_TOP, 846);
  scroller.getBoundingClientRect = () => rect(PANE_TOP, 846);

  let y = PANE_TOP;
  blocks.forEach((block, i) => {
    const height = headerGeometry ? HEADER_HEIGHTS[i] : 0;
    const top = y;
    block.getBoundingClientRect = () => rect(top - scroller.scrollTop, height);
    y += height;
  });
  const listTop = headerGeometry ? y : PANE_TOP + 300;
  wrapper.getBoundingClientRect = () => rect(listTop - scroller.scrollTop, 2000);

  return { main, scroller, wrapper, blocks, quickpicks };
}
