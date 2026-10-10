const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync("js/nebula.uc.js", "utf8");
const code =
  source.slice(
    source.indexOf("  class NebulaPolyfillModule"),
    source.indexOf("  // ========== NebulaGradientSliderModule"),
  ) + "\nthis.Module = NebulaPolyfillModule;";
function fixture() {
  const timers = new Map();
  let next = 0,
    observers = 0,
    listeners = 0;
  const root = {
    style: { removeProperty() {} },
    removeAttribute() {},
    toggleAttribute() {},
    getAttribute() {},
    hasAttribute() {},
  };
  const context = {
    document: { documentElement: root },
    window: {},
    Nebula: { logger: { log() {}, warn() {} } },
    MutationObserver: class {
      constructor() {
        observers++;
      }
      observe() {}
      disconnect() {}
    },
    setInterval(fn) {
      timers.set(++next, fn);
      return next;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    setTimeout(fn) {
      timers.set(++next, fn);
      return next;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  const instance = new context.Module();
  instance.updateFaviconColor = () => {};
  return {
    instance,
    timers,
    context,
    counts: () => ({ observers, listeners }),
    ready() {
      context.gBrowser = context.window.gBrowser = {
        tabContainer: {
          addEventListener() {
            listeners++;
          },
          removeEventListener() {},
        },
      };
    },
    tick() {
      const jobs = [...timers.values()];
      timers.clear();
      jobs.forEach((fn) => fn());
    },
  };
}
(async () => {
  const cancelled = fixture();
  const pending = cancelled.instance.init();
  cancelled.instance.destroy();
  assert.equal(cancelled.timers.size, 0, "Destroy must cancel startup polling");
  await pending;
  cancelled.ready();
  cancelled.tick();
  assert.deepEqual(
    cancelled.counts(),
    { observers: 0, listeners: 0 },
    "Destroyed startup must never attach observers or listeners",
  );
  const delayed = fixture();
  const start = delayed.instance.init();
  delayed.ready();
  delayed.tick();
  await start;
  assert.deepEqual(delayed.counts(), { observers: 2, listeners: 2 });
  assert.equal(delayed.timers.size, 0);
  const incomplete = fixture();
  incomplete.context.window.gBrowser = {};
  const startPartial = incomplete.instance.init();
  incomplete.ready();
  incomplete.tick();
  await startPartial;
  assert.equal(
    incomplete.counts().listeners,
    2,
    "Wait for tabContainer as well as gBrowser",
  );
  const absent = fixture();
  const exhausted = absent.instance.init();
  for (let i = 0; i < 100; i++) absent.tick();
  assert.equal(absent.timers.size, 0, "Startup polling must be bounded");
  await exhausted;
  assert.equal(absent.counts().observers, 0);
  console.log(
    "PASS polyfill startup: delayed readiness, partial browser, cancellation and bounded retries",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
