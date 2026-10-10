const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync(
  require("node:path").join(__dirname, "../js/nebula.uc.js"),
  "utf8",
);
const start = source.indexOf("  class NebulaPDFStylesModule");
const end = source.indexOf("  // Register Nebula Modules", start);
let registered = false;
let loads = 0;
let removals = 0;
const service = {
  USER_SHEET: 1,
  sheetRegistered: () => registered,
  loadAndRegisterSheet() {
    registered = true;
    loads++;
  },
  unregisterSheet() {
    registered = false;
    removals++;
  },
};
const windows = [];
const context = {
  Cc: {
    "@mozilla.org/content/style-sheet-service;1": { getService: () => service },
  },
  Ci: { nsIStyleSheetService: {} },
  Services: {
    io: { newURI: (uri) => uri },
    wm: { getEnumerator: () => windows },
  },
};
vm.createContext(context);
vm.runInContext(
  source.slice(start, end) + "\nthis.Module = NebulaPDFStylesModule;",
  context,
);
const makeWindow = () => {
  const mod = new context.Module();
  mod._name = "NebulaPDFStylesModule";
  windows.push({ Nebula: { _modules: [mod] } });
  return mod;
};
const first = makeWindow();
const second = makeWindow();
first.init();
first.init();
second.init();
assert.equal(loads, 1, "Two windows share one registered sheet");
first.destroy();
assert.equal(
  registered,
  true,
  "Closing one window preserves the other window's PDF styles",
);
second.destroy();
assert.equal(registered, false, "Last owner removes the sheet");
second.destroy();
assert.equal(removals, 1, "Repeated cleanup is harmless");
first.init();
assert.equal(loads, 2, "Reloading after cleanup registers the sheet again");
first.destroy();
service.loadAndRegisterSheet = () => {
  throw new Error("load failed");
};
assert.throws(() => first.init(), /load failed/);
assert.equal(
  first._registered,
  false,
  "Failed initialization does not claim ownership",
);
first.destroy();
console.log("PDF stylesheet ownership and cleanup checks passed.");
