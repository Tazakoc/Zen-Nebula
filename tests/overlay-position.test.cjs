const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const source = fs.readFileSync("js/nebula.uc.js", "utf8");
const context = { window: {}, document: {}, console };
vm.createContext(context);
vm.runInContext(
  source.slice(
    source.indexOf("  window.Nebula = {"),
    source.indexOf("  // ========== NebulaPolyfillModule"),
  ),
  context,
);
const container = {
  getBoundingClientRect: () => ({ top: 0, left: 0 }),
  clientTop: 1,
  clientLeft: 0,
  scrollTop: 0,
  scrollLeft: 0,
};
let position = context.window.Nebula.getOverlayPosition(
  { top: 13, left: 12 },
  container,
);
assert.equal(
  position.top,
  "12px",
  "Subtract the native browser top border to avoid the observed one-pixel seam",
);
assert.equal(position.left, "12px");
container.getBoundingClientRect = () => ({ top: 20, left: 30 });
container.clientTop = 2;
container.clientLeft = 3;
container.scrollTop = 5;
container.scrollLeft = 7;
position = context.window.Nebula.getOverlayPosition(
  { top: 100, left: 200 },
  container,
);
assert.equal(position.top, "83px");
assert.equal(position.left, "174px");
console.log(
  "PASS overlay positioning: native border, displaced container and scroll offsets",
);
