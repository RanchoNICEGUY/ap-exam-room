// Run from Source to rebuild the classic script used by both offline apps:
// esbuild Pets/room-pets.js --bundle --format=iife --target=safari16,chrome110 --minify --alias:three=./Pets/vendor/three.module.js --loader:.glb=dataurl --loader:.png=dataurl --outfile=Assets/RoomPets.js
import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { CharacterRig, setupMaterials } from './character.js';
import felipeModel from './models/felipe.glb';
import alfredModel from './models/alfred.glb';
import iggyModel from './models/iggy.glb';
import toddModel from './models/todd.glb';
import felipePortrait from './portraits/felipe-profile.png';
import alfredPortrait from './portraits/alfred-profile.png';
import iggyPortrait from './portraits/iggy-profile.png';
import toddPortrait from './portraits/todd-profile.png';

const pets = [
  { name: 'Felipe', model: felipeModel, portrait: felipePortrait, height: 1.53, yaw: 0.13 },
  { name: 'Alfred', model: alfredModel, portrait: alfredPortrait, height: 1.38, yaw: 0.06 },
  { name: 'Iggy', model: iggyModel, portrait: iggyPortrait, height: 1.40, yaw: -0.06 },
  { name: 'Todd', model: toddModel, portrait: toddPortrait, height: 1.30, yaw: -0.13 }
];

class PetGaze {
  constructor(app) {
    this.app = app;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.canvas = document.createElement('canvas');
    this.portraits = document.createElement('div');
    this.portraits.className = 'room-dots-portraits';
    for (const pet of pets) {
      const image = document.createElement('img');
      image.src = pet.portrait;
      image.alt = '';
      this.portraits.append(image);
    }
    this.pointer = null;
    this.frame = 0;
    this.rigs = [];
    this.resizeObserver = new ResizeObserver(() => this.schedule());
    this.canvas.addEventListener('webglcontextlost', () => {
      this.contextLost = true;
      this.updatePresentation();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.updatePresentation();
    });
    // The question bank replaces #app's children during navigation and filtering.
    new MutationObserver(() => this.mount()).observe(app, {childList: true});
    this.motion.addEventListener('change', () => this.updatePresentation());
    window.addEventListener('pointermove', event => {
      if (!this.host || !this.canDraw || event.pointerType === 'touch') return;
      this.pointer = {x: event.clientX, y: event.clientY};
      this.schedule();
    }, {passive: true});
    document.documentElement.addEventListener('pointerleave', () => this.resetGaze());
    window.addEventListener('blur', () => this.resetGaze());
    this.mount();
  }

  mount() {
    const next = this.app.querySelector('.room-dots');
    if (next === this.host) return;
    this.resizeObserver.disconnect();
    this.host = next;
    if (!next) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.pointer = null;
      return;
    }
    next.append(this.portraits, this.canvas);
    this.resizeObserver.observe(next);
    this.updatePresentation();
  }

  resetGaze() {
    this.pointer = null;
    this.schedule();
  }

  updatePresentation() {
    if (!this.host) return;
    if (!this.motion.matches && !this.loadStarted) {
      this.loadStarted = true;
      this.load().then(() => {
        this.loaded = true;
        this.updatePresentation();
      }).catch(error => console.warn('AP Exam Room pets:', error));
    }
    this.canDraw = Boolean(this.loaded && !this.motion.matches && !this.contextLost);
    this.portraits.hidden = this.canDraw;
    this.canvas.hidden = !this.canDraw;
    this.schedule();
  }

  async load() {
    this.renderer = new THREE.WebGLRenderer({canvas: this.canvas, alpha: true, antialias: true});
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.93;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-3, 3, 1, -1, 0.1, 50);
    this.camera.position.z = 12;

    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(-3, 5, 4);
    const rim = new THREE.DirectionalLight(0xffeedd, 1.1);
    rim.position.set(4, 2, -2);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.8),
      new THREE.HemisphereLight(0xffffff, 0xd8e3f0, 0.45), key, rim);

    const loader = new GLTFLoader();
    this.rigs = await Promise.all(pets.map(async pet => {
      // Parse the embedded GLB locally so the portable file works without fetch or a server.
      const base64 = pet.model.slice(pet.model.indexOf(',') + 1);
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      const {scene} = await loader.parseAsync(bytes.buffer, '');
      setupMaterials(scene, pet.name);
      const rig = new CharacterRig(pet.name, scene);
      const model = new THREE.Group();
      model.scale.setScalar(pet.height / rig.size.y);
      model.add(scene);
      const pivot = new THREE.Group();
      pivot.add(model);
      this.scene.add(pivot);
      return {pet, rig, pivot, gazeX: 0, gazeY: 0};
    }));
  }

  schedule() {
    if (!this.host || !this.canDraw || this.frame) return;
    this.frame = requestAnimationFrame(() => this.draw());
  }

  draw() {
    this.frame = 0;
    if (!this.host || !this.canDraw) return;
    const rect = this.host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width !== this.width || height !== this.height || ratio !== this.ratio) {
      this.width = width;
      this.height = height;
      this.ratio = ratio;
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(width, height, false);
      this.camera.left = -width / height;
      this.camera.right = width / height;
      this.camera.updateProjectionMatrix();
    }
    let moving = false;
    for (const [index, character] of this.rigs.entries()) {
      const {rig, pivot, pet} = character;
      const fraction = (index + 0.5) / this.rigs.length;
      const centerX = rect.left + rect.width * fraction;
      const centerY = rect.top + rect.height * (0.92 - pet.height / 4);
      const targetX = this.pointer ? Math.tanh((this.pointer.x - centerX) / 135) : 0;
      const targetY = this.pointer ? Math.tanh((centerY - this.pointer.y) / 110) : 0;
      character.gazeX += (targetX - character.gazeX) * 0.28;
      character.gazeY += (targetY - character.gazeY) * 0.28;
      moving ||= Math.abs(targetX - character.gazeX) + Math.abs(targetY - character.gazeY) > 0.005;

      pivot.position.set((fraction - 0.5) * width / height * 2, -0.83 + pet.height / 2, 0);
      pivot.rotation.set(-character.gazeY * 0.24, pet.yaw + character.gazeX * 0.56, -character.gazeX * 0.05);
      rig.pose({eyeX: character.gazeX, eyeY: character.gazeY, bendSide: -character.gazeX * 0.11});
    }
    this.renderer.render(this.scene, this.camera);
    if (moving) this.schedule();
  }
}

const app = document.getElementById('app');
if (app) new PetGaze(app);
