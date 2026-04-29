import { NexusDB, Symbol } from '../indexer/db';
import * as path from 'path';
import * as fs from 'fs';

// ── Nexus visual identity ─────────────────────────────────────────────────────
// Deep indigo space · Amber chrome · Orbital ring clusters · Symbol stars

const SYM_COLOR: Record<string, string> = {
  function:  '#34d399', // emerald
  method:    '#60a5fa', // sky-blue
  class:     '#f472b6', // rose
  variable:  '#a78bfa', // violet
  import:    '#94a3b8', // slate
};

const DIR_PALETTE = [
  '#f59e0b', // amber
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#ef4444', // red
  '#3b82f6', // blue
  '#f97316', // orange
  '#14b8a6', // teal
  '#e879f9', // fuchsia
  '#84cc16', // lime
  '#fb7185', // rose-light
];

export function generateHtml(db: NexusDB, projectRoot: string): string {
  const symbols  = db.getAllSymbols();
  const allEdges = db.getAllEdges();
  const stats    = db.getStats();

  const clientSyms = symbols.map(s => ({
    id:      s.id,
    name:    s.symbol_name,
    type:    s.symbol_type,
    file:    path.relative(projectRoot, s.file_path),
    absFile: s.file_path,
    line:    s.start_line,
    sig:     s.signature,
    doc:     s.docstring,
  }));
  const clientEdges = allEdges.map(e => ({ from: e.from_id, to: e.to_id, kind: e.edge_type }));

  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Nexus Graph</title>
<script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

:root{
  --bg:     #050418;
  --panel:  #080720;
  --rim:    #12104a;
  --text:   #dde6ff;
  --muted:  #2a2860;
  --amber:  #f59e0b;
  --dim:    #1a1840;
}

body{
  font-family:'SF Mono','Fira Code','Consolas',monospace;
  background:var(--bg);color:var(--text);
  height:100vh;display:flex;flex-direction:column;overflow:hidden;
}

/* Subtle star field */
body::before{
  content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
  background-image:
    radial-gradient(rgba(180,160,255,.18) 1px,transparent 1px),
    radial-gradient(rgba(255,200,100,.10) 1px,transparent 1px);
  background-size:40px 40px, 70px 70px;
  background-position:0 0, 20px 35px;
}

/* Thin scanline */
body::after{
  content:'';position:fixed;inset:0;pointer-events:none;z-index:9998;
  background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(80,60,180,.015) 2px,rgba(80,60,180,.015) 3px);
}

/* ── Chrome ──────────────────────────────────────────────────────────── */
header{
  position:relative;z-index:10;
  height:50px;padding:0 20px;
  background:rgba(8,7,32,.95);
  border-bottom:1px solid var(--rim);
  display:flex;align-items:center;gap:14px;flex-shrink:0;
}

header::after{
  content:'';position:absolute;bottom:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent,var(--amber),transparent);
  opacity:.5;
}

.logo{
  font-size:14px;font-weight:700;letter-spacing:3px;text-transform:uppercase;
  color:var(--amber);text-shadow:0 0 16px var(--amber);
  white-space:nowrap;
}
.logo em{color:#dde6ff;text-shadow:none;font-style:normal;letter-spacing:1px;font-weight:400;font-size:11px}

.chip{
  font-size:10px;letter-spacing:.5px;
  color:var(--muted);
  background:rgba(245,158,11,.06);
  border:1px solid var(--rim);
  padding:3px 9px;border-radius:99px;
}
.chip b{color:var(--amber);}

.ctrls{display:flex;gap:8px;margin-left:auto;align-items:center;}

input#srch{
  background:rgba(0,0,0,.4);
  border:1px solid var(--rim);
  color:var(--text);padding:5px 12px;
  border-radius:99px;font-size:11px;font-family:inherit;
  width:180px;outline:none;transition:border-color .2s,box-shadow .2s;
}
input#srch:focus{border-color:var(--amber);box-shadow:0 0 12px rgba(245,158,11,.2);}
input#srch::placeholder{color:var(--muted);}

.btn{
  background:rgba(245,158,11,.07);
  border:1px solid var(--rim);color:var(--muted);
  padding:5px 13px;border-radius:99px;
  font-size:10px;font-family:inherit;cursor:pointer;letter-spacing:.5px;
  transition:all .15s;white-space:nowrap;
}
.btn:hover{border-color:var(--amber);color:var(--amber);box-shadow:0 0 10px rgba(245,158,11,.2);}
.btn.active{border-color:var(--amber);color:var(--amber);}
.btn.hidden{display:none!important;}

