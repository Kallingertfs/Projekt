// game.js (aggiornato) - notifiche visuali (toast) più belle + supporto skins acquistabili/equipaggiabili
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js";

/* ASSETS audio (opzionali) */
const ASSETS = {
  music: 'assets/music_loop.mp3',
  coin:  'assets/coin.wav',
  boost: 'assets/boost.wav',
  crash: 'assets/crash.wav',
  button:'assets/button.wav'
};

/* ---------- Scene / Renderer ---------- */
const canvas = document.getElementById('gameCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x071017);
scene.fog = new THREE.FogExp2(0x071017, 0.008);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 1000);
camera.position.set(0,6.5,12);
camera.lookAt(0,0.7,0);

/* Lights */
const hemi = new THREE.HemisphereLight(0xcfeeff, 0x202028, 0.6); scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff,0.9); dir.position.set(6,12,8); dir.castShadow=true; scene.add(dir);

/* Road + markers */
const road = new THREE.Mesh(new THREE.PlaneGeometry(12,400), new THREE.MeshStandardMaterial({color:0x1f2933, roughness:0.95}));
road.rotation.x = -Math.PI/2; road.position.z = -80; road.receiveShadow=true; scene.add(road);

const laneMarkers=[]; const markerGeom = new THREE.BoxGeometry(0.2,0.02,4);
const markerMat = new THREE.MeshStandardMaterial({ color:0xf2f3f4, emissive:0x101010, roughness:0.9 });
for(let laneX of [-1.6,1.6]) for(let z=-200; z<80; z+=8){
  const m = new THREE.Mesh(markerGeom, markerMat); m.position.set(laneX,0.01,z); scene.add(m); laneMarkers.push(m);
}

/* Car with adjustable material (for skins) */
const car = new THREE.Group();
const carMaterial = new THREE.MeshStandardMaterial({ color: 0x00c48f, metalness:0.2, roughness:0.35 });
const body = new THREE.Mesh(new THREE.BoxGeometry(1.2,0.6,2.2), carMaterial);
body.position.y = 0.6; body.castShadow=true; car.add(body);
const wheelGeom = new THREE.CylinderGeometry(0.25,0.25,0.2,12); const wheelMat = new THREE.MeshStandardMaterial({color:0x111111});
for(let i=-1;i<=1;i+=2) for(let j=-1;j<=1;j+=2){ const w = new THREE.Mesh(wheelGeom,wheelMat); w.rotation.z = Math.PI/2; w.position.set(0.6*i,0.25,0.7*j); w.castShadow=true; car.add(w); }
car.position.set(0,0,4); scene.add(car);

/* Lanes and gameplay state */
const lanes = [-3.2,0,3.2];
let currentLane = 1;

let coins = [], boosts = [], obstacles = [];
let score = 0;
let baseSpeed = 18;
let elapsed = 0;
let speedMultiplier = 1;
let speedBoostTimer = 0;
let running = false;

let coinTimer=0.4, boostTimer=8, obstacleTimer=1.2;

