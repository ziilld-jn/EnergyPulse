"""Buildings are read from the uploaded CSV files themselves.

A CSV may hold one or many buildings. Rows are grouped by a building column
(building_id, building, site, ...). Optional columns give the details shown on
the Buildings page: a display name, type, floors, capacity (kW), zone and
smart-meter flag. A CSV with no building column counts as one building named
after the file, so older single-building datasets keep working.
"""
from pathlib import Path

import pandas as pd

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"

ID_COLS = ["building_id", "building", "building_code", "site_id", "site", "facility_id", "facility"]
NAME_COLS = ["building_name", "building_location", "site_name", "facility_name"]
TYPE_COLS = ["building_type", "type", "category"]
FLOOR_COLS = ["floors", "floor_count", "number_of_floors", "storeys"]
CAPACITY_COLS = ["capacity_kw", "building_capacity_kw", "contract_capacity_kw", "contracted_capacity_kw"]
ZONE_COLS = ["zone", "utility_zone", "distribution_zone", "service_area"]
METER_COLS = ["smart_meter", "has_smart_meter", "smart_meter_installed"]
DATE_COLS = ["timestamp", "datetime", "date_time", "date", "time"]
DEMAND_COLS = ["total_building_demand_kw", "demand_kw", "power_kw", "kw"]

_cache: dict[tuple, list] = {}


def _norm(c) -> str:
    return str(c).strip().lower().replace(" ", "_")


def _first(cols: dict, names: list[str]):
    return next((cols[n] for n in names if n in cols), None)


def find_id_col(df: pd.DataFrame):
    return _first({_norm(c): c for c in df.columns}, ID_COLS)


def filter_building(df: pd.DataFrame, building: str | None) -> pd.DataFrame:
    """Keep only one building's rows. No building column or no building given: unchanged."""
    if not building:
        return df
    col = find_id_col(df)
    if col is None:
        return df
    out = df[df[col].astype(str).str.strip() == building]
    if out.empty:
        raise ValueError(f"Building '{building}' was not found in this dataset.")
    return out


def _pretty(stem: str) -> str:
    return stem.replace("_", " ").replace("-", " ").strip()


def _truthy(v) -> bool:
    return str(v).strip().lower() in {"1", "true", "yes", "y", "installed", "active"}


def _num(v):
    n = pd.to_numeric(v, errors="coerce")
    return None if pd.isna(n) else float(n)


def buildings_in_file(path: Path) -> list[dict]:
    key = (path.name, path.stat().st_mtime)
    if key in _cache:
        return _cache[key]

    wanted = set(ID_COLS + NAME_COLS + TYPE_COLS + FLOOR_COLS + CAPACITY_COLS + ZONE_COLS + METER_COLS + DATE_COLS + DEMAND_COLS)
    df = pd.read_csv(path, usecols=lambda c: _norm(c) in wanted)
    cols = {_norm(c): c for c in df.columns}
    date_col, demand_col = _first(cols, DATE_COLS), _first(cols, DEMAND_COLS)
    if date_col is not None:
        df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    if demand_col is not None:
        df[demand_col] = pd.to_numeric(df[demand_col], errors="coerce")

    id_col = _first(cols, ID_COLS)
    groups = [("", df)] if id_col is None else [
        (str(k).strip(), g) for k, g in df.groupby(df[id_col].astype(str).str.strip(), sort=True) if str(k).strip()
    ]

    out = []
    for key_value, g in groups:
        def pick(names):
            c = _first(cols, names)
            if c is None:
                return None
            s = g[c].dropna()
            return s.iloc[0] if len(s) else None

        name = pick(NAME_COLS)
        item = {
            "id": f"{path.name}|{key_value}",
            "dataset": path.name,
            "building": key_value,
            "name": str(name).strip() if name is not None else (key_value if key_value else _pretty(path.stem)),
            "code": key_value,
            "type": str(pick(TYPE_COLS) or "").strip(),
            "floors": (int(_num(pick(FLOOR_COLS))) if _num(pick(FLOOR_COLS)) else None),
            "capacity_kw": _num(pick(CAPACITY_COLS)),
            "zone": str(pick(ZONE_COLS) or "").strip(),
            "smart_meter": (_truthy(pick(METER_COLS)) if pick(METER_COLS) is not None else None),
            "records": int(len(g)),
            "start": None, "end": None,
            "peak_kw": float(g[demand_col].max()) if demand_col is not None and g[demand_col].notna().any() else None,
        }
        if date_col is not None and g[date_col].notna().any():
            item["start"], item["end"] = str(g[date_col].min().date()), str(g[date_col].max().date())
        out.append(item)

    _cache.clear() if len(_cache) > 50 else None
    _cache[key] = out
    return out


def all_buildings() -> list[dict]:
    result = []
    for p in sorted(UPLOAD_DIR.glob("*.csv"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            result.extend(buildings_in_file(p))
        except Exception:
            continue  # unreadable CSV: Dataset Management still lists it
    return result