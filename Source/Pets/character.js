import * as THREE from 'three';

// Custom Tone Mapping Shader Injection (dots-solid-grade-v2)
// Boosts vibrance and maintains matte velvety silicone appearance
const SILICONE_SHADER_GRADE = `
  float dotsHi = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b);
  float dotsLo = min(min(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b);
  float dotsChroma = dotsHi - dotsLo;
  float dotsLightness = (dotsHi + dotsLo) * 0.5;
  if (dotsChroma > 0.00001) {
    float dotsAvailable = 1.0 - abs(2.0 * dotsLightness - 1.0);
    float dotsSaturation = clamp(dotsChroma / max(dotsAvailable, 0.00001), 0.0, 1.0);
    float dotsGain = (1.0 - pow(1.0 - dotsSaturation, 2.0)) / max(dotsSaturation, 0.00001);
    gl_FragColor.rgb = mix(vec3(dotsLightness), gl_FragColor.rgb, dotsGain);
  }
`;

/**
 * Configure materials to match OpenAI's silicone PBR look
 */
export function setupMaterials(scene, characterName) {
  const materialMap = new Map();

  function customizeMaterial(origMat) {
    if (materialMap.has(origMat)) return materialMap.get(origMat);
    const mat = origMat.clone();

    if ('metalness' in mat) mat.metalness = 0;
    if ('clearcoat' in mat) mat.clearcoat = 0;
    if ('transmission' in mat) mat.transmission = 0;

    const name = origMat.name || '';

    // Body silicone
    if (name.endsWith('soft matte silicone') || name.endsWith(' - Body')) {
      mat.roughness = 0.52;
      if (characterName === 'Alfred') mat.color.set('#ffc120'); // Vibrant warm yellow
      if (characterName === 'Felipe') mat.color.set('#35a0fd'); // Vivid electric blue
      if (characterName === 'Iggy')   mat.color.set('#da61dc'); // Magenta purple
      if ('specularIntensity' in mat) mat.specularIntensity = 0.9;
    }

    // Accessories (Hat, bowtie, glasses)
    if (name === 'Accessories · soft charcoal' || /^(Bowtie|Glasses|Hat|Jojo - Glasses)/i.test(name)) {
      mat.color.set('#2d2e2f');
      mat.roughness = 0.5;
      if ('specularIntensity' in mat) mat.specularIntensity = 1.0;
    }

    // Eyes
    if (name === 'Eyes · deep charcoal' || /^Eyes/i.test(name)) {
      mat.roughness = 0.55;
    }

    // Tone mapping shader
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <colorspace_fragment>',
        `#include <colorspace_fragment>\n#ifdef TONE_MAPPING\n${SILICONE_SHADER_GRADE}\n#endif`
      );
    };
    mat.customProgramCacheKey = () => 'dots-solid-grade-v2';

    materialMap.set(origMat, mat);
    return mat;
  }

  scene.traverse((child) => {
    child.frustumCulled = false;
    if (child.isMesh) {
      if (Array.isArray(child.material)) {
        child.material = child.material.map(customizeMaterial);
      } else if (child.material) {
        child.material = customizeMaterial(child.material);
      }
    }
  });

  return materialMap;
}

const SPINE_BONES = ['body_base', 'body_lower', 'body_mid', 'body_upper', 'body_top'];
const SPINE_WEIGHTS = [0, 0.25, 0.35, 0.25, 0.15];

/**
 * Character Rig Controller
 */
export class CharacterRig {
  constructor(name, gltfScene) {
    this.name = name;
    this.scene = gltfScene;

    // Cache bones
    this.bones = new Map();
    this.controls = new Map();
    this.skeletons = new Set();

    this.scene.traverse((child) => {
      child.frustumCulled = false;
      if (child.isBone) {
        this.bones.set(child.name, child);
        if (child.name.endsWith('_CTRL')) {
          this.controls.set(child.name, {
            bone: child,
            initialPos: child.position.clone(),
            initialRot: child.quaternion.clone(),
            initialScale: child.scale.clone()
          });
        }
      }
      if (child.isSkinnedMesh) {
        this.skeletons.add(child.skeleton);
      }
    });

    // Compute bounding box & center
    this.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.scene);
    this.center = box.getCenter(new THREE.Vector3());
    this.size = box.getSize(new THREE.Vector3());

    // Center geometry around origin
    this.scene.position.copy(this.center).negate();

