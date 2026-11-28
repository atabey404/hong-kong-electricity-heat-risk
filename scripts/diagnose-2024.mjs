// Attribute first-round forecast errors using only the original 2015-2025 panel.
// The actual-weather counterfactual is an ex-post diagnostic.
import {readFileSync} from 'node:fs';

function numericCsv(path) {
  const [header, ...lines] = readFileSync(path, 'utf8').trim().replaceAll('"', '').split(/\r?\n/);
  const keys = header.split(',');
  return lines.map(line => Object.fromEntries(line.split(',').map((cell, i) => [keys[i], Number(cell)])));
}
const panel = numericCsv('data/stage2/monthly.csv');
const tests = numericCsv('data/stage2/backtest.csv');
const mean = values => values.reduce((sum, x) => sum + x, 0) / values.length;
const results = [];
for (const test of tests.filter(row => Math.floor(row.period / 100) === 2024)) {
  const index = panel.findIndex(row => row.period === test.period);
  const target = panel[index];
  const history = panel.slice(0, index - 2); // Last available month is target minus three.
  const historyForMonth = month => history.filter(row => row.period % 100 === month);
  let xy = 0, xx = 0;
  for (let month = 1; month <= 12; month++) {
    const prior = historyForMonth(month);
    const temp = mean(prior.map(row => row.mean_C));
    const demand = mean(prior.map(row => row.commercial_TJ / row.calendar_days));
    for (const row of prior) {
      xx += (row.mean_C - temp) ** 2;
      xy += (row.mean_C - temp) * (row.commercial_TJ / row.calendar_days - demand);
    }
  }
  const same = historyForMonth(test.period % 100);
  const ref = mean(same.map(row => row.mean_C));
  const increment = (target.mean_C - ref) * (xy / xx) * target.calendar_days;
  results.push({period:test.period, target_C:target.mean_C, reference_C:ref,
    actual_TJ:test.actual, forecast_TJ:test.point, actual_weather_TJ:test.point + increment,
    baseline_TJ:test.baseline});
}
for (const key of ['forecast_TJ','actual_weather_TJ','baseline_TJ']) {
  const errors = results.map(row => row[key] - row.actual_TJ);
  console.log(key, {MAE:mean(errors.map(Math.abs)), bias:mean(errors),
    WAPE:100 * mean(errors.map(Math.abs)) / mean(results.map(row => row.actual_TJ))});
}
console.table(results.map(row => Object.fromEntries(Object.entries(row).map(([k,v])=>[k,Number(v.toFixed(2))]))));
