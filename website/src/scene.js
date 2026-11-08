// sapphire hero: a raw teal sapphire, broken out of the ground with rock still on it,
// lit from a cave mouth above. the cave is painted once per resize; the stone and dust move.

import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  MathUtils,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const CYAN = new Color("#3fd4e0");
const TEAL = new Color("#0f7f8c");
const ICE = new Color("#b8fbff");
const WHITE = new Color("#f4ffff");

const FOV = 28;
const DISTANCE = 7.2;
// world units per screen height at the stone's depth
const VIEW_H = 2 * Math.tan(MathUtils.degToRad(FOV / 2)) * DISTANCE;

// ---------- noise, shared by the js geometry and the shaders ----------

function hash3(x, y, z, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440670441) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise3(x, y, z, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const c = (a, b, d) => hash3(xi + a, yi + b, zi + d, seed);
  const x00 = MathUtils.lerp(c(0, 0, 0), c(1, 0, 0), u);
  const x10 = MathUtils.lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = MathUtils.lerp(c(0, 0, 1), c(1, 0, 1), u);
  const x11 = MathUtils.lerp(c(0, 1, 1), c(1, 1, 1), u);
  return MathUtils.lerp(MathUtils.lerp(x00, x10, v), MathUtils.lerp(x01, x11, v), w) * 2 - 1;
}

function fbm3(p, scale, seed, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let f = scale;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(p.x * f, p.y * f, p.z * f, seed + i * 31);
    f *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

function ridged3(p, scale, seed, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let f = scale;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise3(p.x * f, p.y * f, p.z * f, seed + i * 17));
    sum += amp * n * n;
    f *= 2.07;
    amp *= 0.5;
  }
  return sum;
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GLSL_NOISE = /* glsl */ `
  float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
          mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
          mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      s += a * vnoise(p);
      p = p * 2.03 + 17.1;
      a *= 0.5;
    }
    return s;
  }
  float ridged(vec3 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
      s += a * n * n;
      p = p * 2.07 + 9.3;
      a *= 0.5;
    }
    return s;
  }
`;

// ---------- the stone ----------

// a corundum crystal grows as a hexagonal barrel that tapers to a point. this one was broken out
// of the ground: the crystal faces are worn, the ends are snapped off, corners are chipped away, and
// patches of the host rock still cling to it.
function rawStoneGeometry(seed = 7) {
  const rand = mulberry32(seed);
  const jitter = (s) => (rand() - 0.5) * s;

  // [normal, offset, kind] with kind 0 = worn crystal face, 1 = fresh break
  const planes = [];
  const twist = rand() * Math.PI;
  for (let i = 0; i < 6; i++) {
    const a = twist + (i / 6) * Math.PI * 2 + jitter(0.12);
    planes.push([new Vector3(Math.cos(a), jitter(0.12), Math.sin(a)).normalize(), 0.6 + jitter(0.1), 0]);
    const b = a + Math.PI / 6;
    planes.push([new Vector3(Math.cos(b) * 0.8, 0.6, Math.sin(b) * 0.8).normalize(), 0.9 + jitter(0.12), 0]);
  }
  // snapped ends: the top tilts, the bottom is where it tore from the rock
  planes.push([new Vector3(jitter(0.7), 1, jitter(0.7)).normalize(), 0.92 + jitter(0.08), 1]);
  planes.push([new Vector3(jitter(1.1), -1, jitter(1.1)).normalize(), 0.78 + jitter(0.1), 1]);
  // chipped corners
  for (let i = 0; i < 5; i++) {
    const n = new Vector3(rand() - 0.5, (rand() - 0.5) * 1.6, rand() - 0.5).normalize();
    planes.push([n, 0.66 + rand() * 0.16, 1]);
  }

  let g = new IcosahedronGeometry(1, 56);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g = mergeVertices(g);

  const pos = g.attributes.position;
  const crust = new Float32Array(pos.count);
  const breaks = new Float32Array(pos.count);
  const dir = new Vector3();
  const p = new Vector3();

  for (let i = 0; i < pos.count; i++) {
    dir.fromBufferAttribute(pos, i).normalize();
    // lumpy start, stretched along the crystal axis
    const lump = 1 + fbm3(dir, 1.3, seed) * 0.32;
    p.copy(dir).multiplyScalar(lump);
    p.y *= 1.32;

    // cut by the crystal habit, the snapped ends and the chips
    let kind = -1;
    let deepest = 0;
    for (const [n, d, k] of planes) {
      const over = p.dot(n) - d;
      if (over > 0) {
        p.addScaledVector(n, -over);
        if (over > deepest) {
          deepest = over;
          kind = k;
        }
      }
    }
    const isBreak = kind === 1 ? 1 : 0;

    // rough every surface: a gentle undulation, then grit. fresh breaks stay a little smoother.
    const undulate = fbm3(p, 2.2, seed + 101) * (isBreak ? 0.04 : 0.05);
    const grit = (ridged3(p, 7.5, seed + 202) - 0.32) * (isBreak ? 0.014 : 0.026);
    // pits where softer mineral weathered out
    const pit = Math.max(0, fbm3(p, 4.2, seed + 303) - 0.2) * -0.14;

    // host rock clings at the torn bottom and creeps up in a few tongues
    const reach = fbm3(p, 1.5, seed + 404);
    const c = MathUtils.clamp(0.5 + reach * 0.9 - (p.y + 0.42) * 0.85 + isBreak * (p.y < 0 ? 0.25 : -0.2), 0, 1);
    const crusted = MathUtils.smoothstep(c, 0.5, 0.62);
    // the rock is lumpy, not sawn: big knuckles plus crumbs
    const cake = crusted * (0.03 + Math.max(0, fbm3(p, 3.2, seed + 606)) * 0.16 + Math.max(0, fbm3(p, 9, seed + 505)) * 0.06);

    p.addScaledVector(dir, undulate + grit + pit + cake);
    pos.setXYZ(i, p.x, p.y, p.z);
    crust[i] = c;
    breaks[i] = isBreak;
  }

  g.setAttribute("aCrust", new Float32BufferAttribute(crust, 1));
  g.setAttribute("aBreak", new Float32BufferAttribute(breaks, 1));
  g.computeBoundingSphere();
  const r = g.boundingSphere.radius;
  const c = g.boundingSphere.center;
  g.translate(-c.x, -c.y, -c.z);
  g.scale(1 / r, 1 / r, 1 / r);
  g.computeVertexNormals();
  return g;
}

