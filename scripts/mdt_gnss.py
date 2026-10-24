"""Explicit EPSG:5179 inverse projection, with no source-CRS inference.

Input order follows the MDT fields: x=easting and y=northing, in metres.
EPSG's formal projected axis order is northing/easting; do not use that order
here. Output is native KGD2002/Korea 2000 geographic (latitude, longitude).
No datum/epoch correction or GNSS accuracy claim is implied by this inverse.

Parameters and area: PROJ's EPSG database, conversion 5100 and extent 1135:
https://github.com/OSGeo/PROJ/blob/master/data/sql/conversion.sql
https://github.com/OSGeo/PROJ/blob/master/data/sql/extent.sql
Longitude 127.3 in unit EPSG:9110 means 127 degrees 30 minutes, i.e. 127.5.
Sixth-order Krueger series follows the primary PROJ mathematical definition:
https://proj.org/en/stable/operations/projections/tmerc.html
"""
import cmath
import math


_FLATTENING = 1 / 298.257222101  # EPSG:7019, GRS 1980
_N = _FLATTENING / (2 - _FLATTENING)
_E = math.sqrt(_FLATTENING * (2 - _FLATTENING))
_A = 6378137 / (1 + _N) * (1 + _N ** 2 / 4 + _N ** 4 / 64 + _N ** 6 / 256)
_SCALE_RADIUS = 0.9996 * _A

# Rows of C_mu,chi * N: conformal to rectifying coordinates.
_ALPHA = (
    _N / 2 - 2 * _N ** 2 / 3 + 5 * _N ** 3 / 16 + 41 * _N ** 4 / 180
    - 127 * _N ** 5 / 288 + 7891 * _N ** 6 / 37800,
    13 * _N ** 2 / 48 - 3 * _N ** 3 / 5 + 557 * _N ** 4 / 1440
    + 281 * _N ** 5 / 630 - 1983433 * _N ** 6 / 1935360,
    61 * _N ** 3 / 240 - 103 * _N ** 4 / 140 + 15061 * _N ** 5 / 26880
    + 167603 * _N ** 6 / 181440,
    49561 * _N ** 4 / 161280 - 179 * _N ** 5 / 168 + 6601661 * _N ** 6 / 7257600,
    34729 * _N ** 5 / 80640 - 3418889 * _N ** 6 / 1995840,
    212378941 * _N ** 6 / 319334400,
)
# Rows of C_chi,mu * N: inverse rectification (signed coefficients).
_INVERSE = (
    -_N / 2 + 2 * _N ** 2 / 3 - 37 * _N ** 3 / 96 + _N ** 4 / 360
    + 81 * _N ** 5 / 512 - 96199 * _N ** 6 / 604800,
    -_N ** 2 / 48 - _N ** 3 / 15 + 437 * _N ** 4 / 1440
    - 46 * _N ** 5 / 105 + 1118711 * _N ** 6 / 3870720,
    -17 * _N ** 3 / 480 + 37 * _N ** 4 / 840 + 209 * _N ** 5 / 4480
    - 5569 * _N ** 6 / 90720,
    -4397 * _N ** 4 / 161280 + 11 * _N ** 5 / 504 + 830251 * _N ** 6 / 7257600,
    -4583 * _N ** 5 / 161280 + 108847 * _N ** 6 / 3991680,
    -20648693 * _N ** 6 / 638668800,
)
# Rows of C_phi,chi * N: conformal to geodetic latitude.
_GEODETIC = (
    2 * _N - 2 * _N ** 2 / 3 - 2 * _N ** 3 + 116 * _N ** 4 / 45
    + 26 * _N ** 5 / 45 - 2854 * _N ** 6 / 675,
    7 * _N ** 2 / 3 - 8 * _N ** 3 / 5 - 227 * _N ** 4 / 45
    + 2704 * _N ** 5 / 315 + 2323 * _N ** 6 / 945,
    56 * _N ** 3 / 15 - 136 * _N ** 4 / 35 - 1262 * _N ** 5 / 105
    + 73814 * _N ** 6 / 2835,
    4279 * _N ** 4 / 630 - 332 * _N ** 5 / 35 - 399572 * _N ** 6 / 14175,
    4174 * _N ** 5 / 315 - 144838 * _N ** 6 / 6237,
    601676 * _N ** 6 / 22275,
)
_PHI0 = math.radians(38)
_CHI0 = math.atan(math.sinh(math.asinh(math.tan(_PHI0))
                           - _E * math.atanh(_E * math.sin(_PHI0))))
_XI0 = _CHI0 + math.fsum(coefficient * math.sin(2 * j * _CHI0)
                         for j, coefficient in enumerate(_ALPHA, 1))

# EPSG area includes offshore waters; this is a plausibility bound, not a
# land polygon, indoor classifier, accuracy estimate or proof of source CRS.
_SOUTH, _NORTH, _WEST, _EAST = 28.6, 40.27, 122.71, 134.28


def convert_gnss(x: float | None, y: float | None,
                 crs: str | None) -> tuple[float, float] | None:
    """Return (latitude, longitude) only for explicitly selected EPSG:5179.

    None, blank or 'unknown' CRS keeps the fix unavailable. An unsupported
    explicit CRS raises ValueError even for absent inputs. Invalid fixes return
    None so the caller can preserve the raw values without inventing a position.
    """
    selected = crs.strip().upper() if isinstance(crs, str) else crs
    if selected in (None, '', 'UNKNOWN'):
        return None
    if selected != 'EPSG:5179':
        raise ValueError(f'Unsupported GNSS CRS {crs!r}; supported explicit CRS is EPSG:5179')
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return None
    try:
        easting, northing = float(x), float(y)
    except (OverflowError, ValueError):
        return None
    if not math.isfinite(easting) or not math.isfinite(northing):
        return None
    # Broad metre bounds encompass the full EPSG rectangle and stop arbitrary
    # magnitudes reaching periodic trigonometry or overflowing hyperbolic sine.
    if not (0 < easting < 2000000 and 500000 < northing < 2600000):
        return None

    rectified = complex((northing - 2000000) / _SCALE_RADIUS + _XI0,
                        (easting - 1000000) / _SCALE_RADIUS)
    conformal = rectified + sum(coefficient * cmath.sin(2 * j * rectified)
                                 for j, coefficient in enumerate(_INVERSE, 1))
    xi, eta = conformal.real, conformal.imag
    chi = math.atan2(math.sin(xi), math.hypot(math.sinh(eta), math.cos(xi)))
    phi = chi + math.fsum(coefficient * math.sin(2 * j * chi)
                          for j, coefficient in enumerate(_GEODETIC, 1))
    latitude = math.degrees(phi)
    longitude = 127.5 + math.degrees(math.atan2(math.sinh(eta), math.cos(xi)))
    tolerance = 1e-9  # Only accommodates floating-point round-off on the boundary.
    if not (_SOUTH - tolerance <= latitude <= _NORTH + tolerance
            and _WEST - tolerance <= longitude <= _EAST + tolerance):
        return None
    return latitude, longitude
