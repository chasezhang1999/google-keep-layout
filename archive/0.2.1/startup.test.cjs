const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');
const script = readFileSync(`${__dirname}/google-keep-layout.user.js`, 'utf8');

function setup(t, storage = 'working') {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://keep.google.com/u/0/',
    runScripts: 'outside-only',
  });
  const w = dom.window;
  const originals = [];
  t.after(() => {
    for (const [proto, descriptor] of originals) Object.defineProperty(proto, 'innerHTML', descriptor);
    dom.window.close();
  });
  // Regression harness: reject HTML strings just as a Trusted Types sink can.
  // This tests DOM construction, not Chrome's actual CSP enforcement or layout.
  for (const proto of [w.Element.prototype, w.ShadowRoot.prototype]) {
    originals.push([proto, Object.getOwnPropertyDescriptor(proto, 'innerHTML')]);
    Object.defineProperty(proto, 'innerHTML', {
      set() { throw new TypeError('TrustedHTML required'); },
      configurable: true,
    });
  }
  if (storage !== 'missing') {
    w.GM_getValue = () => {
      if (storage === 'broken') throw new Error('storage unavailable');
      return {};
    };
    w.GM_setValue = () => {
      if (storage === 'broken') throw new Error('storage unavailable');
    };
    w.GM_registerMenuCommand = () => {};
  }
  w.console.warn = () => {};
  return w;
}

for (const storage of ['working', 'missing', 'broken']) {
  test(`control starts with HTML sinks blocked and ${storage} GM storage`, async t => {
    const w = setup(t, storage);
    assert.doesNotThrow(() => w.eval(script));
    const ui = w.document.getElementById('keep-layout-control').shadowRoot;
    assert.equal(ui.getElementById('toggle').textContent, '布局 · 0.2.1');
    ui.getElementById('toggle').click();
    assert.equal(ui.getElementById('panel').hidden, false);
    assert.equal(ui.getElementById('toggle').getAttribute('aria-expanded'), 'true');
    await new Promise(resolve => setTimeout(resolve, 160));
    assert.match(ui.getElementById('status').textContent, /候选卡片 0/);
    const select = ui.getElementById('mode');
    select.value = 'native';
    select.dispatchEvent(new w.Event('input'));
    assert.equal(w.document.documentElement.hasAttribute('data-keep-layout'), false);
    assert.doesNotThrow(() => w.eval(script));
    assert.equal(w.document.querySelectorAll('#keep-layout-control').length, 1);
  });
}

function node(w, tag, attrs = {}, parent) {
  const el = w.document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (parent) parent.append(el);
  return el;
}
const settle = () => new Promise(resolve => setTimeout(resolve, 180));

test('nested card surfaces, per-card wrappers, headings and placeholders form one group', async t => {
  const w = setup(t);
  const main = node(w, 'main', {}, w.document.body);
  const list = node(w, 'div', { id: 'list' }, main);
  const heading = node(w, 'h2', {}, list);
  heading.textContent = 'Pinned';
  node(w, 'div', { hidden: '' }, list);
  const cards = [];
  const wrappers = [];
  for (let i = 0; i < 3; i++) {
    const wrapper = node(w, 'div', { style: `position:absolute;transform:translate(${i * 250}px,0)` }, list);
    const card = node(w, 'div', { class: 'IZ65Hb-n0tgWb' }, wrapper);
    const intermediate = node(w, 'div', {}, card);
    const surface = node(w, 'div', { class: 'IZ65Hb-TBnied' }, intermediate);
    surface.textContent = `Note ${i}`;
    cards.push(card);
    wrappers.push(wrapper);
  }
  const before = cards.map(card => card.textContent);
  w.eval(script);
  await settle();
  assert.equal(w.document.querySelectorAll('.keep-layout-group').length, 1);
  assert.ok(list.classList.contains('keep-layout-group'));
  assert.ok(heading.classList.contains('keep-layout-extra'));
  assert.ok(wrappers.every(wrapper => wrapper.classList.contains('keep-layout-card')));
  assert.deepEqual(cards.map(card => card.textContent), before);
  const ui = w.document.getElementById('keep-layout-control').shadowRoot;
  assert.match(ui.getElementById('status').textContent, /已对 3 张应用排版/);
  const select = ui.getElementById('mode');
  select.value = 'single';
  select.dispatchEvent(new w.Event('input'));
  await settle();
  assert.equal(w.document.documentElement.dataset.keepLayout, 'single');
  assert.equal(w.document.querySelectorAll('.keep-layout-card').length, 3);
  select.value = 'native';
  select.dispatchEvent(new w.Event('input'));
  await settle();
  assert.equal(w.document.querySelectorAll('.keep-layout-group,.keep-layout-card,.keep-layout-inner,.keep-layout-extra').length, 0);
  assert.equal(wrappers[1].style.transform, 'translate(250px,0)');
  assert.deepEqual(cards.map(card => card.textContent), before);
});

