from django.contrib import admin

from .models import IndicatorSelection, Location


@admin.register(Location)
class LocationAdmin(admin.ModelAdmin):
    list_display = ("external_id", "district", "indicator", "severity", "latitude", "longitude")
    list_filter = ("district", "indicator", "severity")
    search_fields = ("external_id", "name", "label", "indicator", "source_file")


@admin.register(IndicatorSelection)
class IndicatorSelectionAdmin(admin.ModelAdmin):
    list_display = ("indicator", "district", "created_at")
    list_filter = ("district", "indicator", "created_at")
    search_fields = ("indicator", "district", "rationale")
