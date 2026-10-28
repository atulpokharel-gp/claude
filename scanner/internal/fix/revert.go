package fix

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/atulpokharel-gp/zinloop-zipax/scanner/internal/vault"
)

// Backup is one backup directory as listed by Revertable.
type Backup struct {
	ID   string     // folder name under ~/.zinloop/backups/, e.g. "20261024-150000-3f9a1c2e"
	Dir  string     // absolute path to that folder
	Meta BackupMeta // decoded meta.json
}

// Revertable lists every backup under home's ~/.zinloop/backups/ that still
// has a readable meta.json. Entries without one are skipped so a leftover
// temp file never shows up as a restorable version.
func Revertable(home string) ([]Backup, error) {
	root := vault.BackupsDir(home)
	ents, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []Backup
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		dir := filepath.Join(root, e.Name())
		data, err := os.ReadFile(filepath.Join(dir, BackupMetaFile))
		if err != nil {
			continue
		}
		var m BackupMeta
		if err := json.Unmarshal(data, &m); err != nil {
			continue
		}
		out = append(out, Backup{ID: e.Name(), Dir: dir, Meta: m})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Meta.BackedUpAt.After(out[j].Meta.BackedUpAt) })
	return out, nil
}

// RevertOptions controls Revert.
type RevertOptions struct {
	Home  string
	Store vault.Store
	// Force skips the already-rotated check. Callers should set this only
	// after the user has confirmed they want the config pointed back at an
	// old key whose provider value may already have been revoked.
	Force bool
}

// Revert puts the original config file back where it was, removes the
// corresponding entries from the password store, and drops the backup
// directory. If any of the backup's keys were already rotated, it refuses
// unless opts.Force is set, because the restored config would then point at
// an old value the provider no longer accepts.
func Revert(b Backup, opts RevertOptions) error {
	if b.Meta.OriginalPath == "" {
		return fmt.Errorf("backup %s is missing the original path; restore the file by hand", b.ID)
	}
	state, err := vault.LoadState(opts.Home)
	if err != nil {
		return err
	}
	if !opts.Force {
		var rotated []string
		for _, ref := range b.Meta.Refs {
			if e, ok := state.Entries[ref]; ok && e.RotatedAt != nil {
				rotated = append(rotated, ref)
			}
		}
		if len(rotated) > 0 {
			sort.Strings(rotated)
			return fmt.Errorf("these keys were rotated after this backup was taken: %v. Reverting would point the config at values the provider has rejected; pass --force to revert anyway", rotated)
		}
	}

	backupFile := filepath.Join(b.Dir, filepath.Base(b.Meta.OriginalPath))
	data, err := os.ReadFile(backupFile)
	if err != nil {
		return fmt.Errorf("read backup %s: %w", backupFile, err)
	}

	info, statErr := os.Stat(b.Meta.OriginalPath)
	perm := os.FileMode(0o600)
	if statErr == nil {
		perm = info.Mode().Perm()
	}
	if err := vault.WriteFileAtomic(b.Meta.OriginalPath, data, perm); err != nil {
		return fmt.Errorf("restore %s: %w", b.Meta.OriginalPath, err)
	}

	// Only now do we touch the password store and the state record. If the
	// restore above failed, both are left as they were.
	var storeErrs []error
	for _, ref := range b.Meta.Refs {
		if err := opts.Store.Delete(ref); err != nil {
			storeErrs = append(storeErrs, fmt.Errorf("delete %s: %w", ref, err))
		}
		delete(state.Entries, ref)
	}
	if err := state.Save(opts.Home); err != nil {
		storeErrs = append(storeErrs, fmt.Errorf("save state: %w", err))
	}
	if err := os.RemoveAll(b.Dir); err != nil {
		storeErrs = append(storeErrs, fmt.Errorf("remove backup folder: %w", err))
	}
	if len(storeErrs) > 0 {
		return errors.Join(storeErrs...)
	}
	return nil
}
