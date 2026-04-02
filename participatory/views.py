import re
from collections import Counter

from django.db.models import Count, Q
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import redirect, render
from django.views.decorators.http import require_GET, require_POST

from .models import IndicatorSelection, Location


CATEGORY_RE = re.compile(r"(older|younger|young)_(men|women)", re.IGNORECASE)
INDICATOR_TYPO_FIXES = {
    "permamnent": "permanent",
    "permenent": "permanent",
    "permanant": "permanent",
    "seassonal": "seasonal",
    "nutirent": "nutrient",
    "fertilty": "fertility",
    "grazzing": "grazing",
    "gulley": "gully",
}
INDICATOR_TOKEN_SINGULAR = {
    "conflicts": "conflict",
    "disputes": "dispute",
    "corridors": "corridor",
    "wetlands": "wetland",
    "yields": "yield",
}
HIDDEN_INDICATORS = {"priority"}
INTERVENTION_AREA_ITEMS = [
    "contour bund",
    "cb plus",
    "cb minus",
    "d plus",
    "d minus",
    "dam",
]
INDICATOR_CATEGORY_ORDER = [
    "Hydrological and Water Stress Hotspots",
    "Soil Related Hotspots",
    "Crop and Productivity Hotspots",
    "Land  Use and Ecologcal Hotspots",
    "Socio-economic Hotspots",
    "Intervention Areas",
]
INDICATOR_CATEGORY_KEYS = {
    "Hydrological and Water Stress Hotspots": "water",
    "Soil Related Hotspots": "soil",
    "Crop and Productivity Hotspots": "productivity",
    "Land  Use and Ecologcal Hotspots": "ecosystem",
    "Socio-economic Hotspots": "governance",
    "Intervention Areas": "other",
}


def _normalize_category(value: str) -> str:
    normalized = (value or "").strip().replace(" ", "_")
    lower = normalized.lower()
    if lower == "young_men":
        return "Younger_Men"
    if lower == "young_women":
        return "Younger_Women"

    match = CATEGORY_RE.search(normalized)
    if not match:
        return normalized

    age, gender = match.groups()
    if age.lower() == "young":
        age = "Younger"
    else:
        age = age.capitalize()
    return f"{age}_{gender.capitalize()}"


def _category_tokens_for_filter(category: str) -> list[str]:
    normalized = _normalize_category(category)
    if normalized == "Younger_Men":
        return ["Younger_Men", "Young_Men"]
    if normalized == "Younger_Women":
        return ["Younger_Women", "Young_Women"]
    return [normalized]


def _available_categories() -> list[str]:
    categories = set()
    for source_file in Location.objects.exclude(source_file="").values_list("source_file", flat=True):
        match = CATEGORY_RE.search(source_file or "")
        if match:
            categories.add(_normalize_category(match.group(0)))
    return sorted(categories)


def _format_category_label(category: str) -> str:
    label = (category or "").replace("_", " ").strip().lower()
    if not label:
        return ""
    return label[0].upper() + label[1:]


def _normalize_indicator(value: str) -> str:
    normalized = (value or "").strip().lower()
    if not normalized:
        return ""

    normalized = normalized.replace("-", " ").replace("_", " ")
    normalized = re.sub(r"\s+", " ", normalized)

    words = [INDICATOR_TYPO_FIXES.get(token, token) for token in normalized.split(" ")]
    normalized = " ".join(words)

    normalized = normalized.replace("wild life", "wildlife")
    normalized = normalized.replace("river bank", "riverbank")
    normalized = normalized.replace("bore hole", "borehole")
    normalized = normalized.replace("good condition contour bund", "cb plus")
    normalized = normalized.replace("bad condition contour bund", "cb minus")
    normalized = normalized.replace("good contour bund", "cb plus")
    normalized = normalized.replace("bad contour bund", "cb minus")
    normalized = normalized.replace("good condition dam", "d plus")
    normalized = normalized.replace("bad condition dam", "d minus")
    normalized = normalized.replace("priority dam", "dam")
    normalized = normalized.replace("yield decline", "yield loss")
    normalized = normalized.replace("nutrient loss areas", "nutrient loss")
    normalized = normalized.replace("nutrient loss area", "nutrient loss")

    normalized = normalized.replace("riverbank collapsed", "riverbank collapse")
    normalized = normalized.replace("seasonal stream", "stream seasonal")
    if normalized == "flooding":
        normalized = "flood"
    if "grazing" in normalized:
        return "grazing pressure (high)"

    parts = normalized.split(" ")
    if parts:
        parts[-1] = INDICATOR_TOKEN_SINGULAR.get(parts[-1], parts[-1])
    return " ".join(parts)


def _indicator_groups() -> dict[str, set[str]]:
    groups: dict[str, set[str]] = {}
    indicators = (
        Location.objects.exclude(indicator="")
        .values_list("indicator", flat=True)
        .distinct()
    )
    for indicator in indicators:
        key = _normalize_indicator(indicator)
        if not key or key in HIDDEN_INDICATORS:
            continue
        groups.setdefault(key, set()).add(indicator)
    return groups