test('generated classes can change: discover cards through accessible controls', async t => {
  const w = setup(t);
  const main = node(w, 'main', {}, w.document.body);
  const list = node(w, 'div', {}, main);
  for (const name of ['Select note', '选择笔记']) {
    const card = node(w, 'div', { class: 'new-generated-class', style: 'position:absolute' }, list);
    node(w, 'div', { role: 'button', 'aria-label': name }, card);
    node(w, 'div', { role: 'button', 'aria-label': 'Pin note' }, card);
    node(w, 'div', { role: 'button', 'aria-label': 'Archive' }, card);
    node(w, 'div', {}, card).textContent = 'Example note';
  }
  w.eval(script);
  await settle();
  assert.ok(list.classList.contains('keep-layout-group'));
  assert.equal(list.querySelectorAll('.keep-layout-card').length, 2);
});

test('do not restyle editor dialogs, active editors or mixed application containers', async t => {
  const w = setup(t);
  for (const type of ['dialog', 'editor', 'mixed']) {
    const container = node(w, 'div', type === 'dialog' ? { role: 'dialog' } : {}, w.document.body);
    const card = node(w, 'div', { class: 'IZ65Hb-n0tgWb' }, container);
    const body = node(w, 'div', { class: 'IZ65Hb-TBnied' }, card);
    if (type === 'editor') body.setAttribute('contenteditable', 'true');
    if (type === 'mixed') node(w, 'input', { placeholder: 'Search' }, container);
  }
  w.eval(script);
  await settle();
  assert.equal(w.document.querySelectorAll('.keep-layout-group').length, 0);
});

test('new cards after navigation are detected and edited cards leave the layout', async t => {
  const w = setup(t);
  w.eval(script);
  await settle();
  const main = node(w, 'main', {}, w.document.body);
  const list = node(w, 'div', {}, main);
  const card = node(w, 'div', { class: 'IZ65Hb-n0tgWb' }, list);
  node(w, 'div', { class: 'IZ65Hb-TBnied' }, card);
  await settle();
  assert.ok(card.classList.contains('keep-layout-card'));
  card.classList.add('IZ65Hb-QQhtn');
  await settle();
  assert.equal(card.classList.contains('keep-layout-card'), false);
  assert.equal(list.classList.contains('keep-layout-group'), false);
});

for (const role of ['list', 'main']) {
  test(`three candidates in a ${role} with extra controls still get laid out`, async t => {
    const w = setup(t);
    const list = node(w, 'div', { role }, w.document.body);
    const heading = node(w, 'div', {}, list);
    heading.textContent = 'Other notes';
    const helper = node(w, 'div', {}, list);
    const button = node(w, 'button', { type: 'button' }, helper);
    button.textContent = 'List helper';
    let clicks = 0;
    button.addEventListener('click', () => clicks++);
    const cards = [];
    for (let i = 0; i < 3; i++) {
      const card = node(w, 'div', { class: 'IZ65Hb-n0tgWb', style: 'position:absolute' }, list);
      node(w, 'div', { class: 'IZ65Hb-TBnied' }, card).textContent = `Note ${i}`;
      cards.push(card);
    }
    const order = [...list.children];
    w.eval(script);
    await settle();
    assert.equal(list.querySelectorAll('.keep-layout-card').length, 3);
    assert.ok(list.classList.contains('keep-layout-group'));
    assert.ok(helper.classList.contains('keep-layout-extra'));
    assert.ok(heading.classList.contains('keep-layout-extra'));
    assert.deepEqual([...list.children], order);
    button.click();
    assert.equal(clicks, 1);
    const ui = w.document.getElementById('keep-layout-control').shadowRoot;
    assert.match(ui.getElementById('status').textContent, /识别 3 张，已对 3 张应用排版/);
    const select = ui.getElementById('mode');
    select.value = 'native';
    select.dispatchEvent(new w.Event('input'));
    await settle();
    assert.equal(list.querySelectorAll('[class*="keep-layout-"]').length, 0);
    assert.deepEqual([...list.children], order);
    assert.ok(cards.every(card => card.style.position === 'absolute'));
  });
}

test('wrapper helpers do not prevent finding the common list; sections remain separate', async t => {
  const w = setup(t);
  const main = node(w, 'main', {}, w.document.body);
  for (let group = 0; group < 2; group++) {
    const list = node(w, 'div', {}, main);
    for (let i = 0; i < 2; i++) {
      const wrapper = node(w, 'div', {}, list);
      node(w, 'span', {}, wrapper).textContent = 'Layout helper';
      const card = node(w, 'div', { class: 'IZ65Hb-n0tgWb' }, wrapper);
      node(w, 'div', { class: 'IZ65Hb-TBnied' }, card);
    }
  }
  w.eval(script);
  await settle();
  assert.equal(main.querySelectorAll('.keep-layout-group').length, 2);
  assert.equal(main.querySelectorAll('.keep-layout-card').length, 4);
  assert.equal(main.classList.contains('keep-layout-group'), false);
});
