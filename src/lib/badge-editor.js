// An editor for a list of custom badges (see custom-badges.js), used both on the
// options page (the global badges, and each venue's) and in the view's venue panel.
// It draws no buttons of its own for saving: the host has a Save button and calls
// read() when it's pressed. Styling comes from the host's CSS (`.be-*` classes).
import { h } from './dom.js';
import {
  BADGE_COLORS,
  DEFAULT_COLOR,
  DEFAULT_ICON,
  MAX_BADGES,
  MAX_LABEL,
  MAX_PATTERN,
  checkPattern,
  lintPattern,
  matchesAny,
  newBadgeId,
  normalizeBadges,
} from './custom-badges.js';

export function createBadgeEditor() {
  let rows = []; // { id, node, icon, label, color, pattern, error, warn, count }
  let samples = []; // the tickets on the page, when the host has them, each a list of texts (see setSamples): patterns are counted against these

  const list = h('div', { class: 'be-list' });
  const addButton = h('button', { type: 'button', class: 'be-add', text: '+ Add badge', on: { click: function () { addRow(null, true); } } });
  const sampleText = h('div', {});
  const sampleTitle = h('div', {});
  const sample = h('div', { class: 'be-sample', hidden: true }, sampleText, sampleTitle);
  sample.hidden = true;
  const root = h('div', { class: 'be' }, list, addButton, sample);

  /** The note under a pattern: a warning if it looks like a mistake, and how many of the page's tickets it matches. */
  function refresh(row) {
    row.warn.textContent = lintPattern(row.pattern.value) || '';
    const checked = checkPattern(row.pattern.value);
    if (samples.length === 0 || checked.error) {
      row.count.textContent = '';
      return;
    }
    const n = samples.filter(function (texts) { return matchesAny(checked.regex, texts); }).length;
    row.count.textContent = n === 0 ? 'Matches none of the ' + samples.length + ' tickets here.' : 'Matches ' + n + ' of the ' + samples.length + ' tickets here.';
  }

  function syncAdd() {
    addButton.disabled = rows.length >= MAX_BADGES;
  }

  function addRow(badge, focus) {
    const id = badge ? badge.id : newBadgeId(rows.map(function (r) { return r.id; }));
    const icon = h('input', {
      type: 'text', class: 'be-icon', maxlength: '6', autocomplete: 'off', 'aria-label': 'Badge icon', placeholder: DEFAULT_ICON,
    });
    icon.value = badge ? badge.icon : DEFAULT_ICON;
    const label = h('input', {
      type: 'text', class: 'be-label', maxlength: String(MAX_LABEL), autocomplete: 'off', 'aria-label': 'Badge name', placeholder: 'Aisle',
    });
    label.value = badge ? badge.label : '';
    const color = h(
      'select',
      { class: 'be-color', 'aria-label': 'Badge colour' },
      Object.keys(BADGE_COLORS).map(function (name) { return h('option', { value: name, text: name }); })
    );
    color.value = badge ? badge.color : DEFAULT_COLOR;
    const pattern = h('input', {
      type: 'text', class: 'be-pattern', maxlength: String(MAX_PATTERN), autocomplete: 'off', spellcheck: 'false',
      'aria-label': 'Badge pattern', placeholder: 'Pattern, e.g. aisle|end of row',
    });
    pattern.value = badge ? badge.pattern : '';
    const error = h('div', { class: 'be-error', role: 'status' });
    const warn = h('div', { class: 'be-warn' });
    const count = h('div', { class: 'be-count' });

    const row = { id, icon, label, color, pattern, error, warn, count };
    row.node = h(
      'div',
      { class: 'be-row', 'data-badge-id': id },
      h(
        'div',
        { class: 'be-line' },
        icon,
        label,
        color,
        h('button', {
          type: 'button', class: 'be-remove', title: 'Remove this badge', 'aria-label': 'Remove badge', text: '✕',
          on: { click: function () { removeRow(row); } },
        })
      ),
      pattern,
      error,
      warn,
      count
    );
    [icon, label, pattern].forEach(function (input) {
      input.addEventListener('input', function () { clearError(row); });
    });
    pattern.addEventListener('input', function () { refresh(row); });
    refresh(row);

    rows.push(row);
    list.append(row.node);
    syncAdd();
    if (focus) label.focus();
    return row;
  }

  function removeRow(row) {
    rows = rows.filter(function (r) { return r !== row; });
    row.node.remove();
    syncAdd();
  }

  function setError(row, message) {
    row.error.textContent = message;
    [row.label, row.pattern].forEach(function (input) { input.removeAttribute('aria-invalid'); });
  }

  function clearError(row) {
    row.error.textContent = '';
    row.label.removeAttribute('aria-invalid');
    row.pattern.removeAttribute('aria-invalid');
  }

  return {
    root,

    /**
     * The tickets on the page, so each pattern can say how many it matches and an example of
     * the text being matched can be shown. Each is a string, or a list of strings that are
     * different ways of writing the same ticket (its text on Ticketmaster, its title in
     * Section View): a pattern matches the ticket if it matches any of them. Hosts without
     * tickets don't call this.
     */
    setSamples(tickets) {
      samples = (Array.isArray(tickets) ? tickets : [])
        .map(function (t) { return [].concat(t).filter(function (s) { return typeof s === 'string' && s; }); })
        .filter(function (texts) { return texts.length > 0; });
      sample.hidden = samples.length === 0;
      const [text, title] = samples.length > 0 ? samples[0] : [];
      sampleText.textContent = text ? 'A ticket\'s text on Ticketmaster: ' + text.slice(0, 160) : '';
      sampleTitle.textContent = title && title !== text ? 'As Section View lists it: ' + title.slice(0, 160) : '';
      rows.forEach(refresh);
    },

    /** Replace what's shown with these (saved) badges. */
    setBadges(badges) {
      rows = [];
      list.replaceChildren();
      normalizeBadges(badges).forEach(function (b) { addRow(b, false); });
      syncAdd();
    },

    /**
     * The badges as entered: { ok: true, badges } or { ok: false } after marking what's
     * wrong on the rows. Rows left completely blank are ignored.
     */
    read() {
      let ok = true;
      const badges = [];
      rows.forEach(function (row) {
        const label = row.label.value.trim();
        const pattern = row.pattern.value;
        clearError(row);
        if (!label && !pattern.trim()) return;

        const checked = checkPattern(pattern);
        if (!label) {
          setError(row, 'Give the badge a name.');
          row.label.setAttribute('aria-invalid', 'true');
          ok = false;
        } else if (checked.error) {
          setError(row, checked.error);
          row.pattern.setAttribute('aria-invalid', 'true');
          ok = false;
        } else {
          badges.push({ id: row.id, label, icon: row.icon.value.trim(), color: row.color.value, pattern });
        }
      });
      return ok ? { ok: true, badges: normalizeBadges(badges) } : { ok: false };
    },
  };
}
