const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');
const script = readFileSync(`${__dirname}/google-keep-layout.user.js`, 'utf8');

// 模拟油猴环境与窗口。jsdom 不做排版，这里只测脚本逻辑，不测实际缩放效果。
function setup(t, { url = 'https://keep.google.com/u/0/', values = {}, gm = 'working', prompts = [] } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url,
    runScripts: 'outside-only',
  });
  const w = dom.window;
  // 与 Trusted Types 一样拒绝 HTML 字符串，防止以后改动又用回 innerHTML；
  // jsdom 自己关窗口时要用 innerHTML，先还原
  const innerHTML = Object.getOwnPropertyDescriptor(w.Element.prototype, 'innerHTML');
  Object.defineProperty(w.Element.prototype, 'innerHTML', {
    set() { throw new TypeError('TrustedHTML required'); },
    configurable: true,
  });
  t.after(() => {
    Object.defineProperty(w.Element.prototype, 'innerHTML', innerHTML);
    w.close();
  });
  const log = { stored: [], menu: {}, calls: [], alerts: [] };
  const store = { ...values };
  if (gm !== 'missing') {
    w.GM_getValue = (key, fallback) => {
      if (gm === 'broken') throw new Error('storage unavailable');
      return key in store ? store[key] : fallback;
    };
    // 存进来的对象属于 jsdom 的 realm，转成普通对象再比较
    w.GM_setValue = (key, value) => {
      store[key] = JSON.parse(JSON.stringify(value));
      log.stored.push([key, store[key]]);
    };
    w.GM_registerMenuCommand = (name, fn) => { log.menu[name] = fn; };
  }
  // 窗口大小位置（屏幕单位）。resizeTo/moveTo 直接生效，像 --app 窗口那样
  const win = { x: 13, y: 13, w: 1522, h: 1660 };
  for (const [prop, key] of [['screenX', 'x'], ['screenY', 'y'], ['outerWidth', 'w'], ['outerHeight', 'h']]) {
    Object.defineProperty(w, prop, { get: () => win[key], configurable: true });
  }
  Object.defineProperty(w.screen, 'availWidth', { get: () => 3072, configurable: true });
  Object.defineProperty(w.screen, 'availHeight', { get: () => 1680, configurable: true });
  w.resizeTo = (width, height) => { log.calls.push(['resizeTo', width, height]); Object.assign(win, { w: width, h: height }); };
  w.moveTo = (x, y) => { log.calls.push(['moveTo', x, y]); Object.assign(win, { x, y }); };
  w.resizeBy = (dx, dy) => { log.calls.push(['resizeBy', dx, dy]); win.w += dx; win.h += dy; };
  w.prompt = () => prompts.shift() ?? null;
  w.alert = message => log.alerts.push(message);
  w.console.warn = () => {};
  const fire = type => w.dispatchEvent(new w.Event(type));
  return { w, win, log, store, fire, run: () => w.eval(script), style: () => w.document.getElementById('keep-compact-style') };
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const boundsSaves = log => log.stored.filter(([key]) => key === 'narrowBounds').map(([, value]) => value);

