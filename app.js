/* ==========================================================================
   Geometry Dash · WASM Webport
   Bootstrap, asset loader, progress UI, proxy bridge, and input bridge.
   ========================================================================== */

(() => {
  'use strict';

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  const WASM_GZIP = {
    url: 'data/gd_web.wasm.gz',
    size: 13787596
  };

  function supportsGzipDecompression() {
    if (typeof DecompressionStream !== 'function') return false;
    try {
      // Construction is the only reliable feature test; some older engines
      // expose the API but reject the gzip format.
      new DecompressionStream('gzip');
      return true;
    } catch (_) {
      return false;
    }
  }

  const HAS_GZIP_STREAM = supportsGzipDecompression();

  const ASSETS = {
    wasm: { ...WASM_GZIP },
    data: { url: 'data/gd_web.pkg.parts.json', size: 314500859, label: 'Game files' }
  };

  const DEBUG = /[?&]debug(?:=|&|$)/.test(location.search);
  const NO_AUTOSAVE = /[?&]noauto(?:=|&|$)/.test(location.search);
  const IS_FILE = location.protocol === 'file:';
  const IS_COARSE = typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  const IS_TOUCH = IS_COARSE ||
    (navigator.maxTouchPoints || 0) > 0 ||
    'ontouchstart' in window;
  const SAVE_LS_PREFIX = 'gdwasm_save:';
  const SAVE_LS_TIME_PREFIX = 'gdwasm_save_time:';
  const SAVE_XOR_KEY = 0x0b;
  const AUTOSAVE_INTERVAL_MS = 15000;

  // Downloaded online levels live inside CCGameManager.dat. Music is saved by
  // the engine as AppData/<song id>.mp3. Both are kept in IndexedDB for the
  // current browser tab session only: they survive a reload, but a session
  // identifier stored in a session cookie (with history.state as a fallback)
  // makes the next browser session start with a clean store.
  const MEDIA_SAVE_RE = /\.(mp3|ogg|wav|m4a|aac|flac)$/i;
  const SESSION_DB_NAME = 'gdwasm-session-v2';
  const SESSION_DB_VERSION = 1;
  const SESSION_STORE = 'files';
  const SESSION_INDEX = 'bySession';
  const SESSION_COOKIE = 'gdwasm_session_id';
  const ONLINE_SAVE_KEYS = ['GLM_03', 'GLM_07', 'MDLM_001'];
  const SCRIPT_URL = 'vendor/gd_web.js';
  const PROXY_ROUNDS = 3;

  const VIEW_W = 1920;
  const VIEW_H = 1080;

  const QUALITY_KEY = 'gdQuality';
  const MIN_RENDER_SCALE = 0.4;
  const LOW_FPS = 48;

  // Auto begins at the resolution your display actually needs, then steps
  // down only when the frame rate cannot keep up.
  const AUTO_STEPS = [1, 0.85, 0.72, 0.6, 0.5];

  // The loader is kept up until the engine has produced a continuous burst of
  // frames. Hiding it on the very first frame exposes the menu's texture
  // upload stalls as an apparently frozen game.
  const WARMUP_MIN_MS = 1800;
  const WARMUP_STABLE_MS = 1000;
  const WARMUP_MIN_FRAMES = 24;
  const WARMUP_FALLBACK_MS = 5000;
  const WARMUP_HARD_LIMIT_MS = 20000;
  const STATS_INTERVAL_MS = 500;

  const QUALITY_MODES = {
    auto: {
      label: 'Auto',
      scale: 0,
      desc: 'Matches your display and adapts to FPS'
    },
    high: {
      label: 'High',
      scale: 1,
      desc: 'Sharpest picture, highest GPU load'
    },
    balanced: {
      label: 'Balanced',
      scale: 0.8,
      desc: 'Slightly softer, much lighter on the GPU'
    },
    fast: {
      label: 'Fast',
      scale: 0.65,
      desc: 'Smooth on integrated graphics'
    },
    performance: {
      label: 'Performance',
      scale: 0.5,
      desc: 'Maximum speed on weak hardware'
    }
  };

  const QUALITY_ORDER = ['auto', 'high', 'balanced', 'fast', 'performance'];


  // Boomlings is reached through a CORS proxy. The worker is primary; the
  // public CodeTabs endpoint is a best-effort fallback.
  const PROXY_BASES = [
    'https://boomlings.ivan-makarov12341.workers.dev/?url=',
    'https://api.codetabs.com/v1/proxy/?quest='
  ];

  const PROXY_PASS = [
    'cloudflareinsights',
    'jsdelivr',
    'gstatic',
    'googleapis',
    'workers.dev',
    'codetabs'
  ];

  // Transient proxy/edge statuses. The first request after an idle period can
  // fail while a worker wakes up, so a status from this list is retried on the
  // other proxy and then in another round instead of being shown as a failed
  // download.
  const RETRYABLE_STATUS = new Set([
    401, 403, 404, 408, 425, 429,
    500, 502, 503, 504,
    520, 521, 522, 523, 524, 525, 526, 527
  ]);

  const QUIET_PREFIXES = [
    '[perf]', '[frame]', '[webgl]', '[io]', '[tex]', '[pngc]', '[pngd]',
    '[fmtf]', '[sink]', '[htb]', '[disp]', '[rawin]', '[touch]', '[cte]',
    '[list]', '[drs]', '[tex2]'
  ];

  const VK = {
    Escape: 0x1b,
    Space: 0x20, Enter: 0x0d, Backspace: 0x08, Tab: 0x09,
    ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28,
    KeyW: 0x57, KeyA: 0x41, KeyS: 0x53, KeyD: 0x44,
    KeyQ: 0x51, KeyE: 0x45, KeyR: 0x52, KeyF: 0x46, KeyP: 0x50
  };

  const SCAN = {
    Escape: 0x01,
    Space: 0x39, Enter: 0x1c, Backspace: 0x0e, Tab: 0x0f,
    ArrowLeft: 0x4b, ArrowUp: 0x48, ArrowRight: 0x4d, ArrowDown: 0x50,
    KeyW: 0x11, KeyA: 0x1e, KeyS: 0x1f, KeyD: 0x20,
    KeyQ: 0x10, KeyE: 0x12, KeyR: 0x13, KeyF: 0x21, KeyP: 0x19
  };

  const EXTENDED_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']);

  // -------------------------------------------------------------------------
  // DOM + state
  // -------------------------------------------------------------------------

  const byId = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const el = {
    body: document.body,
    bg: byId('bg'),
    app: byId('app'),
    start: byId('start'),
    startCard: byId('startCard'),
    logoFly: byId('logoFly'),
    playBtn: byId('playBtn'),
    playSize: byId('playSize'),
    loadPanel: byId('loadPanel'),
    readyPanel: byId('readyPanel'),
    statusText: byId('statusText'),
    overallPct: byId('overallPct'),
    overallBar: byId('overallBar'),
    overallFill: byId('overallFill'),
    rowWasm: byId('rowWasm'),
    rowData: byId('rowData'),
    wasmBar: byId('wasmBar'),
    wasmFill: byId('wasmFill'),
    wasmPct: byId('wasmPct'),
    wasmDetail: byId('wasmDetail'),
    dataBar: byId('dataBar'),
    dataFill: byId('dataFill'),
    dataPct: byId('dataPct'),
    dataDetail: byId('dataDetail'),
    loadHint: byId('loadHint'),
    canvas: byId('canvas'),
    logoDock: byId('logoDock'),
    stage: byId('stage'),
    toast: byId('toast'),
    rotateHint: byId('rotateHint'),
    rotateDismiss: byId('rotateDismiss'),
    midbar: byId('midbar'),
    fps: byId('fps'),
    fpsval: byId('fpsval'),
    qualityBtn: byId('qualityBtn'),
    qualityLabel: byId('qualityLabel'),
    qualityScale: byId('qualityScale'),
    qualityMenu: byId('qualityMenu'),
    qualityRes: byId('qualityRes'),
    qualityOptions: byId('qualityOptions'),
    qualityNote: byId('qualityNote'),
    qualityGpu: byId('qualityGpu'),
    fsBtn: byId('fsBtn'),
    clearBtn: byId('clearBtn'),
    console: byId('console'),
    errOverlay: byId('errOverlay'),
    errTitle: byId('errTitle'),
    errText: byId('errText'),
    errReload: byId('errReload'),
    errDismiss: byId('errDismiss')
  };

  const state = {
    started: false,
    live: false,
    mobileScene: 'hidden',
    mobileLevelTextureSeen: false,
    liveAt: 0,
    readyScheduled: false,
    phase: 'idle',
    boot: 0,
    status: 'Ready to launch',
    renderQueued: false,
    errorVisible: false,
    lastError: '',
    resetting: false,
    quitting: false,
    storageBroken: false,
    saveErrorShown: false,
    warmupStatusShown: false,
    assets: {
      wasm: createAssetState(ASSETS.wasm.size),
      data: createAssetState(ASSETS.data.size)
    }
  };

  let entryFallbackTimer = null;
  let moduleReady = false;
  let toastTimer = 0;
  let rotateHintTimer = 0;
  let rotateHintDismissed = false;
  let autosaveTimer = 0;
  let lastSaveRequestAt = 0;

  let sessionId = null;
  let sessionDbPromise = null;
  let sessionDbUnavailable = false;
  let sessionGeneration = 0;
  let sessionWriteChain = Promise.resolve();
  let sessionWarningShown = false;
  const sessionMemory = new Map();
  let lastFilteredGameManager = null;
  let gameManagerFilterRunning = false;
  let pendingGameManagerSave = null;
  const lastSessionHashes = Object.create(null);
  const lastLocalHashes = Object.create(null);
  let lastGameManagerRawHash = 0;
  const sessionWarnings = new Set();

  const quality = {
    mode: 'auto',
    step: 0,
    base: 1,
    scale: 1,
    width: VIEW_W,
    height: VIEW_H,
    fps: 0
  };

  const gpu = {
    renderer: '',
    vendor: '',
    software: false
  };

  const autoQuality = {
    lowSamples: 0,
    warmupUntil: 0,
    lastStepAt: 0,
    fallbackAt: 0,
    goodSeen: false,
    exhausted: false
  };

  let qualityMenuOpen = false;
  let fitQueued = false;
  let autoLayoutTimer = 0;
  let gameGl = null;

  // Mobile-only overlay controls. Created on coarse-pointer devices so the
  // desktop page keeps exactly the same DOM and behaviour as before.
  let mobileHud = null;
  let mobilePauseBtn = null;
  let mobileKeyboardBtn = null;
  let mobileMoveLeftBtn = null;
  let mobileMoveRightBtn = null;
  let softKeyboardInput = null;
  let softKeyboardActive = false;
  let softKeyboardComposing = false;
  let softKeyboardValue = '';
  let softKeyboardHintShown = false;
  let softKeyboardReadyShown = false;
  let softKeyboardHintTimer = 0;
  let lastPauseSentAt = 0;
  let mobileScenePollTimer = 0;
  let mobileMoveKeys = null;
  const MOBILE_MOVE_TAP_MS = 90;
  let mobileSceneUpdateQueued = false;
  let mobilePauseSceneTimer = 0;
  let mobileLevelEndTimer = 0;
  let mobilePauseWatchdog = 0;

  // The engine has no scene-state export, so the mobile HUD listens to its
  // WebAudio bridge. Music channels tell us reliably when a level starts,
  // pauses, resumes, or ends without touching the wasm build.
  const mobileAudio = {
    kinds: Object.create(null),
    levelChannel: 0,
    menuChannel: 0,
    pauseConfirmed: false,
    pauseIntentAt: 0
  };

  function createAssetState(total) {
    return {
      loaded: 0,
      total,
      done: false,
      speed: 0,
      lastLoaded: 0,
      lastTime: 0
    };
  }

  // -------------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------------

  const rawLog = [];
  let pendingLogs = [];
  let logFlushScheduled = false;

  if (!DEBUG) {
    try {
      console.log = console.info = console.debug = function () {};
    } catch (_) { /* ignore */ }
  }

  function isQuiet(text) {
    for (let i = 0; i < QUIET_PREFIXES.length; i++) {
      if (text.lastIndexOf(QUIET_PREFIXES[i], 0) === 0) return true;
    }
    return false;
  }

  function say(message) {
    const text = String(message);
    rawLog.push(text);
    if (rawLog.length > 8000) rawLog.splice(0, rawLog.length - 8000);

    // The level browser also draws progress bars, so this texture is not a
    // reliable level-start signal. Keep the diagnostic flag only; scene
    // detection below is driven by the actual music channels.
    if (/GJ_progressBar(?:_001)?[^\n]*\.png/i.test(text)) {
      state.mobileLevelTextureSeen = true;
    }

    if (DEBUG && !isQuiet(text)) {
      try { console.log(text); } catch (_) { /* ignore */ }
    }

    if (!DEBUG || !el.console) return;
    pendingLogs.push(text);
    if (pendingLogs.length > 300) pendingLogs = pendingLogs.slice(-300);
    if (!logFlushScheduled) {
      logFlushScheduled = true;
      requestAnimationFrame(flushLogs);
    }
  }

  function showToast(message, duration) {
    if (!el.toast) return;

    el.toast.textContent = message;
    el.toast.classList.add('is-visible');

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastTimer = 0;
      if (el.toast) el.toast.classList.remove('is-visible');
    }, duration || 3800);
  }

  function flushLogs() {
    logFlushScheduled = false;
    if (!pendingLogs.length || !el.console) return;

    const nearBottom =
      el.console.scrollHeight - el.console.scrollTop - el.console.clientHeight < 40;

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < pendingLogs.length; i++) {
      const line = document.createElement('div');
      line.textContent = pendingLogs[i];
      fragment.appendChild(line);
    }
    pendingLogs = [];

    el.console.appendChild(fragment);
    while (el.console.childNodes.length > 1600) {
      el.console.removeChild(el.console.firstChild);
    }
    if (nearBottom) el.console.scrollTop = el.console.scrollHeight;
  }

  window.gdLogDump = () => rawLog.join('\n');

  // -------------------------------------------------------------------------
  // Formatting
  // -------------------------------------------------------------------------

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function formatBytes(bytes) {
    if (!bytes || bytes < 0) return '0.0 MB';
    return (bytes / 1000000).toFixed(1) + ' MB';
  }

  function formatSpeed(bytesPerSecond) {
    if (!bytesPerSecond || bytesPerSecond < 1) return '';
    if (bytesPerSecond >= 1000000) {
      return (bytesPerSecond / 1000000).toFixed(1) + ' MB/s';
    }
    return Math.max(1, Math.round(bytesPerSecond / 1000)) + ' KB/s';
  }

  function percent(loaded, total) {
    if (!total) return 0;
    return clamp((loaded / total) * 100, 0, 100);
  }

  // -------------------------------------------------------------------------
  // Render quality + canvas fit
  // -------------------------------------------------------------------------

  function isFullscreen() {
    return Boolean(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    );
  }

  function fullscreenTarget() {
    // Fullscreen the document on touch devices. The in-game rail and the
    // compact tool dock are body-level elements, so fullscreening #stage would
    // hide every mobile control.
    if (IS_COARSE) return document.documentElement;
    return el.stage || el.canvas;
  }

  function quantizeScale(value) {
    return Math.round(clamp(value, MIN_RENDER_SCALE, 1) * 20) / 20;
  }

  function canvasAvailableBox() {
    const full = isFullscreen();
    const stage = el.stage;

    if (stage && stage.clientWidth > 2 && stage.clientHeight > 2) {
      let padX = 0;
      let padY = 0;
      try {
        const style = getComputedStyle(stage);
        padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
        padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      } catch (_) { /* ignore */ }

      return {
        width: Math.max(0, stage.clientWidth - padX),
        height: Math.max(0, stage.clientHeight - padY),
        full
      };
    }

    return { width: window.innerWidth, height: window.innerHeight, full };
  }

  function fitSizeFor(width, height, allowUpscale) {
    if (!width || !height) return { width: VIEW_W, height: VIEW_H };

    let fittedWidth = allowUpscale ? width : Math.min(width, VIEW_W);
    let fittedHeight = (fittedWidth * VIEW_H) / VIEW_W;

    if (fittedHeight > height) {
      fittedHeight = height;
      fittedWidth = (fittedHeight * VIEW_W) / VIEW_H;
    }

    return { width: fittedWidth, height: fittedHeight };
  }

  // What the canvas would need to render at 1:1 with the screen. On a
  // 1440x900 window this lands around 70%, which is a ~2x pixel saving with
  // no visible loss because the canvas is displayed at that size anyway.
  function displayScaleTarget() {
    const box = canvasAvailableBox();
    const fitted = fitSizeFor(box.width, box.height, box.full);
    const density = Math.min(window.devicePixelRatio || 1, 2);
    return quantizeScale((fitted.width * density) / VIEW_W);
  }

  function autoBaseScale() {
    let base = displayScaleTarget();

    // A slightly conservative ceiling keeps the first frames cheap while
    // remaining visually 1:1 on most windows.
    base = Math.min(base, 0.9);

    // Software rasterizers need a much lower starting point.
    if (gpu.software) base = Math.min(base, 0.5);

    // Phones and tablets benefit from a little extra thermal headroom.
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      base = Math.min(base, 0.7);
    }

    return quantizeScale(base);
  }

  function currentRenderScale() {
    if (quality.mode === 'auto') {
      return quantizeScale(quality.base * AUTO_STEPS[quality.step]);
    }

    const mode = QUALITY_MODES[quality.mode];
    return quantizeScale(mode && mode.scale ? mode.scale : 1);
  }

  function fitCanvas() {
    if (!el.canvas) return;

    const box = canvasAvailableBox();
    if (box.width < 2 || box.height < 2) return;

    const fitted = fitSizeFor(box.width, box.height, box.full);
    const cssWidth = Math.max(160, Math.round(fitted.width));
    const cssHeight = Math.max(90, Math.round((cssWidth * VIEW_H) / VIEW_W));

    el.canvas.style.width = cssWidth + 'px';
    el.canvas.style.height = cssHeight + 'px';
    refreshCanvasRect();
  }

  // Cached because the mouse/touch bridge asks for the canvas bounds on every
  // pointer move. Reading getBoundingClientRect() there forces style/layout
  // work at input frequency even though the canvas only moves on resize.
  let cachedCanvasRect = null;

  function refreshCanvasRect() {
    if (!el.canvas) {
      cachedCanvasRect = null;
      return null;
    }

    const rect = el.canvas.getBoundingClientRect();
    cachedCanvasRect = {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    };
    return cachedCanvasRect;
  }

  function canvasRect() {
    return cachedCanvasRect || refreshCanvasRect() ||
      { left: 0, top: 0, right: VIEW_W, bottom: VIEW_H, width: VIEW_W, height: VIEW_H };
  }

  function applyQualityScale(reason) {
    const scale = currentRenderScale();
    const width = Math.max(2, Math.round((VIEW_W * scale) / 2) * 2);
    const height = Math.max(2, Math.round((VIEW_H * scale) / 2) * 2);

    quality.scale = width / VIEW_W;
    quality.width = width;
    quality.height = height;

    if (el.canvas && (el.canvas.width !== width || el.canvas.height !== height)) {
      el.canvas.width = width;
      el.canvas.height = height;

      // Resizing the drawing buffer does not reset the GL viewport/scissor.
      // The game only sets its full-screen viewport occasionally, so restore
      // it ourselves when the backing store changes mid-session.
      syncGlViewport();
    }

    fitCanvas();
    updateQualityUI();
    updateFpsQuality();

    say(
      '[quality] ' + quality.mode + ' ' + width + 'x' + height +
      ' (' + Math.round(quality.scale * 100) + '%)' +
      (reason ? ' · ' + reason : '')
    );
  }

  function qualityOptionResolution(mode) {
    if (mode === 'auto') return 'Adaptive';
    const scale = QUALITY_MODES[mode].scale || 1;
    return Math.round(VIEW_W * scale) + '×' + Math.round(VIEW_H * scale);
  }

  function loadQualityPreference() {
    let fromUrl = '';
    try {
      fromUrl = (new URLSearchParams(location.search).get('quality') || '').toLowerCase();
    } catch (_) { /* ignore */ }

    if (QUALITY_MODES[fromUrl]) {
      quality.mode = fromUrl;
      return;
    }

    try {
      const saved = localStorage.getItem(QUALITY_KEY);
      if (QUALITY_MODES[saved]) quality.mode = saved;
    } catch (_) { /* ignore */ }
  }

  function buildQualityMenu() {
    if (!el.qualityOptions || el.qualityOptions.childElementCount) return;

    el.qualityOptions.innerHTML = QUALITY_ORDER.map((id) => {
      const mode = QUALITY_MODES[id];
      return (
        '<button type="button" class="quality-option" role="radio" ' +
        'aria-checked="false" tabindex="-1" data-mode="' + id + '" ' +
        'data-res="' + qualityOptionResolution(id) + '">' +
        '<span class="quality-radio" aria-hidden="true"></span>' +
        '<span class="quality-copy">' +
        '<span class="quality-option-name">' + mode.label + '</span>' +
        '<span class="quality-option-desc">' + mode.desc + '</span>' +
        '</span>' +
        '<span class="quality-option-res">' + qualityOptionResolution(id) + '</span>' +
        '</button>'
      );
    }).join('');

    el.qualityOptions.addEventListener('click', (event) => {
      const button = event.target && event.target.closest
        ? event.target.closest('[data-mode]')
        : null;
      if (!button) return;

      event.preventDefault();
      event.stopPropagation();
      selectQuality(button.dataset.mode, true);
      setQualityMenu(false, true);
    });
  }

  function selectQuality(mode, persist) {
    if (!QUALITY_MODES[mode]) return;

    quality.mode = mode;

    if (mode === 'auto') {
      quality.step = 0;
      quality.base = autoBaseScale();
    } else {
      quality.step = 0;
    }

    autoQuality.lowSamples = 0;
    autoQuality.lastStepAt = 0;
    autoQuality.exhausted = false;
    autoQuality.goodSeen = false;
    autoQuality.warmupUntil = performance.now() + 1500;
    autoQuality.fallbackAt = performance.now() + 3000;

    applyQualityScale('selected');

    if (persist) {
      try { localStorage.setItem(QUALITY_KEY, mode); } catch (_) { /* ignore */ }
    }

    say('[quality] mode=' + mode);
  }

  function updateQualityUI() {
    if (!el.qualityBtn) return;

    const mode = QUALITY_MODES[quality.mode] || QUALITY_MODES.auto;
    const pct = Math.round(quality.scale * 100);

    if (el.qualityLabel) el.qualityLabel.textContent = mode.label;
    if (el.qualityScale) el.qualityScale.textContent = pct + '%';
    if (el.qualityRes) {
      el.qualityRes.textContent = quality.width + ' × ' + quality.height;
    }

    el.qualityBtn.classList.toggle(
      'is-adapted',
      quality.mode === 'auto' && quality.step > 0
    );

    el.qualityBtn.setAttribute(
      'aria-label',
      'Render quality: ' + mode.label + ' (' + pct + '%)'
    );

    el.qualityBtn.title =
      'Render quality: ' + mode.label + ' · ' +
      quality.width + '×' + quality.height + ' (' + pct + '%)' +
      (gpu.renderer ? ' · ' + gpu.renderer : '');

    if (el.qualityOptions) {
      const options = el.qualityOptions.querySelectorAll('[data-mode]');
      for (let i = 0; i < options.length; i++) {
        const button = options[i];
        const active = button.dataset.mode === quality.mode;
        button.setAttribute('aria-checked', String(active));
        button.tabIndex = active ? 0 : -1;

        const res = button.querySelector('.quality-option-res');
        if (res) {
          res.textContent = active
            ? quality.width + '×' + quality.height
            : button.dataset.res;
        }
      }
    }

    if (el.qualityNote) {
      let note;
      if (quality.mode === 'auto') {
        if (quality.step > 0) {
          note =
            'Auto lowered the internal resolution to ' + pct +
            '% to protect the frame rate. Choose Auto again to retry full quality.';
        } else {
          note =
            'Auto matches your display (' + quality.width + '×' + quality.height +
            ') and steps down if FPS falls below ' + LOW_FPS + '.';
        }
      } else {
        note =
          mode.label + ' is pinned at ' + quality.width + '×' + quality.height +
          '. ' + mode.desc + '.';
      }

      if (gpu.software) {
        note += ' Software rendering detected — Auto is recommended.';
      }

      el.qualityNote.textContent = note;
    }

    if (el.qualityGpu) {
      if (gpu.renderer) {
        el.qualityGpu.textContent =
          (gpu.software ? 'Software renderer: ' : 'GPU: ') + gpu.renderer;
        el.qualityGpu.title = gpu.renderer;
      } else {
        el.qualityGpu.textContent = 'GPU: not reported by this browser';
        el.qualityGpu.title = '';
      }
    }
  }

  function updateFpsQuality() {
    if (!el.fps) return;

    const fps = quality.fps;
    const measuring = state.live && performance.now() - state.liveAt < 4000;

    el.fps.classList.toggle('is-measuring', measuring);
    el.fps.classList.toggle('is-good', !measuring && fps >= 56);
    el.fps.classList.toggle('is-warn', !measuring && fps >= 40 && fps < 56);
    el.fps.classList.toggle('is-bad', !measuring && fps > 0 && fps < 40);
    el.fps.title = measuring
      ? 'Measuring frame rate…'
      : Math.round(fps) + ' fps · ' + quality.width + '×' + quality.height +
        ' · ' + (QUALITY_MODES[quality.mode] || QUALITY_MODES.auto).label;
  }

  function setQualityMenu(open, returnFocus) {
    if (!el.qualityMenu || !el.qualityBtn) return;

    qualityMenuOpen = open;
    el.qualityMenu.hidden = !open;
    el.qualityBtn.setAttribute('aria-expanded', String(open));
    el.qualityBtn.classList.toggle('is-open', open);
    if (el.midbar) el.midbar.classList.toggle('is-open', open);

    if (open) {
      const active = el.qualityOptions
        ? el.qualityOptions.querySelector('[data-mode="' + quality.mode + '"]')
        : null;
      if (active) {
        try { active.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
      }
    } else if (returnFocus) {
      try { el.qualityBtn.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    }
  }

  function moveQualityFocus(direction) {
    if (!el.qualityOptions) return;
    const options = Array.prototype.slice.call(
      el.qualityOptions.querySelectorAll('[data-mode]')
    );
    if (!options.length) return;

    const index = options.indexOf(document.activeElement);
    let next = index;

    if (direction === 'home') next = 0;
    else if (direction === 'end') next = options.length - 1;
    else if (direction === 'down') next = (index + 1 + options.length) % options.length;
    else next = (index - 1 + options.length) % options.length;

    try { options[next].focus({ preventScroll: true }); } catch (_) { /* ignore */ }
  }

  function setupQualityUI() {
    buildQualityMenu();

    if (el.qualityBtn) {
      el.qualityBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setQualityMenu(!qualityMenuOpen, !qualityMenuOpen);
      });

      el.qualityBtn.addEventListener('mousedown', (event) => {
        event.stopPropagation();
      });

      el.qualityBtn.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowDown' || qualityMenuOpen) return;
        event.preventDefault();
        setQualityMenu(true, false);
      });
    }

    document.addEventListener('pointerdown', (event) => {
      if (!qualityMenuOpen) return;
      if (el.qualityBtn && el.qualityBtn.contains(event.target)) return;
      if (el.qualityMenu && el.qualityMenu.contains(event.target)) return;
      setQualityMenu(false, false);
    }, true);

    document.addEventListener('keydown', (event) => {
      if (!qualityMenuOpen) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setQualityMenu(false, true);
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' ||
          event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        event.stopPropagation();
        moveQualityFocus(
          event.key === 'ArrowDown' ? 'down'
            : event.key === 'ArrowUp' ? 'up'
              : event.key === 'Home' ? 'home' : 'end'
        );
      }
    }, true);

    updateQualityUI();
  }

  function scheduleFit() {
    if (fitQueued) return;
    fitQueued = true;

    requestAnimationFrame(() => {
      fitQueued = false;
      fitCanvas();
      positionMobileHud();

      if (quality.mode !== 'auto') return;

      // Only re-evaluate the backing resolution after the window has settled
      // so dragging a window edge does not thrash the GL drawing buffer.
      if (autoLayoutTimer) clearTimeout(autoLayoutTimer);
      autoLayoutTimer = setTimeout(() => {
        autoLayoutTimer = 0;
        if (quality.mode !== 'auto') return;
        const base = autoBaseScale();
        if (base !== quality.base) {
          quality.base = base;
          applyQualityScale('resize');
        } else {
          fitCanvas();
        }
      }, 180);
    });
  }

  function setupCanvasLayout() {
    window.addEventListener('resize', scheduleFit, { passive: true });
    window.addEventListener('orientationchange', scheduleFit, { passive: true });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', scheduleFit, { passive: true });
    }

    document.addEventListener('fullscreenchange', scheduleFit);
    document.addEventListener('webkitfullscreenchange', scheduleFit);
    document.addEventListener('mozfullscreenchange', scheduleFit);
    document.addEventListener('MSFullscreenChange', scheduleFit);

    if (el.stage && 'ResizeObserver' in window) {
      try {
        new ResizeObserver(scheduleFit).observe(el.stage);
      } catch (_) { /* ignore */ }
    }

    fitCanvas();
  }

  // -------------------------------------------------------------------------
  // Progress model
  // -------------------------------------------------------------------------

  function setStatusLine(text) {
    state.status = text;
    if (el.statusText) el.statusText.textContent = text;
  }

  function setBoot(value, text) {
    state.boot = Math.max(state.boot, clamp(value, 0, 100));
    if (text) setStatusLine(text);
    scheduleRender();
  }

  function resetAsset(key) {
    const asset = state.assets[key];
    if (!asset) return;
    asset.loaded = 0;
    asset.speed = 0;
    asset.lastLoaded = 0;
    asset.lastTime = 0;
    asset.done = false;
    scheduleRender();
  }

  function updateAsset(key, loaded, total, complete) {
    const asset = state.assets[key];
    if (!asset) return;

    if (total > 0) asset.total = total;

    if (loaded < asset.loaded) {
      asset.lastLoaded = loaded;
      asset.lastTime = performance.now();
      asset.speed = 0;
    }

    const now = performance.now();
    if (!asset.lastTime) {
      asset.lastTime = now;
      asset.lastLoaded = loaded;
    }

    const elapsed = now - asset.lastTime;
    if (elapsed >= 350) {
      const instant = (loaded - asset.lastLoaded) / (elapsed / 1000);
      if (instant >= 0) {
        asset.speed = asset.speed
          ? asset.speed * 0.62 + instant * 0.38
          : instant;
      }
      asset.lastLoaded = loaded;
      asset.lastTime = now;
    }

    asset.loaded = Math.max(asset.loaded, loaded);

    if (complete || (asset.total > 0 && asset.loaded >= asset.total)) {
      asset.loaded = asset.total;
      asset.done = true;
      asset.speed = 0;
    }

    scheduleRender();
  }

  function finishAssets() {
    updateAsset('wasm', ASSETS.wasm.size, ASSETS.wasm.size, true);
    updateAsset('data', ASSETS.data.size, ASSETS.data.size, true);
  }

  function overallPercent() {
    const wasm = state.assets.wasm;
    const data = state.assets.data;
    const total = wasm.total + data.total;
    const loaded =
      Math.min(wasm.loaded, wasm.total) +
      Math.min(data.loaded, data.total);

    const assetShare = total > 0 ? loaded / total : 0;

    if (!wasm.done || !data.done) return assetShare * 88;
    return 88 + (state.boot / 100) * 12;
  }

  function scheduleRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => {
      state.renderQueued = false;
      renderProgress();
    });
  }

  function renderProgress() {
    const wasm = state.assets.wasm;
    const data = state.assets.data;
    const overall = state.live ? 100 : overallPercent();

    if (el.overallFill) el.overallFill.style.width = overall.toFixed(2) + '%';
    if (el.overallPct) {
      el.overallPct.textContent = overall >= 99.95
        ? '100%'
        : Math.floor(overall) + '%';
    }
    if (el.overallBar) {
      el.overallBar.setAttribute('aria-valuenow', String(Math.round(overall)));
    }

    renderAssetRow('wasm', wasm, {
      row: el.rowWasm,
      bar: el.wasmBar,
      fill: el.wasmFill,
      pct: el.wasmPct,
      detail: el.wasmDetail
    });

    renderAssetRow('data', data, {
      row: el.rowData,
      bar: el.dataBar,
      fill: el.dataFill,
      pct: el.dataPct,
      detail: el.dataDetail
    });

    if (el.loadHint && wasm.done && data.done) {
      el.loadHint.textContent = 'Assets loaded — booting the game…';
    }

    if (el.statusText && state.status) {
      el.statusText.textContent = state.status;
    }
  }

  function renderAssetRow(key, asset, dom) {
    const pct = asset.done ? 100 : percent(asset.loaded, asset.total);

    if (dom.fill) dom.fill.style.width = pct.toFixed(2) + '%';
    if (dom.pct) dom.pct.textContent = Math.round(pct) + '%';
    if (dom.bar) dom.bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    if (dom.row) dom.row.classList.toggle('is-done', asset.done);

    if (dom.detail) {
      if (asset.done) {
        dom.detail.textContent = formatBytes(asset.total) + ' · done';
      } else if (asset.loaded > 0) {
        const speed = formatSpeed(asset.speed);
        dom.detail.textContent =
          formatBytes(asset.loaded) + ' / ' + formatBytes(asset.total) +
          (speed ? ' · ' + speed : '');
      } else {
        dom.detail.textContent = formatBytes(asset.total);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Error reporting
  // -------------------------------------------------------------------------

  function showError(message, options) {
    if (state.quitting) return;

    const opts = options || {};
    const text = String(message || 'Unknown error');

    // Avoid stacking the same failure repeatedly.
    if (state.errorVisible && state.lastError === text) return;

    state.errorVisible = true;
    state.lastError = text;
    state.phase = 'error';

    if (el.errTitle) el.errTitle.textContent = opts.title || 'Something went wrong';
    if (el.errText) el.errText.textContent = text;
    if (el.errReload) el.errReload.hidden = opts.retry === false;
    if (el.errOverlay) {
      el.errOverlay.hidden = false;
      el.errOverlay.classList.add('is-on');
    }

    say('[error] ' + text);
  }

  function hideError() {
    state.errorVisible = false;
    state.lastError = '';
    if (el.errOverlay) {
      el.errOverlay.hidden = true;
      el.errOverlay.classList.remove('is-on');
    }
  }

  // -------------------------------------------------------------------------
  // CORS proxy bridge (Boomlings online features)
  // -------------------------------------------------------------------------

  function installProxy() {
    const nativeFetch = window.fetch.bind(window);
    window.nativeFetch = nativeFetch;

    window.__gdProxyBases = PROXY_BASES.slice();
    window.__gdProxyBase = PROXY_BASES[0];
    window.__gdProxyPass = PROXY_PASS.slice();

    try {
      const cached = localStorage.getItem('gdProxyBase');
      if (cached && (
        cached.includes('corsfix') ||
        cached.includes('freeboard') ||
        cached.includes('test.cors') ||
        cached.includes('allorigins')
      )) {
        localStorage.removeItem('gdProxyBase');
      }
    } catch (_) { /* ignore */ }

    function targetFor(url) {
      if (typeof url !== 'string') return null;

      for (let i = 0; i < PROXY_BASES.length; i++) {
        if (url.indexOf(PROXY_BASES[i]) === 0) return null;
      }

      const marker = '/__proxy?url=';
      const markerAt = url.indexOf(marker);
      if (markerAt >= 0) {
        const encoded = url.slice(markerAt + marker.length);
        try { return decodeURIComponent(encoded); } catch (_) { return encoded; }
      }

      if (url.includes('boomlings.com')) return url;

      if (/^https?:\/\//i.test(url)) {
        try {
          const parsed = new URL(url);
          if (parsed.origin === location.origin) return null;
          for (let p = 0; p < PROXY_PASS.length; p++) {
            if (parsed.hostname.indexOf(PROXY_PASS[p]) >= 0) return null;
          }
          return url;
        } catch (_) {
          return null;
        }
      }

      return null;
    }

    function buildProxyUrl(base, target) {
      if (target.startsWith('http://www.boomlings.com')) {
        target = target.replace('http://', 'https://');
      }
      return base + target;
    }

    function isMediaTarget(target) {
      return /\.(mp3|ogg|wav|m4a|aac|flac)(?:[?#]|$)/i.test(String(target || ''));
    }

    function looksLikeAudio(bytes) {
      if (!bytes || bytes.length < 4) return false;
      const b = bytes;

      if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true; // ID3
      if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return true; // OggS
      if (b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43) return true; // fLaC
      if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return true; // RIFF
      if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return true; // MP3/AAC frame sync
      if (b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 &&
          b[6] === 0x79 && b[7] === 0x70) return true; // M4A ftyp
      return false;
    }

    async function responseIsUsable(response, target) {
      if (!response) return false;
      if (RETRYABLE_STATUS.has(response.status)) return false;

      const type = String(response.headers.get('content-type') || '').toLowerCase();
      const html = type.indexOf('text/html') >= 0;
      const texty = html ||
        type.indexOf('text/plain') >= 0 ||
        type.indexOf('application/json') >= 0 ||
        type.indexOf('text/xml') >= 0 ||
        type.indexOf('application/xml') >= 0;

      if (isMediaTarget(target)) {
        // Media must never be a proxy error page. Some proxies label errors
        // as text/html with a 200 status, which used to poison the first
        // download attempt.
        if (texty) return false;

        const generic = !type ||
          (type.indexOf('audio/') !== 0 &&
           type.indexOf('application/ogg') !== 0 &&
           type.indexOf('video/ogg') !== 0 &&
           type.indexOf('application/octet-stream') !== 0 &&
           type.indexOf('binary/octet-stream') !== 0);

        if (response.ok && generic) {
          try {
            const reader = response.clone().body.getReader();
            const chunk = await reader.read();
            try { reader.cancel(); } catch (_) { /* ignore */ }
            return Boolean(chunk && chunk.value && looksLikeAudio(chunk.value));
          } catch (_) {
            return true; // streaming is unavailable; let the decoder try
          }
        }

        return true;
      }

      // Boomlings serves its text protocol with a text/html content type, so
      // only reject a response that is unmistakably an HTML error page.
      if (response.ok && html) {
        try {
          const probe = (await response.clone().text()).slice(0, 300).trim().toLowerCase();
          if (probe.indexOf('<!doctype') === 0 || probe.indexOf('<html') === 0) {
            return false;
          }
        } catch (_) { /* keep the response */ }
      }

      return true;
    }

    function requestFor(url, input) {
      if (typeof Request !== 'undefined' && input instanceof Request) {
        try { return new Request(url, input.clone()); } catch (_) { return url; }
      }
      return url;
    }

    function attempt(input, init, target, index, round, lastError) {
      const base = PROXY_BASES[index];
      const url = buildProxyUrl(base, target);
      const request = requestFor(url, input);
      const options = Object.assign({}, init, { cache: 'no-store' });

      return nativeFetch(request, options).then(async (response) => {
        let usable = false;

        try {
          usable = await responseIsUsable(response, target);
        } catch (_) {
          usable = false;
        }

        if (!usable) {
          try { if (response.body) response.body.cancel(); } catch (_) { /* ignore */ }
          return nextAttempt(
            input, init, target, index, round,
            lastError || new Error('Proxy returned an unusable response')
          );
        }

        window.__gdProxyBase = base;
        return response;
      }, (error) => {
        return nextAttempt(input, init, target, index, round, error);
      });
    }

    function nextAttempt(input, init, target, index, round, lastError) {
      // A cold proxy worker usually recovers on an immediate retry. Songs are
      // much more likely to come from the primary worker than from the slow
      // public fallback, so media retries stay on the same base first.
      if (isMediaTarget(target)) {
        if (round + 1 < PROXY_ROUNDS) {
          return sleep(200 * (round + 1)).then(() => {
            return attempt(input, init, target, index, round + 1, lastError);
          });
        }

        if (index + 1 < PROXY_BASES.length) {
          return attempt(input, init, target, index + 1, 0, lastError);
        }

        throw lastError || new Error('Proxy request failed after retries');
      }

      if (index + 1 < PROXY_BASES.length) {
        return attempt(input, init, target, index + 1, round, lastError);
      }

      if (round + 1 < PROXY_ROUNDS) {
        return sleep(250 * (round + 1)).then(() => {
          return attempt(input, init, target, 0, round + 1, lastError);
        });
      }

      throw lastError || new Error('Proxy request failed after retries');
    }

    window.__gdProxyTarget = targetFor;
    window.__gdProxyBuild = buildProxyUrl;

    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url);
      if (!url) return nativeFetch(input, init);

      const target = targetFor(url);
      if (target === null) return nativeFetch(input, init);

      return attempt(input, init, target, 0, 0, null);
    };

    // Synchronous XHR fallback is used by the game's audio loader. It is the
    // first thing that touches a new song, so retry every proxy inline before
    // the game sees a failed download.
    if (typeof XMLHttpRequest !== 'undefined') {
      const nativeOpen = XMLHttpRequest.prototype.open;
      const nativeSend = XMLHttpRequest.prototype.send;
      const nativeOverrideMimeType = XMLHttpRequest.prototype.overrideMimeType;

      XMLHttpRequest.prototype.open = function (method, url) {
        const target = typeof url === 'string' ? targetFor(url) : null;
        const sync = arguments.length > 2 && arguments[2] === false;

        if (target !== null) {
          this.__gdProxyTarget = target;
          this.__gdProxyArgs = Array.prototype.slice.call(arguments);
          this.__gdProxySync = sync;
        } else {
          this.__gdProxyTarget = null;
          this.__gdProxyArgs = null;
          this.__gdProxySync = false;
        }

        if (target !== null && !sync) {
          arguments[1] = buildProxyUrl(window.__gdProxyBase || PROXY_BASES[0], target);
        }

        return nativeOpen.apply(this, arguments);
      };

      if (typeof nativeOverrideMimeType === 'function') {
        XMLHttpRequest.prototype.overrideMimeType = function (mime) {
          this.__gdProxyMime = mime;
          return nativeOverrideMimeType.apply(this, arguments);
        };
      }

      XMLHttpRequest.prototype.send = function (body) {
        const target = this.__gdProxyTarget;

        if (!target || !this.__gdProxySync) {
          return nativeSend.apply(this, arguments);
        }

        const args = this.__gdProxyArgs || [];
        let lastError = null;

        // Match the fetch path: retry the primary worker a few times before
        // waiting on the public fallback for a song.
        const attempts = [];
        if (isMediaTarget(target)) {
          for (let index = 0; index < PROXY_BASES.length; index++) {
            for (let round = 0; round < PROXY_ROUNDS; round++) {
              attempts.push([index, round]);
            }
          }
        } else {
          for (let round = 0; round < PROXY_ROUNDS; round++) {
            for (let index = 0; index < PROXY_BASES.length; index++) {
              attempts.push([index, round]);
            }
          }
        }

        for (const [index] of attempts) {
          const base = PROXY_BASES[index];
          const url = buildProxyUrl(base, target);

          try {
            if (args.length > 4) {
              nativeOpen.call(this, args[0], url, false, args[3], args[4]);
            } else if (args.length > 3) {
              nativeOpen.call(this, args[0], url, false, args[3]);
            } else {
              nativeOpen.call(this, args[0], url, false);
            }

            if (this.__gdProxyMime && typeof nativeOverrideMimeType === 'function') {
              nativeOverrideMimeType.call(this, this.__gdProxyMime);
            }

            nativeSend.call(this, body);

            const status = this.status;
            const type = String(
              this.getResponseHeader('content-type') || ''
            ).toLowerCase();
            const audio = isMediaTarget(target);
            const texty = type.indexOf('text/html') >= 0 ||
              type.indexOf('text/plain') >= 0 ||
              type.indexOf('application/json') >= 0 ||
              type.indexOf('text/xml') >= 0 ||
              type.indexOf('application/xml') >= 0;

            let bad = RETRYABLE_STATUS.has(status);
            if (audio && texty) bad = true;

            if (!bad && audio && status === 200 && type &&
                type.indexOf('audio/') !== 0 &&
                type.indexOf('application/ogg') !== 0 &&
                type.indexOf('video/ogg') !== 0 &&
                type.indexOf('application/octet-stream') !== 0 &&
                type.indexOf('binary/octet-stream') !== 0) {
              let bytes = null;
              try {
                const text = this.responseText || '';
                const length = Math.min(text.length, 12);
                bytes = new Uint8Array(length);
                for (let i = 0; i < length; i++) {
                  bytes[i] = text.charCodeAt(i) & 255;
                }
              } catch (_) { /* ignore */ }
              if (bytes && bytes.length && !looksLikeAudio(bytes)) bad = true;
            }

            if (!bad && (status === 200 || (status === 0 && this.responseText))) {
              window.__gdProxyBase = base;
              return;
            }

            lastError = new Error('Proxy status ' + status + ' for ' + target);
          } catch (error) {
            lastError = error;
          }
        }

        throw lastError || new Error('Proxy request failed after retries');
      };
    }

    say('[proxy] bridge ready');
  }

  function requestPersistentStorage() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist()
          .then((granted) => say('[storage] persistent=' + granted))
          .catch(() => {});
      }
    } catch (_) { /* ignore */ }
  }

  // -------------------------------------------------------------------------
  // Module definition
  // -------------------------------------------------------------------------

  function createModule() {
    const Module = {
      canvas: el.canvas,
      gdInputQueue: [],
      gdCursorPos: [0, 0],
      dataFileDownloads: {},

      locateFile(path) {
        if (path === 'gd_web.data' || path.endsWith('/gd_web.data') ||
            path === 'gd_web.pkg' || path.endsWith('/gd_web.pkg')) {
          return ASSETS.data.url;
        }
        if (path === 'gd_web.wasm' || path.endsWith('/gd_web.wasm')) {
          return ASSETS.wasm.url;
        }
        return path;
      },

      instantiateWasm(imports, successCallback) {
        loadWasmWithRetry(imports)
          .then((result) => {
            successCallback(result.instance, result.module);
          })
          .catch((error) => {
            showError(
              'The WebAssembly engine failed to load.\n\n' +
              (error && error.message ? error.message : String(error)),
              { title: 'Engine load failed' }
            );
          });
        return {};
      },

      print(message) {
        say(message);
      },

      printErr(message) {
        say(message);
      },

      setStatus(text) {
        const value = String(text || '').trim();
        if (!value) return;

        setStatusLine(value);

        if (/^Running/i.test(value)) {
          finishAssets();
          setBoot(10, value);
        } else if (/^(Compiling|Preparing)/i.test(value)) {
          setBoot(Math.max(state.boot, 4), value);
        }
      },

      onRuntimeInitialized() {
        onRuntimeReady();
      },

      gdDataProgress(loaded, total) {
        updateAsset('data', loaded, total);
      },

      gdDataError(error) {
        onDataError(error);
      }
    };

    window.Module = Module;
    installMobileSceneHooks(Module);
    if (!DEBUG) Module.__gdNoLog = 1;
    moduleReady = true;
    return Module;
  }

  // -------------------------------------------------------------------------
  // Asset loading
  // -------------------------------------------------------------------------

  function getModule() {
    return window.Module;
  }

  async function fetchWasmResponse() {
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(ASSETS.wasm.url, { cache: 'default' });
        if (!response.ok) {
          const error = new Error(
            'HTTP ' + response.status + ' ' + (response.statusText || '')
          );
          error.status = response.status;
          throw error;
        }
        return response;
      } catch (error) {
        lastError = error;

        // A missing engine is permanent, so retrying a 404 only delays the
        // error. Keep retrying network errors, 5xx responses, and the
        // transient 408/429 statuses.
        const status = error && error.status;
        const permanent = status >= 400 && status < 500 &&
          status !== 408 && status !== 429;

        if (attempt < 3 && !permanent) {
          resetAsset('wasm');
          setStatusLine('Retrying engine download (' + attempt + '/3)…');
          await sleep(600 * attempt);
        } else {
          break;
        }
      }
    }

    throw lastError || new Error('Engine download failed');
  }

  function isGzipBytes(bytes) {
    return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  }

  function isWasmBytes(bytes) {
    return bytes.length >= 4 &&
      bytes[0] === 0x00 && bytes[1] === 0x61 &&
      bytes[2] === 0x73 && bytes[3] === 0x6d;
  }

  // Wrap a response body in a progress-tracking stream. The first chunk has
  // already been read when sniffing the response, so it is replayed first.
  function trackedBody(reader, firstChunk, total) {
    let loaded = 0;
    let pending = firstChunk && firstChunk.byteLength ? firstChunk : null;

    if (pending) {
      loaded = pending.byteLength;
      updateAsset('wasm', loaded, total);
    }

    return new ReadableStream({
      start(controller) {
        if (pending) {
          controller.enqueue(pending);
          pending = null;
        }
      },
      async pull(controller) {
        try {
          const step = await reader.read();
          if (step.done) {
            controller.close();
            return;
          }
          loaded += step.value.byteLength;
          updateAsset('wasm', loaded, total);
          controller.enqueue(step.value);
        } catch (error) {
          controller.error(error);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      }
    });
  }

  function wasmResponse(body) {
    // Forcing the MIME type means streaming compilation works even on static
    // servers that serve .wasm (or a decompressed stream) as octet-stream.
    return new Response(body, {
      headers: { 'Content-Type': 'application/wasm' }
    });
  }

  async function instantiateTracked(body, imports) {
    if (typeof WebAssembly.instantiateStreaming !== 'function') {
      const buffer = await new Response(body).arrayBuffer();
      return WebAssembly.instantiate(buffer, imports);
    }
    return WebAssembly.instantiateStreaming(wasmResponse(body), imports);
  }

  async function loadGzipWasm(imports) {
    const response = await fetchWasmResponse();
    const total = ASSETS.wasm.size;

    if (!response.body) {
      const compressed = new Uint8Array(await response.arrayBuffer());
      updateAsset('wasm', total, total, true);
      if (!isGzipBytes(compressed)) {
        if (!isWasmBytes(compressed)) {
          throw new Error('The server returned neither gzip nor WebAssembly data');
        }
        return WebAssembly.instantiate(compressed, imports);
      }
      const raw = await new Response(
        new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))
      ).arrayBuffer();
      return WebAssembly.instantiate(raw, imports);
    }

    const reader = response.body.getReader();
    const first = await reader.read();
    if (first.done) {
      throw new Error('The compressed engine response was empty');
    }

    const chunk = first.value;

    if (isWasmBytes(chunk)) {
      // Some hosts transparently add Content-Encoding: gzip to .gz files.
      // The browser has already decompressed the body in that case, so the
      // stream is valid WebAssembly and needs no second decompression pass.
      const body = trackedBody(reader, chunk, total);
      const result = await instantiateTracked(body, imports);
      updateAsset('wasm', total, total, true);
      return result;
    }

    if (!isGzipBytes(chunk)) {
      throw new Error('The server returned neither gzip nor WebAssembly data');
    }

    const body = trackedBody(reader, chunk, total);
    const decompressed = body.pipeThrough(new DecompressionStream('gzip'));
    const result = await instantiateTracked(decompressed, imports);
    updateAsset('wasm', total, total, true);
    return result;
  }

  async function loadWasm(imports) {
    if (!HAS_GZIP_STREAM) {
      throw new Error(
        'This browser cannot decompress the gzip engine. Update to a current ' +
        'version of Chrome, Edge, Firefox, or Safari and try again.'
      );
    }

    return loadGzipWasm(imports);
  }

  async function loadWasmWithRetry(imports) {
    let lastError = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await loadWasm(imports);
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          resetAsset('wasm');
          setStatusLine('Recompiling engine…');
          await sleep(700);
        }
      }
    }

    throw lastError || new Error('WebAssembly failed to compile');
  }

  function onDataError(error) {
    const message = error && error.message ? error.message : String(error);
    setStatusLine('Game data failed to load');
    showError(
      'The game data download failed.\n\n' + message +
      '\n\nCheck your connection, then reload the page. If the problem persists, the host may be missing data/gd_web.pkg.parts.json or one of its package parts.',
      { title: 'Download failed' }
    );
  }

  // -------------------------------------------------------------------------
  // Runtime + saves
  // -------------------------------------------------------------------------

  function onRuntimeReady() {
    const Module = getModule();
    if (!Module) return;

    window.__gdRuntimeReady = true;
    state.phase = 'booting';
    finishAssets();
    setBoot(12, 'Runtime ready — restoring saves…');

    if (!DEBUG) {
      try { if (Module._gd_log_set) Module._gd_log_set(0); } catch (_) { /* ignore */ }
    }
    if (NO_AUTOSAVE) {
      try { if (Module._gd_autosave_set) Module._gd_autosave_set(0); } catch (_) { /* ignore */ }
    }

    try {
      Module.FS.chdir('/Resources');
    } catch (error) {
      say('[fs] chdir failed: ' + error);
    }

    setTimeout(async () => {
      await restoreSaves();
      setBoot(30, 'Starting Geometry Dash…');

      try {
        const boot = Module._gd_boot();
        if (boot && typeof boot.then === 'function') {
          boot.then(() => {
            say('[boot] gd_boot resolved');
            setBoot(80, 'Booting game…');
            scheduleEntryFallback();
          }).catch((error) => {
            showError(
              'The game crashed during boot.\n\n' +
              (error && error.stack ? error.stack : String(error)),
              { title: 'Game crashed' }
            );
          });
        } else {
          setBoot(80, 'Booting game…');
          scheduleEntryFallback();
        }
      } catch (error) {
        showError(
          'The game crashed during startup.\n\n' +
          (error && error.stack ? error.stack : String(error)),
          { title: 'Game crashed' }
        );
      }
    }, 80);
  }

  function normalizeSaveName(name) {
    return String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
  }

  function isMediaSave(name) {
    return MEDIA_SAVE_RE.test(normalizeSaveName(name));
  }

  function isGameManagerSave(name) {
    const clean = normalizeSaveName(name);
    return clean === 'CCGameManager.dat' ||
      clean === 'AppData/CCGameManager.dat' ||
      clean === 'Resources/CCGameManager.dat';
  }

  function decodeSaveBytes(encoded) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function encodeSaveBytes(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    }
    return btoa(binary);
  }

  function localStorageAvailable() {
    try {
      const key = '__gd_storage_probe__';
      localStorage.setItem(key, '1');
      localStorage.removeItem(key);
      return true;
    } catch (_) {
      return false;
    }
  }

  function indexedDbAvailable() {
    try {
      return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch (_) {
      return false;
    }
  }

  function readSessionCookie() {
    try {
      const prefix = SESSION_COOKIE + '=';
      const items = String(document.cookie || '').split(';');

      for (let i = 0; i < items.length; i++) {
        const item = items[i].trim();
        if (item.indexOf(prefix) !== 0) continue;

        let value = item.slice(prefix.length);
        try { value = decodeURIComponent(value); } catch (_) { /* keep raw */ }
        return /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : '';
      }
    } catch (_) { /* ignore */ }

    return '';
  }

  function writeSessionCookie(id) {
    try {
      const secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = SESSION_COOKIE + '=' + encodeURIComponent(id) +
        '; Path=/; SameSite=Strict' + secure;
      return readSessionCookie() === id;
    } catch (_) {
      return false;
    }
  }

  function readHistorySession() {
    try {
      const state = history.state;
      const value = state && typeof state === 'object' ? state.gdwasmSession : '';
      return /^[A-Za-z0-9-]{8,64}$/.test(value || '') ? value : '';
    } catch (_) {
      return '';
    }
  }

  function writeHistorySession(id) {
    try {
      const current = history.state;
      const state = current && typeof current === 'object' ? current : {};
      state.gdwasmSession = id;
      history.replaceState(state, '', location.href);
    } catch (_) { /* ignore */ }
  }

  function newSessionId() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch (_) { /* fall through */ }

    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  function openSessionDb() {
    if (sessionDbUnavailable) {
      return Promise.reject(new Error('IndexedDB is unavailable'));
    }

    if (sessionDbPromise) return sessionDbPromise;

    if (!indexedDbAvailable()) {
      sessionDbUnavailable = true;
      return Promise.reject(new Error('IndexedDB is unavailable'));
    }

    sessionDbPromise = new Promise((resolve, reject) => {
      let request;

      try {
        request = indexedDB.open(SESSION_DB_NAME, SESSION_DB_VERSION);
      } catch (error) {
        reject(error);
        return;
      }

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(SESSION_STORE)) {
          const store = db.createObjectStore(SESSION_STORE, { keyPath: 'name' });
          store.createIndex(SESSION_INDEX, 'session', { unique: false });
        } else {
          const store = request.transaction.objectStore(SESSION_STORE);
          if (!store.indexNames.contains(SESSION_INDEX)) {
            store.createIndex(SESSION_INDEX, 'session', { unique: false });
          }
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          try { db.close(); } catch (_) { /* ignore */ }
          sessionDbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
      request.onblocked = () => reject(new Error('IndexedDB open blocked'));
    }).catch((error) => {
      sessionDbUnavailable = true;
      sessionDbPromise = null;
      say('[save] session database unavailable: ' + error);
      throw error;
    });

    return sessionDbPromise;
  }

  function sessionTransaction(db, mode, work) {
    return new Promise((resolve, reject) => {
      let transaction;

      try {
        transaction = db.transaction(SESSION_STORE, mode);
      } catch (error) {
        reject(error);
        return;
      }

      let result;

      try {
        result = work(transaction.objectStore(SESSION_STORE));
      } catch (error) {
        reject(error);
        return;
      }

      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    });
  }

  function deleteAllSessionRecords(db) {
    return sessionTransaction(db, 'readwrite', (store) => store.clear());
  }

  function readSessionRecords(db, id) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SESSION_STORE, 'readonly');
      const store = transaction.objectStore(SESSION_STORE);
      let request;

      try {
        request = store.index(SESSION_INDEX).getAll(IDBKeyRange.only(id));
      } catch (_) {
        request = store.getAll();
      }

      request.onsuccess = () => {
        const records = request.result || [];
        resolve(records.filter((record) => record.session === id));
      };
      request.onerror = () => reject(request.error || new Error('IndexedDB read failed'));
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB read failed'));
    });
  }

  function writeSessionRecord(db, record) {
    return sessionTransaction(db, 'readwrite', (store) => store.put(record));
  }

  async function ensureSession() {
    if (sessionId) return sessionId;

    let existing = readSessionCookie();

    if (!existing) {
      const fromHistory = readHistorySession();
      if (fromHistory) existing = fromHistory;
    }

    const fresh = !existing;
    const id = existing || newSessionId();
    sessionId = id;

    writeSessionCookie(id);
    writeHistorySession(id);

    let db = null;

    try {
      db = await openSessionDb();
    } catch (_) {
      return id;
    }

    // A new browser session starts with a clean store. A cookie (or the tab's
    // history state, when cookies are blocked) carries the id across reloads.
    if (fresh) {
      try {
        await deleteAllSessionRecords(db);
        say('[save] started a new browser session; cleared session data');
      } catch (error) {
        say('[save] could not clear old session data: ' + error);
      }
    }

    return id;
  }

  function sessionRecordBytes(value) {
    if (!value) return null;
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    try { return new Uint8Array(value); } catch (_) { return null; }
  }

  function warnSessionPersistence(message) {
    if (sessionWarningShown) return;
    sessionWarningShown = true;
    showToast(message, 12000);
  }

  function queueSessionWrite(name, bytes) {
    const clean = normalizeSaveName(name);
    if (!clean || !bytes || !bytes.length) return Promise.resolve();

    const copy = new Uint8Array(bytes);
    const hash = saveHash(copy);

    if (lastSessionHashes[clean] === hash) return Promise.resolve();
    lastSessionHashes[clean] = hash;

    const generation = sessionGeneration;
    sessionMemory.set(clean, { name: clean, bytes: copy, time: Date.now(), session: sessionId || '' });

    sessionWriteChain = sessionWriteChain.then(async () => {
      if (generation !== sessionGeneration) return;

      const id = await ensureSession();
      const current = sessionMemory.get(clean);
      if (!current || current.bytes !== copy) return;

      try {
        const db = await openSessionDb();
        await writeSessionRecord(db, {
          name: clean,
          bytes: copy,
          time: Date.now(),
          session: id
        });
      } catch (error) {
        if (lastSessionHashes[clean] === hash) delete lastSessionHashes[clean];
        say('[save] session write failed for ' + clean + ': ' + error);
        warnSessionPersistence(
          'Downloaded online data could not be stored for this session. ' +
          'It still works now, but may be lost on reload.'
        );
      }
    }).catch((error) => {
      say('[save] session queue failed: ' + error);
    });

    return sessionWriteChain;
  }

  async function flushSessionWrites() {
    try {
      await sessionWriteChain;
    } catch (_) { /* ignore */ }
  }

  function resetSessionIdentity() {
    sessionId = null;

    try {
      const secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = SESSION_COOKIE +
        '=; Path=/; Max-Age=0; SameSite=Strict' + secure;
    } catch (_) { /* ignore */ }

    try {
      const state = history.state;
      if (state && typeof state === 'object' && state.gdwasmSession) {
        delete state.gdwasmSession;
        history.replaceState(state, '', location.href);
      }
    } catch (_) { /* ignore */ }
  }

  async function clearSessionRecords() {
    await flushSessionWrites();
    sessionGeneration++;
    sessionMemory.clear();
    Object.keys(lastSessionHashes).forEach((key) => delete lastSessionHashes[key]);
    sessionWarningShown = false;

    try {
      const db = await openSessionDb();
      await deleteAllSessionRecords(db);
    } catch (error) {
      say('[save] session clear failed: ' + error);
    }

    resetSessionIdentity();
  }

  function saveHash(bytes) {
    let hash = 2166136261;

    for (let i = 0; i < bytes.length; i++) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
  }

  function gunzipBytes(bytes) {
    if (typeof DecompressionStream !== 'function') {
      return Promise.reject(new Error('DecompressionStream is unavailable'));
    }

    const stream = new Blob([bytes]).stream()
      .pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }

  function gzipBytes(bytes) {
    if (typeof CompressionStream !== 'function') {
      return Promise.reject(new Error('CompressionStream is unavailable'));
    }

    const stream = new Blob([bytes]).stream()
      .pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }

  // Remove one <k>key</k><value> pair from a plist without reserialising the
  // rest of the document. Downloaded levels are dictionaries, so the scanner
  // tracks nested <d> blocks.
  function removePlistKey(xml, key) {
    const marker = '<k>' + key + '</k>';
    const start = xml.indexOf(marker);
    if (start < 0) return xml;

    let cursor = start + marker.length;
    while (cursor < xml.length && /\s/.test(xml[cursor])) cursor++;
    if (cursor >= xml.length || xml[cursor] !== '<') return xml;

    const openEnd = xml.indexOf('>', cursor);
    if (openEnd < 0) return xml;

    let end = openEnd + 1;
    if (xml[openEnd - 1] !== '/') {
      const match = /^<([A-Za-z][\w.-]*)/.exec(xml.slice(cursor, openEnd + 1));
      if (!match) return xml;

      const tag = match[1];
      const closeTag = '</' + tag + '>';
      let depth = 1;
      let scan = openEnd + 1;

      while (depth > 0) {
        const closeAt = xml.indexOf(closeTag, scan);
        if (closeAt < 0) return xml;

        let nested = -1;
        let from = scan;

        while (true) {
          const at = xml.indexOf('<' + tag, from);
          if (at < 0 || at >= closeAt) break;

          const next = xml[at + tag.length + 1];
          const boundary = next === '>' || next === '/' || (next && /\s/.test(next));
          if (!boundary) {
            from = at + tag.length + 1;
            continue;
          }

          const nestedEnd = xml.indexOf('>', at);
          if (nestedEnd < 0 || nestedEnd >= closeAt) break;
          if (xml[nestedEnd - 1] === '/') {
            from = nestedEnd + 1;
            continue;
          }

          nested = at;
          break;
        }

        if (nested >= 0) {
          depth++;
          scan = nested + tag.length + 1;
        } else {
          depth--;
          scan = closeAt + closeTag.length;
          if (depth === 0) {
            end = scan;
            break;
          }
        }
      }
    }

    return xml.slice(0, start) + xml.slice(end);
  }

  async function filterGameManagerSave(bytes) {
    const xored = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      let value = bytes[i] ^ SAVE_XOR_KEY;
      if (value === 0x2d) value = 0x2b;
      else if (value === 0x5f) value = 0x2f;
      xored[i] = value;
    }

    let base64 = '';
    for (let i = 0; i < xored.length; i += 32768) {
      base64 += String.fromCharCode.apply(null, xored.subarray(i, i + 32768));
    }

    // Some engine saves are passed with trailing NUL padding and a stray
    // byte after it. The payload ends at the first NUL or at base64 padding.
    const nul = base64.indexOf('\0');
    if (nul >= 0) base64 = base64.slice(0, nul);
    base64 = base64.replace(/\s+/g, '');

    const pad = base64.indexOf('=');
    if (pad >= 0) {
      base64 = base64.slice(0, pad + (base64.charAt(pad + 1) === '=' ? 2 : 1));
    }

    const compressed = decodeSaveBytes(base64);
    const xmlBytes = await gunzipBytes(compressed);
    let xml = new TextDecoder().decode(xmlBytes);
    let removed = false;

    ONLINE_SAVE_KEYS.forEach((key) => {
      const marker = '<k>' + key + '</k>';
      if (xml.indexOf(marker) < 0) return;
      xml = removePlistKey(xml, key);
      removed = true;
    });

    if (!removed) {
      return { bytes, removed: false };
    }

    const gzipped = await gzipBytes(new TextEncoder().encode(xml));
    let binary = '';
    for (let i = 0; i < gzipped.length; i += 32768) {
      binary += String.fromCharCode.apply(null, gzipped.subarray(i, i + 32768));
    }

    const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
    const output = new Uint8Array(encoded.length);
    for (let i = 0; i < encoded.length; i++) {
      output[i] = encoded.charCodeAt(i) ^ SAVE_XOR_KEY;
    }

    return { bytes: output, removed: true };
  }

  function writeLocalSave(name, bytes) {
    const hash = saveHash(bytes);
    if (lastLocalHashes[name] === hash) return true;

    try {
      localStorage.setItem(SAVE_LS_PREFIX + name, encodeSaveBytes(bytes));
      localStorage.setItem(SAVE_LS_TIME_PREFIX + name, String(Date.now()));
      lastLocalHashes[name] = hash;
      return true;
    } catch (error) {
      noteSaveError(error);
      return false;
    }
  }

  function queueGameManagerPersist(name, bytes, force) {
    const hash = saveHash(bytes);
    if (!force && lastGameManagerRawHash === hash) return;
    lastGameManagerRawHash = hash;

    pendingGameManagerSave = { name, bytes };
    if (gameManagerFilterRunning) return;

    gameManagerFilterRunning = true;

    (async () => {
      while (pendingGameManagerSave) {
        const current = pendingGameManagerSave;
        pendingGameManagerSave = null;

        try {
          const result = await filterGameManagerSave(current.bytes);
          lastFilteredGameManager = result.bytes;
          writeLocalSave(current.name, result.bytes);
          if (result.removed && DEBUG) {
            say('[save] stripped downloaded online levels from persistent save');
          }
        } catch (error) {
          // Never persist the unfiltered save: it contains downloaded levels.
          lastGameManagerRawHash = 0;
          say('[save] online-data filter failed: ' + error);
          noteSaveError(error);
        }
      }

      gameManagerFilterRunning = false;
    })();
  }

  function persistSaveFile(name, bytes, options) {
    if (NO_AUTOSAVE || state.resetting) return;
    if (!bytes || !bytes.length) return;
    const clean = normalizeSaveName(name);
    if (!clean) return;

    if (isMediaSave(clean)) {
      queueSessionWrite(clean, bytes);
      return;
    }

    if (isGameManagerSave(clean)) {
      queueSessionWrite(clean, bytes);

      // During pagehide the async filter may not finish. Write the last
      // filtered copy first so normal progress is never left behind.
      if (options && options.mirror && lastFilteredGameManager) {
        writeLocalSave(clean, lastFilteredGameManager);
      }

      queueGameManagerPersist(clean, bytes);
      return;
    }

    writeLocalSave(clean, bytes);
  }

  function purgeLegacyMediaSaves() {
    const doomed = [];

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || key.indexOf(SAVE_LS_PREFIX) !== 0) continue;

        const name = normalizeSaveName(key.slice(SAVE_LS_PREFIX.length));
        if (isMediaSave(name)) doomed.push(name);
      }

      doomed.forEach((name) => {
        localStorage.removeItem(SAVE_LS_PREFIX + name);
        localStorage.removeItem(SAVE_LS_TIME_PREFIX + name);
      });
    } catch (_) { /* ignore */ }

    if (doomed.length) {
      say('[save] discarded ' + doomed.length + ' legacy music cache entry/entries');
    }
  }

  async function restoreLocalSaves() {
    const restored = new Set();
    const keys = [];

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.indexOf(SAVE_LS_PREFIX) === 0) keys.push(key);
      }
    } catch (_) {
      return restored;
    }

    for (const key of keys) {
      const name = normalizeSaveName(key.slice(SAVE_LS_PREFIX.length));
      if (!/^(AppData|Resources)\//.test(name)) continue;
      if (isMediaSave(name)) continue;

      try {
        const encoded = localStorage.getItem(key);
        if (!encoded) continue;

        let bytes = decodeSaveBytes(encoded);

        if (isGameManagerSave(name)) {
          try {
            const result = await filterGameManagerSave(bytes);
            bytes = result.bytes;
            lastFilteredGameManager = result.bytes;

            // Sanitise saves written by older builds that still contain
            // downloaded online levels.
            if (result.removed) writeLocalSave(name, result.bytes);
          } catch (error) {
            say('[save] could not sanitise existing CCGameManager.dat: ' + error);
          }
        }

        restoreFile(name, bytes);
        restored.add(name);
        lastLocalHashes[name] = saveHash(bytes);
        say('[save] restored localStorage: ' + name);
      } catch (error) {
        say('[save] localStorage restore failed: ' + name + ' · ' + error);
      }
    }

    return restored;
  }

  function purgeLegacySessionSaves() {
    const doomed = [];

    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && (
          key.indexOf('gdwasm_session:') === 0 ||
          key.indexOf('gdwasm_session_time:') === 0
        )) {
          doomed.push(key);
        }
      }

      doomed.forEach((key) => sessionStorage.removeItem(key));
    } catch (_) { /* sessionStorage may be blocked entirely */ }

    if (doomed.length) {
      say('[save] removed ' + doomed.length + ' legacy sessionStorage entry/entries');
    }
  }

  async function restoreSessionSaves() {
    const restored = new Set();
    let records = null;

    try {
      const id = await ensureSession();
      const db = await openSessionDb();
      records = await readSessionRecords(db, id);
    } catch (error) {
      say('[save] session restore unavailable: ' + error);
    }

    if (!records) {
      records = Array.from(sessionMemory.values());
    }

    if (!records.length) return restored;

    // Restore the level/profile data before music so the game has its song
    // list ready by the time it asks for audio.
    const ordered = records.slice().sort((a, b) => {
      return (isMediaSave(a && a.name) ? 1 : 0) - (isMediaSave(b && b.name) ? 1 : 0);
    });

    for (const record of ordered) {
      const name = normalizeSaveName(record && record.name);
      if (!name) continue;

      const bytes = sessionRecordBytes(record.bytes);
      if (!bytes || !bytes.length) continue;

      try {
        restoreFile(name, bytes);
        restored.add(name);
        lastSessionHashes[name] = saveHash(bytes);
        say('[save] restored session ' +
          (isMediaSave(name) ? 'music: ' : 'level data: ') + name);
      } catch (error) {
        say('[save] session restore failed: ' + name + ' · ' + error);
      }
    }

    return restored;
  }

  async function restoreSaves() {
    purgeLegacyMediaSaves();
    purgeLegacySessionSaves();

    const local = await restoreLocalSaves();
    const session = await restoreSessionSaves();

    if (local.size || session.size) {
      say('[save] restored ' + (local.size + session.size) + ' file(s)');
    } else {
      say('[save] no saved progress found');
    }
  }

  function restoreFile(key, data) {
    const Module = getModule();
    if (!Module || !Module.FS || !data || !data.byteLength) return;

    const clean = String(key).replace(/\\/g, '/').replace(/^\/+/, '');

    // The persistence callback labels saves as "AppData/...", but the game's
    // actual writable path is /Resources. Writing to /AppData would leave the
    // game reading a fresh profile on every boot.
    const path = clean.indexOf('AppData/') === 0
      ? '/Resources/' + clean.slice('AppData/'.length)
      : (clean.indexOf('Resources/') === 0 ? '/' + clean : '/Resources/' + clean);

    const parts = path.split('/').filter(Boolean);
    let current = '';

    for (let i = 0; i < parts.length - 1; i++) {
      current += '/' + parts[i];
      try {
        Module.FS.stat(current);
      } catch (_) {
        Module.FS.mkdir(current);
      }
    }

    Module.FS.writeFile(path, new Uint8Array(data));
  }

  function noteSaveError(error) {
    const message = error && error.message ? error.message : String(error || 'unknown error');
    say('[save] failed: ' + message);

    if (state.saveErrorShown || !state.live) return;
    state.saveErrorShown = true;
    showToast(
      'Progress could not be saved. Browser storage is full or blocked. ' +
      'Free up site storage, then reload before closing the tab.',
      12000
    );
  }

  function requestGameSave(force) {
    if (NO_AUTOSAVE || !state.live || state.resetting) return false;

    const Module = getModule();
    if (!Module || typeof Module._gd_request_save !== 'function') return false;

    const now = performance.now();
    const cooldown = force ? 250 : 1000;
    if (now - lastSaveRequestAt < cooldown) return false;
    lastSaveRequestAt = now;

    try {
      Module._gd_request_save();
      return true;
    } catch (error) {
      noteSaveError(error);
      return false;
    }
  }

  // The engine normally calls gd_js_persist_save() on its next frame after
  // requestGameSave(). If the tab is closing before that frame can run, mirror
  // the last files it already wrote to the virtual filesystem directly.
  function mirrorSaveFiles() {
    if (NO_AUTOSAVE || !state.live || state.resetting) return;

    const Module = getModule();
    if (!Module || !Module.FS) return;

    const files = [
      ['AppData/CCGameManager.dat', '/Resources/CCGameManager.dat'],
      ['AppData/CCLocalLevels.dat', '/Resources/CCLocalLevels.dat']
    ];

    files.forEach(([name, path]) => {
      try {
        if (!Module.FS.analyzePath(path).exists) return;
        const data = Module.FS.readFile(path);
        if (!data || !data.length) return;
        persistSaveFile(name, data, { mirror: true });
      } catch (error) {
        noteSaveError(error);
      }
    });
  }

  function flushGameSave() {
    requestGameSave(true);
    mirrorSaveFiles();
  }

  // The native quit cross ends its shutdown path in abort(). The WASM and the
  // runtime are patched so that path calls this handler instead of tearing the
  // runtime down. Save synchronously, then return to the launcher. Browsers do
  // not let a page close a tab it did not open, so a reload is the closest
  // equivalent to quitting the desktop game.
  function handleNativeQuit(message) {
    if (state.quitting) return;
    state.quitting = true;
    say('[quit] ' + message);

    stopAutosave();
    flushGameSave();
    releaseWakeLock();

    // Give the engine's next frame a moment to run its normal save before the
    // page navigates away. The synchronous mirror above already covers it.
    setTimeout(() => {
      flushSessionWrites().finally(() => {
        try { location.reload(); } catch (_) { /* ignore */ }
      });
    }, 300);
  }

  function stopAutosave() {
    if (!autosaveTimer) return;
    clearInterval(autosaveTimer);
    autosaveTimer = 0;
  }

  function startAutosave() {
    stopAutosave();
    if (NO_AUTOSAVE) return;

    autosaveTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') requestGameSave(false);
    }, AUTOSAVE_INTERVAL_MS);
  }

  // -------------------------------------------------------------------------
  // Screen wake lock
  // -------------------------------------------------------------------------

  let wakeLock = null;
  let wakeLockPending = false;

  async function acquireWakeLock() {
    if (!IS_TOUCH || !state.live) return;
    if (!navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') return;
    if (document.visibilityState !== 'visible') return;
    if (wakeLockPending || (wakeLock && !wakeLock.released)) return;

    wakeLockPending = true;

    try {
      const lock = await navigator.wakeLock.request('screen');
      wakeLock = lock;
      say('[wake] screen wake lock active');

      lock.addEventListener('release', () => {
        if (wakeLock === lock) wakeLock = null;
      });
    } catch (error) {
      // Low battery mode and some embedded browsers reject wake locks. The
      // game remains fully playable; the screen may simply dim normally.
      say('[wake] ' + (error && error.message ? error.message : String(error)));
    } finally {
      wakeLockPending = false;
    }
  }

  function releaseWakeLock() {
    const lock = wakeLock;
    wakeLock = null;
    if (!lock) return;

    try {
      const result = lock.release();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) { /* ignore */ }
  }

  function setupWakeLock() {
    if (!navigator.wakeLock) return;

    // The browser drops the lock whenever the page is hidden; grab a fresh one
    // when the player returns so a long level cannot be interrupted by the
    // screen turning off.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') acquireWakeLock();
    });

    window.addEventListener('pagehide', releaseWakeLock);
  }

  function setupSaveLifecycle() {
    // Browsers often skip unload handlers on mobile. Requesting a save when
    // the tab becomes hidden covers app switching and tab closing alike.
    function flushAllSaves() {
      flushGameSave();
      flushSessionWrites();
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushAllSaves();
    });

    document.addEventListener('freeze', flushAllSaves);

    window.addEventListener('pagehide', flushAllSaves);
    window.addEventListener('beforeunload', flushAllSaves);
    window.addEventListener('blur', () => requestGameSave(false));

    // The engine dispatches this when its localStorage write fails (quota,
    // private mode, site data disabled). Keep the game running but warn loudly.
    window.addEventListener('gd-save-error', (event) => {
      noteSaveError(event && event.detail ? event.detail : 'localStorage write failed');
    });
  }

  // -------------------------------------------------------------------------
  // Boot + transition
  // -------------------------------------------------------------------------

  function scheduleEntryFallback() {
    if (entryFallbackTimer) clearTimeout(entryFallbackTimer);
    entryFallbackTimer = setTimeout(() => {
      entryFallbackTimer = null;
      if (state.live) return;

      let frames = 0;
      try {
        const Module = getModule();
        if (Module && Module._gd_frames_get) frames = Module._gd_frames_get() | 0;
      } catch (_) { /* ignore */ }

      if (frames > 0) {
        if (!state.readyScheduled) firstFrame();
        return;
      }

      // The engine is alive but has not drawn anything yet. Keep the loader
      // visible instead of dropping the player into a black, unresponsive page.
      setStatusLine('Waiting for the game to render…');
      scheduleEntryFallback();
    }, 8000);
  }

  function firstFrame() {
    if (state.live || state.readyScheduled) return;
    state.readyScheduled = true;

    if (entryFallbackTimer) {
      clearTimeout(entryFallbackTimer);
      entryFallbackTimer = null;
    }

    finishAssets();
    state.phase = 'ready';
    state.warmupStatusShown = false;

    warmupStartedAt = performance.now();
    warmupFrames = 0;
    warmupStableAt = 0;

    setBoot(100, 'Warming up the game…');

    if (el.readyPanel) el.readyPanel.hidden = false;
  }

  function updateWarmup(now, delta, recentFps) {
    if (!state.readyScheduled || state.live) return;

    if (!warmupStartedAt) warmupStartedAt = now;

    if (delta > 0) {
      warmupFrames += delta;
      if (!warmupStableAt) warmupStableAt = now;
    } else {
      // A sample with no new frames means the main thread was busy uploading
      // textures. Restart the stability window so the player never sees it.
      warmupStableAt = 0;
    }

    const elapsed = now - warmupStartedAt;
    const stableFor = warmupStableAt ? now - warmupStableAt : 0;
    const healthy = recentFps >= 50;

    if (!state.warmupStatusShown && elapsed >= 1200) {
      state.warmupStatusShown = true;
      setStatusLine('Finalising textures…');
    }

    if ((warmupFrames >= WARMUP_MIN_FRAMES &&
         stableFor >= WARMUP_STABLE_MS &&
         elapsed >= WARMUP_MIN_MS &&
         (healthy ||
          (elapsed >= WARMUP_FALLBACK_MS && warmupFrames >= 120 && recentFps >= 30))) ||
        (elapsed >= WARMUP_HARD_LIMIT_MS && delta > 0)) {
      enterGame();
    }
  }

  function enterGame() {
    if (state.live) return;
    state.live = true;
    setMobileHudScene('menu');
    state.liveAt = performance.now();

    startAutosave();
    acquireWakeLock();

    autoQuality.lowSamples = 0;
    autoQuality.lastStepAt = 0;
    autoQuality.exhausted = false;
    autoQuality.goodSeen = false;
    autoQuality.warmupUntil = performance.now() + 1500;
    autoQuality.fallbackAt = performance.now() + 3000;

    el.body.classList.remove('is-loading');
    el.body.classList.add('is-live');
    if (el.start) el.start.classList.add('is-hidden');

    fitCanvas();
    positionMobileHud();
    updateRotateHint();

    setTimeout(() => {
      if (el.start) el.start.hidden = true;

      // The animated/blurred loader backdrop is no longer visible. Drop the
      // DOM node so the large JPEG and its compositor layers can be reclaimed.
      if (el.bg) {
        el.bg.remove();
        el.bg = null;
      }
    }, 700);

    setTimeout(() => {
      window.__gdInputReady = true;
      if (window.__gdAckFocus) window.__gdAckFocus();
      fitCanvas();
      try { el.canvas.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    }, 720);

    if (state.storageBroken) {
      setTimeout(() => {
        showToast(
          'Browser storage is blocked, so progress cannot be saved. ' +
          'Allow site data (or leave private mode), then reload.',
          12000
        );
      }, 900);
    }
  }

  // -------------------------------------------------------------------------
  // FPS + first-frame detection
  // -------------------------------------------------------------------------

  let lastFpsTime = performance.now();
  let lastFrameCount = 0;
  let fpsPrimed = false;
  let fpsEma = 0;
  let statsTimer = 0;
  let warmupStartedAt = 0;
  let warmupFrames = 0;
  let warmupStableAt = 0;

  function autoQualitySample(fps, now) {
    if (quality.mode !== 'auto' || !state.live || document.hidden) return;
    if (autoQuality.exhausted) return;
    if (now < autoQuality.warmupUntil) return;
    if (now - autoQuality.lastStepAt < 1500) return;

    // Do not punish the game for its own loading stutter: wait until we have
    // seen a healthy frame rate once, or until a short fallback timeout on
    // hardware that may never reach it.
    if (fps >= LOW_FPS + 8) autoQuality.goodSeen = true;
    if (!autoQuality.goodSeen && now < autoQuality.fallbackAt) return;

    if (fps < LOW_FPS) {
      autoQuality.lowSamples += 1;
    } else {
      autoQuality.lowSamples = Math.max(0, autoQuality.lowSamples - 1);
    }

    // A genuinely collapsed frame rate should drop one step immediately;
    // otherwise require two samples so a single hitch is ignored.
    const needed = fps < 30 ? 1 : 2;
    if (autoQuality.lowSamples < needed) return;

    // Stop once another step would not actually reduce the backing store (the
    // minimum clamp is already active), so we do not burn samples forever.
    if (quality.step >= AUTO_STEPS.length - 1) {
      autoQuality.exhausted = true;
      return;
    }

    const nextScale = quantizeScale(quality.base * AUTO_STEPS[quality.step + 1]);
    if (nextScale >= quality.scale - 0.0001) {
      autoQuality.exhausted = true;
      return;
    }

    quality.step += 1;
    autoQuality.lowSamples = 0;
    autoQuality.lastStepAt = now;
    autoQuality.warmupUntil = now + 1200;

    applyQualityScale('auto step ' + quality.step);
  }

  function scheduleStats(delay) {
    if (statsTimer) clearTimeout(statsTimer);
    statsTimer = setTimeout(() => {
      statsTimer = 0;
      fpsTick(performance.now());
    }, delay || STATS_INTERVAL_MS);
  }

  function fpsTick(now) {
    const Module = getModule();

    if (window.__gdRuntimeReady && Module) {
      const elapsed = now - lastFpsTime;

      if (elapsed >= STATS_INTERVAL_MS) {
        let frames = 0;
        try {
          if (Module._gd_frames_get) frames = Module._gd_frames_get() | 0;
        } catch (_) { /* ignore */ }

        // A late callback means the main thread was blocked by texture
        // decoding, GC, or a long task. That is not a real FPS measurement.
        if (elapsed > 1600) {
          lastFrameCount = frames;
          lastFpsTime = now;
          if (state.readyScheduled && !state.live) updateWarmup(now, 0, 0);
        } else if (frames > 0) {
          const delta = Math.max(0, frames - lastFrameCount);
          const recentFps = (delta * 1000) / elapsed;

          if (fpsPrimed) {
            fpsEma = fpsEma > 0 ? fpsEma * 0.55 + recentFps * 0.45 : recentFps;

            const fps = Math.round(clamp(fpsEma, 0, 999));
            quality.fps = fps;

            if (el.fpsval) el.fpsval.textContent = String(fps);
            updateFpsQuality();
            autoQualitySample(fps, now);
          }

          lastFrameCount = frames;
          fpsPrimed = true;

          if (!state.live) {
            if (!state.readyScheduled) firstFrame();
            updateWarmup(now, delta, recentFps);
          }
        } else if (!fpsPrimed && el.fpsval) {
          el.fpsval.textContent = '--';
        }

        lastFpsTime = now;
      }
    } else {
      lastFpsTime = now;
    }

    scheduleStats(STATS_INTERVAL_MS);
  }

  // -------------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------------

  async function startGame() {
    if (state.started) return;
    if (IS_FILE) {
      showError(
        'This HTML5 build must be opened from its itch.io upload. Browsers block the WebAssembly and game-data downloads when index.html is opened directly from disk.',
        { title: 'Open from itch.io', retry: false }
      );
      return;
    }

    if (!HAS_GZIP_STREAM) {
      showError(
        'This browser cannot decompress the gzip-compressed game engine. ' +
        'Please update to a current version of Chrome, Edge, Firefox, or Safari, then reload this page.\n\n' +
        'The game ships only as a compressed engine to keep the download small.',
        { title: 'Browser not supported', retry: false }
      );
      return;
    }

    state.started = true;
    state.phase = 'loading';
    state.assets.wasm.lastTime = performance.now();
    state.assets.data.lastTime = performance.now();

    // The start card's blur/shadow/float effects are pure compositor load.
    // They are not needed while the engine is downloading and decoding assets.
    el.body.classList.add('is-loading');

    // Mobile starts windowed on purpose: browser fullscreen can hide the
    // address bar, keyboard, and other controls the player still needs. The
    // fullscreen button remains available as an opt-in.
    if (el.playBtn) {
      el.playBtn.disabled = true;
      el.playBtn.hidden = true;
    }
    if (el.loadPanel) el.loadPanel.hidden = false;
    if (el.readyPanel) el.readyPanel.hidden = true;

    setStatusLine('Downloading required resources — please be patient…');
    scheduleRender();
    requestPersistentStorage();

    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      say('[boot] engine script loaded');
      if (!state.assets.data.done) {
        setStatusLine('Downloading required resources — please be patient…');
      }
    };
    script.onerror = () => {
      showError(
        'The engine script could not be loaded.\n\nMake sure vendor/gd_web.js exists and that the whole folder is being served over HTTP.',
        { title: 'Engine not found' }
      );
    };
    document.body.appendChild(script);
  }

  function updateAssetLabels() {
    if (el.playSize) {
      el.playSize.textContent = Math.round(
        (ASSETS.wasm.size + ASSETS.data.size) / 1000000
      ) + ' MB';
    }
    if (el.wasmDetail) {
      el.wasmDetail.textContent = formatBytes(ASSETS.wasm.size);
      el.wasmDetail.title = 'Gzip-compressed engine; decompressed in the browser';
    }
    if (el.dataDetail) el.dataDetail.textContent = formatBytes(ASSETS.data.size);
  }

  // -------------------------------------------------------------------------
  // Input bridge
  // -------------------------------------------------------------------------

  function queueInput(message, wParam, lParam) {
    const Module = getModule();
    if (!Module || !Module.gdInputQueue) return;
    Module.gdInputQueue.push([message | 0, wParam | 0, lParam | 0]);
  }

  function setupInput() {
    const WM_MOUSEMOVE = 0x200;
    const WM_LBUTTONDOWN = 0x201;
    const WM_LBUTTONUP = 0x202;
    const WM_RBUTTONDOWN = 0x204;
    const WM_RBUTTONUP = 0x205;
    const WM_MBUTTONDOWN = 0x207;
    const WM_MBUTTONUP = 0x208;

    let buttonsDown = 0;

    function ready() {
      return window.__gdInputReady === true;
    }

    function overCanvas(event) {
      if (!ready() || !el.canvas) return false;
      if (event.target && event.target.closest &&
          event.target.closest('#console, #start, #startCard, #playBtn, a, button, input, textarea, select')) {
        return false;
      }
      const rect = canvasRect();
      return (
        event.clientX >= rect.left &&
        event.clientX < rect.right &&
        event.clientY >= rect.top &&
        event.clientY < rect.bottom
      );
    }

    function position(event) {
      // Input stays in the game's fixed 1920x1080 logical space even when the
      // canvas backing store is rendered at a lower resolution and upscaled.
      const Module = getModule();
      const rect = canvasRect();
      const x = clamp(
        Math.round(((event.clientX - rect.left) * VIEW_W) / rect.width),
        0,
        VIEW_W - 1
      );
      const y = clamp(
        Math.round(((event.clientY - rect.top) * VIEW_H) / rect.height),
        0,
        VIEW_H - 1
      );
      if (Module) {
        Module.gdCursorPos[0] = x;
        Module.gdCursorPos[1] = y;
      }
      return (x & 0xffff) | ((y & 0xffff) << 16);
    }

    function push(message, wParam, lParam) {
      queueInput(message, wParam, lParam);
    }

    let ackedFocus = false;
    function acknowledgeFocus() {
      if (ackedFocus) return;
      ackedFocus = true;
      push(0x0006, 1, 0);
      push(0x0007, 0, 0);
      push(0x001c, 1, 0);
    }
    window.__gdAckFocus = acknowledgeFocus;

    window.addEventListener('mousedown', (event) => {
      if (!overCanvas(event)) return;
      const message = event.button === 2
        ? WM_RBUTTONDOWN
        : (event.button === 1 ? WM_MBUTTONDOWN : WM_LBUTTONDOWN);
      const wParam = event.button === 2 ? 2 : (event.button === 1 ? 16 : 1);
      buttonsDown |= (1 << event.button);
      push(message, wParam, position(event));
      event.preventDefault();
    });

    window.addEventListener('mouseup', (event) => {
      if (!ready()) return;
      buttonsDown &= ~(1 << event.button);
      const message = event.button === 2
        ? WM_RBUTTONUP
        : (event.button === 1 ? WM_MBUTTONUP : WM_LBUTTONUP);
      push(message, 0, position(event));
      push(WM_MOUSEMOVE, 0, position(event));
      if (event.target === el.canvas) event.preventDefault();
    });

    window.addEventListener('blur', () => {
      if (!ready() || !buttonsDown) return;
      const Module = getModule();
      for (let button = 0; button < 3; button++) {
        if (buttonsDown & (1 << button)) {
          const message = button === 2
            ? WM_RBUTTONUP
            : (button === 1 ? WM_MBUTTONUP : WM_LBUTTONUP);
          const cursor = Module ? Module.gdCursorPos : [0, 0];
          push(message, 0, (cursor[0] & 0xffff) | (cursor[1] << 16));
        }
      }
      buttonsDown = 0;
    });

    window.addEventListener('mousemove', (event) => {
      if (!ready()) return;
      const Module = getModule();
      if (!Module) return;

      const queue = Module.gdInputQueue;
      const wParam = (event.buttons & 1) ? 1 : 0;
      const lParam = position(event);

      if (queue.length && queue[queue.length - 1][0] === WM_MOUSEMOVE) {
        queue[queue.length - 1] = [WM_MOUSEMOVE, wParam, lParam];
      } else {
        queue.push([WM_MOUSEMOVE, wParam, lParam]);
      }
    });

    window.addEventListener('wheel', (event) => {
      if (!overCanvas(event)) return;

      const location = position(event);
      const deltaY = -event.deltaY;
      const deltaX = event.deltaX;

      if (Math.abs(deltaY) >= Math.abs(deltaX)) {
        const notch = deltaY > 0 ? 120 : -120;
        push(0x020a, (notch & 0xffff) << 16, location);
      } else {
        const notch = deltaX > 0 ? -120 : 120;
        push(0x020e, (notch & 0xffff) << 16, location);
      }

      event.preventDefault();
    }, { passive: false });

    el.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    el.canvas.addEventListener('mousedown', () => {
      if (!softKeyboardActive) el.canvas.focus();
    });
    el.canvas.tabIndex = 0;

    const Module = getModule();
    if (Module) Module.gdKeyState = new Uint8Array(256);

    function keyEvent(event, down) {
      if (!ready() || qualityMenuOpen) return;

      // Keys typed into the mobile soft-keyboard bridge are translated by the
      // bridge itself, so do not forward the same event twice.
      if (softKeyboardInput && event.target === softKeyboardInput) return;

      try {
        if (window.getSelection && String(window.getSelection()) !== '') return;
      } catch (_) { /* ignore */ }

      const vk = VK[event.code] || event.keyCode || 0;

      if (down && event.code === 'Escape') {
        if (state.mobileScene === 'level') beginMobilePauseIntent();
        else if (state.mobileScene === 'paused') setMobileHudScene('level');
      }

      if (down) {
        let charCode = 0;
        if (event.key && event.key.length === 1) {
          charCode = event.key.charCodeAt(0);
        } else if (event.code === 'Backspace') {
          charCode = 0x08;
        } else if (event.code === 'Enter') {
          charCode = 0x0d;
        }

        if (charCode) {
          let charInfo = 1 | ((SCAN[event.code] || 0) << 16);
          if (EXTENDED_KEYS.has(event.code)) charInfo |= 0x1000000;
          push(0x0102, charCode, charInfo);
        }
      }

      if (!vk) return;

      const currentModule = getModule();
      if (currentModule && currentModule.gdKeyState) {
        currentModule.gdKeyState[vk & 0xff] = down ? 1 : 0;
      }

      const scan = SCAN[event.code] || 0;
      let keyInfo = 1 | (scan << 16);
      if (EXTENDED_KEYS.has(event.code)) keyInfo |= 0x1000000;
      if (!down) keyInfo |= -1073741824;

      push(down ? 0x0100 : 0x0101, vk, keyInfo);

      if (event.code === 'Space' ||
          event.code === 'ArrowUp' ||
          event.code === 'ArrowDown') {
        event.preventDefault();
      }
    }

    window.addEventListener('keydown', (event) => keyEvent(event, true));
    window.addEventListener('keyup', (event) => keyEvent(event, false));

    // Touch support: treat the glass as one left mouse button. Tracking touch
    // identifiers keeps a second finger from releasing a jump that the first
    // finger is still holding.
    const activeTouches = new Set();
    let lastTouchPosition = 0;

    function touchPosition(touch) {
      const Module = getModule();
      const rect = canvasRect();
      if (!rect.width || !rect.height) {
        return Module && Module.gdCursorPos
          ? ((Module.gdCursorPos[0] & 0xffff) | (Module.gdCursorPos[1] << 16))
          : 0;
      }

      const x = clamp(
        Math.round(((touch.clientX - rect.left) * VIEW_W) / rect.width),
        0,
        VIEW_W - 1
      );
      const y = clamp(
        Math.round(((touch.clientY - rect.top) * VIEW_H) / rect.height),
        0,
        VIEW_H - 1
      );
      if (Module) {
        Module.gdCursorPos[0] = x;
        Module.gdCursorPos[1] = y;
      }
      lastTouchPosition = (x & 0xffff) | ((y & 0xffff) << 16);
      return lastTouchPosition;
    }

    function touchAllowed(event) {
      if (window.__gdInputReady !== true) return false;
      if (event.target && event.target.closest &&
          event.target.closest('#console, #start, #startCard, button, input, textarea, select')) {
        return false;
      }
      return true;
    }

    function releaseTouches(event) {
      activeTouches.clear();
      push(0x202, 0, lastTouchPosition);
      if (event) event.preventDefault();
    }

    el.canvas.addEventListener('touchstart', (event) => {
      if (!touchAllowed(event)) return;

      for (let i = 0; i < event.changedTouches.length; i++) {
        const touch = event.changedTouches[i];
        if (activeTouches.has(touch.identifier)) continue;

        const wasEmpty = activeTouches.size === 0;
        activeTouches.add(touch.identifier);
        const location = touchPosition(touch);

        if (wasEmpty) {
          hintSoftKeyboardAt(touch);
          push(0x201, 1, location);
          if (softKeyboardActive) {
            // Keep the soft keyboard open while the player taps a game field.
            resetSoftKeyboardValue();
            focusSoftKeyboard();
          } else {
            try { el.canvas.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
          }
        } else {
          push(0x200, 1, location);
        }
      }

      event.preventDefault();
    }, { passive: false });

    el.canvas.addEventListener('touchmove', (event) => {
      if (!touchAllowed(event)) return;

      for (let i = 0; i < event.changedTouches.length; i++) {
        const touch = event.changedTouches[i];
        if (!activeTouches.has(touch.identifier)) continue;
        push(0x200, 1, touchPosition(touch));
      }

      event.preventDefault();
    }, { passive: false });

    el.canvas.addEventListener('touchend', (event) => {
      if (window.__gdInputReady !== true) return;

      for (let i = 0; i < event.changedTouches.length; i++) {
        const touch = event.changedTouches[i];
        if (!activeTouches.has(touch.identifier)) continue;

        const location = touchPosition(touch);
        activeTouches.delete(touch.identifier);

        if (activeTouches.size === 0) {
          push(0x202, 0, location);
          push(0x200, 0, location);
        } else {
          // Another finger is still down; keep the virtual button held and
          // move the cursor to a finger that remains on the glass.
          const remaining = event.touches.length
            ? event.touches[0]
            : null;
          if (remaining) push(0x200, 1, touchPosition(remaining));
        }
      }

      if (softKeyboardActive) focusSoftKeyboard();
      event.preventDefault();
    }, { passive: false });

    el.canvas.addEventListener('touchcancel', releaseTouches, { passive: false });

    window.addEventListener('blur', () => {
      if (activeTouches.size) releaseTouches(null);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && activeTouches.size) {
        releaseTouches(null);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Fullscreen
  // -------------------------------------------------------------------------

  function setupFullscreen() {
    const label = el.fsBtn ? el.fsBtn.querySelector('.btn-label') : null;
    const target = fullscreenTarget();

    const supported =
      target && (
        target.requestFullscreen ||
        target.webkitRequestFullscreen ||
        target.mozRequestFullScreen ||
        target.msRequestFullscreen
      );

    if (!supported) {
      if (el.fsBtn) el.fsBtn.hidden = true;
      return;
    }

    function update() {
      const active = isFullscreen();
      if (label) label.textContent = active ? 'Exit fullscreen' : 'Fullscreen';
      if (el.fsBtn) {
        el.fsBtn.setAttribute('aria-pressed', String(active));
        el.fsBtn.setAttribute(
          'aria-label',
          active ? 'Exit fullscreen' : 'Enter fullscreen'
        );
        el.fsBtn.title = active ? 'Exit fullscreen' : 'Enter fullscreen';
      }
      scheduleFit();
    }

    function toggle() {
      try {
        if (isFullscreen()) {
          (document.exitFullscreen ||
            document.webkitExitFullscreen ||
            document.mozCancelFullScreen ||
            document.msExitFullscreen).call(document);
        } else {
          (target.requestFullscreen ||
            target.webkitRequestFullscreen ||
            target.mozRequestFullScreen ||
            target.msRequestFullscreen).call(target);
        }
      } catch (error) {
        say('[fs] ' + error);
      }
    }

    el.fsBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggle();
      el.fsBtn.blur();
    });

    ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange']
      .forEach((name) => document.addEventListener(name, update));

    update();
  }

  // -------------------------------------------------------------------------
  // Mobile / touch behaviour
  // -------------------------------------------------------------------------

  function setRotateHint(visible) {
    if (!el.rotateHint) return;

    const show = Boolean(visible && IS_COARSE && state.live && !rotateHintDismissed);
    el.rotateHint.classList.toggle('is-visible', show);
    el.rotateHint.setAttribute('aria-hidden', show ? 'false' : 'true');

    if (rotateHintTimer) {
      clearTimeout(rotateHintTimer);
      rotateHintTimer = 0;
    }

    if (show) {
      rotateHintTimer = setTimeout(() => {
        rotateHintTimer = 0;
        setRotateHint(false);
      }, 7000);
    }
  }

  function updateRotateHint() {
    setRotateHint(window.innerHeight > window.innerWidth);
  }

  // -------------------------------------------------------------------------
  // Mobile scene detection (WebAudio bridge)
  // -------------------------------------------------------------------------

  const MOBILE_MENU_MUSIC =
    /^(?:menuloop|secretloop\d*|secretshop|shop\d*|stayinsideme)(?:\.|$)/i;

  // Sounds created by the current engine bridge store their path in `name`.
  // Older bridge objects use `path`, so accept both rather than depending on
  // one build of the vendor script.
  function mobileSoundPath(sound) {
    return sound && (sound.path || sound.name || sound.url) || '';
  }

  function mobileMusicKind(path) {
    if (!path) return '';

    const clean = String(path).split(/[?#]/)[0].replace(/\\/g, '/');
    const base = clean.split('/').pop().toLowerCase();
    if (!base) return '';

    if (MOBILE_MENU_MUSIC.test(base)) return 'menu';

    // One-off ambience/scare sounds are neither menu music nor level music.
    if (/^(?:dangerloop|jumpscareaudio)(?:\.|$)/i.test(base)) return '';

    // Every playable song is an mp3 (built-in or downloaded custom song).
    if (/\.mp3$/i.test(base) || /(?:^|\/)songs\//i.test(clean)) return 'level';
    return '';
  }

  function installMobileSceneHooks(Module) {
    if (!Module || Module.__gdMobileSceneHooks) return;
    Module.__gdMobileSceneHooks = true;

    let current = Module.__gdAudio;

    function attach(audio) {
      try { hookMobileAudio(audio); } catch (_) { /* ignore */ }
    }

    try {
      Object.defineProperty(Module, '__gdAudio', {
        configurable: true,
        enumerable: true,
        get() { return current; },
        set(value) {
          current = value;
          attach(value);
        }
      });
    } catch (_) {
      // If a future engine build defines the property as non-configurable,
      // the polling loop still discovers channels through getMobileAudioApi().
    }

    if (current) attach(current);
  }

  function getMobileAudioApi() {
    const Module = getModule();
    const audio = Module && Module.__gdAudio;
    if (audio) hookMobileAudio(audio);
    return audio || null;
  }

  function hookMobileAudio(audio) {
    if (!audio || audio.__gdMobileSceneHooked) return;
    audio.__gdMobileSceneHooked = true;

    function wrap(name) {
      const original = audio[name];
      if (typeof original !== 'function') return;
      audio[name] = function () {
        const result = original.apply(this, arguments);
        try { scheduleMobileSceneUpdate(); } catch (_) { /* ignore */ }
        return result;
      };
    }

    wrap('play');
    wrap('pauseCh');
    wrap('unpauseCh');
    wrap('stopCh');
  }

  function scheduleMobileSceneUpdate() {
    if (mobileSceneUpdateQueued) return;
    mobileSceneUpdateQueued = true;
    setTimeout(() => {
      mobileSceneUpdateQueued = false;
      updateMobileSceneFromAudio();
    }, 40);
  }

  function mobileChannelState(id) {
    const audio = getMobileAudioApi();
    if (!audio || !audio.channels || !id) return null;
    const channel = audio.channels[id];
    if (!channel) return null;
    return {
      channel,
      ended: Boolean(channel.ended),
      paused: Boolean(channel.paused || channel.pausedByGroup)
    };
  }

  function clearMobilePauseSceneTimer() {
    if (!mobilePauseSceneTimer) return;
    clearTimeout(mobilePauseSceneTimer);
    mobilePauseSceneTimer = 0;
  }

  function clearMobileLevelEndTimer() {
    if (!mobileLevelEndTimer) return;
    clearTimeout(mobileLevelEndTimer);
    mobileLevelEndTimer = 0;
  }

  function clearMobilePauseWatchdog() {
    if (!mobilePauseWatchdog) return;
    clearTimeout(mobilePauseWatchdog);
    mobilePauseWatchdog = 0;
  }

  function scheduleMobilePausedScene() {
    if (mobilePauseSceneTimer || state.mobileScene === 'paused') return;
    mobilePauseSceneTimer = setTimeout(() => {
      mobilePauseSceneTimer = 0;
      if (state.mobileScene === 'level') setMobileHudScene('paused');
    }, 90);
  }

  function scheduleMobileLevelEnded(delay) {
    if (mobileLevelEndTimer) return;
    mobileLevelEndTimer = setTimeout(() => {
      mobileLevelEndTimer = 0;
      if (state.mobileScene === 'level') setMobileHudScene('menu');
    }, delay);
  }

  function discoverMobileMusicChannels(audio) {
    let levelId = 0;
    let menuId = 0;

    for (const key in audio.channels) {
      const channel = audio.channels[key];
      if (!channel || channel.ended) continue;

      let kind = mobileAudio.kinds[channel.id];
      if (!kind) {
        const sound = audio.sounds && audio.sounds[channel.sound];
        kind = mobileMusicKind(mobileSoundPath(sound));
        if (kind) mobileAudio.kinds[channel.id] = kind;
      }
      if (!kind) continue;

      // Only playing channels are safe to discover after the fact. Paused
      // level channels can linger in the engine's channel map and must not
      // resurrect the pause button while the player is in a menu.
      if (channel.paused || channel.pausedByGroup) continue;
      if (kind === 'level' && channel.id > levelId) levelId = channel.id;
      if (kind === 'menu' && channel.id > menuId) menuId = channel.id;
    }

    if (levelId) mobileAudio.levelChannel = levelId;
    if (menuId) mobileAudio.menuChannel = menuId;
  }

  function updateMobileSceneFromAudio() {
    if (!state.live) return;

    const audio = getMobileAudioApi();
    if (!audio || !audio.channels) return;

    discoverMobileMusicChannels(audio);

    const level = mobileChannelState(mobileAudio.levelChannel);
    const menu = mobileChannelState(mobileAudio.menuChannel);
    const menuPlaying = Boolean(menu && !menu.ended && !menu.paused);

    // Menu music wins only while the level channel is not actually running.
    // This covers engines that leave the old level channel paused when the
    // player exits to the level browser or main menu.
    if (menuPlaying && (!level || level.ended || level.paused)) {
      clearMobileLevelEndTimer();
      clearMobilePauseSceneTimer();
      clearMobilePauseWatchdog();
      mobileAudio.levelChannel = 0;
      mobileAudio.pauseConfirmed = false;
      if (state.mobileScene !== 'menu') setMobileHudScene('menu');
      return;
    }

    if (level && !level.ended) {
      clearMobileLevelEndTimer();

      if (level.paused) {
        if (state.mobileScene === 'level') {
          mobileAudio.pauseConfirmed = true;
          scheduleMobilePausedScene();
        } else if (state.mobileScene === 'paused') {
          mobileAudio.pauseConfirmed = true;
          clearMobilePauseWatchdog();
        }
      } else {
        mobileAudio.pauseConfirmed = false;
        clearMobilePauseSceneTimer();

        // Escape is asynchronous. Keep the rail hidden for a moment after the
        // pause tap so a still-playing channel cannot flash it back on before
        // the engine handles the key.
        if (state.mobileScene === 'paused' &&
            performance.now() - mobileAudio.pauseIntentAt < 1200) {
          return;
        }

        clearMobilePauseWatchdog();
        if (state.mobileScene !== 'level') setMobileHudScene('level');
      }
      return;
    }

    // No level music is alive.
    mobileAudio.levelChannel = 0;

    if (state.mobileScene === 'level') {
      // A natural end is the level-complete screen; a stop is a death or an
      // exit. The grace window lets a death restart claim the scene again.
      scheduleMobileLevelEnded(1200);
    } else if (state.mobileScene === 'paused') {
      // Some engines stop the music when opening the pause menu. Keep the
      // pause scene until menu music or a new level channel arrives.
      if (performance.now() - mobileAudio.pauseIntentAt < 3000) {
        mobileAudio.pauseConfirmed = true;
        clearMobilePauseWatchdog();
      }
    }
  }

  function beginMobilePauseIntent() {
    mobileAudio.pauseIntentAt = performance.now();
    mobileAudio.pauseConfirmed = false;
    clearMobilePauseWatchdog();
    mobilePauseWatchdog = setTimeout(() => {
      mobilePauseWatchdog = 0;
      if (state.mobileScene === 'paused' && !mobileAudio.pauseConfirmed) {
        // The engine did not actually pause (or its audio bridge is absent).
        // Restore the button instead of trapping the HUD in a paused state.
        setMobileHudScene('level');
      }
    }, 1200);
    setMobileHudScene('paused');
  }

  // -------------------------------------------------------------------------
  // Mobile HUD: pause + soft-keyboard bridge
  // -------------------------------------------------------------------------

  function resetSoftKeyboardValue() {
    if (!softKeyboardInput) return;
    softKeyboardInput.value = '';
    softKeyboardValue = '';
  }

  function focusSoftKeyboard() {
    if (!softKeyboardInput) return;
    try {
      softKeyboardInput.focus({ preventScroll: true });
    } catch (_) {
      try { softKeyboardInput.focus(); } catch (_) { /* ignore */ }
    }
  }

  function sendSoftKey(vk, scan, charCode) {
    if (charCode) {
      queueInput(0x0102, charCode, 1 | ((scan || 0) << 16));
    }
    if (!vk) return;

    const keyInfo = 1 | ((scan || 0) << 16);
    queueInput(0x0100, vk, keyInfo);
    queueInput(0x0101, vk, keyInfo | -1073741824);
  }

  function sendSoftText(text) {
    if (!text) return;

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === 0x0a || code === 0x0d) {
        sendSoftKey(0x0d, 0x1c, 0x0d);
      } else {
        queueInput(0x0102, code, 1);
      }
    }
  }

  function flushSoftKeyboardInput() {
    if (!softKeyboardInput || softKeyboardComposing) return;

    const next = softKeyboardInput.value;
    const previous = softKeyboardValue;

    let start = 0;
    const limit = Math.min(previous.length, next.length);
    while (start < limit && previous.charCodeAt(start) === next.charCodeAt(start)) {
      start++;
    }

    let previousEnd = previous.length;
    let nextEnd = next.length;
    while (previousEnd > start && nextEnd > start &&
           previous.charCodeAt(previousEnd - 1) === next.charCodeAt(nextEnd - 1)) {
      previousEnd--;
      nextEnd--;
    }

    const removed = previousEnd - start;
    for (let i = 0; i < removed; i++) {
      sendSoftKey(0x08, 0x0e, 0x08);
    }
    sendSoftText(next.slice(start, nextEnd));

    softKeyboardValue = next;

    // The bridge only needs enough context to diff the current edit. The
    // game's own field is the source of truth. Keeping this buffer bounded
    // avoids surprising autocorrect rewrites after long typing sessions.
    if (next.length > 256) {
      softKeyboardInput.value = '';
      softKeyboardValue = '';
    }
  }

  function clearSoftKeyboardHint() {
    if (softKeyboardHintTimer) {
      clearTimeout(softKeyboardHintTimer);
      softKeyboardHintTimer = 0;
    }
    if (mobileKeyboardBtn) mobileKeyboardBtn.classList.remove('is-hinting');
  }

  function setSoftKeyboard(active, quiet) {
    if (!softKeyboardInput) return;

    if (state.mobileScene !== 'menu') active = false;

    const next = Boolean(active);
    if (next === softKeyboardActive) {
      if (next) focusSoftKeyboard();
      return;
    }

    softKeyboardActive = next;

    if (mobileKeyboardBtn) {
      mobileKeyboardBtn.classList.toggle('is-active', next);
      mobileKeyboardBtn.setAttribute('aria-pressed', String(next));
      mobileKeyboardBtn.setAttribute(
        'aria-label',
        next ? 'Hide on-screen keyboard' : 'Open on-screen keyboard'
      );
    }

    if (next) {
      clearSoftKeyboardHint();
      resetSoftKeyboardValue();
      focusSoftKeyboard();

      if (!quiet && !softKeyboardReadyShown) {
        softKeyboardReadyShown = true;
        showToast(
          'Keyboard open — tap a text field and type. ' +
          'Tap the keyboard button again to hide it.',
          4800
        );
      }
    } else {
      resetSoftKeyboardValue();
      try { softKeyboardInput.blur(); } catch (_) { /* ignore */ }
    }
  }

  function sendMobileMoveKey(side, down) {
    const key = side === 'left'
      ? { vk: VK.ArrowLeft, scan: SCAN.ArrowLeft }
      : side === 'right'
        ? { vk: VK.ArrowRight, scan: SCAN.ArrowRight }
        : null;
    if (!key) return;

    const Module = getModule();
    if (Module && Module.gdKeyState) {
      Module.gdKeyState[key.vk & 0xff] = down ? 1 : 0;
    }

    let keyInfo = 1 | (key.scan << 16) | 0x1000000;
    if (!down) keyInfo |= -1073741824;
    queueInput(down ? 0x0100 : 0x0101, key.vk, keyInfo);
  }

  function finishMobileMoveRelease(side) {
    const slot = mobileMoveKeys && mobileMoveKeys[side];
    if (!slot || !slot.held) return;

    slot.held = false;
    slot.pointerId = null;
    if (slot.timer) {
      clearTimeout(slot.timer);
      slot.timer = 0;
    }

    const button = side === 'left' ? mobileMoveLeftBtn : mobileMoveRightBtn;
    if (button) button.classList.remove('is-held');
    sendMobileMoveKey(side, false);
  }

  function releaseMobileMoveKey(side, immediate) {
    const slot = mobileMoveKeys && mobileMoveKeys[side];
    if (!slot || !slot.held) return;

    slot.pointerId = null;

    // Very quick taps can start and end between two game frames. Hold the key
    // for a couple of frames so a tap always produces a visible step.
    const elapsed = performance.now() - slot.downAt;
    const delay = immediate ? 0 : Math.max(0, MOBILE_MOVE_TAP_MS - elapsed);

    if (slot.timer) {
      clearTimeout(slot.timer);
      slot.timer = 0;
    }

    if (!delay) {
      finishMobileMoveRelease(side);
      return;
    }

    slot.timer = setTimeout(() => {
      slot.timer = 0;
      finishMobileMoveRelease(side);
    }, delay);
  }

  function releaseMobileMoveButtons(immediate) {
    releaseMobileMoveKey('left', immediate);
    releaseMobileMoveKey('right', immediate);
  }

  function pressMobileMoveKey(side, event) {
    if (window.__gdInputReady !== true || state.mobileScene !== 'level') {
      return false;
    }

    const slot = mobileMoveKeys && mobileMoveKeys[side];
    if (!slot || slot.pointerId !== null) return false;

    // A second press during the short tap-release delay simply keeps the key
    // held instead of emitting a redundant keydown.
    if (slot.timer) {
      clearTimeout(slot.timer);
      slot.timer = 0;
    }

    slot.pointerId = event.pointerId;
    slot.downAt = performance.now();

    if (!slot.held) {
      slot.held = true;
      const button = side === 'left' ? mobileMoveLeftBtn : mobileMoveRightBtn;
      if (button) button.classList.add('is-held');
      sendMobileMoveKey(side, true);
    }

    return true;
  }

  function releaseMobileMovePointer(side, pointerId) {
    const slot = mobileMoveKeys && mobileMoveKeys[side];
    if (!slot || !slot.held || slot.pointerId !== pointerId) return false;
    releaseMobileMoveKey(side, false);
    return true;
  }

  function bindMobileMoveButton(button, side) {
    if (!button) return;

    button.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (!pressMobileMoveKey(side, event)) return;

      event.preventDefault();
      event.stopPropagation();

      try {
        button.setPointerCapture(event.pointerId);
      } catch (_) { /* capture is best effort */ }
    });

    function release(event) {
      if (!releaseMobileMovePointer(side, event.pointerId)) return;
      event.preventDefault();
      event.stopPropagation();
    }

    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', (event) => {
      if (!releaseMobileMovePointer(side, event.pointerId)) return;
      event.preventDefault();
    });
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  function mobileCanPause() {
    if (window.__gdInputReady !== true || state.mobileScene !== 'level') {
      return false;
    }

    const audio = getMobileAudioApi();
    const id = mobileAudio.levelChannel;
    if (audio && audio.channels && id) {
      const channel = audio.channels[id];
      if (channel && channel.ended) return false;
    }
    return true;
  }

  function sendPauseInput() {
    if (!mobileCanPause()) return;

    const now = performance.now();
    if (now - lastPauseSentAt < 350) return;
    lastPauseSentAt = now;

    if (softKeyboardActive) setSoftKeyboard(false, true);

    beginMobilePauseIntent();

    // Escape is the game's own pause key. Push it through the Win32 message
    // bridge instead of dispatching a DOM key event: a synthetic Escape can
    // be consumed by the browser to leave fullscreen.
    const keyInfo = 1 | (SCAN.Escape << 16);
    queueInput(0x0100, VK.Escape, keyInfo);
    setTimeout(() => {
      queueInput(0x0101, VK.Escape, keyInfo | -1073741824);
    }, 90);
  }

  function mobileRailInlineWidth() {
    if (!mobileHud) return 0;

    const buttons = [
      mobilePauseBtn,
      mobileMoveLeftBtn,
      mobileMoveRightBtn,
      mobileKeyboardBtn
    ].filter((button) => button && !button.hidden && button.offsetWidth > 0);
    if (!buttons.length) return 0;

    const gap = parseFloat(getComputedStyle(mobileHud).columnGap) || 0;
    return buttons.reduce((total, button) => total + button.offsetWidth, 0) +
      gap * (buttons.length - 1);
  }

  function mobileRailButtonWidth() {
    const widths = [
      mobilePauseBtn,
      mobileMoveLeftBtn,
      mobileMoveRightBtn,
      mobileKeyboardBtn
    ]
      .filter((button) => button && !button.hidden && button.offsetWidth > 0)
      .map((button) => button.offsetWidth);

    return widths.length ? Math.max.apply(null, widths) : 44;
  }

  function positionMobileHud() {
    if (!el.canvas || !mobileHud) return;

    const rect = el.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const gap = clamp(
      Math.round(Math.min(rect.width, rect.height) * 0.026),
      8,
      14
    );
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;

    // The rail shares the keyboard button's anchor, but it is wider when the
    // pause and arrow buttons are visible. Center the whole rail inside the
    // letterbox column instead of centering a single button, otherwise the
    // right arrow spills over the game canvas.
    const anchorSize = 42;
    const leftBar = Math.max(0, rect.left);
    const rightBar = Math.max(0, viewportWidth - rect.right);
    const useLeftBar = leftBar >= rightBar;
    const bar = Math.max(leftBar, rightBar);
    const inlineWidth = mobileRailInlineWidth();
    const stacked = inlineWidth > 0 &&
      bar < inlineWidth + 12 &&
      bar >= anchorSize + 12;

    mobileHud.classList.toggle('is-stacked', stacked);

    if (inlineWidth > 0 && (stacked || bar >= inlineWidth + 12)) {
      const railWidth = stacked ? mobileRailButtonWidth() : inlineWidth;
      const offset = Math.max(0, Math.round((bar - railWidth) / 2));

      if (useLeftBar) {
        mobileHud.style.setProperty('--mobile-hud-left', offset + 'px');
        mobileHud.style.removeProperty('--mobile-hud-right');
        mobileHud.classList.add('is-docked-left');
        mobileHud.classList.remove('is-docked-right');
      } else {
        mobileHud.style.setProperty('--mobile-hud-right', offset + 'px');
        mobileHud.style.removeProperty('--mobile-hud-left');
        mobileHud.classList.add('is-docked-right');
        mobileHud.classList.remove('is-docked-left');
      }
    } else {
      mobileHud.classList.remove('is-stacked');
      mobileHud.style.setProperty(
        '--mobile-hud-left',
        Math.max(0, Math.round(rect.left + gap)) + 'px'
      );
      mobileHud.style.removeProperty('--mobile-hud-right');
      mobileHud.classList.add('is-docked-left');
      mobileHud.classList.remove('is-docked-right');
    }

    mobileHud.style.setProperty(
      '--mobile-hud-top',
      Math.max(0, Math.round(rect.top + rect.height / 2)) + 'px'
    );
  }

  function setMobileHudScene(scene) {
    const next = scene === 'level' || scene === 'menu' || scene === 'paused'
      ? scene
      : 'hidden';

    state.mobileScene = next;

    if (next !== 'menu') {
      clearSoftKeyboardHint();
      if (softKeyboardActive) setSoftKeyboard(false, true);
    }

    const level = next === 'level';
    const menu = next === 'menu';
    const paused = next === 'paused';

    if (!level) releaseMobileMoveButtons(true);

    if (mobileHud) {
      mobileHud.hidden = !(level || menu);
      mobileHud.classList.toggle('is-level', level);
      mobileHud.classList.toggle('is-menu', menu);
      mobileHud.classList.toggle('is-paused', paused);

      if (mobilePauseBtn) {
        mobilePauseBtn.hidden = !level;
        mobilePauseBtn.setAttribute('aria-hidden', String(!level));
      }

      [
        mobileMoveLeftBtn,
        mobileMoveRightBtn
      ].forEach((button) => {
        if (!button) return;
        button.hidden = !level;
        button.setAttribute('aria-hidden', String(!level));
      });
    }

    if (mobileKeyboardBtn) {
      mobileKeyboardBtn.hidden = !menu;
      mobileKeyboardBtn.setAttribute('aria-hidden', String(!menu));
      mobileKeyboardBtn.classList.toggle('is-active', menu && softKeyboardActive);
    }

    if (el.body) {
      el.body.classList.toggle('is-mobile-menu', menu);
      el.body.classList.toggle('is-mobile-level', level);
      el.body.classList.toggle('is-mobile-paused', paused);
    }

    if (level || menu) positionMobileHud();
  }

  function mobileCanvasPosition(event) {
    const rect = canvasRect();
    if (!rect.width || !rect.height) return null;

    return {
      x: ((event.clientX - rect.left) * VIEW_W) / rect.width,
      y: ((event.clientY - rect.top) * VIEW_H) / rect.height
    };
  }

  function isLikelyTextField(x, y) {
    if (state.mobileScene !== 'menu' || !IS_TOUCH) return false;

    // The engine renders its text fields into the canvas. Search fields sit in
    // the upper content band; editor/name dialogs use a wide centered field.
    // These zones only highlight the keyboard button — they never open the
    // keyboard by themselves, so a miss cannot leave the player stuck.
    const topSearch = x >= 500 && x <= 1420 && y >= 100 && y <= 230;
    const nameField = x >= 680 && x <= 1240 && y >= 450 && y <= 610;
    return topSearch || nameField;
  }

  function hintSoftKeyboardAt(event) {
    if (!event || state.mobileScene !== 'menu' || softKeyboardActive) return;

    const point = mobileCanvasPosition(event);
    if (!point || !isLikelyTextField(point.x, point.y)) return;

    if (mobileKeyboardBtn) {
      mobileKeyboardBtn.classList.add('is-hinting');
      if (softKeyboardHintTimer) clearTimeout(softKeyboardHintTimer);
      softKeyboardHintTimer = setTimeout(() => {
        softKeyboardHintTimer = 0;
        if (mobileKeyboardBtn) mobileKeyboardBtn.classList.remove('is-hinting');
      }, 2600);
    }

    if (!softKeyboardHintShown) {
      softKeyboardHintShown = true;
      showToast('Tap the keyboard button to type.', 3600);
    }
  }

  function setupMobileControls() {
    if (!IS_COARSE || mobileHud) return;

    const pauseIcon =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<rect x="8.1" y="7.4" width="2.7" height="9.2" rx="1.35" fill="currentColor"/>' +
        '<rect x="13.2" y="7.4" width="2.7" height="9.2" rx="1.35" fill="currentColor"/>' +
      '</svg>';

    const leftIcon =
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" ' +
        'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" ' +
        'stroke-linejoin="round">' +
        '<path d="M14.7 5.7 8.4 12l6.3 6.3"/>' +
      '</svg>';

    const rightIcon =
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" ' +
        'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" ' +
        'stroke-linejoin="round">' +
        '<path d="M9.3 5.7 15.6 12l-6.3 6.3"/>' +
      '</svg>';

    const keyboardIcon =
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" ' +
        'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
        'stroke-linejoin="round">' +
        '<rect x="2.7" y="6.1" width="18.6" height="11.8" rx="2.4"/>' +
        '<path d="M6.2 9.6h.01M9.2 9.6h.01M12.2 9.6h.01M15.2 9.6h.01M18.2 9.6h.01' +
        'M6.2 12.5h.01M9.2 12.5h.01M12.2 12.5h.01M15.2 12.5h.01M18.2 12.5h.01' +
        'M7.7 15.4h8.6"/>' +
      '</svg>';

    mobileHud = document.createElement('div');
    mobileHud.id = 'mobileHud';
    mobileHud.className = 'mobile-hud';
    mobileHud.setAttribute('role', 'group');
    mobileHud.setAttribute('aria-label', 'Mobile game controls');
    mobileHud.hidden = true;
    mobileHud.innerHTML =
      '<button id="mobilePauseBtn" class="mobile-hud__btn mobile-hud__btn--pause" ' +
        'type="button" aria-label="Pause game" title="Pause">' + pauseIcon + '</button>' +
      '<button id="mobileMoveLeftBtn" class="mobile-hud__btn mobile-hud__btn--move" ' +
        'type="button" aria-label="Move left" title="Move left" hidden>' + leftIcon + '</button>' +
      '<button id="mobileMoveRightBtn" class="mobile-hud__btn mobile-hud__btn--move" ' +
        'type="button" aria-label="Move right" title="Move right" hidden>' + rightIcon + '</button>';

    mobileKeyboardBtn = document.createElement('button');
    mobileKeyboardBtn.id = 'mobileKeyboardBtn';
    mobileKeyboardBtn.className = 'mobile-keyboard-btn';
    mobileKeyboardBtn.type = 'button';
    mobileKeyboardBtn.hidden = true;
    mobileKeyboardBtn.setAttribute('aria-label', 'Open on-screen keyboard');
    mobileKeyboardBtn.setAttribute('aria-pressed', 'false');
    mobileKeyboardBtn.title = 'Keyboard';
    mobileKeyboardBtn.innerHTML = keyboardIcon;

    softKeyboardInput = document.createElement('input');
    softKeyboardInput.id = 'softKeyboardInput';
    softKeyboardInput.className = 'soft-keyboard-input';
    softKeyboardInput.type = 'text';
    softKeyboardInput.setAttribute('inputmode', 'text');
    softKeyboardInput.setAttribute('autocomplete', 'off');
    softKeyboardInput.setAttribute('autocapitalize', 'off');
    softKeyboardInput.setAttribute('autocorrect', 'off');
    softKeyboardInput.setAttribute('spellcheck', 'false');
    softKeyboardInput.setAttribute('enterkeyhint', 'go');
    softKeyboardInput.setAttribute('aria-label', 'Text input for Geometry Dash');
    softKeyboardInput.tabIndex = -1;

    // Keyboard is last so a right-docked rail (row-reverse) keeps whichever
    // primary button is visible — pause or keyboard — against the screen edge.
    mobileHud.appendChild(mobileKeyboardBtn);
    el.body.appendChild(mobileHud);
    el.body.appendChild(softKeyboardInput);

    mobilePauseBtn = byId('mobilePauseBtn');
    mobileMoveLeftBtn = byId('mobileMoveLeftBtn');
    mobileMoveRightBtn = byId('mobileMoveRightBtn');

    mobileMoveKeys = {
      left: { pointerId: null, downAt: 0, held: false, timer: 0 },
      right: { pointerId: null, downAt: 0, held: false, timer: 0 }
    };

    mobilePauseBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      sendPauseInput();
      try { mobilePauseBtn.blur(); } catch (_) { /* ignore */ }
    });

    mobileKeyboardBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (softKeyboardActive) setSoftKeyboard(false);
      else setSoftKeyboard(true);
    });

    bindMobileMoveButton(mobileMoveLeftBtn, 'left');
    bindMobileMoveButton(mobileMoveRightBtn, 'right');

    // A pointer can be released outside the button (especially when capture is
    // unavailable), so release the held arrow globally as well.
    ['pointerup', 'pointercancel'].forEach((type) => {
      window.addEventListener(type, (event) => {
        releaseMobileMovePointer('left', event.pointerId);
        releaseMobileMovePointer('right', event.pointerId);
      });
    });

    window.addEventListener('blur', () => releaseMobileMoveButtons(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') releaseMobileMoveButtons(true);
    });

    // The canvas input bridge ignores button targets, but stopping these
    // events here also keeps a keyboard tap from moving the game cursor.
    ['pointerdown', 'touchstart'].forEach((type) => {
      mobileKeyboardBtn.addEventListener(type, (event) => {
        event.stopPropagation();
      }, { passive: true });
    });

    softKeyboardInput.addEventListener('input', () => {
      if (!softKeyboardActive || softKeyboardComposing) return;
      flushSoftKeyboardInput();
    });

    softKeyboardInput.addEventListener('compositionstart', () => {
      softKeyboardComposing = true;
    });

    softKeyboardInput.addEventListener('compositionend', () => {
      softKeyboardComposing = false;
      flushSoftKeyboardInput();
    });

    softKeyboardInput.addEventListener('keydown', (event) => {
      if (!softKeyboardActive) return;
      if (event.isComposing || event.keyCode === 229) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        setSoftKeyboard(false);
        return;
      }

      if (event.key === 'Backspace') {
        event.preventDefault();
        flushSoftKeyboardInput();
        sendSoftKey(0x08, 0x0e, 0x08);
        return;
      }

      if (event.key === 'Enter' || event.key === 'NumpadEnter') {
        event.preventDefault();
        flushSoftKeyboardInput();
        sendSoftKey(0x0d, 0x1c, 0x0d);
        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        flushSoftKeyboardInput();
        sendSoftKey(0x09, 0x0f, 0);
        return;
      }

      if (event.key === 'Delete') {
        event.preventDefault();
        flushSoftKeyboardInput();
        sendSoftKey(0x2e, 0x53, 0);
        return;
      }

      const navigation = {
        ArrowLeft: [0x25, 0x4b],
        ArrowUp: [0x26, 0x48],
        ArrowRight: [0x27, 0x4d],
        ArrowDown: [0x28, 0x50]
      }[event.key];

      if (navigation) {
        event.preventDefault();
        flushSoftKeyboardInput();
        sendSoftKey(navigation[0], navigation[1], 0);
      }
    });

    softKeyboardInput.addEventListener('blur', () => {
      if (!softKeyboardActive) return;
      setTimeout(() => {
        if (softKeyboardActive && document.activeElement !== softKeyboardInput) {
          setSoftKeyboard(false, true);
        }
      }, 160);
    });

    if ('ResizeObserver' in window) {
      try {
        new ResizeObserver(positionMobileHud).observe(el.canvas);
      } catch (_) { /* ignore */ }
    }

    if (mobileScenePollTimer) clearInterval(mobileScenePollTimer);
    mobileScenePollTimer = setInterval(updateMobileSceneFromAudio, 400);
    scheduleMobileSceneUpdate();

    requestAnimationFrame(positionMobileHud);
    setMobileHudScene(state.mobileScene);
  }

  function setupMobileBehavior() {
    if (!IS_TOUCH) return;

    el.body.classList.add('is-touch');
    if (IS_COARSE) setupMobileControls();

    if (el.rotateDismiss) {
      el.rotateDismiss.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        rotateHintDismissed = true;
        setRotateHint(false);
      });
    }

    // The game owns the viewport once it is live. Keep scrolling, pinch-zoom,
    // pull-to-refresh, and rubber-banding away from the canvas and toolbar
    // while still allowing the launcher, quality menu, and error dialog to
    // scroll when they need to.
    function allowsScroll(target) {
      return Boolean(
        target && target.closest &&
        target.closest('.start-card, .quality-menu, #console, #errOverlay, .error-card')
      );
    }

    document.addEventListener('touchmove', (event) => {
      if (event.touches.length > 1) {
        event.preventDefault();
        return;
      }

      if (!state.live || allowsScroll(event.target)) return;
      event.preventDefault();
    }, { passive: false });

    document.addEventListener('gesturestart', (event) => {
      event.preventDefault();
    }, { passive: false });

    window.addEventListener('orientationchange', () => {
      setTimeout(updateRotateHint, 140);
    }, { passive: true });

    window.addEventListener('resize', updateRotateHint, { passive: true });

    if (screen.orientation && screen.orientation.addEventListener) {
      screen.orientation.addEventListener('change', () => {
        setTimeout(updateRotateHint, 140);
      });
    }

    updateRotateHint();
  }

  // -------------------------------------------------------------------------
  // Cache reset
  // -------------------------------------------------------------------------

  async function clearEverything() {
    if (!confirm('Clear saved progress, downloaded online data, login, and local browser data?\n\nThe game will reload afterwards.')) {
      return;
    }

    state.resetting = true;
    stopAutosave();
    lastSaveRequestAt = 0;

    try {
      const Module = getModule();
      if (Module && Module._gd_autosave_set) Module._gd_autosave_set(0);
    } catch (_) { /* ignore */ }

    function clearLocalProgress() {
      try {
        const doomed = [];

        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key) continue;

          if (key.indexOf(SAVE_LS_PREFIX) === 0 ||
              key.indexOf(SAVE_LS_TIME_PREFIX) === 0 ||
              key === 'gdwasm_udid') {
            doomed.push(key);
          }
        }

        doomed.forEach((key) => localStorage.removeItem(key));
        ['gdWasmSize', 'gdDataSize', 'gdProxyBase'].forEach((key) => {
          localStorage.removeItem(key);
        });
      } catch (_) { /* ignore */ }
    }

    function clearSessionProgress() {
      return clearSessionRecords();
    }

    clearLocalProgress();
    await clearSessionProgress();

    // Give any save already queued by the game a moment to finish, then remove
    // it as well. Autosave has been stopped so nothing new can be written.
    await sleep(800);

    clearLocalProgress();
    await clearSessionProgress();
    location.reload();
  }

  // -------------------------------------------------------------------------
  // WebGL / message / init
  // -------------------------------------------------------------------------

  function hookGlContext(gl, canvas) {
    if (!gl || gl.__gdQualityHooked) return;
    gl.__gdQualityHooked = true;
    gameGl = gl;

    const nativeViewport = gl.viewport.bind(gl);
    const nativeScissor = gl.scissor.bind(gl);

    gl.__gdNativeViewport = nativeViewport;
    gl.__gdNativeScissor = nativeScissor;
    gl.__gdFullViewport = false;
    gl.__gdFullScissor = false;

    // The game always draws its 1920x1080 logical frame. Redirect that one
    // full-screen viewport to the canvas backing store, which can be smaller.
    gl.viewport = function (x, y, width, height) {
      if (x === 0 && y === 0 && width === VIEW_W && height === VIEW_H) {
        gl.__gdFullViewport = true;
        return nativeViewport(0, 0, canvas.width, canvas.height);
      }
      gl.__gdFullViewport = false;
      return nativeViewport(x, y, width, height);
    };

    gl.scissor = function (x, y, width, height) {
      if (x === 0 && y === 0 && width === VIEW_W && height === VIEW_H) {
        gl.__gdFullScissor = true;
        return nativeScissor(0, 0, canvas.width, canvas.height);
      }

      gl.__gdFullScissor = false;

      // UI clipping rectangles are still expressed in the game's fixed
      // 1920x1080 space. Scale them to the actual backing store, otherwise
      // labels are cut off at the left edge on high-DPI/low-scale layouts.
      if (x === 0 && y === 0 && width === canvas.width && height === canvas.height) {
        return nativeScissor(x, y, width, height);
      }

      const scaleX = canvas.width / VIEW_W;
      const scaleY = canvas.height / VIEW_H;

      if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
        return nativeScissor(x, y, width, height);
      }

      const nx = Math.floor(x * scaleX);
      const ny = Math.floor(y * scaleY);
      const nw = Math.max(0, Math.ceil((x + width) * scaleX) - nx);
      const nh = Math.max(0, Math.ceil((y + height) * scaleY) - ny);

      return nativeScissor(nx, ny, nw, nh);
    };

    say('[webgl] viewport hook ' + canvas.width + 'x' + canvas.height);
  }

  // Call the native GL entry points directly so the hook above does not
  // mistake this for a new game viewport request.
  function syncGlViewport() {
    const gl = gameGl;
    if (!gl || !el.canvas) return;

    try {
      if (typeof gl.isContextLost === 'function' && gl.isContextLost()) return;

      const width = el.canvas.width;
      const height = el.canvas.height;
      if (gl.__gdFullViewport) gl.__gdNativeViewport(0, 0, width, height);
      if (gl.__gdFullScissor) gl.__gdNativeScissor(0, 0, width, height);
    } catch (_) { /* context may have gone away */ }
  }

  function installContextOverrides() {
    const proto = HTMLCanvasElement.prototype;
    if (proto.__gdContextPatched) return;

    proto.__gdContextPatched = true;
    const native = proto.getContext;

    proto.getContext = function (type, attributes) {
      if (this === el.canvas &&
          (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl')) {
        const attrs = Object.assign({}, attributes || {});

        // An opaque, non-preserved drawing buffer can be handed straight to
        // the compositor, avoiding a full-frame copy every single frame.
        attrs.alpha = false;
        attrs.antialias = false;
        attrs.preserveDrawingBuffer = false;
        attrs.powerPreference = 'high-performance';

        const gl = native.call(this, type, attrs);
        if (gl) hookGlContext(gl, this);
        return gl;
      }

      return native.call(this, type, attributes);
    };
  }

  function checkWebGL() {
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2');
      if (!gl) {
        showError(
          'WebGL2 is not available. Use a current version of Chrome, Edge, or Firefox and enable hardware acceleration.',
          { title: 'WebGL2 required', retry: false }
        );
        return;
      }

      try {
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        gpu.renderer = info
          ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || '')
          : '';
        gpu.vendor = info
          ? String(gl.getParameter(info.UNMASKED_VENDOR_WEBGL) || '')
          : '';

        const name = gpu.renderer + ' ' + gpu.vendor;
        gpu.software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);

        window.__gdGpu = gpu.renderer;
        if (gpu.renderer) say('[gpu] ' + gpu.renderer);
      } catch (_) { /* ignore */ }

      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    } catch (error) {
      showError('WebGL2 check failed: ' + error, {
        title: 'WebGL2 required',
        retry: false
      });
    }
  }

  function setupMessages() {
    window.__framed = window.self !== window.top;

    window.addEventListener('message', (event) => {
      if (event.data === 'gd-focus') {
        window.focus();
        try { el.canvas.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
      }
      if (event.data === 'gd-fullscreen') {
        try {
          if (isFullscreen()) {
            document.exitFullscreen();
          } else {
            const target = fullscreenTarget();
            if (target && target.requestFullscreen) target.requestFullscreen();
          }
        } catch (_) { /* ignore */ }
      }
    });

    document.addEventListener('click', () => {
      try {
        if (window.parent !== window) window.parent.postMessage('gd-click', '*');
      } catch (_) { /* ignore */ }
    });
  }

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  function init() {
    el.body.classList.toggle('is-debug', DEBUG);
    state.storageBroken = !localStorageAvailable();

    updateAssetLabels();
    loadQualityPreference();
    installContextOverrides();
    installProxy();
    createModule();
    setupQualityUI();
    checkWebGL();

    quality.base = autoBaseScale();
    applyQualityScale('initial');
    setupCanvasLayout();

    setupInput();
    setupSaveLifecycle();
    setupWakeLock();
    window.__gdPersistSave = persistSaveFile;
    window.__gdNativeQuit = handleNativeQuit;
    setupFullscreen();
    setupMobileBehavior();
    setupMessages();

    window.__gdQuality = () => ({
      mode: quality.mode,
      step: quality.step,
      base: quality.base,
      scale: Number(quality.scale.toFixed(4)),
      width: quality.width,
      height: quality.height,
      fps: quality.fps,
      renderer: gpu.renderer,
      software: gpu.software
    });

    window.__gdSetQuality = (mode) => selectQuality(mode, true);
    window.__gdSaveNow = () => { flushGameSave(); };
    window.__gdWakeState = () => ({
      supported: Boolean(navigator.wakeLock && navigator.wakeLock.request),
      active: Boolean(wakeLock && !wakeLock.released)
    });
    window.__gdMobileHud = () => ({
      scene: state.mobileScene,
      levelTextureSeen: state.mobileLevelTextureSeen,
      pauseVisible: Boolean(mobilePauseBtn && !mobilePauseBtn.hidden),
      keyboardVisible: Boolean(mobileKeyboardBtn && !mobileKeyboardBtn.hidden),
      arrowsVisible: Boolean(mobileMoveLeftBtn && !mobileMoveLeftBtn.hidden),
      keyboardActive: softKeyboardActive,
      levelChannel: mobileAudio.levelChannel,
      menuChannel: mobileAudio.menuChannel
    });

    if (el.playBtn) el.playBtn.addEventListener('click', startGame);
    if (el.logoFly) el.logoFly.addEventListener('click', startGame);
    if (el.clearBtn) {
      el.clearBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearEverything();
      });
    }

    document.addEventListener('keydown', (event) => {
      if (qualityMenuOpen) return;

      const target = event.target;
      if (target && target.closest &&
          target.closest('button, a, input, select, textarea')) {
        return;
      }

      if (!state.started &&
          (event.code === 'Space' ||
           event.code === 'Enter' ||
           event.code === 'NumpadEnter')) {
        event.preventDefault();
        startGame();
      }
    });

    if (el.errReload) {
      el.errReload.addEventListener('click', () => location.reload());
    }
    if (el.errDismiss) {
      el.errDismiss.addEventListener('click', hideError);
    }

    window.addEventListener('error', (event) => {
      const message = event.message || 'Unknown runtime error';
      if (/JSPI|WebAssembly|wasm|memory|out of bounds|fetch|NetworkError/i.test(message)) {
        showError(message, { title: 'Runtime error' });
      }
    });

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      const message = reason && (reason.stack || reason.message) || String(reason);
      if (state.phase === 'loading' ||
          state.phase === 'booting' ||
          /fetch|network|data|wasm|compile|instantiate/i.test(message)) {
        showError(message, { title: 'Load error' });
      } else {
        say('[promise] ' + message);
      }
    });

    window.gdFirstFrame = firstFrame;
    window.forceAssetsDone = finishAssets;

    scheduleStats();

    say('[boot] shell ready');

    if (IS_FILE) {
      showError(
        'This HTML5 build must be opened from its itch.io upload. Browsers block the WebAssembly and game-data downloads when index.html is opened directly from disk.',
        { title: 'Open from itch.io', retry: false }
      );
    }
  }

  init();
})();
