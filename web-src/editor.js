import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, lineNumbers, keymap, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";

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
        access.of(permissions()), language, lineNumbers(), history(), highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle), EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": "文件内容", tabindex: "0" }),
        keymap.of([{ key: "Mod-s", run: () => { onSave(); return true; } }, ...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of(update => { if (update.docChanged) onChange(); }),
        EditorView.theme({
          "&": { height: "100%", backgroundColor: "var(--background)", color: "var(--ink)", fontSize: "13px" },
          ".cm-scroller": { fontFamily: "var(--mono)" },
          ".cm-gutters": { backgroundColor: "var(--panel)", color: "var(--muted)", borderRight: "1px solid var(--border)" },
          ".cm-cursor": { borderLeftColor: "var(--ink)" },
          ".cm-activeLine": { backgroundColor: "color-mix(in srgb,var(--accent) 7%,transparent)" },
        }),
      ],
    }),
  });
  return {
    get text() { return view.state.doc.toString(); },
    get dirty() { return view.state.doc.toString() !== original; },
    get editable() { return editable; },
    markSaved() { original = view.state.doc.toString(); onChange(); },
    enable() { if (!file.partial) { editable = true; view.dispatch({ effects: access.reconfigure(permissions()) }); view.focus(); onChange(); } },
    goToLine(line) { const target = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, line))); view.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: "center" }) }); },
    destroy() { view.destroy(); },
  };
}
