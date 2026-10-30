import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
const directory=await mkdtemp(join(tmpdir(),"review-desktop-"));
const app=resolve("dist-desktop-test/Review Console Test.app/Contents/MacOS/ReviewConsole");
const socket=join(directory,"automation.sock"), state=join(directory,"state");
const log=await import("node:fs").then(fs=>fs.openSync(join(directory,"app.log"),"w"));
const inputSource=(source?)=>execFileSync("swift",[resolve("test/input-source.swift"),...(source?[source]:[])],{encoding:"utf8",timeout:30000}).trim();
const previousInputSource=inputSource();
const child=spawn(app,[],{env:{...process.env,REVIEW_CONSOLE_STATE:state,REVIEW_CONSOLE_DESKTOP_TEST:"1",MYGO_AUTOMATION:socket},stdio:["ignore",log,log]});
const wait=async(fn)=>{let last;for(let i=0;i<100;i++){try{const v=await fn();if(v)return v;}catch(e){last=e;}await new Promise(r=>setTimeout(r,100));}throw last||new Error("desktop wait timed out")};
const imeSource=process.argv.find(arg=>arg.startsWith("--ime="))?.slice(6);
let connection, service, nativeIME=false;
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
 const system=script=>execFileSync("osascript",["-e",`tell application "System Events"\n tell (first application process whose unix id is ${child.pid})\n ${script}\n end tell\nend tell`],{encoding:"utf8",timeout:10000}).trim();
 await mkdir(join(directory,"picked"));const picked=await realpath(join(directory,"picked"));
 await call("menu",{window:main.id,path:["File","Review Console"]});
 await evaluate(main.id,"document.querySelector('#add-project').click()");
 await wait(()=>system('get exists sheet 1 of window "Review Console"')==="true");
 system('set frontmost to true\nkey code 53');
 await wait(()=>system('get exists sheet 1 of window "Review Console"')==="false");
 assert.equal(await evaluate(main.id,"document.querySelectorAll('.project').length"),1,"取消面板不添加项目或弹手输框");
 await evaluate(main.id,"document.querySelector('#add-project').click()");
 await wait(()=>system('get exists sheet 1 of window "Review Console"')==="true");
 system(`set frontmost to true\nkeystroke "g" using {command down, shift down}`);
 await wait(()=>system('get exists sheet 1 of sheet 1 of window "Review Console"')==="true");
 // AX fills the path atomically; rapid keystrokes can be dropped by the system's path completion.
 system(`set value of text field 1 of sheet 1 of sheet 1 of window "Review Console" to ${JSON.stringify(picked)}`);
 await wait(()=>system('get value of text field 1 of sheet 1 of sheet 1 of window "Review Console"')===picked);
 system('key code 36');
 await wait(()=>system('get exists sheet 1 of sheet 1 of window "Review Console"')==="false");
 system('click button "添加" of sheet 1 of window "Review Console"');
 await wait(()=>evaluate(main.id,"document.querySelectorAll('.project').length===2"));
 assert.ok(await evaluate(main.id,`[...document.querySelectorAll('.project')].some(el=>el.title===${JSON.stringify(picked)})`));
 await call("menu",{window:main.id,path:["File","Markdown Editor"]});
 const scratch=await wait(async()=>(await call("windows")).windows.find(w=>w.id!==main.id));
 await wait(()=>evaluate(scratch.id,"!!window.reviewDesktop"));
 const raiseScratch=async()=>system('set frontmost to true\nperform action "AXRaise" of window '+JSON.stringify(await evaluate(scratch.id,"document.title")));
 await call("menu",{window:scratch.id,path:["File","新建 Markdown 标签"]});
 await wait(()=>evaluate(scratch.id,"document.querySelectorAll('[role=tab]').length===1"));
 const key=async(text,modifiers="")=>{
  await raiseScratch();
  await wait(()=>evaluate(scratch.id,"document.hasFocus()"));
  system(`keystroke "${text}"${modifiers ? " using "+modifiers : ""}`);
 };
 // Plain keystrokes must not open an IME candidate window; restore the previous source at the end.
 inputSource("com.apple.keylayout.ABC");
 await key("t","command down"); await wait(()=>evaluate(scratch.id,"document.querySelectorAll('[role=tab]').length===2"));
 await key("w","command down"); await wait(()=>evaluate(scratch.id,"document.querySelectorAll('[role=tab]').length===1"));
 assert.equal(await evaluate(scratch.id,"document.querySelectorAll('[role=tab]').length"),1);
 await evaluate(scratch.id,`document.querySelector('#scratch-source .cm-content').focus();document.execCommand('insertText',false,'# 中文内容');`);
 await wait(()=>evaluate(scratch.id,"document.querySelector('.scratch-preview h1')?.textContent === '中文内容'"));
 assert.equal(await evaluate(scratch.id,"document.querySelectorAll('.cm-lineNumbers').length"),1);
 await call("menu",{window:scratch.id,path:["File","新建 Diff 标签"]});
 await wait(()=>evaluate(scratch.id,"document.querySelectorAll('[role=tab]').length===2"));
 await key("1","command down");
 await wait(()=>evaluate(scratch.id,"!!document.querySelector('#scratch-source')"));
 assert.equal(await evaluate(scratch.id,"document.querySelector('#scratch-source .cm-content').textContent"),"# 中文内容");
 await evaluate(scratch.id,"document.querySelector('#scratch-source .cm-content').focus()");
 await key("x");await wait(()=>evaluate(scratch.id,"document.querySelector('#scratch-source .cm-content').textContent.endsWith('x')"));
 await key("z","command down");await wait(()=>evaluate(scratch.id,"document.querySelector('#scratch-source .cm-content').textContent==='# 中文内容'"));
 await key("z","{command down, shift down}");await wait(()=>evaluate(scratch.id,"document.querySelector('#scratch-source .cm-content').textContent.endsWith('x')"));
 await call("menu",{window:scratch.id,path:["Edit","Undo"]});
 await wait(()=>evaluate(scratch.id,"document.querySelector('#scratch-source .cm-content').textContent==='# 中文内容'"));
 await call("menu",{window:scratch.id,path:["Edit","Redo"]});
 await wait(()=>evaluate(scratch.id,"document.querySelector('#scratch-source .cm-content').textContent.endsWith('x')"));
 const oldName=await evaluate(scratch.id,"document.querySelector('#scratch-name').value");
 await evaluate(scratch.id,"const title=document.querySelector('#scratch-name');title.focus();title.select();document.execCommand('insertText',false,'Renamed')");
 await call("menu",{window:scratch.id,path:["Edit","Undo"]});
 await wait(()=>evaluate(scratch.id,`document.querySelector('#scratch-name').value===${JSON.stringify(oldName)}`));
 if(imeSource){
  await call("menu",{window:scratch.id,path:["File","新建 Markdown 标签"]});
  await wait(()=>evaluate(scratch.id,"document.querySelectorAll('[role=tab]').length===3"));
  await evaluate(scratch.id,`document.querySelector('#scratch-source .cm-content').focus();window.imeEvents=[];window.imeComposing=false;for(const type of ['compositionstart','compositionupdate','compositionend'])document.addEventListener(type,e=>{imeComposing=type!=='compositionend';imeEvents.push({type,data:e.data})},true);`);
  await raiseScratch();
  await wait(()=>evaluate(scratch.id,"document.hasFocus()"));
  assert.equal(inputSource(imeSource),imeSource);
  // The first keystroke after a source switch can be consumed while the IME attaches.
  await new Promise(r=>setTimeout(r,500));
  const typePinyin=async text=>{for(const char of text){system(`keystroke "${char}"`);await new Promise(r=>setTimeout(r,100));}await wait(()=>evaluate(scratch.id,"imeComposing"));};
  await typePinyin("nihao");
  assert.equal(await evaluate(scratch.id,"document.activeElement.classList.contains('cm-content')"),true,"候选期间不能抢走编辑器焦点");
  system('keystroke space');
  await wait(()=>evaluate(scratch.id,"!imeComposing && /[\\u4e00-\\u9fff]/.test(document.querySelector('#scratch-source .cm-content').textContent)"));
  await typePinyin("nihao");system('keystroke "1"');
  await wait(()=>evaluate(scratch.id,"!imeComposing"));
  assert.equal(await evaluate(scratch.id,"document.querySelectorAll('[role=tab]').length"),3,"数字选词不得切换标签");
  await typePinyin("zhongwen");system('key code 36');
  await wait(()=>evaluate(scratch.id,"!imeComposing"));
  assert.equal(await evaluate(scratch.id,"document.querySelectorAll('#scratch-source .cm-line').length"),1,"候选确认不能额外插入换行");
  inputSource("com.apple.keylayout.ABC");
  const content=await evaluate(scratch.id,"document.querySelector('#scratch-source .cm-content').textContent");
  // CodeMirror may group consecutive compositions into one undo event.
  await call("menu",{window:scratch.id,path:["Edit","Undo"]});
  await wait(()=>evaluate(scratch.id,`document.querySelector('#scratch-source .cm-content').textContent!==${JSON.stringify(content)}`));
  await call("menu",{window:scratch.id,path:["Edit","Redo"]});
  await wait(()=>evaluate(scratch.id,`document.querySelector('#scratch-source .cm-content').textContent===${JSON.stringify(content)}`));
  await wait(()=>evaluate(scratch.id,`document.querySelector('.scratch-preview .markdown-body').textContent.includes(${JSON.stringify(content)})`));
  const shots=resolve("test-results/desktop");await mkdir(shots,{recursive:true});
  await writeFile(join(shots,"ime.json"),JSON.stringify({source:imeSource,events:await evaluate(scratch.id,"imeEvents"),content},null,2));
  nativeIME=true;
 }

 // Native window close requests are intercepted even when beforeunload cannot help.
 const sheets=action=>execFileSync("osascript",["-e",`tell application "System Events" to tell (first application process whose unix id is ${child.pid}) to ${action}`],{encoding:"utf8",timeout:5000}).trim();
 const retry=async(action)=>{for(let i=0;i<50;i++){try{return sheets(action)}catch{}await new Promise(r=>setTimeout(r,100))}throw new Error("窗口面板操作超时")};
 let scratchWindow=JSON.stringify(await evaluate(scratch.id,"document.title"));
 await call("menu",{window:scratch.id,path:["File","关闭窗口"]});
 // The modal sheet replaces the window's AX children for a moment; retry instead of assuming one frame.
 await wait(()=>sheets('get exists sheet 1 of window '+scratchWindow)==="true");
 await retry('click button "取消" of sheet 1 of window '+scratchWindow);
 await new Promise(r=>setTimeout(r,200));
 assert.equal((await call("windows")).windows.length,2);

 // Save only test content into the isolated fixture directory.
 await call("menu",{window:scratch.id,path:["File","新建 Markdown 标签"]});
 await evaluate(scratch.id,"document.querySelector('#scratch-source .cm-content').focus();document.execCommand('insertText',false,'# Native save')");
 scratchWindow=JSON.stringify(await evaluate(scratch.id,"document.title"));
 await call("menu",{window:scratch.id,path:["File","Save File"]});
 await wait(()=>sheets("get exists sheet 1 of window "+scratchWindow)==="true");
 system("set frontmost to true\nkey code 53");
 await wait(()=>sheets("get exists sheet 1 of window "+scratchWindow)==="false");
 assert.equal(await evaluate(scratch.id,"window.reviewDesktop.dirty()"),true,"取消保存不能丢失草稿");
 await call("menu",{window:scratch.id,path:["File","Save File"]});
 await wait(()=>sheets("get exists sheet 1 of window "+scratchWindow)==="true");
 system('set frontmost to true\nkeystroke "g" using {command down, shift down}');
 await wait(()=>sheets("get exists sheet 1 of sheet 1 of window "+scratchWindow)==="true");
 const canonicalRoot=await realpath(root);
 system("set value of text field 1 of sheet 1 of sheet 1 of window "+scratchWindow+" to "+JSON.stringify(canonicalRoot));
 system("key code 36");
 await wait(()=>sheets("get exists sheet 1 of sheet 1 of window "+scratchWindow)==="false");
 system("set value of text field 1 of sheet 1 of window "+scratchWindow+' to "native-save.md"');
 system("key code 36");
 const savedPath=join(root,"native-save.md");
 await wait(async()=>await readFile(savedPath,"utf8")==="# Native save");
 await evaluate(scratch.id,"document.querySelector('#scratch-source .cm-content').focus();document.execCommand('insertText',false,' saved')");
 await call("menu",{window:scratch.id,path:["File","Save File"]});
 await wait(async()=>(await readFile(savedPath,"utf8")).includes("saved"));

 const finderFile=join(root,"finder.md");
 await writeFile(finderFile,"# Finder document\n");
 execFileSync("open",["-a",resolve("dist-desktop-test/Review Console Test.app"),finderFile],{timeout:10000});
 await wait(()=>evaluate(scratch.id,"document.querySelector('#scratch-name')?.value==='finder.md'"));
 assert.equal(await evaluate(scratch.id,"document.querySelector('#scratch-source .cm-content').textContent"),"# Finder document");
 scratchWindow=JSON.stringify(await evaluate(scratch.id,"document.title"));
 const focus=service.origin+"/#"+new URLSearchParams({token:service.token,session:"desktop-test",root});
 execFileSync(app,[focus],{env:{...process.env,REVIEW_CONSOLE_STATE:state,REVIEW_CONSOLE_DESKTOP_TEST:"1",MYGO_AUTOMATION:""},timeout:10000});
 await wait(()=>evaluate(main.id,"document.querySelector('#sessions').value==='desktop-test'"));
 assert.equal((await call("windows")).windows.length,2);
 const shots=resolve("test-results/desktop");await mkdir(shots,{recursive:true});
 for(const [name,w] of [["review",main],["scratch",scratch]]){const png=await call("capture",{window:w.id});await writeFile(join(shots,name+".png"),Buffer.from(png.png,"base64"));}
 const memory=execFileSync("ps",["-o","rss=","-p",String(child.pid)],{encoding:"utf8"}).trim();
 const beforeZoom=await evaluate(main.id,"window.innerWidth");
 await call("menu",{window:main.id,path:["View","Zoom In"]});
 await wait(async()=>(await evaluate(main.id,"window.innerWidth"))<beforeZoom);
 await call("menu",{window:main.id,path:["View","Actual Size"]});
 await wait(async()=>(await evaluate(main.id,"window.innerWidth"))===beforeZoom);
 await call("menu",{window:main.id,path:["File","Quit Review Console"]});
 await wait(()=>{
  if(child.exitCode!==null)return true;
  if(sheets('get exists sheet 1 of window '+scratchWindow)==="true")sheets('click button "不保存" of sheet 1 of window '+scratchWindow);
  return false;
 });
 assert.equal((await fetch(service.origin+"/health")).status,200,"退出外壳不停止后台服务");
 const result={passed:true,directory,screenshots:shots,shellRSSKiB:Number(memory),nativeMenu:true,nativeKeyboard:true,nativeZoom:true,nativeFolderPicker:true,nativeFileSave:true,nativeFinderOpen:true,nativeIME,singleInstance:true,backgroundServiceSurvives:true};
 await writeFile(join(shots,"result.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {
 connection?.destroy();if(child.exitCode===null)child.kill("SIGKILL");
 if(service)await fetch(service.origin+"/api/shutdown",{method:"POST",headers:{Authorization:`Bearer ${service.token}`}}).catch(()=>{});
 inputSource(previousInputSource);
}