def _indicator_category(indicator: str) -> str:
    value = (indicator or "").lower()
    if not value:
        return "Intervention Areas"

    if any(
        token in value
        for token in [
            "contour bund",
            "contour bunds",
            "terrace",
            "terraces",
            "ridge",
            "ridges",
            "dam",
        ]
    ):
        return "Intervention Areas"

    if any(
        token in value
        for token in [
            "borehole",
            "river",
            "wetland",
            "stream",
            "water",
            "dam",
            "lake",
            "run off",
            "flood",
            "irrigation",
            "spring",
            "shallow well",
            "illegal abstraction",
        ]
    ):
        return "Hydrological and Water Stress Hotspots"

    if any(token in value for token in ["erosion", "gully", "sedimentation", "terraces", "ridges"]):
        return "Soil Related Hotspots"

    if any(token in value for token in ["yield", "fertility", "nutrient"]):
        return "Crop and Productivity Hotspots"

    if any(
        token in value
        for token in [
            "forest",
            "reforestation",
            "wildlife",
            "pollinators",
            "riparian",
            "deforestation",
        ]
    ):
        return "Land  Use and Ecologcal Hotspots"

    if any(token in value for token in ["grazing", "pasture"]):
        return "Crop and Productivity Hotspots"

    if any(token in value for token in ["priority", "women barriers", "land tenure"]):
        return "Socio-economic Hotspots"

    return "Intervention Areas"


def _group_indicators_by_category(indicators: list[str]) -> list[dict[str, object]]:
    grouped: dict[str, list[str]] = {category: [] for category in INDICATOR_CATEGORY_ORDER}
    for indicator in indicators:
        grouped[_indicator_category(indicator)].append(indicator)

    grouped["Intervention Areas"] = INTERVENTION_AREA_ITEMS.copy()

    return [
        {
            "name": category,
            "key": INDICATOR_CATEGORY_KEYS.get(category, "other"),
            "items": grouped[category],
        }
        for category in INDICATOR_CATEGORY_ORDER
        if grouped[category]
    ]


def _canonical_indicator_counts(queryset, limit: int = 15) -> list[dict[str, object]]:
    counter: Counter[str] = Counter()
    for indicator in queryset.exclude(indicator="").values_list("indicator", flat=True):
        normalized = _normalize_indicator(indicator)
        if normalized and normalized not in HIDDEN_INDICATORS:
            counter[normalized] += 1

    rows = []
    for indicator, count in sorted(counter.items(), key=lambda item: (-item[1], item[0]))[:limit]:
        category = _indicator_category(indicator)
        rows.append(
            {
                "indicator": indicator,
                "count": count,
                "category": category,
                "category_key": INDICATOR_CATEGORY_KEYS.get(category, "other"),
            }
        )
    return rows


def _apply_location_filters_from_params(params):
    queryset = Location.objects.all()

    district = params.get("district", "").strip()
    indicators = [value.strip() for value in params.getlist("indicator") if value.strip()]
    categories = [_normalize_category(value) for value in params.getlist("category") if value.strip()]
    q = params.get("q", "").strip()
    severity = params.get("severity", "").strip()

    severity_min = params.get("severity_min", "").strip()
    severity_max = params.get("severity_max", "").strip()

    if district:
        queryset = queryset.filter(district=district)
    if indicators:
        grouped_indicators = _indicator_groups()
        expanded_indicators = set()
        for selected in indicators:
            normalized_selected = _normalize_indicator(selected)
            if normalized_selected in grouped_indicators:
                expanded_indicators.update(grouped_indicators[normalized_selected])
            elif selected:
                expanded_indicators.add(selected)
        queryset = queryset.filter(indicator__in=expanded_indicators)
    if categories:
        source_file_query = Q()
        for category in categories:
            for token in _category_tokens_for_filter(category):
                source_file_query |= Q(source_file__icontains=f"{token}_")
        queryset = queryset.filter(source_file_query)
    if q:
        queryset = queryset.filter(label__icontains=q)

    if severity in {"1", "3", "5"}:
        queryset = queryset.filter(severity=int(severity))
    else:
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
    default_salima = next((district for district in districts if district.lower() == "salima"), "")

    if not request.GET and not selected_district and default_salima:
        selected_district = default_salima
        params["district"] = default_salima

    filtered_qs = _apply_location_filters_from_params(params)
    grouped_indicators = _indicator_groups()
    indicators = sorted(grouped_indicators.keys())
    indicator_option_groups = _group_indicators_by_category(indicators)

    indicator_counts = _canonical_indicator_counts(filtered_qs, limit=15)
    for row in indicator_counts:
        row_params = params.copy()
        row_params.setlist("indicator", [row["indicator"]])
        row["filter_query"] = row_params.urlencode()

    context = {
        "districts": districts,
        "indicator_option_groups": indicator_option_groups,
        "categories": [
            {"value": category, "label": _format_category_label(category)}
            for category in _available_categories()
        ],
        "filtered_count": filtered_qs.count(),
        "indicator_counts": indicator_counts,
        "current": {
            "district": selected_district,
            "indicator": (
                _normalize_indicator(params.get("indicator", "").strip())
                if params.get("indicator", "").strip()
                else ""
            ),
            "indicators": [
                _normalize_indicator(value) for value in params.getlist("indicator") if value.strip()
            ],
            "categories": [_normalize_category(value) for value in params.getlist("category") if value.strip()],
            "severity": params.get("severity", "").strip(),
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
