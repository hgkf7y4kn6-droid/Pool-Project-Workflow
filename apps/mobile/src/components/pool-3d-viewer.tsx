import { Platform, View } from "react-native";
import { WebView } from "react-native-webview";
import type { DesignSummary } from "@pool/types";
import { Text } from "./ui/text";

/**
 * Provider-agnostic 3D viewer.
 * - A glTF/GLB/USDZ model from any design platform renders with Google's
 *   <model-viewer> (orbit, zoom, AR on supported phones).
 * - Without a model, a parametric preview is generated from the design's
 *   dimensions (length/width/depths) with three.js, so every design has a 3D view.
 */
export function Pool3DViewer({ modelUrl, summary, height = 380 }: { modelUrl?: string | null; summary?: DesignSummary | null; height?: number }) {
  const html = modelUrl ? modelViewerHtml(modelUrl) : parametricHtml(summary ?? {});
  if (Platform.OS === "web") {
    return (
      <View style={{ height }} className="overflow-hidden rounded-2xl border border-border">
        {/* react-native-web renders this as a DOM iframe */}
        <iframe title="3D pool design" srcDoc={html} style={{ width: "100%", height: "100%", border: 0 }} />
      </View>
    );
  }
  return (
    <View style={{ height }} className="overflow-hidden rounded-2xl border border-border bg-black" accessible accessibilityLabel="Interactive 3D pool design. Drag to rotate, pinch to zoom.">
      <WebView originWhitelist={["*"]} source={{ html }} javaScriptEnabled scrollEnabled={false} />
      {!modelUrl ? <Text className="absolute bottom-2 left-3 text-xs text-white/80">Parametric preview from design dimensions</Text> : null}
    </View>
  );
}

function modelViewerHtml(url: string): string {
  const safe = url.replace(/"/g, "&quot;");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<script type="module" src="https://unpkg.com/@google/model-viewer@4/dist/model-viewer.min.js"></script>
<style>html,body{margin:0;height:100%;background:#0a1117}model-viewer{width:100%;height:100%}</style></head>
<body><model-viewer src="${safe}" camera-controls touch-action="pan-y" auto-rotate ar shadow-intensity="1" exposure="1"></model-viewer></body></html>`;
}

function parametricHtml(s: DesignSummary): string {
  const L = s.lengthFt ?? 32;
  const W = s.widthFt ?? 16;
  const shallow = s.shallowDepthFt ?? 3.5;
  const deep = s.deepDepthFt ?? 6;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#0a1117}</style></head><body>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}</script>
<script type="module">
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
const L=${L}, W=${W}, S=${shallow}, D=${deep};
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x0a1117);
const camera=new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 500); camera.position.set(L*0.9, L*0.7, W*1.6);
const renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(devicePixelRatio); document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.4)); const sun=new THREE.DirectionalLight(0xffffff,1.2); sun.position.set(20,40,10); scene.add(sun);
// Deck with a pool-shaped opening
const deck=new THREE.Shape(); const m=6; deck.moveTo(-L/2-m,-W/2-m); deck.lineTo(L/2+m,-W/2-m); deck.lineTo(L/2+m,W/2+m); deck.lineTo(-L/2-m,W/2+m);
const hole=new THREE.Path(); hole.moveTo(-L/2,-W/2); hole.lineTo(L/2,-W/2); hole.lineTo(L/2,W/2); hole.lineTo(-L/2,W/2); deck.holes.push(hole);
const deckMesh=new THREE.Mesh(new THREE.ShapeGeometry(deck), new THREE.MeshStandardMaterial({color:0xd8c9a7, side:THREE.DoubleSide})); deckMesh.rotation.x=-Math.PI/2; scene.add(deckMesh);
// Shell: floor slopes from shallow to deep end
const shell=new THREE.MeshStandardMaterial({color:0xf2f5f7, side:THREE.DoubleSide});
const floor=new THREE.BufferGeometry(); const v=new Float32Array([-L/2,-S,-W/2, L/2,-D,-W/2, L/2,-D,W/2, -L/2,-S,-W/2, L/2,-D,W/2, -L/2,-S,W/2]);
floor.setAttribute("position", new THREE.BufferAttribute(v,3)); floor.computeVertexNormals(); scene.add(new THREE.Mesh(floor, shell));
function wall(x1,z1,d1,x2,z2,d2){const g=new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([x1,0,z1, x2,0,z2, x2,-d2,z2, x1,0,z1, x2,-d2,z2, x1,-d1,z1]),3)); g.computeVertexNormals(); scene.add(new THREE.Mesh(g, shell));}
wall(-L/2,-W/2,S, L/2,-W/2,D); wall(-L/2,W/2,S, L/2,W/2,D); wall(-L/2,-W/2,S,-L/2,W/2,S); wall(L/2,-W/2,D,L/2,W/2,D);
// Water surface and coping
const water=new THREE.Mesh(new THREE.PlaneGeometry(L,W), new THREE.MeshStandardMaterial({color:0x2a9df4, transparent:true, opacity:0.55})); water.rotation.x=-Math.PI/2; water.position.y=-0.5; scene.add(water);
const coping=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(L+1,0.3,W+1)), new THREE.LineBasicMaterial({color:0xb8a27a})); coping.position.y=0.15; scene.add(coping);
const controls=new OrbitControls(camera, renderer.domElement); controls.enableDamping=true; controls.target.set(0,-D/3,0);
addEventListener("resize",()=>{camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);});
(function loop(){requestAnimationFrame(loop); controls.update(); renderer.render(scene,camera);})();
</script></body></html>`;
}
