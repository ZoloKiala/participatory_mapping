from django.db.models import Count
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import redirect, render
from django.views.decorators.http import require_GET, require_POST

from .models import IndicatorSelection, Location


def _apply_location_filters_from_params(params):
    queryset = Location.objects.all()

    district = params.get("district", "").strip()
    indicators = [value.strip() for value in params.getlist("indicator") if value.strip()]
    q = params.get("q", "").strip()

    severity_min = params.get("severity_min", "").strip()
    severity_max = params.get("severity_max", "").strip()

    if district:
        queryset = queryset.filter(district=district)
    if indicators:
        queryset = queryset.filter(indicator__in=indicators)
    if q:
        queryset = queryset.filter(label__icontains=q)

    if severity_min:
        try:
            queryset = queryset.filter(severity__gte=int(severity_min))
        except ValueError:
            pass
    if severity_max:
        try:
            queryset = queryset.filter(severity__lte=int(severity_max))
        except ValueError:
            pass

    return queryset


def _apply_location_filters(request: HttpRequest):
    return _apply_location_filters_from_params(request.GET)


@require_GET
def dashboard(request: HttpRequest) -> HttpResponse:
    districts = list(
        Location.objects.order_by("district").values_list("district", flat=True).distinct()
    )
    params = request.GET.copy()
    selected_district = params.get("district", "").strip()

    # First page load: preselect the first district so users start with a focused view.
    if not request.GET and not selected_district and districts:
        selected_district = districts[0]
        params["district"] = selected_district

    filtered_qs = _apply_location_filters_from_params(params)
    indicators = (
        Location.objects.exclude(indicator="")
        .order_by("indicator")
        .values_list("indicator", flat=True)
        .distinct()
    )

    indicator_counts = (
        filtered_qs.exclude(indicator="")
        .values("indicator")
        .annotate(count=Count("id"))
        .order_by("-count", "indicator")[:15]
    )

    context = {
        "districts": districts,
        "indicators": indicators,
        "filtered_count": filtered_qs.count(),
        "indicator_counts": indicator_counts,
        "current": {
            "district": selected_district,
            "indicators": [value.strip() for value in params.getlist("indicator") if value.strip()],
            "severity_min": params.get("severity_min", ""),
            "severity_max": params.get("severity_max", ""),
            "q": params.get("q", ""),
        },
        "query_string": params.urlencode(),
    }
    return render(request, "participatory/dashboard.html", context)


@require_GET
def locations_geojson(request: HttpRequest) -> JsonResponse:
    queryset = _apply_location_filters(request)

    try:
        limit = max(1, min(int(request.GET.get("limit", "2500")), 5000))
    except ValueError:
        limit = 2500

    features = []
    for location in queryset[:limit]:
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [location.longitude, location.latitude],
                },
                "properties": {
                    "id": location.external_id,
                    "name": location.name,
                    "label": location.label,
                    "district": location.district,
                    "indicator": location.indicator,
                    "severity": location.severity,
                    "source_file": location.source_file,
                },
            }
        )

    return JsonResponse(
        {
            "type": "FeatureCollection",
            "count": queryset.count(),
            "returned": len(features),
            "features": features,
        }
    )


@require_GET
def indicator_summary(request: HttpRequest) -> JsonResponse:
    queryset = _apply_location_filters(request)
    summary = (
        queryset.exclude(indicator="")
        .values("indicator")
        .annotate(count=Count("id"))
        .order_by("-count", "indicator")
    )
    return JsonResponse({"results": list(summary)})


@require_POST
def submit_selection(request: HttpRequest) -> HttpResponse:
    indicator = request.POST.get("indicator", "").strip()
    district = request.POST.get("district", "").strip()
    rationale = request.POST.get("rationale", "").strip()

    if indicator:
        IndicatorSelection.objects.create(indicator=indicator, district=district, rationale=rationale)

    redirect_qs = request.POST.get("query_string", "")
    target = "/"
    if redirect_qs:
        target = f"/?{redirect_qs}"
    return redirect(target)


@require_GET
def selection_results(request: HttpRequest) -> JsonResponse:
    district = request.GET.get("district", "").strip()
    selections = IndicatorSelection.objects.all()

    if district:
        selections = selections.filter(district=district)

    results = (
        selections.values("indicator", "district")
        .annotate(votes=Count("id"))
        .order_by("-votes", "indicator")
    )

    return JsonResponse({"results": list(results)})


def error_404(request: HttpRequest, exception) -> HttpResponse:
    return render(request, "errors/404.html", status=404)


def error_500(request: HttpRequest) -> HttpResponse:
    return render(request, "errors/500.html", status=500)