test('style goes in before <head> exists, once, with the default 75% scale', t => {
  const { w, run, style } = setup(t);
  w.document.head.remove();
  run();
  run();
  assert.equal(w.document.querySelectorAll('#keep-compact-style').length, 1);
  assert.equal(style().parentElement, w.document.documentElement);
  const css = style().textContent;
  assert.match(css, /#ognwrapper, \.tJHJj-ZMv3u \{ zoom: 0\.75; \}/);
  assert.match(css, /\.PvRhvb \{ zoom: 0\.75; \}/);
  assert.match(css, /body \{ min-width: 0 !important; \}/);
  assert.match(css, /@media \(max-width: 315px\)/);
});

for (const gm of ['missing', 'broken']) {
  test(`GM storage ${gm}: style still applies with defaults`, t => {
    const { run, style } = setup(t, { gm });
    assert.doesNotThrow(run);
    assert.match(style().textContent, /\.PvRhvb \{ zoom: 0\.75; \}/);
  });
}

test('saved scale is used when valid and ignored when not', t => {
  const good = setup(t, { values: { compact: { scale: 0.6 } } });
  good.run();
  assert.match(good.style().textContent, /\.PvRhvb \{ zoom: 0\.6; \}/);
  const bad = setup(t, { values: { compact: { scale: 3 } } });
  bad.run();
  assert.match(bad.style().textContent, /\.PvRhvb \{ zoom: 0\.75; \}/);
});

test('scale command rewrites the style without touching the window', async t => {
  const { log, run, style } = setup(t, { prompts: ['85', '120'] });
  run();
  assert.deepEqual(Object.keys(log.menu), ['图标缩放…']);
  log.menu['图标缩放…']();
  assert.match(style().textContent, /\.PvRhvb \{ zoom: 0\.85; \}/);
  assert.deepEqual(log.stored.at(-1), ['compact', { scale: 0.85 }]);
  await wait(150);
  assert.deepEqual(log.calls, []);
  log.menu['图标缩放…']();
  assert.equal(log.alerts.length, 1);
  assert.match(style().textContent, /zoom: 0\.85/);
});

test('sidebar becomes a dropdown: no reserved width, text scales with a 12px floor', t => {
  const { run, style } = setup(t);
  run();
  const css = style().textContent;
  assert.match(css, /\.PvRhvb \.PvRhvb-fozPsf-ysyhld \{ min-width: 0 !important; width: 0 !important; \}/);
  assert.match(css, /\.PvRhvb\.PvRhvb-qAWA2 \.PvRhvb-bN97Pc \{\s*visibility: hidden;/);
  assert.match(css, /font-size: max\(calc\(12px \* 1\.3333\), \.875rem\)/);
});

// 仿 Keep：点菜单按钮切换 .PvRhvb 上的 PvRhvb-qAWA2 和按钮的 aria-expanded
function keepMenu(w, { iconPath = true } = {}) {
  const doc = w.document;
  const header = doc.createElement('header');
  header.id = 'gb';
  const button = doc.createElement('div');
  button.setAttribute('role', 'button');
  button.setAttribute('aria-expanded', 'false');
  if (iconPath) {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z');
    svg.append(path);
    button.append(svg);
  }
  header.append(button);
  const sidebar = doc.createElement('div');
  sidebar.className = 'PvRhvb PvRhvb-qAWA2';
  const panel = doc.createElement('div');
  panel.className = 'PvRhvb-bN97Pc';
  const items = ['记事', '提醒'].map(name => {
    const item = doc.createElement('div');
    item.className = 'PvRhvb-ibnC6b';
    item.textContent = name;
    panel.append(item);
    return item;
  });
  const blank = doc.createElement('div');
  panel.append(blank);
  sidebar.append(panel);
  const note = doc.createElement('div');
  doc.body.append(header, sidebar, note);
  let toggles = 0;
  button.addEventListener('click', () => {
    toggles++;
    const open = sidebar.classList.toggle('PvRhvb-qAWA2') === false;
    button.setAttribute('aria-expanded', String(open));
  });
  return {
    button, items, blank, note,
    open: () => !sidebar.classList.contains('PvRhvb-qAWA2'),
    toggles: () => toggles,
  };
}

test('menu remembered as open in wide mode starts closed', t => {
  const opened = setup(t);
  opened.w.localStorage.setItem('keep_db::left_nav_menu_open_state', 'true');
  opened.run();
  assert.equal(opened.w.localStorage.getItem('keep_db::left_nav_menu_open_state'), 'false');
  const untouched = setup(t);
  untouched.run();
  assert.equal(untouched.w.localStorage.getItem('keep_db::left_nav_menu_open_state'), null);
});

test('dropdown closes after picking an item, clicking outside or pressing Escape', async t => {
  const { w, run } = setup(t);
  run();
  const menu = keepMenu(w);
  menu.button.click();
  assert.equal(menu.open(), true);
  menu.items[1].click();
  await wait(10);
  assert.equal(menu.open(), false, 'picking an item closes the menu');

  menu.button.click();
  menu.blank.click();
  await wait(10);
  assert.equal(menu.open(), true, 'blank space inside the menu keeps it open');
  menu.note.click();
  await wait(10);
  assert.equal(menu.open(), false, 'clicking outside closes the menu');

  menu.button.click();
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(menu.open(), false, 'Escape closes the menu');

  const before = menu.toggles();
  menu.note.click();
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  await wait(10);
  assert.equal(menu.toggles(), before, 'nothing happens while the menu is closed');

  menu.button.click();
  menu.button.click();
  await wait(10);
  assert.equal(menu.open(), false);
  assert.equal(menu.toggles(), before + 2, 'the menu button itself is left to Keep');
});

test('menu button is still found without the standard icon', async t => {
  const { w, run } = setup(t);
  run();
  const menu = keepMenu(w, { iconPath: false });
  menu.button.click();
  menu.note.click();
  await wait(10);
  assert.equal(menu.open(), false);
});

test('a menu that is open when the page finishes loading gets closed', async t => {
  const { w, fire, run } = setup(t);
  run();
  const menu = keepMenu(w);
  menu.button.click();
  fire('load');
  await wait(350);
  assert.equal(menu.open(), false);
});

test('ordinary Keep windows never move, resize or record bounds', async t => {
  const saved = { x: 2400, y: 150, w: 360, h: 1100 };
  const { win, log, fire, run } = setup(t, { values: { narrowBounds: saved } });
  run();
  fire('load');
  await wait(900);
  win.w = 800;
  fire('resize');
  fire('pagehide');
  await wait(700);
  assert.deepEqual(log.calls, []);
  assert.deepEqual(boundsSaves(log), []);
});

test('narrow window, first launch: records size and position after the user resizes', async t => {
  const { w, win, log, fire, run } = setup(t, { url: 'https://keep.google.com/#kc-narrow' });
  run();
  assert.equal(w.sessionStorage.getItem('keep-compact-narrow'), '1');
  assert.deepEqual(log.calls, []);
  Object.assign(win, { x: 2600, y: 100, w: 380 });
  fire('resize');
  fire('resize');
  await wait(700);
  assert.deepEqual(boundsSaves(log), [{ x: 2600, y: 100, w: 380, h: 1660 }]);
});

test('narrow window restores bounds: resize first, then move, again after load', async t => {
  const saved = { x: 2400, y: 150, w: 360, h: 1100 };
  const { log, fire, run } = setup(t, { url: 'https://keep.google.com/#kc-narrow', values: { narrowBounds: saved } });
  run();
  assert.deepEqual(log.calls, [['resizeTo', 360, 1100], ['moveTo', 2400, 150]]);
  fire('load');
  assert.deepEqual(log.calls.slice(2), [['resizeTo', 360, 1100], ['moveTo', 2400, 150]]);
});

test('restore offsets are not saved, real user changes are', async t => {
  const saved = { x: 2400, y: 150, w: 360, h: 1100 };
  const { win, log, fire, run } = setup(t, { url: 'https://keep.google.com/#kc-narrow', values: { narrowBounds: saved } });
  run();
  fire('load');
  win.h += 2; // Chrome 摆出来比要求高 2
  fire('resize');
  await wait(900);
  fire('resize');
  fire('pagehide');
  await wait(700);
  assert.deepEqual(boundsSaves(log), [], 'a 2-unit offset after restoring is not a user change');

  Object.assign(win, { x: 2500, y: 160 }); // 只挪位置：保存位置，大小保持原记录
  fire('pagehide');
  assert.deepEqual(boundsSaves(log).at(-1), { x: 2500, y: 160, w: 360, h: 1100 });

  win.w = 420; // 拖宽：保存新大小
  fire('resize');
  await wait(700);
  assert.deepEqual(boundsSaves(log).at(-1), { x: 2500, y: 160, w: 420, h: 1102 });
  assert.equal(boundsSaves(log).length, 2);
});

test('maximized narrow window is not recorded', async t => {
  const { win, log, fire, run } = setup(t, { url: 'https://keep.google.com/#kc-narrow' });
  run();
  Object.assign(win, { x: 0, y: 0, w: 3072, h: 1680 });
  fire('resize');
  fire('pagehide');
  await wait(700);
  assert.deepEqual(boundsSaves(log), []);
});

test('marker survives Keep changing the address (kept in sessionStorage)', async t => {
  const { w, log, run } = setup(t, { url: 'https://keep.google.com/#home', values: { narrowBounds: { x: 1, y: 2, w: 300, h: 900 } } });
  w.sessionStorage.setItem('keep-compact-narrow', '1');
  run();
  assert.deepEqual(log.calls, [['resizeTo', 300, 900], ['moveTo', 1, 2]]);
});

test('invalid saved bounds are ignored', t => {
  const { log, run } = setup(t, { url: 'https://keep.google.com/#kc-narrow', values: { narrowBounds: { x: 1, y: 2, w: 50, h: 'big' } } });
  run();
  assert.deepEqual(log.calls, []);
});

test('a second click on the menu button closes the dropdown even when Keep closes it on pointerdown', async t => {
  const { w, run } = setup(t);
  run();
  const menu = keepMenu(w);
  const click = () => {
    menu.button.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    menu.button.click();
  };
  click(); await wait(20);
  assert.equal(menu.open(), true);
  // 窄窗时 Keep 在按下鼠标时就把菜单当「点到外面」关掉，紧接着按钮的 click 又会把它打开
  menu.button.addEventListener('pointerdown', () => {
    if (menu.open()) {
      w.document.querySelector('.PvRhvb').classList.add('PvRhvb-qAWA2');
      menu.button.setAttribute('aria-expanded', 'false');
    }
  });
  click(); await wait(20);
  assert.equal(menu.open(), false);
  assert.equal(menu.button.getAttribute('aria-expanded'), 'false');
  click(); await wait(20);
  assert.equal(menu.open(), true);
  click(); await wait(20);
  assert.equal(menu.open(), false);
});

// 下面测 0.7.0 的原位编辑和标签按钮。结构照 2026-10 在真实页面上核对过的 Keep 搭（类名见 README），
// 只模仿脚本依赖的那几个 Keep 行为；jsdom 不排版，位置和高度都是手写的。
const OPEN_CLASS = 'XKSfm-L9AdLc-prCEue-uA7qgc';
const tick = () => wait(0);
const rectAt = (left, top, width, height) =>
  ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height });
