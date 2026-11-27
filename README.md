# Automation Hub

One place for all your projects: what each does, its workflow, systems,
schedule, status and run history.

Layout:

    cmd/hub/                    entrypoint (serve)
    internal/projects           project record + loader
    internal/workflows          structured workflow model
    internal/runs               run history
    internal/scheduler          cron + one-off runs
    internal/server             HTTP API
    internal/store/migrations   SQL schema
    projects/<slug>/            project.yaml, workflow.yaml, README.md (source of truth)
    web/                        dashboard UI (later)
    docs/                       architecture, how to add a project

Run:

    copy .env.example .env      (fill in the secrets)
    docker compose up -d --build
    curl localhost:8080/healthz
