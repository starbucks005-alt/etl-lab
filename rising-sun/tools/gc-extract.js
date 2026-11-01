// Reads every GC_* companion object out of good-company/gc-friend.js and writes them to /tmp/gc-all.json, so rising-sun/tools/add-companions.py can copy Dr. O's own written fields word for word. Run: node rising-sun/tools/gc-extract.js
const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync(''+require('path').join(__dirname,'..','..','good-company','gc-friend.js')+'','utf8');
const ids=[...src.matchAll(/var GC_DEMOS = \{([^}]*)\}/g)][0][1].split(',').map(x=>x.trim().split(':').map(y=>y.trim()));
// evaluate each "var GC_X = {...};" block separately
const out={};
for(const [id,v] of ids){
  const re=new RegExp('var '+v+' = \\{');
  const m=re.exec(src); if(!m){console.log(id,'NOT FOUND',v);continue;}
  // find matching close by brace depth, ignoring strings roughly
  let i=m.index+m[0].length-1,d=0,inS=null,esc=false,start=i;
  for(;i<src.length;i++){const c=src[i];
    if(inS){ if(esc)esc=false; else if(c==='\\')esc=true; else if(c===inS)inS=null; continue;}
    if(c==="'"||c==='"'||c==='`'){inS=c;continue;}
    if(c==='/'&&src[i+1]==='/'){while(src[i]!=='\n')i++;continue;}
    if(c==='/'&&src[i+1]==='*'){i=src.indexOf('*/',i)+1;continue;}
    if(c==='{')d++; if(c==='}'){d--; if(!d)break;}
  }
  const code='('+src.slice(start,i+1)+')';
  try{ const ctx={Math:{floor:()=>0,random:()=>0},GC_KIT_HELLOS:['x'],GC_FOO:1}; vm.createContext(ctx);
    const o=vm.runInContext(code,ctx); out[id]=o;
  }catch(e){console.log(id,'EVAL FAIL',String(e).slice(0,70));}
}
for(const [id,o] of Object.entries(out)) console.log(id.padEnd(9),String(o.voiceId||'-').slice(0,42).padEnd(43),(o.portrait||'-').padEnd(26),(o.name||'').slice(0,18).padEnd(19),'keys',Object.keys(o).length);
fs.writeFileSync('/tmp/gc-all.json',JSON.stringify(out));
