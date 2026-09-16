const {test,before}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const file=p=>path.join(__dirname,'..',p);let compute,chunk;
before(async()=>{compute=await import(pathToFileURL(file('js/viz/abbCrbCompute.js')).href);chunk=await import(pathToFileURL(file('js/viz/abbCrbSliceChunk.js')).href);});
test('chunked enumeration retains exact world slice coordinates and count values',()=>{
 const a=JSON.parse(fs.readFileSync(file('assets/data/lecture07/crb-slice-xz.json')));
 for(const start of [391,10990,50060]){const result=chunk.calculateSliceChunk(a,start,start+3);assert.deepEqual(result.counts,a.counts.slice(start,start+3));assert.deepEqual(result.limitCounts,a.limitCounts.slice(start,start+3));assert.equal(result.unresolved,0);}
});
test('slice validation rejects invalid shapes/orientations before starting a backend',async()=>{
 const s={plane:'xy',nx:20,ny:20,xmin:-1,xmax:1,ymin:-1,ymax:1,z:.2,orientation:[[1,0,0],[0,1,0],[0,0,1]]};
 assert.equal(compute.validateSliceRequest(s),400);
 for(const invalid of [{...s,plane:'zy'},{...s,nx:100000},{...s,z:NaN},{...s,xmax:-2},{...s,orientation:[[2,0,0],[0,1,0],[0,0,1]]},{...s,orientation:[[-1,0,0],[0,1,0],[0,0,1]]}])assert.throws(()=>compute.validateSliceRequest(invalid));
 const controller=new AbortController();controller.abort();await assert.rejects(compute.computeSlice(s,null,{signal:controller.signal}),e=>e.name==='AbortError');
 await assert.rejects(compute.computeSlice(s,null,{maxWorkers:NaN}),/positive integer/);
});
