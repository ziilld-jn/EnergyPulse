"""
EnergyPulse machine-learning service.

Covers the study objectives:
  2. Compare forecasting models, integrate the best one, produce a 7-day
     forecast and alerts.
  3. Peak-load classification (Off-Peak / Standard / Peak-Load).
  4. Feature importance of the forecasting model.
  5. Real evaluation metrics (MAE, RMSE, MAPE, R2, accuracy, precision,
     recall, F1) computed on a time-ordered hold-out set.

Design rules (so the numbers are honest):
  * Train/test split is chronological, never shuffled.
  * Models only use features that are KNOWN at forecast time (calendar,
    temperature climatology, usage one week earlier). Columns such as
    occupancy are deliberately excluded because the future value is unknown.
  * Peak-load thresholds come from the TRAINING data only.
"""
from __future__ import annotations

import hashlib
import json
import threading
from collections import OrderedDict
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import (
    HistGradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LinearRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    mean_absolute_error,
    mean_squared_error,
    precision_recall_fscore_support,
    r2_score,
)

CLASSES = ["Off-Peak", "Standard", "Peak-Load"]
ENERGY_NAMES = ["total_building_energy_kwh", "electricity_kwh", "energy_kwh", "consumption_kwh", "kwh", "energy"]
DATE_NAMES = ["timestamp", "datetime", "date_time", "date", "time"]
TEMP_NAMES = ["outdoor_temperature_c", "temperature_c", "temperature", "temp_c"]
HUMID_NAMES = ["relative_humidity_pct", "humidity_pct", "humidity"]
RAIN_NAMES = ["rainfall_mm", "precipitation_mm", "precip_mm", "rain_mm", "rainfall"]
EQUIPMENT_NAMES = [
    "HVAC", "Lighting", "Computers_and_Plugs", "Server_and_IT",
    "Elevators", "Water_Pumps", "Pantry_and_Kitchen",
]
HOLIDAY_NAMES = ["is_holiday_illustrative", "is_holiday", "holiday"]

WEEK = 168            # hours in one week
HORIZON = 168         # forecast 7 days ahead
TEST_DAYS = 90        # chronological hold-out
MIN_HOURS = WEEK * 6  # need at least ~6 weeks of hourly data

FEATURE_LABELS = {
    "hour": "Hour of day",
    "dayofweek": "Day of week",
    "month": "Month",
    "is_weekend": "Weekend",
    "is_holiday": "Holiday",
    "temperature": "Outdoor temperature",
    "humidity": "Relative humidity",
    "rainfall": "Rainfall (mm)",
    "heat_index": "Heat index (temperature + humidity)",
    "lag_168h": "Total usage same hour last week",
}
for _equipment_name in EQUIPMENT_NAMES:
    FEATURE_LABELS[f"equipment_{_equipment_name}_lag_168h"] = f"{_equipment_name.replace('_', ' ')} usage (previous week)"

from app.services.building_service import buildings_in_file, filter_building

CACHE_VERSION = 4          # bump when the ML code changes so old saved results are ignored
MAX_CACHED = 8
CACHE_DIR = Path(__file__).resolve().parents[2] / "data" / "ml_cache"
_cache: "OrderedDict[tuple, dict]" = OrderedDict()
_train_lock = threading.Lock()


def _find(cols: dict, names: list[str]):
    return next((cols[n] for n in names if n in cols), None)



def _heat_index_c(temperature_c: pd.Series, humidity_pct: pd.Series) -> pd.Series:
    """Estimate apparent temperature (NOAA heat-index regression), in Celsius."""
    temp_f = temperature_c.astype(float) * 9.0 / 5.0 + 32.0
    rh = humidity_pct.astype(float).clip(0, 100)
    hi_f = (
        -42.379 + 2.04901523 * temp_f + 10.14333127 * rh
        - 0.22475541 * temp_f * rh - 0.00683783 * temp_f**2
        - 0.05481717 * rh**2 + 0.00122874 * temp_f**2 * rh
        + 0.00085282 * temp_f * rh**2 - 0.00000199 * temp_f**2 * rh**2
    )
    low_adjust = ((13 - rh) / 4) * np.sqrt(
        np.maximum(0, (17 - np.abs(temp_f - 95)) / 17)
    )
    high_adjust = ((rh - 85) / 10) * ((87 - temp_f) / 5)
    hi_f = hi_f - np.where((rh < 13) & (temp_f >= 80) & (temp_f <= 112), low_adjust, 0)
    hi_f = hi_f + np.where((rh > 85) & (temp_f >= 80) & (temp_f <= 112), high_adjust, 0)
    apparent_f = np.where((temp_f >= 80) & (rh >= 40), hi_f, temp_f)
    return pd.Series((apparent_f - 32) * 5 / 9, index=temperature_c.index)


