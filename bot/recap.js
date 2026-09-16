// Yukaya hourly performance ledger + PNG recap
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, 'performance.json');
const IMG = join(HERE, 'recap-latest.png');
function load(){try{return JSON.parse(readFileSync(FILE,'utf8'));}catch{return {signals:[],cycles:[]};}}
function save(x){writeFileSync(FILE,JSON.stringify(x));}
export function recordSignal({symbol,address,chain,entry,side='BUY',severity=0,source='volume'}){
 const d=load(); if(d.signals.some(x=>x.address===address&&Date.now()-x.at<86400000)) return;
 d.signals.push({symbol,address,chain,entry:Number(entry)||0,side,severity,source,at:Date.now()});
 d.signals=d.signals.filter(x=>Date.now()-x.at<7*86400000); save(d);
}
export function snapshotCycle(n){const d=load(); d.cycles.push({at:Date.now(),...n}); d.cycles=d.cycles.filter(x=>Date.now()-x.at<7*86400000); save(d);}
function f(n){return Number.isFinite(n)?n:0}
export function performance(results=[]){const d=load(), now=Date.now(); let wins=0,closed=0,pnl=0; const rows=[];
 for(const s of d.signals){const r=results.find(x=>(x.pair?.baseToken?.address||'').toLowerCase()===s.address.toLowerCase()); const px=r?.pair?.priceUsd; if(px==null||!s.entry) continue; const p=(px/s.entry-1)*100; pnl+=p; closed++; if(p>0) wins++; rows.push({...s,now:px,pnl:p});}
 return {rows:rows.sort((a,b)=>b.pnl-a.pnl),closed,wins,pnl,winrate:closed?wins/closed*100:0,signals:d.signals.length,cycles:d.cycles.length};
}
export async function renderRecap({results=[], cex=[], alerts=0}){
 const p=performance(results); const payload={date:new Date().toLocaleString('id-ID',{timeZone:'Asia/Makassar'}),alerts,cex:cex.slice(0,4),pnl:p,top:p.rows.slice(0,5),worst:p.rows.slice(-3).reverse()};
 const py=`import json
from PIL import Image,ImageDraw,ImageFont
x=json.loads(${JSON.stringify(JSON.stringify(payload))})
W,H=1200,900
im=Image.new('RGB',(W,H),(10,14,20)); d=ImageDraw.Draw(im)
def font(n,b=False):
 try:return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf'%('-Bold' if b else ''),n)
 except:return ImageFont.load_default()
def txt(s,xy,size=25,col=(225,232,240),b=False): d.text(xy,s,font=font(size,b),fill=col)
txt('YUKAYA  ·  HOURLY PERFORMANCE', (55,42),34,(120,220,180),True); txt(x['date']+' WITA', (58,88),20,(145,160,175))
d.line((55,130,1145,130),fill=(44,62,78),width=2)
p=x['pnl']; txt('SIGNAL PERFORMANCE', (58,160),22,(145,160,175),True)
txt('Alerts this hour  '+str(x['alerts']), (60,205),28); txt('Tracked signals  '+str(p['signals']), (380,205),28); txt('Win rate  '+(str(round(p['winrate']))+'%' if p['closed'] else '—'), (700,205),28,(120,220,180))
txt('Paper PnL  '+(('+' if p['pnl']>=0 else '')+str(round(p['pnl'],1))+'%'), (60,250),38,(120,220,180) if p['pnl']>=0 else (255,115,115),True)
txt('method: current price vs alert entry · not realized PnL', (60,300),18,(145,160,175))
d.line((55,335,1145,335),fill=(44,62,78),width=2)
txt('TOP TRACKED SIGNALS', (58,365),22,(145,160,175),True)
y=410
for r in x['top']:
 txt('$'+str(r['symbol'])+'  '+r['chain'].upper(),(65,y),24,(230,235,240),True); txt(('+' if r['pnl']>=0 else '')+str(round(r['pnl'],1))+'%',(500,y),24,(120,220,180) if r['pnl']>=0 else (255,115,115),True); txt('entry $'+str(round(r['entry'],8))+' → $'+str(round(r['now'],8)),(680,y),18,(170,180,190)); y+=42
if x['cex']:
 d.line((55,650,1145,650),fill=(44,62,78),width=2); txt('CEX VOLUME ANOMALIES', (58,680),22,(145,160,175),True); y=725
 for r in x['cex'][:3]: txt('$'+str(r.get('symbol','?')).upper()+'  vol/mc '+str(round(r.get('ratio',0),2))+'x  24h '+str(round(r.get('chg24',0),1))+'%',(65,y),22); y+=35
txt('Yukaya · NxrLabs', (960,850),18,(100,120,135))
im.save(${JSON.stringify(IMG)})`;
 await new Promise((resolve,reject)=>execFile('/home/ubuntu/.hermes/hermes-agent/venv/bin/python3',['-c',py],{timeout:30000},e=>e?reject(e):resolve())); return {path:IMG,performance:p};
}
