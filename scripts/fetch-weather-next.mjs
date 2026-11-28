import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const out = 'data/next';
const raw = path.join(out, 'weather-raw');
fs.mkdirSync(raw, {recursive: true});
const start = '1979-01-01';
const end = '2026-10-31';
const fields = [
  ['mean_C','TEMP','Daily Mean Temperature (°C)'],
  ['max_C','MAXT','Daily Maximum Temperature (°C)'],
  ['min_C','MINT','Daily Minimum Temperature (°C)'],
  ['rh','RH','Daily Mean Relative Humidity (%)'],
];
const series = [];
const manifest = [];
for (const [field, code, label] of fields) {
  const url = 'https://data.weather.gov.hk/weatherAPI/cis/csvfile/HKO/ALL/daily_HKO_' + code + '_ALL.csv';
  const file = path.join(raw, code + '.csv');
  const refresh = !process.argv.includes('--from-cache');
  const input = refresh ? file + '.part' : file;
  if (refresh) {
    execFileSync('curl', ['--fail','--silent','--show-error','--location','--retry','2',
      '--max-time','180',url,'-o',input], {stdio:'inherit'});
  }
  const bytes = fs.readFileSync(input);
  const lines = bytes.toString('utf8').trim().split(/\r?\n/);
  if (lines[1]?.trim() !== label + ' at the Hong Kong Observatory' ||
      !lines.at(-1).includes('Complete')) throw Error('Unexpected header or trailer in ' + input);
  const values = new Map();
  for (const line of lines.slice(3)) {
    if (!/^\d{4},/.test(line)) continue;
    const [y,m,d,value,flag] = line.trim().split(',');
    const key = [y, m.padStart(2,'0'), d.padStart(2,'0')].join('-');
    if (key < start || key > end) continue;
    if (new Date(key+'T00:00:00Z').toISOString().slice(0,10) !== key || values.has(key)) {
      throw Error('Invalid/duplicate date ' + key + ' in ' + input);
    }
    const isValid = /^-?\d+(\.\d+)?$/.test(value) && flag === 'C';
    if (isValid && code === 'RH' && (Number(value)<0 || Number(value)>100)) throw Error('Invalid RH at '+key);
    values.set(key, isValid ? value : '');
  }
  if (!values.has(start) || !values.has(end)) throw Error('Incomplete date span in ' + input);
  if (refresh) fs.renameSync(input,file);
  series.push(values);
  manifest.push({field,url,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),
    sourceRowsInWindow:values.size,validDays:[...values.values()].filter(v=>v !== '').length});
}
const rows = ['date,mean_C,max_C,min_C,rh'];
let hotDays2025 = 0, hotNights2025 = 0;
for (let day=Date.parse(start+'T00:00:00Z');day<=Date.parse(end+'T00:00:00Z');day+=86400000) {
  const key = new Date(day).toISOString().slice(0,10);
  const vals = series.map(map=>map.get(key) ?? '');
  const [mean,max,min] = vals.map(value=>value === '' ? NaN : Number(value));
  if (min>mean || mean>max || min>max) throw Error('Inconsistent temperature range at ' + key);
  if (key.startsWith('2025-')) {
    if (max>=33) hotDays2025++;
    if (min>=28) hotNights2025++;
  }
  rows.push([key,...vals].join(','));
}
fs.writeFileSync(path.join(out,'weather.csv.part'),rows.join('\n')+'\n');
fs.renameSync(path.join(out,'weather.csv.part'),path.join(out,'weather.csv'));
const audit = {start,end,days:rows.length-1,hotDays2025,hotNights2025,manifest};
fs.writeFileSync(path.join(raw,'manifest.json'),JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify(audit,null,2));
