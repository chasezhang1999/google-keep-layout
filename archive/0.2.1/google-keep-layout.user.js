// ==UserScript==
// @name         Google Keep 窄窗布局
// @namespace    chase.google-keep-layout
// @version      0.2.1
// @description  自适应卡片宽度、单列阅读、紧凑间距；右下角可恢复原版。
// @match        https://keep.google.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  if (document.getElementById('keep-layout-control')) return;

  const defaults = { mode: 'auto', width: 210, gap: 8 };
  let saved = {};
  let storageWarning = '';
  try {
    if (typeof GM_getValue === 'function') saved = GM_getValue('layout', {});
    else storageWarning = '设置仅在当前页面生效（油猴存储接口不可用）。';
  } catch (error) {
    storageWarning = '读取设置失败，已使用默认值。';
    console.warn('[Keep Layout]', error);
  }
  const config = {
    mode: ['auto', 'single', 'native'].includes(saved?.mode) ? saved.mode : defaults.mode,
    width: Math.min(360, Math.max(180, Number(saved?.width) || defaults.width)),
    gap: Math.min(24, Math.max(4, Number(saved?.gap) || defaults.gap)),
  };
  const root = document.documentElement;
  // Legacy selectors are only one adapter; accessible card controls provide
  // a second adapter when Keep changes its generated classes.
  const cardSelector = '.IZ65Hb-n0tgWb';
  const excluded = '[role="dialog"],[aria-modal="true"],.IZ65Hb-QQhtn,.VIpgJd-TUo6Hb';
  const groups = new Map();
  const marked = new Map();
  let timer;
  let stopped = false;
  let count = 0;

  const style = document.createElement('style');
  style.id = 'keep-layout-style';
  style.textContent = `
    html[data-keep-layout] .keep-layout-group {
      display: grid !important;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--keep-card-width)), 1fr)) !important;
      gap: var(--keep-gap) !important;
      align-items: start !important;
      align-content: start !important;
      position: relative !important;
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      height: auto !important;
      min-height: 0 !important;
      margin-inline: 0 !important;
      box-sizing: border-box !important;
      padding: 8px !important;
    }
    html[data-keep-layout="single"] .keep-layout-group {
      grid-template-columns: minmax(0, 1fr) !important;
    }
    html[data-keep-layout] .keep-layout-group > .keep-layout-card {
      position: relative !important;
      inset: auto !important;
      transform: none !important;
      width: 100% !important;
      min-width: 0 !important;
      max-width: 100% !important;
      height: auto !important;
      margin: 0 !important;
      box-sizing: border-box !important;
      transition: none !important;
    }
    html[data-keep-layout] .keep-layout-inner {
      position: relative !important;
      inset: auto !important;
      transform: none !important;
      width: 100% !important;
      min-width: 0 !important;
      max-width: 100% !important;
      height: auto !important;
      box-sizing: border-box !important;
    }
    html[data-keep-layout] .keep-layout-extra {
      grid-column: 1 / -1 !important;
    }
    html[data-keep-layout] .keep-layout-card .IZ65Hb-YPqjbf {
      overflow-wrap: anywhere;
    }
  `;
  document.head.append(style);

  const host = document.createElement('div');
  host.id = 'keep-layout-control';
  host.style.cssText = 'position:fixed!important;right:12px!important;bottom:12px!important;z-index:2147483647!important;display:block!important';
  const shadow = host.attachShadow({ mode: 'open' });
  // Build DOM nodes directly: string-to-innerHTML can throw under Trusted Types.
  // In v0.1.0 that assignment ran before the control was attached to the document.
  function element(tag, attrs = {}, text = '') {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text) node.textContent = text;
    return node;
  }
  const panelStyle = element('style');
  panelStyle.textContent = `
      :host { font: 13px/1.5 system-ui, sans-serif; color-scheme: light dark; }
      button,select,input { font: inherit; }
      button,select { color: CanvasText; background: Canvas; border: 1px solid #8886;
        border-radius: 7px; padding: 6px 10px; cursor: pointer; }
      #panel { box-sizing: border-box; width: min(280px, calc(100vw - 24px));
        padding: 14px; margin-bottom: 8px; color: CanvasText; background: Canvas;
        border: 1px solid #8886; border-radius: 12px; box-shadow: 0 4px 20px #0002; }
      [hidden] { display: none !important; }
      label { display: block; margin: 10px 0; }
      select,input { width: 100%; box-sizing: border-box; }
      p { margin: 8px 0; font-size: 12px; opacity: .75; }
      #toggle { display: block; margin-left: auto; box-shadow: 0 2px 8px #0001; }
      strong { font-size: 14px; }
  `;
  const panel = element('section', { id: 'panel', hidden: '', 'aria-label': 'Keep 布局设置' });
  panel.append(element('strong', {}, 'Keep 窄窗布局 · 0.2.1'));
  const modeLabel = element('label', {}, '排列方式');
  const modeSelect = element('select', { id: 'mode' });
  for (const [value, text] of [['auto', '自动列数'], ['single', '单列阅读'], ['native', '原版布局']]) {
    modeSelect.append(element('option', { value }, text));
  }
  modeLabel.append(modeSelect);
  panel.append(modeLabel);
  for (const [id, title, min, max, step] of [
    ['width', '卡片最小宽度：', 180, 360, 10],
    ['gap', '卡片间距：', 4, 24, 2],
  ]) {
    const label = element('label', {}, title);
    label.append(element('output', { id: `${id}Value` }), ' px',
      element('input', { id, type: 'range', min, max, step }));
    panel.append(label);
  }
  panel.append(
    element('p', { id: 'status', role: 'status' }, '脚本已启动，正在识别卡片…'),
    element('p', { id: 'storage-status' }, storageWarning),
    element('p', {}, '需要拖动排序时，请切回原版布局。这里调整网页排版，不能解除浏览器窗口最小宽度。'),
    element('button', { id: 'reset', type: 'button' }, '恢复默认设置'),
  );
  shadow.append(panelStyle, panel,
    element('button', {
      id: 'toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'panel',
      title: 'Google Keep 窄窗布局 0.2.1 已运行',
    }, '布局 · 0.2.1'));
  document.body.append(host);
  const $ = id => shadow.getElementById(id);

  function clearGroups() {
    for (const [node, classes] of marked) {
      for (const name of classes) node.classList.remove(name);
    }
    marked.clear();
    groups.clear();
  }

  function mark(node, name) {
    node.classList.add(name);
    if (!marked.has(node)) marked.set(node, new Set());
    marked.get(node).add(name);
  }

  function isEditor(node) {
    return !!node.closest(excluded) ||
      !!node.querySelector('[contenteditable="true"],[contenteditable=""],textarea');
  }

  function controlName(node) {
    return (node.getAttribute('aria-label') || node.getAttribute('data-tooltip') ||
      node.getAttribute('title') || '').trim();
  }

  function findCards() {
    const cards = new Map();
    const legacy = [...document.querySelectorAll(cardSelector)];
    for (const card of legacy) {
      if (isEditor(card)) continue;
      const surface = card.querySelector('.IZ65Hb-TBnied');
      if (surface) cards.set(card, surface);
    }
    const controls = [...document.querySelectorAll('[role="button"],button')];
    const selection = /^(?:select note|选择(?:此)?(?:笔记|便笺)|選取(?:此)?(?:筆記|記事)|選擇(?:此)?(?:筆記|記事))$/i;
    const markers = controls.filter(el => selection.test(controlName(el)));
    for (const marker of markers) {
      if (marker.closest(excluded) || [...cards.keys()].some(card => card.contains(marker))) continue;
      let candidate = null;
      let fallback = null;
      for (let node = marker.parentElement, depth = 0;
        node && node !== document.body && depth < 8; node = node.parentElement, depth++) {
        if (node.matches('main,header,nav,[role="main"],[role="navigation"]') ||
            isEditor(node) || markers.filter(other => node.contains(other)).length !== 1) break;
        const names = [...node.querySelectorAll('[role="button"],button')].map(controlName);
        const noteAction = /^(?:(?:un)?pin note|archive(?: note)?|more|置顶|取消置顶|固定|取消固定|归档|封存|更多)(?:.*)$/i;
        if (names.some(name => noteAction.test(name))) {
          fallback ||= node;
          const computed = getComputedStyle(node);
          if (computed.position === 'absolute' ||
              (computed.transform && computed.transform !== 'none')) candidate = node;
        }
      }
      candidate ||= fallback;
      if (candidate && ![...cards.keys()].some(card => card.contains(candidate) || candidate.contains(card))) {
        cards.set(candidate, null);
      }
    }
    return { cards, legacyCount: legacy.length, markerCount: markers.length };
  }

  function isAuxiliary(node) {
    const interactive = 'button,input,textarea,select,img,svg,canvas,[role="button"],[contenteditable]';
    return node.matches('script,style,[hidden],[aria-hidden="true"],[role="heading"],h1,h2,h3,h4,hr') ||
      (!node.matches(interactive) && !node.querySelector(interactive));
  }

  function findGroups(cards) {
    const proposed = new Map();
    for (const card of cards.keys()) {
      let item = card;
      // A card wrapper may also contain a static label or layout helper.
      // Stop at the first shared list so pinned and ordinary sections stay apart.
      for (let depth = 0; depth < 4; depth++) {
        const parent = item.parentElement;
        if (!parent || parent === document.body || parent === root ||
            parent.matches('header,nav,[role="navigation"]') ||
            parent.closest(excluded)) break;
        if (!proposed.has(parent)) proposed.set(parent, new Map());
        proposed.get(parent).set(item, card);
        const siblings = [...parent.children].filter(child => child !== item);
        if (parent.matches('main,[role="main"]') ||
            siblings.some(child => [...cards.keys()].some(other => child.contains(other))) ||
            !siblings.every(isAuxiliary)) break;
        item = parent;
      }
    }
    // Prefer the common list over each single-card wrapper.
    return [...proposed].sort((a, b) => b[1].size - a[1].size ||
      (a[0].contains(b[0]) ? -1 : b[0].contains(a[0]) ? 1 : 0));
  }

  function refresh() {
    timer = undefined;
    if (stopped) return;
    // Only our own class mutations are made while disconnected.
    observer.disconnect();
    clearGroups();
    count = 0;
    const found = findCards();
    let rejectedGroups = 0;
    const proposed = findGroups(found.cards);
    if (config.mode !== 'native') {
      const used = new Set();
      for (const [parent, items] of proposed) {
        if ([...items.values()].some(card => used.has(card))) continue;
        const extras = [...parent.children].filter(el => !items.has(el));
        // Two or more independently identified sibling cards establish a list.
        // Other children (labels, helpers, toolbars) get a full-width grid row;
        // they are not classified as cards and retain their visibility and styles.
        // A single card alone is insufficient evidence to reflow an app shell.
        if (items.size === 1 &&
            (parent.matches('main,[role="main"]') || !extras.every(isAuxiliary))) {
          rejectedGroups++;
          continue;
        }
        mark(parent, 'keep-layout-group');
        for (const extra of extras) mark(extra, 'keep-layout-extra');
        for (const [item, card] of items) {
          mark(item, 'keep-layout-card');
          // Make wrappers and the known card surface fluid without changing text,
          // toolbar positioning, event handlers or DOM order.
          const surface = found.cards.get(card) || card;
          for (let node = surface; node && node !== item; node = node.parentElement) {
            mark(node, 'keep-layout-inner');
          }
          used.add(card);
        }
        groups.set(parent, [...items.keys()]);
        count += items.size;
      }
    }
    $('status').textContent = config.mode === 'native'
      ? '已恢复原版排版。'
      : count ? `识别 ${found.cards.size} 张，已对 ${count} 张应用排版（${groups.size} 组）。`
        : `未应用排版：候选卡片 ${found.cards.size}，候选容器 ${proposed.length}，跳过容器 ${rejectedGroups}。`;
    observer.observe(document.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['class', 'role', 'aria-modal', 'aria-label', 'contenteditable'],
    });
  }

  function schedule() {
    if (timer === undefined && !stopped) timer = setTimeout(refresh, 120);
  }

  function apply() {
    if (config.mode === 'native') root.removeAttribute('data-keep-layout');
    else root.dataset.keepLayout = config.mode;
    root.style.setProperty('--keep-card-width', `${config.width}px`);
    root.style.setProperty('--keep-gap', `${config.gap}px`);
    for (const key of ['mode', 'width', 'gap']) $(key).value = config[key];
    $('widthValue').textContent = config.width;
    $('gapValue').textContent = config.gap;
    $('width').disabled = config.mode !== 'auto';
    try {
      if (typeof GM_setValue === 'function') GM_setValue('layout', { ...config });
    } catch (error) {
      $('storage-status').textContent = '设置保存失败，本次调整仍然生效。';
      console.warn('[Keep Layout]', error);
    }
    schedule();
    // Ask Keep to recalculate its own surrounding layout when restoring it.
    window.dispatchEvent(new Event('resize'));
  }

  function togglePanel() {
    $('panel').hidden = !$('panel').hidden;
    $('toggle').setAttribute('aria-expanded', String(!$('panel').hidden));
    if (!$('panel').hidden) $('mode').focus();
  }
  $('toggle').addEventListener('click', togglePanel);
  shadow.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      $('panel').hidden = true;
      $('toggle').setAttribute('aria-expanded', 'false');
      $('toggle').focus();
      event.stopPropagation();
    }
  });
  for (const key of ['mode', 'width', 'gap']) {
    $(key).addEventListener('input', () => {
      config[key] = key === 'mode' ? $(key).value : Number($(key).value);
      apply();
    });
  }
  $('reset').addEventListener('click', () => { Object.assign(config, defaults); apply(); });
  if (typeof GM_registerMenuCommand === 'function') {
    try { GM_registerMenuCommand('Keep 布局设置', togglePanel); }
    catch (error) { console.warn('[Keep Layout]', error); }
  }
  const observer = new MutationObserver(schedule);
  window.addEventListener('hashchange', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('pagehide', () => {
    stopped = true;
    observer.disconnect();
    clearTimeout(timer);
    timer = undefined;
  });
  window.addEventListener('pageshow', () => { stopped = false; schedule(); });
  apply();
})();
