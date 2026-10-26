package zipax

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// Claim-token file lives next to the scanner's vault state.
// 0600 permissions, randomly generated once per laptop per user.
const claimFilename = "zipax-claim-token"

// claimDir is overridable in tests.
var claimDir = func(home string) string {
	return filepath.Join(home, ".zinloop")
}

// loadOrCreateClaimToken returns the base64url token the scanner should
// upload with each run. The token is created on first use with 32 random
// bytes and 0600 perms. Returns "" and no error when the home directory
// cannot be used (missing or unwritable) — the caller treats that as
// "no claim this run".
func loadOrCreateClaimToken(home string) (string, error) {
	if home == "" {
		return "", nil
	}
	dir := claimDir(home)
	path := filepath.Join(dir, claimFilename)
	b, err := os.ReadFile(path)
	if err == nil {
		tok := strings.TrimSpace(string(b))
		if validClaimTokenShape(tok) {
			return tok, nil
		}
		// Malformed file (truncated, replaced). Replace it rather than
		// uploading nothing — a wipe is cheap for the owner (another
		// claim visit) and the old token stays unreachable.
	} else if !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	tok := base64.RawURLEncoding.EncodeToString(buf)
	// 0600, overwrite atomically via a temp file so a reader never sees
	// a half-written token.
	tmp, err := os.CreateTemp(dir, "token-*")
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()
	if _, err := tmp.WriteString(tok + "\n"); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return "", err
	}
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return "", err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return "", err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return "", err
	}
	return tok, nil
}

func validClaimTokenShape(tok string) bool {
	if len(tok) < 43 || len(tok) > 128 {
		return false
	}
	for _, r := range tok {
		switch {
		case r >= 'A' && r <= 'Z':
		case r >= 'a' && r <= 'z':
		case r >= '0' && r <= '9':
		case r == '-' || r == '_':
		default:
			return false
		}
	}
	return true
}

// ClaimForUpload is the per-dev identity-claim block the scanner adds to
// its Zipax upload: the hashed user id and the raw token (the console
// hashes the token on receipt and stores only the hash).
type ClaimForUpload struct {
	UserHash   string `json:"userHash"`
	ClaimToken string `json:"claimToken"`
}

// LoadClaim returns the upload block + the claim URL the CLI prints.
// Returns ("", "", nil) with a non-nil error only on something hard like
// a filesystem write failure; a missing home directory just returns an
// empty block.
func LoadClaim(env Env, consoleBase string) (*ClaimForUpload, string, error) {
	if env.Home == "" {
		return nil, "", nil
	}
	tok, err := loadOrCreateClaimToken(env.Home)
	if err != nil || tok == "" {
		return nil, "", err
	}
	userHash := hashUser(env.Username, env.Hostname)
	url := ""
	if consoleBase != "" {
		base := strings.TrimRight(consoleBase, "/")
		// If the console base is the upload URL, trim the /api/zipax/usage suffix.
		base = strings.TrimSuffix(base, "/api/zipax/usage")
		url = base + "/zipax/claim?token=" + tok
	}
	return &ClaimForUpload{UserHash: userHash, ClaimToken: tok}, url, nil
}
