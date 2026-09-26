import { installControls, reportSceneError, preferredQuality } from '../../shared/controls.js';
import { createComposite } from './composite.js';
import * as THREE from "three";
import { createEnvironment, createParticles } from "./environment.js";
import { createPlants } from "./plants.js";
import { createFishSchool } from "./fish.js";
import { createFood } from "./food.js";
import { createCherryShrimp } from "./cherry-shrimp.js";
import { createDistantPlanting, createWaterSurface } from "./depth-backdrop.js";
import { randomGenerator } from "./math.js";
import { waterTime } from "./water.js";
import { createFrameLoop } from "../../shared/frame-loop.js";
import { renderSettings, framebufferSize, qualityName, frameRate, QUALITY_STORAGE_KEY } from "./render-policy.js";
import { createPointerTracker } from "./interaction.js";

const canvas = document.querySelector("#scene");
const habitat = document.querySelector("#habitat");
const loading = document.querySelector("#loading");
const pointerTracker = createPointerTracker();
// A page that says the host owns its motion leaves the system's reduced-motion
// preference to the host, which is the only one that can offer a way back: the wallpaper
// sits at the desktop window level and never sees a key, so a preview's Space would never
// reach it and the water would be frozen for good. The preview keeps the preference
// itself, where Space can clear it.
let paused =
  document.documentElement.dataset.motion !== "host" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;
const query = new URLSearchParams(location.search);
const wallpaper = document.documentElement.dataset.motion === "host";
let profile = query.get("quality") === "reference" ? "reference" : preferredQuality(query, {
  storageKey: QUALITY_STORAGE_KEY, normalize: qualityName, defaultQuality: 'ultra',
});
if (query.get("still") === "1" || query.has("capture")) paused = true;
if (query.has("capture")) document.body.classList.add("clean", "capture");
let onBattery = false;
let settings = renderSettings({ profile, wallpaper, pixelRatio: devicePixelRatio });
let requestedRate = wallpaper ? 0 : 60;
let loop = null, applyPower = null, updateControls = () => {};
window.habitatPause = (value) => {
  paused = Boolean(value);
  if (paused) pointerTracker.clear();
  loop?.setPaused(paused);
  updateControls();
};
window.habitatRate = (fps) => {
  requestedRate = Number.isFinite(fps) && fps > 0 ? Math.min(120, fps) : 0;
  if (!requestedRate) pointerTracker.clear();
  loop?.setRate(frameRate(profile, requestedRate, onBattery));
  updateControls();
};
// Geometry never changes on a power transition: no plant popping or regeneration.
window.habitatPower = (battery) => {
  const next = Boolean(battery);
  if (next === onBattery) return;
  onBattery = next;
  settings = renderSettings({ profile, wallpaper, pixelRatio: devicePixelRatio, onBattery });
  applyPower?.();
  loop?.setRate(frameRate(profile, requestedRate, onBattery));
  updateControls();
};
window.habitatQuality = (value) => {
  const next = qualityName(value);
  if (next === profile) return;
  profile = next;
  settings = renderSettings({ profile, wallpaper, pixelRatio: devicePixelRatio, onBattery });
  applyPower?.();
  loop?.setRate(frameRate(profile, requestedRate, onBattery));
  updateControls();
};
// A pinch of food, for a host with no pointer to click with. Defined before the scene
// exists and harmless until it does. Nothing is dropped into water that is not moving,
// whichever of the two reasons it is still for: pellets nobody is drawing are pellets the
// fish never see, and they would all arrive at once whenever the water started again.
let sprinkle = null;
window.habitatFeed = () => {
  if (sprinkle && loop?.state.running) sprinkle();
};