/* ── Breadcrumb ──────────────────────────────────────────────────────── */
#bc{
  position:relative;z-index:10;
  height:27px;padding:0 20px;
  background:rgba(5,4,24,.9);border-bottom:1px solid var(--rim);
  display:flex;align-items:center;gap:5px;
  font-size:10px;color:var(--muted);letter-spacing:.5px;flex-shrink:0;
}
.bc-a{color:var(--amber);cursor:pointer;}.bc-a:hover{text-shadow:0 0 8px var(--amber);}
.bc-s{color:var(--muted);}
.bc-c{color:var(--text);}

/* ── Canvas ──────────────────────────────────────────────────────────── */
.main{display:flex;flex:1;overflow:hidden;position:relative;z-index:1;}
#graph{flex:1;background:transparent;}

/* ── Sidebar ─────────────────────────────────────────────────────────── */
#sb{
  width:270px;background:rgba(8,7,32,.97);
  border-left:1px solid var(--rim);
  display:flex;flex-direction:column;flex-shrink:0;overflow:hidden;
}
.sb-hd{
  padding:11px 15px;border-bottom:1px solid var(--rim);
  font-size:10px;font-weight:700;color:var(--muted);
  text-transform:uppercase;letter-spacing:1.5px;
}
#det{flex:1;overflow-y:auto;padding:14px 15px;font-size:11px;}
#det::-webkit-scrollbar{width:3px;}
#det::-webkit-scrollbar-thumb{background:var(--rim);border-radius:2px;}

.ph{color:var(--muted);line-height:1.9;font-size:10px;}