/* UI elements */
const scoreEl = document.getElementById('score');
const speedEl = document.getElementById('speed');
const balanceEl = document.getElementById('balance');
const livesEl = document.getElementById('lives');
const startScreen = document.getElementById('startScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const finalScoreEl = document.getElementById('finalScore');
const startBtn = document.getElementById('startBtn');
const saveRestartBtn = document.getElementById('saveRestartBtn');
const loadProgressEl = document.getElementById('loadProgress');
const muteBtn = document.getElementById('muteBtn');
const volumeSlider = document.getElementById('volumeSlider');
const toastContainer = document.getElementById('toastContainer');

/* Hinweis: mobile Buttons wurden entfernt aus dem HTML, daher gibt es hier keine leftBtn/rightBtn/accelBtn/brakeBtn mehr.
   Wichtig: entferne bitte auch den entsprechenden HTML-Block (#mobileControls) oder lass ihn auskommentiert. */

/* input */
let keyState = {};
let inputCooldown = 0;
const cooldownTime = 0.18;

/* collision helpers & effects */
const boxA = new THREE.Box3(), boxB = new THREE.Box3();
const activeEffects = [];
let shakeTime = 0, shakeIntensity = 0;

/* audio */
let audioContext = null, audioElements = {}, masterVolume = parseFloat(localStorage.getItem('lr_volume')||'0.8');
volumeSlider.value = masterVolume;
let isMuted = localStorage.getItem('lr_muted') === '1';
setMuteUI(isMuted);

function setMuteUI(m){ isMuted = m; muteBtn.textContent = m ? '🔇' : '🔊'; localStorage.setItem('lr_muted', m ? '1' : '0'); }
function ensureAudioContext(){ if(!audioContext){ try{ audioContext = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ audioContext=null; } } }
async function loadAudioFiles(list,onProgress){
  const keys = Object.keys(list); let loaded=0;
  for(const k of keys){
    const path = list[k];
    try{ const a = new Audio(); a.src = path; a.preload='auto'; a.load();
      await new Promise(res=>{ const oncan = ()=>{ a.removeEventListener('canplaythrough', oncan); res(); }; const onerr = ()=>{ a.removeEventListener('error', onerr); res(); }; a.addEventListener('canplaythrough', oncan); a.addEventListener('error', onerr); setTimeout(()=>res(),2500); });
      audioElements[k] = a;
    }catch(e){}
    loaded++; onProgress(Math.round(loaded/keys.length*100));
  }
}

/* fallback simple sounds (same ideas as before) */
function playFallback(name, volume=1){
  ensureAudioContext();
  if(!audioContext) return;
  const now = audioContext.currentTime;
  if(name === 'coin'){
    const osc = audioContext.createOscillator(); const g = audioContext.createGain();
    osc.type='sine'; osc.frequency.setValueAtTime(880+Math.random()*220, now);
    g.gain.setValueAtTime(volume * masterVolume * (isMuted?0:1), now); g.gain.exponentialRampToValueAtTime(0.001, now+0.25);
    osc.connect(g); g.connect(audioContext.destination); osc.start(now); osc.stop(now+0.26);
  } else if(name==='crash'){
    const bufferSize = audioContext.sampleRate*0.4; const buffer = audioContext.createBuffer(1,bufferSize,audioContext.sampleRate);
    const d = buffer.getChannelData(0); for(let i=0;i<bufferSize;i++) d[i] = (Math.random()*2-1)*(1 - i/bufferSize);
    const src = audioContext.createBufferSource(); src.buffer = buffer; const g=audioContext.createGain();
    g.gain.setValueAtTime(volume*masterVolume*(isMuted?0:1), audioContext.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime+0.6);
    src.connect(g); g.connect(audioContext.destination); src.start();
  } else {
    const o = audioContext.createOscillator(); const g = audioContext.createGain();
    o.frequency.setValueAtTime(660, now); g.gain.setValueAtTime(volume*masterVolume*(isMuted?0:1), now); g.gain.exponentialRampToValueAtTime(0.001, now+0.12);
    o.connect(g); g.connect(audioContext.destination); o.start(now); o.stop(now+0.12);
  }
}
function playSound(name, opts={volume:1,loop:false}){
  try{ const el = audioElements[name]; if(el){ el.volume = opts.volume * masterVolume * (isMuted?0:1); el.loop = !!opts.loop; const p = el.play(); if(p && p.catch) p.catch(()=>{}); return; } }catch(e){}
  playFallback(name, opts.volume);
}
function stopSound(name){ const el = audioElements[name]; if(el && !el.paused){ el.pause(); el.currentTime = 0; } }

/* preload UI */
async function preloadAll(){ loadProgressEl.textContent='0%'; await loadAudioFiles(ASSETS, (p)=>loadProgressEl.textContent = `${p}%`); loadProgressEl.textContent='100%'; }

/* ---------- Save / Shop / Skins (localStorage) ---------- */
const SKINS = [
  { id: 'default', name: 'Classic Green', price: 0, color: '#00c48f', desc: 'Materiale classico.' },
  { id: 'red', name: 'Red Fury', price: 200, color: '#ff4a4a', desc: 'Aggressiva e veloce.' },
  { id: 'blue', name: 'Blue Lightning', price: 250, color: '#3ea8ff', desc: 'Fredda e lucente.' },
  { id: 'chrome', name: 'Chrome', price: 400, color: '#c7c7c7', desc: 'Lucida come metallo.' }
];

function loadSave(){ const s = JSON.parse(localStorage.getItem('lr_save')||'{}'); s.balance = s.balance || 0; s.best = s.best || 0; s.inv = s.inv || { extraLife:0, doubleCoins:0, magnet:0 }; s.skinsOwned = s.skinsOwned || { default:1 }; s.selectedSkin = s.selectedSkin || 'default'; return s; }
function saveSave(s){ localStorage.setItem('lr_save', JSON.stringify(s)); }
function addToBalance(n){ const s = loadSave(); s.balance = (s.balance||0) + n; if(s.balance<0) s.balance = 0; saveSave(s); updateSaveUI(); }
function setBestIfHigher(n){ const s = loadSave(); if(n > (s.best||0)){ s.best = n; saveSave(s); } updateSaveUI(); }
function consumeInv(item){ const s = loadSave(); if(s.inv[item] && s.inv[item] > 0){ s.inv[item]--; saveSave(s); return true; } return false; }
function getInv(item){ return (loadSave().inv[item]||0); }
function ownSkin(id){ return !!(loadSave().skinsOwned && loadSave().skinsOwned[id]); }
function equipSkin(id){ const s = loadSave(); if(!s.skinsOwned[id]) return false; s.selectedSkin = id; saveSave(s); applySkinToCar(id); updateSaveUI(); return true; }
function buySkin(id){ const skin = SKINS.find(x=>x.id===id); if(!skin) return false; const s = loadSave(); if(s.balance >= skin.price){ s.balance -= skin.price; s.skinsOwned[id] = 1; s.selectedSkin = id; saveSave(s); applySkinToCar(id); updateSaveUI(); showToast(`Skin acquistata: ${skin.name}`, 'success'); return true; } showToast('Non hai abbastanza punti per la skin.', 'error'); return false; }

function updateSaveUI(){
  const s = loadSave();
  balanceEl.textContent = 'BANK: ' + (s.balance||0);
  livesEl.textContent = 'LIVES: ' + (s.inv.extraLife||0);
}

/* Apply skin visuals */
function applySkinToCar(skinId){
  const skin = SKINS.find(x=>x.id===skinId) || SKINS[0];
  try{
    carMaterial.color.set(skin.color);
    if(skinId === 'chrome'){
      carMaterial.metalness = 0.9; carMaterial.roughness = 0.2;
    } else {
      carMaterial.metalness = 0.2; carMaterial.roughness = 0.35;
    }
  }catch(e){}
}

/* ---------- Toast (pretty popups) ---------- */
function showToast(message, type='info', duration=3000){
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  requestAnimationFrame(()=> el.classList.add('visible'));
  setTimeout(()=> {
    el.classList.remove('visible');
    setTimeout(()=> el.remove(), 350);
  }, duration);
}

/* ---------- Particles (with cleanup fix) ---------- */
function cleanupEffect(effect){
  if(!effect) return;
  for(const p of effect.particles){
    try{ scene.remove(p); if(p.geometry) p.geometry.dispose(); if(p.material){ if(Array.isArray(p.material)) p.material.forEach(m=>m.dispose()); else p.material.dispose(); } }catch(e){}
  }
  effect.particles.length = 0;
}

function createCollectEffect(pos, color=0xffff00){
  const group = { particles: [], life: 0.7, update(dt){
    for(const p of this.particles){
      p.userData.life -= dt;
      if(p.userData.life <= 0){
        if(p.parent) scene.remove(p);
      } else {
        p.position.addScaledVector(p.userData.vel, dt * 3.5);
        p.material.opacity = Math.max(0, p.userData.life * 1.6);
      }
    }
  } };
  for(let i=0;i<18;i++){
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.06,6,6), new THREE.MeshBasicMaterial({ color, transparent:true, opacity:1 }));
    p.position.copy(pos);
    p.userData = { vel: new THREE.Vector3((Math.random()-0.5)*3, Math.random()*2, (Math.random()-0.5)*3), life: 0.7 + Math.random()*0.2 };
    scene.add(p); group.particles.push(p);
  }
  activeEffects.push(group);
}

