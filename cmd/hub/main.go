// Command hub is the automation hub: it serves the API and dashboard and runs projects.
package main

import (
	"fmt"
	"os"

	"hub/internal/runs"
	"hub/internal/server"
)

func main() {
	if len(os.Args) < 2 || os.Args[1] != "serve" {
		fmt.Fprintln(os.Stderr, "usage: hub serve [--listen addr]")
		os.Exit(2)
	}
	listen := "127.0.0.1:8080"
	if len(os.Args) == 4 && os.Args[2] == "--listen" {
		listen = os.Args[3]
	}
	dir := os.Getenv("HUB_PROJECTS_DIR")
	if dir == "" {
		dir = "projects"
	}
	data := os.Getenv("HUB_DATA_DIR")
	if data == "" {
		data = "data"
	}
	store, err := runs.Open(data)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := server.Run(listen, dir, store); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
