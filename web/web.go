// Package web embeds the dashboard so the hub serves it from one binary.
package web

import (
	"embed"
	"io/fs"
)

//go:embed static
var content embed.FS

// Static returns the dashboard files, rooted at the static folder.
func Static() fs.FS {
	sub, err := fs.Sub(content, "static")
	if err != nil {
		panic(err)
	}
	return sub
}
