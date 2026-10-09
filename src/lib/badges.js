import { QUALITY_FILTERS } from './constants.js';
import { colorPair } from './custom-badges.js';
import { describeAttribute } from './quickpicks.js';
import { formatPrice } from './currency.js';
import { ordinal } from './sections.js';

// "🔥 Cheapest Overall" -> { icon: '🔥', label: 'Cheapest Overall' }; text with no leading emoji has no icon.
const ICON_RE = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s+(.*)$/u;

/**
 * A badge as plain data. `group` says where on the ticket it belongs: 'row' (next to the row), 'seat' (next
 * to the seats) or 'price' (before the price); `kind` which badge it is. `icon` / `label` are `text` split at
 * its leading emoji, for where only the icon is drawn.
 */
function badge(text, title, bg, color, group, kind) {
  const match = ICON_RE.exec(text);
  return { text, title, bg, color, group, kind, icon: match ? match[1] : '', label: match ? match[2] : text };
}

/** The badges of each group, in order: { row, seat, price }. */
export function groupBadges(badges) {
  const groups = { row: [], seat: [], price: [] };
  badges.forEach(function (b) { groups[b.group].push(b); });
  return groups;
}

const RESALE_RED = ['#fce8e6', '#c5221f'];
const GREEN = ['#e6f4ea', '#137333'];

/** Where the ticket's tier starts, written like its own row ("21", or "K" for lettered rows). */
function tierStartOf(ticket) {
  return ticket.tierStartName || ticket.tierStart;
}

/**
 * The visible badges for one ticket row, as plain { text, title, bg, color }.
 * Expects the ticket to have been annotated by buildSectionGroups.
 */
export function describeBadges(ticket, sectionName) {
  const flags = ticket.badges;
  const badges = [];

  if (flags.cheapest) {
    badges.push(badge('🔥 Cheapest Overall', 'Lowest priced ticket across the entire event listing', ...GREEN, 'price', 'cheapest'));
  } else if (flags.blockprice) {
    badges.push(badge('💡 Best Block Price', 'Lowest priced ticket available within this section', '#e8f0fe', '#1a73e8', 'price', 'blockprice'));
  }

  if (flags.firstrow) {
    badges.push(
      badge('🥇 1st Row', 'The first row of its tier (Row ' + tierStartOf(ticket) + ')', '#ffe9a8', '#7a5200', 'row', 'firstrow')
    );
  } else if (flags.frontrows) {
    const place = ordinal(ticket.rowIndex);
    badges.push(
      badge(
        '⭐ ' + place + ' Row',
        'Row ' + (ticket.rowName || ticket.row) + ' is the ' + place + ' row of its tier (which starts at Row ' + tierStartOf(ticket) + ')',
        '#fef7e0',
        '#b06000',
        'row',
        'frontrows'
      )
    );
  }

  if (typeof ticket.quality === 'number') badges.push(qualityBadge(ticket));

  (ticket.attributes || []).forEach(function (name) {
    const [bg, color] = colorPair('teal');
    const a = describeAttribute(name);
    badges.push(badge(a.text, 'Ticketmaster lists this ticket as: ' + a.label.toLowerCase(), bg, color, 'seat', 'attribute'));
  });

  (ticket.customMatches || []).forEach(function (m) {
    const [bg, color] = colorPair(m.color);
    badges.push(badge(m.text, 'Matches /' + m.pattern + '/', bg, color, 'seat', 'custom'));
  });

  if (ticket.isResale) badges.push(resaleBadge(ticket, sectionName));

  return badges;
}

const QUALITY_COLORS = { top10: ['#e8f0fe', '#1a73e8'], top25: ['#e0f7f4', '#0b6b5f'], top50: ['#e6f4ea', '#137333'], none: ['#f1f3f4', '#5f6368'] };

/**
 * The seat quality: which share of the event's tickets the score is in (the same Top 10% / 25% / 50% as the
 * Quality filter), with the score itself in brackets. A score in none of them is just "Quality (0.40)".
 */
function qualityBadge(ticket) {
  const score = ticket.quality.toFixed(2);
  const tier = QUALITY_FILTERS.find(function (f) { return f.key === ticket.qualityTier; });
  const [bg, color] = QUALITY_COLORS[tier ? tier.key : 'none'];
  if (!tier) return badge('Quality (' + score + ')', 'Ticketmaster\'s seat quality score for these seats: ' + score, bg, color, 'seat', 'quality');
  const share = tier.label.replace(/^\S+\s+Top\s+/, '');
  return badge(tier.label + ' (' + score + ')', 'Ticketmaster\'s seat quality score is ' + score + ': in the best ' + share + ' of this event\'s tickets', bg, color, 'seat', 'quality');
}

function resaleBadge(ticket, sectionName) {
  const intro = 'Fan-to-fan Verified Resale ticket';

  if (!ticket.baselinePrice || ticket.baselinePrice <= 0) {
    return badge('🔄 Resale', intro, ...RESALE_RED, 'price', 'resale');
  }

  const diff = ticket.price - ticket.baselinePrice;
  const against = 'standard primary tickets in Section ' + sectionName + ' (' + ticket.baselineSource + ')';
  const amount = formatPrice(Math.abs(diff), ticket.currency);

  if (diff > 0) {
    return badge('🔄 Resale (+' + amount + ')', intro + '. Priced ' + amount + ' higher than ' + against, ...RESALE_RED, 'price', 'resale');
  }
  if (diff < 0) {
    return badge('🔄 Resale (-' + amount + ')', intro + '. Priced ' + amount + ' lower than ' + against, ...GREEN, 'price', 'resale');
  }
  return badge(
    '🔄 Resale (Face Value)',
    intro + ' matching standard primary price in Section ' + sectionName + ' (' + ticket.baselineSource + ')',
    ...RESALE_RED,
    'price',
    'resale'
  );
}
