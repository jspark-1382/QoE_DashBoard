"""UTM inverse projection for the raw gnss_utmkx/utmky columns of the merged
workbook, plus the projection decision gate.

Decision (probe run 2026-10-13, _analysis/probe_projection.py over 1,912
valid pairs): no CANDIDATES entry maps >=95% of the data inside the Korean
peninsula. utm52-fe1e6-fn0 places longitude exactly over the Seoul metro
area (126.81..127.19) but latitude at 17.3..17.9 -- a ~+20 degrees northing
mismatch, i.e. the vendor applied a non-standard false northing. CHOSEN is
therefore "" and the pipeline runs in degraded mode (site representative
coordinates, time series intact) until the data owner confirms the EPSG.
See .superpowers ledger for the ruling.
"""

WGS84 = {"a": 6378137.0, "f": 1 / 298.257223563}
BESSEL = {"a": 6377397.155, "f": 1 / 299.1528128}

CANDIDATES = {
    "utm52-fe1e6-fn0": {**WGS84, "k0": 0.9996, "lon0": 127.5, "fe": 1_000_000, "fn": 0},
    "utm52-fe1e6-fn500k": {**WGS84, "k0": 0.9996, "lon0": 127.5, "fe": 1_000_000, "fn": 500_000},
    "utm52-fe1e6-fn2e6": {**WGS84, "k0": 0.9996, "lon0": 127.5, "fe": 1_000_000, "fn": 2_000_000},
    "utm52-bessel-fe1e6-fn0": {**BESSEL, "k0": 0.9996, "lon0": 127.5, "fe": 1_000_000, "fn": 0},
    "utm52-wgs84-fe2e6-fn500k": {**WGS84, "k0": 0.9996, "lon0": 127.5, "fe": 2_000_000, "fn": 500_000},
    "utm53-wgs84-fe2e6-fn500k": {**WGS84, "k0": 0.9996, "lon0": 128.5, "fe": 2_000_000, "fn": 500_000},
}

CHOSEN = ""  # gate result: no candidate passes; confirm EPSG with data owner


def _ellipsoid(cfg):
    e2 = cfg["f"] * (2 - cfg["f"])
    return e2, e2 / (1 - e2)


def forward(lat_deg, lon_deg, cfg):
    """Transverse Mercator forward (Snyder). Used by tests and tooling."""
    import math

    e2, ep2 = _ellipsoid(cfg)
    lat, lon, lon0 = math.radians(lat_deg), math.radians(lon_deg), math.radians(cfg["lon0"])
    n = cfg["a"] / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    t = math.tan(lat) ** 2
    c = ep2 * math.cos(lat) ** 2
    aterm = math.cos(lat) * (lon - lon0)
    m = cfg["a"] * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * lat
                    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * math.sin(2 * lat)
                    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * math.sin(4 * lat)
                    - (35 * e2 ** 3 / 3072) * math.sin(6 * lat))
    east = cfg["fe"] + cfg["k0"] * n * (aterm + (1 - t + c) * aterm ** 3 / 6
                                        + (5 - 18 * t + t * t + 72 * c - 58 * ep2) * aterm ** 5 / 120)
    north = cfg["fn"] + cfg["k0"] * (m + n * math.tan(lat) * (aterm ** 2 / 2
                                          + (5 - t + 9 * c + 4 * c * c) * aterm ** 4 / 24
                                          + (61 - 58 * t + t * t + 600 * c - 330 * ep2) * aterm ** 6 / 720))
    return east, north


def to_latlon(x, y, name):
    """Inverse Transverse Mercator; None for non-positive placeholders or unknown zones."""
    import math

    cfg = CANDIDATES.get(name)
    if cfg is None or x is None or y is None or x <= 0 or y <= 0:
        return None
    e2, ep2 = _ellipsoid(cfg)
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    lon0 = math.radians(cfg["lon0"])
    m = (y - cfg["fn"]) / cfg["k0"]
    mu = m / (cfg["a"] * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))
    phi1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu)
            + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
            + (151 * e1 ** 3 / 96) * math.sin(6 * mu)
            + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    sin1, cos1, tan1 = math.sin(phi1), math.cos(phi1), math.tan(phi1)
    c1 = ep2 * cos1 ** 2
    t1 = tan1 ** 2
    n1 = cfg["a"] / math.sqrt(1 - e2 * sin1 ** 2)
    r1 = cfg["a"] * (1 - e2) / (1 - e2 * sin1 ** 2) ** 1.5
    d = (x - cfg["fe"]) / (n1 * cfg["k0"])
    lat = phi1 - (n1 * tan1 / r1) * d ** 2 / 2 * (
        1 - d ** 2 * (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) / 12
        + d ** 4 * (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) / 360)
    lon = lon0 + (d - d ** 3 * (1 + 2 * t1 + c1) / 6
                  + d ** 5 * (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) / 120) / cos1
    return math.degrees(lat), math.degrees(lon)


def korea_bbox(lat, lon):
    return 33 <= lat <= 39 and 124 <= lon <= 132
