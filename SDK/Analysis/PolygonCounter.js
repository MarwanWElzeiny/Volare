export class PolygonCounter {
  constructor() {
    this.stats = { triangles: 0, vertices: 0, materials: 0, textures: 0 };
  }

  analyze(object) {
    this.stats = { triangles: 0, vertices: 0, materials: 0, textures: 0 };
    const materials = new Set();
    const textures = new Set();

    object.traverse(child => {
      if (child.isMesh) {
        const geometry = child.geometry;
        if (geometry.index) {
          this.stats.triangles += geometry.index.count / 3;
        } else {
          this.stats.triangles += geometry.attributes.position.count / 3;
        }
        this.stats.vertices += geometry.attributes.position.count;

        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(mat => {
              materials.add(mat.uuid);
              this.collectTextures(mat, textures);
            });
          } else {
            materials.add(child.material.uuid);
            this.collectTextures(child.material, textures);
          }
        }
      }
    });

    this.stats.materials = materials.size;
    this.stats.textures = textures.size;
    return this.stats;
  }

  collectTextures(material, textureSet) {
    Object.keys(material).forEach(key => {
      const value = material[key];
      if (value && value.isTexture) {
        textureSet.add(value.uuid);
      }
    });
  }
}