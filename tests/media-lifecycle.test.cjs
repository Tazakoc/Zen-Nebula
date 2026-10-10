const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const source = fs.readFileSync("js/nebula.uc.js", "utf8");
const code =
  source.slice(
    source.indexOf("  class NebulaMediaCoverArtModule"),
    source.indexOf("  // ========== NebulaMenuModule"),
  ) + "\nthis.Module = NebulaMediaCoverArtModule;";
const timers = new Map();
let id = 0;
const document = {
  createElement() {
    return {
      style: {},
      remove() {
        this.removed = true;
      },
    };
  },
  querySelector() {
    return element;
  },
};
const context = {
  window: {},
  document,
  setTimeout(fn) {
    timers.set(++id, fn);
    return id;
  },
  clearTimeout(id) {
    timers.delete(id);
  },
};
vm.createContext(context);
vm.runInContext(code, context);
let mod = new context.Module();
mod.init();
assert.equal(timers.size, 1);
const pending = [...timers.values()][0];
mod.destroy();
pending();
assert.equal(timers.size, 0);
assert.equal(mod.patches.length, 0);
mod = new context.Module();
mod.init();
let ticks = 0;
while (timers.size) {
  const [id, fn] = timers.entries().next().value;
  timers.delete(id);
  fn();
  ticks++;
  assert.ok(ticks <= 40);
}
assert.equal(ticks, 40);
mod.destroy();
const makeController = () => ({
  listeners: new Map(),
  artwork: [{ src: "https://example.invalid/cover.png", sizes: "100x100" }],
  addEventListener(k, fn) {
    this.listeners.set(k, fn);
  },
  removeEventListener(k, fn) {
    if (this.listeners.get(k) === fn) this.listeners.delete(k);
  },
  getMetadata() {
    return { artwork: this.artwork };
  },
});
const makeElement = () => ({
  isConnected: true,
  prepend(node) {
    this.overlay = node;
  },
});
const manager = {
  mediaControlBar: { children: [] },
  frontCard: null,
  activateMediaControls(controller) {
    const element = makeElement();
    this.mediaControlBar.children.push(element);
    this.frontCard = { controller, element };
    this.onCardVisibilityChanged();
    return 42;
  },
  onCardVisibilityChanged() {},
  onCardDestroyed() {},
};
const original = manager.activateMediaControls;
context.window.gZenMediaController = manager;
mod = new context.Module();
mod.init();
const a = makeController(),
  b = makeController();
assert.equal(manager.activateMediaControls(a), 42);
const first = manager.frontCard.element;
manager.activateMediaControls(b);
assert.equal(mod.entries.size, 2);
assert.equal(a.listeners.size, 2);
assert.match(first.overlay.style.backgroundImage, /cover.png/);
a.artwork = [];
a.listeners.get("metadatachange")();
assert.equal(mod.entries.get(a).overlay, null);
assert.equal(first.overlay.removed, true);
a.artwork = [{ src: "https://example.invalid/new.png", sizes: "300x300" }];
a.listeners.get("metadatachange")();
assert.match(first.overlay.style.backgroundImage, /new.png/);
manager.onCardDestroyed({ controller: a });
assert.equal(a.listeners.size, 0);
assert.equal(mod.entries.size, 1);
mod.destroy();
assert.equal(b.listeners.size, 0);
assert.equal(manager.activateMediaControls, original);
assert.equal(mod.entries.size, 0);
let element = makeElement();
const legacy = {
  setupMediaController(c) {
    this._currentMediaController = c;
  },
};
context.window.gZenMediaController = legacy;
mod = new context.Module();
mod.init();
legacy.setupMediaController(a);
legacy.setupMediaController(b);
assert.equal(a.listeners.size, 0);
assert.equal(b.listeners.size, 2);
mod.destroy();
assert.equal(b.listeners.size, 0);
console.log(
  "PASS media lifecycle: bounded/cancelled startup, stacked cards, metadata clearing, detach, legacy replacement, method restoration",
);
