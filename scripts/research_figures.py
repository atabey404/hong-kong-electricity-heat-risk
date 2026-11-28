"""Generate both README figures directly from the project data."""
import calendar
import csv
import json
from collections import defaultdict
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

DATA = Path("data/next")
OUTPUT = Path("docs/figures")
OUTPUT.mkdir(parents=True, exist_ok=True)
plt.style.use("default")


def save(fig, name):
    fig.savefig(OUTPUT / f"{name}.svg")
    plt.close(fig)


with (DATA / "predictions.csv").open(encoding="utf-8-sig") as file:
    rows = sorted((r for r in csv.DictReader(file)
                   if r["candidate"] == "extended/seasonal_naive"
                   and "202601" <= r["period"] <= "202609"), key=lambda r: r["period"])
months = [int(r["period"][-2:]) for r in rows]
assert months == list(range(1, 10))
fig, ax = plt.subplots(figsize=(8, 4), layout="constrained")
ax.plot(months, [float(r["actual"]) for r in rows], "o-", label="Observed")
ax.plot(months, [float(r["point"]) for r in rows], "--", label="Prior-year forecast")
ax.fill_between(months, [float(r["lower"]) for r in rows], [float(r["upper"]) for r in rows],
                color="0.85", zorder=0, label="80% prediction interval")
ax.set_xticks(months, [calendar.month_abbr[m] for m in months])
ax.set(xlabel="Month (2026)", ylabel="Commercial electricity consumption (TJ)")
ax.legend()
save(fig, "forecast-performance")

with (DATA / "energy.json").open(encoding="utf-8-sig") as file:
    energy = {int(r["period"]): float(r["figure"]) for r in json.load(file)}
daily = defaultdict(list)
with (DATA / "weather.csv").open(encoding="utf-8-sig") as file:
    for r in csv.DictReader(file):
        year, month, day = map(int, r["date"].split("-"))
        if 1979 <= year <= 2025 and 5 <= month <= 10:
            daily[year, month].append(max(float(r["mean_C"]) - 24, 0))
x, y = [], []
for year in range(1980, 2026):
    for month in range(5, 11):
        current, previous = daily[year, month], daily[year - 1, month]
        assert len(current) == len(previous) == calendar.monthrange(year, month)[1]
        x.append(np.mean(current) - np.mean(previous))
        period = 100 * year + month
        y.append(100 * (energy[period] / energy[period - 100] - 1))
fig, ax = plt.subplots(figsize=(7, 4.4), layout="constrained")
ax.scatter(x, y, s=14, alpha=0.6)
ax.set(xlabel="Year-on-year change in mean daily cooling degree days (°C·day/day)",
       ylabel="Year-on-year change in consumption (%)")
save(fig, "heat-and-demand")
print(f"{len(rows)} forecast months; {len(x)} year-on-year pairs.")
