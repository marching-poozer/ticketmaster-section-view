import { describeBadges, groupBadges } from '../src/lib/badges.js';

function annotated(overrides = {}, flags = {}) {
  return {
    row: 10,
    price: 100,
    currency: '€',
    type: 'standard',
    isResale: false,
    badges: {
      cheapest: false,
      blockprice: false,
      firstrow: false,
      frontrows: false,
      resale: false,
      markup: false,
      ...flags,
    },
    ...overrides,
  };
}

const texts = (badges) => badges.map((b) => b.text);

describe('where each badge goes', () => {
  const find = (badges, text) => badges.find((b) => b.text === text);

  it('puts the cheapest, best-in-block and resale badges with the price', () => {
    const cheap = describeBadges(annotated({}, { cheapest: true }), '101');
    expect(find(cheap, '🔥 Cheapest Overall').group).toBe('price');
    expect(find(describeBadges(annotated({}, { blockprice: true }), '101'), '💡 Best Block Price').group).toBe('price');
    const resale = describeBadges(annotated({ isResale: true, baselinePrice: 80, price: 100, baselineSource: 'Row 10' }), '101');
    expect(resale.find((b) => b.text.startsWith('🔄')).group).toBe('price');
  });

  it('puts the first / front row badge with the row', () => {
    const t = annotated({ tierStart: 1, rowIndex: 1, row: 1 }, { firstrow: true });
    expect(find(describeBadges(t, '101'), '🥇 1st Row').group).toBe('row');
  });

  it('puts the quality, attributes and the user\'s own badges with the seats', () => {
    const t = annotated({ quality: 0.5, attributes: ['aisle'], customMatches: [{ key: 'custom:a', text: '🔖 X', color: 'blue', pattern: 'x' }] });
    const badges = describeBadges(t, '101');
    ['Quality (0.50)', '🚶 Aisle', '🔖 X'].forEach((text) => expect(find(badges, text).group).toBe('seat'));
  });

  it('can be split into those groups, keeping the order', () => {
    const t = annotated({ tierStart: 1, rowIndex: 1, row: 1, quality: 0.5, attributes: ['aisle'] }, { cheapest: true, firstrow: true });
    const groups = groupBadges(describeBadges(t, '101'));
    expect(groups.row.map((b) => b.text)).toEqual(['🥇 1st Row']);
    expect(groups.seat.map((b) => b.text)).toEqual(['Quality (0.50)', '🚶 Aisle']);
    expect(groups.price.map((b) => b.text)).toEqual(['🔥 Cheapest Overall']);
  });

  it('gives every badge its icon and label separately, for where only the icon is drawn', () => {
    const t = annotated({ isResale: true, baselinePrice: 80, price: 100, baselineSource: 'Row 10', quality: 0.5 }, { cheapest: true });
    const badges = describeBadges(t, '101');
    expect(find(badges, '🔥 Cheapest Overall')).toMatchObject({ icon: '🔥', label: 'Cheapest Overall' });
    expect(badges.find((b) => b.text.startsWith('🔄'))).toMatchObject({ icon: '🔄', label: 'Resale (+€20.00)' });
    const tagged = describeBadges(annotated({ customMatches: [{ key: 'custom:t', text: '🏷️ Tag', color: 'blue', pattern: 't' }] }), '101');
    expect(find(tagged, '🏷️ Tag')).toMatchObject({ icon: '🏷️', label: 'Tag' }); // an emoji with a variation selector
    expect(find(badges, 'Quality (0.50)')).toMatchObject({ icon: '', label: 'Quality (0.50)' }); // no emoji, no icon
  });
});

