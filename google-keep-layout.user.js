// ==UserScript==
// @name         Google Keep 窄窗布局
// @namespace    chase.google-keep-layout
// @version      0.5.0
// @description  缩小顶栏和新建栏的图标；左侧菜单改成点菜单按钮后从上往下展开；「Keep 窄窗」快捷方式打开的窗口能拖到很窄，并记住大小和位置。
// @license      MIT
// @match        https://keep.google.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  const STYLE_ID = 'keep-compact-style';
  if (document.getElementById(STYLE_ID)) return;

  // 「Keep 窄窗」快捷方式用 chrome --app=https://keep.google.com/#kc-narrow 打开 Keep。
  // 这种窗口不算「已安装的应用」，没有 Chrome 给已安装应用定死的 500 最小宽度，能拖到约 180；
  // 但 Chrome 不记它的大小和位置，由脚本来记。标记存进 sessionStorage，Keep 改了地址也认得。
  const NARROW_MARK = 'kc-narrow';
  const NARROW_SESSION_KEY = 'keep-compact-narrow';
  const settings = { scale: 0.75 };
  try {
    const saved = typeof GM_getValue === 'function' ? GM_getValue('compact', {}) : {};
    const scale = Number(saved?.scale);
    if (scale >= 0.5 && scale <= 1) settings.scale = scale;
  } catch (error) {
    console.warn('[Keep 窄窗]', error);
  }

  function store(key, value) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(key, value);
    } catch (error) {
      console.warn('[Keep 窄窗]', error);
    }
  }

  // 类名取自 2026-10 的 Keep 页面。顶栏是 Google 通用顶栏，类名常变，只用 id 和结构定位。
  function css(z) {
    const grow = (1 / z).toFixed(4);
    // 新建栏高 46px，按钮缩小后上下居中
    const buttonTop = (23 * (1 - z) / z).toFixed(2);
    return `
/* 顶栏整体缩放；选中记事时盖在顶栏上的工具栏一起缩 */
#ognwrapper, .tJHJj-ZMv3u { zoom: ${z}; }
#gb form[role="search"] input { font-size: calc(16px * ${grow}) !important; }
/* 很窄时藏起顶栏的「Keep」字样，给按钮让位 */
@media (max-width: ${Math.round(420 * z)}px) {
  #gb a:has(> img) > span { display: none !important; }
}
/* 左侧菜单改成下拉：平时完全收起、不占宽度；点左上角菜单按钮，从顶栏下方往下展开。
   图标、行高、文字一起缩放，文字最小 12px */
.PvRhvb { zoom: ${z}; }
.PvRhvb .PvRhvb-fozPsf-ysyhld { min-width: 0 !important; width: 0 !important; }
.PvRhvb .PvRhvb-bN97Pc {
  height: auto !important; max-height: calc(100% - 64px); width: 280px !important; max-width: 100%;
  overflow-y: auto !important; padding: 4px 0 8px !important; border-radius: 0 0 16px 0;
  box-shadow: 0 6px 16px rgba(0, 0, 0, .18) !important;
  /* 展开动画靠 clip-path 从上往下露出；左右下各多留 30px，不然阴影也被裁掉 */
  clip-path: inset(0 -30px -30px -30px); transition: clip-path .18s ease-out, visibility 0s !important;
}
body.kPTQic-nUpftc .PvRhvb .PvRhvb-bN97Pc { max-height: calc(100% - 56px); }
.PvRhvb.PvRhvb-qAWA2 .PvRhvb-bN97Pc {
  visibility: hidden; clip-path: inset(0 -30px 100% -30px);
  transition: clip-path .15s ease-in, visibility 0s .15s !important;
}
/* 收起时 Keep 把选项画成圆形图标；下拉里一律是整行，收起动画中也不变形 */
.PvRhvb .PvRhvb-bN97Pc .PvRhvb-ibnC6b {
  width: 100% !important; margin-left: 0 !important; padding-left: 12px !important;
  border-radius: 0 25px 25px 0 !important; font-size: max(calc(12px * ${grow}), .875rem) !important;
}
.PvRhvb .PvRhvb-hSRGPd-haAclf { display: none !important; }
/* 新建记事栏右侧的三个按钮 */
.h1U9Be-xhiy4 > [role="button"] { zoom: ${z}; top: ${buttonTop}px !important; }
/* 允许更窄：去掉 body 的 360px 最小宽度；Keep 重算宽度之前，新建栏和卡片也不撑出窗口 */
body { min-width: 0 !important; }
.h1U9Be-xhiy4, .gkA7Yd-sKfxWe .IZ65Hb-n0tgWb { max-width: calc(100% - 16px) !important; }
.h1U9Be-xhiy4 .IZ65Hb-n0tgWb, .gkA7Yd-sKfxWe, .gkA7Yd-sKfxWe > div { max-width: 100% !important; }
`;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css(settings.scale);
  (document.head || document.documentElement).append(style);

  function askScale() {
    const answer = prompt('图标和菜单的缩放比例（%），50–100，默认 75：',
      String(Math.round(settings.scale * 100)));
    if (answer === null) return;
    const percent = Number(answer.trim().replace(/%$/, ''));
    if (!(percent >= 50 && percent <= 100)) {
      alert('请填 50–100 之间的数字。');
      return;
    }
    settings.scale = Math.round(percent) / 100;
    store('compact', { ...settings });
    style.textContent = css(settings.scale);
  }

  function isNarrowWindow() {
    try {
      if (location.hash.includes(NARROW_MARK)) sessionStorage.setItem(NARROW_SESSION_KEY, '1');
      return sessionStorage.getItem(NARROW_SESSION_KEY) === '1';
    } catch (error) {
      console.warn('[Keep 窄窗]', error);
      return false;
    }
  }

  function rememberNarrowWindow() {
    const current = () => ({
      x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight,
    });
    const maximized = () => window.outerWidth >= window.screen.availWidth - 8 &&
      window.outerHeight >= window.screen.availHeight - 8;
    let saved = null;
    try {
      const value = typeof GM_getValue === 'function' ? GM_getValue('narrowBounds', null) : null;
      if (value && ['x', 'y', 'w', 'h'].every(key => Number.isFinite(value[key])) &&
          value.w >= 150 && value.h >= 150) saved = value;
    } catch (error) {
      console.warn('[Keep 窄窗]', error);
    }
    // 先改大小再挪位置：窗口还是默认大小时挪，会被 Chrome 推回屏幕里
    const restore = () => {
      window.resizeTo(saved.w, saved.h);
      window.moveTo(saved.x, saved.y);
    };
    // 摆好以后的实际大小位置。Chrome 摆出来常比要求高一两个单位，
    // 只有用户再拖动才保存，否则每次打开都会长高一点。
    let baseline = null;
    let ready = !saved;
    if (saved) {
      restore();
      // 页面刚开始时摆的尺寸会差几个单位，加载完再摆一次
      window.addEventListener('load', () => {
        restore();
        setTimeout(() => { baseline = current(); ready = true; }, 800);
      }, { once: true });
    }

    function remember() {
      if (!ready || maximized()) return;
      const now = current();
      const moved = !baseline || Math.abs(now.x - baseline.x) > 2 || Math.abs(now.y - baseline.y) > 2;
      const resized = !baseline || Math.abs(now.w - baseline.w) > 3 || Math.abs(now.h - baseline.h) > 3;
      if (!moved && !resized) return;
      const next = { ...(saved || now) };
      if (moved) Object.assign(next, { x: now.x, y: now.y });
      if (resized) Object.assign(next, { w: now.w, h: now.h });
      store('narrowBounds', next);
      saved = next;
      baseline = now;
    }
    let timer;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(remember, 600);
    });
    window.addEventListener('pagehide', remember);
  }

  // 左侧菜单是下拉以后：Keep 宽窗时会把「菜单开着」记在 localStorage，一打开页面就盖住记事，先改成关着；
  // Keep 点完选项、点到菜单外也不会自己收起，替它点一下菜单按钮，这样它自己记的状态也对得上。
  const MENU_STATE_KEY = 'keep_db::left_nav_menu_open_state';
  try {
    if (localStorage.getItem(MENU_STATE_KEY) === 'true') localStorage.setItem(MENU_STATE_KEY, 'false');
  } catch (error) {
    console.warn('[Keep 窄窗]', error);
  }
  // 菜单按钮按标准菜单图标认；退一步认顶栏里唯一带 aria-expanded 的 div 按钮
  const menuButton = () =>
    document.querySelector('#gb path[d^="M3 18h18v-2H3v2z"]')?.closest('[role="button"]') ||
    document.querySelector('#gb div[role="button"][aria-expanded]');
  const menuOpen = () => {
    const sidebar = document.querySelector('.PvRhvb');
    return !!sidebar && !sidebar.classList.contains('PvRhvb-qAWA2');
  };
  function closeMenu() {
    if (menuOpen()) menuButton()?.click();
  }
  document.addEventListener('click', event => {
    if (!menuOpen() || !(event.target instanceof Element)) return;
    if (menuButton()?.contains(event.target)) return;
    if (event.target.closest('.PvRhvb-bN97Pc') && !event.target.closest('.PvRhvb-ibnC6b')) return;
    // 选了一项，或点在菜单外：等 Keep 处理完这次点击再收起
    setTimeout(closeMenu, 0);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menuOpen()) closeMenu();
  }, true);
  window.addEventListener('load', () => setTimeout(closeMenu, 300), { once: true });

  if (typeof GM_registerMenuCommand === 'function') {
    try {
      GM_registerMenuCommand('图标缩放…', askScale);
    } catch (error) {
      console.warn('[Keep 窄窗]', error);
    }
  }
  if (isNarrowWindow()) rememberNarrowWindow();
})();
