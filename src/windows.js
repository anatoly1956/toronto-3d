// Patches a MeshStandardMaterial so building walls get a procedural window
// grid: glass by day, a random subset glowing warm at night. Driven by world
// position, so it needs no UVs or textures.
//   glass: curtain wall (tall panels, thin mullions) instead of punched windows.
// Roofs are told apart from walls by their normal; vertex colour carries the
// wall or roof colour already.
export const nightUniform = { value: 0 };

export function addWindows(material, { glass = false } = {}) {
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

    const cell = glass ? 'vec2(1.6, 3.8)' : 'vec2(3.0, 3.6)';
    const frame = glass ? 'vec4(0.06, 0.94, 0.08, 0.92)' : 'vec4(0.2, 0.8, 0.24, 0.76)';

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
        // (isWindow, litAmount, isWall)
        vec3 windowMask() {
          if (abs(vWNormal.y) > 0.5) return vec3(0.0);
          if (vWPos.y < 4.0) return vec3(0.0, 0.0, 1.0);
          vec2 n = normalize(vWNormal.xz + 1e-5);
          bool facesX = abs(n.x) > abs(n.y);
          float u = facesX ? vWPos.z : vWPos.x;
          float across = facesX ? vWPos.x : vWPos.z;
          vec2 cell = vec2(u, vWPos.y - 4.0) / ${cell};
          vec2 id = floor(cell);
          vec2 f = fract(cell);
          vec4 fr = ${frame};
          float win = step(fr.x, f.x) * step(f.x, fr.y) * step(fr.z, f.y) * step(f.y, fr.w);
          // Fade the grid once cells shrink below a few pixels (avoids moire).
          vec2 fw = fwidth(cell);
          float detail = 1.0 - smoothstep(0.12, 0.35, max(fw.x, fw.y));
          float lit = step(0.68, winHash(vec3(id, floor(across / 4.0))));
          // Far away, windows blend into lit strips along a floor.
          float strip = winHash(vec3(floor(id.x / 6.0), id.y, floor(across / 4.0) + 7.0));
          float far = 0.02 + 0.2 * step(0.6, strip);
          return vec3(win * detail, mix(far, win * lit, detail), 1.0);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 wm = windowMask();
        // Glass panes: darker, cooler; punched windows: dark openings.
        vec3 pane = ${glass ? 'diffuseColor.rgb * vec3(0.72, 0.8, 0.9)' : 'vec3(0.16, 0.18, 0.22)'};
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(pane, vec3(0.05, 0.06, 0.09), uNight), wm.x * ${glass ? '0.55' : '0.75'});
        // Cheap ambient occlusion: walls darken toward the street.
        diffuseColor.rgb *= mix(1.0, mix(0.55, 1.0, smoothstep(0.0, 16.0, vWPos.y)), wm.z);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float flick = 0.7 + 0.3 * winHash(vec3(floor(vWPos.xz / 3.0), floor(vWPos.y / 3.6)));
        totalEmissiveRadiance += vec3(1.0, 0.7, 0.36) * wm.y * uNight * uNight * flick * 0.95;`,
      );
  };
  // Distinct cache key per variant so three.js compiles both programs.
  material.customProgramCacheKey = () => (glass ? 'windows-glass' : 'windows-matte');
  return material;
}
