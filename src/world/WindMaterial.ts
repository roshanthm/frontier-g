// =============================================================================
// WindMaterial
// A MeshStandardMaterial with an injected vertex-shader wind sway, applied via
// onBeforeCompile so it keeps full PBR lighting (shadows, sun color) instead
// of needing a bespoke unlit shader. Displacement scales with vertex height
// (uv.y or local y), so grass/crop bases stay planted while tips wave — the
// single cheapest "this world is alive" visual upgrade available.
// =============================================================================

import * as THREE from "three";

export interface WindMaterialHandle {
  material: THREE.MeshStandardMaterial;
  setTime: (t: number) => void;
}

export function createWindMaterial(color: number, options?: { windStrength?: number; heightAttenuation?: number }): WindMaterialHandle {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const uniforms = {
    uTime: { value: 0 },
    uWindStrength: { value: options?.windStrength ?? 0.12 },
    uHeightAttenuation: { value: options?.heightAttenuation ?? 1.0 },
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.uniforms.uHeightAttenuation = uniforms.uHeightAttenuation;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        uniform float uWindStrength;
        uniform float uHeightAttenuation;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float windPhase = uTime * 2.2 + position.x * 1.3 + position.z * 1.7;
        float heightFactor = (uHeightAttenuation > 0.0) ? clamp(position.y * uHeightAttenuation, 0.0, 1.0) : 1.0;
        transformed.x += sin(windPhase) * uWindStrength * heightFactor;
        transformed.z += cos(windPhase * 0.8) * uWindStrength * 0.6 * heightFactor;`
      );
  };

  return {
    material,
    setTime: (t: number) => {
      uniforms.uTime.value = t;
    },
  };
}

/**
 * Registry so Game.ts can drive every wind-enabled material's uTime uniform
 * from one place each frame without threading references through every caller.
 */
export class WindMaterialRegistry {
  private handles: WindMaterialHandle[] = [];
  private elapsed = 0;

  create(color: number, options?: { windStrength?: number; heightAttenuation?: number }): THREE.MeshStandardMaterial {
    const handle = createWindMaterial(color, options);
    this.handles.push(handle);
    return handle.material;
  }

  update(dt: number): void {
    this.elapsed += dt;
    for (const h of this.handles) h.setTime(this.elapsed);
  }
}
