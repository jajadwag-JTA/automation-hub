// Package server is the HTTP API and the dashboard.
package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"hub/internal/projects"
	"hub/internal/runs"
	"hub/web"
)

// projectView is a project plus the result of its latest run.
type projectView struct {
	projects.Project
	LastRun *runs.Run `json:"last_run,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func withRun(p projects.Project, latest map[string]runs.Run) projectView {
	v := projectView{Project: p}
	if r, ok := latest[p.Slug]; ok {
		rr := r
		v.LastRun = &rr
	}
	return v
}

// Run serves the API and the dashboard. Project folders are re-read on every
// request, so edits to projects/ show up without a restart.
func Run(listen, projectsDir string, store *runs.Store) error {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// A light list. Add ?full=1 to include each workflow and README.
	mux.HandleFunc("GET /api/projects", func(w http.ResponseWriter, r *http.Request) {
		list, err := projects.Load(projectsDir)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		latest := store.Latest()
		full := r.URL.Query().Get("full") == "1"
		out := make([]projectView, 0, len(list))
		for _, p := range list {
			if !full {
				p.Readme = ""
				p.Workflow = nil
			}
			out = append(out, withRun(p, latest))
		}
		writeJSON(w, http.StatusOK, out)
	})

	mux.HandleFunc("GET /api/projects/{slug}", func(w http.ResponseWriter, r *http.Request) {
		p, status, msg := find(projectsDir, r.PathValue("slug"))
		if p == nil {
			writeError(w, status, msg)
			return
		}
		writeJSON(w, http.StatusOK, withRun(*p, store.Latest()))
	})

	mux.HandleFunc("GET /api/projects/{slug}/workflow", func(w http.ResponseWriter, r *http.Request) {
		p, status, msg := find(projectsDir, r.PathValue("slug"))
		if p == nil {
			writeError(w, status, msg)
			return
		}
		if p.Workflow == nil {
			writeError(w, http.StatusNotFound, "this project has no workflow.yaml")
			return
		}
		writeJSON(w, http.StatusOK, p.Workflow)
	})

	// Starts a run. The custom header makes a browser treat this as a
	// cross-site request that needs permission, so a random web page cannot
	// trigger your jobs just because the hub is open on localhost.
	mux.HandleFunc("POST /api/projects/{slug}/run", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Hub-Request") != "1" {
			writeError(w, http.StatusForbidden, "missing X-Hub-Request header")
			return
		}
		p, status, msg := find(projectsDir, r.PathValue("slug"))
		if p == nil {
			writeError(w, status, msg)
			return
		}
		if p.Run == nil || len(p.Run.Command) == 0 {
			writeError(w, http.StatusBadRequest, "this project has no run command, so it is only catalogued")
			return
		}
		timeout, _ := time.ParseDuration(p.Run.Timeout)
		run, err := store.Start(p.Slug, runs.Spec{Command: p.Run.Command, Dir: p.Run.Dir, Timeout: timeout}, "manual")
		if errors.Is(err, runs.ErrBusy) {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusAccepted, run)
	})

	mux.HandleFunc("GET /api/runs", func(w http.ResponseWriter, r *http.Request) {
		limit := 50
		if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 && n <= 200 {
			limit = n
		}
		writeJSON(w, http.StatusOK, store.List(r.URL.Query().Get("project"), limit))
	})

	mux.HandleFunc("GET /api/runs/{id}", func(w http.ResponseWriter, r *http.Request) {
		run, err := store.Get(r.PathValue("id"))
		if err != nil {
			writeError(w, http.StatusNotFound, "no run with that id")
			return
		}
		output, _ := store.Output(run.ID, 64*1024)
		writeJSON(w, http.StatusOK, struct {
			runs.Run
			Output string `json:"output"`
		}{run, output})
	})

	// The dashboard: everything that is not an API route.
	mux.Handle("GET /", http.FileServer(http.FS(web.Static())))

	return http.ListenAndServe(listen, mux)
}

func find(dir, slug string) (*projects.Project, int, string) {
	list, err := projects.Load(dir)
	if err != nil {
		return nil, http.StatusInternalServerError, err.Error()
	}
	for i := range list {
		if list[i].Slug == slug {
			return &list[i], http.StatusOK, ""
		}
	}
	return nil, http.StatusNotFound, "no project with slug " + slug
}