async function start() {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: settings.powerPreference,
  });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.info.autoReset = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#aeb9b7");
  // Clear planted-tank water: preserve the foreground's detail while distant planting
  // takes a little of the pale light behind the aquarium.
  scene.fog = new THREE.FogExp2("#acbdb4", 0.009);
  const camera = new THREE.PerspectiveCamera(25.8, 1420 / 740, 0.2, 65);
  // About 20% farther back, with a little more elevation to reveal the winding path.
  camera.position.set(0, 6.4, 24.6);
  camera.lookAt(0, 4.75, 0);

  // Overhead lamp with a soft skylight-like fill; the back light passes through the
  // thin leaves and reads as their translucency.
  scene.add(new THREE.HemisphereLight(0xe3f0d9, 0x62604b, 0.65));
  const key = new THREE.DirectionalLight(0xfff8ee, 4.5);
  key.position.set(-3, 11.5, 4.4);
  key.target.position.set(0, 1, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(settings.shadowSize, settings.shadowSize);
  // The frustum reaches the foot of the backboard behind the right-hand bed; a fragment
  // outside the shadow map is lit as if nothing stood in front of it.
  Object.assign(key.shadow.camera, {
    left: -12,
    right: 12,
    top: 14,
    bottom: -10,
    near: 1,
    far: 27,
  });
  key.shadow.bias = -0.00012;
  key.shadow.normalBias = 0.018;
  // Keep the filter footprint approximately the same in world space.
  key.shadow.radius = 3 * settings.shadowSize / 4096;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xdce9e8, 0.85);
  fill.position.set(1, 5, 10);
  scene.add(fill);
  const back = new THREE.DirectionalLight(0xe4f5c6, 1.15);
  back.position.set(2, 10, -4);
  scene.add(back);

  // A compact HDR environment gives silver scales a broad overhead reflection.
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color("#405b4d");
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 4),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.7, 3.8, 3.4),
      side: THREE.DoubleSide,
    }),
  );
  strip.position.set(0, 6, 1);
  strip.rotation.x = Math.PI / 2;
  envScene.add(strip);
  const frontBounce = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 8),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.24, 0.32, 0.29),
      side: THREE.DoubleSide,
    }),
  );
  frontBounce.position.z = 8;
  envScene.add(frontBounce);
  // Reflections of the room and aquarium lamp add shape to a turning cheek and a
  // small catchlight to the cornea. These cards are baked once into the environment.
  const reflectionCards = [[-4, 3.0, 7, 3.5, 1.1, 1.65], [5, 1.8, 6, 2, 4, 0.50],
    [-1.5, 1.8, 8, 2.2, 0.65, 1.8]].map(
    ([x, y, z, width, height, brightness]) => {
      const card = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(brightness, brightness * 1.04,
          brightness * 1.02), side: THREE.DoubleSide }));
      card.position.set(x, y, z);
      card.lookAt(0, 0, 0);
      envScene.add(card);
      return card;
    });
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0.025, 0.1, 30);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.65;
  pmrem.dispose();
  strip.geometry.dispose();
  strip.material.dispose();
  frontBounce.geometry.dispose();
  frontBounce.material.dispose();
  for (const card of reflectionCards) { card.geometry.dispose(); card.material.dispose(); }

  // A softly illuminated aquarium backing, warm near the substrate and cooler above.
  // Its light makes the fine plant silhouettes legible without adding a render pass.
  const backboard = new THREE.Mesh(
    new THREE.PlaneGeometry(58, 26),
    new THREE.ShaderMaterial({
      uniforms: {
        upper: { value: new THREE.Color("#778e80") },
        lower: { value: new THREE.Color("#384d3f") },
        horizon: { value: new THREE.Color("#9bac93") },
      },
      vertexShader: `varying float height;
        void main(){vec4 p=modelMatrix*vec4(position,1.);height=p.y;
        gl_Position=projectionMatrix*viewMatrix*p;}`,
      fragmentShader: `uniform vec3 upper;uniform vec3 lower;uniform vec3 horizon;varying float height;
        void main(){vec3 color=mix(lower,horizon,smoothstep(.4,5.5,height));
        color=mix(color,upper,smoothstep(5.5,11.,height));
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
      depthWrite: true,
    }),
  );
  backboard.position.set(0, 7, -18.5);
  backboard.receiveShadow = true;
  scene.add(backboard);
  const { obstacles, landmarks, support } = await createEnvironment(scene, {
    anisotropy: Math.min(16, renderer.capabilities.getMaxAnisotropy()),
  });
  const plants = createPlants(scene, {
    ...settings, animatedShadows: profile !== "reference",
  });
  const background = createDistantPlanting(scene);
  const waterSurface = createWaterSurface(scene);
  const food = createFood(scene, { thickets: plants.thickets });
  const fish = createFishSchool(scene, {
    obstacles,
    landmarks,
    thickets: plants.thickets,
    food,
  });
  const shrimp = createCherryShrimp(scene, { support, obstacles });
  const particles = createParticles(scene, { thickets: plants.thickets });

  const { target, post, postScene, postCamera } = createComposite(camera, settings);

  let contextLost = false, zeroSize = false, forceShadows = true;
  const maxDimension = Math.min(renderer.capabilities.maxTextureSize,
    renderer.getContext().getParameter(renderer.getContext().MAX_RENDERBUFFER_SIZE));
  function visibility() {
    if (document.hidden || contextLost || zeroSize) pointerTracker.clear();
    loop?.setHidden(document.hidden || contextLost || zeroSize);
    updateControls();
  }
  function resize() {
    const bounds = canvas.getBoundingClientRect();
    // DPR may change when a preview moves between monitors.
    settings = renderSettings({ profile, wallpaper, pixelRatio: devicePixelRatio, onBattery });
    if (key.shadow.mapSize.x !== settings.shadowSize) {
      key.shadow.mapSize.set(settings.shadowSize, settings.shadowSize);
      key.shadow.map?.dispose();
      key.shadow.map = null;
      forceShadows = true;
    }
    key.shadow.radius = 3 * settings.shadowSize / 4096;
    post.uniforms.aoSamples.value = settings.aoSamples;
    post.uniforms.clarity.value = settings.clarity;
    const dimensions = framebufferSize(bounds.width, bounds.height, settings.resolution, maxDimension, settings.maxPixels);
    zeroSize = !dimensions;
    visibility();
    if (!dimensions) return;
    const { width, height } = dimensions;
    if (target.width !== width || target.height !== height) {
      pointerTracker.clear();
      renderer.setSize(width, height, false);
      target.setSize(width, height);
      post.uniforms.size.value.set(width, height);
      camera.aspect = bounds.width / bounds.height;
      camera.updateProjectionMatrix();
      particles.update(height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
      forceShadows = true;
      loop?.invalidate();
    }
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(habitat);
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", visibility);
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    visibility();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    // The prefiltered HDR environment is GPU-generated and cannot be recovered just
    // by reuploading CPU textures. Rebuild the scene once instead of rendering black.
    location.reload();
  });
  applyPower = () => { forceShadows = true; resize(); loop?.invalidate(); };
  resize();

  // The pointer is a hand at the front glass. The fish read where it is and how fast it
  // is coming toward them, so its velocity is kept, smoothed over a few events, and let
  // die away once the events stop.
  const pointerPosition = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const waterPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -2.6);
  canvas.addEventListener("pointermove", (event) => {
    if (!loop?.state.running) return;
    const bounds = canvas.getBoundingClientRect();
    const normalized = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(normalized, camera);
    if (raycaster.ray.intersectPlane(waterPlane, pointerPosition)) {
      pointerTracker.move(pointerPosition, performance.now());
      // Shrimp also use the actual cursor ray, so a deep trunk and a front stone
      // react at the same screen position without changing tetra behaviour.
      pointerTracker.state.ray = raycaster.ray.clone();
    }
  });
  canvas.addEventListener("pointerleave", () => {
    pointerTracker.clear();
  });
  canvas.addEventListener("pointercancel", () => pointerTracker.clear());

  // Clicking the water drops a pinch of food where the click was. The ray is cast again
  // here rather than reusing the hovering pointer, because a touch or a pen presses
  // before it ever moves and there would be nothing to reuse. Only the horizontal place
  // is taken from the click: food is sprinkled onto the surface wherever it landed, and
  // how far back in the tank each pellet falls is food.js's own business, since a click
  // can only ever say two of the three things.
  const dropPoint = new THREE.Vector3();
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary || !loop?.state.running) return;
    const bounds = canvas.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
      ),
      camera,
    );
    if (raycaster.ray.intersectPlane(waterPlane, dropPoint)) food.drop(dropPoint);
  });
  // The same pinch without a click, for the wallpaper's menu: the cursor is up in the
  // menu bar at that moment, so the food goes over the open middle of the tank instead,
  // in a different place each time.
  const scatter = randomGenerator(715249);
  sprinkle = () => {
    food.drop(dropPoint.set(-3.6 + scatter() * 7.2, 0, 0));
  };

  updateControls = installControls({
    habitat, isPaused: () => paused,
    isRunning: () => Boolean(loop?.state.running),
    pause: window.habitatPause, feed: window.habitatFeed,
    quality: () => profile === 'reference' ? 'detail' : profile,
    qualityStorageKey: QUALITY_STORAGE_KEY,
    setQuality: window.habitatQuality,
  });
  // Fish/food use instance matrices; foliage and particles move in shaders. Shrimp
  // update their root matrices explicitly. Everything else is static.
  scene.traverse((object) => { object.updateMatrix(); object.matrixAutoUpdate = false; });
  scene.updateMatrixWorld(true);
  let time = 0, lastShadowTime = -Infinity, renderedFrames = 0, shadowFrames = 0;
  // Optional deterministic screenshots use the same simulation, geometry and renderer.
  if (query.has("capture")) {
    const duration = Math.min(120, Math.max(0, Number(query.get("time")) || 0));
    for (let i = 0; i < Math.round(duration * 60); i++) {
      time += 1 / 60;
      waterTime.value = time;
      food.update(1 / 60, time);
      fish.update(1 / 60, time, null);
      shrimp.update(1 / 60);
    }
  }
  let ready = false;
  function renderFrame(dt, now) {
    // Short substeps keep feeding/swimming stable at 20/30 fps without slowing the
    // simulation down. Long suspended periods never reach this function as elapsed time.
    // Equal steps, rounded to the nearest 60 Hz count: one at 60 fps, two at 30, three
    // at 20. Timer jitter must not turn one step into a full step plus a sliver.
    const total = Math.min(0.1, dt);
    const steps = Math.max(1, Math.round(total * 60));
    const step = total / steps;
    for (let i = 0; total > 0 && i < steps; i++) {
      time += step;
      waterTime.value = time;
      food.update(step, time);
      const pointer = pointerTracker.update(step, now);
      fish.update(step, time, pointer);
      shrimp.update(step, pointer);
    }
    waterSurface.updateReflection(renderer, camera);
    const refreshShadow = forceShadows || time - lastShadowTime + 1e-7 >= 1 / settings.shadowHz;
    renderer.shadowMap.needsUpdate = refreshShadow;
    if (refreshShadow) {
      lastShadowTime = time;
      forceShadows = false;
      shadowFrames++;
    }
    renderer.info.reset();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCamera);
    renderedFrames++;
    if (!ready) {
      ready = true;
      loading.style.opacity = 0;
      setTimeout(() => { loading.hidden = true; }, 850);
    }
  }
  loop = createFrameLoop(renderFrame, {
    fps: frameRate(profile, requestedRate, onBattery), paused, hidden: document.hidden || zeroSize || contextLost,
  });
  updateControls();
  window.habitatStats = () => ({
    profile, onBattery, resolution: settings.resolution,
    framebuffer: [target.width, target.height], samples: target.samples,
    shadowSize: settings.shadowSize, aoSamples: settings.aoSamples,
    shadowHz: Number.isFinite(settings.shadowHz) ? settings.shadowHz : "per-frame",
    renderedFrames, shadowFrames, simulationTime: time,
    drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    plants: { ...plants.stats }, background, loop: loop.state,
    fish: fish.getTelemetry(), shrimp: shrimp.getTelemetry(), food: { ...food.stats },
    pointer: pointerTracker.state ? {
      speed: pointerTracker.state.velocity.length(), stillFor: pointerTracker.state.stillFor,
    } : null,
  });
  // Diagnostics are opt-in: no timing queries, synchronization or arrays in normal use.
  if (query.get("diagnostics") === "1") {
    const { installDiagnostics } = await import("../../shared/diagnostics.js");
    installDiagnostics({ renderer, loop, renderFrame, stats: window.habitatStats });
  }
  window.addEventListener("pagehide", () => {
    pointerTracker.clear();
    loop.setHidden(true);
  });
  window.addEventListener("pageshow", visibility);

}

start().catch(reportSceneError);
