// Package projects holds the project record and loads definitions from /projects.
package projects

type Project struct {
    Slug   string            `json:"slug" yaml:"slug"`
    Title  string            `json:"title" yaml:"title"`
    About  string            `json:"about" yaml:"about"`
    Kind   string            `json:"kind" yaml:"kind"`     // managed (runs here) | external (catalogue only)
    Status string            `json:"status" yaml:"status"` // idea | building | live | paused | retired
    Owner  string            `json:"owner" yaml:"owner"`
    Tags   []string          `json:"tags" yaml:"tags"`
    Links  map[string]string `json:"links" yaml:"links"` // repo, dashboard, docs, ...
}

// TODO: Load(dir) reads projects/<slug>/project.yaml + workflow.yaml + README.md
// TODO: Sync(db) upserts them so the repo stays the source of truth.
