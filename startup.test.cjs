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