/* ---------- Power-ups triggers ---------- */
function onCollectCoin(obj){
  playSound('coin',{volume:0.9});
  const s = loadSave();
  const value = activeDouble ? 2 : 1;
  score += value;
  createCollectEffect(obj.position, 0xffd766);
  showToast(`+${value} coins`, 'success', 900);
}
function onCollectBoost(obj){
  playSound('boost',{volume:1.0});
  score += 25;
  speedBoostTimer = 3.0;
  createCollectEffect(obj.position, 0xffffff);
  showToast('Boost collected! Speed up', 'info', 1200);
}
function onCrash(){
  playSound('crash',{volume:1.0});
  createCollectEffect(car.position, 0xff4a4a);
  shakeIntensity = 0.6; shakeTime = 0.9;
  showToast('Crash!', 'error', 1400);
}

/* ---------- Inventory / per-run power-ups ---------- */
let activeDouble = false;
let magnetTimer = 0;
function applyInventoryOnStart(){
  if(consumeInv('doubleCoins')) { activeDouble = true; showToast('Double Coins active for this run', 'info', 1400); }
  else activeDouble = false;
  if(consumeInv('magnet')) { magnetTimer = 10; showToast('Magnet active (10s)', 'info', 1400); }
  else magnetTimer = 0;
}

