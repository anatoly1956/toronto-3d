// Patches a MeshStandardMaterial so building walls get a procedural window
// grid: faintly darker glass by day, a random subset glowing warm at night.
// Driven by world position, so it needs no UVs or textures.
export const nightUniform = { value: 0 };

export function addWindows(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = nightUniform;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNormal;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uNight;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        float winHash(vec3 p) {
          return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        }
        // Returns (isWindow, isLit) for the current wall fragment.
        vec2 windowMask() {
          if (abs(vWNormal.y) > 0.5 || vWPos.y < 4.0) return vec2(0.0);
          vec2 n = normalize(vWNormal.xz + 1e-5);
          bool facesX = abs(n.x) > abs(n.y);
          float u = facesX ? vWPos.z : vWPos.x;
          float across = facesX ? vWPos.x : vWPos.z;
          vec2 cell = vec2(u / 3.0, (vWPos.y - 4.0) / 3.6);
          vec2 id = floor(cell);
          vec2 f = fract(cell);
          float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.78);
          // Fade the grid out once cells shrink below a few pixels (avoids moire).
          vec2 fw = fwidth(cell);
          float detail = 1.0 - smoothstep(0.12, 0.35, max(fw.x, fw.y));
          float h = winHash(vec3(id, floor(across / 4.0)));
          float lit = step(0.58, h);
          // Far away, windows blend into lit strips (a run of windows on one
          // floor), so distant towers read as office floors rather than flat.
          float strip = winHash(vec3(floor(id.x / 6.0), id.y, floor(across / 4.0) + 7.0));
          float far = 0.02 + 0.2 * step(0.6, strip);
          return vec2(win * detail, mix(far, win * lit, detail));
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 wm = windowMask();
        diffuseColor.rgb *= 1.0 - wm.x * mix(0.12, 0.7, uNight);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float flick = 0.7 + 0.3 * winHash(vec3(floor(vWPos.xz / 3.0), floor(vWPos.y / 3.6)));
        totalEmissiveRadiance += vec3(1.0, 0.78, 0.48) * wm.y * uNight * uNight * flick * 1.6;`,
      );
  };
  return material;
}
