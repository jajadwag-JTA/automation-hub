// Package projects holds the project record and loads definitions from /projects.
package projects

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"

	"hub/internal/workflows"
)

// RunSpec says how the hub runs a managed project. The command is a list, not
// one string, so nothing is passed through a shell.
type RunSpec struct {
	Command []string `json:"command" yaml:"command"`
	Dir     string   `json:"dir,omitempty" yaml:"dir"`
	Timeout string   `json:"timeout,omitempty" yaml:"timeout"`
}

type Project struct {
	Slug     string              `json:"slug" yaml:"slug"`
	Title    string              `json:"title" yaml:"title"`
	About    string              `json:"about" yaml:"about"`
	Kind     string              `json:"kind" yaml:"kind"`     // managed (runs here) | external (catalogue only)
	Status   string              `json:"status" yaml:"status"` // idea | building | live | paused | retired
	Owner    string              `json:"owner" yaml:"owner"`
	Tags     []string            `json:"tags" yaml:"tags"`
	Links    map[string]string   `json:"links" yaml:"links"` // repo, dashboard, docs, ...
	Run      *RunSpec            `json:"run,omitempty" yaml:"run"`
	Readme   string              `json:"readme,omitempty" yaml:"-"`
	Workflow *workflows.Workflow `json:"workflow,omitempty" yaml:"-"`
}

var validKinds = map[string]bool{"managed": true, "external": true}
var validStatuses = map[string]bool{"idea": true, "building": true, "live": true, "paused": true, "retired": true}

// Load reads every projects/<slug>/ folder under dir. The folder name must
// match the slug in project.yaml.
func Load(dir string) ([]Project, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := []Project{}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		p, err := loadOne(filepath.Join(dir, e.Name()), e.Name())
		if err != nil {
			return nil, fmt.Errorf("project %q: %w", e.Name(), err)
		}
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Slug < out[j].Slug })
	return out, nil
}

func loadOne(path, folder string) (Project, error) {
	var p Project
	raw, err := os.ReadFile(filepath.Join(path, "project.yaml"))
	if err != nil {
		return p, err
	}
	if err := yaml.Unmarshal(raw, &p); err != nil {
		return p, fmt.Errorf("project.yaml: %w", err)
	}
	if p.Slug != folder {
		return p, fmt.Errorf("slug %q must match the folder name", p.Slug)
	}
	if p.Title == "" {
		return p, fmt.Errorf("title is required")
	}
	if p.Kind == "" {
		p.Kind = "external"
	}
	if p.Status == "" {
		p.Status = "idea"
	}
	if !validKinds[p.Kind] {
		return p, fmt.Errorf("kind %q must be managed or external", p.Kind)
	}
	if !validStatuses[p.Status] {
		return p, fmt.Errorf("status %q must be idea, building, live, paused or retired", p.Status)
	}
	if p.Kind == "managed" && (p.Run == nil || len(p.Run.Command) == 0) {
		return p, fmt.Errorf("a managed project needs run.command, a list like [py, script.py]")
	}
	if p.Run != nil && p.Run.Timeout != "" {
		if _, err := time.ParseDuration(p.Run.Timeout); err != nil {
			return p, fmt.Errorf("run.timeout %q must look like 30s, 5m or 1h", p.Run.Timeout)
		}
	}
	if p.Tags == nil {
		p.Tags = []string{}
	}
	if p.Links == nil {
		p.Links = map[string]string{}
	}

	wf, err := os.ReadFile(filepath.Join(path, "workflow.yaml"))
	if err == nil {
		var w workflows.Workflow
		if err := yaml.Unmarshal(wf, &w); err != nil {
			return p, fmt.Errorf("workflow.yaml: %w", err)
		}
		if err := w.Validate(); err != nil {
			return p, fmt.Errorf("workflow.yaml: %w", err)
		}
		p.Workflow = &w
	} else if !os.IsNotExist(err) {
		return p, err
	}

	rd, err := os.ReadFile(filepath.Join(path, "README.md"))
	if err == nil {
		p.Readme = string(rd)
	} else if !os.IsNotExist(err) {
		return p, err
	}
	return p, nil
}
