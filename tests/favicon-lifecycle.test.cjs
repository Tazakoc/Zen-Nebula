const fs = require("fs");
const vm = require("vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync(
  require("node:path").join(__dirname, "../js/nebula.uc.js"),
  "utf8",
);
const start = source.indexOf("  class NebulaPolyfillModule");
const end = source.indexOf("  // ========== NebulaGradientSliderModule", start);
const timers = new Map();
let nextTimer = 0;
const colors = new Map();
const selected = { getAttribute: () => "data:image/png;base64,test" };
const root = {
  style: {
    setProperty: (k, v) => colors.set(k, v),
    removeProperty: (k) => colors.delete(k),
  },
  removeAttribute() {},
};
const gBrowser = {
  selectedTab: selected,
  tabContainer: { removeEventListener() {} },
};
const images = [];
const context = {
  document: {
    documentElement: root,
    createElement: () => ({
      getContext: () => ({
        clearRect() {},
        drawImage() {},
        getImageData: () => ({ data: [255, 0, 0, 255] }),
      }),
    }),
  },
  gBrowser,
  window: { gBrowser },
  Image: class {
    constructor() {
      images.push(this);
    }
  },
  Nebula: { logger: { log() {} } },
  console,
  setTimeout: (fn) => {
    timers.set(++nextTimer, fn);
    return nextTimer;
  },
  clearTimeout: (id) => timers.delete(id),
};
vm.createContext(context);
vm.runInContext(
  source.slice(start, end) + "\nglobalThis.Module = NebulaPolyfillModule;",
  context,
);
const instance = new context.Module();
instance.updateFaviconColor({
  type: "TabAttrModified",
  target: {},
  detail: { changed: ["image"] },
});
const backgroundTimers = timers.size;
timers.clear();
instance.updateFaviconColor({ type: "TabSelect", target: selected });
const selectionTimers = timers.size;
instance.destroy();
const afterDestroy = timers.size;
console.log(
  JSON.stringify({ backgroundTimers, selectionTimers, afterDestroy }),
);
assert.equal(
  backgroundTimers,
  0,
  "Background-tab icons must not schedule selected-tab work",
);
assert.equal(selectionTimers, 1, "Selected-tab update should be scheduled");
assert.equal(afterDestroy, 0, "Destroy must cancel pending favicon work");
(async () => {
  const live = new context.Module();
  live.updateFaviconColor({ type: "TabSelect", target: selected });
  const fn = [...timers.values()][0];
  timers.clear();
  const pending = fn();
  gBrowser.selectedTab = { getAttribute: () => "" };
  live.updateFaviconColor({ type: "TabSelect", target: gBrowser.selectedTab });
  images.at(-1).onload();
  await pending;
  assert.equal(
    colors.size,
    0,
    "An older icon must not recolor an iconless selected tab",
  );
  gBrowser.selectedTab = selected;
  live.updateFaviconColor({ type: "TabSelect", target: selected });
  const fn2 = [...timers.values()][0];
  timers.clear();
  const pending2 = fn2();
  live.destroy();
  images.at(-1).onload();
  await pending2;
  assert.equal(
    colors.size,
    0,
    "In-flight work must not recolor the UI after unload",
  );
  const active = new context.Module();
  active.updateFaviconColor({ type: "TabSelect", target: selected });
  const fn3 = [...timers.values()][0];
  timers.clear();
  const pending3 = fn3();
  images.at(-1).onload();
  await pending3;
  assert.equal(
    colors.get("--nebula-selected-favicon-color"),
    "rgb(255, 0, 0)",
    "Current icon still sets its color",
  );
  active.destroy();
  console.log(
    "Selected icon, stale completion, iconless selection and unload checks passed.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
