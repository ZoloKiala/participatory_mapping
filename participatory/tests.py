from django.test import TestCase
from django.urls import reverse

from .models import Location
from .views import _available_categories


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


class DashboardSearchTests(TestCase):
    def test_search_matches_label_name_indicator_and_district_fields(self):
        Location.objects.create(
            external_id="pt_label",
            name="pt_label",
            label="Salima - borehole",
            district_key="salima",
            district="Salima",
            indicator="borehole",
            attribute_2="severity=3",
            severity=3,
            latitude=-13.7,
            longitude=34.3,
            source_file="older_men_source.shp",
        )
        Location.objects.create(
            external_id="pt_name",
            name="marker_alpha",
            label="Point two",
            district_key="mchinji",
            district="Mchinji",
            indicator="erosion",
            attribute_2="severity=2",
            severity=2,
            latitude=-13.8,
            longitude=32.9,
            source_file="older_women_source.shp",
        )
        Location.objects.create(
            external_id="pt_indicator",
            name="pt_indicator",
            label="Point three",
            district_key="kasungu",
            district="Kasungu",
            indicator="seasonal stream",
            attribute_2="severity=4",
            severity=4,
            latitude=-13.1,
            longitude=33.4,
            source_file="younger_men_source.shp",
        )

        response = self.client.get(reverse("dashboard"), {"q": "stream"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["filtered_count"], 1)
        self.assertEqual(response.context["current"]["q"], "stream")

        response = self.client.get(reverse("dashboard"), {"q": "marker_alpha"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["filtered_count"], 1)

        response = self.client.get(reverse("dashboard"), {"q": "Salima"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["filtered_count"], 1)


class ParticipantCategoryParsingTests(TestCase):
    def test_lilongwe_source_files_are_included_in_category_detection_and_filtering(self):
        Location.objects.create(
            external_id="pt_lil_older_men",
            name="pt_lil_older_men",
            label="Lilongwe older men",
            district_key="lilongwe",
            district="Lilongwe",
            indicator="erosion",
            attribute_2="severity=3",
            severity=3,
            latitude=-14.0,
            longitude=33.4,
            source_file="Lilongwe/Men_Older_Than_40_Lilongwe.shp",
        )
        Location.objects.create(
            external_id="pt_lil_younger_women",
            name="pt_lil_younger_women",
            label="Lilongwe younger women",
            district_key="lilongwe",
            district="Lilongwe",
            indicator="flood",
            attribute_2="severity=5",
            severity=5,
            latitude=-14.1,
            longitude=33.5,
            source_file="Lilongwe/Women_Less_than_40_Lilongwe.shp",
        )

        self.assertEqual(
            _available_categories(),
            ["Older_Men", "Younger_Women"],
        )

        older_men_response = self.client.get(
            reverse("locations_geojson"),
            {"district": "Lilongwe", "category": "Older_Men"},
        )
        younger_women_response = self.client.get(
            reverse("locations_geojson"),
            {"district": "Lilongwe", "category": "Younger_Women"},
        )

        self.assertEqual(older_men_response.status_code, 200)
        self.assertEqual(younger_women_response.status_code, 200)
        self.assertEqual(older_men_response.json()["count"], 1)
        self.assertEqual(younger_women_response.json()["count"], 1)
