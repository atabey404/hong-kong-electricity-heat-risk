import fs from 'node:fs';

function readPanel(path) {
  const [header, ...lines] = fs.readFileSync(path, 'utf8').trim().replaceAll('"', '').split(/\r?\n/);
  const keys = header.split(',');
  return lines.map(line => Object.fromEntries(line.split(',').map((x,i) => [keys[i],Number(x)])));
}
const panel = readPanel('data/stage2/monthly.csv');
const tests = readPanel('data/stage2/backtest.csv');
const mean = xs => xs.reduce((s,x)=>s+x,0)/xs.length;
const month = r => r.period % 100;
for (const row of panel) {
  const year = Math.floor(row.period/100);
  const file = year === 2025 ? 'data/hko.csv' : `data/stage2/hko-${year}.csv`;
  const days = fs.readFileSync(file,'utf8').split(/\r?\n/).filter(l=>l.startsWith(`${year},`))
    .map(l=>l.split(',')).filter(d=>Number(d[1])===month(row));
  if (days.length!==row.calendar_days || days.some(d=>d[4]!=='C')) throw Error(file);
  row.cdd = days.reduce((sum,d)=>sum+Math.max(0,Number(d[3])-24),0)/days.length;
  row.daily = row.commercial_TJ/row.calendar_days;
}
function anomaly(r,key) {
  return r[key]-mean(panel.filter(s=>month(s)===month(r)).map(s=>s[key]));
}
function corr(key) {
  const x=panel.map(r=>anomaly(r,key)), y=panel.map(r=>anomaly(r,'daily'));
  return mean(x.map((v,i)=>v*y[i]))/Math.sqrt(mean(x.map(v=>v*v))*mean(y.map(v=>v*v)));
}
const groups={hot:[],other:[]};
for(const t of tests) {
  const i=panel.findIndex(r=>r.period===t.period), r=panel[i];
  const past=panel.slice(0,i-2).filter(s=>month(s)===month(r));
  const temps=past.map(s=>s.mean_C).sort((a,b)=>a-b);
  const cutoff=temps[Math.ceil(.8*temps.length)-1];
  const smooth=past.map(s=>s.daily).reduce((v,x)=>.75*v+.25*x);
  groups[r.mean_C>cutoff?'hot':'other'].push({...t,plain:smooth*r.calendar_days});
}
const score=(g,key)=>100*g.reduce((s,r)=>s+Math.abs(r[key]-r.actual),0)/g.reduce((s,r)=>s+r.actual,0);
console.log('Within-month descriptive correlations',corr('mean_C'),corr('cdd'));
for(const [label,g] of Object.entries({...groups,all:[...groups.hot,...groups.other]}))
  console.log(label,g.length,...['point','plain','baseline'].map(k=>score(g,k).toFixed(3)));
