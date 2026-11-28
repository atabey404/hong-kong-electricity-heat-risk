// Descriptive development-period exploration. Keep 2026 labels out of this analysis.
import fs from 'node:fs';

const root = 'data/next/';
const energy = new Map(JSON.parse(fs.readFileSync(root+'energy.json','utf8'))
  .filter(r => Number(r.period) <= 202512)
  .map(r => [String(r.period), Number(r.figure)]));
const [header, ...lines] = fs.readFileSync(root+'weather.csv','utf8').trim().split(/\r?\n/);
const keys = header.replaceAll('"','').replace(/^\uFEFF/,'').split(',');
const groups = new Map();
for (const line of lines) {
  const cells = line.replaceAll('"','').split(',');
  const row = Object.fromEntries(keys.map((key,i)=>[key,cells[i]]));
  const month = row.date.slice(0,7).replace('-','');
  if (!energy.has(month)) continue;
  if (!groups.has(month)) groups.set(month, []);
  groups.get(month).push(row);
}
const sum = a => a.reduce((s,x)=>s+x,0);
const mean = a => sum(a)/a.length;
const monthly = new Map();
for (const [period,rows] of groups) {
  const days = new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(4)),0)).getUTCDate();
  if (rows.length !== days || new Set(rows.map(r=>r.date)).size !== days) continue;
  const column = name => rows.map(r=>r[name]?.trim() ? Number(r[name]) : NaN);
  const temp=column('mean_C'), max=column('max_C'), min=column('min_C'), rh=column('rh');
  let run=0, longest=0;
  for(const t of min){ run=t>=28 ? run+1 : 0; longest=Math.max(run,longest); }
  monthly.set(period,{period, daily_TJ:energy.get(period)/days,
    mean_C:mean(temp),CDD24:mean(temp.map(t=>Math.max(0,t-24))),
    hotDayShare:max.every(Number.isFinite)?max.filter(t=>t>=33).length/days:NaN,
    hotNightShare:min.every(Number.isFinite)?min.filter(t=>t>=28).length/days:NaN,
    longestHotNights:min.every(Number.isFinite)?longest:NaN, humidity:mean(rh)});
}
function correlation(x,y) {
  const mx=mean(x), my=mean(y);
  const spread = Math.sqrt(sum(x.map(v=>(v-mx)**2))*sum(y.map(v=>(v-my)**2)));
  return spread ? sum(x.map((v,i)=>(v-mx)*(y[i]-my)))/spread : null;
}
// Same-calendar-month year-over-year differences remove fixed seasonality and
// avoid confusing growth in commercial consumption with warming over decades.
for(const field of ['mean_C','CDD24','hotDayShare','hotNightShare','longestHotNights','humidity']){
  const x=[], y=[];
  for(const [period,row] of monthly){
    const m=Number(period.slice(4)), prior=monthly.get(String(Number(period)-100));
    if (m<5 || m>10 || !prior || !Number.isFinite(prior[field]) || !Number.isFinite(row[field])) continue;
    x.push(row[field]-prior[field]);
    y.push(100*(row.daily_TJ/prior.daily_TJ-1));
  }
  console.log(field, 'pairs', x.length,'r', correlation(x,y)?.toFixed(3) ?? 'NA');
}
