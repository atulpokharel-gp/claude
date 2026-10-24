package discover

import "testing"

func TestIsLauncherNameAcceptsOldName(t *testing.T) {
	for _, c := range []string{"zinloop", "/usr/local/bin/zinloop", `C:\Tools\zinloop.exe`, "agentscan", `C:\Tools\AgentScan.exe`} {
		if !IsLauncherName(c) {
			t.Errorf("%q should be recognized", c)
		}
	}
	if IsLauncherName("other-tool") {
		t.Error("other-tool should not be recognized")
	}
}