describe('the quality badge', () => {
  const badgeFor = (quality, qualityTier) => describeBadges(annotated({ quality, qualityTier }), '101')[0];

  it('is its share of the event\'s tickets, with the score in brackets', () => {
    expect(badgeFor(0.97, 'top10').text).toBe('💎 Top 10% (0.97)');
    expect(badgeFor(0.85, 'top25').text).toBe('🌟 Top 25% (0.85)');
    expect(badgeFor(0.62, 'top50').text).toBe('✨ Top 50% (0.62)');
  });

  it('is just the score for one in none of them', () => {
    expect(badgeFor(0.4, null).text).toBe('Quality (0.40)');
    expect(badgeFor(0.4, undefined).text).toBe('Quality (0.40)');
  });

  it('shows two decimals, however the score came', () => {
    expect(badgeFor(0.5, null).text).toBe('Quality (0.50)');
    expect(badgeFor(1, 'top10').text).toBe('💎 Top 10% (1.00)');
    expect(badgeFor(0.123456, null).text).toBe('Quality (0.12)');
  });

  it('says what the score is on hover', () => {
    expect(badgeFor(0.97, 'top10').title).toBe('Ticketmaster\'s seat quality score is 0.97: in the best 10% of this event\'s tickets');
    expect(badgeFor(0.4, null).title).toBe('Ticketmaster\'s seat quality score for these seats: 0.40');
  });

  it('has a colour of its own for each, and a plain one for none', () => {
    const colours = ['top10', 'top25', 'top50', null].map((tier) => badgeFor(0.5, tier).bg);
    expect(new Set(colours).size).toBe(4);
  });

  it('is not there for a ticket with no score (read from a card)', () => {
    expect(describeBadges(annotated(), '101').some((b) => b.text.includes('Quality'))).toBe(false);
    expect(describeBadges(annotated({ quality: null }), '101').some((b) => b.text.includes('Quality'))).toBe(false);
  });
});

describe('attribute badges', () => {
  it('shows each attribute the list API gave the ticket, with an icon where there is one', () => {
    const t = annotated({ attributes: ['aisle', 'limitedView'] });
    const found = describeBadges(t, '101');
    expect(found.map((b) => b.text)).toEqual(['🚶 Aisle', '🔹 Limited view']);
    expect(found[0].title).toBe('Ticketmaster lists this ticket as: aisle');
  });

  it('comes after the row badges and before custom ones', () => {
    const t = annotated(
      { tierStart: 21, rowIndex: 1, row: 21, attributes: ['aisle'], customMatches: [{ key: 'custom:a1', text: '🔖 X', color: 'blue', pattern: 'x' }] },
      { firstrow: true }
    );
    expect(texts(describeBadges(t, '101'))).toEqual(['🥇 1st Row', '🚶 Aisle', '🔖 X']);
  });

  it('shows nothing for a ticket with none', () => {
    expect(texts(describeBadges(annotated({ attributes: [] }), '101'))).toEqual([]);
    expect(texts(describeBadges(annotated(), '101'))).toEqual([]);
  });
});

describe('custom badges', () => {
  const aisle = { key: 'custom:a1', text: '🚶 Aisle', color: 'blue', pattern: 'aisle' };

  it('shows one badge per match, in its colour, with the pattern as the tooltip', () => {
    const [badge] = describeBadges(annotated({ customMatches: [aisle] }), '101');
    expect(badge.text).toBe('🚶 Aisle');
    expect(badge.title).toBe('Matches /aisle/');
    expect([badge.bg, badge.color]).toEqual(['#e8f0fe', '#1a73e8']);
  });

  it('puts them after the row badges and before resale', () => {
    const t = annotated({ tierStart: 21, rowIndex: 1, row: 21, customMatches: [aisle] }, { firstrow: true });
    expect(texts(describeBadges(t, '101'))).toEqual(['🥇 1st Row', '🚶 Aisle']);
  });

  it('shows nothing extra for a ticket with no matches', () => {
    expect(texts(describeBadges(annotated({ customMatches: [] }), '101'))).toEqual([]);
  });
});

describe('badges for lettered rows', () => {
  it('names the row and where its tier starts in letters', () => {
    const third = annotated({ row: 13, rowName: 'M', tierStart: 11, tierStartName: 'K', rowIndex: 3 }, { frontrows: true });
    const [badge] = describeBadges(third, '101');
    expect(badge.text).toBe('⭐ 3rd Row');
    expect(badge.title).toBe('Row M is the 3rd row of its tier (which starts at Row K)');

    const first = annotated({ row: 11, rowName: 'K', tierStart: 11, tierStartName: 'K', rowIndex: 1 }, { firstrow: true, frontrows: true });
    expect(describeBadges(first, '101')[0].title).toBe('The first row of its tier (Row K)');
  });

  it('still reads for numbered rows', () => {
    const t = annotated({ row: 23, rowName: '23', tierStart: 21, tierStartName: '21', rowIndex: 3 }, { frontrows: true });
    expect(describeBadges(t, '101')[0].title).toBe('Row 23 is the 3rd row of its tier (which starts at Row 21)');
  });
});

