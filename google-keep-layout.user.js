// ==UserScript==
// @name         Google Keep 窄窗布局
// @namespace    chase.google-keep-layout
// @version      0.7.0
// @description  缩小顶栏和标签；左侧菜单改成下拉；点卡片就地编辑，编辑栏自动换行、Close 换成 ×、协作者换成标签按钮；置顶用边框标识；记住「Keep 窄窗」窗口的大小和位置。
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

  // × 和标签图标画在 Keep 原有的按钮上（伪元素 + mask），不往 Keep 的节点里插东西；
  // 颜色用按钮自己的文字色，深色主题下也对。
  const icon = d => `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${d}"/></svg>`)}")`;
  const CLOSE_ICON = icon('M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z');
  const LABEL_ICON = icon('M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 1.99 2 1.99L16 19' +
    'c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16zM16 17H5V7h11l3.55 5L16 17z');

  // 类名取自 2026-10 的 Keep 页面。顶栏是 Google 通用顶栏，类名常变，只用 id 和结构定位。
  function css(z) {
    const grow = (1 / z).toFixed(4);
    // 新建栏高 46px，按钮缩小后上下居中
    const buttonTop = (23 * (1 - z) / z).toFixed(2);
    // 编辑框和展开的新建记事栏，两处的底栏一样处理
    const EDITING = ':is(.XKSfm-L9AdLc, .h1U9Be-xhiy4)';
    return `
/* 顶栏整体缩放；选中记事时盖在顶栏上的工具栏一起缩 */
#ognwrapper, .tJHJj-ZMv3u { zoom: ${z}; }
#gb form[role="search"] input { font-size: calc(16px * ${grow}) !important; }
/* 很窄时藏起顶栏的「Keep」字样，给按钮让位 */
@media (max-width: ${Math.round(420 * z)}px) {
  #gb a:has(> img) > span { display: none !important; }
}
/* 左侧菜单改成下拉：平时完全收起、不占宽度；点左上角菜单按钮，从顶栏下方往下展开。
   宽 240、每行 38（再乘缩放），文字最小 12px */
.PvRhvb { zoom: ${z}; }
.PvRhvb .PvRhvb-fozPsf-ysyhld { min-width: 0 !important; width: 0 !important; }
.PvRhvb .PvRhvb-bN97Pc {
  height: auto !important; max-height: calc(100% - 64px); width: 240px !important; max-width: 100%;
  overflow-y: auto !important; padding: 3px 0 5px !important; border-radius: 0 0 12px 0;
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
  display: flex !important; align-items: center; box-sizing: border-box;
  width: 100% !important; height: 38px !important; min-height: 38px !important;
  margin-left: 0 !important; padding: 0 10px !important;
  border-radius: 0 25px 25px 0 !important; font-size: max(calc(12px * ${grow}), .875rem) !important;
}
.PvRhvb .PvRhvb-ibnC6b > svg { flex: 0 0 22px; width: 22px; height: 22px; }
.PvRhvb .PvRhvb-ibnC6b-V67aGc { margin-left: 14px !important; overflow: hidden; text-overflow: ellipsis; }
.PvRhvb .PvRhvb-hSRGPd-haAclf { display: none !important; }
/* 新建记事栏右侧的三个按钮 */
.h1U9Be-xhiy4 > [role="button"] { zoom: ${z}; top: ${buttonTop}px !important; }
/* 允许更窄：去掉 body 的 360px 最小宽度；Keep 重算宽度之前，新建栏和卡片也不撑出窗口 */
body { min-width: 0 !important; }
.h1U9Be-xhiy4, .gkA7Yd-sKfxWe .IZ65Hb-n0tgWb { max-width: calc(100% - 16px) !important; }
.h1U9Be-xhiy4 .IZ65Hb-n0tgWb, .gkA7Yd-sKfxWe, .gkA7Yd-sKfxWe > div { max-width: 100% !important; }

/* 列表里的卡片不显示底栏，也不给它留位置。这条在页面最开始就生效，Keep 排版时量到的卡片高度里
   已经没有底栏，自己就排紧了；不用脚本挪卡片（挪了会和 Keep 的拖动排序对不上）。 */
.gkA7Yd-sKfxWe .IZ65Hb-nK2kYb { display: none !important; }
/* 「Pinned / Others」分组标题不显示，置顶改用卡片边框标识。Keep 给标题留的空位收不回来，留作分隔。
   卡片的边框画在里层的 TBnied 上。 */
.gkA7Yd-sKfxWe .neVct-LS81yb-tJHJj { visibility: hidden !important; }
.IZ65Hb-n0tgWb.IZ65Hb-bJ69tf > .IZ65Hb-TBnied { border-color: #c6a34c !important; }
/* 右上角的图钉小一号（列表和编辑框里都是 nQ1Faf） */
.IZ65Hb-n0tgWb .nQ1Faf {
  width: 26px !important; height: 26px !important; margin: 0 !important;
  background-size: 18px !important; background-position: center !important;
}
/* 标签只缩芯片，不改变正文、提醒或协作者头像 */
.IZ65Hb-n0tgWb .XPtOyb-di8rgd-Bz112c {
  box-sizing: border-box; min-width: 0 !important; max-width: 100%;
  height: 20px !important; padding: 0 !important; margin: 3px 4px 0 0 !important;
  border-radius: 7px !important;
}
.IZ65Hb-n0tgWb .XPtOyb-di8rgd-Bz112c .XPtOyb-bN97Pc {
  box-sizing: border-box; min-width: 0 !important; height: 20px !important;
  padding: 0 6px !important; max-width: 100%;
}
.IZ65Hb-n0tgWb .XPtOyb-di8rgd-Bz112c .XPtOyb-fmcmS {
  font-size: 11px !important; line-height: 18px !important; padding: 0 !important; margin: 0 !important;
}
.IZ65Hb-n0tgWb .XPtOyb-di8rgd-Bz112c .XPtOyb-VkLyEc {
  width: 20px !important; height: 20px !important; top: 0 !important; right: 0 !important;
  background-size: 14px !important;
}
.IZ65Hb-n0tgWb .IZ65Hb-jfdpUb { min-height: 0 !important; padding: 2px 10px 6px !important; gap: 0; }

/* 编辑框的底栏：按钮小一号，宽度不够就换行，× 留在最右边 */
${EDITING} .IZ65Hb-nK2kYb {
  flex-wrap: nowrap !important; align-items: flex-start !important; height: auto !important;
  min-height: 0 !important; padding: 2px 4px 4px !important; box-sizing: border-box !important;
}
${EDITING} .IZ65Hb-INgbqf {
  flex: 1 1 0 !important; min-width: 0 !important; flex-wrap: wrap !important; height: auto !important;
}
${EDITING} .IZ65Hb-INgbqf > [role="button"] {
  flex: none !important; box-sizing: border-box !important; width: 28px !important; min-width: 28px !important;
  height: 28px !important; margin: 1px !important; background-size: 18px !important;
  background-position: center !important;
}
/* Close 还是 Keep 自己的按钮，只是把字换成 × */
${EDITING} .IZ65Hb-TvD9Pc {
  position: relative !important; flex: none !important; box-sizing: border-box !important;
  width: 28px !important; min-width: 28px !important; height: 28px !important; margin: 1px !important;
  padding: 0 !important; border-radius: 50% !important; font-size: 0 !important; line-height: 0 !important;
  --kc-icon: ${CLOSE_ICON};
}
/* 协作者按钮改当标签按钮：图标换成标签，点击由脚本转去 More →「添加/更改标签」 */
${EDITING} .euCgFf { position: relative !important; background-image: none !important; --kc-icon: ${LABEL_ICON}; }
${EDITING} :is(.IZ65Hb-TvD9Pc, .euCgFf)::before {
  content: ""; position: absolute; inset: 0; margin: auto; width: 18px; height: 18px; pointer-events: none;
  background-color: currentColor;
  -webkit-mask: var(--kc-icon) center / 18px 18px no-repeat; mask: var(--kc-icon) center / 18px 18px no-repeat;
}
${EDITING} .IZ65Hb-TvD9Pc::before { opacity: .8; }

/* 原位编辑：Keep 自己的编辑框（内容、自动保存、撤销都还是 Keep 的）贴到原卡片的位置上，
   不要遮罩，背后的页面照常滚动；下面的卡片由脚本往下推。 */
body.kc-editing { overflow-y: auto !important; margin-right: 0 !important; }
body.kc-editing .XKSfm-L9AdLc-AHe6Kc { display: none !important; }
.XKSfm-L9AdLc.kc-inline {
  position: absolute !important; left: var(--kc-left) !important; top: var(--kc-top) !important;
  width: var(--kc-width) !important; margin: 0 !important; padding: 0 !important; z-index: 3 !important;
  transform: none !important; transition: none !important; animation: none !important;
  /* 窄窗时 Keep 把编辑框做成全屏（上下都钉住、里面 flex 撑满、正文区自己滚动），这里一律改回按内容的高度 */
  height: auto !important; bottom: auto !important; right: auto !important;
  /* 编辑框里的元素不能当滚动锚点：打开后图片、正文陆续撑开，浏览器为了让锚点不动会把整页往下滚 */
  overflow-anchor: none !important;
}
.XKSfm-L9AdLc.kc-inline > .IZ65Hb-n0tgWb {
  width: 100% !important; max-width: none !important; height: auto !important; max-height: none !important;
  box-shadow: none !important; transform: none !important; transition: none !important; animation: none !important;
}
.XKSfm-L9AdLc.kc-inline :is(.IZ65Hb-TBnied, .IZ65Hb-s2gQvd) {
  flex: none !important; height: auto !important; max-height: none !important; overflow: visible !important;
}
/* 编辑中的卡片用蓝色边框标识 */
.XKSfm-L9AdLc.kc-inline .IZ65Hb-TBnied { border-color: #5985cc !important; box-shadow: none !important; }
/* 窄窗时 Keep 用手机版编辑框：工具栏在最上面、× 在最左，中间还夹一条「下载 Keep App」推广。
   推广条不显示；原位编辑时工具栏挪到最下面、× 挪到最右，和宽窗的编辑框一样 */
.XKSfm-L9AdLc .Ng57nc { display: none !important; }
.XKSfm-L9AdLc.kc-inline > .IZ65Hb-n0tgWb > .IZ65Hb-nK2kYb { order: 1; }
.XKSfm-L9AdLc.kc-inline .IZ65Hb-INgbqf > .IZ65Hb-iib5kc { order: 99; margin-left: auto !important; }
/* 原卡片在编辑框底下，直接藏，不淡出 */
body.kc-editing .gkA7Yd-sKfxWe .IZ65Hb-fbudBf { opacity: 0 !important; transition: none !important; }
/* 一开始关闭，Keep 还要放 1 秒退场动画才藏起编辑框；这里立刻藏掉，原卡片立刻露出来 */
body:not(.XKSfm-L9AdLc-prCEue-uA7qgc) .XKSfm-L9AdLc.kc-inline { visibility: hidden !important; }
body:not(.XKSfm-L9AdLc-prCEue-uA7qgc) .gkA7Yd-sKfxWe .IZ65Hb-fbudBf { opacity: 1 !important; transition: none !important; }
/* 脚本替用户点 More 打开标签选择时，More 菜单不闪出来 */
html.kc-labels-opening .Q0hgme-xl07Ob { visibility: hidden !important; }
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

  // Keep 的按钮和菜单项要真实的按下、松开、点击三下才动作，单独 .click() 不够。
  // 油猴隔离环境里的 window 是代理，不能当 MouseEvent.view 传给页面，所以不带 view。
  function activate(element) {
    if (!element || element.getAttribute('aria-disabled') === 'true') return;
    const rect = element.getBoundingClientRect();
    for (const type of ['mousedown', 'mouseup', 'click']) {
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0,
        clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }));
    }
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
  // 再点一次菜单按钮要收起。窄窗时 Keep 在按下鼠标时就把菜单当「点到外面」关掉了，
  // 紧接着按钮的 click 又把它打开。所以：按下前开着、到 click 时已经关了，就拦下这次 click。
  let menuWasOpen = false;
  window.addEventListener('pointerdown', event => {
    menuWasOpen = event.target instanceof Element && !!menuButton()?.contains(event.target) && menuOpen();
  }, true);
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    if (menuButton()?.contains(event.target)) {
      if (menuWasOpen && !menuOpen()) { event.stopImmediatePropagation(); event.preventDefault(); }
      menuWasOpen = false;
      return;
    }
    if (!menuOpen()) return;
    if (event.target.closest('.PvRhvb-bN97Pc') && !event.target.closest('.PvRhvb-ibnC6b')) return;
    // 选了一项，或点在菜单外：等 Keep 处理完这次点击再收起
    setTimeout(closeMenu, 0);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menuOpen()) closeMenu();
  }, true);
  window.addEventListener('load', () => setTimeout(closeMenu, 300), { once: true });

  // 原位编辑。点开记事时 Keep 照常打开它自己的编辑框；脚本只把编辑框挪到原卡片的位置，
  // 再把下面的卡片往下推出编辑框多出来的高度，关闭时推回去。只在编辑期间跟着原卡片走，平时不扫描页面。
  const OPEN_CLASS = 'XKSfm-L9AdLc-prCEue-uA7qgc';  // Keep 打开编辑框时加在 body 上，一开始关就去掉
  const editing = { editor: null, source: null, frame: 0, key: '', shifted: new Set(), press: null, active: false, scroll: [0, 0] };
  const yOf = element => Number(/translate(?:3d)?\(\s*[-\d.]+px,\s*([-\d.]+)px/.exec(element.style.transform)?.[1] || 0);
  const xOf = element => Number(/translate(?:3d)?\(\s*([-\d.]+)px/.exec(element.style.transform)?.[1] || 0);

  function placeEditor(editor, card) {
    const rect = card.getBoundingClientRect();
    editor.style.setProperty('--kc-left', `${rect.left + window.scrollX}px`);
    editor.style.setProperty('--kc-top', `${rect.top + window.scrollY}px`);
    editor.style.setProperty('--kc-width', `${rect.width}px`);
    return rect;
  }

  // Keep 打开时会对编辑框本身调一次不带 preventScroll 的 focus()，浏览器会把它滚进视野。
  // 所以按下卡片的那一刻（Keep 还没开始打开）就先把编辑框摆到这张卡片上，并记下滚动位置。
  function pressCard(event) {
    if (!(event.target instanceof Element) || event.button > 0) return;
    if (event.type === 'keydown' && event.key !== 'Enter') return;
    const card = event.target.closest('.gkA7Yd-sKfxWe .IZ65Hb-n0tgWb');
    if (!card) return;
    editing.press = { x: window.scrollX, y: window.scrollY, time: Date.now() };
    const editor = document.querySelector('.XKSfm-L9AdLc');
    if (editor && !document.body.classList.contains(OPEN_CLASS)) placeEditor(editor, card);
  }
  window.addEventListener('pointerdown', pressCard, true);
  window.addEventListener('keydown', pressCard, true);

  function startEditing() {
    const editor = document.querySelector('.XKSfm-L9AdLc');
    const source = document.querySelector('.gkA7Yd-sKfxWe .IZ65Hb-fbudBf');
    editor?.classList.toggle('kc-inline', !!source);
    // 直达链接打开、或列表里找不到原卡片时，保留 Keep 原来的弹窗
    if (!editor || !source) return;
    Object.assign(editing, { editor, source, key: '', gap: null });
    document.body.classList.add('kc-editing');
    // 万一打开过程中页面还是被滚动了，在这一帧画出来之前拉回按下时的位置
    const press = editing.press;
    if (press && Date.now() - press.time < 1500 &&
        (Math.abs(window.scrollY - press.y) > 1 || Math.abs(window.scrollX - press.x) > 1)) {
      window.scrollTo(press.x, press.y);
    }
    editing.press = null;
    Object.assign(editing, { active: true, scroll: [window.scrollX, window.scrollY] });
    follow();
  }

  // 从开始编辑到 Keep 放完退场动画，记下页面滚到哪了（自己滚的也算）。关闭时 Keep 两次调不带 preventScroll 的 focus()，
  // 被 focus 的东西没整个露出来时浏览器就把页面滚过去；两次都在滚动事件派发之前拉回记下的位置，原地收起。
  window.addEventListener('scroll', () => {
    if (editing.active) editing.scroll = [window.scrollX, window.scrollY];
  }, { passive: true });
  function keepScroll() {
    const [x, y] = editing.scroll;
    if (Math.abs(window.scrollY - y) > 1 || Math.abs(window.scrollX - x) > 1) window.scrollTo(x, y);
  }
  // 第二次在退场动画放完时，focus 列表里原卡片中的一层。焦点在编辑框里怎么变不管：Tab 到哪就该看到哪
  window.addEventListener('focusin', event => {
    if (!editing.active || !(event.target instanceof Element) || !event.target.closest('.gkA7Yd-sKfxWe')) return;
    keepScroll();
    queueMicrotask(keepScroll);  // 万一浏览器是派发完 focusin 才滚
  }, true);

  function stopEditing() {
    cancelAnimationFrame(editing.frame);
    // 第一次在关闭的同一轮任务里，focus 编辑框里的卡片：Keep 的弹窗是固定定位的不会滚，原位编辑框会
    if (editing.active) keepScroll();
    pushDown(0);
    document.body.classList.remove('kc-editing');
    // 编辑框的 kc-inline 先留着，退场动画期间由样式藏住，免得它跳回屏幕中间；等 Keep 真藏起它再清
    editing.source = null;
    const editor = editing.editor;
    if (!editor) return;
    const done = new MutationObserver(() => {
      if (document.body.classList.contains(OPEN_CLASS)) { done.disconnect(); return; }
      if (editor.classList.contains('eo9XGd')) return;
      done.disconnect();
      editor.classList.remove('kc-inline');
      for (const key of ['--kc-left', '--kc-top', '--kc-width']) editor.style.removeProperty(key);
      editing.active = false;
    });
    done.observe(editor, { attributes: true, attributeFilter: ['class'] });
    done.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  // 每一帧对一下原卡片的位置和编辑框的高度，有变化才写（Keep 重排、打字长高、窗口变宽都跟得上）
  function follow() {
    const { editor } = editing;
    let { source } = editing;
    if (!source) return;
    // 编辑中点了另一张卡片，Keep 会直接把编辑框换成那条记事（弹窗不关）；列表重画时原卡片也可能换成新节点。跟着换。
    const current = document.querySelector('.gkA7Yd-sKfxWe .IZ65Hb-fbudBf');
    if (current !== source) {
      pushDown(0);
      Object.assign(editing, { source: current, gap: null, key: '' });
      source = current;
    }
    if (!source) { stopEditing(); return; }
    const rect = source.getBoundingClientRect();
    const height = editor.getBoundingClientRect().height;
    // Keep 给原卡片留的空间：到同一列下一个元素为止，减去两者本来的间距（开始编辑时量一次）。
    // 打字时 Keep 会顺手把藏着的原卡片撑高，却不一定马上重排下面的卡片，所以不能拿原卡片现在的高度算。
    const next = belowSource(source).find(sameColumn(source));
    if (editing.gap === null) editing.gap = next ? yOf(next) - yOf(source) - rect.height : 0;
    const room = next ? yOf(next) - yOf(source) - editing.gap : rect.height;
    const delta = Math.max(0, Math.round(height - room));
    const key = [rect.left + window.scrollX, rect.top + window.scrollY, rect.width, height, delta]
      .map(Math.round).join();
    if (key !== editing.key) {
      editing.key = key;
      placeEditor(editor, source);
      pushDown(delta);
    }
    editing.frame = requestAnimationFrame(follow);
  }

  // 列表里排在原卡片下面的元素（卡片和分组标题），从上到下
  const belowSource = source => [...source.parentElement.children]
    .filter(element => element !== source && yOf(element) > yOf(source))
    .sort((a, b) => yOf(a) - yOf(b));
  const sameColumn = source => {
    const left = xOf(source);
    const right = left + source.offsetWidth;
    return element => xOf(element) < right - 1 && xOf(element) + element.offsetWidth > left + 1;
  };

  // 同一列里原卡片下面的元素（卡片和藏起来的分组标题）往下推 delta。分组标题只有文字那么宽、又藏着，不用管别的列。
  function pushDown(delta) {
    const { source } = editing;
    const group = source?.parentElement;
    const next = new Set(group && delta > 0 ? belowSource(source).filter(sameColumn(source)) : []);
    if (next.size) group.style.setProperty('margin-bottom', `${delta}px`);
    else group?.style.removeProperty('margin-bottom');
    for (const element of editing.shifted) if (!next.has(element)) element.style.removeProperty('translate');
    for (const element of next) element.style.setProperty('translate', `0 ${delta}px`);
    editing.shifted = next;
  }

  // 宽窗编辑框的关闭是底栏右边的 Close（TvD9Pc），手机版是工具栏里的 × 图标；两者都带 iib5kc
  function closeEditor() {
    const buttons = editing.editor?.querySelectorAll('.IZ65Hb-iib5kc') || [];
    activate([...buttons].find(button => button.getClientRects().length > 0));
  }

  // Keep 的菜单、标签选择框都是挂在 body 下的浮层；点到列表、顶栏、侧栏这些页面本身的地方才算「点到外面」
  window.addEventListener('pointerdown', event => {
    if (!editing.source || event.button > 0 || !(event.target instanceof Element)) return;
    if (editing.editor.contains(event.target)) return;
    if (!event.target.closest('.notes-container, #ognwrapper, .PvRhvb')) return;
    // 点另一张卡片时 Keep 会直接换成那条记事；先关反而会让 Keep 忽略这次点击
    if (event.target.closest('.gkA7Yd-sKfxWe .IZ65Hb-n0tgWb')) return;
    closeEditor();
  }, true);
  // Keep 打开编辑框后，会把落在编辑框上的老式 mousewheel 事件 preventDefault 掉（原来是为了只滚编辑框自己的正文区），
  // 原位编辑时就成了页面滚不动。在编辑框和列表上滚动时不让 Keep 收到这些事件，浏览器照常滚页面；菜单浮层不受影响。
  for (const type of ['wheel', 'mousewheel', 'DOMMouseScroll', 'touchmove']) {
    window.addEventListener(type, event => {
      if (editing.source && event.target instanceof Element &&
          event.target.closest('.XKSfm-L9AdLc, .notes-container')) event.stopImmediatePropagation();
    }, { capture: true, passive: true });
  }
  // 焦点在编辑框里时 Keep 自己会处理 Esc；焦点不在里面（比如点过页面别处）时替它关
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || !editing.source) return;
    if (editing.editor.contains(document.activeElement)) return;
    if (document.activeElement?.closest('.Q0hgme-xl07Ob, .mQXP-L9AdLc, [role="dialog"], [role="menu"]')) return;
    closeEditor();
  });

  let wasOpen = false;
  function watchEditor() {
    new MutationObserver(() => {
      const open = document.body.classList.contains(OPEN_CLASS);
      if (open === wasOpen) return;
      wasOpen = open;
      if (open) startEditing(); else stopEditing();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  if (document.body) watchEditor();
  else document.addEventListener('DOMContentLoaded', watchEditor, { once: true });

  // 标签按钮：编辑框和新建记事栏里的「协作者」按钮改当标签按钮。按下、松开、点击都拦下来不给 Keep，
  // 点击时替用户点 More，再点菜单里的「添加标签 / 更改标签」，打开 Keep 自己的标签选择框。
  const LABEL_HOST = '.XKSfm-L9AdLc .euCgFf, .h1U9Be-xhiy4 .euCgFf';
  const LABEL_ITEM = /label|标签|標籤|ラベル|라벨/i;
  let labelRequest = 0;

  function openLabels(button) {
    const more = button.closest('.IZ65Hb-INgbqf')?.querySelector('.xl07Ob');
    if (!more || more.getAttribute('aria-disabled') === 'true') return;
    const request = ++labelRequest;
    const deadline = performance.now() + 600;
    document.documentElement.classList.add('kc-labels-opening');
    activate(more);
    (function pick() {
      if (request !== labelRequest) return;
      const menu = [...document.querySelectorAll('.Q0hgme-xl07Ob')].find(element => element.getBoundingClientRect().height > 0);
      const item = menu && [...menu.querySelectorAll('[role="menuitem"]')]
        .find(element => element.getAttribute('aria-hidden') !== 'true' && LABEL_ITEM.test(element.textContent));
      if (item) activate(item);
      // 认不出这一项（Keep 改版或翻译不同）就把 More 菜单留给用户自己点
      if (item || performance.now() > deadline) {
        document.documentElement.classList.remove('kc-labels-opening');
        return;
      }
      requestAnimationFrame(pick);
    })();
  }

  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'keydown']) {
    window.addEventListener(type, event => {
      const button = event.target instanceof Element && event.target.closest(LABEL_HOST);
      if (!button || (type === 'keydown' && event.key !== 'Enter' && event.key !== ' ')) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      if (type === 'click' || type === 'keydown') openLabels(button);
    }, true);
  }
  // 悬停提示也改成「标签」（Keep 的提示读 data-tooltip-text）
  window.addEventListener('pointerover', event => {
    const button = event.target instanceof Element && event.target.closest(LABEL_HOST);
    if (!button || button.dataset.kcLabel) return;
    const text = /\p{Script=Han}/u.test(button.getAttribute('aria-label') || '') ? '标签' : 'Labels';
    button.dataset.kcLabel = '1';
    button.setAttribute('aria-label', text);
    button.setAttribute('data-tooltip-text', text);
  }, true);

  if (typeof GM_registerMenuCommand === 'function') {
    try {
      GM_registerMenuCommand('图标缩放…', askScale);
    } catch (error) {
      console.warn('[Keep 窄窗]', error);
    }
  }
  if (isNarrowWindow()) rememberNarrowWindow();
})();
