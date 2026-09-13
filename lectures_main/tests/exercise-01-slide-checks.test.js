'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const checker = require('../js/exercises/exercise-01-checker.js');

// The student checker needs only ordinary DOM fields, events and generated
// elements. Keep the harness local so these interaction checks run with Node.
class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.className = '';
    this.id = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this._text = '';
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set(this.className.split(/\s+/).filter(Boolean).concat(names))].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
      toggle: (name, force) => {
        const add = force ?? !this.classList.contains(name);
        if (add) this.classList.add(name); else this.classList.remove(name);
        return add;
      }
    };
  }
  get parentNode() { return this.parentElement; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(text) { this._text = String(text); this.children = []; }
  get title() { return this.getAttribute('title') || ''; }
  set title(value) { this.setAttribute('title', value); }
  setAttribute(name, value) {
    value = String(value);
    if (name === 'id') this.id = value;
    else if (name === 'class') this.className = value;
    else if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    else this.attributes[name] = value;
  }
  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] ?? null;
    return this.attributes[name] ?? null;
  }
  hasAttribute(name) { return this.getAttribute(name) !== null; }
  removeAttribute(name) {
    if (name.startsWith('data-')) delete this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())];
    else delete this.attributes[name];
  }
  append(...elements) { elements.forEach(element => this.appendChild(element)); }
  appendChild(element) { element.parentElement = this; this.children.push(element); return element; }
  prepend(element) { element.parentElement = this; this.children.unshift(element); }
  insertBefore(element, next) {
    element.parentElement = this;
    const index = this.children.indexOf(next);
    this.children.splice(index < 0 ? this.children.length : index, 0, element);
    return element;
  }
  after(element) {
    element.parentElement = this.parentElement;
    this.parentElement.children.splice(this.parentElement.children.indexOf(this) + 1, 0, element);
  }
  insertAdjacentElement(position, element) {
    if (position === 'afterend') this.after(element);
    else if (position === 'beforeend') this.appendChild(element);
    else throw new Error(`Unsupported insertion: ${position}`);
  }
  matches(selector) {
    if (selector.includes(',')) return selector.split(',').some(part => this.matches(part.trim()));
    const attribute = selector.match(/\[([^=\]]+)(?:="([^"]*)")?\]/);
    if (attribute && (!this.hasAttribute(attribute[1]) || (attribute[2] !== undefined && this.getAttribute(attribute[1]) !== attribute[2]))) return false;
    const simple = selector.replace(/\[[^\]]+\]/g, '');
    const tag = simple.match(/^[a-z][a-z0-9-]*/i);
    if (tag && this.tagName !== tag[0].toUpperCase()) return false;
    const id = simple.match(/#([\w-]+)/);
    if (id && this.id !== id[1]) return false;
    return [...simple.matchAll(/\.([\w-]+)/g)].every(([, name]) => this.classList.contains(name));
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => (child.matches(selector) ? [child] : []).concat(child.querySelectorAll(selector)));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    if (event.bubbles && this.parentElement) this.parentElement.dispatchEvent(event);
    return true;
  }
  click() { if (!this.disabled) this.dispatchEvent({ type: 'click', bubbles: true, preventDefault() {}, stopPropagation() {} }); }
}

