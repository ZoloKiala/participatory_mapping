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
- On Railway, set:
  - `DEBUG=false`
  - `ALLOWED_HOSTS=participatorymapping-production.up.railway.app,.up.railway.app`

## API Endpoints

- `GET /api/locations.geojson`  
  Query params: `district`, `indicator`, `severity_min`, `severity_max`, `q`, `limit`
- `GET /api/indicators`  
  Indicator frequency summary for current filters
- `GET /api/selections`  
  Submitted indicator selections summary
- `POST /selections/submit`  
  Submit indicator selection (`indicator`, optional `district`, optional `rationale`)
