const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync(
  require("node:path").join(__dirname, "../js/nebula.uc.js"),
  "utf8",
);
const start = source.indexOf("  class NebulaMenuModule");
const end = source.indexOf(
  "  // Reserve space for wrapped pinned widgets",
  start,
);
const frames = new Map(),
  timers = new Map(),
  observers = [];
let next = 1,
  enabled = true,
  reduced = false,
  rectReads = 0;
const classes = new Set();
const item = {
  nodeType: 1,
  localName: "menuitem",
  style: { animationDelay: "" },
  classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
  matches: () => false,
  getBoundingClientRect: () => {
    rectReads++;
    return { width: 80, height: 20 };
  },
};
const popup = {
  localName: "menupopup",
  children: [item],
  classList: { contains: () => false },
  querySelector: () => null,
  querySelectorAll: () => (classes.size ? [item] : []),
};
const doc = {
  documentElement: {},
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll: () => (classes.size ? [item] : []),
};
const context = {
  document: doc,
  window: {
    requestAnimationFrame: (f) => {
      const id = next++;
      frames.set(id, f);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    matchMedia: () => ({ matches: reduced }),
  },
  getComputedStyle: () => ({
    getPropertyValue: () => (enabled ? "true" : "false"),
    display: "block",
  }),
  setTimeout: (f) => {
    const id = next++;
    timers.set(id, f);
    return id;
  },
  clearTimeout: (id) => timers.delete(id),
  MutationObserver: class {
    constructor(cb) {
      this.cb = cb;
      observers.push(this);
    }
    observe() {}
    disconnect() {}
  },
  Nebula: { logger: { log() {} } },
};
const flush = (map) => {
  const jobs = [...map.values()];
  map.clear();
  jobs.forEach((f) => f());
};
vm.createContext(context);
vm.runInContext(
  source.slice(start, end) + "\nthis.Module=NebulaMenuModule;",
  context,
);
const mod = new context.Module();
mod.init();
mod.handlePopupShowing({ target: popup });
mod.destroy();
flush(frames);
flush(timers);
flush(frames);
assert.equal(
  classes.size,
  0,
  "Destroy must not let a queued animation re-add classes",
);
mod.init();
mod.handlePopupShowing({ target: popup });
flush(frames);
assert.equal(classes.size, 1, "Enabled popup items animate");
const observer = observers.at(-1);
for (let i = 0; i < 20; i++)
  observer.cb([{ type: "childList", addedNodes: [item] }]);
assert.equal(timers.size, 1, "Mutation bursts share one pending update");
mod.handlePopupHidden({ target: popup });
assert.equal(timers.size, 0, "Closing cancels pending timers");
flush(frames);
flush(timers);
flush(frames);
assert.equal(classes.size, 0, "Closed menu remains clean");
assert.equal(mod.observers.size, 0);
enabled = false;
rectReads = 0;
mod.handlePopupShowing({ target: popup });
flush(frames);
assert.equal(rectReads, 0, "Disabled animations must not measure menu items");
assert.equal(
  mod.observers.size,
  0,
  "Disabled animations do not attach observers",
);
enabled = true;
reduced = true;
mod.handlePopupShowing({ target: popup });
flush(frames);
assert.equal(classes.size, 0, "Reduced motion skips menu entrance animation");
assert.equal(mod.observers.size, 0);
mod.destroy();
console.log(
  "Menu lifecycle, mutation coalescing and reduced-motion checks passed.",
);
