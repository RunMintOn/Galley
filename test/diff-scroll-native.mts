import assert from "node:assert/strict";
import { spawn, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import net from "node:net";

const exec = promisify(execFile);
export async function sampleNative(directory, referenceCSS, reference) {
  const socket = join(directory, "native.sock"), binary = join(directory, "scroll-wheel");
  await exec("swiftc", [resolve("test/scroll-wheel.swift"), "-o", binary]);
  const child = spawn(resolve("dist-desktop-test/Galley Test.app/Contents/MacOS/Galley"), [], {
    env: { ...process.env, REVIEW_CONSOLE_STATE: join(directory, "state"), REVIEW_CONSOLE_DESKTOP_TEST: "1", MYGO_AUTOMATION: socket },
    stdio: "ignore",
  });
  let connection, nativeService;
  const wait = async fn => {
    let last;
    for (let i=0;i<150;i++) { try { const value=await fn(); if(value)return value; } catch(error) { last=error; } await new Promise(r=>setTimeout(r,100)); }
    throw last || Error("native scroll setup timed out");
  };
  const result = { engine: "actual WKWebView", sourceCSS: reference || "working tree", directory, samples: [],
    note: "System pixel-scroll events into the isolated native app. rAF gaps are scheduling measurements, not hardware presentation FPS or a real touchpad measurement." };
  const label = process.argv.includes("--baseline") ? "before" : "after";
  try {
    connection = await wait(() => new Promise((ok,no) => {
      const s=net.createConnection(socket); s.once("connect",()=>ok(s)); s.once("error",no);
    }));
    let buffer="", id=0; const pending=new Map();
    connection.on("data", chunk => {
      buffer+=chunk; let at;
      while((at=buffer.indexOf("\n"))>=0) {
        const message=JSON.parse(buffer.slice(0,at)); buffer=buffer.slice(at+1);
        const p=pending.get(message.id); if(p) { pending.delete(message.id); message.error?p.reject(Error(message.error.message)):p.resolve(message.result); }
      }
    });
    const call=(method,params={}) => new Promise((resolve,reject) => { const current=++id; pending.set(current,{resolve,reject}); connection.write(JSON.stringify({id:current,method,params})+"\n"); });
    const main=await wait(async()=>{const w=(await call("windows")).windows[0];return w&&w;});
    const evaluate=async script=>(await call("eval",{window:main.id,script})).value;
    await wait(()=>evaluate("!!window.reviewDesktop && !document.body.classList.contains('booting')"));
    nativeService=JSON.parse(await readFile(join(directory,"state","service.json"),"utf8"));
    if(referenceCSS) await evaluate(`(()=>{const style=document.createElement('style');style.textContent=${JSON.stringify(referenceCSS)};document.head.append(style)})()`);
    const system=script => execFileSync("osascript",["-e",`tell application "System Events" to tell (first application process whose unix id is ${child.pid})\n${script}\nend tell`],{encoding:"utf8"}).trim();
    system('set frontmost to true');
    await evaluate("document.querySelector('#history-tab').click()");
    await wait(()=>evaluate("!!document.querySelector('.commit-card')"));
    await evaluate("document.querySelector('.workspace-file[data-path=\"long.ts\"]').click()");
    await wait(()=>evaluate("document.querySelectorAll('#content table.diff tr').length===5000"));
    const nativeBounds=system('return {position of window "Galley", size of window "Galley"}').match(/-?\d+/g).map(Number);
    const point=await evaluate(`(()=>{const r=document.querySelector('#content').getBoundingClientRect();return{x:${nativeBounds[0]}+r.x+r.width/2,y:${nativeBounds[1]+nativeBounds[3]}-innerHeight+r.y+r.height/2}})()`);
    result.window = await call("windows"); result.point=point;
    result.idle=await evaluate(`(async()=>{const frames=[];let previous;for(let i=0;i<40;i++)await new Promise(resolve=>requestAnimationFrame(now=>{if(previous)frames.push(now-previous);previous=now;resolve()}));frames.sort((a,b)=>a-b);return{p50:frames[19],p95:frames[37]}})()`);
    for (let run=0;run<2;run++) {
      await evaluate(`(async()=>{
        const content=document.querySelector('#content');content.scrollTop=0;
        await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const p=window.nativeScrollProbe={frames:[],positions:[],scrolls:0,trustedScrolls:0,added:0,removed:0,textChanges:0,start:performance.now(),first:content.querySelector('td.content')};
        p.onScroll=e=>{p.scrolls++;if(e.isTrusted)p.trustedScrolls++;};
        content.addEventListener('scroll',p.onScroll,{passive:true});
        p.observer=new MutationObserver(records=>{for(const r of records){p.added+=r.addedNodes.length;p.removed+=r.removedNodes.length;if(r.type==='characterData')p.textChanges++;}});
        p.observer.observe(content,{childList:true,subtree:true,characterData:true});
        let last;const tick=now=>{if(last)p.frames.push(now-last);last=now;p.positions.push(content.scrollTop);p.raf=requestAnimationFrame(tick);};p.raf=requestAnimationFrame(tick);
      })()`);
      await exec(binary,[String(point.x),String(point.y)],{timeout:15000});
      const sample=await evaluate(`(()=>{
        const p=nativeScrollProbe,c=document.querySelector('#content');cancelAnimationFrame(p.raf);p.observer.disconnect();
        c.removeEventListener('scroll',p.onScroll);
        const sorted=p.frames.sort((a,b)=>a-b);
        return {elapsed:performance.now()-p.start,frames:sorted.length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1),over25ms:sorted.filter(n=>n>25).length,scrolls:p.scrolls,trustedScrolls:p.trustedScrolls,added:p.added,removed:p.removed,textChanges:p.textChanges,preserved:p.first===c.querySelector('td.content'),maxScroll:Math.max(...p.positions),end:c.scrollTop,viewport:c.clientHeight,height:c.scrollHeight};
      })()`);
      result.samples.push(sample); console.log(JSON.stringify(sample));
    }
    for (const sample of result.samples) {
      // WebKit's async scrolling need not forward passive wheel events to JS.
      assert.ok(sample.trustedScrolls>0 && sample.maxScroll>5000 && sample.end<10, "原生滚动必须能够跟上往返手势并回到顶部");
      assert.equal(sample.added+sample.removed+sample.textChanges,0);
      assert.equal(sample.preserved,true);
      assert.ok(sample.p95<Math.max(25,result.idle.p50*1.5),"长 Diff 不得让绘制调度持续大幅落后于静态页面；这是独立运行的实机门槛，不是跨硬件帧率保证");
    }
    await call("menu",{window:main.id,path:["File","Quit Galley"]});
    await wait(()=>child.exitCode!==null);
  } finally {
    await mkdir("test-results/performance",{recursive:true});
    await writeFile(`test-results/performance/diff-scroll-wk-${label}.json`,JSON.stringify(result,null,2));
    connection?.destroy(); if(child.exitCode===null)child.kill("SIGTERM");
    nativeService ||= await readFile(join(directory,"state","service.json"),"utf8").then(JSON.parse).catch(()=>undefined);
    if(nativeService)await fetch(nativeService.origin+"/api/shutdown",{method:"POST",headers:{Authorization:`Bearer ${nativeService.token}`}}).catch(()=>{});
  }
}