describe('describeBadges', () => {
  it('shows nothing for a plain primary ticket: a ticket that is not resale is at face value, so there is nothing to say', () => {
    expect(describeBadges(annotated(), '101')).toEqual([]);
    expect(texts(describeBadges(annotated({ type: 'standard', isResale: false }), '101')).some((t) => /Face Value/.test(t))).toBe(false);
  });

  it('shows cheapest overall in preference to best block price', () => {
    const badges = describeBadges(annotated({}, { cheapest: true, blockprice: true }), '101');
    expect(texts(badges)).toEqual(['🔥 Cheapest Overall']);
  });

  it('shows best block price when not cheapest overall', () => {
    expect(texts(describeBadges(annotated({}, { blockprice: true }), '101'))[0]).toBe('💡 Best Block Price');
  });

  it('has no "Options in Row" badge, however many tickets share the row: the row heading\'s count says it', () => {
    const badges = describeBadges(annotated({ rowCount: 3 }, { rowoptions: true }), '101');
    expect(texts(badges)).toEqual([]);
    expect(describeBadges(annotated({ rowCount: 3 }, { rowoptions: true, firstrow: true }), '101').some((b) => /Options in Row/.test(b.text))).toBe(false);
  });

  describe('front rows', () => {
    it('marks the first row of a tier, and says which row that is', () => {
      const [badge] = describeBadges(annotated({ row: 21, rowIndex: 1, tierStart: 21 }, { firstrow: true, frontrows: true }), '101').filter((b) => b.text.includes('1st'));
      expect(badge.text).toBe('🥇 1st Row');
      expect(badge.title).toBe('The first row of its tier (Row 21)');
    });

    it('shows only the 1st-row badge on a first row, not also a front-rows one', () => {
      const badges = describeBadges(annotated({ row: 33, rowIndex: 1, tierStart: 33 }, { firstrow: true, frontrows: true }), '101');
      expect(texts(badges).filter((t) => /Row$/.test(t) && !t.includes('Options'))).toEqual(['🥇 1st Row']);
    });

    it('marks the other front rows by their place in the tier, with the real row in the tooltip', () => {
      const badges = describeBadges(annotated({ row: 23, rowIndex: 3, tierStart: 21 }, { frontrows: true }), '101');
      expect(badges[0].text).toBe('⭐ 3rd Row');
      expect(badges[0].title).toBe('Row 23 is the 3rd row of its tier (which starts at Row 21)');
    });

    it('says nothing about rows further back', () => {
      const badges = describeBadges(annotated({ row: 30, rowIndex: 10, tierStart: 21 }), '101');
      expect(texts(badges)).toEqual([]);
    });
  });

  describe('resale', () => {
    const resale = (overrides) =>
      describeBadges(annotated({ isResale: true, ...overrides }, { resale: true }), '101')[0];

    it('shows the markup over the baseline', () => {
      const b = resale({ price: 125.5, baselinePrice: 100, baselineSource: 'Row 10' });
      expect(b.text).toBe('🔄 Resale (+€25.50)');
      expect(b.title).toBe(
        'Fan-to-fan Verified Resale ticket. Priced €25.50 higher than standard primary tickets in Section 101 (Row 10)'
      );
      expect(b.color).toBe('#c5221f');
    });

    it('shows a discount in green', () => {
      const b = resale({ price: 80, baselinePrice: 100, baselineSource: 'Row 9' });
      expect(b.text).toBe('🔄 Resale (-€20.00)');
      expect(b.title).toContain('lower than');
      expect(b.color).toBe('#137333');
    });

    it('shows face value when the price matches the baseline', () => {
      const b = resale({ price: 100, baselinePrice: 100, baselineSource: 'Row 10' });
      expect(b.text).toBe('🔄 Resale (Face Value)');
    });

    it('shows a plain badge when there is nothing to compare to', () => {
      expect(resale({ price: 100 }).text).toBe('🔄 Resale');
    });

    it('uses the ticket currency in the amount', () => {
      const b = resale({ price: 130, currency: '£', baselinePrice: 100, baselineSource: 'Row 10' });
      expect(b.text).toBe('🔄 Resale (+£30.00)');
    });

    it('is the only price badge a resale ticket has (apart from being cheapest or best in its block)', () => {
      const badges = describeBadges(annotated({ isResale: true, baselinePrice: 100, baselineSource: 'Row 10' }, { resale: true }), '101');
      expect(texts(badges).some((t) => t.includes('🏷️'))).toBe(false);
      expect(badges).toHaveLength(1);
    });
  });
});
