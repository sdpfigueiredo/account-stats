/** Regression coverage for the selected-week card, independent of chart mode. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cycleSvg as drawCycle, palette } from '../lib/visuals.js';
import { makeView } from '../lib/view-model.js';
import { total } from '../lib/usage.js';
import {createI18n} from '../lib/i18n.js';
const exactNumber=createI18n('pt-PT').integer;
const cycleSvg=(w,v,theme='dark')=>drawCycle(w,v,theme,'pt-PT');
import { demoSnapshot } from './fixtures.mjs';

const sample = demoSnapshot();
const baseView = makeView(sample, { range: 'all', grouping: 'week' });
const textNodes = drawing => [...drawing.source.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);
const metrics = ['read', 'write', 'input', 'output'];
const labels = ['Cache read', 'Cache write', 'Input novo', 'Output'];
function assertCounters(week, view = baseView, theme = 'dark') {
  const drawing = cycleSvg(week, view, theme), texts = textNodes(drawing);
  for (const label of labels) assert.equal(texts.filter(t => t === label).length, 1);
  for (const value of [total(week), ...metrics.map(key => week[key])]) {
    assert.ok(texts.includes(exactNumber(value) + ' tokens'), `Missing exact count: ${value}`);
  }
  assert.ok(drawing.alt.includes(`input novo ${exactNumber(week.input)}, output ${exactNumber(week.output)}.`));
  assert.ok(drawing.alt.includes('Total = cache read + cache write + input novo + output.'));
  return drawing;
}

test('selected-week card visibly lists all four counters and their combined total', () => {
  const week = { ...baseView.day, read: 9876543, write: 87654, input: 7654, output: 65432 };
  assertCounters(week);
  assert.equal(total(week), 10037283);
});

test('selected-week categories retain their existing colors in both themes', () => {
  for (const theme of ['dark', 'light']) {
    const drawing = assertCounters(baseView.day, baseView, theme);
    const colors = palette(theme);
    for (const key of metrics) assert.ok(drawing.source.includes(`fill="${colors[key]}"`));
  }
});

test('closed, current and clipped weeks expose the same complete breakdown', () => {
  for (const current of [false, true]) for (const clipped of [false, true]) {
    const drawing = assertCounters({ ...baseView.day, current, clipped });
    assert.ok(textNodes(drawing).includes(current ? 'Em curso' : 'Fechada'));
    assert.equal(drawing.height, clipped ? 271 : 253);
    assert.equal(drawing.alt.includes('Parcial no filtro.'), clipped);
  }
});

test('an empty quota shows five explicit zero counters, never missing fields', () => {
  const drawing = assertCounters({ ...baseView.day, read: 0, write: 0, input: 0, output: 0 });
  assert.equal(textNodes(drawing).filter(t => t === '0 tokens').length, 5);
});

test('cache-only quota still shows zero Input novo and Output', () => {
  const week = { ...baseView.day, read: 1000, write: 100, input: 0, output: 0 };
  const drawing = assertCounters(week);
  assert.equal(total(week), 1100);
  assert.equal(textNodes(drawing).filter(t => t === '0 tokens').length, 2);
});

test('an input/output-only quota does not need cache activity to show its total', () => {
  const week = { ...baseView.day, read: 0, write: 0, input: 123456, output: 234567 };
  assertCounters(week);
  assert.equal(total(week), 358023);
});

for (const range of ['all', '30d', '7d', 'quota']) {
  test(`${range}: selected-model input and output reconcile with the selected week`, () => {
    const view = makeView(sample, { range, grouping: 'week', model: 'claude-sonnet-5-5' });
    for (const week of view.buckets) {
      for (const key of metrics) assert.equal(week[key], week.models.reduce((sum, model) => sum + model[key], 0));
      assertCounters(week, view);
    }
  });
}

test('selected-week counters do not silently switch to all-period totals', () => {
  const view = makeView(sample, { range: 'all', grouping: 'week', week: baseView.chartDays[2].id });
  const drawing = assertCounters(view.day, view);
  assert.notEqual(view.day.input, view.totals.input);
  assert.notEqual(view.day.output, view.totals.output);
  for (const key of ['input', 'output']) {
    assert.ok(!textNodes(drawing).includes(exactNumber(view.totals[key]) + ' tokens'));
  }
});

test('large synthetic weekly counts preserve exact numbers without NaN or truncation', () => {
  const week = { ...baseView.day, read: 16123456789, write: 178123456, input: 12345678, output: 87654321 };
  for (const theme of ['dark', 'light']) {
    const drawing = assertCounters(week, baseView, theme);
    assert.ok(drawing.source.length < 131072);
    assert.ok(!/NaN|Infinity|undefined/.test(drawing.source));
  }
});
