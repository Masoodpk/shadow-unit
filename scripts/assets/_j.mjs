import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const re = process.argv[3] ? new RegExp(process.argv[3]) : null;
const skin = doc.getRoot().listSkins()[0];
const W = new Map();
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const J=p.getAttribute("JOINTS_0"), Wt=p.getAttribute("WEIGHTS_0"); if(!J) continue; const a=[],b=[]; for(let i=0;i<J.getCount();i++){J.getElement(i,a);Wt.getElement(i,b); for(let k=0;k<4;k++) if(b[k]>0.05) W.set(a[k],(W.get(a[k])??0)+1);} }
const ibm = skin.getInverseBindMatrices();
skin.listJoints().forEach((jn,k)=>{ const n=jn.getName(); if(re && !re.test(n)) return; const Wm=jn.getWorldMatrix(); console.log(k, JSON.stringify(n), "<", JSON.stringify(jn.getParentNode()?.getName()), [Wm[12],Wm[13],Wm[14]].map(v=>v.toFixed(3)).join(","), "w", W.get(k)??0); });
