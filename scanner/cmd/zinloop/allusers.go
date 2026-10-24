package main

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// skipProfiles are folders under the users directory that aren't real people.
var skipProfiles = map[string]bool{
	"public": true, "default": true, "default user": true, "all users": true,
	"defaultuser0": true, "wdagutilityaccount": true, "shared": true, "guest": true,
	"lost+found": true,
}

// defaultUsersDirs is where user profiles live on each OS.
func defaultUsersDirs(goos string) []string {
	switch goos {
	case "windows":
		drive := os.Getenv("SystemDrive")
		if drive == "" {
			drive = "C:"
		}
		return []string{drive + `\Users`}
	case "darwin":
		return []string{"/Users"}
	default:
		return []string{"/home", "/root"}
	}
}

// listProfiles returns every user home folder under dirs. A dir that is itself
// a home (like /root) is included when it exists. Symlinks are skipped so one
// profile isn't scanned twice.
func listProfiles(dirs []string) []string {
	var homes []string
	for _, d := range dirs {
		if filepath.Base(d) == "root" {
			if fi, err := os.Lstat(d); err == nil && fi.IsDir() {
				homes = append(homes, d)
			}
			continue
		}
		entries, err := os.ReadDir(d)
		if err != nil {
			continue
		}
		for _, e := range entries {
			name := e.Name()
			if !e.IsDir() || e.Type()&os.ModeSymlink != 0 || strings.HasPrefix(name, ".") || skipProfiles[strings.ToLower(name)] {
				continue
			}
			homes = append(homes, filepath.Join(d, name))
		}
	}
	sort.Strings(homes)
	return homes
}
