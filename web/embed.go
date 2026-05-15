package web

import (
	"embed"
	"io/fs"
	"log"
)


//go:embed all:frontend/dist
var distFS embed.FS

// FrontendFS returns the embedded React build rooted at frontend/dist, or nil if no build is present.
func FrontendFS() fs.FS {

	sub, err := fs.Sub(distFS, "frontend/dist")

	if err != nil {

		log.Printf("web: frontend bundle missing: %v", err)

		return nil

	}

	if _, err := fs.Stat(sub, "index.html"); err != nil {

		log.Printf("web: frontend bundle has no index.html: %v", err)

		return nil

	}

	return sub

}
