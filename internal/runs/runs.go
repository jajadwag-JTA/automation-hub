// Package runs records every run of a project: a small JSON file for the details
// and a log file for the output, both under the data directory.
package runs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Run struct {
	ID         string     `json:"id"`
	Project    string     `json:"project"`
	Trigger    string     `json:"trigger"` // manual | schedule
	Status     string     `json:"status"`  // running | succeeded | failed | timed_out
	Command    []string   `json:"command"`
	StartedAt  time.Time  `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
	ExitCode   *int       `json:"exit_code,omitempty"`
	Error      string     `json:"error,omitempty"`
}

// Spec describes what to run. It comes from a project's run: section.
type Spec struct {
	Command []string
	Dir     string
	Timeout time.Duration
}

type Store struct {
	dir     string
	mu      sync.Mutex
	running map[string]string // project slug -> run id
}

var ErrBusy = errors.New("this project is already running")

// Open prepares <dir>/runs and marks any run left "running" by an earlier
// session as failed, because the hub that was running it has stopped.
func Open(dir string) (*Store, error) {
	runDir := filepath.Join(dir, "runs")
	if err := os.MkdirAll(runDir, 0o755); err != nil {
		return nil, err
	}
	s := &Store{dir: runDir, running: map[string]string{}}
	for _, r := range s.List("", 0) {
		if r.Status != "running" {
			continue
		}
		now := time.Now().UTC()
		r.Status = "failed"
		r.Error = "the hub stopped while this was running"
		r.FinishedAt = &now
		s.save(r)
	}
	return s, nil
}

func (s *Store) metaPath(id string) string { return filepath.Join(s.dir, id+".json") }
func (s *Store) logPath(id string) string  { return filepath.Join(s.dir, id+".log") }

func (s *Store) save(r Run) error {
	b, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.metaPath(r.ID) + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.metaPath(r.ID))
}

func (s *Store) release(slug string) {
	s.mu.Lock()
	delete(s.running, slug)
	s.mu.Unlock()
}

// Start launches the command in the background and returns right away with a
// run that is still "running". Only one run per project at a time.
func (s *Store) Start(slug string, spec Spec, trigger string) (Run, error) {
	if len(spec.Command) == 0 {
		return Run{}, errors.New("this project has no run command")
	}
	s.mu.Lock()
	if _, busy := s.running[slug]; busy {
		s.mu.Unlock()
		return Run{}, ErrBusy
	}
	now := time.Now().UTC()
	id := now.Format("20060102-150405.000") + "-" + slug
	r := Run{ID: id, Project: slug, Trigger: trigger, Status: "running", Command: spec.Command, StartedAt: now}
	s.running[slug] = id
	s.mu.Unlock()

	if err := s.save(r); err != nil {
		s.release(slug)
		return Run{}, err
	}
	logf, err := os.Create(s.logPath(id))
	if err != nil {
		s.release(slug)
		return Run{}, err
	}
	go s.execute(r, spec, logf)
	return r, nil
}

func (s *Store) execute(r Run, spec Spec, logf *os.File) {
	defer s.release(r.Project)
	defer logf.Close()

	timeout := spec.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Minute
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, spec.Command[0], spec.Command[1:]...)
	cmd.Dir = spec.Dir
	cmd.Stdout = logf
	cmd.Stderr = logf
	err := cmd.Run()

	end := time.Now().UTC()
	r.FinishedAt = &end
	switch {
	case ctx.Err() == context.DeadlineExceeded:
		r.Status = "timed_out"
		r.Error = "stopped after " + timeout.String()
	case err != nil:
		r.Status = "failed"
		r.Error = err.Error()
	default:
		r.Status = "succeeded"
	}
	if cmd.ProcessState != nil {
		code := cmd.ProcessState.ExitCode()
		r.ExitCode = &code
	} else if err != nil {
		fmt.Fprintf(logf, "could not start: %v\n", err)
	}
	s.save(r)
}

// Get reads one run by id.
func (s *Store) Get(id string) (Run, error) {
	var r Run
	if id == "" || strings.ContainsAny(id, `/\`) || strings.Contains(id, "..") {
		return r, os.ErrNotExist
	}
	b, err := os.ReadFile(s.metaPath(id))
	if err != nil {
		return r, err
	}
	err = json.Unmarshal(b, &r)
	return r, err
}

// List returns runs newest first. An empty project means all projects, and a
// limit of 0 means no limit.
func (s *Store) List(project string, limit int) []Run {
	out := []Run{}
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return out
	}
	names := []string{}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			names = append(names, strings.TrimSuffix(e.Name(), ".json"))
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(names)))
	for _, n := range names {
		r, err := s.Get(n)
		if err != nil {
			continue
		}
		if project != "" && r.Project != project {
			continue
		}
		out = append(out, r)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out
}

// Latest returns the most recent run of each project, keyed by project slug.
func (s *Store) Latest() map[string]Run {
	m := map[string]Run{}
	for _, r := range s.List("", 0) {
		if _, seen := m[r.Project]; !seen {
			m[r.Project] = r
		}
	}
	return m
}

// Output returns the last max bytes of a run's log.
func (s *Store) Output(id string, max int64) (string, error) {
	f, err := os.Open(s.logPath(id))
	if err != nil {
		return "", err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return "", err
	}
	var start int64
	if st.Size() > max {
		start = st.Size() - max
	}
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return "", err
	}
	b, err := io.ReadAll(f)
	return string(b), err
}
