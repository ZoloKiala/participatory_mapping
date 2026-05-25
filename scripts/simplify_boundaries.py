"""Pre-simplify ADM2 boundary GeoJSON files.

The raw geoBoundaries files use very high vertex density (good for analysis,
unnecessarily heavy for a dashboard overview map). 1 km tolerance is more
than enough for a country-level overview.

Run:
    python scripts/simplify_boundaries.py
"""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd

ROOT = Path(__file__).resolve().parent.parent

# Tolerance in degrees. 0.01 ≈ ~1.1 km at the equator, perfectly fine for
# an ADM2 overview map shown at country-level zoom.
TOLERANCE = 0.01

SOURCES = [
    ("geoBoundaries-MWI-ADM2.geojson", "geoBoundaries-MWI-ADM2.simplified.geojson"),
    ("geoBoundaries-ZMB-ADM2.geojson", "geoBoundaries-ZMB-ADM2.simplified.geojson"),
]


def main() -> None:
    for src_name, dst_name in SOURCES:
        src = ROOT / src_name
        dst = ROOT / dst_name
        if not src.exists():
            print(f"skip {src_name}: not found")
            continue
        gdf = gpd.read_file(src)
        before_bytes = src.stat().st_size
        gdf["geometry"] = gdf.geometry.simplify(TOLERANCE, preserve_topology=True)
        # Drop empty/null geometries that simplification may have produced.
        gdf = gdf[~gdf.geometry.is_empty & gdf.geometry.notna()]
        gdf.to_file(dst, driver="GeoJSON")
        after_bytes = dst.stat().st_size
        print(
            f"{src_name}: {before_bytes/1024/1024:.1f} MB -> "
            f"{dst_name}: {after_bytes/1024/1024:.2f} MB "
            f"({100*after_bytes/before_bytes:.1f}% of original, "
            f"{len(gdf)} features)"
        )


if __name__ == "__main__":
    main()
