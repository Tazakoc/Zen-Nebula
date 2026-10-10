const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const source = fs.readFileSync("js/nebula.uc.js", "utf8");
const code =
  source.slice(
    source.indexOf("  class NebulaGradientSliderModule"),
    source.indexOf("  // ========== NebulaTitlebarBackgroundModule"),
  ) + "\nthis.Module=NebulaGradientSliderModule;";
let slider,
  next = 0;
const timers = new Map(),
  properties = new Map();
const makeSlider = (value = "0") => ({
  value,
  attrs: new Map([["min", "0.1"]]),
  listeners: new Set(),
  get min() {
    return this.attrs.get("min");
  },
  set min(v) {
    this.attrs.set("min", String(v));
  },
  getAttribute(k) {
    return this.attrs.get(k) ?? null;
  },
  setAttribute(k, v) {
    this.attrs.set(k, v);
  },
  removeAttribute(k) {
    this.attrs.delete(k);
  },
  addEventListener(k, f) {
    this.listeners.add(f);
  },
  removeEventListener(k, f) {
    this.listeners.delete(f);
  },
});
const proto = {
  blendWithWhiteOverlay(color, opacity) {
    return `native:${this.name}:${opacity}`;
  },
};
const picker = Object.assign(Object.create(proto), { name: "first" }),
  second = Object.assign(Object.create(proto), { name: "second" });
const context = {
  window: { gZenThemePicker: picker },
  document: {
    documentElement: {
      style: {
        setProperty(k, v) {
          properties.set(k, v);
        },
        removeProperty(k) {
          properties.delete(k);
        },
      },
    },
    querySelector() {
      return slider;
    },
  },
  Nebula: { logger: { log() {}, error() {}, debug() {} } },
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
slider = makeSlider();
const firstSlider = slider,
  one = new context.Module();
one.init();
assert.equal(one._patched, true, "current picker instance must be patched");
assert.equal(
  picker.blendWithWhiteOverlay([10, 20, 30, 0.5], 0.5),
  "rgba(10,20,30,0)",
);
assert.equal(
  picker.blendWithWhiteOverlay("rgba(10, 20, 30, .5)", 0.5),
  "rgba(10,20,30,0)",
);
assert.equal(
  second.blendWithWhiteOverlay([1, 2, 3], 0.5),
  "native:second:0.5",
  "another window stays unaffected",
);
context.window = { gZenThemePicker: second };
slider = makeSlider(".5");
const two = new context.Module();
two.init();
assert.equal(second.blendWithWhiteOverlay([1, 2, 3], 0.5), "native:second:0.5");
assert.equal(picker.blendWithWhiteOverlay([1, 2, 3], 0.5), "rgba(1,2,3,0)");
one.destroy();
assert.equal(Object.hasOwn(picker, "blendWithWhiteOverlay"), false);
assert.equal(firstSlider.min, "0.1");
assert.equal(firstSlider.listeners.size, 0);
two.destroy();
context.window = {};
slider = null;
const waiting = new context.Module();
waiting.init();
const queued = [...timers.values()][0];
waiting.destroy();
queued();
assert.equal(timers.size, 0);
assert.equal(waiting._patched, false);
slider = makeSlider();
const delayed = new context.Module();
delayed.init();
assert.equal(timers.size, 1);
context.window.gZenThemePicker = picker;
const [id, fn] = timers.entries().next().value;
timers.delete(id);
fn();
assert.equal(delayed._patched, true);
delayed.destroy();
slider = makeSlider();
const chained = new context.Module();
chained.init();
const wrapped = picker.blendWithWhiteOverlay;
const external = function (...args) {
  return wrapped.apply(this, args);
};
picker.blendWithWhiteOverlay = external;
chained.destroy();
assert.equal(picker.blendWithWhiteOverlay, external);
assert.equal(picker.blendWithWhiteOverlay([1, 2, 3], 0.5), "native:first:0.5");
console.log(
  "PASS gradient picker: current API, per-window isolation, valid transparent colors, delayed initialization, cancellation and method restoration",
);