function setup(groups, { mode = 'exercise', evaluate = checker.evaluate, readyState = 'complete', available = true } = {}) {
  const document = new Element('document');
  document.readyState = readyState;
  document.body = document.appendChild(new Element('body'));
  document.body.dataset.answerMode = mode;
  document.createElement = name => new Element(name);
  document.getElementById = id => document.querySelector(`#${id}`);
  const fields = new Map();
  const slides = groups.map((answers, index) => {
    const slide = document.body.appendChild(new Element('section'));
    slide.className = 'slide exercise-slide';
    const title = slide.appendChild(new Element('h2'));
    title.className = 'slide-title'; title.textContent = `Slide ${index + 1}`;
    for (const [key, value] of Object.entries(answers)) {
      const wrapper = slide.appendChild(new Element('div')); wrapper.className = 'answer-field';
      const field = wrapper.appendChild(new Element(key.startsWith('concept.') ? 'select' : 'input'));
      field.dataset.field = key; field.id = 'answer-' + key.replace(/\./g, '-'); field.value = value;
      fields.set(key, field);
    }
    return slide;
  });
  const calls = [];
  const context = {
    document, Element, HTMLElement: Element,
    Exercise01Answers: { collect: () => Object.fromEntries([...fields].map(([key, field]) => [key, field.value])) },
    Exercise01Checker: available ? { evaluate: answers => { calls.push(answers); return evaluate(answers); } } : undefined
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/exercises/exercise-01-slide-checks.js'), 'utf8'), context);
  return {
    document, slides, fields, calls,
    check: index => slides[index].querySelector('button.answer-check-slide').click(),
    edit: (key, value) => { const field = fields.get(key); field.value = value; field.dispatchEvent({ type: 'input', bubbles: true }); },
    load: () => document.dispatchEvent({ type: 'exercise01:answers-loaded' })
  };
}

function assertNeutral(field) {
  assert.equal(field.dataset.result, undefined);
  assert.equal(field.title, '');
  assert.notEqual(field.getAttribute('aria-invalid'), 'true');
  const feedback = field.parentElement.querySelector('.answer-feedback');
  if (feedback) assert.equal(feedback.textContent, '');
}

test('checking one slide gives binary feedback without hints, values or changes to other slides', () => {
  const values = { 'poe.1.wx': '0', 'poe.1.wy': '8', 'poe.1.wz': '1/0', 'poe.1.vx': '   ' };
  const statuses = ['correct', 'incorrect', 'invalid', 'unanswered'];
  const ui = setup([values, { 'poe.M.1.1': '1' }, {}], {
    evaluate: () => ({ fields: Object.fromEntries(Object.keys(values).map((key, index) => [key, {
      status: statuses[index], message: 'SECRET HINT: the expected answer is 123.45', expected: 123.45
    }])) })
  });
  assert.equal(ui.document.querySelectorAll('button.answer-check-slide').length, 2);
  assert.equal(ui.slides[0].querySelector('.answer-slide-status').getAttribute('role'), 'status');
  ui.check(0);
  for (const [key, expected] of [['poe.1.wx', 'correct'], ['poe.1.wy', 'incorrect'], ['poe.1.wz', 'incorrect']]) {
    const field = ui.fields.get(key);
    assert.equal(field.dataset.result, expected);
    assert.equal(field.title, expected === 'correct' ? 'Correct' : 'Incorrect');
    assert.equal(field.getAttribute('aria-invalid'), String(expected === 'incorrect'));
    const feedback = ui.document.getElementById(field.getAttribute('aria-describedby'));
    assert.equal(feedback.textContent, field.title);
  }
  assertNeutral(ui.fields.get('poe.1.vx'));
  assertNeutral(ui.fields.get('poe.M.1.1'));
  assert.deepEqual(Object.fromEntries([...ui.fields].filter(([key]) => key in values).map(([key, field]) => [key, field.value])), values);
  assert.doesNotMatch(ui.document.textContent, /SECRET|123\.45|expected answer/);
});

test('editing clears feedback for the edited slide and rechecking uses the current answers', () => {
  const ui = setup([{ 'fk.home.1.1': '1', 'fk.home.2.2': '2' }, { 'fk.bent.4.4': '1' }]);
  ui.check(0); ui.check(1);
  assert.equal(ui.fields.get('fk.home.2.2').dataset.result, 'incorrect');
  ui.edit('fk.home.2.2', '1');
  assertNeutral(ui.fields.get('fk.home.1.1'));
  assertNeutral(ui.fields.get('fk.home.2.2'));
  assert.equal(ui.fields.get('fk.bent.4.4').dataset.result, 'correct');
  ui.check(0);
  assert.equal(ui.fields.get('fk.home.2.2').dataset.result, 'correct');
  assert.equal(ui.calls.at(-1)['fk.home.2.2'], '1');
  ui.load();
  for (const field of ui.fields.values()) assertNeutral(field);
});

test('D-H checking reads the complete answer set and accepts equivalent frame conventions across slides', () => {
  const answers = checker.referenceAnswers();
  // The base translation compensates for this alternate first D-H origin.
  answers['dh.1.d'] = '0.22'; answers['base.3.4'] = '0.12';
  const select = expression => Object.fromEntries(Object.entries(answers).filter(([key]) => expression.test(key)));
  const ui = setup([select(/^dh\./), select(/^base\./), select(/^tool\./), select(/^fk\.home\./)]);
  ui.check(0);
  assert.equal(ui.fields.get('dh.1.d').dataset.result, 'correct');
  assert.equal(ui.calls[0]['base.3.4'], '0.12');
  assert.equal(ui.calls[0]['tool.3.4'], '0.045');
  ui.check(1); ui.check(2); ui.check(3);
  ui.edit('base.3.4', '0.11');
  for (const [key, field] of ui.fields) {
    if (/^(dh|base|tool)\./.test(key)) assertNeutral(field);
    else assert.equal(field.dataset.result, 'correct');
  }
  ui.check(0);
  assert.equal(ui.fields.get('dh.1.d').dataset.result, 'incorrect');
});

test('visual corrections retain equivalent Euler rotations and concept choices get binary feedback', () => {
  const reference = checker.referenceAnswers();
  const visual = Object.fromEntries(Object.entries(reference).filter(([key]) => /^visual\.[12]\./.test(key)));
  // Adding a full turn preserves the repaired visual orientation.
  visual['visual.1.roll'] += ' + 2*pi';
  // The supplied link 2 pitch is -pi/2; repaired RPY [pi, pi, pi]
  // represents the same identity rotation as the reference [0, 0, 0].
  visual['visual.2.roll'] = 'pi';
  visual['visual.2.pitch'] = '3*pi/2';
  visual['visual.2.yaw'] = 'pi';
  const ui = setup([visual, { 'concept.visualChangesFK': 'no', 'concept.jointChangesFK': 'no' }]);
  ui.check(0);
  for (const key of Object.keys(visual)) assert.equal(ui.fields.get(key).dataset.result, 'correct');
  ui.check(1);
  assert.equal(ui.fields.get('concept.visualChangesFK').dataset.result, 'correct');
  assert.equal(ui.fields.get('concept.jointChangesFK').dataset.result, 'incorrect');
});

test('initialization waits for DOM readiness and runs only on the exercise worksheet', () => {
  const ui = setup([{ 'fk.home.1.1': '1' }], { readyState: 'loading' });
  assert.equal(ui.document.querySelectorAll('button.answer-check-slide').length, 0);
  ui.document.dispatchEvent({ type: 'DOMContentLoaded' });
  assert.equal(ui.document.querySelectorAll('button.answer-check-slide').length, 1);
  ui.check(0);
  assert.equal(ui.fields.get('fk.home.1.1').dataset.result, 'correct');
  for (const mode of ['solution', 'other']) {
    const guarded = setup([{ 'fk.home.1.1': '1' }], { mode });
    assert.equal(guarded.document.querySelectorAll('button.answer-check-slide').length, 0);
    assert.equal(guarded.calls.length, 0);
  }
});

test('a missing checker disables checking and reports the loading problem', () => {
  const ui = setup([{ 'fk.home.1.1': '1' }], { available: false });
  const button = ui.slides[0].querySelector('button.answer-check-slide');
  assert.equal(button.disabled, true);
  assert.match(ui.slides[0].querySelector('.answer-slide-status').textContent, /load|unavailable/i);
  button.click();
  assert.equal(ui.calls.length, 0);
  assertNeutral(ui.fields.get('fk.home.1.1'));
});
