import { createCapture } from '../src/content/capture.js';

const LIST = 'https://www.ticketmaster.ie/api/quickpicks/ABC/list?sort=price&offset=0&qty=2';

/** A PerformanceObserver you can push entries into. */
function fakeObserver() {
  const instances = [];
  class Observer {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      instances.push(this);
    }
    observe(options) {
      this.options = options;
    }
    disconnect() {
      this.disconnected = true;
    }
    push(...names) {
      this.callback({ getEntries: () => names.map((name) => ({ name })) });
    }
  }
  return { Observer, instances };
}

describe('capture', () => {
  it('watches resource timing, including what was already there', () => {
    const { Observer, instances } = fakeObserver();
    createCapture({ Observer }).start();
    expect(instances).toHaveLength(1);
    expect(instances[0].options).toEqual({ type: 'resource', buffered: true });
  });

  it('remembers the latest list request and ignores everything else', () => {
    const { Observer, instances } = fakeObserver();
    const capture = createCapture({ Observer });
    capture.start();
    expect(capture.latest()).toBeNull();

    instances[0].push('https://www.ticketmaster.ie/static/app.js', 'https://www.ticketmaster.ie/api/quickpicks/ABC/detail');
    expect(capture.latest()).toBeNull();

    instances[0].push(LIST);
    expect(capture.latest()).toBe(LIST);
    instances[0].push('https://www.ticketmaster.ie/img/a.png', LIST.replace('offset=0', 'offset=20'));
    expect(capture.latest()).toBe(LIST.replace('offset=0', 'offset=20'));
  });

  it('tells subscribers about each list request, until they unsubscribe', () => {
    const { Observer, instances } = fakeObserver();
    const capture = createCapture({ Observer });
    capture.start();
    const seen = [];
    const unsubscribe = capture.subscribe((url) => seen.push(url));
    instances[0].push(LIST);
    unsubscribe();
    instances[0].push(LIST.replace('qty=2', 'qty=3'));
    expect(seen).toEqual([LIST]);
  });

  it('is not stopped by a subscriber that throws', () => {
    const { Observer, instances } = fakeObserver();
    const capture = createCapture({ Observer });
    capture.start();
    const seen = [];
    capture.subscribe(() => { throw new Error('boom'); });
    capture.subscribe((url) => seen.push(url));
    instances[0].push(LIST);
    expect(seen).toEqual([LIST]);
  });

  it('starts once, and can be stopped', () => {
    const { Observer, instances } = fakeObserver();
    const capture = createCapture({ Observer });
    capture.start();
    capture.start();
    expect(instances).toHaveLength(1);
    capture.stop();
    expect(instances[0].disconnected).toBe(true);
  });

  it('does nothing where there is no resource timing, or it throws', () => {
    expect(() => createCapture({ Observer: null }).start()).not.toThrow();
    class Broken {
      observe() { throw new Error('unsupported type'); }
    }
    const capture = createCapture({ Observer: Broken });
    expect(() => capture.start()).not.toThrow();
    expect(capture.latest()).toBeNull();
  });
});
