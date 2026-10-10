// ==UserScript==
// @name           nebula.uc.js
// @description    Central engine for Nebula with all modules
// @author         JustAdumbPrsn
// @version        v3.4
// @include        main
// @grant          none
// ==/UserScript==

(function () {
  "use strict";

  if (window.Nebula) {
    try {
      window.Nebula.destroy();
    } catch {}
  }

  window.Nebula = {
    _modules: [],
    _initialized: false,

    logger: {
      _prefix: "[Nebula]",
      log(msg) {
        console.log(`${this._prefix} ${msg}`);
      },
      warn(msg) {
        console.warn(`${this._prefix} ${msg}`);
      },
      error(msg) {
        console.error(`${this._prefix} ${msg}`);
      },
    },

    runOnLoad(callback) {
      if (document.readyState === "complete") callback();
      else
        document.addEventListener("DOMContentLoaded", callback, { once: true });
    },

    register(ModuleClass) {
      const name = ModuleClass?.name || "UnnamedModule";
      if (!ModuleClass) {
        this.logger.warn(
          `Module "${name}" is not defined, skipping registration.`,
        );
        return;
      }
      if (this._modules.find((m) => m._name === name)) {
        this.logger.warn(`Module "${name}" already registered.`);
        return;
      }

      let instance;
      try {
        instance = new ModuleClass();
      } catch (err) {
        this.logger.error(`Module "${name}" failed to construct:\n${err}`);
        return; // skip this module, keep others running
      }

      instance._name = name;
      this._modules.push(instance);

      if (this._initialized && typeof instance.init === "function") {
        try {
          instance.init();
        } catch (err) {
          this.logger.error(`Module "${name}" failed to init:\n${err}`);
        }
      }
    },

    getModule(name) {
      return this._modules.find((m) => m._name === name);
    },

    init() {
      this.logger.log("⏳ Initializing core...");
      this._initialized = true;
      this.runOnLoad(() => {
        this._modules.forEach((m) => {
          try {
            m.init?.();
          } catch (err) {
            this.logger.error(`Module "${m._name}" failed to init:\n${err}`);
          }
        });
      });
      this._onWindowUnload = () => this.destroy();
      window.addEventListener("unload", this._onWindowUnload, { once: true });
    },

    destroy() {
      if (this._onWindowUnload) {
        window.removeEventListener("unload", this._onWindowUnload);
      }
      this._modules.forEach((m) => {
        try {
          m.destroy?.();
        } catch (err) {
          this.logger.error(`Module "${m._name}" failed to destroy:\n${err}`);
        }
      });
      this.logger.log("🧹 All modules destroyed.");
      delete window.Nebula;
    },

    debug: {
      listModules() {
        return Nebula._modules.map((m) => m._name || "Unnamed");
      },
      destroyModule(name) {
        const mod = Nebula._modules.find((m) => m._name === name);
        try {
          mod?.destroy?.();
        } catch (err) {
          Nebula.logger.error(`Module "${name}" failed to destroy:\n${err}`);
        }
      },
      reload() {
        Nebula.destroy();
        location.reload();
      },
    },
  };

  // ========== NebulaPolyfillModule ==========
  class NebulaPolyfillModule {
    constructor() {
      this.root = document.documentElement;
      this.compactObserver = null;
      this.modeObserver = null;
      this._faviconRequest = 0;

      this.updateFaviconColor = this.updateFaviconColor.bind(this);
    }

    async init() {
      // Wait until gBrowser is available
      if (!window.gBrowser) {
        await new Promise((resolve) => {
          const check = setInterval(() => {
            if (window.gBrowser?.tabContainer) {
              clearInterval(check);
              resolve();
            }
          }, 50);
        });
      }

      // Compact mode detection
      const updateCompactMode = () => {
        this.root.toggleAttribute(
          "nebula-compact-mode",
          this.root.getAttribute("zen-compact-mode") === "true",
        );
      };
      this.compactObserver = new MutationObserver(updateCompactMode);
      this.compactObserver.observe(this.root, {
        attributes: true,
        attributeFilter: ["zen-compact-mode"],
      });
      updateCompactMode();

      // Toolbar mode detection
      this.modeObserver = new MutationObserver(() => this.updateToolbarModes());
      this.modeObserver.observe(this.root, {
        attributes: true,
        attributeFilter: ["zen-sidebar-expanded", "zen-single-toolbar"],
      });
      this.updateToolbarModes();

      // Favicon color detection
      gBrowser.tabContainer.addEventListener(
        "TabSelect",
        this.updateFaviconColor,
      );
      gBrowser.tabContainer.addEventListener(
        "TabAttrModified",
        this.updateFaviconColor,
      );

      // Initial run
      this.updateFaviconColor();

      Nebula.logger.log("✅ [Polyfill] Detection active.");
    }

    updateToolbarModes() {
      const hasSidebar = this.root.hasAttribute("zen-sidebar-expanded");
      const isSingle = this.root.hasAttribute("zen-single-toolbar");

      this.root.toggleAttribute("nebula-single-toolbar", isSingle);
      this.root.toggleAttribute(
        "nebula-multi-toolbar",
        hasSidebar && !isSingle,
      );
      this.root.toggleAttribute(
        "nebula-collapsed-toolbar",
        !hasSidebar && !isSingle,
      );
    }

    async updateFaviconColor(e) {
      const tab = gBrowser.selectedTab;
      if (
        e?.type === "TabAttrModified" &&
        (e.target !== tab || !e.detail.changed.includes("image"))
      )
        return;

      const request = ++this._faviconRequest;
      if (this._faviconTimeout) clearTimeout(this._faviconTimeout);
      this._faviconTimeout = null;
      const iconUrl = tab?.getAttribute("image");
      if (!iconUrl) {
        this.root.style.removeProperty("--nebula-selected-favicon-color");
        return;
      }

      // Debounce rapid switches; invalidate work already loading an icon.
      this._faviconTimeout = setTimeout(async () => {
        this._faviconTimeout = null;
        try {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = iconUrl;
          await new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
          });
          if (
            request !== this._faviconRequest ||
            tab !== gBrowser.selectedTab ||
            tab.getAttribute("image") !== iconUrl
          )
            return;

          const size = 16; // smaller canvas
          if (!this._faviconCanvas) {
            this._faviconCanvas = document.createElement("canvas");
            this._faviconCanvas.width = size;
            this._faviconCanvas.height = size;
            this._faviconCtx = this._faviconCanvas.getContext("2d");
          }

          const ctx = this._faviconCtx;
          ctx.clearRect(0, 0, size, size);
          ctx.drawImage(img, 0, 0, size, size);

          const data = ctx.getImageData(0, 0, size, size).data;
          const counts = [];

          for (let i = 0; i < data.length; i += 4) {
            const [r, g, b, a] = [
              data[i],
              data[i + 1],
              data[i + 2],
              data[i + 3],
            ];
            if (a < 128) continue;
            const key = `${r & 0xfc},${g & 0xfc},${b & 0xfc}`; // round to multiple of 4
            const index = counts.findIndex((c) => c.key === key);
            if (index >= 0) counts[index].freq++;
            else counts.push({ key, r, g, b, freq: 1 });
          }

          let best = null;
          let brightCandidate = null;

          for (let c of counts) {
            const hsl = this.rgbToHsl(c.r, c.g, c.b);
            const vibrancy = hsl.s * (1 - Math.abs(0.5 - hsl.l) * 2);
            const brightness = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
            const score = c.freq * vibrancy * brightness;

            if (!best || score > best.score)
              best = { ...c, score, brightness, hsl };
            if (brightness > 0.5) {
              if (!brightCandidate || score > brightCandidate.score)
                brightCandidate = { ...c, score, brightness, hsl };
            }
          }

          if (best && best.r + best.g + best.b < 300 && brightCandidate)
            best = brightCandidate;

          if (best) {
            let { r, g, b, hsl } = best;
            const sum = r + g + b;
            if (sum < 180) {
              // very dark
              let newL = Math.max(hsl.l, 0.4);
              newL = Math.min(newL * 1.6, 0.8);
              let newS = Math.min(hsl.s * 1.2, 1);
              ({ r, g, b } = this.hslToRgb(hsl.h, newS, newL));
            }

            const finalColor = `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
            this.root.style.setProperty(
              "--nebula-selected-favicon-color",
              finalColor,
            );
          }
        } catch (err) {
          console.error("[NebulaPolyfill] Favicon color error:", err);
        }
      }, 100);
    }

    // helper: convert HSL to RGB
    hslToRgb(h, s, l) {
      let r, g, b;
      if (s === 0) {
        r = g = b = l; // achromatic
      } else {
        const hue2rgb = (p, q, t) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
      }
      return { r: r * 255, g: g * 255, b: b * 255 };
    }

    // helper: convert RGB to HSL
    rgbToHsl(r, g, b) {
      r /= 255;
      g /= 255;
      b /= 255;
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
      let h,
        s,
        l = (max + min) / 2;

      if (max === min) {
        h = s = 0;
      } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r:
            h = (g - b) / d + (g < b ? 6 : 0);
            break;
          case g:
            h = (b - r) / d + 2;
            break;
          case b:
            h = (r - g) / d + 4;
            break;
        }
        h /= 6;
      }
      return { h, s, l };
    }

    destroy() {
      this.compactObserver?.disconnect();
      this.modeObserver?.disconnect();
      ++this._faviconRequest;
      if (this._faviconTimeout) clearTimeout(this._faviconTimeout);
      this._faviconTimeout = null;
      this.root.style.removeProperty("--nebula-selected-favicon-color");

      if (window.gBrowser) {
        gBrowser.tabContainer.removeEventListener(
          "TabSelect",
          this.updateFaviconColor,
        );
        gBrowser.tabContainer.removeEventListener(
          "TabAttrModified",
          this.updateFaviconColor,
        );
      }

      this.root.removeAttribute("nebula-single-toolbar");
      this.root.removeAttribute("nebula-multi-toolbar");
      this.root.removeAttribute("nebula-collapsed-toolbar");

      Nebula.logger.log("🧹 [Polyfill] Destroyed.");
    }
  }

  // ========== NebulaGradientSliderModule ==========
  class NebulaGradientSliderModule {
    constructor() {
      this.root = document.documentElement;
      this.gradientSlider = null;
      this._patched = false;
      this._sliderHandler = this.sync.bind(this);

      // Store original methods without polluting prototype
      this._origMethods = new WeakMap();
    }

    init() {
      this._waitFor(
        () => document.querySelector("#PanelUI-zen-gradient-generator-opacity"),
        (slider) => {
          this.gradientSlider = slider;
          slider.min = 0.0; // force min opacity
          slider.addEventListener("input", this._sliderHandler);

          this.sync();
          this._patchThemePicker();
        },
      );
    }

    _waitFor(fn, callback, maxRetries = 40) {
      let retries = maxRetries;
      const tryFind = () => {
        const el = fn();
        if (el) return callback(el);
        if (retries-- > 0) {
          Nebula.logger.debug?.(
            `[GradientSlider] Waiting… retries left: ${retries}`,
          );
          requestAnimationFrame(tryFind);
        } else {
          Nebula.logger.error("❌ [GradientSlider] Target not found.");
        }
      };
      tryFind();
    }

    sync() {
      if (!this.gradientSlider) return;
      const val = +this.gradientSlider.value;
      this.root.style.setProperty(
        "--nebula-gradient-opacity",
        val === 0 ? "0" : null,
      );
      Nebula.logger.debug?.(`[GradientSlider] Sync → ${val}`);
    }

    _patchThemePicker() {
      if (this._patched) return;

      this._waitFor(
        () =>
          window.nsZenThemePicker?.prototype ||
          window.browser?.gZenThemePicker?.constructor?.prototype,
        (proto) => {
          if (!proto?.blendWithWhiteOverlay) return;

          // Save original
          this._origMethods.set(proto, proto.blendWithWhiteOverlay);

          const moduleInstance = this;

          proto.blendWithWhiteOverlay = function (baseColor, opacity) {
            const val = +moduleInstance.gradientSlider?.value ?? opacity;
            if (val === 0) {
              if (Array.isArray(baseColor)) {
                return `rgba(${baseColor.join(",")},0)`;
              }
              if (
                typeof baseColor === "string" &&
                baseColor.startsWith("rgb")
              ) {
                return baseColor.replace(/rgb(a)?\(([^)]+)\)/, "rgba($2, 0)");
              }
              return "rgba(0,0,0,0)";
            }
            // Call the original method with the correct context
            return moduleInstance._origMethods
              .get(proto)
              .call(this, baseColor, opacity);
          };

          this._patched = true;
          Nebula.logger.log(
            "✅ [GradientSlider] Patched blendWithWhiteOverlay",
          );
        },
      );
    }

    destroy() {
      if (this.gradientSlider) {
        this.gradientSlider.removeEventListener("input", this._sliderHandler);
        this.gradientSlider = null;
      }

      if (this._patched) {
        const proto =
          window.nsZenThemePicker?.prototype ||
          window.browser?.gZenThemePicker?.constructor?.prototype;
        if (proto && this._origMethods.has(proto)) {
          proto.blendWithWhiteOverlay = this._origMethods.get(proto);
          this._origMethods.delete(proto);
        }
        this._patched = false;
      }

      this.root.style.removeProperty("--nebula-gradient-opacity");
      Nebula.logger.log("🧹 [GradientSlider] Destroyed");
    }
  }

  // ========== NebulaTitlebarBackgroundModule ==========
  class NebulaTitlebarBackgroundModule {
    constructor() {
      this.root = document.documentElement;
      this.browser = document.getElementById("browser");
      this.titlebar = document.getElementById("titlebar");
      this.overlay = null;
      this.lastRect = {};
      this.lastVisible = false;
      this.animationFrameId = null;

      this.update = this.update.bind(this);
      this._compactCallback = this._compactCallback.bind(this);
      this.resizeObserver = null;
      this.intersectionObserver = null;
    }

    init() {
      if (!this.browser || !this.titlebar) {
        Nebula.logger.warn(
          "⚠️ [TitlebarBackground] Required elements not found.",
        );
        return;
      }

      this.overlay = document.createElement("div");
      this.overlay.id = "Nebula-titlebar-background";
      Object.assign(this.overlay.style, {
        position: "absolute",
        display: "none",
      });
      this.browser.appendChild(this.overlay);

      gZenCompactModeManager.addEventListener(this._compactCallback);

      if (this.root.getAttribute("zen-compact-mode") === "true") {
        this.startLiveTracking();
      }

      Nebula.logger.log("✅ [TitlebarBackground] Tracking initialized.");
    }

    _compactCallback() {
      // Zen invokes this callback before the polyfill's MutationObserver runs.
      const isCompact = this.root.getAttribute("zen-compact-mode") === "true";
      if (isCompact) {
        this.startLiveTracking();
      } else {
        this.stopLiveTracking();
        this.hideOverlay();
      }
    }

    update() {
      const isCompact = this.root.getAttribute("zen-compact-mode") === "true";

      if (!isCompact) {
        this.stopLiveTracking();
        this.hideOverlay();
        return;
      }

      const rect = this.titlebar.getBoundingClientRect();
      const style = getComputedStyle(this.titlebar);

      const isVisible =
        rect.width > 5 &&
        rect.height > 5 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight;

      const changed =
        rect.top !== this.lastRect.top ||
        rect.left !== this.lastRect.left ||
        rect.width !== this.lastRect.width ||
        rect.height !== this.lastRect.height;

      if (!changed && this.lastVisible === isVisible) {
        this.animationFrameId = requestAnimationFrame(this.update);
        return;
      }

      this.lastRect = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };

      if (isVisible) {
        Object.assign(this.overlay.style, {
          top: `${rect.top + window.scrollY}px`,
          left: `${rect.left + window.scrollX}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          display: "block",
        });

        if (!this.lastVisible) {
          this.overlay.classList.add("visible");
          this.lastVisible = true;
        }
      } else {
        this.hideOverlay();
      }

      this.animationFrameId = requestAnimationFrame(this.update);
    }

    hideOverlay() {
      if (this.lastVisible) {
        this.overlay.classList.remove("visible");
        this.overlay.style.display = "none";
        this.lastVisible = false;
      }
    }

    startLiveTracking() {
      this.stopLiveTracking();
      this.update();
    }

    stopLiveTracking() {
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
    }

    destroy() {
      gZenCompactModeManager.removeEventListener(this._compactCallback);
      this.stopLiveTracking();
      this.hideOverlay();
      this.overlay?.remove();
      this.overlay = null;
      Nebula.logger.log("🧹 [TitlebarBackground] Destroyed.");
    }
  }

  // ========== NebulaNavbarBackgroundModule ==========
  class NebulaNavbarBackgroundModule {
    constructor() {
      this.root = document.documentElement;
      this.browser = document.getElementById("browser");
      this.navbar = document.getElementById("nav-bar");
      this.overlay = null;
      this.lastRect = {};
      this.lastVisible = false;
      this.animationFrameId = null;

      this.update = this.update.bind(this);
      this._compactCallback = this._compactCallback.bind(this);
    }

    init() {
      if (!this.browser || !this.navbar) {
        Nebula.logger.warn(
          "⚠️ [NavbarBackground] Required elements not found.",
        );
        return;
      }

      this.overlay = document.createElement("div");
      this.overlay.id = "Nebula-navbar-background";
      Object.assign(this.overlay.style, {
        position: "absolute",
        display: "none",
      });
      this.browser.appendChild(this.overlay);

      gZenCompactModeManager.addEventListener(this._compactCallback);

      if (this.root.hasAttribute("nebula-compact-mode")) {
        this.startLiveTracking();
      }

      Nebula.logger.log("✅ [NavbarBackground] Tracking initialized.");
    }

    _compactCallback() {
      const isCompact = this.root.hasAttribute("nebula-compact-mode");
      if (isCompact) {
        this.startLiveTracking();
      } else {
        this.stopLiveTracking();
        this.hideOverlay();
      }
    }

    update() {
      const isCompact = this.root.hasAttribute("nebula-compact-mode");
      if (!isCompact) {
        this.stopLiveTracking();
        this.hideOverlay();
        return;
      }

      const rect = this.navbar.getBoundingClientRect();
      const style = getComputedStyle(this.navbar);

      const isVisible =
        rect.width > 5 &&
        rect.height > 5 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight;

      const changed =
        rect.top !== this.lastRect.top ||
        rect.left !== this.lastRect.left ||
        rect.width !== this.lastRect.width ||
        rect.height !== this.lastRect.height;

      if (!changed && this.lastVisible === isVisible) {
        this.animationFrameId = requestAnimationFrame(this.update);
        return;
      }

      this.lastRect = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };

      if (isVisible) {
        Object.assign(this.overlay.style, {
          top: `${rect.top + window.scrollY}px`,
          left: `${rect.left + window.scrollX}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          display: "block",
        });

        if (!this.lastVisible) {
          this.overlay.classList.add("visible");
          this.lastVisible = true;
        }
      } else {
        this.hideOverlay();
      }

      this.animationFrameId = requestAnimationFrame(this.update);
    }

    hideOverlay() {
      if (this.lastVisible) {
        this.overlay.classList.remove("visible");
        this.overlay.style.display = "none";
        this.lastVisible = false;
      }
    }

    startLiveTracking() {
      this.stopLiveTracking();
      this.update();
    }

    stopLiveTracking() {
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
    }

    destroy() {
      gZenCompactModeManager.removeEventListener(this._compactCallback);
      this.stopLiveTracking();
      this.hideOverlay();
      this.overlay?.remove();
      this.overlay = null;
      Nebula.logger.log("🧹 [NavbarBackground] Destroyed.");
    }
  }

  // ========== NebulaURLBarBackgroundModule ==========
  class NebulaURLBarBackgroundModule {
    constructor() {
      this.root = document.documentElement;
      this.browser = document.getElementById("browser");
      this.urlbar = document.getElementById("urlbar");
      this.overlay = null;
      this.lastRect = {};
      this.lastVisible = false;
      this.animationFrameId = null;

      this.update = this.update.bind(this);
      this.mutationObserver = null;
    }

    init() {
      if (!this.browser || !this.urlbar) {
        Nebula.logger.warn(
          "⚠️ [URLBarBackground] Required elements not found.",
        );
        return;
      }

      this.overlay = document.createElement("div");
      this.overlay.id = "Nebula-urlbar-background";
      Object.assign(this.overlay.style, {
        position: "absolute",
        display: "none",
      });
      this.browser.appendChild(this.overlay);

      // Start mutation observer for `open` attribute change
      this.mutationObserver = new MutationObserver(() => this.onMutation());
      this.mutationObserver.observe(this.urlbar, {
        attributes: true,
        attributeFilter: ["open"],
      });

      if (this.urlbar.hasAttribute("open")) {
        this.startLiveTracking();
      }

      Nebula.logger.log("✅ [URLBarBackground] Tracking initialized.");
    }

    onMutation() {
      const isOpen = this.urlbar.hasAttribute("open");
      if (isOpen) {
        this.startLiveTracking();
      } else {
        this.stopLiveTracking();
        this.hideOverlay();
      }
    }

    update() {
      const isOpen = this.urlbar.hasAttribute("open");
      if (!isOpen) {
        this.stopLiveTracking();
        this.hideOverlay();
        return;
      }

      const rect = this.urlbar.getBoundingClientRect();
      const style = getComputedStyle(this.urlbar);

      const isVisible =
        rect.width > 5 &&
        rect.height > 5 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight;

      const changed =
        rect.top !== this.lastRect.top ||
        rect.left !== this.lastRect.left ||
        rect.width !== this.lastRect.width ||
        rect.height !== this.lastRect.height;

      if (!changed && this.lastVisible === isVisible) {
        this.animationFrameId = requestAnimationFrame(this.update);
        return;
      }

      this.lastRect = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };

      if (isVisible) {
        Object.assign(this.overlay.style, {
          top: `${rect.top + window.scrollY}px`,
          left: `${rect.left + window.scrollX}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          display: "block",
        });

        if (!this.lastVisible) {
          this.overlay.classList.add("visible");
          this.lastVisible = true;
        }
      } else {
        this.hideOverlay();
      }

      this.animationFrameId = requestAnimationFrame(this.update);
    }

    hideOverlay() {
      if (this.lastVisible) {
        this.overlay.classList.remove("visible");
        this.overlay.style.display = "none";
        this.lastVisible = false;
      }
    }

    startLiveTracking() {
      this.stopLiveTracking();
      this.update();
    }

    stopLiveTracking() {
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
    }

    destroy() {
      this.mutationObserver?.disconnect();
      this.stopLiveTracking();
      this.hideOverlay();
      this.overlay?.remove();
      this.overlay = null;
      Nebula.logger.log("🧹 [URLBarBackground] Destroyed.");
    }
  }

  // ========== NebulaMediaCoverArtModule ==========
  class NebulaMediaCoverArtModule {
    constructor() {
      this.entries = new Map();
      this.patches = [];
      this.timer = null;
      this.destroyed = false;
    }

    init() {
      this._waitForController(40);
    }

    _waitForController(attempts) {
      if (this.destroyed) return;
      const manager = window.gZenMediaController;
      if (typeof manager?.activateMediaControls === "function") {
        this._patch(manager, "activateMediaControls", (original, args) => {
          const bar = manager.mediaControlBar;
          const before = new Set(bar?.children || []);
          const result = original.apply(manager, args);
          const element = Array.from(
            manager.mediaControlBar?.children || [],
          ).find((child) => !before.has(child));
          if (element) this._attach(args[0], element);
          this._syncFront(manager);
          return result;
        });
        this._patch(manager, "onCardVisibilityChanged", (original, args) => {
          const result = original.apply(manager, args);
          this._syncFront(manager);
          return result;
        });
        this._patch(manager, "onCardDestroyed", (original, args) => {
          this._detach(args[0]?.controller);
          return original.apply(manager, args);
        });
        this._syncFront(manager);
      } else if (typeof manager?.setupMediaController === "function") {
        this._patch(manager, "setupMediaController", (original, args) => {
          const result = original.apply(manager, args);
          this._syncLegacy(manager);
          return result;
        });
        this._syncLegacy(manager);
      } else if (attempts > 0) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this._waitForController(attempts - 1);
        }, 250);
      }
    }

    _patch(target, key, callback) {
      const original = target[key];
      if (typeof original !== "function") return;
      const module = this;
      const wrapper = function (...args) {
        if (module.destroyed) return original.apply(this, args);
        return callback(original, args);
      };
      target[key] = wrapper;
      this.patches.push({ target, key, original, wrapper });
    }

    _syncFront(manager) {
      const card = manager.frontCard;
      if (card?.controller) this._attach(card.controller, card.element);
      for (const [controller, entry] of this.entries) {
        if (!entry.element.isConnected) this._detach(controller);
      }
    }

    _syncLegacy(manager) {
      const current = manager._currentMediaController;
      for (const controller of this.entries.keys()) {
        if (controller !== current) this._detach(controller);
      }
      this._attach(
        current,
        document.querySelector("#zen-media-controls-toolbar > toolbaritem"),
      );
    }

    _attach(controller, element) {
      if (!controller || !element || this.destroyed) return;
      const existing = this.entries.get(controller);
      if (existing?.element === element) return;
      this._detach(controller);
      const entry = { element, overlay: null, url: null };
      entry.update = () => this._update(controller, entry);
      entry.deactivate = () => this._detach(controller);
      this.entries.set(controller, entry);
      controller.addEventListener("metadatachange", entry.update);
      controller.addEventListener("deactivated", entry.deactivate);
      entry.update();
    }

    _update(controller, entry) {
      if (this.destroyed || this.entries.get(controller) !== entry) return;
      let artwork;
      try {
        artwork = controller.getMetadata()?.artwork;
      } catch {
        artwork = [];
      }
      const area = (item) => {
        const [width, height] = (item.sizes || "").split("x").map(Number);
        return Number.isFinite(width * height) ? width * height : 0;
      };
      const url = Array.isArray(artwork)
        ? [...artwork]
            .filter((item) => item.src)
            .sort((a, b) => area(b) - area(a))[0]?.src
        : null;
      if (!url) {
        entry.overlay?.remove();
        entry.overlay = null;
        entry.url = null;
        return;
      }
      if (entry.url === url && entry.overlay) return;
      if (!entry.overlay) {
        entry.overlay = document.createElement("div");
        entry.overlay.className = "Nebula-media-cover-art visible";
        entry.element.prepend(entry.overlay);
      }
      entry.overlay.style.backgroundImage = `url(${JSON.stringify(url)})`;
      entry.url = url;
    }

    _detach(controller) {
      const entry = this.entries.get(controller);
      if (!entry) return;
      controller.removeEventListener("metadatachange", entry.update);
      controller.removeEventListener("deactivated", entry.deactivate);
      entry.overlay?.remove();
      this.entries.delete(controller);
    }

    destroy() {
      this.destroyed = true;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      for (const { target, key, original, wrapper } of this.patches.reverse()) {
        if (target[key] === wrapper) target[key] = original;
      }
      this.patches = [];
      for (const controller of this.entries.keys()) this._detach(controller);
    }
  }

  // ========== NebulaMenuModule ==========
  class NebulaMenuModule {
    constructor() {
      this.root = document.documentElement;
      this.STAGGER_DELAY = 15;
      this.MAX_DELAY = 200;
      this.MENU_ITEM_SELECTORS = [
        "menuitem",
        "menuseparator",
        ".subviewbutton",
        ".panel-menuitem",
        ".panel-list-item",
        ".PanelUI-subView .subviewbutton",
        ".panel-subview-body > *",
        ".panel-subview .subviewbutton",
        'toolbarbutton[class*="subviewbutton"]',
        ".cui-widget-panel .subviewbutton",
        "vbox.panel-subview-body > *",
        ".panel-subview-body > toolbarbutton",
        ".panel-subview-body > .subviewbutton",
      ];

      this.observers = new Map();
      this.pendingFrames = new Map();
      this.pendingTimers = new Map();

      // Bind methods
      this.handlePopupShowing = this.handlePopupShowing.bind(this);
      this.handlePopupHidden = this.handlePopupHidden.bind(this);
    }

    init() {
      document.addEventListener("popupshowing", this.handlePopupShowing, true);
      document.addEventListener("popuphidden", this.handlePopupHidden, true);
      document.addEventListener("ViewShowing", this.handlePopupShowing, true);
      document.addEventListener("ViewHiding", this.handlePopupHidden, true);

      Nebula.logger.log("✅ [MenuModule] Animations initialized.");
    }

    getMenuItems(popup) {
      if (!popup) return [];
      let items = [];
      // Cache selector string
      const selectorString =
        this._cachedSelectorString ||
        (this._cachedSelectorString = this.MENU_ITEM_SELECTORS.join(","));

      if (popup.localName === "menupopup") {
        items = Array.from(popup.children);
      } else {
        const subviewBody = popup.querySelector(".panel-subview-body");
        items = Array.from(
          (subviewBody || popup).querySelectorAll(selectorString),
        );
      }

      // Flatten children only if needed
      const flattenedItems = [];
      for (const item of items) {
        if (
          item.matches &&
          item.matches(".panel-subview-body, .panel-subview")
        ) {
          for (const child of item.children) {
            if (
              this.MENU_ITEM_SELECTORS.some((selector) =>
                child.matches(selector),
              )
            ) {
              flattenedItems.push(child);
            }
          }
        } else {
          flattenedItems.push(item);
        }
      }

      // Filter visible elements efficiently
      return flattenedItems.filter((item) => {
        if (!item || item.nodeType !== 1) return false;
        const rect = item.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          getComputedStyle(item).display !== "none"
        );
      });
    }

    animateMenuItems(popup) {
      if (!this.observers.has(popup) || this.pendingFrames.has(popup)) return;
      const frame = window.requestAnimationFrame(() => {
        this.pendingFrames.delete(popup);
        if (!this.observers.has(popup)) return;
        if (!this.animationsEnabled()) {
          this.cleanupMenuItems(popup);
          return;
        }
        this.getMenuItems(popup).forEach((item, index) =>
          this.animateItem(item, index),
        );
      });
      this.pendingFrames.set(popup, frame);
    }

    animationsEnabled() {
      return (
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
        getComputedStyle(this.root)
          .getPropertyValue("--nebula-menu-animation")
          .trim() === "true"
      );
    }

    animateItem(item, index) {
      item.classList.remove("nebula-menu-anim");
      item.style.animationDelay = "";

      const delay = Math.min(index * this.STAGGER_DELAY, this.MAX_DELAY);
      item.style.animationDelay = `${delay}ms`;
      item.classList.add("nebula-menu-anim");
    }

    cleanupMenuItems(popup) {
      if (!popup) return;
      if (this.pendingFrames.has(popup)) {
        window.cancelAnimationFrame(this.pendingFrames.get(popup));
        this.pendingFrames.delete(popup);
      }
      if (this.pendingTimers.has(popup)) {
        clearTimeout(this.pendingTimers.get(popup));
        this.pendingTimers.delete(popup);
      }
      popup.querySelectorAll(".nebula-menu-anim").forEach((item) => {
        item.classList.remove("nebula-menu-anim");
        item.style.animationDelay = "";
      });
    }

    isTargetMenu(popup) {
      if (!popup || !popup.localName) return false;
      const menuTypes = [
        "menupopup",
        "#appMenu-popup",
        "#PanelUI-popup",
        ".panel-popup",
        ".panel-subview",
        "#PanelUI-history",
        "#PanelUI-bookmarks",
        "#PanelUI-downloads",
      ];
      return (
        menuTypes.some((selector) =>
          selector.startsWith("#") || selector.startsWith(".")
            ? popup.matches && popup.matches(selector)
            : popup.localName === selector,
        ) ||
        popup.classList.contains("panel-subview") ||
        popup.classList.contains("PanelUI-subView") ||
        popup.querySelector(".panel-subview-body")
      );
    }

    setupMutationObserver(popup) {
      if (this.observers.has(popup)) return;

      const observer = new MutationObserver((mutations) => {
        if (!this.observers.has(popup) || this.pendingTimers.has(popup)) return;
        if (
          mutations.some(
            (m) =>
              (m.type === "childList" && m.addedNodes.length > 0) ||
              (m.type === "attributes" &&
                ["hidden", "collapsed"].includes(m.attributeName)),
          )
        ) {
          const timer = setTimeout(() => {
            this.pendingTimers.delete(popup);
            this.animateMenuItems(popup);
          }, 5);
          this.pendingTimers.set(popup, timer);
        }
      });

      observer.observe(popup, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["hidden", "collapsed", "disabled"],
      });

      this.observers.set(popup, observer);
    }

    handlePopupShowing(event) {
      const popup = event.target;
      if (!this.isTargetMenu(popup) || !this.animationsEnabled()) return;
      this.setupMutationObserver(popup);
      this.animateMenuItems(popup);
    }

    handlePopupHidden(event) {
      const popup = event.target;
      if (!this.isTargetMenu(popup)) return;
      this.cleanupMenuItems(popup);

      if (this.observers.has(popup)) {
        this.observers.get(popup).disconnect();
        this.observers.delete(popup);
      }
    }

    stop() {
      document.removeEventListener(
        "popupshowing",
        this.handlePopupShowing,
        true,
      );
      document.removeEventListener("popuphidden", this.handlePopupHidden, true);
      document.removeEventListener(
        "ViewShowing",
        this.handlePopupShowing,
        true,
      );
      document.removeEventListener("ViewHiding", this.handlePopupHidden, true);

      this.observers.forEach((observer) => observer.disconnect());
      this.observers.clear();
      this.pendingFrames.forEach((frame) => window.cancelAnimationFrame(frame));
      this.pendingFrames.clear();
      this.pendingTimers.forEach((timer) => clearTimeout(timer));
      this.pendingTimers.clear();

      document.querySelectorAll(".nebula-menu-anim").forEach((item) => {
        item.classList.remove("nebula-menu-anim");
        item.style.animationDelay = "";
      });

      Nebula.logger.log("🛑 [MenuModule] Animations disabled.");
    }

    destroy() {
      this.stop();
      Nebula.logger.log("🧹 [MenuModule] Module destroyed.");
    }
  }

  // ========== NebulaCtrlTabDualBackgroundModule ==========
  class NebulaCtrlTabDualBackgroundModule {
    constructor({ trackingMode = "both" } = {}) {
      this.browser = document.getElementById("browser");
      this.panel = document.getElementById("ctrlTab-panel");
      this.overlays = {};
      this.lastRect = null;
      this.lastVisible = false;
      this.rafId = null;
      this.trackingMode = trackingMode;

      this.update = this.update.bind(this);
      this.onPopupShown = this.startTracking.bind(this);
      this.onPopupHidden = this.stopTracking.bind(this);
    }

    init() {
      if (!this.browser || !this.panel) {
        return Nebula.logger.warn(
          "⚠️ [CtrlTabDualBackground] Required elements not found.",
        );
      }

      if (this.trackingMode !== "below")
        this.overlays.above = this.createOverlay(
          "nebula-ctrltab-background-above",
          2147483646,
          true,
        );
      if (this.trackingMode !== "above")
        this.overlays.below = this.createOverlay(
          "nebula-ctrltab-background-below",
          0,
          false,
        );

      this.panel.addEventListener("popupshown", this.onPopupShown);
      this.panel.addEventListener("popuphidden", this.onPopupHidden);

      Nebula.logger.log("✅ [CtrlTabDualBackground] Initialized.");
    }

    createOverlay(id, zIndex, interactive) {
      const o = document.createElement("div");
      o.id = id;
      Object.assign(o.style, {
        position: "absolute",
        display: "none",
        zIndex: interactive ? zIndex : "",
        pointerEvents: interactive ? "auto" : "none",
      });
      this.browser.appendChild(o);
      return o;
    }

    startTracking() {
      if (!this.rafId) this.update();
    }

    stopTracking() {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.rafId = null;
      this.hideOverlays();
    }

    update() {
      const p = this.panel;
      if (!p) return;

      const r = p.getBoundingClientRect();
      const cs = getComputedStyle(p);
      const visible =
        r.width > 5 &&
        r.height > 5 &&
        cs.display !== "none" &&
        cs.visibility !== "hidden" &&
        cs.opacity !== "0";

      if (!visible) return this.hideOverlays();

      const changed =
        !this.lastRect ||
        r.top !== this.lastRect.top ||
        r.left !== this.lastRect.left ||
        r.width !== this.lastRect.width ||
        r.height !== this.lastRect.height;

      if (!changed && this.lastVisible) {
        this.rafId = requestAnimationFrame(this.update);
        return;
      }

      this.lastRect = {
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
      };
      const style = {
        top: `${r.top + window.scrollY}px`,
        left: `${r.left + window.scrollX}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        display: "block",
      };

      Object.values(this.overlays).forEach(
        (o) => o && Object.assign(o.style, style),
      );

      this.lastVisible = true;
      this.rafId = requestAnimationFrame(this.update);
    }

    hideOverlays() {
      Object.values(this.overlays).forEach(
        (o) => o && (o.style.display = "none"),
      );
      this.lastVisible = false;
    }

    destroy() {
      this.panel?.removeEventListener("popupshown", this.onPopupShown);
      this.panel?.removeEventListener("popuphidden", this.onPopupHidden);
      this.stopTracking();
      Object.values(this.overlays).forEach((o) => o?.remove());
      this.overlays = {};
      Nebula.logger.log("🧹 [CtrlTabDualBackground] Destroyed.");
    }
  }

  // Reserve space for wrapped pinned widgets and stacked media cards.
  class NebulaPinnedLayoutModule {
    init() {
      this.target = document.getElementById("TabsToolbar-customization-target");
      this.tabs = document.getElementById("tabbrowser-tabs");
      this.media = document.getElementById("zen-media-controls-toolbar");
      this.sidebar = document.getElementById("navigator-toolbox");
      if (!this.target || !this.tabs) return;

      this.schedule = () => {
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => {
          this.frame = null;
          this.update();
        });
      };
      this.resizeObserver = new ResizeObserver(this.schedule);
      this.observeChildren = () => {
        this.media = this.target.querySelector("#zen-media-controls-toolbar");
        this.resizeObserver.disconnect();
        this.resizeObserver.observe(this.target);
        if (this.sidebar) this.resizeObserver.observe(this.sidebar);
        for (const child of this.target.children) {
          // Our own tab-height write must not retrigger measurement.
          if (child !== this.tabs) this.resizeObserver.observe(child);
        }
        this.schedule();
      };
      this.childObserver = new MutationObserver(this.observeChildren);
      this.childObserver.observe(this.target, { childList: true });
      this.rootObserver = new MutationObserver(this.schedule);
      this.rootObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: [
          "customizing",
          "zen-sidebar-expanded",
          "zen-compact-mode",
        ],
      });
      Services.prefs.addObserver("nebula-pinned-extensions-mod", this.schedule);
      window.addEventListener("aftercustomization", this.schedule);
      this.observeChildren();
    }

    update() {
      const property = "--nebula-pinned-tabs-height";
      if (
        !Services.prefs.getBoolPref("nebula-pinned-extensions-mod", false) ||
        document.documentElement.hasAttribute("customizing") ||
        !this.target.querySelector(":scope > .unified-extensions-item")
      ) {
        this.target.style.removeProperty(property);
        return;
      }
      // Measure without the previous explicit tab height: otherwise adding a
      // wrapped row can enlarge a flex ancestor and preserve an oversized value.
      const previousHeight = this.target.style.getPropertyValue(property);
      this.target.style.setProperty(property, "0px");
      const box = this.target.getBoundingClientRect();
      const tabsBox = this.tabs.getBoundingClientRect();
      if (!box.height || !tabsBox.width) {
        if (previousHeight)
          this.target.style.setProperty(property, previousHeight);
        else this.target.style.removeProperty(property);
        return;
      }
      const targetStyle = getComputedStyle(this.target);
      const tabsStyle = getComputedStyle(this.tabs);
      const px = (value) => parseFloat(value) || 0;
      // Customization temporarily removes the address-bar row. Its return can
      // grow the sidebar around the old tab height instead of shrinking it.
      // Preserve the measured footer space, but keep it inside the viewport.
      const trailingSpace = this.sidebar
        ? Math.max(0, this.sidebar.getBoundingClientRect().bottom - box.bottom)
        : 0;
      const bottom = Math.min(box.bottom, window.innerHeight - trailingSpace);
      let available =
        bottom -
        px(targetStyle.borderBottomWidth) -
        px(targetStyle.paddingBottom) -
        tabsBox.top -
        px(tabsStyle.marginBottom);
      if (this.media && getComputedStyle(this.media).display !== "none") {
        const mediaStyle = getComputedStyle(this.media);
        available -=
          this.media.getBoundingClientRect().height +
          px(mediaStyle.marginTop) +
          px(mediaStyle.marginBottom) +
          px(targetStyle.rowGap);
      }
      if (tabsStyle.boxSizing !== "border-box") {
        available -=
          px(tabsStyle.paddingTop) +
          px(tabsStyle.paddingBottom) +
          px(tabsStyle.borderTopWidth) +
          px(tabsStyle.borderBottomWidth);
      }
      const height = `${Math.max(0, Math.floor(available))}px`;
      if (this.target.style.getPropertyValue(property) !== height) {
        this.target.style.setProperty(property, height);
      }
    }

    destroy() {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.resizeObserver?.disconnect();
      this.childObserver?.disconnect();
      this.rootObserver?.disconnect();
      window.removeEventListener("aftercustomization", this.schedule);
      if (this.schedule) {
        Services.prefs.removeObserver(
          "nebula-pinned-extensions-mod",
          this.schedule,
        );
      }
      this.target?.style.removeProperty("--nebula-pinned-tabs-height");
    }
  }

  // The PDF viewer can miss Sine's per-document content-style injection.
  // A registered user sheet also reaches that viewer. Its rules are scoped
  // to the PDF viewer; keep it registered while any Nebula window needs it.
  class NebulaPDFStylesModule {
    init() {
      if (this._registered) return;
      this._service = Cc[
        "@mozilla.org/content/style-sheet-service;1"
      ].getService(Ci.nsIStyleSheetService);
      this._uri = Services.io.newURI(
        "chrome://sine/content/Nebula/nebula/content/better-pdf.css",
      );
      if (!this._service.sheetRegistered(this._uri, this._service.USER_SHEET)) {
        this._service.loadAndRegisterSheet(this._uri, this._service.USER_SHEET);
      }
      this._registered = true;
    }

    destroy() {
      if (!this._registered) return;
      this._registered = false;
      const anotherOwner = Array.from(
        Services.wm.getEnumerator("navigator:browser"),
      ).some((win) =>
        win.Nebula?._modules.some(
          (mod) => mod._name === this._name && mod._registered,
        ),
      );
      if (
        !anotherOwner &&
        this._service.sheetRegistered(this._uri, this._service.USER_SHEET)
      ) {
        this._service.unregisterSheet(this._uri, this._service.USER_SHEET);
      }
    }
  }

  // Register Nebula Modules
  Nebula.register(NebulaPolyfillModule);
  Nebula.register(NebulaGradientSliderModule);
  Nebula.register(NebulaTitlebarBackgroundModule);
  //Nebula.register(NebulaNavbarBackgroundModule); NOT NEEDED ANYMORE
  Nebula.register(NebulaURLBarBackgroundModule);
  Nebula.register(NebulaMediaCoverArtModule);
  Nebula.register(NebulaMenuModule);
  Nebula.register(NebulaCtrlTabDualBackgroundModule);
  Nebula.register(NebulaPinnedLayoutModule);
  Nebula.register(NebulaPDFStylesModule);

  // Start the core
  Nebula.init();
  // Let Sine replace the script in place instead of retaining the old instance.
  if (typeof window.addUnloadListener === "function") {
    const instance = window.Nebula;
    window.addUnloadListener(() => instance.destroy());
  }
})();