function stoneMaterial() {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new Vector3() },
      uKey: { value: new Vector3(0.18, 1, 0.42).normalize() },
    },
    vertexShader: /* glsl */ `
      attribute float aCrust;
      attribute float aBreak;
      varying vec3 vObj;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying float vCrust;
      varying float vBreak;
      void main() {
        vObj = position;
        vCrust = aCrust;
        vBreak = aBreak;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uCam;
      uniform vec3 uKey;
      varying vec3 vObj;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying float vCrust;
      varying float vBreak;

      ${GLSL_NOISE}

      // a stand-in for the cave around the stone: dark rock, the bright mouth above, a teal bounce
      vec3 caveEnv(vec3 d, float sharp) {
        vec3 c = mix(vec3(0.004, 0.008, 0.01), vec3(0.03, 0.07, 0.08), smoothstep(-0.5, 0.6, d.y));
        c += vec3(0.3, 0.62, 0.66) * smoothstep(0.55, 1.0, d.y) * 0.7;
        c += vec3(1.0, 1.0, 0.98) * pow(max(dot(d, normalize(vec3(0.15, 1.0, 0.4))), 0.0), sharp) * 2.4;
        c += vec3(0.8, 0.95, 1.0) * pow(max(dot(d, normalize(vec3(-0.75, 0.25, 0.6))), 0.0), sharp * 0.8) * 0.5;
        c += vec3(0.0, 0.2, 0.21) * pow(max(dot(d, normalize(vec3(0.0, -0.6, 0.8))), 0.0), 3.0) * 0.5;
        return c;
      }

      // bump a normal by a height field, from screen-space derivatives
      vec3 perturb(vec3 n, vec3 pos, float h) {
        vec3 dpdx = dFdx(pos);
        vec3 dpdy = dFdy(pos);
        float dhdx = dFdx(h);
        float dhdy = dFdy(h);
        vec3 r1 = cross(dpdy, n);
        vec3 r2 = cross(n, dpdx);
        float det = dot(dpdx, r1);
        vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
        return normalize(abs(det) * n - grad);
      }

      void main() {
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(uCam - vWorld);
        if (dot(N, V) < 0.0) N = -N;

        // ragged rock edges: the boundary wanders at a finer scale than the vertices
        float crust = smoothstep(0.5, 0.58, vCrust + (fbm(vObj * 10.0) - 0.5) * 0.35);
        float brk = smoothstep(0.25, 0.75, vBreak) * (1.0 - crust);

        // surface relief: frosted, striated crystal skin; rippled glassy breaks; grainy rock
        float skin = fbm(vObj * 14.0) * 0.45 + fbm(vObj * 46.0) * 0.35 + fbm(vObj * vec3(3.0, 40.0, 3.0)) * 0.2;
        float ripple = sin(length(vObj - vec3(0.2, 0.7, 0.1)) * 70.0 + fbm(vObj * 5.0) * 5.0) * 0.5 + 0.5;
        float grain = fbm(vObj * 34.0) + vnoise(vObj * 90.0) * 0.4;
        float h = mix(mix(skin * 0.008, ripple * 0.003, brk), grain * 0.016, crust);
        N = perturb(N, vWorld, h);
        // a little of the raw triangle facet keeps the edges chippy
        vec3 Nf = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        if (dot(Nf, V) < 0.0) Nf = -Nf;
        N = normalize(mix(N, Nf, 0.15));

        vec3 L = normalize(uKey);
        vec3 F = normalize(vec3(-0.7, 0.05, 0.75));
        float ndl = max(dot(N, L), 0.0);
        float ndf = max(dot(N, F), 0.0);
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float nh = max(dot(N, normalize(L + V)), 0.0);

        // the crystal reflects the cave and gathers its light inside.
        // each flat face sees a different part of the cave, which is what makes it read as crystal.
        float zone = sin(length(vObj.xz) * 18.0 + fbm(vObj * 3.0) * 4.0) * 0.5 + 0.5;
        float cloud = fbm(vObj * 2.4 + vec3(0.0, uTime * 0.02, 0.0));
        vec3 R = reflect(-V, N);
        vec3 T = refract(-V, N, 0.565);
        float sharp = mix(10.0, 120.0, brk);
        vec3 refl = caveEnv(R, sharp);
        vec3 inner = caveEnv(normalize(T * vec3(1.0, -1.0, 1.0) + vec3(0.0, 0.5, 0.0)), 5.0);
        vec3 tint = vec3(0.012, 0.30, 0.32);
        vec3 body = tint * (inner * 1.5 + 0.02) * (0.55 + 0.45 * zone);
        body += vec3(0.08, 0.6, 0.58) * pow(ndv, 3.0) * smoothstep(0.35, 0.75, cloud) * 0.45;
        // worn faces scatter light like frosted glass
        body += (tint * 0.32 + vec3(0.02, 0.04, 0.04)) * ndl * (1.0 - brk);
        float fresnel = 0.07 + 0.93 * pow(1.0 - ndv, 5.0);
        vec3 crystal = mix(body, refl, fresnel * mix(0.4, 1.0, brk));
        crystal += refl * mix(0.035, 0.09, brk);
        float glint = step(0.94, vnoise(vObj * 80.0)) * pow(nh, 24.0) * 2.5;
        crystal += vec3(0.85, 1.0, 1.0) * glint * (0.3 + 0.7 * brk);

        // the host rock: grey-brown, dusty, a few mica flecks
        vec3 rockA = vec3(0.035, 0.034, 0.033);
        vec3 rockB = vec3(0.10, 0.096, 0.09);
        vec3 rock = mix(rockA, rockB, fbm(vObj * 11.0) * 1.3) * (0.2 + 1.3 * ndl + 0.15 * ndf);
        rock += vec3(0.7, 0.8, 0.8) * step(0.96, vnoise(vObj * 120.0)) * pow(nh, 30.0) * 1.0;
        // a teal stain where the rock meets the crystal
        float edge = smoothstep(0.75, 0.5, vCrust);
        rock += vec3(0.0, 0.07, 0.07) * edge * (0.3 + ndl);

        vec3 color = mix(crystal, rock, crust);
        // the bottom sits in shadow
        color *= mix(0.5, 1.0, smoothstep(-0.95, 0.2, vObj.y));
        color = color / (1.0 + color * 0.2);

        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

// ---------- the cave, painted into a texture ----------

function caveMaterial() {
  return new ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uRes: { value: new Vector2(1, 1) },
      uFocus: { value: new Vector2(0, -0.25) },
      uRadius: { value: 0.12 },
      uCopy: { value: 0.3 },
    },
    vertexShader: /* glsl */ `
      void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec2 uRes;
      uniform vec2 uFocus;
      uniform float uRadius;
      uniform float uCopy;

      ${GLSL_NOISE}

      // signed distance into rock: > 0 is rock, < 0 is open air
      float caveField(vec2 p) {
        float aspect = uRes.x / uRes.y;
        vec3 q = vec3(p, 0.0);
        float w1 = fbm(q * 2.1 + 3.1) - 0.5;
        float w2 = fbm(q * 6.0 + 8.7) - 0.5;
        // the chamber: wide where the words sit, narrowing up to the mouth
        float t = smoothstep(0.52, -0.2, p.y);
        float halfW = mix(0.13, uCopy, t) + 0.06 * max(aspect - 1.2, 0.0);
        float wall = abs(p.x) - halfW - w1 * 0.34 - w2 * 0.07;
        // the ledge the stone rests above
        float lx = (p.x - uFocus.x) / max(uRadius * 3.2, 0.14);
        float ledgeTop = uFocus.y - uRadius * 0.72 - lx * lx * 0.15 + w1 * 0.09 + w2 * 0.045;
        float ground = ledgeTop - p.y;
        return max(wall, ground);
      }

      // twisted strands of rock: sharp ridges through a warped domain, fine grit, dark cracks
      float sharpRidges(vec3 q) {
        float s = 0.0;
        float a = 0.5;
        for (int i = 0; i < 6; i++) {
          float n = 1.0 - abs(vnoise(q) * 2.0 - 1.0);
          n *= n;
          s += a * n * n;
          q = q * 2.1 + 9.3;
          a *= 0.52;
        }
        return s;
      }
      float relief(vec2 p) {
        vec3 q = vec3(p * 2.8, 2.0);
        q.xy += vec2(fbm(q * 0.9 + 4.0), fbm(q * 0.9 + 9.0)) * 1.8;
        float strands = sharpRidges(q);
        float fine = sharpRidges(vec3(p * 15.0, 7.0));
        float grit = vnoise(vec3(p * 70.0, 1.0));
        float crack = smoothstep(0.92, 0.995, 1.0 - abs(vnoise(q * 1.6 + 3.0) * 2.0 - 1.0));
        return strands * 0.62 + fine * 0.3 + grit * 0.08 - crack * 0.3;
      }

      void main() {
        vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
        vec2 mouth = vec2(0.0, 0.53);
        float e = 1.0 / uRes.y;

        float d = caveField(p);
        float rock = smoothstep(-e * 1.5, e * 1.5, d);

        // rock relief and its normal
        float H = relief(p);
        float Hx = relief(p + vec2(e * 2.0, 0.0));
        float Hy = relief(p + vec2(0.0, e * 2.0));
        vec3 n = normalize(vec3(-(Hx - H) / (e * 2.0) * 0.022, -(Hy - H) / (e * 2.0) * 0.022, 1.0));

        // light from the mouth, fading with distance and with depth into the wall
        float distMouth = length(mouth - p);
        vec3 toMouth = normalize(vec3(mouth - p, 0.45));
        float lit = max(dot(n, toMouth), 0.0) / (1.0 + distMouth * distMouth * 3.5);
        float rim = exp(-max(d, 0.0) * 22.0);
        float depth = exp(-max(d, 0.0) * 3.0);
        vec3 toStone = normalize(vec3(uFocus - p, 0.12));
        float distStone = length((uFocus - p) * vec2(0.8, 1.0));
        float glow = max(dot(n, toStone), 0.0) / (1.0 + distStone * distStone * 55.0);

        // crevices stay dark
        float occlusion = smoothstep(0.05, 0.6, H);
        vec3 grey = vec3(0.25, 0.26, 0.27) * (0.25 + 0.75 * occlusion);
        vec3 rockLit = grey * lit * (0.45 + 0.8 * depth + 0.6 * rim);
        rockLit += grey * 0.04 * depth;
        rockLit += vec3(0.05, 0.36, 0.38) * glow * occlusion * (0.4 + 0.9 * rim);

        // the open chamber: dark air, a shaft of cool light from the mouth
        vec3 air = vec3(0.006, 0.01, 0.012);
        float below = mouth.y - p.y;
        float spread = 0.05 + below * 0.24;
        float shaft = exp(-pow(abs(p.x - mouth.x) / spread, 2.0)) * smoothstep(-0.05, 0.2, below);
        shaft *= exp(-below * 1.3) * (0.75 + 0.25 * fbm(vec3(p.x * 10.0, p.y * 1.2, 1.0)));
        air += vec3(0.16, 0.34, 0.38) * shaft * 0.5;
        air += vec3(0.05, 0.11, 0.13) * exp(-distMouth * 3.0) * 0.8;
        // soft teal pool around the stone
        air += vec3(0.015, 0.14, 0.15) * exp(-distStone * distStone / (uRadius * uRadius * 7.0)) * 0.55;
        // contact shadow along the walls
        air *= 0.5 + 0.5 * smoothstep(0.0, 0.08, -d);

        // the mouth itself: daylight beyond the rock
        float sky = smoothstep(0.07, 0.0, length((p - mouth) * vec2(1.5, 1.0)) - 0.02 + (fbm(vec3(p * 7.0, 3.0)) - 0.5) * 0.06);
        air = mix(air, vec3(0.62, 0.90, 0.92), sky * (1.0 - rock));

        vec3 col = mix(air, rockLit, rock);
        // vignette and a touch of dither against banding
        col *= 1.0 - 0.45 * smoothstep(0.4, 1.0, length(p * vec2(0.65, 1.0)));
        col += (hash13(vec3(gl_FragCoord.xy, 7.0)) - 0.5) / 255.0;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function blitMaterial(texture) {
  return new ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { uTex: { value: texture } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex;
      varying vec2 vUv;
      void main() { gl_FragColor = texture2D(uTex, vUv); }
    `,
  });
}

// ---------- glow and dust ----------

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(180,250,255,0.45)");
  g.addColorStop(0.6, "rgba(40,160,180,0.08)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// dust drifting down the light shaft
function dust(count) {
  const start = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const tint = new Float32Array(count * 3);
  const palette = [ICE, CYAN, WHITE, TEAL];
  for (let i = 0; i < count; i++) {
    start.set([MathUtils.randFloatSpread(1.6), Math.random() * 3.2 - 0.6, MathUtils.randFloatSpread(1.2)], i * 3);
    seed[i] = Math.random();
    const c = palette[i % palette.length].clone().lerp(WHITE, Math.random() * 0.4);
    tint.set([c.r, c.g, c.b], i * 3);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(start, 3));
  g.setAttribute("aSeed", new Float32BufferAttribute(seed, 1));
  g.setAttribute("aTint", new Float32BufferAttribute(tint, 3));
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPixel: { value: 4 } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixel;
      attribute float aSeed;
      attribute vec3 aTint;
      varying vec3 vTint;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float fall = mod(p.y - uTime * (0.04 + aSeed * 0.05) + 0.6, 3.2) - 0.6;
        p.y = fall;
        p.x += sin(uTime * 0.3 + aSeed * 40.0) * 0.08;
        p.z += cos(uTime * 0.25 + aSeed * 30.0) * 0.06;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPixel * (0.5 + aSeed) * (6.0 / -mv.z);
        // stronger in the middle of the shaft, fading at its ends
        vAlpha = smoothstep(-0.6, 0.0, fall) * smoothstep(2.6, 1.6, fall) * (1.0 - smoothstep(0.2, 0.8, abs(p.x)));
        vAlpha *= 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 1.3 + aSeed * 60.0));
        vTint = aTint;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vTint;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vAlpha * 0.55;
        gl_FragColor = vec4(vTint * a, a);
      }
    `,
  });
  return new Points(g, material);
}

