import fs from 'node:fs';

const lines = fs.readFileSync('data/stage2/monthly.csv', 'utf8').trim().split(/\r?\n/);
const rows = lines.slice(1).map(line => {
  const [period, y, valid, days, temp] = line.replaceAll('"', '').split(',').map(Number);
  return {period, y, days, temp, month: period % 100, valid};
});
if (rows.length !== 132 || rows.some((r,i) => r.period !== (2015+Math.floor(i/12))*100+i%12+1 ||
    r.valid !== r.days || !(r.y>0) || !Number.isFinite(r.temp))) throw Error('Invalid monthly panel');

const mean = a => a.reduce((x,y)=>x+y,0)/a.length;
const alphas = [0.25,0.5,0.75,1];
function predict(i, alpha, weather, lag) {
  const target = rows[i];
  const history = rows.slice(0,i-lag+1);
  const groups = Array.from({length:12},(_,m)=>history.filter(r=>r.month===m+1));
  const same = groups[target.month-1];
  const normal = mean(same.map(r=>r.temp));
  const hot = same.map(r=>r.temp).sort((a,b)=>a-b)[Math.ceil(.8*same.length)-1];
  let xy=0, xx=0;
  for (const group of groups) {
    const t=mean(group.map(r=>r.temp)), demand=mean(group.map(r=>r.y/r.days));
    for (const r of group) { xy+=(r.temp-t)*(r.y/r.days-demand); xx+=(r.temp-t)**2; }
  }
  const beta = weather ? xy/xx : 0;
  const adjusted = same.map(r=>r.y/r.days-beta*(r.temp-normal));
  const level = adjusted.reduce((a,x)=>alpha*x+(1-alpha)*a);
  return {point:level*target.days, hot:(level+beta*(hot-normal))*target.days};
}
function score(records) {
  const errors=records.map(r=>Math.abs(r.actual-r.point));
  return {MAE_TJ:mean(errors),WAPE_pct:100*mean(errors)/mean(records.map(r=>r.actual))};
}
function run(lag) {
  function evaluate(start,end,alpha,weather) {
    return rows.slice(start,end).map((r,k)=>({period:r.period,actual:r.y,...predict(start+k,alpha,weather,lag)}));
  }
  const candidates=alphas.flatMap(alpha=>[false,true].map(weather=>({alpha,weather,...score(evaluate(60,96,alpha,weather))})));
  const best=candidates.sort((a,b)=>a.MAE_TJ-b.MAE_TJ)[0];
  const series=evaluate(60,132,best.alpha,best.weather);
  const test=series.slice(36);
  for(let k=0;k<test.length;k++) {
    const available=series.slice(0,36+k-lag+1);
    const residuals=available.map(r=>Math.abs(r.actual-r.point)).sort((a,b)=>a-b);
    const radius=residuals[Math.ceil(.8*(residuals.length+1))-1];
    Object.assign(test[k],{lower:test[k].point-radius,upper:test[k].point+radius,baseline:rows[96+k-12].y});
  }
  const baseline=test.map(r=>({...r,point:r.baseline}));
  const weatherBest=candidates.find(c=>c.weather);
  const weatherTest=evaluate(96,132,weatherBest.alpha,true);
  if(lag===3) {
    const output=test.map((r,k)=>({...r,weather_normal:weatherTest[k].point,weather_hot:weatherTest[k].hot}));
    fs.writeFileSync('data/stage2/backtest.csv',[Object.keys(output[0]).join(','),...output.map(r=>Object.values(r).join(','))].join('\n'));
  }
  return {lag,best,test:score(test),baseline:score(baseline),weather:score(weatherTest),covered:test.filter(r=>r.actual>=r.lower && r.actual<=r.upper).length,width:mean(test.map(r=>r.upper-r.lower)),annual:[0,12,24].map(k=>[score(test.slice(k,k+12)),score(baseline.slice(k,k+12))])};
}
console.log(JSON.stringify([run(3),run(4)],null,2));
