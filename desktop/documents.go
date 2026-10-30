package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"mime"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/egoist/mygo"
)

type document struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Version string `json:"version"`
}

func contentVersion(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func readDocument(path string) (document, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return document{}, err
	}
	return document{path, string(data), contentVersion(data)}, nil
}

func (Desktop) ReadDocument(path string) (document, error) { return readDocument(path) }

func (Desktop) PickDocuments(ctx context.Context) ([]document, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent: mygo.CallerWindow(ctx), Title: "Open Markdown", Multiple: true,
		Filters: []mygo.FileFilter{{Name: "Markdown", Extensions: []string{"md", "markdown", "mdx", "txt"}}},
	})
	if err != nil {
		return nil, err
	}
	docs := []document{}
	for _, path := range paths {
		doc, err := readDocument(path)
		if err != nil {
			return nil, err
		}
		docs = append(docs, doc)
	}
	return docs, nil
}

func (Desktop) PickSavePath(ctx context.Context, suggested string) (string, error) {
	return mygo.Dialog.Save(mygo.SaveDialogOptions{
		Parent: mygo.CallerWindow(ctx), Title: "Save Markdown", DefaultPath: suggested,
		CreateDirectories: true, Filters: []mygo.FileFilter{{Name: "Markdown", Extensions: []string{"md"}}},
	})
}

type imageAsset struct {
	Name string `json:"name"`
	Data string `json:"data"`
}

type documentWrite struct {
	Path    string       `json:"path"`
	Content string       `json:"content"`
	Version string       `json:"version"`
	Images  []imageAsset `json:"images"`
}

func writeDocument(input documentWrite) (document, error) {
	if input.Version != "" {
		disk, err := os.ReadFile(input.Path)
		if err != nil {
			return document{}, err
		}
		if contentVersion(disk) != input.Version {
			return document{}, fmt.Errorf("The file changed on disk")
		}
	}
	for _, img := range input.Images {
		data, err := base64.StdEncoding.DecodeString(img.Data)
		if err != nil {
			return document{}, err
		}
		// Images belong to the document's own resource directory.
		dir := strings.TrimSuffix(input.Path, filepath.Ext(input.Path)) + ".assets"
		target := filepath.Join(dir, filepath.Base(img.Name))
		if err := os.MkdirAll(dir, 0755); err != nil {
			return document{}, err
		}
		if err := os.WriteFile(target, data, 0644); err != nil {
			return document{}, err
		}
	}
	if err := os.WriteFile(input.Path, []byte(input.Content), 0644); err != nil {
		return document{}, err
	}
	return document{input.Path, input.Content, contentVersion([]byte(input.Content))}, nil
}

func (Desktop) WriteDocument(input documentWrite) (document, error) { return writeDocument(input) }

func (Desktop) RebaseImagePaths(sourcePath, targetPath string, sources []string) []string {
	result := make([]string, len(sources))
	for i, source := range sources {
		result[i] = source
		u, err := url.Parse(strings.Trim(source, "<>"))
		if err != nil || u.IsAbs() || strings.HasPrefix(source, "/") || strings.HasPrefix(source, "#") {
			continue
		}
		relative, err := filepath.Rel(filepath.Dir(targetPath), filepath.Join(filepath.Dir(sourcePath), u.Path))
		if err != nil {
			continue
		}
		u.Path = filepath.ToSlash(relative)
		result[i] = u.String()
		if strings.HasPrefix(source, "<") {
			result[i] = "<" + result[i] + ">"
		}
	}
	return result
}

func (Desktop) ReadImage(documentPath, source string) (string, error) {
	u, err := url.Parse(source)
	if err != nil {
		return "", err
	}
	decoded, err := url.PathUnescape(u.EscapedPath())
	if err != nil {
		return "", err
	}
	path := decoded
	if !filepath.IsAbs(path) {
		path = filepath.Join(filepath.Dir(documentPath), path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	kind := mime.TypeByExtension(strings.ToLower(filepath.Ext(path)))
	if !strings.HasPrefix(kind, "image/") {
		return "", fmt.Errorf("Not an image file")
	}
	return "data:" + kind + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func (Desktop) ConfirmClose(ctx context.Context, name string) (int, error) {
	result, err := mygo.Dialog.Message(mygo.MessageOptions{
		Parent: mygo.CallerWindow(ctx), Type: mygo.MessageQuestion, Title: "Save Changes",
		Message: "Save changes to \"" + name + "\"?", Detail: "Not saving will discard these changes.",
		Buttons: []string{"Save", "Don't Save", "Cancel"}, DefaultButton: 0, CancelButton: 2,
	})
	return result.Button, err
}

var pendingDocuments struct {
	sync.Mutex
	paths []string
}

func queueDocument(path string) {
	pendingDocuments.Lock()
	pendingDocuments.paths = append(pendingDocuments.paths, path)
	pendingDocuments.Unlock()
	mygo.App.WhenReady(func() {
		openScratch()
		w := scratch
		go func() {
			// The page also drains the queue after installing its bridge.
			_, _ = eval(w, "window.reviewDesktop?.openPending()")
		}()
	})
}

func (Desktop) PendingDocuments() []string {
	pendingDocuments.Lock()
	defer pendingDocuments.Unlock()
	paths := pendingDocuments.paths
	pendingDocuments.paths = nil
	return paths
}
