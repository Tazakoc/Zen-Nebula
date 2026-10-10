const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const source = fs.readFileSync("js/nebula.uc.js", "utf8");
const tab = (attrs = {}, lastAccessed = 0) => ({
  isConnected: true,
  closing: false,
  hidden: false,
  lastAccessed,
  hasAttribute: (n) => n in attrs,
});
const current = tab({ "zen-workspace-id": "a" }, 1),
  other = tab({ "zen-workspace-id": "b", pending: true }, 3),
  older = tab({ "zen-workspace-id": "a" }, 2),
  glance = tab({ "zen-glance-tab": true }, 8),
  empty = tab({ "zen-empty-tab": true }, 9),
  hidden = Object.assign(tab({}, 10), { hidden: true }),
  closing = Object.assign(tab({}, 11), { closing: true });
let opened = 0,
  removed = 0;
const originalGetter = () => [current],
  originalKey = () => {};
const switcher = {
  get tabList() {
    return originalGetter();
  },
  onKeyDown: originalKey,
  close() {},
  open() {
    opened++;
  },
  get tabCount() {
    return this.tabList.length;
  },
  KeyboardLockUtils: { mustWaitForKeyboardLockRequestedReply: () => false },
};
const context = {
  window: { ctrlTab: switcher },
  gBrowser: { selectedTab: current },
  document: {
    querySelectorAll: () => [
      current,
      other,
      older,
      glance,
      empty,
      hidden,
      closing,
    ],
    addEventListener() {},
    removeEventListener() {
      removed++;
    },
  },
  Services: { prefs: { getBoolPref: () => false } },
  ShortcutUtils: { CYCLE_TABS: 1, getSystemActionForEvent: () => 1 },
};
vm.createContext(context);
vm.runInContext(
  source.slice(
    source.indexOf("  class NebulaGlobalCtrlTabModule"),
    source.indexOf("  // Register Nebula Modules"),
  ) + "\nthis.Module= NebulaGlobalCtrlTabModule;",
  context,
);
const descriptor = Object.getOwnPropertyDescriptor(switcher, "tabList");
const mod = new context.Module();
mod.init();
assert.deepEqual(Array.from(switcher.tabList), [current, other, older]);
switcher.onKeyDown({ preventDefault() {}, stopPropagation() {} });
assert.equal(opened, 1, "Opens across workspaces even with one visible tab");
switcher.onKeyDown({ defaultPrevented: true });
assert.equal(opened, 1, "Preserves cancelled keyboard events");
mod.destroy();
assert.equal(
  Object.getOwnPropertyDescriptor(switcher, "tabList").get,
  descriptor.get,
);
assert.equal(switcher.onKeyDown, originalKey);
assert.equal(removed, 1);
mod.init();
const replacement = () => {};
switcher.onKeyDown = replacement;
mod.destroy();
assert.equal(
  switcher.onKeyDown,
  replacement,
  "Does not overwrite a later owner",
);
console.log(
  "PASS global Ctrl+Tab: MRU across workspaces, pending tabs, exclusions, keyboard guard and reload cleanup",
);
// Compact geometry must not grow with monitor resolution, and reload restores it.
let updates = 0;
switcher.previewsPerRow = 7;
switcher.canvasWidth = 300;
switcher.canvasHeight = 169;
const nativeOpen = () => "native-open";
switcher._openPanel = nativeOpen;
switcher.updatePreviews = () => updates++;
context.window.innerWidth = 1200;
context.window.screen = { availWidth: 3840 };
mod.init();
assert.equal(switcher._openPanel(), "native-open");
assert.equal(switcher.previewsPerRow, 4);
assert.equal(switcher.canvasWidth, 144);
assert.equal(switcher.canvasWidth * 1.25 * 4, 720);
context.window.innerWidth = 500;
switcher._openPanel();
assert.equal(switcher.previewsPerRow, 2);
assert.ok(switcher.canvasWidth * 1.25 * 2 <= 452);
assert.equal(updates, 2);
mod.destroy();
assert.equal(switcher._openPanel, nativeOpen);
assert.equal(switcher.previewsPerRow, 7);
console.log(
  "PASS compact geometry: wide monitor, narrow window and restoration",
);
