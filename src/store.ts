import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Project, Round, Session, Registration } from "./model.ts";

export class ConsoleError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export const key = (value: string) => createHash("sha256").update(value).digest("hex");

export class Store {
  projects: Project[] = [];
  sessions: Session[] = [];
  private writes = Promise.resolve();
  readonly directory: string;
  constructor(directory: string) { this.directory = directory; }
  async load() {
    await mkdir(join(this.directory, "rounds"), { recursive: true, mode: 0o700 });
    try {
      const state = JSON.parse(await readFile(join(this.directory, "index.json"), "utf8"));
      this.projects = state.projects;
      this.sessions = state.sessions.map((s: Session) => ({ ...s, state: "offline" }));
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  async persist() {
    const data = JSON.stringify({ projects: this.projects, sessions: this.sessions });
    const write = this.writes.then(async () => {
      const path = join(this.directory, "index.json");
      await writeFile(path + ".tmp", data, { mode: 0o600 });
      await rename(path + ".tmp", path);
    });
    this.writes = write.catch(() => {});
    await write;
  }
  async addProject(path: string) {
    if (typeof path !== "string" || !path) throw new ConsoleError("Enter a local directory");
    const root = await realpath(path);
    if (!(await stat(root)).isDirectory()) throw new ConsoleError("Not a directory");
    if (!this.projects.some(p => p.root === root)) {
      this.projects.push({ root, name: root.split("/").at(-1) || root });
      await this.persist();
    }
    return root;
  }
  session(id: string) {
    const session = this.sessions.find(s => s.id === id);
    if (!session || !this.projects.some(p => p.root === session.root)) throw new ConsoleError("Session unavailable", 404);
    return session;
  }
  async register(input: Registration) {
    if (!input || typeof input.sessionId !== "string" || !input.sessionId) throw new ConsoleError("Missing session identity");
    const root = await this.addProject(input.cwd);
    let session = this.sessions.find(s => s.id === input.sessionId);
    if (session && session.root !== root) throw new ConsoleError("Session and project do not match", 409);
    if (!session) {
      session = { id: input.sessionId, root, title: input.title || input.sessionId.slice(0, 8), rounds: [], state: "offline" };
      this.sessions.push(session);
    }
    session.file = input.file;
    session.title = input.title || session.title;
    await this.persist();
    return session;
  }
  async saveRound(round: Round) {
    const session = this.session(round.sessionId);
    if (!round.id || typeof round.id !== "string") throw new ConsoleError("Missing round identity");
    if (!["completed", "aborted", "error"].includes(round.outcome)) throw new ConsoleError("Unknown outcome");
    if (round.report && await realpath(round.report.cwd) !== session.root) throw new ConsoleError("Report and project do not match");
    const path = this.roundPath(round.sessionId, round.id);
    try {
      await writeFile(path, JSON.stringify(round), { flag: "wx", mode: 0o600 });
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    // Replays repair an index interrupted after the immutable body was saved.
    const saved: Round = JSON.parse(await readFile(path, "utf8"));
    if (!session.rounds.some(r => r.id === round.id)) {
      session.rounds.push({ id: saved.id, end: saved.end, outcome: saved.outcome, count: saved.report?.files.length || 0, notice: saved.notice });
      session.rounds.sort((a, b) => a.end - b.end);
      await this.persist();
    }
  }
  async round(sessionId: string, id: string): Promise<Round> {
    const session = this.session(sessionId);
    if (!session.rounds.some(r => r.id === id)) throw new ConsoleError("No readable report for this round", 404);
    return JSON.parse(await readFile(this.roundPath(sessionId, id), "utf8"));
  }
  private roundPath(session: string, id: string) {
    return join(this.directory, "rounds", key(session + "\0" + id) + ".json");
  }
}