const press = (w, target, type = 'pointerdown') =>
  target.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
const key = (w, target, name) =>
  target.dispatchEvent(new w.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

function keepNotes(w, { menuItems = ['Delete note', 'Add label', 'Add drawing'] } = {}) {
  const doc = w.document;
  const make = (className, parent, attrs = {}) => {
    const element = doc.createElement('div');
    element.className = className;
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
    parent.append(element);
    return element;
  };
  // 页面滚动：脚本读 scrollX / scrollY、调 scrollTo
  const view = { x: 0, y: 0, scrolls: [] };
  Object.defineProperty(w, 'scrollX', { get: () => view.x, configurable: true });
  Object.defineProperty(w, 'scrollY', { get: () => view.y, configurable: true });
  w.scrollTo = (x, y) => { view.scrolls.push([x, y]); Object.assign(view, { x, y }); };
  const scrollBy = dy => { view.y += dy; w.dispatchEvent(new w.Event('scroll')); };
  // 动画帧由测试一帧一帧推
  let lastFrame = 0;
  const frames = new Map();
  w.requestAnimationFrame = fn => { frames.set(++lastFrame, fn); return lastFrame; };
  w.cancelAnimationFrame = id => frames.delete(id);
  const frame = () => {
    const due = [...frames.values()];
    frames.clear();
    for (const fn of due) fn(w.performance.now());
  };

  // 列表：两列，卡片宽 240、间距 16。和 Keep 一样位置写在行内 transform 里；分组从页面 y=100 开始
  const notes = make('notes-container', doc.body);
  const group = make('', make('gkA7Yd-sKfxWe', notes));
  const layout = new Map();
  const place = (element, x, y, height) => {  // Keep 排版
    layout.set(element, { x, y, height });
    element.style.transform = `translate(${x}px, ${y}px)`;
  };
  const card = (x, y, height) => {
    const element = make('IZ65Hb-n0tgWb', group, { tabindex: '0' });
    make('gkA7Yd-HiaYvf', element, { tabindex: '0' });  // 卡片里能拿焦点的一层
    Object.defineProperty(element, 'offsetWidth', { get: () => 240 });
    element.getBoundingClientRect = () => {
      const box = layout.get(element);
      return rectAt(8 + box.x, 100 + box.y - view.y, 240, box.height);
    };
    place(element, x, y, height);
    return element;
  };
  const cards = { a: card(0, 0, 100), b: card(0, 116, 80), c: card(256, 0, 150), d: card(256, 166, 60) };

  // Keep 自己的编辑框：一直在页面里，打开时加 eo9XGd。底栏有协作者、More 和 Close
  const editor = make('VIpgJd-TUo6Hb XKSfm-L9AdLc', doc.body);
  const size = { editor: 180 };
  editor.getBoundingClientRect = () => rectAt(0, 0, 240, size.editor);
  const inner = make('IZ65Hb-n0tgWb', editor, { tabindex: '-1' });
  const text = make('IZ65Hb-vIzZGf-L9AdLc-haAclf', make('IZ65Hb-TBnied', inner), { contenteditable: 'true', tabindex: '0' });
  const footer = make('IZ65Hb-nK2kYb', inner);
  const toolbar = make('IZ65Hb-INgbqf', footer, { role: 'toolbar' });
  const label = make('euCgFf', toolbar, { role: 'button', 'aria-label': 'Collaborator' });
  const more = make('xl07Ob', toolbar, { role: 'button', 'aria-label': 'More' });
  const close = make('IZ65Hb-TvD9Pc IZ65Hb-iib5kc', footer, { role: 'button' });
  close.textContent = 'Close';
  close.getClientRects = () => (editor.classList.contains('eo9XGd') ? [rectAt(0, 0, 28, 28)] : []);

  const log = { close: 0, more: 0, labels: 0, keep: [] };
  let source = null;
  // 打开：原卡片加 fbudBf、编辑框加 eo9XGd、body 加 OPEN_CLASS，都在同一轮任务里
  const open = (target, { focusScroll = 0 } = {}) => {
    source = target;
    target.classList.add('IZ65Hb-fbudBf');
    editor.classList.add('eo9XGd');
    view.y += focusScroll;  // 万一 Keep 的 focus() 把页面滚走了
    doc.body.classList.add(OPEN_CLASS);
  };
  // 编辑中点了另一张卡片：弹窗不关，直接换成那条记事
  const switchTo = target => {
    source.classList.remove('IZ65Hb-fbudBf');
    source = target;
    target.classList.add('IZ65Hb-fbudBf');
  };
  // 关闭：先 focus 编辑框里的卡片，再去掉 OPEN_CLASS；退场动画放完，再 focus 列表里原卡片中的一层，然后去掉编辑框的 eo9XGd。
  // 两次 focus 都不带 preventScroll，被 focus 的东西没露全时浏览器会先把页面滚过去、再派发 focusin
  const shut = ({ focusScroll = 0 } = {}) => {
    const card = source;
    view.y += focusScroll;
    inner.focus();
    card.classList.remove('IZ65Hb-fbudBf');
    source = null;
    doc.body.classList.remove(OPEN_CLASS);
    setTimeout(() => {
      view.y += focusScroll;
      card.querySelector('.gkA7Yd-HiaYvf').focus();
      editor.classList.remove('eo9XGd');
    }, 20);
  };
  close.addEventListener('mouseup', () => { log.close++; shut(); });
  // More：松开时弹出菜单（挂在 body 下）；菜单里的「添加标签」松开时换成标签选择框
  more.addEventListener('mouseup', () => {
    log.more++;
    const menu = make('Q0hgme-xl07Ob', doc.body, { role: 'menu' });
    menu.getBoundingClientRect = () => rectAt(0, 0, 200, 30 * menuItems.length);
    for (const name of menuItems) {
      const item = make('', menu, { role: 'menuitem' });
      item.textContent = name;
      item.addEventListener('mouseup', () => {
        if (!/label|标签/i.test(name)) return;
        log.labels++;
        menu.remove();
        make('mQXP-L9AdLc', doc.body, { role: 'dialog' });
      });
    }
  });
  // Keep 自己挂在协作者按钮上的处理（打开协作者对话框）：一次也不该收到
  for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) label.addEventListener(type, () => log.keep.push(type));
  return { doc, view, scrollBy, frame, notes, group, cards, place, editor, size, text, label, more, log, open, switchTo, shut };
}

