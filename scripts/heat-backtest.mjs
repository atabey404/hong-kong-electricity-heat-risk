import fs from 'node:fs';
import path from 'node:path';

const directory = process.argv[2] ?? 'data/next';
const issued = '2026-11-28';
const target = 202612;
const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
const quantile = (sorted, p) => sorted[Math.ceil(p * sorted.length) - 1];
const methods = ['seasonal_naive', 'smooth', 'linear', 'heat_ridge'];


function monthId(period) {
  const p = String(period);
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(p)) throw Error('Invalid period: ' + p);
  return Number(p.slice(0,4)) * 12 + Number(p.slice(4)) - 1;
}
function period(id) {
  return Math.floor(id / 12) * 100 + id % 12 + 1;
}
function monthDays(id) {
  return new Date(Date.UTC(Math.floor(id / 12), id % 12 + 1, 0)).getUTCDate();
}
function numeric(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

const source = JSON.parse(fs.readFileSync(path.join(directory, 'energy.json'), 'utf8').replace(/^\uFEFF/, ''));
const energy = new Map();
for (const r of source) {
  const id = monthId(r.period), value = numeric(r.figure);
  if (energy.has(id) || !(value > 0)) throw Error('Invalid or duplicate electricity: ' + r.period);
  energy.set(id, value);
}
const lines = fs.readFileSync(path.join(directory, 'weather.csv'), 'utf8').trim().replace(/^\uFEFF/, '').split(/\r?\n/);
const cells = line => line.replaceAll('"','').split(',');
const fields = cells(lines.shift());
for (const key of ['date','mean_C','max_C','min_C']) {
  if (!fields.includes(key)) throw Error('Missing weather column: ' + key);
}
const days = new Set();
const months = new Map();
for (const line of lines) {
  const values = cells(line), field = key => values[fields.indexOf(key)];
  const date = field('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || days.has(date)) throw Error('Invalid or duplicate weather date: ' + date);
  const id = monthId(date.slice(0,7).replace('-','')), day = Number(date.slice(8));
  if (day < 1 || day > monthDays(id)) throw Error('Invalid day: ' + date);
  days.add(date);
  if (!months.has(id)) months.set(id, {mean:[], min:[], max:[]});
  const m = months.get(id);
  for (const key of ['mean','min','max']) {
    const t = numeric(field(key + '_C'));
    if (t !== null) m[key].push(t);
  }
}
const weather = new Map();
for (const [id, m] of months) {
  const n = monthDays(id);
  if (m.mean.length !== n) continue;
  const temp = mean(m.mean);
  const features = m.min.length === n && m.max.length === n
    ? [mean(m.mean.map(t => Math.max(t-24, 0))), mean(m.min.map(t => Number(t >= 28))), mean(m.max.map(t => Number(t >= 33)))]
    : null;
  weather.set(id, {temp, linear:[temp], heat_ridge:features});
}
if (!energy.size || !weather.size) throw Error('Empty input');
const energyIds = [...energy.keys()].sort((a,b) => a-b);
const first = Math.max(energyIds[0], Math.min(...weather.keys()));
const windows = {fixed:monthId(201501), extended:first};
const candidates = methods.flatMap(method => Object.keys(windows).map(window => ({method, window, key:window+'/'+method})));
const intervalHistory = new Map(candidates.map(c => [c.key, []]));

// Positive definite after ridge regularisation. For 1-D OLS a constant feature has zero slope.
function solve(matrix, rhs) {
  const n = rhs.length;
  const a = matrix.map((row,i) => [...row,rhs[i]]);
  for (let j=0;j<n;j++) {
    const pivot = a[j][j];
    if (Math.abs(pivot) < 1e-12) return Array(n).fill(0);
    for (let k=j;k<=n;k++) a[j][k] /= pivot;
    for (let i=0;i<n;i++) if (i!==j) {
      const factor=a[i][j];
      for (let k=j;k<=n;k++) a[i][k]-=factor*a[j][k];
    }
  }
  return a.map(row=>row[n]);
}
function coefficients(groups, method) {
  const size=method==='linear'?1:3;
  const cov=Array.from({length:size},()=>Array(size).fill(0));
  const xy=Array(size).fill(0);
  let count=0;
  for (const group of groups) {
    if (!group.length) continue;
    const mx=Array.from({length:size},(_,k)=>mean(group.map(r=>r.x[k])));
    const my=mean(group.map(r=>r.y));
    for (const {x,y} of group) {
      for (let j=0;j<size;j++) {
        xy[j]+=(x[j]-mx[j])*(y-my);
        for (let k=0;k<size;k++) cov[j][k]+=(x[j]-mx[j])*(x[k]-mx[k]);
      }
      count++;
    }
  }
  const sd=xy.map((_,k)=>Math.sqrt(cov[k][k]/count)||1);
  const ridge=method==='linear'?0:0.1;
  const normal=cov.map((row,j)=>row.map((val,k)=>val/(count*sd[j]*sd[k])+(j===k?ridge:0)));
  return solve(normal,xy.map((val,j)=>val/(count*sd[j]))).map((b,j)=>b/sd[j]);
}
function analogs(id, start, method) {
  const sample=[];
  for (let k=id-12;k>=start && sample.length<30;k-=12) {
    const w=weather.get(k);
    if (w && (!method || w[method])) sample.push({id:k,...w});
  }
  return sample.sort((a,b)=>a.temp-b.temp || a.id-b.id);
}
function estimate(id,{window,method,key}) {
  const start=windows[window], cutoff=id-3, n=monthDays(id);
  const withWeather=method==='linear' || method==='heat_ridge';
  const groups=Array.from({length:12},()=>[]);
  let latest=null;
  for (const k of energyIds) {
    if (k>cutoff) break;
    if (k<start) continue;
    const x=withWeather?weather.get(k)?.[method]:[];
    if (!x) continue;
    groups[k%12].push({id:k, x, y:energy.get(k)/monthDays(k)});
    latest=k;
  }
  const same=groups[id%12];
  if (same.length<5 || (method==='seasonal_naive' && !energy.has(id-12))) return null;
  const beta=withWeather?coefficients(groups,method):[];
  const adjustment=x=>beta.reduce((sum,b,k)=>sum+b*x[k],0);
  const level=same.map(r=>r.y-adjustment(r.x)).reduce((prev,curr)=>0.75*prev+0.25*curr);
  const sample=analogs(id,start,withWeather?method:null);
  if (withWeather && sample.length<5) return null;
  const normal=sample.length?quantile(sample,0.5):null, hot=sample.length?quantile(sample,0.8):null;
  const value=w=>method==='seasonal_naive'?energy.get(id-12):n*(level+(withWeather?adjustment(w[method]):0));
  const point=withWeather?mean(sample.map(value)):value(null);
  const errors=intervalHistory.get(key).filter(x=>x.id<=cutoff).slice(-60).map(x=>x.error).sort((a,b)=>a-b);
  const radius=errors.length>=12?errors[Math.ceil(.8*(errors.length+1))-1]:null;
  return {point, normal:value(normal), hot:value(hot), lower:radius===null?null:Math.max(0,point-radius),
    upper:radius===null?null:point+radius, intervalN:errors.length, lastObservation:period(latest), lastTargetCalendarMonth:period(same.at(-1).id), cutoff:period(cutoff),
    normalWeatherMonth:normal?period(normal.id):null, hotWeatherMonth:hot?period(hot.id):null,
    normalC:normal?.temp??null, hotC:hot?.temp??null, weatherAnalogN:sample.length, sameMonthN:same.length};
}
const predictions=[];
const available=new Map(candidates.map(c=>[c.key,new Map()]));
for (const id of energyIds) {
  if (id>=monthId(target)) break;
  const observed=energy.get(id);
  const actualTemp=weather.get(id)?.temp;
  const commonSample=analogs(id,windows.fixed,null);
  const hot=commonSample.length>=5 && actualTemp!==undefined ? actualTemp>quantile(commonSample,.8).temp : null;
  for (const c of candidates) {
    const fit=estimate(id,c);
    if (!fit) continue;
    intervalHistory.get(c.key).push({id,error:Math.abs(observed-fit.point)});
    if (id<monthId(202001)) continue;
    const row={period:period(id),candidate:c.key,actual:observed,actualTemp:actualTemp??null,hotMonth:hot,...fit};
    predictions.push(row);
    available.get(c.key).set(id,row);
  }
}
function metrics(rows) {
  if (!rows.length) return {n:0,mae:null,wape:null,intervalN:0,covered:null,coverage:null,width:null};
  const mae=mean(rows.map(r=>Math.abs(r.point-r.actual)));
  const ranges=rows.filter(r=>r.lower!==null);
  const covered=ranges.filter(r=>r.actual>=r.lower && r.actual<=r.upper).length;
  return {n:rows.length,mae,wape:100*mae/mean(rows.map(r=>r.actual)),intervalN:ranges.length,covered,
    coverage:ranges.length?100*covered/ranges.length:null,width:ranges.length?mean(ranges.map(r=>r.upper-r.lower)):null};
}
function idsBetween(a,b) {
  return energyIds.filter(id=>period(id)>=a && period(id)<=b);
}
const validation=idsBetween(202001,202210);
const eligible=candidates.filter(c=>validation.filter(id=>available.get(c.key).has(id)).length>=24);
function intersection(ids) { return ids.filter(id=>eligible.every(c=>available.get(c.key).has(id))); }
const validate=intersection(validation);
if (!eligible.length || validate.length<24) throw Error('Insufficient validation overlap');
const selectScores=new Map(eligible.map(c=>[c.key,metrics(validate.map(id=>available.get(c.key).get(id))).mae]));
const ranking=[...eligible].sort((a,b)=>selectScores.get(a.key)-selectScores.get(b.key));
const selected=ranking[0], sensitive=ranking.find(c=>['linear','heat_ridge'].includes(c.method));
const bands={validation:[202001,202210],diagnostic:[202301,202512],newHoldout:[202601,202611]};
const result={issued,target,extendedStart:period(first),fixedStart:201501,unit:'TJ',selected:selected.key,
  sensitive:sensitive?.key??null,eligible:eligible.map(c=>c.key),periods:{}};
for (const [name,[a,b]] of Object.entries(bands)) {
  const ids=idsBetween(a,b), common=intersection(ids);
  const scores={};
  for (const c of eligible) {
    const map=available.get(c.key);
    const rows=common.map(id=>map.get(id));
    scores[c.key]={availableN:ids.filter(id=>map.has(id)).length,all:metrics(rows),hot:metrics(rows.filter(r=>r.hotMonth===true)),
      other:metrics(rows.filter(r=>r.hotMonth===false))};
  }
  result.periods[name]={commonMonths:common.map(period),scores};
}
const future={issued,target,unit:'TJ',assumedCutoff:period(monthId(target)-3),mainModel:selected.key,
  main:estimate(monthId(target),selected),weatherSensitivityModel:sensitive?.key??null,
  weatherSensitivity:sensitive?estimate(monthId(target),sensitive):null};
function write(name,body) { fs.writeFileSync(path.join(directory,name),body); }
write('scores.json',JSON.stringify(result,null,2)+'\n');
write('future.json',JSON.stringify(future,null,2)+'\n');
const keys=Object.keys(predictions[0]);
write('predictions.csv',[keys.join(','),...predictions.map(r=>keys.map(k=>r[k]??'').join(','))].join('\n')+'\n');
console.log('Saved scores.json, future.json, predictions.csv');

