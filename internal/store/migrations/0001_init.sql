CREATE TABLE projects (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug       text UNIQUE NOT NULL,
    title      text NOT NULL,
    about      text NOT NULL DEFAULT '',
    kind       text NOT NULL DEFAULT 'external',   -- managed | external
    status     text NOT NULL DEFAULT 'idea',       -- idea | building | live | paused | retired
    owner      text NOT NULL DEFAULT '',
    tags       text[] NOT NULL DEFAULT '{}',
    links      jsonb NOT NULL DEFAULT '{}',
    readme     text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflows (
    project_id bigint NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    version    integer NOT NULL,
    definition jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, version)
);

CREATE TABLE schedules (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id bigint NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    cron       text NOT NULL,
    timezone   text NOT NULL DEFAULT 'UTC',
    params     jsonb NOT NULL DEFAULT '{}',
    enabled    boolean NOT NULL DEFAULT true
);

CREATE TABLE runs (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id  bigint NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    trigger     text NOT NULL,
    status      text NOT NULL,
    started_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    summary     jsonb,
    error       text
);

CREATE TABLE run_events (
    id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id  bigint NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    at      timestamptz NOT NULL DEFAULT now(),
    level   text NOT NULL,
    subject text NOT NULL DEFAULT '',
    details jsonb
);