const easeOut = (t) => 1 - Math.pow(1 - MathUtils.clamp(t, 0, 1), 3);

// slot: the element the stone should fill. copy: the element the chamber should open around.
export async function startScene(canvas, { slot, copy, capture = false } = {}) {
  const still = capture || matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: capture,
    powerPreference: "high-performance",
  });
  const pixelRatio = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;

  const quad = new PlaneGeometry(2, 2);
  const flat = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // the cave is expensive noise: paint it once per size, then copy it each frame
  const caveTarget = new WebGLRenderTarget(1, 1);
  const cave = caveMaterial();
  const caveScene = new Scene();
  const caveMesh = new Mesh(quad, cave);
  caveMesh.frustumCulled = false;
  caveScene.add(caveMesh);
  const backScene = new Scene();
  const backMesh = new Mesh(quad, blitMaterial(caveTarget.texture));
  backMesh.frustumCulled = false;
  backScene.add(backMesh);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, DISTANCE);

  const flight = new Group();
  const gem = new Group();
  flight.add(gem);
  scene.add(flight);

  const material = stoneMaterial();
  material.uniforms.uCam.value.copy(camera.position);
  const stone = new Mesh(rawStoneGeometry(), material);
  // lying over at an angle, the way it came out of the ground
  stone.rotation.set(0.32, 0.4, -0.62);
  gem.add(stone);

  const map = glowTexture();
  const bloom = new Sprite(
    new SpriteMaterial({ map, color: CYAN, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.12 }),
  );
  bloom.position.set(0, -0.1, -0.8);
  bloom.scale.setScalar(3.6);
  gem.add(bloom);

  const motes = dust(still ? 0 : 46);
  motes.material.uniforms.uPixel.value = 4 * pixelRatio;
  if (!still) flight.add(motes);

  const home = new Vector3();
  let size = 1;
  function layout() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    // fit the stone to its slot in the page, in world units at the stone's depth
    const box = canvas.getBoundingClientRect();
    const s = slot?.getBoundingClientRect();
    const sx = s ? s.left + s.width / 2 - box.left : w / 2;
    const sy = s ? s.top + s.height / 2 - box.top : capture ? h / 2 : h * 0.75;
    const sr = s ? Math.min(s.width, s.height) / 2 : capture ? Math.min(w, h) * 0.5 : h * 0.12;
    const perPx = VIEW_H / h;
    home.set((sx - w / 2) * perPx, (h / 2 - sy) * perPx, 0);
    size = sr * perPx * 0.82;

    // open the chamber wide enough for the copy
    const c = copy?.getBoundingClientRect();
    const copyHalf = c ? c.width / 2 / h + 0.04 : 0.32;

    if (!capture) {
      const cw = Math.max(1, Math.round(w));
      const ch = Math.max(1, Math.round(h));
      caveTarget.setSize(cw, ch);
      cave.uniforms.uRes.value.set(cw, ch);
      cave.uniforms.uFocus.value.set((sx - w / 2) / h, (h / 2 - sy) / h);
      cave.uniforms.uRadius.value = (sr * 0.82) / h;
      cave.uniforms.uCopy.value = copyHalf;
      renderer.setRenderTarget(caveTarget);
      renderer.clear();
      renderer.render(caveScene, flat);
      renderer.setRenderTarget(null);
    }
  }

  const lean = new Vector2();
  const leanTo = new Vector2();
  addEventListener(
    "pointermove",
    (e) => leanTo.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1),
    { passive: true },
  );

  const startPos = new Vector3();
  function render(t) {
    const intro = still ? 1 : easeOut(t / 2.6);
    lean.lerp(leanTo, 0.03);
    startPos.copy(home).add(new Vector3(0, -0.25, -0.6));
    flight.position.lerpVectors(startPos, home, intro);
    flight.position.y += Math.sin(t * 0.6) * size * 0.05;
    gem.scale.setScalar(size * MathUtils.lerp(0.85, 1, intro));
    motes.scale.setScalar(1 / Math.max(size, 0.1));
    // a slow turn on the spot, leaning a little toward the pointer
    gem.rotation.set(lean.y * 0.06 + Math.sin(t * 0.3) * 0.03, t * 0.12 + lean.x * 0.12 + 0.6, Math.sin(t * 0.22) * 0.02);
    material.uniforms.uTime.value = t;
    if (!still) motes.material.uniforms.uTime.value = t;
    bloom.material.opacity = 0.11 + Math.sin(t * 0.8) * 0.025;

    renderer.setRenderTarget(null);
    renderer.clear();
    if (!capture) renderer.render(backScene, flat);
    renderer.render(scene, camera);
  }

  layout();
  // the slot moves when fonts load or the copy rewraps, not only when the canvas resizes
  const resized = new ResizeObserver(() => {
    layout();
    if (still) render(6);
  });
  for (const el of [canvas, slot, copy]) if (el) resized.observe(el);

  if (still) {
    if (capture) bloom.visible = false;
    render(6);
    return;
  }

  let visible = true;
  let running = false;
  let last = performance.now();
  let clock = 0;
  function frame(now) {
    if (!visible || document.hidden) {
      running = false;
      return;
    }
    const dt = Math.min((now - last) / 1000, 0.05);
    clock += dt;
    last = now;
    render(clock);
    requestAnimationFrame(frame);
  }
  function run() {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) run();
  }).observe(canvas);
  document.addEventListener("visibilitychange", () => !document.hidden && run());

  render(0);
  run();
}