/* ---------- Spawn objects ---------- */
function randomLaneIndex(){ return Math.floor(Math.random()*3); }
function spawnCoin(){ const g=new THREE.SphereGeometry(0.28,10,10); const m=new THREE.MeshStandardMaterial({color:0xffd766,metalness:0.6,roughness:0.3,emissive:0x332200}); const coin=new THREE.Mesh(g,m); coin.position.set(lanes[randomLaneIndex()],0.5,-140 + Math.random()*20); coin.userData={type:'coin'}; scene.add(coin); coins.push(coin); }
function spawnBoost(){ const g=new THREE.OctahedronGeometry(0.45); const m=new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xffffff,metalness:0.9,roughness:0.1}); const b=new THREE.Mesh(g,m); b.position.set(lanes[randomLaneIndex()],0.6,-150+Math.random()*30); b.userData={type:'boost',spin:Math.random()*2}; scene.add(b); boosts.push(b); }
function spawnObstacle(){ const sizeZ=0.8 + Math.random()*1.4; const g=new THREE.BoxGeometry(1.0, 1.0 + Math.random()*0.6, sizeZ); const m=new THREE.MeshStandardMaterial({color:0xff4a4a,metalness:0.05,roughness:0.8}); const o=new THREE.Mesh(g,m); o.position.set(lanes[randomLaneIndex()],0.5,-160+Math.random()*40); o.userData={type:'obstacle'}; scene.add(o); obstacles.push(o); }

/* ---------- Game flow ---------- */
function clearObjects(){
  for(const c of coins) try{ scene.remove(c); if(c.geometry) c.geometry.dispose(); if(c.material) c.material.dispose(); }catch(e){}
  for(const b of boosts) try{ scene.remove(b); if(b.geometry) b.geometry.dispose(); if(b.material) b.material.dispose(); }catch(e){}
  for(const o of obstacles) try{ scene.remove(o); if(o.geometry) o.geometry.dispose(); if(o.material) o.material.dispose(); }catch(e){}
  coins = []; boosts = []; obstacles = [];
  for(const e of activeEffects) cleanupEffect(e);
  activeEffects.length = 0;
}

let bankedThisRun = false;

async function startGame(){
  bankedThisRun = false;
  await preloadAll();
  if(audioElements.music) playSound('music',{volume:0.45, loop:true});
  clearObjects();
  score = 0; elapsed = 0; speedMultiplier = 1; speedBoostTimer = 0;
  currentLane = 1; car.position.x = lanes[currentLane];
  coinTimer = 0.35 + Math.random()*0.2; boostTimer = 6 + Math.random()*6; obstacleTimer = 1.0 + Math.random()*0.6;
  applyInventoryOnStart();
  applySkinToCar(loadSave().selectedSkin);
  running = true; updateSaveUI();
  showToast('Good luck!', 'info', 1200);
}

function endGame(){
  running = false;
  onCrash();
  finalScoreEl.textContent = `FINAL SCORE: ${score}`;
  if(audioElements.music) stopSound('music');
  setBestIfHigher(score);
  gameOverScreen.style.display = 'block';
  updateSaveUI();
  showToast(`Game over — Score: ${score}`, 'error', 1600);
}

