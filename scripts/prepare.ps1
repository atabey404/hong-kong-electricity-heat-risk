$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force data/stage2 | Out-Null
$query='query={"cv":{"USER_TYPE":["2"]},"sv":{"ELEC_LOCAL":["Raw_Tjou_n"]},"period":{"start":"201501","end":"202512"},"id":"915-91201","lang":"en"}'
curl.exe -fsSL --retry 2 --data-urlencode $query https://www.censtatd.gov.hk/api/post.php -o data/stage2/electricity.json
if($LASTEXITCODE){throw 'Electricity download failed'}
$raw=(Get-Content data/stage2/electricity.json -Raw | ConvertFrom-Json).dataSet
$panel=foreach($year in 2015..2025){
  $file=if($year -eq 2025){'data/hko.csv'}else{"data/stage2/hko-$year.csv"}
  curl.exe -fsSL --retry 2 "https://data.weather.gov.hk/weatherAPI/opendata/opendata.php?dataType=CLMTEMP&rformat=csv&station=HKO&year=$year" -o $file
  if($LASTEXITCODE){throw 'Weather download failed'}
  $weather=Get-Content $file | Where-Object {$_ -match "^$year,"} | ConvertFrom-Csv -Header year,month,day,temp,quality
  foreach($month in 1..12){
    $period='{0}{1:D2}' -f $year,$month
    $e=@($raw | Where-Object {$_.period -eq $period -and $_.freq -eq 'M' -and $_.USER_TYPE -eq '2' -and $_.sv -eq 'ELEC_LOCAL' -and $_.svDesc -eq 'Terajoule'})
    $w=@($weather | Where-Object {[int]$_.month -eq $month -and $_.quality -eq 'C'})
    $n=[datetime]::DaysInMonth($year,$month)
    $dates=@($w | ForEach-Object {[datetime]::new($year,$month,[int]$_.day)} | Sort-Object -Unique)
    if($e.Count -ne 1 -or $w.Count -ne $n -or $dates.Count -ne $n){throw "Incomplete $period"}
    $avg=($w | ForEach-Object {[double]::Parse($_.temp,[cultureinfo]::InvariantCulture)} | Measure-Object -Average).Average
    [pscustomobject]@{period=$period;commercial_TJ=$e[0].figure;valid_days=$n;calendar_days=$n;mean_C=[math]::Round($avg,4)}
  }
}
$panel | Export-Csv data/stage2/monthly.csv -NoTypeInformation
