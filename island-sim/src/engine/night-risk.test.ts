import assert from 'node:assert/strict';
import test from 'node:test';
import { isNightCheckT, nextPersonalUnsafeNightRiskAt } from './night-risk.ts';

test('anchors sleeping unsafe-area checks to each resident and yields eight for a complete night', () => {
  assert.deepEqual(
    Array.from({ length: 8 }, (_, index) => nextPersonalUnsafeNightRiskAt(48, 48 + index * 3, true, true)),
    [51, 54, 57, 60, 63, 66, 69, 72],
  );
  assert.equal(nextPersonalUnsafeNightRiskAt(49, 49, true, true), 52);
  assert.equal(nextPersonalUnsafeNightRiskAt(100, 103, true, true), 121);
});

test('does not schedule personal checks while the resident is safe, awake, or before unsafe entry', () => {
  assert.equal(nextPersonalUnsafeNightRiskAt(100, 106, false, true), null);
  assert.equal(nextPersonalUnsafeNightRiskAt(100, 106, true, false), null);
  assert.equal(nextPersonalUnsafeNightRiskAt(100, 99, true, true), null);
});

test('treats the check exactly 24T after night begins as the eighth and final check', () => {
  assert.equal(isNightCheckT(69), true);
  assert.equal(isNightCheckT(72), true);
  assert.equal(isNightCheckT(73), false);
});

test('never schedules more than eight checks in one night when the entry anchor falls before dusk', () => {
  const scheduled: number[] = [];
  let current = 45;
  while (true) {
    const due = nextPersonalUnsafeNightRiskAt(45, current, true, true);
    if (due === null || due > 72) break;
    scheduled.push(due);
    current = due;
  }
  assert.deepEqual(scheduled, [48, 51, 54, 57, 60, 63, 66, 69]);
});