test('list cards drop their toolbar; pinned notes are marked on the inner frame', t => {
  const { run, style } = setup(t);
  run();
  const css = style().textContent;
  assert.match(css, /\.gkA7Yd-sKfxWe \.IZ65Hb-nK2kYb \{ display: none !important; \}/);
  assert.match(css, /\.gkA7Yd-sKfxWe \.neVct-LS81yb-tJHJj \{ visibility: hidden !important; \}/);
  // 卡片外层没有边框，边框画在里层的 TBnied 上
  assert.match(css, /\.IZ65Hb-n0tgWb\.IZ65Hb-bJ69tf > \.IZ65Hb-TBnied \{ border-color: #c6a34c !important; \}/);
  // Close 还是 Keep 自己的按钮，只是字换成 × 图标
  assert.match(css, /\.IZ65Hb-TvD9Pc \{[^}]*font-size: 0 !important;[^}]*--kc-icon: url\("data:image\/svg\+xml,/);
  // 原位编辑框不能当滚动锚点，不然打开后图片撑开时整页往下滚
  assert.match(css, /\.XKSfm-L9AdLc\.kc-inline \{[^}]*overflow-anchor: none !important;/);
});

test('opening a card puts the Keep editor on it and pushes only that column down', async t => {
  const { w, run } = setup(t);
  const k = keepNotes(w);
  run();
  press(w, k.cards.a);
  k.open(k.cards.a);
  await tick();
  assert.ok(k.editor.classList.contains('kc-inline'));
  assert.ok(k.doc.body.classList.contains('kc-editing'));
  assert.deepEqual(['--kc-left', '--kc-top', '--kc-width'].map(name => k.editor.style.getPropertyValue(name)),
    ['8px', '100px', '240px']);
  // 编辑框 180 高、原卡片 100 高：同一列下面的 B 推下 80，分组底部也留出 80；另一列不动
  assert.equal(k.cards.b.style.translate, '0 80px');
  assert.equal(k.group.style.marginBottom, '80px');
  assert.equal(k.cards.c.style.translate, '');
  assert.equal(k.cards.d.style.translate, '');
  assert.deepEqual(k.view.scrolls, [], 'opening never scrolls the page');
});

test('while typing, the push follows the editor height and the room Keep leaves', async t => {
  const { w, run } = setup(t);
  const k = keepNotes(w);
  run();
  k.open(k.cards.a);
  await tick();
  // 编辑框长到 230；Keep 顺手把藏着的原卡片撑到 150，但还没重排下面的卡片：按 Keep 留的空间算，推 130
  k.size.editor = 230;
  k.place(k.cards.a, 0, 0, 150);
  k.frame();
  assert.equal(k.cards.b.style.translate, '0 130px');
  // Keep 重排后 B 挪到 166：只需再推 80
  k.place(k.cards.b, 0, 166, 80);
  k.frame();
  assert.equal(k.cards.b.style.translate, '0 80px');
  assert.equal(k.group.style.marginBottom, '80px');
});

test('clicking another card while editing moves the editor there and releases the old column', async t => {
  const { w, run } = setup(t);
  const k = keepNotes(w);
  run();
  k.open(k.cards.a);
  await tick();
  // 点别的卡片不能当成「点到外面」先关掉，否则 Keep 会忽略这次点击
  press(w, k.cards.c);
  assert.equal(k.log.close, 0);
  k.switchTo(k.cards.c);
  k.frame();
  assert.equal(k.editor.style.getPropertyValue('--kc-left'), '264px');
  assert.equal(k.cards.b.style.translate, '');
  // C 高 150、下面的 D 在 166：编辑框 180，推 30
  assert.equal(k.cards.d.style.translate, '0 30px');
});

test('closing puts everything back and keeps the page where it was, even after Keep scrolls to the card', async t => {
  const { w, run } = setup(t);
  const k = keepNotes(w);
  run();
  k.open(k.cards.a);
  await tick();
  k.scrollBy(50);  // 编辑时自己往下滚了一点
  // 编辑框里的焦点变化不管（Tab 到屏幕外的一栏，浏览器滚过去是对的）
  k.view.y += 30;
  k.text.focus();
  assert.equal(k.view.y, 80);
  k.scrollBy(-30);
  k.shut({ focusScroll: 180 });  // Keep 关闭时 focus 编辑框里的卡片，浏览器把页面滚走 180
  await tick();
  assert.equal(k.view.y, 50, 'pulled back in the same task, before the next paint');
  assert.equal(k.cards.b.style.translate, '');
  assert.equal(k.group.style.marginBottom, '');
  assert.equal(k.cards.b.style.transform, 'translate(0px, 116px)', 'card positions stay Keep’s');
  assert.ok(!k.doc.body.classList.contains('kc-editing'));
  // 退场动画期间编辑框还挂着 kc-inline（样式把它原地藏住，免得跳回屏幕中间），放完才交还给 Keep
  assert.ok(k.editor.classList.contains('kc-inline'));
  await wait(40);  // 退场动画放完时 Keep 又 focus 一次，又滚走 180
  assert.equal(k.view.y, 50);
  assert.deepEqual(k.view.scrolls, [[0, 50], [0, 50]]);
  assert.ok(!k.editor.classList.contains('kc-inline'));
  assert.equal(k.editor.style.getPropertyValue('--kc-top'), '');
  // 收起以后就不管了，之后的 focus 照常滚
  k.view.y += 100;
  k.cards.b.focus();
  assert.equal(k.view.y, 150);
});

test('a note opened from a link, with no card in the list, keeps the normal Keep dialog', async t => {
  const { w, run } = setup(t);
  const k = keepNotes(w);
  run();
  k.editor.classList.add('eo9XGd');
  k.doc.body.classList.add(OPEN_CLASS);
  await tick();
  assert.ok(!k.editor.classList.contains('kc-inline'));
  assert.ok(!k.doc.body.classList.contains('kc-editing'));
  k.view.y = 300;
  k.doc.body.classList.remove(OPEN_CLASS);
  await tick();
  assert.deepEqual(k.view.scrolls, []);
});

test('if opening scrolls the page anyway, it goes back to where the card was clicked', async t => {
  const { w, run } = setup(t);
  const k = keepNotes(w);
  run();
  k.view.y = 40;
  press(w, k.cards.b);
  k.open(k.cards.b, { focusScroll: 300 });
  await tick();
  assert.deepEqual(k.view.scrolls, [[0, 40]]);
  // 编辑框贴在 B 上：页面坐标 100 + 116
  assert.equal(k.editor.style.getPropertyValue('--kc-top'), '216px');
});

test('Escape is left to Keep inside the editor and to open menus; from elsewhere it closes', async t => {
  const { w, run } = setup(t);
  const k = keepNotes(w);
  run();
  k.open(k.cards.a);
  await tick();
  k.text.focus();
  key(w, k.text, 'Escape');
  assert.equal(k.log.close, 0, 'Keep handles Escape in its own editor');
  const menu = k.doc.createElement('div');
  menu.className = 'Q0hgme-xl07Ob';
  menu.tabIndex = 0;
  k.doc.body.append(menu);
  menu.focus();
  key(w, menu, 'Escape');
  assert.equal(k.log.close, 0, 'an open menu gets Escape first');
  menu.blur();
  key(w, k.doc.body, 'Escape');
  assert.equal(k.log.close, 1);
});

test('clicking blank page space closes through the Keep close button; the editor and menus do not', async t => {
  const { w, run } = setup(t);
  const k = keepNotes(w);
  run();
  k.open(k.cards.a);
  await tick();
  press(w, k.text);
  const floating = k.doc.createElement('div');
  floating.className = 'Q0hgme-xl07Ob';
  k.doc.body.append(floating);
  press(w, floating);
  assert.equal(k.log.close, 0);
  press(w, k.notes);
  assert.equal(k.log.close, 1);
  await tick();
  assert.ok(!k.doc.body.classList.contains('kc-editing'));
});

test('wheel scrolling over the editor reaches the page instead of the Keep scroll blocker', async t => {
  const { w, run } = setup(t);
  const k = keepNotes(w);
  run();
  let blocked = 0;
  // Keep 打开编辑框后，会把编辑框上的老式 mousewheel 事件 preventDefault 掉
  k.editor.addEventListener('mousewheel', event => { blocked++; event.preventDefault(); });
  const wheel = () => k.text.dispatchEvent(new w.Event('mousewheel', { bubbles: true, cancelable: true }));
  assert.equal(wheel(), false, 'not editing: left to Keep');
  k.open(k.cards.a);
  await tick();
  assert.equal(wheel(), true);
  assert.equal(blocked, 1);
});

for (const [language, menuItems] of [['English', ['Delete note', 'Add label', 'Add drawing']], ['中文', ['删除记事', '添加标签', '添加绘图']]]) {
  test(`label button (${language}) opens the Keep label picker through More; Keep never sees the press`, async t => {
    const { w, run } = setup(t);
    const k = keepNotes(w, { menuItems });
    run();
    k.open(k.cards.a);
    await tick();
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) press(w, k.label, type);
    assert.deepEqual(k.log.keep, [], 'the collaborator dialog never opens');
    assert.equal(k.log.more, 1);
    assert.equal(k.log.labels, 1);
    assert.ok(k.doc.querySelector('.mQXP-L9AdLc'));
    assert.ok(!k.doc.documentElement.classList.contains('kc-labels-opening'), 'More menus show normally again');
  });
}

test('the label button in the new-note bar works the same way', async t => {
  const { w, run } = setup(t);
  const k = keepNotes(w);
  run();
  const composer = k.doc.createElement('div');
  composer.className = 'h1U9Be-xhiy4';
  const bar = k.doc.createElement('div');
  bar.className = 'IZ65Hb-INgbqf';
  bar.append(k.label, k.more);  // 新建栏里也是同一组按钮
  composer.append(bar);
  k.doc.body.append(composer);
  press(w, k.label, 'click');
  assert.equal(k.log.more, 1);
  assert.equal(k.log.labels, 1);
});

test('if the label item cannot be found, the More menu is simply left open', async t => {
  const { w, run } = setup(t);
  const k = keepNotes(w, { menuItems: ['Delete note', 'Make a copy'] });
  run();
  k.open(k.cards.a);
  await tick();
  press(w, k.label, 'click');
  const opening = () => k.doc.documentElement.classList.contains('kc-labels-opening');
  assert.ok(opening(), 'More menu hidden while looking for the item');
  const end = Date.now() + 1500;
  while (opening() && Date.now() < end) { k.frame(); await wait(25); }
  assert.ok(!opening());
  assert.equal(k.log.labels, 0);
  assert.ok(k.doc.querySelector('.Q0hgme-xl07Ob'), 'More menu stays for the user');
});

test('hovering the label button relabels its tooltip in the page language', t => {
  const { w, run } = setup(t);
  const k = keepNotes(w);
  run();
  const chinese = k.label.cloneNode();
  chinese.setAttribute('aria-label', '协作者');
  k.label.after(chinese);
  for (const button of [k.label, chinese]) button.dispatchEvent(new w.MouseEvent('pointerover', { bubbles: true }));
  assert.equal(k.label.getAttribute('data-tooltip-text'), 'Labels');
  assert.equal(chinese.getAttribute('data-tooltip-text'), '标签');
  assert.equal(chinese.getAttribute('aria-label'), '标签');
});
