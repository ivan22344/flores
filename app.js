window.addEventListener('load', () => {
  const container = document.getElementById('canvas-container');

  // --- State ---
  const state = {
    roseCount: 15,
    bloomFactor: 0.8,
    shade: 'crimson',
    wrapStyle: 'kraft',
    ambience: 'romantic',
    fallingPetals: true,
    autoRotate: true,
    showGypsophila: true
  };

  const shadePalettes = {
    crimson:  { core: 0x590814, mid: 0xb91c1c, outer: 0xdc2626, sheen: 0x3b040c },
    scarlet:  { core: 0x7a0916, mid: 0xef233c, outer: 0xff4d6d, sheen: 0x45050c },
    burgundy: { core: 0x300309, mid: 0x6b0f1a, outer: 0x9b1b30, sheen: 0x240207 },
    ruby:     { core: 0x640614, mid: 0xd90429, outer: 0xef233c, sheen: 0x3d030b },
    coral:    { core: 0x80111f, mid: 0xe63946, outer: 0xff6b6b, sheen: 0x4a0810 }
  };

  const wrapPalettes = {
    kraft: { outer: 0xc89f74, inner: 0xe6ccb2, ribbon: 0x9e1124 },
    noir:  { outer: 0x1a191e, inner: 0x2d2b36, ribbon: 0xd4af37 },
    cream: { outer: 0xf3ead8, inner: 0xfffdf9, ribbon: 0x720926 },
    blush: { outer: 0xf4acb7, inner: 0xffcad4, ribbon: 0xb51736 }
  };

  // --- Scene, Camera, Renderer ---
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0f070a, 0.025);

  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
  const spherical = { radius: 13.5, theta: 0.3, phi: 1.18, targetY: 0.8 };

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  // --- Lights ---
  const ambientLight = new THREE.AmbientLight(0xffd6e0, 0.55);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xfff0e6, 1.35);
  keyLight.position.set(6, 11, 7);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 1024;
  keyLight.shadow.mapSize.height = 1024;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0xff4d6d, 0.9);
  rimLight.position.set(-7, 6, -6);
  scene.add(rimLight);

  const warmPointLight = new THREE.PointLight(0xff758f, 1.1, 18);
  warmPointLight.position.set(0, 4.5, 3.5);
  scene.add(warmPointLight);

  // --- Reusable Petal Geometry Builder ---
  function createCurvedPetalGeometry(width, height, curvature, cupAmount) {
    const geo = new THREE.PlaneGeometry(width, height, 10, 12);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      // Normalize y from [0, 1] where 0 is base and 1 is tip
      const ny = (y + height / 2) / height;
      const nx = x / (width / 2);

      // Taper base, round wider upper half
      const widthProfile = Math.sin(Math.pow(ny, 0.65) * Math.PI) * 0.92 + (1 - ny) * 0.22;
      x *= widthProfile;

      // Cupping curve across width + outward curl at top tip
      const cupZ = -Math.pow(nx, 2) * cupAmount * Math.sin(ny * Math.PI);
      const bendZ = Math.sin(ny * Math.PI * 0.85) * curvature * 0.5;
      const tipCurlZ = ny > 0.68 ? -Math.pow((ny - 0.68) / 0.32, 2) * (curvature * 0.9) : 0;

      pos.setXYZ(i, x, ny * height, cupZ + bendZ + tipCurlZ);
    }
    geo.computeVertexNormals();
    return geo;
  }

  const petalGeometries = [
    createCurvedPetalGeometry(0.42, 0.62, 0.18, 0.22), // inner bud layer
    createCurvedPetalGeometry(0.58, 0.76, 0.28, 0.28), // inner-mid
    createCurvedPetalGeometry(0.75, 0.90, 0.38, 0.34), // mid
    createCurvedPetalGeometry(0.92, 1.05, 0.52, 0.38), // outer
    createCurvedPetalGeometry(1.08, 1.15, 0.68, 0.42)  // outermost guard petals
  ];

  // Leaf geometry
  function createLeafGeometry() {
    const geo = new THREE.PlaneGeometry(0.52, 0.95, 6, 8);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      const ny = (y + 0.475) / 0.95;
      const profile = Math.sin(ny * Math.PI);
      x *= profile;
      const z = -Math.abs(x) * 0.22 - Math.pow(ny, 2) * 0.18;
      pos.setXYZ(i, x, ny * 0.95, z);
    }
    geo.computeVertexNormals();
    return geo;
  }
  const sharedLeafGeo = createLeafGeometry();

  // --- Groups ---
  const bouquetGroup = new THREE.Group();
  scene.add(bouquetGroup);

  const rosesGroup = new THREE.Group();
  const wrapGroup = new THREE.Group();
  const gypsophilaGroup = new THREE.Group();
  bouquetGroup.add(rosesGroup);
  bouquetGroup.add(wrapGroup);
  bouquetGroup.add(gypsophilaGroup);

  let interactiveRoseHeads = [];

  // --- Build Single Rose ---
  function createRose(targetPos, stemBottomPos, scale, palette, seed) {
    const roseRoot = new THREE.Group();

    // 1. Curved Stem from stemBottomPos to targetPos
    const midPoint = new THREE.Vector3().lerpVectors(stemBottomPos, targetPos, 0.52);
    midPoint.x *= 0.62;
    midPoint.z *= 0.62;
    const stemCurve = new THREE.QuadraticBezierCurve3(stemBottomPos, midPoint, targetPos);
    const stemGeo = new THREE.TubeGeometry(stemCurve, 18, 0.055 * scale, 8, false);
    const stemMat = new THREE.MeshStandardMaterial({
      color: 0x1e4620,
      roughness: 0.65,
      metalness: 0.05
    });
    const stemMesh = new THREE.Mesh(stemGeo, stemMat);
    stemMesh.castShadow = true;
    roseRoot.add(stemMesh);

    // 2. Leaves along the upper stem
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x265928,
      roughness: 0.5,
      metalness: 0.08,
      side: THREE.DoubleSide
    });
    for (let l = 0; l < 2; l++) {
      const t = 0.55 + l * 0.18;
      const pt = stemCurve.getPoint(t);
      const leafMesh = new THREE.Mesh(sharedLeafGeo, leafMat);
      leafMesh.position.copy(pt);
      const angle = seed * 4.1 + l * Math.PI * 0.95;
      leafMesh.rotation.set(0.55, angle, 0.25);
      leafMesh.scale.setScalar(scale * 0.85);
      roseRoot.add(leafMesh);
    }

    // 3. Flower Head oriented along stem tangent
    const headGroup = new THREE.Group();
    headGroup.position.copy(targetPos);

    const tangent = stemCurve.getTangent(1.0).normalize();
    const upVec = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(upVec, tangent);
    headGroup.quaternion.copy(quat);
    headGroup.scale.setScalar(scale);

    // Receptacle / Calyx base
    const calyxGeo = new THREE.ConeGeometry(0.22, 0.35, 8);
    calyxGeo.rotateX(Math.PI);
    const calyxMesh = new THREE.Mesh(calyxGeo, stemMat);
    calyxMesh.position.y = -0.12;
    headGroup.add(calyxMesh);

    // Sepals (5 green pointed leaves under the bloom)
    for (let s = 0; s < 5; s++) {
      const sepal = new THREE.Mesh(sharedLeafGeo, leafMat);
      const sAngle = (s / 5) * Math.PI * 2;
      sepal.scale.set(0.38, 0.55, 0.38);
      sepal.rotation.y = sAngle;
      sepal.rotation.x = 1.32;
      headGroup.add(sepal);
    }

    // Materials per layer for velvety depth
    const matCore = new THREE.MeshPhysicalMaterial({
      color: palette.core,
      emissive: palette.sheen,
      emissiveIntensity: 0.22,
      roughness: 0.42,
      metalness: 0.04,
      clearcoat: 0.15,
      side: THREE.DoubleSide
    });
    const matMid = new THREE.MeshPhysicalMaterial({
      color: palette.mid,
      emissive: palette.sheen,
      emissiveIntensity: 0.16,
      roughness: 0.45,
      metalness: 0.04,
      clearcoat: 0.12,
      side: THREE.DoubleSide
    });
    const matOuter = new THREE.MeshPhysicalMaterial({
      color: palette.outer,
      emissive: palette.sheen,
      emissiveIntensity: 0.12,
      roughness: 0.48,
      metalness: 0.03,
      clearcoat: 0.1,
      side: THREE.DoubleSide
    });

    // Dewdrop on one outer petal
    const dewGeo = new THREE.SphereGeometry(0.038, 10, 10);
    const dewMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.85,
      opacity: 0.9,
      transparent: true,
      roughness: 0.05,
      ior: 1.33
    });

    // Spiral phyllotaxis petals across 5 concentric rings
    const ringConfigs = [
      { count: 4, geoIdx: 0, mat: matCore, baseTilt: 0.14, radius: 0.06, yOff: 0.02 },
      { count: 5, geoIdx: 1, mat: matCore, baseTilt: 0.32, radius: 0.11, yOff: 0.0 },
      { count: 6, geoIdx: 2, mat: matMid,  baseTilt: 0.52, radius: 0.16, yOff: -0.02 },
      { count: 7, geoIdx: 3, mat: matMid,  baseTilt: 0.74, radius: 0.21, yOff: -0.04 },
      { count: 8, geoIdx: 4, mat: matOuter, baseTilt: 0.96, radius: 0.25, yOff: -0.06 }
    ];

    const petalPivots = [];
    const goldenAngle = 2.3999632;
    let pIndex = 0;

    ringConfigs.forEach((ring, rIdx) => {
      for (let i = 0; i < ring.count; i++) {
        const pivot = new THREE.Group();
        const angle = (i / ring.count) * Math.PI * 2 + rIdx * goldenAngle + seed;
        pivot.rotation.y = angle;

        const petalMesh = new THREE.Mesh(petalGeometries[ring.geoIdx], ring.mat);
        petalMesh.position.z = ring.radius;
        petalMesh.position.y = ring.yOff;
        petalMesh.castShadow = true;
        petalMesh.receiveShadow = true;

        const baseTilt = ring.baseTilt + (Math.sin(pIndex * 1.7) * 0.04);
        petalMesh.rotation.x = baseTilt * state.bloomFactor;

        // Add subtle crystal dewdrop on a couple outer petals
        if (rIdx === 3 && i === 0) {
          const drop = new THREE.Mesh(dewGeo, dewMat);
          drop.position.set(0.05, 0.65, 0.12);
          petalMesh.add(drop);
        }

        pivot.add(petalMesh);
        headGroup.add(pivot);
        petalPivots.push({ mesh: petalMesh, baseTilt, rIdx });
        pIndex++;
      }
    });

    headGroup.userData = {
      petalPivots,
      pulseOffset: seed * 10,
      extraBloom: 0
    };

    interactiveRoseHeads.push(headGroup);
    roseRoot.add(headGroup);
    return roseRoot;
  }

  // --- Build Baby's Breath (Paniculata Blanca) ---
  function buildGypsophila() {
    while (gypsophilaGroup.children.length > 0) {
      gypsophilaGroup.remove(gypsophilaGroup.children[0]);
    }
    if (!state.showGypsophila) return;

    const floretGeo = new THREE.DodecahedronGeometry(0.065, 0);
    const floretMat = new THREE.MeshStandardMaterial({
      color: 0xfff8fa,
      emissive: 0xffe3ec,
      emissiveIntensity: 0.25,
      roughness: 0.4
    });
    const twigMat = new THREE.MeshBasicMaterial({ color: 0x4f7745 });

    const sprigCount = Math.round(state.roseCount * 1.6);
    for (let i = 0; i < sprigCount; i++) {
      const t = i / sprigCount;
      const angle = i * 2.39996 + 0.5;
      const r = 0.7 + Math.sqrt(t) * 2.35;
      const domeY = 2.35 + Math.cos(r * 0.48) * 1.15 + (Math.sin(i * 3.1) * 0.18);

      const pos = new THREE.Vector3(
        Math.cos(angle) * r,
        domeY,
        Math.sin(angle) * r
      );

      // Cluster of 3 tiny white florets
      const cluster = new THREE.Group();
      cluster.position.copy(pos);
      for (let f = 0; f < 3; f++) {
        const dot = new THREE.Mesh(floretGeo, floretMat);
        dot.position.set(
          (Math.sin(f * 2.1 + i) - 0.3) * 0.18,
          (Math.cos(f * 1.7 + i)) * 0.14,
          (Math.sin(f * 3.3 - i)) * 0.18
        );
        dot.scale.setScalar(0.75 + (f % 2) * 0.35);
        cluster.add(dot);
      }

      // Thin stem line to bouquet center
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(pos.x * 0.25, 0.2, pos.z * 0.25),
        pos
      ]);
      const line = new THREE.Line(lineGeo, twigMat);
      gypsophilaGroup.add(line);
      gypsophilaGroup.add(cluster);
    }
  }

  // --- Build Wrapping Paper Cone & Satin Ribbon ---
  function buildWrapping() {
    while (wrapGroup.children.length > 0) {
      wrapGroup.remove(wrapGroup.children[0]);
    }
    if (state.wrapStyle === 'none') return;

    const pal = wrapPalettes[state.wrapStyle] || wrapPalettes.kraft;

    const outerWrapMat = new THREE.MeshStandardMaterial({
      color: pal.outer,
      roughness: 0.72,
      metalness: 0.06,
      side: THREE.DoubleSide
    });
    const innerWrapMat = new THREE.MeshStandardMaterial({
      color: pal.inner,
      roughness: 0.65,
      metalness: 0.04,
      side: THREE.DoubleSide
    });

    // Layered pleated paper cones
    const layers = [
      { rTop: 2.85, rBot: 0.42, h: 4.1, y: 0.45, wave: 0.22, folds: 7, mat: outerWrapMat, rotY: 0 },
      { rTop: 2.68, rBot: 0.38, h: 3.95, y: 0.55, wave: 0.18, folds: 6, mat: innerWrapMat, rotY: 0.55 }
    ];

    layers.forEach((cfg) => {
      const coneGeo = new THREE.CylinderGeometry(cfg.rTop, cfg.rBot, cfg.h, 64, 20, true);
      const pos = coneGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i);
        let y = pos.getY(i);
        let z = pos.getZ(i);
        const ny = (y + cfg.h / 2) / cfg.h; // 0 at tie, 1 at top edge
        const angle = Math.atan2(z, x);
        const foldOffset = Math.sin(angle * cfg.folds) * cfg.wave * Math.pow(ny, 1.4);
        const flare = 1 + foldOffset * 0.25;
        x *= flare;
        z *= flare;
        y += Math.cos(angle * cfg.folds) * 0.24 * Math.pow(ny, 1.8);
        pos.setXYZ(i, x, y, z);
      }
      coneGeo.computeVertexNormals();
      const mesh = new THREE.Mesh(coneGeo, cfg.mat);
      mesh.position.y = cfg.y;
      mesh.rotation.y = cfg.rotY;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      wrapGroup.add(mesh);
    });

    // Lower paper skirt below the ribbon tie
    const skirtGeo = new THREE.CylinderGeometry(0.42, 0.85, 1.75, 48, 10, true);
    const sPos = skirtGeo.attributes.position;
    for (let i = 0; i < sPos.count; i++) {
      let x = sPos.getX(i);
      let y = sPos.getY(i);
      let z = sPos.getZ(i);
      const angle = Math.atan2(z, x);
      const ny = 1 - (y + 0.875) / 1.75;
      const wave = 1 + Math.sin(angle * 6) * 0.12 * ny;
      sPos.setXYZ(i, x * wave, y, z * wave);
    }
    skirtGeo.computeVertexNormals();
    const skirtMesh = new THREE.Mesh(skirtGeo, outerWrapMat);
    skirtMesh.position.y = -2.35;
    wrapGroup.add(skirtMesh);

    // Satin Ribbon Band & Bow
    const ribbonMat = new THREE.MeshPhysicalMaterial({
      color: pal.ribbon,
      roughness: 0.28,
      metalness: 0.12,
      clearcoat: 0.5,
      side: THREE.DoubleSide
    });

    // Waist band
    const bandGeo = new THREE.TorusGeometry(0.46, 0.085, 16, 48);
    bandGeo.rotateX(Math.PI / 2);
    const bandMesh = new THREE.Mesh(bandGeo, ribbonMat);
    bandMesh.position.y = -1.52;
    wrapGroup.add(bandMesh);

    // Bow knot
    const knotGeo = new THREE.SphereGeometry(0.13, 16, 16);
    const knotMesh = new THREE.Mesh(knotGeo, ribbonMat);
    knotMesh.position.set(0, -1.52, 0.52);
    wrapGroup.add(knotMesh);

    // Left & right bow loops
    for (let side of [-1, 1]) {
      const loopGeo = new THREE.TorusGeometry(0.28, 0.065, 14, 36);
      const loopMesh = new THREE.Mesh(loopGeo, ribbonMat);
      loopMesh.scale.set(1.25, 0.72, 0.85);
      loopMesh.position.set(side * 0.32, -1.48, 0.54);
      loopMesh.rotation.z = side * 0.22;
      loopMesh.rotation.y = -side * 0.28;
      wrapGroup.add(loopMesh);

      // Flowing ribbon tails
      const tailCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.08, -1.56, 0.52),
        new THREE.Vector3(side * 0.34, -2.15, 0.68),
        new THREE.Vector3(side * 0.52, -2.85, 0.56),
        new THREE.Vector3(side * 0.44, -3.45, 0.72)
      ]);
      const tailGeo = new THREE.TubeGeometry(tailCurve, 20, 0.055, 8, false);
      tailGeo.scale(1.6, 1, 0.35);
      const tailMesh = new THREE.Mesh(tailGeo, ribbonMat);
      wrapGroup.add(tailMesh);
    }
  }

  // --- Build Complete Bouquet ---
  function rebuildBouquet() {
    while (rosesGroup.children.length > 0) {
      rosesGroup.remove(rosesGroup.children[0]);
    }
    interactiveRoseHeads = [];

    const palette = shadePalettes[state.shade] || shadePalettes.crimson;
    const count = state.roseCount;
    const goldenAngle = 2.3999632;

    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1);
      const r = Math.sqrt(t) * 2.15;
      const theta = i * goldenAngle;

      // Hemispherical floral dome
      const domeHeight = 3.25 - Math.pow(r / 2.25, 1.65) * 1.15;
      const targetPos = new THREE.Vector3(
        Math.cos(theta) * r,
        domeHeight,
        Math.sin(theta) * r
      );

      // Stems cross slightly through the waist tie point at y = -1.5
      const stemBottomPos = new THREE.Vector3(
        -Math.cos(theta) * r * 0.26,
        -3.35,
        -Math.sin(theta) * r * 0.26
      );

      const scale = 0.88 - t * 0.12 + (Math.sin(i * 2.3) * 0.04);
      const rose = createRose(targetPos, stemBottomPos, scale, palette, i * 0.77);
      rosesGroup.add(rose);
    }

    buildGypsophila();
    buildWrapping();
  }

  // --- Falling Rose Petals & Glowing Fireflies ---
  const fallingPetalsGroup = new THREE.Group();
  scene.add(fallingPetalsGroup);
  const fallingPetalsList = [];
  const fallPetalMat = new THREE.MeshStandardMaterial({
    color: 0xd90429,
    roughness: 0.45,
    side: THREE.DoubleSide
  });

  for (let i = 0; i < 36; i++) {
    const mesh = new THREE.Mesh(petalGeometries[2], fallPetalMat);
    mesh.scale.setScalar(0.32 + Math.random() * 0.22);
    mesh.position.set(
      (Math.random() - 0.5) * 14,
      Math.random() * 14 - 4,
      (Math.random() - 0.5) * 10
    );
    mesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );
    mesh.userData = {
      speedY: 0.015 + Math.random() * 0.02,
      swaySpeed: 0.8 + Math.random() * 1.2,
      swayAmp: 0.012 + Math.random() * 0.018,
      rotSpeedX: (Math.random() - 0.5) * 0.025,
      rotSpeedZ: (Math.random() - 0.5) * 0.025,
      phase: Math.random() * Math.PI * 2
    };
    fallingPetalsGroup.add(mesh);
    fallingPetalsList.push(mesh);
  }

  // Warm ambient sparkles
  const sparkCount = 90;
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(sparkCount * 3);
  for (let i = 0; i < sparkCount; i++) {
    sparkPos[i * 3] = (Math.random() - 0.5) * 16;
    sparkPos[i * 3 + 1] = (Math.random() - 0.3) * 12;
    sparkPos[i * 3 + 2] = (Math.random() - 0.5) * 12;
  }
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = new THREE.PointsMaterial({
    color: 0xffb3c6,
    size: 0.09,
    transparent: true,
    opacity: 0.65
  });
  const sparkPoints = new THREE.Points(sparkGeo, sparkMat);
  scene.add(sparkPoints);

  // --- Responsive sizing ---
  const BASE_FOV = 42;
  function resizeScene() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    const aspect = w / h;
    camera.aspect = aspect;
    // On narrow/portrait screens widen the vertical FOV so the whole bouquet fits horizontally
    const halfTan = Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2));
    const fit = aspect < 1 ? halfTan / Math.pow(aspect, 0.8) : halfTan;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(fit));
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
  }

  // --- Camera Orbit & Pointer Interaction ---
  function updateCameraPosition() {
    spherical.phi = Math.max(0.35, Math.min(1.75, spherical.phi));
    spherical.radius = Math.max(6.5, Math.min(22, spherical.radius));
    camera.position.x = spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta);
    camera.position.y = spherical.targetY + spherical.radius * Math.cos(spherical.phi);
    camera.position.z = spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta);
    camera.lookAt(0, spherical.targetY, 0);
  }
  updateCameraPosition();

  let isDragging = false;
  let prevPointer = { x: 0, y: 0 };
  let pointerDownPos = { x: 0, y: 0 };
  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();

  const activePointers = new Map();
  let pinchStartDist = 0;
  let pinchStartRadius = 0;
  const pinchDistance = () => {
    const [p1, p2] = [...activePointers.values()];
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  };

  container.addEventListener('pointerdown', (e) => {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 1) {
      isDragging = true;
      prevPointer = { x: e.clientX, y: e.clientY };
      pointerDownPos = { x: e.clientX, y: e.clientY };
    } else if (activePointers.size === 2) {
      pinchStartDist = pinchDistance();
      pinchStartRadius = spherical.radius;
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size >= 2) {
      if (pinchStartDist > 0) {
        spherical.radius = pinchStartRadius * (pinchStartDist / pinchDistance());
        updateCameraPosition();
      }
      return;
    }
    if (!isDragging) return;
    const dx = e.clientX - prevPointer.x;
    const dy = e.clientY - prevPointer.y;
    spherical.theta -= dx * 0.0065;
    spherical.phi -= dy * 0.0065;
    prevPointer = { x: e.clientX, y: e.clientY };
    updateCameraPosition();
  });

  const endPointer = (e) => {
    if (!activePointers.has(e.pointerId)) return;
    const wasPinching = activePointers.size >= 2;
    activePointers.delete(e.pointerId);
    if (wasPinching) {
      isDragging = false;
      pinchStartDist = 0;
      // Resume one-finger drag from the remaining pointer without a jump
      if (activePointers.size === 1) {
        const [rest] = [...activePointers.values()];
        prevPointer = { x: rest.x, y: rest.y };
        pointerDownPos = { x: -9999, y: -9999 };
        isDragging = true;
      }
      return;
    }
    if (!isDragging) return;
    isDragging = false;
    if (e.type === 'pointercancel') return;
    const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
    if (dist < 6) {
      // Raycast click on individual rose head to make it pulse/bloom
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNDC, camera);
      const intersects = raycaster.intersectObjects(rosesGroup.children, true);
      if (intersects.length > 0) {
        let obj = intersects[0].object;
        while (obj && !obj.userData.petalPivots) {
          obj = obj.parent;
        }
        if (obj && obj.userData.petalPivots) {
          obj.userData.extraBloom = 0.42;
        }
      }
    }
  };
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    spherical.radius += e.deltaY * 0.008;
    updateCameraPosition();
  }, { passive: false });

  // Initial build
  rebuildBouquet();
  resizeScene();

  // Resize handler
  window.addEventListener('resize', resizeScene);
  window.addEventListener('orientationchange', resizeScene);

  // --- Animation Loop ---
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const elapsed = clock.getElapsedTime();

    // Gentle breathing breeze on bouquet
    bouquetGroup.position.y = Math.sin(elapsed * 1.3) * 0.08;
    bouquetGroup.rotation.z = Math.sin(elapsed * 0.9) * 0.018;

    if (state.autoRotate && !isDragging) {
      spherical.theta += 0.0032;
      updateCameraPosition();
    }

    // Animate clicked rose bloom & subtle petal sway
    interactiveRoseHeads.forEach((head) => {
      if (head.userData.extraBloom > 0.001) {
        head.userData.extraBloom *= 0.95;
      } else {
        head.userData.extraBloom = 0;
      }
      const breeze = Math.sin(elapsed * 2.0 + head.userData.pulseOffset) * 0.02;
      const totalFactor = state.bloomFactor + head.userData.extraBloom + breeze;
      head.userData.petalPivots.forEach((p) => {
        p.mesh.rotation.x = p.baseTilt * totalFactor;
      });
    });

    // Falling petals update
    if (state.fallingPetals) {
      fallingPetalsList.forEach((p) => {
        const u = p.userData;
        p.position.y -= u.speedY;
        p.position.x += Math.sin(elapsed * u.swaySpeed + u.phase) * u.swayAmp;
        p.rotation.x += u.rotSpeedX;
        p.rotation.z += u.rotSpeedZ;
        if (p.position.y < -5.5) {
          p.position.y = 8.5;
          p.position.x = (Math.random() - 0.5) * 14;
        }
      });
    }

    sparkPoints.rotation.y = elapsed * 0.05;
    renderer.render(scene, camera);
  }

  animate();
});
