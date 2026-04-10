import csv
import re
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from participatory.models import Location


SEVERITY_RE = re.compile(r"severity\s*=\s*(-?\d+)", re.IGNORECASE)


class Command(BaseCommand):
    help = "Load extracted locations from preloaded_locations.csv"

    def add_arguments(self, parser):
        parser.add_argument(
            "--csv",
            default="preloaded_locations.csv",
            help="Path to CSV file containing extracted locations.",
        )
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Delete existing locations before import.",
        )
        parser.add_argument(
            "--if-empty",
            action="store_true",
            help="Import rows only when the Location table is empty.",
        )

    def handle(self, *args, **options):
        csv_path = Path(options["csv"]).resolve()
        if not csv_path.exists():
            raise CommandError(f"CSV not found: {csv_path}")

        if options["if_empty"] and Location.objects.exists():
            self.stdout.write(self.style.WARNING("Skipped import because locations already exist."))
            return

        if options["replace"]:
            deleted, _ = Location.objects.all().delete()
            self.stdout.write(self.style.WARNING(f"Deleted {deleted} existing rows."))

        batch = []
        created = 0

        with csv_path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                severity = None
                m = SEVERITY_RE.search((row.get("attribute_2") or "").strip())
                if m:
                    try:
                        severity = int(m.group(1))
                    except ValueError:
                        severity = None

                batch.append(
                    Location(
                        external_id=row.get("id", "").strip(),
                        name=row.get("name", "").strip(),
                        label=row.get("label", "").strip(),
                        district_key=row.get("district_key", "").strip(),
                        district=row.get("district", "").strip(),
                        indicator=row.get("attribute_1", "").strip(),
                        attribute_2=row.get("attribute_2", "").strip(),
                        severity=severity,
                        latitude=float(row.get("latitude", "0") or 0),
                        longitude=float(row.get("longitude", "0") or 0),
                        source_file=row.get("source_file", "").strip(),
                    )
                )

                if len(batch) >= 500:
                    Location.objects.bulk_create(batch, ignore_conflicts=True)
                    created += len(batch)
                    batch = []

        if batch:
            Location.objects.bulk_create(batch, ignore_conflicts=True)
            created += len(batch)

        self.stdout.write(self.style.SUCCESS(f"Imported {created} locations from {csv_path.name}."))
