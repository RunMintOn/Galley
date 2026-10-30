package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDocumentSaveAndConflict(t *testing.T) {
	path := filepath.Join(t.TempDir(), "README.md")
	first, err := writeDocument(documentWrite{Path: path, Content: "# First\n"})
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(path, []byte("# External\n"), 0644)
	if _, err := writeDocument(documentWrite{Path: path, Content: "# Draft\n", Version: first.Version}); err == nil {
		t.Fatal("external edit must not be overwritten")
	}
	disk, _ := readDocument(path)
	if disk.Content != "# External\n" {
		t.Fatal(disk.Content)
	}
	saved, err := writeDocument(documentWrite{Path: path, Content: "# Draft\n", Version: disk.Version})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Content != "# Draft\n" || saved.Version == first.Version {
		t.Fatal(saved)
	}
}

func TestDocumentImagesAndRelativePreview(t *testing.T) {
	path := filepath.Join(t.TempDir(), "My notes.md")
	data := []byte("test image bytes")
	_, err := writeDocument(documentWrite{
		Path: path, Content: "![test](My%20notes.assets/photo.jpg)",
		Images: []imageAsset{{Name: "photo.jpg", Data: base64.StdEncoding.EncodeToString(data)}},
	})
	if err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(filepath.Join(filepath.Dir(path), "My notes.assets", "photo.jpg"))
	if err != nil || string(actual) != string(data) {
		t.Fatalf("%s %v", actual, err)
	}
	url, err := (Desktop{}).ReadImage(path, "My%20notes.assets/photo.jpg")
	if err != nil || !strings.HasPrefix(url, "data:image/jpeg;base64,") {
		t.Fatalf("%s %v", url, err)
	}
}

func TestSaveAsRebasesExistingImages(t *testing.T) {
	sources := []string{"images/photo.jpg", "<images/my photo.png>", "https://example.com/a.png", "attachment:abc"}
	actual := (Desktop{}).RebaseImagePaths("/work/docs/README.md", "/work/notes/Copy.md", sources)
	for i, expected := range []string{"../docs/images/photo.jpg", "<../docs/images/my%20photo.png>", "https://example.com/a.png", "attachment:abc"} {
		if actual[i] != expected {
			t.Fatalf("expected %s, got %s", expected, actual[i])
		}
	}
}
