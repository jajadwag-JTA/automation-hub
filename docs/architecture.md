# Architecture
- `projects/<slug>/` is the source of truth: project.yaml, workflow.yaml, README.md.
- The hub syncs those files into Postgres at startup and on change.
- `managed` projects run inside the hub (scheduler + runner). `external` projects are
  catalogue entries that can still report runs through the API.
- The API serves the catalogue, workflows, runs and schedules to the UI.
