// Package runs records every run of a project and its events (the audit trail).
package runs

import "time"

type Run struct {
	ID         int64
	Project    string
	Trigger    string // schedule | manual | webhook | external
	Status     string // running | succeeded | failed | skipped | cancelled
	StartedAt  time.Time
	FinishedAt *time.Time
	Summary    []byte // JSON
	Error      string
}

// TODO: Start / Finish / AddEvent. External projects can report runs via
//       POST /api/projects/{slug}/runs so the history covers everything.
