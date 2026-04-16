from django.urls import path

from . import views

urlpatterns = [
    path("", views.dashboard, name="dashboard"),
    path("api/locations.geojson", views.locations_geojson, name="locations_geojson"),
    path("api/districts.geojson", views.district_boundaries_geojson, name="district_boundaries_geojson"),
    path("api/indicators", views.indicator_summary, name="indicator_summary"),
    path("api/selections", views.selection_results, name="selection_results"),
    path("selections/submit", views.submit_selection, name="submit_selection"),
]