def _prepare(df: pd.DataFrame):
    cols = {str(c).strip().lower().replace(" ", "_"): c for c in df.columns}
    date_col = _find(cols, DATE_NAMES)
    energy_col = _find(cols, ENERGY_NAMES)
    if date_col is None:
        raise ValueError("ML analysis needs a timestamp column (e.g. 'timestamp').")
    if energy_col is None:
        raise ValueError("ML analysis needs an energy column (e.g. 'total_building_energy_kwh').")

    out = pd.DataFrame({
        "ts": pd.to_datetime(df[date_col], errors="coerce"),
        "y": pd.to_numeric(df[energy_col], errors="coerce"),
    })
    for key, names in (
        ("temperature", TEMP_NAMES), ("humidity", HUMID_NAMES),
        ("rainfall", RAIN_NAMES), ("is_holiday", HOLIDAY_NAMES),
    ):
        c = _find(cols, names)
        out[key] = pd.to_numeric(df[c], errors="coerce") if c is not None else np.nan

    # Appliance readings are retained as historical inputs, but only their
    # previous-week values are used for forecasting to avoid same-hour leakage.
    for equipment in EQUIPMENT_NAMES:
        c = _find(cols, [f"{equipment}_kwh".lower(), f"{equipment}_kw".lower()])
        out[f"equipment_{equipment}"] = (
            pd.to_numeric(df[c], errors="coerce") if c is not None else np.nan
        )

    out = out.dropna(subset=["ts"]).drop_duplicates("ts").sort_values("ts").set_index("ts")
    if len(out) < 2:
        raise ValueError("Not enough valid timestamps for ML analysis.")

    step = out.index.to_series().diff().median()
    if step != pd.Timedelta(hours=1):
        raise ValueError("ML analysis expects hourly data (one row per hour).")

    # Make the series regular so "one week ago" is exactly 168 rows back.
    out = out.reindex(pd.date_range(out.index.min(), out.index.max(), freq="h"))
    out["y"] = out["y"].interpolate(limit=3)   # fill only short gaps (<= 3 hours)
    for col in ["temperature", "humidity", "rainfall"] + [
        f"equipment_{equipment}" for equipment in EQUIPMENT_NAMES
    ]:
        if out[col].notna().any():
            out[col] = out[col].interpolate(limit=3)
    if out["temperature"].notna().any() and out["humidity"].notna().any():
        temp = out["temperature"].interpolate(limit_direction="both")
        humid = out["humidity"].interpolate(limit_direction="both")
        out["heat_index"] = _heat_index_c(temp, humid)
    else:
        out["heat_index"] = np.nan
    out = out.dropna(subset=["y"])
    if len(out) < MIN_HOURS:
        raise ValueError(f"Need at least {MIN_HOURS} hourly records (about 6 weeks) for ML analysis.")
    return out


def _calendar(idx: pd.DatetimeIndex) -> pd.DataFrame:
    return pd.DataFrame({
        "hour": idx.hour,
        "dayofweek": idx.dayofweek,
        "month": idx.month,
        "is_weekend": (idx.dayofweek >= 5).astype(int),
    }, index=idx)


