"""Opt-in coordinate conversion checked against independent public controls."""
import math
import unittest

from mdt_gnss import convert_gnss


# Generated with the published proj4js 2.19.0 package, not this converter.
# Source: https://cdn.jsdelivr.net/npm/proj4@2.19.0/dist/proj4.js
# Reference call: proj4('EPSG:4326', definition, [longitude, latitude])
# definition = '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 '
#              '+x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs'
# Fabricated/public geographic points exercise Seoul, Busan, Jeju and both
# offshore EPSG area extremes. No MDT source coordinates were sent externally.
CONTROLS = [
    (953901.1653121515, 1952032.0809790876, 37.5665, 126.978),
    (1143467.3796645734, 1688281.9820715068, 35.1796, 129.0756),
    (910010.5457116975, 1501279.7888660107, 33.4996, 126.5312),
    (1575908.7464528996, 2272844.7191108917, 40.26, 134.27),
    (532395.8675573831, 968317.172068967, 28.61, 122.72),
]


class GnssConversionTest(unittest.TestCase):
    def test_natural_origin_returns_latitude_before_longitude(self):
        result = convert_gnss(1000000, 2000000, 'EPSG:5179')
        self.assertIsNotNone(result)
        self.assertAlmostEqual(result[0], 38.0, delta=1e-10)
        self.assertAlmostEqual(result[1], 127.5, delta=1e-10)

    def test_independent_controls_cover_mainland_island_and_offshore(self):
        # Wrong ellipsoid, easting/northing order or truncated TM series fail.
        for x, y, latitude, longitude in CONTROLS:
            with self.subTest(latitude=latitude, longitude=longitude):
                result = convert_gnss(x, y, 'EPSG:5179')
                self.assertIsNotNone(result)
                self.assertAlmostEqual(result[0], latitude, delta=1e-8)
                self.assertAlmostEqual(result[1], longitude, delta=1e-8)

    def test_no_crs_does_not_guess_from_realistic_projected_values(self):
        for crs in [None, 'unknown', 'UNKNOWN', '', '  unknown  ']:
            with self.subTest(crs=crs):
                self.assertIsNone(convert_gnss(953901.1653121515, 1952032.0809790876, crs))

    def test_explicit_unsupported_crs_fails_clearly_even_without_a_fix(self):
        for crs in ['EPSG:5178', 'EPSG:4326', 'UTM-K', '5179']:
            with self.subTest(crs=crs):
                with self.assertRaisesRegex(ValueError, 'EPSG:5179'):
                    convert_gnss(None, None, crs)

    def test_missing_zero_and_nonfinite_gnss_are_unavailable(self):
        for x, y in [(None, 2000000), (1000000, None), (None, None),
                     (0, 2000000), (1000000, 0), (0, 0),
                     (math.nan, 2000000), (1000000, math.nan),
                     (math.inf, 2000000), (1000000, -math.inf)]:
            with self.subTest(x=x, y=y):
                self.assertIsNone(convert_gnss(x, y, 'EPSG:5179'))

    def test_coordinates_outside_epsg_area_are_unavailable(self):
        # PROJ4JS forward references just beyond each documented area bound.
        for x, y in [(572776.1633920947, 1899841.6140550277),
                     (1605430.6184396949, 1910737.1603149541),
                     (1000000, 946776.9350152942),
                     (1000000, 2255240.129385932)]:
            with self.subTest(x=x, y=y):
                self.assertIsNone(convert_gnss(x, y, 'EPSG:5179'))

    def test_bad_scale_reversed_axes_and_extreme_numbers_are_unavailable(self):
        # Huge northings must not wrap through trigonometric periodicity.
        for x, y in [(953.9, 1952.03), (1952032.08, 953901.17),
                     (-1000000, 2000000), (1e308, 2000000),
                     (1000000, 1e308), (10 ** 1000, 2000000),
                     ('953901', 1952032), (1000000, '')]:
            with self.subTest(x=x, y=y):
                self.assertIsNone(convert_gnss(x, y, 'EPSG:5179'))


if __name__ == '__main__':
    unittest.main()