.dn{font-size:14px;font-weight:700;color:#fff;margin-bottom:6px;word-break:break-all;}
.dbadge{
  display:inline-block;font-size:9px;padding:2px 9px;border-radius:99px;
  font-weight:700;margin-bottom:10px;letter-spacing:1px;text-transform:uppercase;
}
.dpath{color:var(--muted);font-size:10px;margin-bottom:11px;word-break:break-all;}
.dsig{
  background:rgba(0,0,0,.5);border-left:2px solid var(--amber);
  padding:7px 10px;border-radius:0 4px 4px 0;
  font-size:10px;color:#fde68a;
  white-space:pre-wrap;word-break:break-all;margin-bottom:11px;
}
.ddoc{color:#86efac;font-size:10px;font-style:italic;
  border-left:2px solid rgba(134,239,172,.3);padding-left:8px;
  margin-bottom:11px;line-height:1.5;}
.dsec{font-size:9px;font-weight:700;color:var(--muted);
  text-transform:uppercase;letter-spacing:1px;margin:11px 0 5px;}
.cl{display:flex;flex-direction:column;gap:3px;}
.ci{background:rgba(0,0,0,.3);border:1px solid var(--rim);border-radius:4px;
  padding:5px 8px;font-size:10px;cursor:pointer;
  display:flex;align-items:center;gap:5px;transition:border-color .15s;}
.ci:hover{border-color:var(--amber);}
.ck{font-size:9px;padding:1px 5px;border-radius:99px;background:rgba(245,158,11,.1);color:var(--amber);flex-shrink:0;}
.cn{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cf{font-size:9px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:65px;}

/* Dir detail sidebar */
.fstats{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:11px;}
.fst{font-size:9px;padding:2px 7px;border-radius:99px;border:1px solid var(--rim);color:var(--muted);}
.fst b{color:var(--amber);}
.sl{display:flex;flex-direction:column;gap:2px;}
.si{
  border-left:2px solid transparent;
  background:rgba(0,0,0,.25);border-right:1px solid var(--rim);
  border-top:1px solid var(--rim);border-bottom:1px solid var(--rim);
  border-radius:0 4px 4px 0;padding:4px 9px;cursor:pointer;
  font-size:10px;color:var(--text);display:flex;align-items:center;gap:6px;
  transition:opacity .15s;
}
.si:hover{opacity:.75;}
.st{font-size:9px;text-transform:uppercase;flex-shrink:0;min-width:20px;}

/* ── Legend ───────────────────────────────────────────────────────────── */
.leg{padding:10px 15px;border-top:1px solid var(--rim);display:flex;flex-wrap:wrap;gap:7px;}
.li{display:flex;align-items:center;gap:4px;font-size:9px;color:var(--muted);}
.ld{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
</style>
</head>
<body>

<header>
  <div class="logo">NEXUS<em> graph</em></div>
  <div class="chip"><b>${stats.files}</b> files</div>
  <div class="chip"><b>${stats.symbols}</b> symbols</div>
  <div class="chip"><b>${stats.edges}</b> edges</div>
  <div class="ctrls">
    <input id="srch" type="text" placeholder="search…" autocomplete="off"/>
    <button class="btn hidden" id="btn-back" onclick="goBack()">← Overview</button>
    <button class="btn" onclick="resetView()">Fit</button>
  </div>
</header>
<div id="bc"></div>

<div class="main">
  <div id="graph"></div>
  <div id="sb">
    <div class="sb-hd" id="sbhd">Directories</div>
    <div id="det"><p class="ph">Click a ring to see its files.<br><br>Double-click to explore symbols inside.</p></div>
    <div class="leg" id="leg"></div>
  </div>
</div>

<script>
const SYMS   = ${JSON.stringify(clientSyms)};
const EDGES  = ${JSON.stringify(clientEdges)};
const SC     = ${JSON.stringify(SYM_COLOR)};
const DP     = ${JSON.stringify(DIR_PALETTE)};

// ── Lookups ──────────────────────────────────────────────────────────────────
const byId    = Object.fromEntries(SYMS.map(s=>[s.id,s]));
const byFile  = {};   // absFile → Symbol[]
const dirMap  = {};   // topDir  → absFile[]
SYMS.forEach(s=>{
  (byFile[s.absFile]=byFile[s.absFile]||[]).push(s);
  const d=s.file.split('/')[0];
  (dirMap[d]=dirMap[d]||[]).push(s.absFile);
});
// deduplicate dirMap file lists
Object.keys(dirMap).forEach(d=>{ dirMap[d]=[...new Set(dirMap[d])]; });

// Assign directory colors (stable)
const dirColor={};
let di=0;
Object.keys(dirMap).sort().forEach(d=>{ dirColor[d]=DP[di++%DP.length]; });

// ── vis-network ──────────────────────────────────────────────────────────────
const container=document.getElementById('graph');
const VN=new vis.DataSet([]), VE=new vis.DataSet([]);
const net=new vis.Network(container,{nodes:VN,edges:VE},{
  physics:{
    enabled:true,
    barnesHut:{gravitationalConstant:-12000,centralGravity:.05,springLength:180,springConstant:.025,damping:.45},
    stabilization:{iterations:300,updateInterval:20},
  },
  interaction:{hover:true,tooltipDelay:250,keyboard:true,navigationButtons:false,zoomSpeed:.4},
  layout:{improvedLayout:false},
});

// ── Pulsing ring on selection ─────────────────────────────────────────────────
let selId=null,pr=0,pd=1,pc='#f59e0b';
net.on('afterDrawing',ctx=>{
  if(!selId)return;
  try{
    const {x,y}=net.getPosition(selId);
    pr+=pd*.8; if(pr>20)pd=-1; if(pr<1)pd=1;
    ctx.beginPath();ctx.arc(x,y,18+pr,0,Math.PI*2);
    ctx.strokeStyle=pc+'45';ctx.lineWidth=2;ctx.stroke();
  }catch{}
  net.redraw();
});

// ── Directory neuron node (solid filled dot for overview) ─────────────────────
function dirNode(id,label,color,fileCount,syms,dirName){
  const sz=Math.max(28,Math.min(58,fileCount*2.8+16));
  return{
    id,label,shape:'dot',size:sz,
    color:{
      background:color,
      border:'rgba(255,255,255,0.18)',
      highlight:{background:color,border:'#fff'},
      hover:{background:color,border:'rgba(255,255,255,0.7)'},
    },
    shadow:{enabled:true,color:color+'bb',size:38,x:0,y:0},
    borderWidth:1,borderWidthSelected:2,
    font:{color:'#fff',size:12,face:"'SF Mono','Fira Code',monospace",strokeWidth:3,strokeColor:'#050418'},
    title:\`<div style="font:11px 'SF Mono',monospace;padding:10px 14px;background:#080720;border:1px solid \${color}55;border-radius:7px;color:#dde6ff;min-width:140px">
      <div style="font-weight:700;color:\${color};font-size:13px;margin-bottom:6px">\${dirName}/</div>
      <div style="color:#aab"><b style="color:#f59e0b">\${fileCount}</b> files</div>
      <div style="color:#aab"><b style="color:#f59e0b">\${syms}</b> symbols</div>
      <div style="margin-top:6px;color:#4a4870;font-size:9px">double-click to explore →</div>
    </div>\`,
    _dir:dirName,
  };
}

// ── Orbital ring node (circle for file nodes in detail view) ──────────────────
function ringNode(id,label,color,size,extra){
  return Object.assign({
    id,label,shape:'dot',size:20,
    color:{
      background:color+'55',
      border:color,
      highlight:{background:color+'88',border:'#fff'},
      hover:{background:color+'88',border:'rgba(255,255,255,.7)'},
    },
    shadow:{enabled:true,color:color+'88',size:28,x:0,y:0},
    borderWidth:2,borderWidthSelected:3,
    font:{color:'#fff',size:size||11,face:"'SF Mono','Fira Code',monospace",strokeWidth:2,strokeColor:'#050418'},
  },extra||{});
}

// ── Symbol star node ──────────────────────────────────────────────────────────
function starNode(s,dim){
  const c=SC[s.type]||'#94a3b8';
  const bc=dim?c+'30':c;
  const sz=dim?6:(s.type==='class'?16:10);
  const short=s.name.split('.').pop().slice(0,18);
  return {
    id:s.id,label:dim?'':short,
    shape:'dot',size:sz,
    color:{background:'#060520',border:bc,highlight:{background:'#0b0d3a',border:c},hover:{background:'#0b0d3a',border:c}},
    shadow:{enabled:!dim,color:c+'50',size:dim?3:14,x:0,y:0},
    borderWidth:dim?1:1.5,borderWidthSelected:2.5,
    font:{color:dim?'transparent':c,size:10,face:"'SF Mono','Fira Code',monospace"},
    opacity:dim?.3:1,
    title:\`<div style="font:11px 'SF Mono',monospace;padding:7px 11px;background:#060520;border:1px solid \${c}40;border-radius:5px;color:#dde6ff">
      <b style="color:\${c}">\${s.name}</b> <span style="color:#2a2860">[\${s.type}]</span><br>
      \${s.file}:\${s.line}
      \${s.sig?'<br><code style="color:#fde68a;font-size:10px">'+s.sig.replace(/</g,'&lt;').slice(0,80)+'</code>':''}
    </div>\`,
    _sym:true,
  };
}

function slimEdge(color,dim,label){
  return{
    color:{color:dim?color+'12':color+'28',highlight:color+'bb',hover:color+'88'},
    width:dim?.5:1,
    arrows:{to:{enabled:true,scaleFactor:.35}},
    smooth:{type:'curvedCW',roundness:.1},
    font:{color:dim?'transparent':'#1a1840',size:9,align:'middle'},
    label:label||'',
  };
}

// ── State ─────────────────────────────────────────────────────────────────────
let VIEW='dirs', ACTIVE_DIR=null;

// ── LEVEL 0: directory overview ───────────────────────────────────────────────
function showDirs(){
  VIEW='dirs'; ACTIVE_DIR=null; selId=null;
  const dirs=Object.keys(dirMap).sort();
  const nodes=dirs.map(d=>{
    const files=dirMap[d];
    const syms=files.reduce((n,f)=>n+(byFile[f]?.length||0),0);
    return dirNode('dir_'+d,d,dirColor[d],files.length,syms,d);
  });

  // Cross-dir import edges (deduplicated, bright)
  const symToDir={};
  SYMS.forEach(s=>symToDir[s.id]=s.file.split('/')[0]);
  const seen=new Set(), edges=[];
  EDGES.forEach((e,i)=>{
    const fd=symToDir[e.from],td=symToDir[e.to];
    if(!fd||!td||fd===td)return;
    const k=fd+'→'+td; if(seen.has(k))return; seen.add(k);
    const c=dirColor[fd]||'#f59e0b';
    edges.push({id:'de'+i,from:'dir_'+fd,to:'dir_'+td,
      color:{color:c+'99',highlight:c,hover:c+'dd'},
      width:2,selectionWidth:3,
      arrows:{to:{enabled:true,scaleFactor:.5}},
      smooth:{type:'curvedCW',roundness:.2},
    });
  });

  VN.clear(); VE.clear();
  VN.update(nodes); VE.update(edges);
  net.setOptions({physics:{enabled:true,barnesHut:{gravitationalConstant:-14000,springLength:200,damping:.45}}});
  setTimeout(()=>net.setOptions({physics:{enabled:false}}),4500);
  setTimeout(()=>net.fit({animation:{duration:700}}),600);
  _bc(); _stats(); _leg('dirs');
  document.getElementById('btn-back').classList.add('hidden');
  document.getElementById('sbhd').textContent='Directories';
  document.getElementById('det').innerHTML='<p class="ph">Hover a neuron for details.<br><br>Double-click to explore its symbol graph.</p>';
}

// ── LEVEL 1: directory detail (files as rings, symbols as stars) ──────────────
function showDirDetail(dirName){
  VIEW='detail'; ACTIVE_DIR=dirName; selId=null;
  const color=dirColor[dirName]||'#f59e0b';
  const files=[...new Set(dirMap[dirName])];

  // Pin file rings in a circle
  const ringR=Math.max(280, files.length*28);
  const fileNodes=files.map((f,i)=>{
    const syms=byFile[f]||[];
    const base0=f.split('/').pop()||f;const basename=base0.lastIndexOf('.')>0?base0.slice(0,base0.lastIndexOf('.')):base0;
    const label=basename.length>16?basename.slice(0,14)+'…':basename;
    const angle=(i/files.length)*2*Math.PI - Math.PI/2;
    return ringNode('f_'+f,
      \`<b>\${label}</b>\n\${syms.length}\`,
      color,10,{
        x:Math.cos(angle)*ringR,y:Math.sin(angle)*ringR,
        fixed:{x:true,y:true},
        title:\`<div style="font:11px 'SF Mono',monospace;padding:7px 11px;background:#060520;border:1px solid \${color}40;border-radius:5px;color:#dde6ff">
          <b style="color:\${color}">\${(byFile[f]?.[0]?.file)||f}</b><br>\${syms.length} symbols
        </div>\`,
        _file:f,
      }
    );
  });

  // Symbol stars (free, will be attracted to their file ring)
  const mainSymIds=new Set(files.flatMap(f=>(byFile[f]||[]).map(s=>s.id)));
  const neighborIds=new Set();
  EDGES.forEach(e=>{
    if(mainSymIds.has(e.from)&&!mainSymIds.has(e.to))neighborIds.add(e.to);
    if(mainSymIds.has(e.to)&&!mainSymIds.has(e.from))neighborIds.add(e.from);
  });

  const symNodes=[
    ...files.flatMap(f=>(byFile[f]||[]).map(s=>starNode(s,false))),
    ...[...neighborIds].map(id=>byId[id]).filter(Boolean).map(s=>starNode(s,true)),
  ];

  // Edges: file ring → its symbols (attraction), then symbol↔symbol
  const allIds=new Set([...mainSymIds,...neighborIds]);
  const symEdges=[];
  EDGES.forEach((e,i)=>{
    if(!allIds.has(e.from)||!allIds.has(e.to))return;
    const sf=byId[e.from];
    const c=SF[sf?.type]||'#94a3b8';
    const dim=!mainSymIds.has(e.from)||!mainSymIds.has(e.to);
    symEdges.push({id:'se'+i,from:e.from,to:e.to,label:dim?'':e.kind,...slimEdge(c,dim,dim?'':e.kind)});
  });

  // Invisible anchor edges: file ring → each of its symbols (for physics attraction)
  const anchorEdges=files.flatMap((f,fi)=>
    (byFile[f]||[]).map((s,si)=>({
      id:'anc_'+fi+'_'+si,from:'f_'+f,to:s.id,
      color:{color:'transparent',highlight:'transparent',hover:'transparent'},
      width:0,arrows:{to:{enabled:false}},
      physics:true,hidden:false,
      smooth:{type:'dynamic'},
    }))
  );

  VN.clear(); VE.clear();
  VN.update([...fileNodes,...symNodes]);
  VE.update([...symEdges,...anchorEdges]);

  net.setOptions({physics:{
    enabled:true,
    barnesHut:{gravitationalConstant:-4000,centralGravity:.02,springLength:80,springConstant:.04,damping:.5},
    stabilization:{iterations:250,updateInterval:15},
  }});
  setTimeout(()=>net.setOptions({physics:{enabled:false}}),3500);
  setTimeout(()=>net.fit({animation:{duration:600}}),400);

  _bc(); _stats(); _leg('syms');
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('sbhd').textContent=dirName+'/';
  _dirSidebar(dirName);
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function _dirSidebar(dirName){
  const color=dirColor[dirName]||'#f59e0b';
  const files=dirMap[dirName]||[];
  const totalSyms=files.reduce((n,f)=>n+(byFile[f]?.length||0),0);
  const det=document.getElementById('det');
  det.innerHTML=\`
    <div class="dn" style="color:\${color};text-shadow:0 0 12px \${color}66">\${dirName}/</div>
    <div class="dpath">\${files.length} files · \${totalSyms} symbols</div>
    <div class="dsec">Files</div>
    <div class="sl">\${files.slice(0,40).map(f=>{
      const syms=byFile[f]||[];
      const base=f.split('/').pop()||f;
      const counts={};syms.forEach(s=>counts[s.type]=(counts[s.type]||0)+1);
      const dominant=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0]||'function';
      const sc=SC[dominant]||color;
      return \`<div class="si" style="border-left-color:\${sc}" onclick="focusFile('f_'+\${JSON.stringify(f)})">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:\${sc}">\${base}</span>
        <span style="color:var(--muted);font-size:9px">\${syms.length}</span>
      </div>\`;
    }).join('')}</div>
  \`;
}

function _dirOverviewSidebar(dirName){
  const color=dirColor[dirName]||'#f59e0b';
  const files=dirMap[dirName]||[];
  const totalSyms=files.reduce((n,f)=>n+(byFile[f]?.length||0),0);
  document.getElementById('det').innerHTML=\`
    <div class="dn" style="color:\${color};text-shadow:0 0 12px \${color}66">\${dirName}/</div>
    <div class="dpath">\${files.length} files, \${totalSyms} symbols</div>
    <div style="margin-top:14px;color:var(--muted);font-size:10px;line-height:1.8">
      Double-click to explore this directory's symbol graph →
    </div>
  \`;
}

function _symSidebar(id){
  const s=byId[id]; if(!s)return;
  const c=SC[s.type]||'#94a3b8';
  const out=EDGES.filter(e=>e.from===id).slice(0,12);
  const inc=EDGES.filter(e=>e.to===id).slice(0,12);
  const row=(e,dir)=>{
    const oid=dir==='out'?e.to:e.from;
    const os=byId[oid]; if(!os)return'';
    const oc=SC[os.type]||'#94a3b8';
    return \`<div class="ci" onclick="focusNode('\${oid}')">
      <span class="ck">\${e.kind}</span>
      <span class="cn" style="color:\${oc}">\${os.name.split('.').pop()}</span>
      <span class="cf">\${os.file.split('/').pop()}</span>
    </div>\`;
  };
  document.getElementById('det').innerHTML=\`
    <div class="dn">\${s.name}</div>
    <span class="dbadge" style="background:\${c}18;color:\${c};border:1px solid \${c}35">\${s.type}</span>
    <div class="dpath">📄 \${s.file}:\${s.line}</div>
    \${s.sig?'<div class="dsig">'+s.sig.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>':''}
    \${s.doc?'<div class="ddoc">'+s.doc+'</div>':''}
    <div class="dsec">Depends on (\${out.length})</div>
    <div class="cl">\${out.map(e=>row(e,'out')).join('')||'<span style="color:var(--muted);font-size:10px">none</span>'}</div>
    <div class="dsec">Used by (\${inc.length})</div>
    <div class="cl">\${inc.map(e=>row(e,'in')).join('')||'<span style="color:var(--muted);font-size:10px">none</span>'}</div>
  \`;
}

// SF is symbol color lookup (same as SC)
const SF=SC;

function focusNode(id){
  selId=id;
  pc=SC[byId[id]?.type]||'#f59e0b';
  net.selectNodes([id]);
  net.focus(id,{scale:1.8,animation:{duration:350}});
  _symSidebar(id);
}

function focusFile(nodeId){
  const fid=nodeId;
  net.selectNodes([fid]);
  net.focus(fid,{scale:1.2,animation:{duration:350}});
  selId=fid;pc=dirColor[ACTIVE_DIR]||'#f59e0b';
}

// ── Events ────────────────────────────────────────────────────────────────────
net.on('click',({nodes})=>{
  if(!nodes.length)return;
  const id=nodes[0];
  const n=VN.get(id);
  if(!n)return;
  selId=id;
  if(VIEW==='dirs'){
    const d=n._dir; if(!d)return;
    pc=dirColor[d]||'#f59e0b';
    _dirOverviewSidebar(d);
  }else{
    if(n._sym){pc=SC[byId[id]?.type]||'#f59e0b';_symSidebar(id);}
    else if(n._file){pc=dirColor[ACTIVE_DIR]||'#f59e0b';}
  }
});

net.on('doubleClick',({nodes})=>{
  if(!nodes.length)return;
  const id=nodes[0];const n=VN.get(id);if(!n)return;
  if(VIEW==='dirs'&&n._dir)showDirDetail(n._dir);
});

// ── Search ─────────────────────────────────────────────────────────────────────
document.getElementById('srch').addEventListener('input',e=>{
  const q=e.target.value.toLowerCase().trim();
  if(VIEW==='dirs'){
    VN.update(VN.getIds().map(id=>({id,opacity:!q||String(id).toLowerCase().includes(q)?1:.08})));return;
  }
  const ids=VN.getIds();
  VN.update(ids.map(id=>{
    const s=byId[id];
    if(!s)return{id,opacity:1};
    return{id,opacity:!q||s.name.toLowerCase().includes(q)||s.file.toLowerCase().includes(q)?1:.05};
  }));
  if(q){const m=SYMS.filter(s=>VN.get(s.id)&&s.name.toLowerCase().includes(q));if(m.length===1)focusNode(m[0].id);}
});

function resetView(){
  document.getElementById('srch').value='';
  net.fit({animation:{duration:500}});
  VN.update(VN.getIds().map(id=>({id,opacity:1})));
}
function goBack(){showDirs();}

// ── Breadcrumb / stats / legend ───────────────────────────────────────────────
function _bc(){
  const el=document.getElementById('bc');
  if(VIEW==='dirs'){el.innerHTML='<span class="bc-c">ALL DIRECTORIES</span>';}
  else{el.innerHTML='<span class="bc-a" onclick="goBack()">ALL DIRECTORIES</span><span class="bc-s"> / </span><span class="bc-c">'+ACTIVE_DIR+'/</span>';}
}
function _stats(){
  const chips=document.querySelectorAll('.chip');
  if(VIEW==='detail'&&ACTIVE_DIR){
    const files=dirMap[ACTIVE_DIR]||[];
    const syms=files.reduce((n,f)=>n+(byFile[f]?.length||0),0);
    chips[0].innerHTML='<b>'+files.length+'</b> files';
    chips[1].innerHTML='<b>'+syms+'</b> symbols';
    chips[2].innerHTML='<b>${stats.edges}</b> edges';
  }else{
    chips[0].innerHTML='<b>${stats.files}</b> files';
    chips[1].innerHTML='<b>${stats.symbols}</b> symbols';
    chips[2].innerHTML='<b>${stats.edges}</b> edges';
  }
}
function _leg(mode){
  const el=document.getElementById('leg');
  if(mode==='syms'){
    el.innerHTML=Object.entries(SC).map(([t,c])=>
      \`<div class="li"><div class="ld" style="background:\${c};box-shadow:0 0 4px \${c}"></div>\${t}</div>\`
    ).join('');
  }else{
    el.innerHTML=Object.keys(dirMap).sort().slice(0,8).map(d=>
      \`<div class="li"><div class="ld" style="background:\${dirColor[d]};box-shadow:0 0 4px \${dirColor[d]}"></div>\${d}/</div>\`
    ).join('');
  }
}

// Boot
showDirs();
</script>
</body>
</html>`;
}

export function runViz(projectRoot: string, dbPath: string, outputPath: string): void {
  if (!fs.existsSync(dbPath)) {
    console.error(`[nexus-viz] no index found at ${dbPath}. Run nexus-mcp first.`);
    process.exit(1);
  }
  const db   = new NexusDB(dbPath);
  const html = generateHtml(db, projectRoot);
  db.close();
  fs.writeFileSync(outputPath, html, 'utf8');
  console.log(`[nexus-viz] written to: ${outputPath}`);
  const { execSync } = require('child_process');
  try {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    execSync(`${cmd} "${outputPath}"`);
  } catch { console.log('[nexus-viz] open manually'); }
}
