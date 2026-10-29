import test from 'node:test';
import assert from 'node:assert/strict';

test('Restart restores opted-in audio after a hidden tab while respecting sound off', async () => {
  const saved = new Map();
  const globals = {window: {}, location: {search: ''}, devicePixelRatio: 1,
    matchMedia: () => ({matches: false, addEventListener() {}}), requestAnimationFrame: () => 1};
  const handlers = new Map(), nodes = [], ids = new Map();
  const on = (target, type, fn) => {
    if (!handlers.has(target)) handlers.set(target, new Map());
    const events = handlers.get(target);
    if (!events.has(type)) events.set(type, []);
    events.get(type).push(fn);
  };
  const fire = (target, type) => {
    for (const fn of handlers.get(target)?.get(type) || []) fn({target, currentTarget: target});
  };
  const canvas = new Proxy({}, {get: (obj, key) => obj[key] ?? (() => {})});
  function element(tag = 'DIV') {
    const node = {tagName: tag.toUpperCase(), style: {}, dataset: {}, className: '', textContent: '',
      append(...children) {for (const child of children) child.parent = this;}, setAttribute() {},
      addEventListener(type, fn) {on(this, type, fn);}, getContext: () => canvas,
      closest() {for (let p = this; p; p = p.parent) if (p.dataset?.tool) return p; return null;}};
    nodes.push(node);
    return node;
  }
  const document = {hidden: false, createElement: element, createElementNS: (ns, tag) => element(tag),
    getElementById(id) {if (!ids.has(id)) ids.set(id, element(id === 'board' ? 'canvas' : 'div')); return ids.get(id);},
    querySelectorAll(selector) {return nodes.filter(n => selector === '[data-tool]' ? n.dataset.tool : n.className === 'tool-price');},
    addEventListener(type, fn) {on(this, type, fn);}};
  const contexts = [];
  globals.window.AudioContext = class {
    constructor() {this.state = 'suspended'; this.resumes = 0; contexts.push(this);}
    resume() {this.resumes++; this.state = 'running'; return Promise.resolve();}
    suspend() {this.state = 'suspended'; return Promise.resolve();}
  };
  globals.document = document;
  globals.addEventListener = (type, fn) => on(globals.window, type, fn);
  try {
    for (const [name, value] of Object.entries(globals)) {
      saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
    }
    await import('../src/app.js');
    const click = id => fire(ids.get(id), 'click');
    const hideAndReturn = () => {
      document.hidden = true; fire(document, 'visibilitychange');
      document.hidden = false; fire(document, 'visibilitychange');
    };
    click('restart');
    assert.equal(contexts.length, 0, 'Restart never creates an audio context before opt-in');
    click('sound');
    const audio = contexts[0];
    assert.equal(audio.state, 'running');
    hideAndReturn();
    assert.equal(audio.state, 'suspended');
    click('restart');
    assert.equal(ids.get('phase').textContent, 'PLANNING');
    assert.equal(audio.state, 'running', 'Restart resumes sound that was enabled before hiding');
    click('sound');
    const resumes = audio.resumes;
    hideAndReturn(); click('restart');
    assert.equal(audio.state, 'suspended', 'Sound off remains off after Restart');
    assert.equal(audio.resumes, resumes);
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
