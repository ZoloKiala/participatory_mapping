from django.db import models


class Location(models.Model):
    external_id = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=255)
    label = models.CharField(max_length=255)
    district_key = models.CharField(max_length=128, db_index=True)
    district = models.CharField(max_length=128, db_index=True)
    indicator = models.CharField(max_length=255, blank=True, db_index=True)
    attribute_2 = models.CharField(max_length=255, blank=True)
    severity = models.IntegerField(null=True, blank=True, db_index=True)
    latitude = models.FloatField()
    longitude = models.FloatField()
    source_file = models.CharField(max_length=512, blank=True)

    class Meta:
        ordering = ["district", "indicator", "name"]

    def __str__(self) -> str:
        return f"{self.label} ({self.district})"


class IndicatorSelection(models.Model):
    indicator = models.CharField(max_length=255, db_index=True)
    district = models.CharField(max_length=128, blank=True, db_index=True)
    rationale = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        if self.district:
            return f"{self.indicator} [{self.district}]"
        return self.indicator
