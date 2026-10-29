import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
const directory=await mkdtemp(join(tmpdir(),"review-desktop-"));
const app=resolve("dist-desktop/Review Console.app/Contents/MacOS/ReviewConsole");
const socket=join(directory,"automation.sock"), state=join(directory,"state");
const log=await import("node:fs").then(fs=>fs.openSync(join(directory,"app.log"),"w"));
const child=spawn(app,[],{env:{...process.env,REVIEW_CONSOLE_STATE:state,REVIEW_CONSOLE_DESKTOP_TEST:"1",MYGO_AUTOMATION:socket},stdio:["ignore",log,log]});
const wait=async(fn)=>{let last;for(let i=0;i<100;i++){try{const v=await fn();if(v)return v;}catch(e){last=e;}await new Promise(r=>setTimeout(r,100));}throw last||new Error("desktop wait timed out")};
let connection, service;
try {
 connection=await wait(()=>new Promise((ok,no)=>{const s=net.createConnection(socket);s.once("connect",()=>ok(s));s.once("error",no)}));
 let buffer="", id=0; const pending=new Map();
 connection.on("data",chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf("\n"))>=0){const message=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);const entry=pending.get(message.id);if(entry){pending.delete(message.id);message.error?entry.reject(new Error(message.error.message)):entry.resolve(message.result);}}});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});connection.write(JSON.stringify({id:current,method,params})+"\n")});
 const evaluate=async(window,script)=>(await call("eval",{window,script})).value;
 service=await wait(async()=>JSON.parse(await readFile(join(state,"service.json"),"utf8")));
 const post=async(path,body)=>{const r=await fetch(service.origin+"/api/"+path,{method:"POST",headers:{Authorization:`Bearer ${service.token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});assert.ok(r.ok,await r.text())};
 const root=join(directory,"project");await mkdir(root);await writeFile(join(root,"note.md"),"# Desktop\n");
 await post("register",{cwd:root,sessionId:"desktop-test",title:"Desktop fixture"});await post("round",{id:"r1",sessionId:"desktop-test",outcome:"completed",end:1});
 const main=await wait(async()=>{const w=(await call("windows")).windows[0];return w&&await evaluate(w.id,"!!window.reviewDesktop")&&w});
 await call("menu",{window:main.id,path:["File","临时文档"]});
 const scratch=await wait(async()=>(await call("windows")).windows.find(w=>w.id!==main.id));
 await wait(()=>evaluate(scratch.id,"!!window.reviewDesktop"));
 await call("menu",{window:scratch.id,path:["File","新建 Markdown 标签"]});
 await wait(()=>evaluate(scratch.id,"document.querySelectorAll('[role=tab]').length===1"));
 const key=(text,modifiers="")=>execFileSync("osascript",["-e",`tell application "System Events"\n tell (first application process whose unix id is ${child.pid})\n set frontmost to true\n keystroke "${text}"${modifiers ? " using "+modifiers : ""}\n end tell\nend tell`],{timeout:10000});
 key("t","command down"); await wait(()=>evaluate(scratch.id,"document.querySelectorAll('[role=tab]').length===2"));
 key("w","command down"); await wait(()=>evaluate(scratch.id,"document.querySelectorAll('[role=tab]').length===1"));
 assert.equal(await evaluate(scratch.id,"document.querySelectorAll('[role=tab]').length"),1);
 await evaluate(scratch.id,`const ta=document.querySelector('#scratch-source');ta.value='# 中文内容';ta.dispatchEvent(new Event('input'));`);
 await wait(()=>evaluate(scratch.id,"document.querySelector('.scratch-preview h1')?.textContent === '中文内容'"));
 await call("menu",{window:scratch.id,path:["File","新建 Diff 标签"]});
 assert.equal(await evaluate(scratch.id,"document.querySelectorAll('[role=tab]').length"),2);
 key("1","command down");
 await wait(()=>evaluate(scratch.id,"!!document.querySelector('#scratch-source')"));
 assert.equal(await evaluate(scratch.id,"document.querySelector('#scratch-source').value"),"# 中文内容");
 await evaluate(scratch.id,"const ta=document.querySelector('#scratch-source');ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length)");
 key("x");await wait(()=>evaluate(scratch.id,"document.querySelector('#scratch-source').value.endsWith('x')"));

 // Native window close requests are intercepted even when beforeunload cannot help.
 await call("menu",{window:scratch.id,path:["File","关闭窗口"]});
 await wait(()=>execFileSync("osascript",["-e",`tell application "System Events" to tell (first application process whose unix id is ${child.pid}) to get exists sheet 1 of window "临时文档 · Review Console"`],{encoding:"utf8",timeout:5000}).trim()==="true");
 execFileSync("osascript",["-e",`tell application "System Events" to tell (first application process whose unix id is ${child.pid}) to click button "Cancel" of sheet 1 of window "临时文档 · Review Console"`],{timeout:5000});
 await new Promise(r=>setTimeout(r,200));
 await evaluate(scratch.id,"window.confirm=()=>false");
 await call("menu",{window:scratch.id,path:["File","关闭窗口"]});
 await new Promise(r=>setTimeout(r,400));
 assert.equal((await call("windows")).windows.length,2);
 const focus=service.origin+"/#"+new URLSearchParams({token:service.token,session:"desktop-test",root});
 execFileSync(app,[focus],{env:{...process.env,REVIEW_CONSOLE_STATE:state,REVIEW_CONSOLE_DESKTOP_TEST:"1",MYGO_AUTOMATION:""},timeout:10000});
 await wait(()=>evaluate(main.id,"document.querySelector('#sessions').value==='desktop-test'"));
 assert.equal((await call("windows")).windows.length,2);
 const shots=resolve("test-results/desktop");await mkdir(shots,{recursive:true});
 for(const [name,w] of [["review",main],["scratch",scratch]]){const png=await call("capture",{window:w.id});await writeFile(join(shots,name+".png"),Buffer.from(png.png,"base64"));}
 const memory=execFileSync("ps",["-o","rss=","-p",String(child.pid)],{encoding:"utf8"}).trim();
 await evaluate(scratch.id,"window.confirm=()=>true");
 await call("menu",{window:main.id,path:["File","退出应用"]});
 await wait(()=>child.exitCode!==null);
 assert.equal((await fetch(service.origin+"/health")).status,200,"退出外壳不停止后台服务");
 const result={passed:true,directory,screenshots:shots,shellRSSKiB:Number(memory),nativeMenu:true,nativeKeyboard:true,singleInstance:true,backgroundServiceSurvives:true};
 await writeFile(join(shots,"result.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {
 connection?.destroy();if(child.exitCode===null)child.kill("SIGKILL");
 if(service)await fetch(service.origin+"/api/shutdown",{method:"POST",headers:{Authorization:`Bearer ${service.token}`}}).catch(()=>{});
}
