# PGIS Participatory Mapping App

This project is a Django application for participatory mapping and indicator selection using the extracted location dataset in `preloaded_locations.csv`.

## Setup

```bash
python -m venv pgis
./pgis/bin/python -m pip install -r requirements.txt
./pgis/bin/python manage.py migrate
./pgis/bin/python manage.py load_locations --csv preloaded_locations.csv --replace
```

## Run

```bash
./pgis/bin/python manage.py runserver
```

Open:
- `http://127.0.0.1:8000/` for the dashboard map + filters + indicator submissions
- `http://127.0.0.1:8000/admin/` for Django admin

## Environment Defaults

- Local development defaults to `DEBUG=true`.
- Railway defaults to `DEBUG=false`.
- Copy `.env.example` if you want explicit local env values.
- Local development uses SQLite by default.
- Railway uses Postgres when `DATABASE_URL` is present.
- On Railway, set:
  - `DEBUG=false`
  - `ALLOWED_HOSTS=participatorymapping-production.up.railway.app,.up.railway.app`

## Railway Deploy Notes

- Attach a PostgreSQL service to the app so Railway injects `DATABASE_URL`.
- The web process runs:
  - `python manage.py collectstatic --noinput`
  - `python manage.py migrate --noinput`
  - CSV preload with `python manage.py load_locations --if-empty`
  - `python -m gunicorn pgis_project.wsgi:application --bind 0.0.0.0:${PORT:-8000}`
- The CSV preload is idempotent at startup: it imports only when the `Location` table is empty.
- If the app still fails on Railway, check the latest deploy logs first. The most likely remaining issues are missing environment variables or a failed database attachment.

## API Endpoints

- `GET /api/locations.geojson`  
  Query params: `district`, `indicator`, `severity_min`, `severity_max`, `q`, `limit`
- `GET /api/indicators`  
  Indicator frequency summary for current filters
- `GET /api/selections`  
  Submitted indicator selections summary
- `POST /selections/submit`  
  Submit indicator selection (`indicator`, optional `district`, optional `rationale`)
