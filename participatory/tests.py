from django.test import TestCase
from django.urls import reverse

from .models import Location


class LocationModelTests(TestCase):
    def test_string_representation(self):
        location = Location.objects.create(
            external_id="pt_x",
            name="pt_x",
            label="Sample Point",
            district_key="sample",
            district="Sample",
            indicator="erosion",
            attribute_2="severity=4",
            severity=4,
            latitude=-15.0,
            longitude=35.0,
            source_file="source.shp",
        )
        self.assertIn("Sample Point", str(location))


class DashboardDistrictFilterTests(TestCase):
    def test_dashboard_defaults_to_salima_when_available(self):
        Location.objects.create(
            external_id="pt_a",
            name="pt_a",
            label="Point A",
            district_key="salima",
            district="Salima",
            indicator="erosion",
            attribute_2="severity=3",
            severity=3,
            latitude=-15.0,
            longitude=35.0,
            source_file="source_a.shp",
        )
        Location.objects.create(
            external_id="pt_b",
            name="pt_b",
            label="Point B",
            district_key="district-b",
            district="District B",
            indicator="flood",
            attribute_2="severity=5",
            severity=5,
            latitude=-14.0,
            longitude=34.0,
            source_file="source_b.shp",
        )

        response = self.client.get(reverse("dashboard"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["current"]["district"], "Salima")
        self.assertEqual(response.context["filtered_count"], 1)


class DistrictBoundaryApiTests(TestCase):
    def test_district_boundary_endpoint_returns_all_districts_and_marks_matches(self):
        Location.objects.create(
            external_id="pt_salima",
            name="pt_salima",
            label="Point Salima",
            district_key="salima",
            district="Salima",
            indicator="erosion",
            attribute_2="severity=3",
            severity=3,
            latitude=-13.7,
            longitude=34.3,
            source_file="source_salima.shp",
        )
        Location.objects.create(
            external_id="pt_mchinji",
            name="pt_mchinji",
            label="Point Mchinji",
            district_key="mchinji",
            district="Mchinji",
            indicator="flood",
            attribute_2="severity=5",
            severity=5,
            latitude=-13.8,
            longitude=32.9,
            source_file="source_mchinji.shp",
        )

        response = self.client.get(
            reverse("district_boundaries_geojson"),
            {"district": "Salima"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertGreater(payload["count"], 1)
        self.assertEqual(payload["matched_count"], 1)

        salima_feature = next(
            feature
            for feature in payload["features"]
            if feature["properties"]["district"] == "Salima"
        )
        mchinji_feature = next(
            feature
            for feature in payload["features"]
            if feature["properties"]["district"] == "Mchinji"
        )

        self.assertTrue(salima_feature["properties"]["is_matched"])
        self.assertFalse(mchinji_feature["properties"]["is_matched"])
