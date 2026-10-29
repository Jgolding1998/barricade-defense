const {chromium}=require(process.env.TOWER_PLAYWRIGHT || 'playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
const captures=process.env.TOWER_CAPTURE_DIR || path.join(ROOT,'work/browser');
fs.mkdirSync(captures,{recursive:true});
const child=spawn(process.env.TOWER_PYTHON || 'python',['-u','serve.py','--port','0'],{cwd:ROOT,windowsHide:true,stdio:['ignore','pipe','pipe']});
(async()=>{
 let browser;const receipt={checks:0,errors:[],external:[],desktop:{},touch:{}};
 const check=value=>{assert(value);receipt.checks++;};
 const number=async(page,id)=>Number(await page.locator('#'+id).innerText());
 async function clickCell(page,index,touch=false){const board=page.locator('#board');await board.scrollIntoViewIfNeeded();const box=await board.boundingBox();const x=box.x+(48+(index%16+.5)*54)/960*box.width;const y=box.y+(28+(Math.floor(index/16)+.5)*54)/610*box.height;if(touch)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);}
 async function frame(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
 try{
  const base=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error('Owned server did not start')),8000);child.stdout.on('data',data=>{out+=data;const found=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(found){clearTimeout(timer);resolve(found[0]);}});child.on('exit',()=>reject(new Error('Owned server exited early')));});
  browser=await chromium.launch({headless:true,...(process.env.TOWER_CHROME?{executablePath:process.env.TOWER_CHROME}:{}),args:['--mute-audio']});
  const audioContext=await browser.newContext();
  await audioContext.route('**/*',r=>{if(!r.request().url().startsWith(base+'/')){receipt.external.push('unexpected origin');return r.abort();}return r.continue();});
  await audioContext.addInitScript(()=>{
   const Native=AudioContext; globalThis.__audioStarts=0;
   globalThis.AudioContext=class extends Native{
    constructor(...args){super(...args);globalThis.__actualAudio=this;}
    createOscillator(){const node=super.createOscillator(),start=node.start.bind(node);node.start=(...args)=>{globalThis.__audioStarts++;return start(...args);};return node;}
   };
  });
  const audioPage=await audioContext.newPage(); audioPage.on('pageerror',e=>receipt.errors.push(e.message));
  await audioPage.goto(base+'/?run=extended');
  check(await audioPage.evaluate(()=>!globalThis.__actualAudio));
  await audioPage.locator('#sound').click();
  await audioPage.waitForFunction(()=>document.querySelector('#sound').getAttribute('aria-pressed')==='true');
  check(await audioPage.evaluate(()=>__actualAudio.state==='running'&&__audioStarts===1));
  check((await audioPage.locator('#sound-status').textContent()).includes('test tone'));
  receipt.offlineAudio=await audioPage.evaluate(async()=>{
   const {scheduleTone}=await import('/src/audio.js');const ctx=new OfflineAudioContext(1,24000,48000),master=ctx.createGain();master.gain.value=.4;master.connect(ctx.destination);
   scheduleTone(ctx,master,'triangle',660,660,.15,.18);
   const data=(await ctx.startRendering()).getChannelData(0);let sum=0,peak=0,tail=0;
   for(let i=0;i<data.length;i++){sum+=data[i]**2;peak=Math.max(peak,Math.abs(data[i]));if(i>12000)tail=Math.max(tail,Math.abs(data[i]));}
   return{rms:Math.sqrt(sum/data.length),peak,tail,physicalAudibilityTested:false};
  });
  check(receipt.offlineAudio.rms>.001&&receipt.offlineAudio.peak<1&&receipt.offlineAudio.tail===0);
  await audioPage.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await audioPage.waitForFunction(()=>__actualAudio.state==='suspended');
  await audioPage.evaluate(()=>{delete document.hidden;});await audioPage.locator('#restart').click();
  await audioPage.waitForFunction(()=>__actualAudio.state==='running');check(await audioPage.locator('#wave-target').textContent()==='/ 24');
  await audioPage.locator('#run-mode').selectOption('endless');
  check((await audioPage.locator('#run-mode-status').textContent()).includes('Start a new run to apply'));
  check(await audioPage.locator('#wave-target').textContent()==='/ 24');
  await audioPage.locator('#restart').click();check(await audioPage.locator('#wave-target').textContent()==='/ endless');
  await audioPage.locator('#sound').click();await audioPage.waitForFunction(()=>__actualAudio.state==='suspended');
  check(await audioPage.locator('#sound').getAttribute('aria-pressed')==='false');
  await audioContext.close();
  const blocked=await browser.newContext();
  await blocked.addInitScript(()=>{globalThis.AudioContext=class{constructor(){throw Error('Denied');}};});
  const unavailable=await blocked.newPage();await unavailable.goto(base+'/');await unavailable.locator('#sound').click();
  check(await unavailable.locator('#sound').textContent()==='Sound unavailable');check(await unavailable.locator('#sound').getAttribute('aria-pressed')==='false');
  await unavailable.locator('#launch').click();check(await number(unavailable,'wave')===1);await blocked.close();
  for(const mobile of [false,true]){
   const context=await browser.newContext({viewport:{width:mobile?390:1365,height:900},hasTouch:mobile,isMobile:mobile,deviceScaleFactor:mobile?2:1,reducedMotion:'reduce'});
   const page=await context.newPage();page.on('pageerror',e=>receipt.errors.push(e.message));
   await page.route('**/*',r=>{if(!r.request().url().startsWith(base+'/')){receipt.external.push(r.request().url());return r.abort();}return r.continue();});
   await page.goto(base+'/?seed=7129');await page.locator('[data-tool]').first().waitFor();
   check(await number(page,'credits')===170);check((await page.locator('#phase').innerText())==='PLANNING');
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(!mobile){
    await clickCell(page,49);check(await number(page,'credits')===125);
    await page.locator('#upgrade').click();check(await number(page,'credits')===93);check((await page.locator('#selection-title').innerText()).includes('LV 2'));
    await page.locator('#sell').click();check(await number(page,'credits')===139);
    await page.locator('[data-tool="wall"]').click();await clickCell(page,49);check(await number(page,'credits')===130);
    await page.locator('#launch').click();check(await number(page,'wave')===1);check(await page.locator('#sell').isDisabled());
    await page.locator('#board').focus();await page.keyboard.press('Space');check((await page.locator('#phase').innerText())==='PAUSED');
    await frame(page);const paused=await page.locator('#board').evaluate(el=>el.toDataURL());await page.waitForTimeout(200);await frame(page);check(await page.locator('#board').evaluate(el=>el.toDataURL())===paused);
    await page.keyboard.press('Space');check((await page.locator('#phase').innerText())==='LIVE WAVE');
    await page.locator('#speed').click();check((await page.locator('#speed').innerText()).includes('2'));
    await page.waitForFunction(()=>document.querySelector('#phase').textContent==='PLANNING',{},{timeout:45000});
    check(await number(page,'health')===11);check(await number(page,'credits')===153);
    await page.locator('#repair').click();check(await number(page,'health')===16);check(await number(page,'credits')===123);
    await page.locator('#sell').click();check(await number(page,'credits')===128);
    await page.locator('#restart').click();check(await number(page,'credits')===170);check(await number(page,'health')===20);check(await number(page,'wave')===0);
    await page.locator('#paths').focus();const old=await page.locator('#paths').innerText();await page.keyboard.press('Space');check((await page.locator('#paths').innerText())!==old);check((await page.locator('#phase').innerText())==='PLANNING');
    receipt.desktop={completedWave:1,leaks:9,repairRestored:5,finalResetCredits:170};
   }else{
    await clickCell(page,49,true);check(await number(page,'credits')===170);check((await page.locator('#message').innerText()).includes('Tap again'));
    await clickCell(page,49,true);check(await number(page,'credits')===125);
    await clickCell(page,49,true);check(await number(page,'credits')===125);
    await page.locator('[data-tool="cannon"]').tap();await clickCell(page,50,true);check(await number(page,'credits')===125);
    await clickCell(page,50,true);check(await number(page,'credits')===40);check(await page.locator('#upgrade').isDisabled());
    const board=page.locator('#board');await board.scrollIntoViewIfNeeded();const box=await board.boundingBox();const wrap=page.locator('.canvas-wrap');const wb=await wrap.boundingBox();
    const session=await context.newCDPSession(page);const x=wb.x+wb.width*.8,y=box.y+box.height*.5;
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let step=1;step<=5;step++){await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-step*28,y}]});await page.waitForTimeout(25);}
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(150);
    const scrollLeft=await wrap.evaluate(el=>el.scrollLeft);check(scrollLeft>0);check(await number(page,'credits')===40);
    receipt.touch={firstTapPreviews:true,secondTapBuilds:true,repeatInspectionFree:true,horizontalPan:scrollLeft,panDidNotBuild:true};
   }
   check(await page.evaluate(()=>localStorage.length===0&&sessionStorage.length===0));
   await page.evaluate(()=>window.scrollTo(0,0));await frame(page);await page.screenshot({path:path.join(captures,mobile?'touch-play.png':'desktop-play.png'),fullPage:true});
   await page.goto(base+'/?seed=%3Cscript%3Ewindow.__seedInjected%3Dtrue%3C%2Fscript%3E');await page.locator('[data-tool]').first().waitFor();
   check(await page.evaluate(()=>window.__seedInjected===undefined));check(await number(page,'credits')===170);
   await context.close();
  }
  check(receipt.errors.length===0);check(receipt.external.length===0);
 }finally{if(browser)await browser.close();child.kill();fs.writeFileSync(path.join(captures,'browser-play.json'),JSON.stringify(receipt,null,2)+'\n');}
 console.log(JSON.stringify(receipt,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