    // Cache initial bone transforms
    this.initialBoneTransforms = new Map();
    this.bones.forEach((bone, bName) => {
      this.initialBoneTransforms.set(bName, {
        pos: bone.position.clone(),
        rot: bone.quaternion.clone(),
        scale: bone.scale.clone()
      });
    });

    // Scratch Math objects for fast per-frame updates
    this._q1 = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._axisX = new THREE.Vector3(1, 0, 0);
    this._axisY = new THREE.Vector3(0, 1, 0);
    this._axisZ = new THREE.Vector3(0, 0, 1);
    this._vec = new THREE.Vector3();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  /**
   * Apply pose, squash/stretch, head tilt, eye tracking and accessory inertia
   */
  pose({
    eyeX = 0,
    eyeY = 0,
    bendSide = 0,
    bendForward = 0,
    squash = 0,
    pitch = 0,
    yaw = 0,
    roll = 0,
    accLag = { x: 0, y: 0 }
  } = {}) {
    // 1. Spine bending
    SPINE_BONES.forEach((bName, idx) => {
      const bone = this.bones.get(bName);
      if (!bone) return;
      const init = this.initialBoneTransforms.get(bName);
      const w = SPINE_WEIGHTS[idx];

      this._q1.setFromAxisAngle(this._axisZ, bendSide * w);
      this._q2.setFromAxisAngle(this._axisX, bendForward * w);
      bone.quaternion.copy(init.rot).multiply(this._q1).multiply(this._q2);
    });

    // 2. Base squash & stretch scale
    const baseBone = this.bones.get('body_base');
    if (baseBone) {
      const s = 1 - squash;
      const sSquish = 1 / Math.sqrt(Math.max(s, 0.1));
      baseBone.scale.set(sSquish, s, sSquish);
    }

    // 3. Eye / Face cursor tracking
    const faceCtrl = this.controls.get('Face_CTRL');
    if (faceCtrl) {
      faceCtrl.bone.position.x = faceCtrl.initialPos.x + eyeX * this.size.y * 0.035;
      faceCtrl.bone.position.y = faceCtrl.initialPos.y + eyeY * this.size.y * 0.018;
    }

    const eyeL = this.controls.get('Eye_L_CTRL');
    const eyeR = this.controls.get('Eye_R_CTRL');
    if (eyeL) {
      this._q1.setFromAxisAngle(this._axisY, eyeX * 0.2);
      this._q2.setFromAxisAngle(this._axisX, -eyeY * 0.12);
      eyeL.bone.quaternion.copy(eyeL.initialRot).multiply(this._q1).multiply(this._q2);
    }
    if (eyeR) {
      this._q1.setFromAxisAngle(this._axisY, eyeX * 0.2);
      this._q2.setFromAxisAngle(this._axisX, -eyeY * 0.12);
      eyeR.bone.quaternion.copy(eyeR.initialRot).multiply(this._q1).multiply(this._q2);
    }

    // 4. Accessories (Hat, Glasses, Sunglasses, BowTie) inertia
    const beretCtrl = this.controls.get('Beret_CTRL');
    if (beretCtrl) {
      this._q1.setFromAxisAngle(this._axisZ, -accLag.x * 2.5);
      this._q2.setFromAxisAngle(this._axisX, accLag.y * 1.5);
      beretCtrl.bone.quaternion.copy(beretCtrl.initialRot).multiply(this._q1).multiply(this._q2);
      beretCtrl.bone.position.y = beretCtrl.initialPos.y + accLag.y * this.size.y * 0.2;
    }

    const glassesCtrl = this.controls.get('Glasses_CTRL') || this.controls.get('Sunglasses_CTRL');
    if (glassesCtrl) {
      this._q1.setFromAxisAngle(this._axisZ, -accLag.x * 1.8);
      this._q2.setFromAxisAngle(this._axisX, accLag.y * 1.2);
      glassesCtrl.bone.quaternion.copy(glassesCtrl.initialRot).multiply(this._q1).multiply(this._q2);
    }

    const bowtieCtrl = this.controls.get('BowTie_CTRL');
    if (bowtieCtrl) {
      this._q1.setFromAxisAngle(this._axisZ, -accLag.x * 3.0);
      bowtieCtrl.bone.quaternion.copy(bowtieCtrl.initialRot).multiply(this._q1);
    }

    // Update skeletons
    this.skeletons.forEach((s) => s.update());
  }
}
