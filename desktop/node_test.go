package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func fakeNode(t *testing.T, version string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "node")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nprintf '%s\\n' '"+version+"'\n"), 0755); err != nil {
		t.Fatal(err)
	}
	return path
}

func noShellNode(context.Context) (string, error) {
	return "", fmt.Errorf("shell 中没有 node")
}

func TestNodeUsesFirstSupportedCandidate(t *testing.T) {
	old := fakeNode(t, "v22.18.0")
	minimum := fakeNode(t, "v22.19.0")
	newer := fakeNode(t, "v24.1.0")
	path, err := resolveNode(context.Background(), "", []string{old, minimum, newer}, noShellNode)
	if err != nil || path != minimum {
		t.Fatalf("got %q, %v; want %q", path, err, minimum)
	}
}

func TestNodeExplicitPriority(t *testing.T) {
	environment := fakeNode(t, "v22.23.2")
	argument := fakeNode(t, "v24.1.0")
	pathNode := fakeNode(t, "v22.19.0")
	t.Setenv("PATH", filepath.Dir(pathNode))
	t.Setenv("REVIEW_CONSOLE_NODE", environment)
	path, err := findNode([]string{"http://127.0.0.1:1234/#token=test", "--node=" + argument})
	if err != nil || path != environment {
		t.Fatalf("got %q, %v; want environment Node %q", path, err, environment)
	}
	t.Setenv("REVIEW_CONSOLE_NODE", "")
	path, err = findNode([]string{"--node=" + argument})
	if err != nil || path != argument {
		t.Fatalf("got %q, %v; want argument Node %q", path, err, argument)
	}
}

func TestNodeFromPATH(t *testing.T) {
	node := fakeNode(t, "v22.19.0")
	t.Setenv("REVIEW_CONSOLE_NODE", "")
	t.Setenv("PATH", filepath.Dir(node))
	path, err := findNode(nil)
	if err != nil || path != node {
		t.Fatalf("got %q, %v; want PATH Node %q", path, err, node)
	}
}

func TestNodeExplicitFailureDoesNotFallBack(t *testing.T) {
	available := fakeNode(t, "v24.1.0")
	for name, explicit := range map[string]string{
		"missing": filepath.Join(t.TempDir(), "node"),
		"old":     fakeNode(t, "v22.18.0"),
	} {
		t.Run(name, func(t *testing.T) {
			path, err := resolveNode(context.Background(), explicit, []string{available}, noShellNode)
			if err == nil || path != "" || !strings.Contains(err.Error(), explicit) {
				t.Fatalf("invalid explicit Node must fail, got %q, %v", path, err)
			}
		})
	}
}

func TestNodeFailureIdentifiesOverrideAndHowToRemoveIt(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "node")
	t.Setenv("REVIEW_CONSOLE_NODE", missing)
	_, failure := findNode([]string{"--node=" + fakeNode(t, "v24.1.0")})
	if failure == nil {
		t.Fatal("expected an invalid environment override to fail")
	}
	for _, text := range []string{"配置来源：REVIEW_CONSOLE_NODE", "路径不存在", "unset REVIEW_CONSOLE_NODE", "launchctl unsetenv REVIEW_CONSOLE_NODE"} {
		if !strings.Contains(failure.detail, text) {
			t.Errorf("recovery instructions lack %q: %s", text, failure.detail)
		}
	}
	t.Setenv("REVIEW_CONSOLE_NODE", "")
	_, failure = findNode([]string{"--node=" + missing})
	if failure == nil || !strings.Contains(failure.detail, "配置来源：--node") || !strings.Contains(failure.detail, "移除 --node") {
		t.Fatalf("argument failure lacks its own recovery instructions: %v", failure)
	}
}

func TestNodeShellFallback(t *testing.T) {
	old := fakeNode(t, "v20.19.0")
	node := fakeNode(t, "v24.1.0")
	path, err := resolveNode(context.Background(), "", []string{old}, func(context.Context) (string, error) {
		return node, nil
	})
	if err != nil || path != node {
		t.Fatalf("got %q, %v; want shell Node %q", path, err, node)
	}
}

func TestNodeUnavailableExplainsRecovery(t *testing.T) {
	for name, candidate := range map[string]string{
		"missing": filepath.Join(t.TempDir(), "node"),
		"old":     fakeNode(t, "v22.18.0"),
	} {
		t.Run(name, func(t *testing.T) {
			path, err := resolveNode(context.Background(), "", []string{candidate}, noShellNode)
			if err == nil || path != "" {
				t.Fatalf("expected failure, got %q, %v", path, err)
			}
			for _, text := range []string{"22.19.0", "brew install node", "https://nodejs.org/zh-cn/download"} {
				if !strings.Contains(err.detail, text) {
					t.Errorf("error lacks %q: %v", text, err)
				}
			}
			if strings.Contains(err.detail, "登录 shell") {
				t.Error("shell diagnostics must not crowd the recovery instructions")
			}
			if !strings.Contains(err.diagnostic, "登录 shell") {
				t.Error("copyable diagnostics must retain shell failure details")
			}
			if name == "missing" && !strings.Contains(err.detail, "已经安装但未找到") {
				t.Error("missing Node must explain how to locate an existing installation")
			}
			if name == "old" && !strings.Contains(err.Error(), "v22.18.0") {
				t.Errorf("error must explain the rejected version: %v", err)
			}
		})
	}
}

func TestNodeProbeHonorsDeadline(t *testing.T) {
	path := filepath.Join(t.TempDir(), "node")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nexec /bin/sleep 10\n"), 0755); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := resolveNode(ctx, path, nil, noShellNode)
	if err == nil || !strings.Contains(err.Error(), "超时") {
		t.Fatalf("expected timeout, got %v", err)
	}
}
