from django.test import TestCase

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
