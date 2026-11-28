$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Force data/next | Out-Null
$query='query={"cv":{"USER_TYPE":["2"]},"sv":{"ELEC_LOCAL":["Raw_Tjou_n"]},"period":{"start":"197901","end":"202609"},"id":"915-91201","lang":"en"}'
curl.exe -fsSL --retry 2 --data-urlencode $query https://www.censtatd.gov.hk/api/post.php -o data/next/energy-response.json
if($LASTEXITCODE){throw 'Energy download failed'}
$r=@((Get-Content data/next/energy-response.json -Raw|ConvertFrom-Json).dataSet|Where-Object {$_.freq -eq 'M' -and $_.USER_TYPE -eq '2' -and $_.sv -eq 'ELEC_LOCAL' -and $_.svDesc -eq 'Terajoule'}|Sort-Object period)
if(($r.period|Sort-Object -Unique).Count -ne 573 -or $r.Count -ne 573){throw 'Unexpected coverage'}
$r | ConvertTo-Json | Set-Content data/next/energy.json -Encoding utf8
