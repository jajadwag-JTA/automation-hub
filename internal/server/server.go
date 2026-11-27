// Package server is the HTTP API: catalogue, projects, workflows, runs, schedules.
package server

import (
	"encoding/json"
	"net/http"

	"hub/internal/projects"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// Run serves the API. Project folders are re-read on every request, so edits
// to projects/ show up without a restart.
func Run(listen, projectsDir string) error {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("GET /api/projects", func(w http.ResponseWriter, _ *http.Request) {
		list, err := projects.Load(projectsDir)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		for i := range list { // list view stays light: no readme, no workflow
			list[i].Readme = ""
			list[i].Workflow = nil
		}
		writeJSON(w, http.StatusOK, list)
	})

	mux.HandleFunc("GET /api/projects/{slug}", func(w http.ResponseWriter, r *http.Request) {
		p, status, msg := find(projectsDir, r.PathValue("slug"))
		if p == nil {
			writeError(w, status, msg)
			return
		}
		writeJSON(w, http.StatusOK, p)
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

	// TODO: /api/runs, /api/schedules (all behind a bearer token)
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