/* single button: save (bank) score, try server save, and restart */
async function saveAndRestart(){
  if(bankedThisRun){
    playSound('button',{volume:0.7});
    gameOverScreen.style.display = 'none';
    await startGame();
    return;
  }
  addToBalance(score);
  bankedThisRun = true;
  setBestIfHigher(score);
  playSound('button',{volume:0.7});
  try{ await sendScoreToServer(); showToast('Score sent to server', 'success', 1200); }catch(e){ /* ignore */ }
  gameOverScreen.style.display = 'none';
  await startGame();
}

async function sendScoreToServer(){
  try{
    const resp = await fetch('/api/highscore',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({score})});
    if(!resp.ok) throw new Error('server');
    return await resp.json();
  }catch(e){ throw e; }
}

saveRestartBtn.addEventListener('click', saveAndRestart);

/* ---------- Input handlers ---------- */
function attemptLane(dir){
  if(!running) return; if(inputCooldown>0) return;
  if(dir<0 && currentLane>0) currentLane--; if(dir>0 && currentLane<2) currentLane++;
  inputCooldown = cooldownTime; playSound('button',{volume:0.7});
}
// Input: WASD + Pfeiltasten (Arrow keys)
window.addEventListener('keydown', (e) => {
  // Verhindere Standardverhalten für Steuer-Tasten (z.B. Scrollen)
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','a','A','d','D','w','W','s','S'].includes(e.key)) {
    e.preventDefault();
  }

  // Links / Rechts -> Lanes wechseln
  if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') attemptLane(-1);
  if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') attemptLane(1);

  // Beschleunigen / Bremsen
  if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') keyState.accel = true;
  if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') keyState.brake = true;

  ensureAudioContext();
});

window.addEventListener('keyup', (e) => {
  // Beschleunigen / Bremsen ausschalten beim Loslassen (W/S oder Pfeile)
  if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') keyState.accel = false;
  if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') keyState.brake = false;
});
window.addEventListener('keyup', (e)=>{ if(e.key === 'w' || e.key === 'W') keyState.accel=false; if(e.key==='s'||e.key==='S') keyState.brake=false; });

let touchStartX=null, touchStartY=null, touchStartTime=0;
window.addEventListener('touchstart',(e)=>{
  if(!running) return;
  const t = e.touches[0]; touchStartX = t.clientX; touchStartY = t.clientY; touchStartTime = performance.now();
  const w = window.innerWidth; if(t.clientX < w/2) attemptLane(-1); else attemptLane(1);
},{passive:true});
window.addEventListener('touchend',(e)=>{
  if(!running) return;
  const t = e.changedTouches[0]; const dx = t.clientX - (touchStartX ?? t.clientX); const dy = t.clientY - (touchStartY ?? t.clientY);
  const dt = performance.now() - touchStartTime;
  if(Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) && dt < 500){ if(dx<0) attemptLane(-1); else attemptLane(1); }
  touchStartX = null; touchStartY = null;
});

/* Hinweis: hier kamen vorher pointer-Eventlistener für die mobilen Buttons. Die wurden entfernt,
   weil du die Buttons löschen willst. Wenn du die Buttons später wieder einfügst, füge sie ins HTML
   ein und registriere die Listener wieder — oder nutze optional chaining / guards. */

/* start/restart UI handlers */
startBtn.addEventListener('click', async ()=>{
  ensureAudioContext();
  if(audioContext && audioContext.state === 'suspended') audioContext.resume().catch(()=>{});
  playSound('button',{volume:0.7});
  startScreen.style.display = 'none';
  await startGame();
});

muteBtn.addEventListener('click', ()=>{ setMuteUI(!isMuted); });
volumeSlider.addEventListener('input', (e)=>{ masterVolume = parseFloat(e.target.value); localStorage.setItem('lr_volume', String(masterVolume)); });

/* ---------- Main Loop ---------- */
const clock = new THREE.Clock();

