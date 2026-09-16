import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { parseStlGeometry } from './frameDHPlayground.js';
import { createZUpWorld,resizeRendererToContainer } from './threeUtils.js';
import { CUSTOM_URDF,customPosition } from './lecture07CustomMath.js';

let assetPromise;
function loadAssets(){
  if(assetPromise)return assetPromise;
  assetPromise=(async()=>{
    const url=new URL(CUSTOM_URDF,import.meta.url),response=await fetch(url);
    if(!response.ok)throw new Error('The custom 3R robot description could not load.');
    const xml=new DOMParser().parseFromString(await response.text(),'application/xml');
    if(xml.querySelector('parsererror'))throw new Error('The custom 3R robot description is invalid.');
    const direct=(element,tag)=>[...element.children].find(child=>child.tagName===tag);
    const vector=(element,name,fallback=[0,0,0])=>element?.getAttribute(name)?.trim().split(/\s+/).map(Number)||fallback;
    const origin=element=>{const item=direct(element,'origin'),[x,y,z]=vector(item,'xyz'),[r,p,yaw]=vector(item,'rpy');return new THREE.Matrix4().makeTranslation(x,y,z).multiply(new THREE.Matrix4().makeRotationZ(yaw)).multiply(new THREE.Matrix4().makeRotationY(p)).multiply(new THREE.Matrix4().makeRotationX(r));};
    const joint=name=>{const element=[...xml.querySelectorAll('joint')].find(j=>j.getAttribute('name')===name);if(!element)throw new Error(`Missing ${name}.`);return {origin:origin(element),axis:new THREE.Vector3(...vector(direct(element,'axis'),'xyz',[0,0,1])).normalize()};};
    const joints=['joint_1','joint_2','joint_3'].map(joint),tool=joint('tool0_fixed_joint');
    const materials=new Map([...xml.documentElement.children].filter(e=>e.tagName==='material').map(e=>[e.getAttribute('name'),vector(direct(e,'color'),'rgba',[.6,.6,.6,1])]));
    const visuals=await Promise.all(['base_link','link_1','link_2','link_3'].map(async name=>{
      const link=[...xml.querySelectorAll('link')].find(e=>e.getAttribute('name')===name),visual=direct(link,'visual'),mesh=visual.querySelector('geometry > mesh'),file=mesh.getAttribute('filename').split('/').at(-1);
      const response=await fetch(new URL(file,url));if(!response.ok)throw new Error(`The custom 3R mesh ${file} could not load.`);
      const geometry=parseStlGeometry(await response.arrayBuffer());geometry.computeVertexNormals();
      const material=direct(visual,'material'),rgba=materials.get(material?.getAttribute('name'))||[.6,.6,.6,1];
      return {name,geometry,origin:origin(visual),scale:vector(mesh,'scale',[1,1,1]),color:new THREE.Color(...rgba.slice(0,3))};
    }));
    function transforms(q){const result=[new THREE.Matrix4()];for(let i=0;i<3;i++)result.push(result.at(-1).clone().multiply(joints[i].origin).multiply(new THREE.Matrix4().makeRotationAxis(joints[i].axis,q[i])));return result;}
    // Check the symbolic plotting model against the parsed native URDF, so a
    // future change cannot silently draw a robot with different kinematics.
    for(let i=0;i<12;i++){const q=[Math.sin(i)*3,Math.cos(i*1.7)*3,Math.sin(i*2.1)*3],actual=new THREE.Vector3().setFromMatrixPosition(transforms(q).at(-1).clone().multiply(tool.origin)),expected=new THREE.Vector3(...customPosition(q));if(actual.distanceTo(expected)>1e-10)throw new Error('The custom 3R equations no longer match its robot description.');}
    return {visuals,transforms,tool};
  })();return assetPromise;
}

