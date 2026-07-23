export class TextureAnalyzer {
  constructor() {
    this.textureInfo = new Map();
    this.model = null;
  }

  setModel(model) {
    this.model = model;
    this.textureInfo.clear();
  }

  analyzeModel(object) {
    const results = [];
    object.traverse(child => {
      if (child.isMesh && child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(material => {
          const textureData = this.analyzeMaterial(material);
          if (textureData.length > 0) {
            results.push({
              objectName: child.name || 'Unnamed',
              materialName: material.name || 'Unnamed Material',
              textures: textureData
            });
          }
        });
      }
    });
    return results;
  }

  analyzeMaterial(material) {
    const textures = [];
    const textureProps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];

    textureProps.forEach(prop => {
      if (material[prop] && material[prop].isTexture) {
        const texture = material[prop];
        textures.push({
          type: prop,
          size: `${texture.image?.width || 'Unknown'}x${texture.image?.height || 'Unknown'}`,
          format: texture.format,
          minFilter: texture.minFilter,
          magFilter: texture.magFilter,
          wrapS: texture.wrapS,
          wrapT: texture.wrapT
        });
      }
    });
    return textures;
  }
}

export { TextureAnalyzer as TextureAnalyzerTool };
