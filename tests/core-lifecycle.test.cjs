const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync("js/nebula.uc.js", "utf8");
const coreCode = source.slice(
  source.indexOf("  window.Nebula = {"),
  source.indexOf("  // ========== NebulaPolyfillModule"),
);
function fixture(state = "loading") {
  const events = new Map(),
    unload = new Set(),
    errors = [];
  const document = {
    readyState: state,
    addEventListener(k, f) {
      events.set(k, f);
    },
    removeEventListener(k, f) {
      if (events.get(k) === f) events.delete(k);
    },
  };
  const window = {
    addEventListener(k, f) {
      unload.add(f);
    },
    removeEventListener(k, f) {
      unload.delete(f);
    },
  };
  const context = vm.createContext({
    window,
    document,
    console: {
      log() {},
      warn() {},
      error(e) {
        errors.push(e);
      },
    },
  });
  vm.runInContext(coreCode, context);
  return {
    core: window.Nebula,
    window,
    document,
    events,
    unload,
    errors,
    replace() {
      vm.runInContext(coreCode, context);
      return window.Nebula;
    },
  };
}
(async () => {
  const f = fixture();
  let starts = 0,
    stops = 0;
  class Pending {
    init() {
      starts++;
    }
    destroy() {
      stops++;
    }
  }
  f.core.register(Pending);
  f.core.init();
  const queued = f.events.get("DOMContentLoaded");
  f.core.destroy();
  assert.equal(
    f.events.size,
    0,
    "Destroy must remove deferred document initialization",
  );
  queued();
  assert.equal(
    starts,
    0,
    "A previously queued load callback must not revive destroyed modules",
  );
  const replacement = f.replace();
  f.core.destroy();
  assert.equal(
    f.window.Nebula,
    replacement,
    "An old unload callback must not delete the replacement theme",
  );
  assert.equal(stops, 1, "Module cleanup must run only once");
  assert.equal(f.unload.size, 0);
  const ready = fixture("complete");
  let readyStarts = 0;
  ready.core.register(
    class Ready {
      init() {
        readyStarts++;
      }
    },
  );
  ready.core.init();
  ready.core.init();
  assert.equal(
    readyStarts,
    1,
    "Repeated core init must not duplicate module listeners",
  );
  const loading = fixture();
  let lateStarts = 0;
  loading.core.init();
  loading.core.register(
    class Late {
      init() {
        lateStarts++;
      }
    },
  );
  assert.equal(
    lateStarts,
    0,
    "Modules registered while loading must wait for readiness",
  );
  loading.events.get("DOMContentLoaded")();
  assert.equal(lateStarts, 1);
  ready.core.register(
    class Broken {
      async init() {
        throw new Error("async startup failure");
      }
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    ready.errors.length,
    1,
    "Async init failures must be reported by the core",
  );
  assert.match(ready.errors[0], /async startup failure/);
  console.log(
    "PASS core lifecycle: deferred load cancellation, old-instance isolation, one-time startup and async error reporting",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