function animate(){
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  if(!running){ renderer.render(scene,camera); return; }

  elapsed += delta; if(inputCooldown>0) inputCooldown -= delta;

  const difficulty = Math.min(Infinity, 1 + elapsed*0.05);
  let forwardSpeed = baseSpeed * difficulty * speedMultiplier;
  if(keyState.accel) forwardSpeed *= 2;
  if(keyState.brake) forwardSpeed *= 0.3;
  if(speedBoostTimer > 0){ speedBoostTimer -= delta; forwardSpeed *= 1.8; }
  if(magnetTimer > 0) magnetTimer = Math.max(0, magnetTimer - delta);

  const moveAmount = forwardSpeed * delta;

  coinTimer -= delta; if(coinTimer <= 0){ spawnCoin(); coinTimer = 0.35 + Math.random()*0.6; }
  boostTimer -= delta; if(boostTimer <= 0){ spawnBoost(); boostTimer = 6 + Math.random()*8; }
  obstacleTimer -= delta; if(obstacleTimer <= 0){ if(Math.random()<0.82) spawnObstacle(); obstacleTimer = 0.9 + Math.random()*1.2; }

  for(const m of laneMarkers){ m.position.z += moveAmount; if(m.position.z > 30) m.position.z = -200 + Math.random()*10; }

  // coins
  for(const c of coins.slice()){
    c.position.z += moveAmount;
    c.rotation.y += delta*2;
    if(c.position.z > 10){ scene.remove(c); coins.splice(coins.indexOf(c),1); continue; }
    boxA.setFromObject(car); boxB.setFromObject(c);
    const magnetActive = magnetTimer > 0;
    if(magnetActive && Math.abs(c.position.x - car.position.x) < 2.4 && Math.abs(c.position.z - car.position.z) < 8){
      onCollectCoin(c); scene.remove(c); coins.splice(coins.indexOf(c),1); continue;
    }
    if(boxA.intersectsBox(boxB)){
      onCollectCoin(c); scene.remove(c); coins.splice(coins.indexOf(c),1); continue;
    }
  }

  // boosts
  for(const b of boosts.slice()){
    b.position.z += moveAmount;
    b.rotation.x += delta*(0.4 + b.userData.spin); b.rotation.y += delta*(0.6 + b.userData.spin*0.6);
    if(b.position.z > 10){ scene.remove(b); boosts.splice(boosts.indexOf(b),1); continue; }
    boxA.setFromObject(car); boxB.setFromObject(b);
    if(boxA.intersectsBox(boxB)){ onCollectBoost(b); scene.remove(b); boosts.splice(boosts.indexOf(b),1); continue; }
  }

  // obstacles
  for(const o of obstacles.slice()){
    o.position.z += moveAmount;
    if(o.position.z > 8){ scene.remove(o); obstacles.splice(obstacles.indexOf(o),1); continue; }
    boxA.setFromObject(car); boxB.setFromObject(o);
    if(boxA.intersectsBox(boxB)){
      if(consumeInv('extraLife')){
        showToast('Extra Life used!', 'info', 1200);
        scene.remove(o); obstacles.splice(obstacles.indexOf(o),1);
        continue;
      } else {
        endGame(); return;
      }
    }
  }

  // smooth lane movement
  const targetX = lanes[currentLane];
  car.position.x = THREE.MathUtils.lerp(car.position.x, targetX, Math.min(1, 10 * delta));
  car.position.z = THREE.MathUtils.lerp(car.position.z, 4 + Math.sin(elapsed*2)*0.02, 0.1);

  // update effects
  for(let i = activeEffects.length - 1; i >= 0; i--){
    const e = activeEffects[i];
    e.update(delta);
    e.life -= delta;
    if(e.life <= 0){ cleanupEffect(e); activeEffects.splice(i,1); }
  }

  // screen shake
  if(shakeTime > 0){
    shakeTime -= delta;
    const s = shakeIntensity * (shakeTime / 0.9);
    camera.position.x = (Math.random()*2-1) * s;
    camera.position.y = 6.5 + (Math.random()*2-1) * s * 0.3;
  } else {
    camera.position.x = 0; camera.position.y = 6.5;
  }

  scoreEl.textContent = `SCORE: ${score}`;
  speedEl.textContent = `SPEED: ${(forwardSpeed / baseSpeed).toFixed(2)}x`;

  renderer.render(scene, camera);
}

/* resize */
window.addEventListener('resize', ()=>{
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
});

/* init bootstrap */
async function bootstrap(){
  await preloadAll();
  applySkinToCar(loadSave().selectedSkin);
  updateSaveUI();
  animate();
}
bootstrap();

/* expose debug */
window._lr = { playSound, audioElements, loadSave, saveSave, addToBalance, consumeInv, buySkin, equipSkin, showToast };