import { readFileSync, writeFileSync } from 'node:fs';

const [header,...lines] = readFileSync('data/next/predictions.csv','utf8').trim().split(/\r?\n/);
const keys = header.split(',');
const rows = lines.map(line => Object.fromEntries(line.split(',').map((value,i)=>[keys[i],value])))
  .filter(r => r.candidate === 'extended/seasonal_naive' && r.period >= '202601' && r.period <= '202609')
  .sort((a,b) => a.period.localeCompare(b.period));
if (rows.length !== 9 || rows.some((r,i)=>Number(r.period)!==202601+i)) throw Error('Expected January–September 2026');
const x = i => 80+i*90;
const y = v => (266-(Number(v)-6000)*.032).toFixed(2);
const points = key => rows.map((r,i)=>x(i)+','+y(r[key]));
const band = [...points('upper'),...points('lower').reverse()].join(' ');
const grid = [6000,8000,10000,12000].map(v=>
  `<path d="M70 ${y(v)}H820" stroke="#d8e2e4"/><text x="56" y="${Number(y(v))+5}" text-anchor="end">${v.toLocaleString('en-US')}</text>`).join('');
const labels = rows.map((r,i)=>{
  const missed = Number(r.actual)>Number(r.upper) || Number(r.actual)<Number(r.lower);
  return `<circle cx="${x(i)}" cy="${y(r.actual)}" r="${missed?6:4}" fill="#153746" stroke="${missed?'#c44327':'#153746'}" stroke-width="3"/><text x="${x(i)}" y="293" text-anchor="middle">${r.period.slice(-2)}</text>${r.hotMonth==='true'?`<circle cx="${x(i)}" cy="308" r="4" fill="#ba5917"/>`:''}`;
}).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 850 348" font-family="sans-serif" font-size="14" fill="#173848" role="img" aria-labelledby="title desc">
<title id="title">Hong Kong commercial electricity demand, January–September 2026</title>
<desc id="desc">Seasonal naive backtest in terajoules. April and September exceeded the upper bound; February, March, April and August were relatively warm.</desc>
<rect width="850" height="348" fill="#fafcfb"/>
<text x="28" y="30" font-size="21" font-weight="bold">Commercial electricity demand · Jan–Sep 2026</text>
<path d="M30 55h29" stroke="#153746" stroke-width="3"/><text x="66" y="60">Actual</text>
<path d="M142 55h30" stroke="#188779" stroke-width="3" stroke-dasharray="7 4"/><text x="179" y="60">Prior-year forecast</text>
<rect x="345" y="47" width="26" height="14" fill="#c5e4de"/><text x="378" y="60">80% interval</text>
<circle cx="528" cy="54" r="5" stroke="#c44327" stroke-width="3" fill="#153746"/><text x="541" y="60">Outside interval</text>
<text x="23" y="87">TJ</text>${grid}
<polygon points="${band}" fill="#c5e4de" opacity=".8"/>
<polyline points="${points('point').join(' ')}" fill="none" stroke="#188779" stroke-width="3" stroke-dasharray="7 4"/>
<polyline points="${points('actual').join(' ')}" fill="none" stroke="#153746" stroke-width="3"/>${labels}
<circle cx="29" cy="330" r="4" fill="#ba5917"/><text x="41" y="335">Relatively warm month: observed temperature above its historical same-month 80th percentile</text>
</svg>\n`;
writeFileSync('docs/backtest-2026.svg',svg);