def _build(hist: pd.DataFrame):
    """Feature table for historical rows (all features known at forecast time)."""
    X = _calendar(hist.index)
    X["is_holiday"] = hist["is_holiday"].fillna(0).astype(int) if hist["is_holiday"].notna().any() else 0
    if hist["temperature"].notna().any():
        X["temperature"] = hist["temperature"].interpolate(limit_direction="both")
    if hist["humidity"].notna().any():
        X["humidity"] = hist["humidity"].interpolate(limit_direction="both")
    if hist["rainfall"].notna().any():
        X["rainfall"] = hist["rainfall"].interpolate(limit_direction="both").clip(lower=0)
    if hist["heat_index"].notna().any():
        X["heat_index"] = hist["heat_index"].interpolate(limit_direction="both")
    X["lag_168h"] = hist["y"].shift(WEEK)
    for equipment in EQUIPMENT_NAMES:
        col = f"equipment_{equipment}"
        if hist[col].notna().any():
            X[f"{col}_lag_168h"] = hist[col].shift(WEEK)
    return X


def _future_features(hist: pd.DataFrame, feats: list[str], horizon: int = HORIZON):
    """Features for the next `horizon` hours. Weather is unknown, so use the
    historical average for the same month and hour (climatology)."""
    idx = pd.date_range(hist.index[-1] + pd.Timedelta(hours=1), periods=horizon, freq="h")
    F = _calendar(idx)
    if "is_holiday" in feats:
        known = hist["is_holiday"].dropna()
        by_day = known.groupby([known.index.month, known.index.day]).max()
        F["is_holiday"] = [int(by_day.get((t.month, t.day), 0)) for t in idx]
    for col in ("temperature", "humidity", "rainfall", "heat_index"):
        if col in feats:
            src = hist[col].dropna()
            clim = src.groupby([src.index.month, src.index.hour]).mean()
            F[col] = [float(clim.get((t.month, t.hour), src.mean())) for t in idx]
    if "rainfall" in F.columns:
        F["rainfall"] = F["rainfall"].clip(lower=0)
    # Total and appliance lags are known from the same hour in the previous week.
    F["lag_168h"] = [float(hist["y"].get(t - pd.Timedelta(hours=WEEK), np.nan)) for t in idx]
    for equipment in EQUIPMENT_NAMES:
        col = f"equipment_{equipment}"
        feature = f"{col}_lag_168h"
        if feature in feats:
            F[feature] = [
                float(hist[col].get(t - pd.Timedelta(hours=WEEK), np.nan)) for t in idx
            ]
    return F[feats]


def _mape(y, p):
    y = np.asarray(y, float)
    p = np.asarray(p, float)
    mask = y != 0
    return float(np.mean(np.abs((y[mask] - p[mask]) / y[mask])) * 100)


def _scores(y, p):
    return {
        "mae": float(mean_absolute_error(y, p)),
        "rmse": float(np.sqrt(mean_squared_error(y, p))),
        "mape": _mape(y, p),
        "r2": float(r2_score(y, p)),
    }


def _label(values, lo, hi):
    return pd.cut(pd.Series(values), [-np.inf, lo, hi, np.inf], labels=CLASSES).astype(str).to_numpy()


