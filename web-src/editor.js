import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, lineNumbers, keymap, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";

const editorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--background)", color: "var(--ink)", fontSize: "13px" },
  ".cm-scroller": { fontFamily: "var(--mono)" },
  ".cm-gutters": { backgroundColor: "var(--panel)", color: "var(--muted)", borderRight: "1px solid var(--border)" },
  ".cm-cursor": { borderLeftColor: "var(--ink)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb,var(--accent) 7%,transparent)" },
});

// The macOS menu consumes Cmd+Z before CodeMirror can see the keydown.
export function editHistory(name) {
  const view = EditorView.findFromDOM(document.activeElement);
  if (view?.hasFocus) (name === "undo" ? undo : redo)(view);
  else document.execCommand(name);
}

export function createScratchEditor(parent, { state, text, label, isMarkdown, onChange, scrollTo }) {
  const view = new EditorView({
    parent, scrollTo,
    state: state || EditorState.create({
      doc: text,
      extensions: [
        EditorState.lineSeparator.of(text.match(/\r\n|\r|\n/)?.[0] || "\n"),
        isMarkdown ? markdown() : [], lineNumbers(), history(), highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle), EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of(update => { if (update.docChanged) onChange(update.state.sliceDoc()); }),
        EditorView.theme({
          "&": { backgroundColor: "var(--sheet)", fontSize: "12.5px" },
          ".cm-scroller": { overflow: "auto", lineHeight: "1.75" },
          ".cm-content": { padding: "12px 0" },
          ".cm-line": { padding: "0 12px" },
        }),
        editorTheme,
      ],
    }),
  });
  return {
    snapshot: () => ({ state: view.state, scrollTo: view.scrollSnapshot() }),
    destroy: () => view.destroy(),
  };
}

export function createFileEditor(parent, file, onSave, onChange) {
  const access = new Compartment();
  let editable = !file.partial && /\.(md|markdown|mdx)$/i.test(file.path);
  let original = file.content;
  const permissions = () => [EditorState.readOnly.of(!editable), EditorView.editable.of(editable)];
  const language = /\.(md|markdown|mdx)$/i.test(file.path) ? markdown() : /\.[cm]?[jt]sx?$/i.test(file.path) ? javascript({ typescript: /\.tsx?$/.test(file.path), jsx: /\.[jt]sx$/.test(file.path) }) : [];
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: file.content,
      extensions: [
        // Preserve disk line endings when CodeMirror serialises its normalised document.
        EditorState.lineSeparator.of(file.content.match(/\r\n|\r|\n/)?.[0] || "\n"),
        access.of(permissions()), language, lineNumbers(), history(), highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle), EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": "文件内容", tabindex: "0" }),
        keymap.of([{ key: "Mod-s", run: () => { onSave(); return true; } }, ...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of(update => { if (update.docChanged) onChange(); }),
        editorTheme,
      ],
    }),
  });
  return {
    get text() { return view.state.sliceDoc(); },
    get dirty() { return view.state.sliceDoc() !== original; },
    get editable() { return editable; },
    markSaved(content) { original = content; onChange(); },
    enable() { if (!file.partial) { editable = true; view.dispatch({ effects: access.reconfigure(permissions()) }); view.focus(); onChange(); } },
    goToLine(line) { const target = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, line))); view.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: "center" }) }); },
    destroy() { view.destroy(); },
  };
}
