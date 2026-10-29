import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../src/extension.ts";
import { startConsole } from "../src/server.ts";

test("/review launches the installed app with a single-instance session handoff", async () => {
  const directory=await mkdtemp(join(tmpdir(),"review-entry-"));
  const root=join(directory,"repo"),app=join(directory,"Review Console.app");
  await mkdir(root);await mkdir(join(app,"Contents/MacOS"),{recursive:true});await writeFile(join(app,"Contents/MacOS/ReviewConsole"),"");
  const service=await startConsole({directory,token:"entry-test"});
  await writeFile(join(directory,"service.json"),JSON.stringify({origin:service.origin,token:service.token,pid:process.pid}));
  const previous={state:process.env.REVIEW_CONSOLE_STATE,app:process.env.REVIEW_CONSOLE_APP};
  process.env.REVIEW_CONSOLE_STATE=directory;process.env.REVIEW_CONSOLE_APP=app;
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const handlers = new Map<string, () => Promise<void>>();
  const calls: [string, string[], unknown][] = [];
  extension({
    on: (name: string, fn: () => Promise<void>) => handlers.set(name, fn),
    registerCommand: (name: string, value: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, value),
    exec: async (command: string, args: string[], options: unknown) => { calls.push([command, args, options]); return { code: 0 }; },
    sendUserMessage: () => { throw new Error("No live session input in this test"); },
  } as never);
  const ctx={cwd:root,isIdle:()=>true,sessionManager:{getSessionId:()=>"entry-session",getSessionFile:()=>undefined,getSessionName:()=>"Entry fixture",getBranch:()=>[]},ui:{notify:()=>{throw new Error("Unexpected launch error")}}};
  try {
    await commands.get("review")!.handler("",ctx);
    assert.equal(calls.length,1);assert.equal(calls[0][0],"open");
    assert.deepEqual(calls[0][1].slice(0,4),["-n","-a",app,"--args"]);
    const target=new URL(calls[0][1][4]);
    assert.equal(target.origin,service.origin);
    assert.equal(new URLSearchParams(target.hash.slice(1)).get("session"),"entry-session");
    assert.equal(calls[0][1][5],`--node=${process.execPath}`);
  } finally {
    await handlers.get("session_shutdown")!();await service.close();
    if(previous.state===undefined)delete process.env.REVIEW_CONSOLE_STATE;else process.env.REVIEW_CONSOLE_STATE=previous.state;
    if(previous.app===undefined)delete process.env.REVIEW_CONSOLE_APP;else process.env.REVIEW_CONSOLE_APP=previous.app;
  }
});
