const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const periods = ['month', 'previousMonth', 'yearMonth', 'week', 'previousWeek', 'yearWeek'];
const defaults = [
  ['cancellation', '作废率', '%'], ['amendment', '改单率', '%'],
  ['fulfillment', '订单满足率', '%'], ['ontime', '准交率', '%'],
  ['stockAge', '60天以上货龄占比', '%'], ['shippingDays', '可发货天数', '天'],
].map(([id, name, unit]) => ({ id, name, unit }));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function save(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}
function number(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('FINITE_NUMBER_REQUIRED');
  return value;
}
function value(observation) {
  if (!observation || observation.complete !== true) return null;
  return number(observation.value);
}
function format(observation, metric) {
  const n = value(observation);
  return n == null ? '—' : `${n.toFixed(metric.unit === '天' ? 1 : 2)}${metric.unit || ''}`;
}
function delta(current, previous, metric) {
  const a = value(current), b = value(previous);
  if (a == null || b == null) return '—';
  return `${a - b > 0 ? '+' : ''}${(a - b).toFixed(2)}${metric.unit === '%' ? ' pct' : metric.unit || ''}`;
}
function status(observation) {
  return observation?.complete === true && observation.value != null && observation.statusVerified === true &&
    ['healthy', 'warning', 'severe'].includes(observation.status) ? observation.status : 'info';
}
module.exports = { periods, defaults, read, hash, save, number, value, format, delta, status };
