"""One-off ETL: convert the Zambia participatory shapefiles into CSV rows
matching the schema of preloaded_locations.csv.

- Reads every shapefile under .gdrive_dl/extracted/
- Spatial-joins points against geoBoundaries-ZMB-ADM2.geojson so each row gets
  a real Zambia ADM2 district name
- Writes preloaded_locations_zambia.csv next to preloaded_locations.csv
"""

from __future__ import annotations

import csv
import re
from pathlib import Path

import geopandas as gpd

ROOT = Path(__file__).resolve().parent.parent
SHAPEFILE_ROOT = ROOT / ".gdrive_dl" / "extracted"
BOUNDARIES_PATH = ROOT / "geoBoundaries-ZMB-ADM2.geojson"
EXISTING_CSV = ROOT / "preloaded_locations.csv"
OUTPUT_CSV = ROOT / "preloaded_locations_zambia.csv"

CATEGORY_PATTERNS: dict[str, re.Pattern[str]] = {
    "Older_Men": re.compile(r"(?i)(?:elder(?:ly)?|older|adult)_men"),
    "Older_Women": re.compile(r"(?i)(?:elder(?:ly)?|older|adult)_women"),
    "Younger_Men": re.compile(r"(?i)(?:young|younger)_men"),
    "Younger_Women": re.compile(r"(?i)(?:young|younger)_women"),
}


def category_from_folder(folder: str) -> str:
    for category, pattern in CATEGORY_PATTERNS.items():
        if pattern.search(folder):
            return category
    return ""


def derive_source_file(folder: str) -> str:
    """Produce a source_file string that the existing views can detect.

    The views look for tokens like ``Older_Men_`` inside source_file.  The
    raw folder name already follows that convention, but we standardise the
    demographic suffix so Elder/Elderly map to Older.
    """

    category = category_from_folder(folder)
    if category:
        # Replace the matched demographic chunk with the canonical token so
        # downstream filters work without changes.
        for pattern in CATEGORY_PATTERNS.values():
            folder = pattern.sub(category, folder)
    return f"Zambia/{folder}.shp"


def next_id_seed() -> int:
    """Return one above the largest pt_NNNNN id already in the existing CSV."""

    pattern = re.compile(r"pt_(\d+)")
    largest = 0
    if EXISTING_CSV.exists():
        with EXISTING_CSV.open("r", encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                m = pattern.search(row.get("id", ""))
                if m:
                    largest = max(largest, int(m.group(1)))
    return largest + 1


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (value or "").lower()).strip("_")


def main() -> None:
    if not SHAPEFILE_ROOT.exists():
        raise SystemExit(f"shapefile folder not found: {SHAPEFILE_ROOT}")
    if not BOUNDARIES_PATH.exists():
        raise SystemExit(f"Zambia boundary file missing: {BOUNDARIES_PATH}")

    boundaries = gpd.read_file(BOUNDARIES_PATH)
    if boundaries.crs is None or boundaries.crs.to_epsg() != 4326:
        boundaries = boundaries.to_crs("EPSG:4326")
    boundaries = boundaries[["shapeName", "geometry"]].rename(
        columns={"shapeName": "district"}
    )

    rows: list[dict[str, str]] = []
    next_id = next_id_seed()

    for folder in sorted(p for p in SHAPEFILE_ROOT.iterdir() if p.is_dir()):
        shp = next(folder.glob("*.shp"), None)
        if shp is None:
            continue
        gdf = gpd.read_file(shp)
        if gdf.empty:
            continue
        if gdf.crs is None:
            gdf = gdf.set_crs("EPSG:4326")
        else:
            gdf = gdf.to_crs("EPSG:4326")

        # Some shapefiles use "Feature", others "Features"
        feature_col = "Feature" if "Feature" in gdf.columns else (
            "Features" if "Features" in gdf.columns else None
        )
        if feature_col is None:
            print(f"  WARN: no Feature column in {shp.name}")
            continue

        joined = gpd.sjoin(gdf, boundaries, how="left", predicate="within")
        unmatched = joined["district"].isna().sum()
        if unmatched:
            print(f"  {folder.name}: {unmatched}/{len(joined)} pts outside Zambia ADM2 boundaries")

        source_file = derive_source_file(folder.name)
        for _, feat in joined.iterrows():
            geom = feat.geometry
            if geom is None or geom.is_empty:
                continue
            district = (feat.get("district") or "").strip()
            if not district:
                # Fall back to a label derived from the folder name (without the
                # demographic suffix) so the row is still loadable.
                district = re.sub(
                    r"_(?:elder(?:ly)?|older|young(?:er)?|adult)_(?:men|women)$",
                    "",
                    folder.name,
                    flags=re.IGNORECASE,
                ).split("_", 1)[-1].replace("_", " ").title()
            indicator_value = feat.get(feature_col)
            if indicator_value is None or (isinstance(indicator_value, float) and indicator_value != indicator_value):
                indicator_raw = ""
            else:
                indicator_raw = str(indicator_value).strip()
            severity_raw = feat.get("Severity")
            try:
                severity_int = int(severity_raw)
            except (TypeError, ValueError):
                severity_int = 0

            pt_id = f"pt_{next_id:05d}"
            next_id += 1
            rows.append(
                {
                    "name": pt_id,
                    "label": f"{district} - {indicator_raw}",
                    "district_key": slug(district),
                    "district": district,
                    "attribute_1": indicator_raw,
                    "attribute_2": f"severity={severity_int}",
                    "latitude": f"{geom.y}",
                    "longitude": f"{geom.x}",
                    "source_file": source_file,
                    "id": pt_id,
                }
            )

    if not rows:
        raise SystemExit("no rows produced")

    fieldnames = [
        "name",
        "label",
        "district_key",
        "district",
        "attribute_1",
        "attribute_2",
        "latitude",
        "longitude",
        "source_file",
        "id",
    ]
    with OUTPUT_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {len(rows)} rows to {OUTPUT_CSV}")

    districts_seen = sorted({row["district"] for row in rows})
    print("districts (Zambia):", districts_seen)


if __name__ == "__main__":
    main()
