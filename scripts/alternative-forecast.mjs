import fs from 'node:fs';
const read = name => fs.readFileSync('data/next/' + name, 'utf8').trim();
const forecast = JSON.parse(read('future.json'));
const prior = JSON.parse(read('energy.json')).find(row => Number(row.period) === forecast.target - 100);
const [header,...lines] = read('predictions.csv').split(/\r?\n/);
const fields = header.split(',');
const residuals = lines.map(line => Object.fromEntries(line.split(',').map((value,i)=>[fields[i],value])))
  .filter(row => row.candidate === 'extended/seasonal_naive' && Number(row.period) <= forecast.assumedCutoff)
  .sort((a,b)=>Number(a.period)-Number(b.period)).slice(-60)
  .map(row=>Math.abs(Number(row.actual)-Number(row.point))).sort((a,b)=>a-b);
if (!prior || residuals.length !== 60) throw Error('Incomplete forecast inputs');
const point = Number(prior.figure);
const radius = residuals[Math.ceil(.8*(residuals.length+1))-1];
const alternative = {issued:forecast.issued,target:forecast.target,model:'seasonal_naive',unit:'TJ',
  point,lower:point-radius,upper:point+radius,normal:point,hot:point,cutoff:forecast.assumedCutoff};
fs.writeFileSync('data/next/alternative.json',JSON.stringify(alternative,null,2)+'\n');
console.log(alternative);
