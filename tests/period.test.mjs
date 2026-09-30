import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.mjs';
import { validatePeriod } from '../server/period.mjs';

const config = loadConfig();

test('流动工位包含首尾日期，超过上限会被拒绝', () => {
  assert.doesNotThrow(() =>
    validatePeriod(config, 'flexible', '2026-10-01', '2026-10-07', null, '2026-10-01'),
  );
  assert.throws(
    () => validatePeriod(config, 'flexible', '2026-10-01', '2026-10-08', null, '2026-10-01'),
    /最多使用/,
  );
});

test('轮流工位不可跨过所选月份月底', () => {
  assert.doesNotThrow(() =>
    validatePeriod(config, 'rotating', '2026-09-27', '2026-09-30', null, '2026-09-27'),
  );
  assert.throws(
    () => validatePeriod(config, 'rotating', '2026-09-27', '2026-10-01', null, '2026-09-27'),
    /月底/,
  );
});

test('固定工位以配置的学期边界为准', () => {
  assert.doesNotThrow(() =>
    validatePeriod(config, 'fixed', '2026-10-01', '2027-01-31', '2026-autumn', '2026-10-01'),
  );
  assert.throws(
    () => validatePeriod(config, 'fixed', '2026-10-01', '2027-02-01', '2026-autumn', '2026-10-01'),
    /学期/,
  );
});
