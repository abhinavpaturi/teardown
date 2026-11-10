// Check the model by hand before drawing anything: the numbers a reader could verify on paper.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {P, pose} from './model.js';

test('the piston travels exactly twice the crank radius', () => {
  assert.ok(Math.abs(pose(0).y - pose(Math.PI).y - 2 * P.r) < 1e-12);
});
test('the rod runs from the crank pin to the piston, on the bore axis', () => {
  for (let th = 0; th < 6.3; th += 0.1) {
    const m = pose(th);
    assert.ok(Math.abs(m.pinX - P.l * Math.sin(m.rod)) < 1e-12);
    assert.ok(Math.abs(m.pinY + P.l * Math.cos(m.rod) - m.y) < 1e-12);
  }
});
test('the rod keeps its length at every angle', () => {
  for (let th = 0; th < 6.3; th += 0.1) {
    const m = pose(th);
    assert.ok(Math.abs(Math.hypot(m.pinX, m.y - m.pinY) - P.l) < 1e-12);
  }
});
test('sources.json says where every dimension came from, and matches the model', () => {
  const {parameters} = JSON.parse(fs.readFileSync(new URL('./sources.json', import.meta.url), 'utf8'));
  for (const id of ['r', 'l', 'bore']) {
    const rec = parameters.find((x) => x.id === id);
    assert.ok(rec, `${id} has no record`);
    assert.equal(rec.value, P[id], `${id} disagrees with the model`);
    assert.ok(['published', 'measured', 'estimated', 'calibrated'].includes(rec.basis), `${id}: ${rec.basis}`);
    if (rec.basis === 'published') assert.ok(rec.source?.url || rec.source?.title, `${id} claims to be published but names no source`);
  }
});
