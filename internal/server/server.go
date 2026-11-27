// Package server is the HTTP API: catalogue, projects, workflows, runs, schedules.
package server

import (
	"encoding/json"
	"net/http"
)

func Run(listen string) error {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	// TODO: /api/projects, /api/projects/{slug}, /api/projects/{slug}/workflow,
	//       /api/runs, /api/schedules  (all behind a bearer token)
	return http.ListenAndServe(listen, mux)
}
