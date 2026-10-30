export function imageData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function relativeFilePath(documentPath, source) {
  if (source.startsWith("/")) return decodeURIComponent(source.split(/[?#]/)[0]);
  return decodeURIComponent(new URL(source, "https://local/" + documentPath).pathname.slice(1));
}

export async function projectImage(api, root, documentPath, source) {
  const result = await api("image?" + new URLSearchParams({ root, path: relativeFilePath(documentPath, source) }));
  return result.url;
}
import { markdownLanguage } from "@codemirror/lang-markdown";

export async function rebaseImages(text, rebasePaths) {
  const references = [];
  markdownLanguage.parser.parse(text).iterate({
    enter(node) {
      if (node.name === "URL" && ["Image", "LinkReference"].includes(node.node.parent?.name)) references.push({ from: node.from, to: node.to });
    },
  });
  const paths = await rebasePaths(references.map(({ from, to }) => text.slice(from, to)));
  for (let i = references.length - 1; i >= 0; i--) {
    const { from, to } = references[i];
    text = text.slice(0, from) + paths[i] + text.slice(to);
  }
  return text;
}