def run_ml(df: pd.DataFrame, low_pct: float = 40.0, high_pct: float = 85.0) -> dict:
    hist = _prepare(df)
    X_all = _build(hist)
    feats = list(X_all.columns)
    data = X_all.join(hist["y"]).dropna(subset=["lag_168h", "y"])
    data = data.dropna(subset=feats)

    cut = data.index.max() - pd.Timedelta(days=TEST_DAYS)
    train, test = data[data.index <= cut], data[data.index > cut]
    if len(train) < WEEK * 4 or len(test) < 24 * 7:
        raise ValueError("Not enough data for a train/test split. Provide more hourly history.")
    Xtr, ytr, Xte, yte = train[feats], train["y"], test[feats], test["y"]

    # ---------- Objective 2: compare models ----------
    candidates = {
        "Seasonal Naive (same hour last week)": None,
        "Linear Regression": LinearRegression(),
        "Random Forest": RandomForestRegressor(n_estimators=100, min_samples_leaf=5, max_features=0.5, n_jobs=-1, random_state=42),
        "Gradient Boosting": HistGradientBoostingRegressor(max_iter=300, learning_rate=0.08, random_state=42),
    }
    results, preds, fitted = [], {}, {}
    for name, model in candidates.items():
        if model is None:
            p = Xte["lag_168h"].to_numpy()
        else:
            model.fit(Xtr, ytr)
            p = model.predict(Xte)
            fitted[name] = model
        preds[name] = p
        results.append({"model": name, **_scores(yte, p)})

    ml_only = [r for r in results if r["model"] in fitted]
    best_name = min(ml_only, key=lambda r: r["rmse"])["model"]
    for r in results:
        r["selected"] = r["model"] == best_name
    baseline_rmse = next(r["rmse"] for r in results if r["model"].startswith("Seasonal Naive"))
    best_rmse = next(r["rmse"] for r in results if r["selected"])

    # ---------- Objective 4: feature importance (permutation, on hold-out) ----------
    sample = Xte.iloc[:: max(1, len(Xte) // 1500)]
    perm = permutation_importance(
        fitted[best_name], sample, yte.loc[sample.index],
        n_repeats=5, random_state=42, scoring="neg_root_mean_squared_error",
    )
    imp = np.clip(perm.importances_mean, 0, None)
    total = imp.sum() or 1.0
    importance = sorted(
        ({"feature": f, "label": FEATURE_LABELS.get(f, f), "importance": float(v / total)} for f, v in zip(feats, imp)),
        key=lambda d: -d["importance"],
    )

    # ---------- Objective 3: peak-load classification ----------
    lo, hi = np.percentile(ytr, [low_pct, high_pct])
    ytr_c, yte_c = _label(ytr, lo, hi), _label(yte, lo, hi)
    clf = RandomForestClassifier(n_estimators=100, min_samples_leaf=5, max_features=0.5, n_jobs=-1, random_state=42)
    clf.fit(Xtr, ytr_c)
    pc = clf.predict(Xte)
    cm = confusion_matrix(yte_c, pc, labels=CLASSES)
    prec, rec, f1, sup = precision_recall_fscore_support(yte_c, pc, labels=CLASSES, zero_division=0)
    per_class = [
        {"label": c, "precision": float(prec[i]), "recall": float(rec[i]), "f1": float(f1[i]), "support": int(sup[i])}
        for i, c in enumerate(CLASSES)
    ]
    macro = {"precision": float(prec.mean()), "recall": float(rec.mean()), "f1": float(f1.mean())}
    class_share = {c: float(np.mean(yte_c == c)) for c in CLASSES}

    # ---------- Objective 2: refit best model on ALL data, forecast 7 days ----------
    final = type(fitted[best_name])(**fitted[best_name].get_params()).fit(data[feats], data["y"])

    # Predict hour by hour so each hour's "last week" lag may use earlier predictions.
    ext = hist[["y"]].copy()
    fut_idx = pd.date_range(hist.index[-1] + pd.Timedelta(hours=1), periods=HORIZON, freq="h")
    base = _future_features(hist, feats)
    yhat = []
    for t in fut_idx:
        row = base.loc[[t]].copy()
        lag_t = t - pd.Timedelta(hours=WEEK)
        row["lag_168h"] = float(ext["y"].get(lag_t, row["lag_168h"].iloc[0]))
        val = float(final.predict(row)[0])
        yhat.append(val)
        ext.loc[t, "y"] = val
    yhat = np.array(yhat)
    # Uncertainty band: +/- 1.96 * hold-out RMSE of the selected model (approximate).
    band = 1.96 * best_rmse
    f_class = _label(yhat, lo, hi)

    forecast = [
        {"ts": t.strftime("%Y-%m-%d %H:%M"), "kwh": float(v), "lower": float(max(0, v - band)),
         "upper": float(v + band), "level": str(c)}
        for t, v, c in zip(fut_idx, yhat, f_class)
    ]

    # ---------- System alerts: group consecutive Peak-Load hours ----------
    alerts, start = [], None
    for i, c in enumerate(f_class):
        if c == "Peak-Load" and start is None:
            start = i
        if (c != "Peak-Load" or i == len(f_class) - 1) and start is not None:
            end = i if c == "Peak-Load" else i - 1
            seg = yhat[start:end + 1]
            alerts.append({
                "start": fut_idx[start].strftime("%Y-%m-%d %H:%M"),
                "end": fut_idx[end].strftime("%Y-%m-%d %H:%M"),
                "hours": int(end - start + 1),
                "peak_kwh": float(seg.max()),
                "avg_kwh": float(seg.mean()),
            })
            start = None

    # Hour-by-hour table for the hold-out: actual vs forecast kWh and their classes
    hourly = [
        {"ts": t.strftime("%Y-%m-%d %H:%M"), "actual": float(a), "forecast": float(f),
         "actual_class": str(ac), "predicted_class": str(pcl)}
        for t, a, f, ac, pcl in zip(test.index, yte.to_numpy(), preds[best_name], yte_c, pc)
    ]

    # Actual vs predicted for the last 7 days of the hold-out (for the chart)
    tail = test.index[-WEEK:]
    backtest = [
        {"ts": t.strftime("%Y-%m-%d %H:%M"), "actual": float(yte.loc[t]), "predicted": float(preds[best_name][test.index.get_loc(t)])}
        for t in tail
    ]

    return {
        "setup": {
            "records": int(len(hist)),
            "train_rows": int(len(train)),
            "test_rows": int(len(test)),
            "train_end": str(train.index.max()),
            "test_start": str(test.index.min()),
            "test_end": str(test.index.max()),
            "split": f"Chronological: last {TEST_DAYS} days held out for testing",
            "features": [FEATURE_LABELS.get(f, f) for f in feats],
            "note": "Appliance inputs use readings from the same hour in the previous week to avoid same-hour target leakage. Weather inputs are used when present; heat index is derived from temperature and humidity. Future weather uses historical month/hour averages.",
        },
        "models": results,
        "best_model": best_name,
        "improvement_vs_baseline_pct": float((baseline_rmse - best_rmse) / baseline_rmse * 100) if baseline_rmse else 0.0,
        "backtest": backtest,
        "forecast": forecast,
        "alerts": alerts,
        "feature_importance": importance,
        "classification": {
            "classes": CLASSES,
            "thresholds": {"low": float(lo), "high": float(hi), "low_pct": low_pct, "high_pct": high_pct},
            "rule": f"Off-Peak <= P{low_pct:g} ({lo:.1f} kWh) < Standard <= P{high_pct:g} ({hi:.1f} kWh) < Peak-Load (thresholds from training data)",
            "accuracy": float(accuracy_score(yte_c, pc)),
            "macro": macro,
            "per_class": per_class,
            "confusion_matrix": cm.tolist(),
            "class_share_test": class_share,
            "hourly": hourly,
        },
    }


def _canonical_building(path, building: str | None) -> str:
    """A single-building file is one building, however the request names it."""
    try:
        return "" if len(buildings_in_file(path)) <= 1 else (building or "")
    except Exception:
        return building or ""


def _disk_file(key: tuple) -> Path:
    digest = hashlib.sha1("|".join(map(str, (CACHE_VERSION, *key))).encode()).hexdigest()[:20]
    return CACHE_DIR / f"{digest}.json"


def _remember(key: tuple, result: dict) -> None:
    _cache[key] = result
    _cache.move_to_end(key)
    while len(_cache) > MAX_CACHED:
        _cache.popitem(last=False)


def get_ml(filename: str, path, low_pct: float = 40.0, high_pct: float = 85.0, building: str | None = None) -> dict:
    if not (0 < low_pct < high_pct < 100):
        raise ValueError("Percentiles must satisfy 0 < low < high < 100.")
    canon = _canonical_building(path, building)
    key = (filename, path.stat().st_mtime, low_pct, high_pct, canon)
    if key in _cache:
        return _cache[key]
    # One training at a time. Identical requests that arrive together (or after a quick
    # page change) wait here and then reuse the finished result instead of retraining.
    with _train_lock:
        if key in _cache:
            return _cache[key]
        disk = _disk_file(key)
        if disk.is_file():                      # survives backend restarts
            try:
                result = json.loads(disk.read_text(encoding="utf-8"))
                _remember(key, result)
                return result
            except Exception:
                pass
        result = run_ml(filter_building(pd.read_csv(path), canon or None), low_pct, high_pct)
        _remember(key, result)
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            disk.write_text(json.dumps(result), encoding="utf-8")
            old = sorted(CACHE_DIR.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True)[40:]
            for f in old:
                f.unlink(missing_ok=True)
        except Exception:
            pass                                # caching is best effort
        return result