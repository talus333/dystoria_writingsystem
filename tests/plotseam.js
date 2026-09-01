/* plotseam.js — asserts the Plot grid's timeline column is ONE ground.
   Every painted surface in the column must be either transparent or exactly the
   page ground; the only allowed exceptions are the deliberately dark marks
   (the section diamond, the thread pill) and the gold spine. Run after any
   change to the .pl-* surfaces. */
const {chromium}=require('playwright');const path=require('path');
const FILE=process.argv[2]||'out.html';
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
let bad=[];
for(const theme of ['classic','ember']){
 const p=await b.newPage({viewport:{width:1440,height:900}});
 await p.route('**/*',r=>r.request().url().startsWith('file://')?r.continue():r.abort());
 await p.goto('file://'+path.join(__dirname,FILE),{waitUntil:'domcontentloaded'});await p.waitForTimeout(2000);
 await p.evaluate(t=>{const lf=document.getElementById('landingFrame');if(lf)lf.remove();
  document.querySelectorAll('[id^=tour],[id^=onb],#consentBar').forEach(e=>e.remove());
  document.body.classList.toggle('ember',t==='ember');
  try{ensureSession();while((state.frames||[]).length<2)addFrame();}catch(e){}},theme);
 await p.evaluate(()=>goMode('map'));await p.waitForTimeout(900);
 await p.evaluate(()=>{const t=[...document.querySelectorAll('.pl-segbtn')].find(x=>/^plot$/i.test(x.textContent.trim()));if(t)t.click();});
 await p.waitForTimeout(1500);
 const r=await p.evaluate(()=>{
  const ground=getComputedStyle(document.getElementById('planNarrative')||document.body).backgroundColor;
  const ALLOW=/pl-dia|pl-threadpill|pl-tag|pl-cat/;
  const out=[];
  document.querySelectorAll('[class*="pl-"]').forEach(el=>{
   const rc=el.getBoundingClientRect(); if(rc.width<8||rc.height<6||rc.top<160||rc.left>440) return;
   const cn=((el.className&&el.className.baseVal!==undefined?el.className.baseVal:el.className)||'')+'';
   if(ALLOW.test(cn)) return;
   const cs=getComputedStyle(el);
   const check=(what,v)=>{ if(v==='rgba(0, 0, 0, 0)'||v===ground) return;
     out.push(cn.trim().replace(/\s+/g,'.')+' '+what+'='+v); };
   check('bg', cs.backgroundColor);
   const pa=getComputedStyle(el,'::after'), pb=getComputedStyle(el,'::before');
   if(pa.content!=='none') check('::after', pa.backgroundColor);
   if(pb.content!=='none' && !/pl-scell2/.test(cn)) check('::before', pb.backgroundColor);
  });
  return {ground, bad:[...new Set(out)]};
 });
 if(r.bad.length) bad = bad.concat(r.bad.map(x=>theme+': '+x+'   (ground '+r.ground+')'));
 await p.close();
}
console.log(bad.length ? 'SEAM:\n  '+bad.join('\n  ') : 'plot column is one ground in both themes');
await b.close(); process.exit(bad.length?1:0);})();