export function createCustomURDFViewer(host,{compactOpacity=false}={}) {
  host.style.position='relative';host.dataset.robotModel='custom_3R.urdf';
  const scene=new THREE.Scene();scene.background=new THREE.Color('#f3f4f5');
  const camera=new THREE.PerspectiveCamera(38,1,.01,100);camera.position.set(6.5,5.2,6.5);
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));host.prepend(renderer.domElement);
  const world=createZUpWorld(scene),grid=new THREE.GridHelper(10,20,0xbfc6cd,0xe0e4e8);grid.rotation.x=Math.PI/2;world.add(grid);
  scene.add(new THREE.HemisphereLight(0xffffff,0x5b6670,2.5));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(4,8,10);scene.add(light);
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(1.3,1.7,0);controls.update();
  const robot=new THREE.Group(),ghost=new THREE.Group();world.add(robot,ghost);ghost.visible=false;
  let trace=null,assets=null,current=[0,-.6,1],initial=null,opacityValue=1;
  const point=new THREE.Mesh(new THREE.SphereGeometry(.07,20,14),new THREE.MeshBasicMaterial({color:0xb33227}));world.add(point);
  function render(){renderer.render(scene,camera);}
  function pose(group,q){if(!assets)return;const links=assets.transforms(q);group.children.forEach((mesh,i)=>{mesh.matrix.copy(links[i]).multiply(assets.visuals[i].origin).scale(new THREE.Vector3(...assets.visuals[i].scale));mesh.matrixWorldNeedsUpdate=true;});}
  const opacity=document.createElement('label');opacity.className='l7-dh-opacity';opacity.style.cssText='position:absolute;bottom:8px;left:10px;right:10px;display:flex;gap:8px;align-items:center;background:#fffffff0;padding:5px 8px;font-size:11px;z-index:4';opacity.innerHTML='STL opacity <input type="range" min=".1" max="1" step=".05" value="1" aria-label="Custom 3R STL opacity" style="flex:1;min-width:0"><output>100%</output>';host.append(opacity);
  if(compactOpacity){opacity.style.right='auto';opacity.style.width='min(270px, calc(100% - 36px))';}
  opacity.querySelector('input').addEventListener('input',event=>{opacityValue=+event.target.value;robot.traverse(o=>{if(o.isMesh){o.material.opacity=opacityValue;o.material.transparent=opacityValue<1;o.material.depthWrite=opacityValue===1;}});opacity.querySelector('output').textContent=`${Math.round(opacityValue*100)}%`;render();});
  controls.addEventListener('change',render);
  const ro=new ResizeObserver(()=>{resizeRendererToContainer(renderer,camera,host);render();});ro.observe(host);resizeRendererToContainer(renderer,camera,host);
  const api={update(q){current=q.slice();pose(robot,current);point.position.set(...customPosition(current));host.dataset.configuration=JSON.stringify(current);render();},setGhost(q){initial=q?.slice()||null;ghost.visible=!!q;if(q)pose(ghost,q);host.dataset.hasGhost=String(!!q);render();},setTrace(points){if(trace){trace.removeFromParent();trace.geometry.dispose();trace.material.dispose();}trace=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(p[0],0,p[1]))),new THREE.LineBasicMaterial({color:0xb33227}));world.add(trace);render();}};
  loadAssets().then(result=>{assets=result;for(const spec of assets.visuals)for(const [group,value]of [[robot,opacityValue],[ghost,.16]]){const mesh=new THREE.Mesh(spec.geometry,new THREE.MeshStandardMaterial({color:spec.color,roughness:.52,metalness:.12,transparent:value<1,opacity:value,depthWrite:value===1}));mesh.matrixAutoUpdate=false;group.add(mesh);}pose(robot,current);if(initial)pose(ghost,initial);host.dataset.meshCount=String(robot.children.length);render();}).catch(error=>{const warning=document.createElement('div');warning.className='warning';warning.textContent=error.message;host.append(warning);console.error(error);});
  api.update(current);return api;
}
