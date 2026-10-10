import { describe, expect, it, vi } from 'vitest';
import { createQuantityDefault } from '../src/content/quantity-default.js';

/** A Ticketmaster page's quantity control, with the "2 Tickets" chip: presses take effect when the test says (or at once). */
function fakePage({ quantity = 2, control = true, stuck = false } = {}) {
  const page = {
    quantity,
    control,
    open: false,
    steps: [],
    closed: 0,
    pending: [],
    path: '/event/1',
    hasQuantityControl: () => page.control,
    getActiveQuantity: () => page.quantity,
    stepQuantity(delta, onStepped) {
      const target = page.quantity + delta;
      if (target < 1 || target > 8) return false;
      page.open = true;
      page.steps.push(delta);
      if (!stuck) page.quantity = target;
      page.pending.push(onStepped);
      return true;
    },
    closeQuantityControl() {
      page.closed += 1;
      page.open = false;
    },
    /** Ticketmaster has reacted to a press: the callbacks run. */
    settle() {
      const callbacks = page.pending.splice(0);
      callbacks.forEach((fn) => fn());
    },
  };
  return page;
}

const make = (page, clock = { t: 0 }) => {
  const log = vi.fn();
  const qd = createQuantityDefault({ tm: page, key: () => page.path, now: () => clock.t, log });
  return { qd, log, clock };
};

describe('setting the ticket quantity when a page loads', () => {
  it('does nothing while no quantity is asked for', () => {
    const page = fakePage();
    const { qd } = make(page);
    qd.tick();
    expect(page.steps).toEqual([]);
    expect(qd.pending()).toBe(false);
  });

  it('presses + until it is there, one press at a time (the page has to react to each), then closes the dropdown', () => {
    const page = fakePage({ quantity: 2 });
    const { qd, log } = make(page);
    qd.setDesired(4);
    expect(qd.pending()).toBe(true);
    qd.tick();
    expect(page.steps).toEqual([1]);
    qd.tick(); // (a press is in progress: nothing more yet)
    expect(page.steps).toEqual([1]);
    page.settle();
    expect(page.steps).toEqual([1, 1]);
    page.settle();
    expect(page.quantity).toBe(4);
    expect(page.closed).toBe(1);
    expect(qd.pending()).toBe(false);
    expect(log).toHaveBeenCalledWith('Ticket quantity set to 4.');
  });

  it('presses - to go down', () => {
    const page = fakePage({ quantity: 2 });
    const { qd } = make(page);
    qd.setDesired(1);
    qd.tick();
    page.settle();
    expect(page.steps).toEqual([-1]);
    expect(page.quantity).toBe(1);
    expect(qd.pending()).toBe(false);
  });

  it('is done at once, and presses nothing, when the page is at the quantity already', () => {
    const page = fakePage({ quantity: 3 });
    const { qd, log } = make(page);
    qd.setDesired(3);
    qd.tick();
    expect(page.steps).toEqual([]);
    expect(qd.pending()).toBe(false);
    expect(log).not.toHaveBeenCalled(); // nothing to say
  });

  it('applies once per page: a quantity chosen afterwards is left alone', () => {
    const page = fakePage({ quantity: 2 });
    const { qd } = make(page);
    qd.setDesired(4);
    qd.tick();
    page.settle();
    page.settle();
    expect(page.quantity).toBe(4);
    page.quantity = 6; // the user steps it themselves
    qd.tick();
    qd.tick();
    expect(page.steps).toEqual([1, 1]);
    expect(page.quantity).toBe(6);
  });

  it('gets another turn on another page reached without a reload (a different event)', () => {
    const page = fakePage({ quantity: 4 });
    const { qd } = make(page);
    qd.setDesired(4);
    qd.tick();
    expect(qd.pending()).toBe(false);
    page.path = '/event/2';
    page.quantity = 2; // Ticketmaster starts the new page at 2
    expect(qd.pending()).toBe(true);
    qd.tick();
    page.settle();
    page.settle();
    expect(page.quantity).toBe(4);
    expect(qd.pending()).toBe(false);
  });

  it('waits for the control to appear, and gives up after a while, saying so', () => {
    const page = fakePage({ quantity: 2, control: false });
    const { qd, log, clock } = make(page);
    qd.setDesired(4);
    qd.tick();
    clock.t = 5000;
    qd.tick();
    expect(qd.pending()).toBe(true);
    page.control = true;
    qd.tick();
    expect(page.steps).toEqual([1]);

    const late = fakePage({ control: false });
    const second = make(late);
    second.qd.setDesired(4);
    second.qd.tick();
    second.clock.t = 11000;
    second.qd.tick();
    expect(second.qd.pending()).toBe(false);
    expect(second.log).toHaveBeenCalledWith(expect.stringContaining('quantity control did not appear'));
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('did not appear'));
  });

  it('gives up if the control will not move, rather than pressing for ever', () => {
    const page = fakePage({ quantity: 2, stuck: true });
    const { qd, log } = make(page);
    qd.setDesired(5);
    qd.tick();
    page.settle();
    page.settle();
    expect(page.steps.length).toBeLessThanOrEqual(3);
    expect(qd.pending()).toBe(false);
    expect(page.closed).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('did not move from 2'));
  });

  it('stops if the page says no more (out of range)', () => {
    const page = fakePage({ quantity: 8 });
    const { qd, log } = make(page);
    qd.setDesired(8);
    qd.tick();
    expect(qd.pending()).toBe(false);
    const high = fakePage({ quantity: 8 });
    const second = make(high);
    second.qd.setDesired(3);
    for (let i = 0; i < 12; i++) { second.qd.tick(); high.settle(); }
    expect(high.quantity).toBe(3);
    expect(log).not.toHaveBeenCalled();
  });

  it('tells whoever is waiting once it is done, or at once if there is nothing to wait for', () => {
    const page = fakePage({ quantity: 2 });
    const { qd } = make(page);
    const early = vi.fn();
    qd.whenSettled(early); // nothing asked for: now
    expect(early).toHaveBeenCalledTimes(1);
    qd.setDesired(3);
    const late = vi.fn();
    qd.whenSettled(late);
    expect(late).not.toHaveBeenCalled();
    qd.tick();
    page.settle();
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('lets go of whoever is waiting if the quantity is switched off meanwhile', () => {
    const page = fakePage({ quantity: 2 });
    const { qd } = make(page);
    qd.setDesired(3);
    const waiter = vi.fn();
    qd.whenSettled(waiter);
    qd.setDesired(0);
    expect(waiter).toHaveBeenCalledTimes(1);
    expect(qd.pending()).toBe(false);
  });

  it('applies a new choice to the page that is open now', () => {
    const page = fakePage({ quantity: 2 });
    const { qd } = make(page);
    qd.setDesired(2);
    qd.tick();
    expect(qd.pending()).toBe(false);
    qd.setDesired(3);
    expect(qd.pending()).toBe(true);
    qd.tick();
    page.settle();
    expect(page.quantity).toBe(3);
  });

  it('ignores a quantity that is not a whole number above 0', () => {
    const page = fakePage();
    const { qd } = make(page);
    [-1, 0, 2.5, '3', null, undefined, NaN].forEach((v) => { qd.setDesired(v); expect(qd.pending()).toBe(false); });
  });
});
