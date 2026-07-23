import * as THREE from 'three';

class VLBFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = 'VLBFormatError';
    }
}

class VLBEncryptedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'VLBEncryptedError';
    }
}

class VLBLoader {
    constructor() {
        this.VLB_MAGIC = [0x56, 0x4C, 0x42, 0x00]; // 'VLB\0'
        this.VLB_HEADER_SIZE = 64;
        this.textDecoder = new TextDecoder();
        this.loadedModels = new Map(); // Cache for loaded models
        this.loadingPromises = new Map(); // Prevent duplicate loading
    }

    /**
     * Load single VLB file from URL or File object
     * @param {string|File} input - URL string or File object
     * @param {string} modelId - Optional unique identifier for caching
     * @returns {Promise<Object>} - Promise resolving to VLB data
     */
    async load(input, modelId = null) {
        const cacheKey = modelId || (typeof input === 'string' ? input : input.name);

        // Return cached model if available
        if (this.loadedModels.has(cacheKey)) {
            return this.loadedModels.get(cacheKey);
        }

        // Return ongoing loading promise if already loading
        if (this.loadingPromises.has(cacheKey)) {
            return this.loadingPromises.get(cacheKey);
        }

        // Start loading
        const loadPromise = this._loadModel(input);
        this.loadingPromises.set(cacheKey, loadPromise);

        try {
            const result = await loadPromise;
            this.loadedModels.set(cacheKey, result);
            this.loadingPromises.delete(cacheKey);
            return result;
        } catch (error) {
            this.loadingPromises.delete(cacheKey);
            throw error;
        }
    }

    /**
     * Load multiple VLB files concurrently
     * @param {Array} inputs - Array of {input: string|File, id?: string} objects
     * @returns {Promise<Array>} - Promise resolving to array of VLB data
     */
    async loadMultiple(inputs) {
        const loadPromises = inputs.map(({ input, id }) => this.load(input, id));
        return Promise.all(loadPromises);
    }

    /**
     * Internal method to load a single model
     * @param {string|File} input - URL string or File object
     * @returns {Promise<Object>} - Promise resolving to VLB data
     */
    async _loadModel(input) {
        try {
            let arrayBuffer;

            if (input instanceof File) {
                arrayBuffer = await input.arrayBuffer();
            } else if (typeof input === 'string') {
                const response = await fetch(input);
                if (!response.ok) {
                    throw new Error(`Failed to fetch VLB file: ${response.statusText}`);
                }
                arrayBuffer = await response.arrayBuffer();
            } else {
                throw new Error('Input must be a URL string or File object');
            }

            return await this.parseVLB(arrayBuffer);
        } catch (error) {
            console.error('VLB Loading Error:', error);
            throw error;
        }
    }

    /**
     * Parse VLB file from ArrayBuffer
     * @param {ArrayBuffer} buffer - VLB file data
     * @returns {Promise<Object>} - Parsed VLB data
     */
    async parseVLB(buffer) {
        if (!buffer || buffer.byteLength < this.VLB_HEADER_SIZE) {
            throw new VLBFormatError('Invalid VLB file format: header is truncated');
        }

        const dataView = new DataView(buffer);
        let offset = 0;

        // Read magic signature
        const magic = [];
        for (let i = 0; i < 4; i++) {
            magic.push(dataView.getUint8(offset + i));
        }
        offset += 4;

        // Verify magic signature
        if (!this.arrayEquals(magic, this.VLB_MAGIC)) {
            throw new VLBFormatError('Invalid VLB file format');
        }

        // Read header
        const version = dataView.getUint32(offset, true);
        offset += 4;

        if (version !== 1 && version !== 2) {
            throw new VLBFormatError(`Unsupported VLB version: ${version}`);
        }

        const flags = dataView.getUint32(offset, true);
        offset += 4;

        // VLB v2 = encrypted (bit 0 of flags). Cannot decrypt in the browser without a key.
        if (version >= 2 && (flags & 1)) {
            throw new VLBEncryptedError(
                'VLB file is encrypted (version 2). Encrypted VLB files require server-side ' +
                'decryption via the protected asset delivery pipeline. Use the /api/volare/asset ' +
                'endpoint with a valid license token, or load a non-encrypted model directly.'
            );
        }

        // Skip to data section
        offset = this.VLB_HEADER_SIZE;

        // Read chunk data
        const chunkData = new Uint8Array(buffer, offset);

        // Parse chunks
        const chunks = this.parseChunks(chunkData);

        return {
            version,
            flags,
            chunks
        };
    }

    /**
     * Parse chunks from data
     * @param {Uint8Array} data - Chunk data
     * @returns {Object} - Parsed chunks
     */
    parseChunks(data) {
        const chunks = {};
        let offset = 0;

        while (offset < data.length) {
            if (offset + 8 > data.length) {
                throw new VLBFormatError('Malformed VLB chunk: truncated chunk header');
            }

            // Read chunk header
            const chunkType = this.textDecoder.decode(data.slice(offset, offset + 4)).replace(/\0/g, '');
            offset += 4;

            const chunkSize = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true);
            offset += 4;

            if (!Number.isFinite(chunkSize) || chunkSize < 0) {
                throw new VLBFormatError('Malformed VLB chunk: invalid chunk size');
            }

            if (offset + chunkSize < offset || offset + chunkSize > data.length) {
                throw new VLBFormatError('Malformed VLB chunk: chunk data is truncated');
            }

            // Read chunk data
            const chunkData = data.slice(offset, offset + chunkSize);

            try {
                // Try to parse as JSON
                const jsonString = this.textDecoder.decode(chunkData);
                chunks[chunkType] = JSON.parse(jsonString);
            } catch (e) {
                // Store as raw bytes if JSON parsing fails
                chunks[chunkType] = chunkData;
            }

            offset += chunkSize;
        }

        return chunks;
    }

    /**
     * Convert VLB data to Three.js objects
     * @param {Object} vlbData - Parsed VLB data
     * @param {Object} options - Options for conversion
     * @returns {Object} - Three.js scene objects
     */
    toThreeJS(vlbData, options = {}) {
        const result = {
            meshes: [],
            materials: [],
            animations: [],
            lights: [],
            cameras: [],
            scene: new THREE.Scene()
        };

        const chunks = vlbData.chunks;

        // Process materials first
        if (chunks.MATL) {
            result.materials = this.createMaterials(chunks.MATL, options);
        }

        // Process meshes
        if (chunks.MESH) {
            result.meshes = this.createMeshes(chunks.MESH, result.materials, options);
            result.meshes.forEach(mesh => result.scene.add(mesh));
        }

        // Process lights
        if (chunks.LIGT) {
            result.lights = this.createLights(chunks.LIGT, options);
            result.lights.forEach(light => result.scene.add(light));
        }

        // Process cameras
        if (chunks.CAMR) {
            result.cameras = this.createCameras(chunks.CAMR, options);
        }

        // Process animations
        if (chunks.ANIM) {
            result.animations = this.createAnimations(chunks.ANIM, result.meshes, options);
        }

        return result;
    }

    /**
     * Create Three.js materials from VLB material data
     * @param {Array} materialData - Material data from VLB
     * @param {Object} options - Material options
     * @returns {Array} - Three.js materials
     */
    createMaterials(materialData, options = {}) {
        return materialData.map(matData => {
            const material = new THREE.MeshStandardMaterial({
                name: matData.name || 'Material',
                color: new THREE.Color(
                    matData.diffuse_color?.[0] || 0.8,
                    matData.diffuse_color?.[1] || 0.8,
                    matData.diffuse_color?.[2] || 0.8
                ),
                roughness: matData.roughness || 0.5,
                metalness: matData.metallic || 0.0
            });

            // Handle textures if present
            if (matData.textures && options.loadTextures !== false) {
                if (matData.textures.diffuse) {
                    const loader = new THREE.TextureLoader();
                    material.map = loader.load(matData.textures.diffuse);
                }
                if (matData.textures.normal) {
                    const loader = new THREE.TextureLoader();
                    material.normalMap = loader.load(matData.textures.normal);
                }
                if (matData.textures.specular) {
                    const loader = new THREE.TextureLoader();
                    material.roughnessMap = loader.load(matData.textures.specular);
                }
            }

            return material;
        });
    }

    /**
     * Create Three.js meshes from VLB mesh data
     * @param {Array} meshData - Mesh data from VLB
     * @param {Array} materials - Three.js materials
     * @param {Object} options - Mesh options
     * @returns {Array} - Three.js meshes
     */
    createMeshes(meshData, materials, options = {}) {
        return meshData.map((meshInfo, index) => {
            const geometry = new THREE.BufferGeometry();

            // Set vertices
            if (meshInfo.vertices) {
                const vertices = new Float32Array(meshInfo.vertices.flat());
                geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
            }

            // Set normals
            if (meshInfo.normals) {
                const normals = new Float32Array(meshInfo.normals.flat());
                geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
            }

            // Set UVs
            if (meshInfo.uvs) {
                const uvs = new Float32Array(meshInfo.uvs.flat());
                geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
            }

            // Set indices
            if (meshInfo.faces) {
                const indices = new Uint16Array(meshInfo.faces.flat());
                geometry.setIndex(new THREE.BufferAttribute(indices, 1));
            }

            // Compute normals if not provided
            if (!meshInfo.normals) {
                geometry.computeVertexNormals();
            }

            // Select material
            const material = materials[index % materials.length] || new THREE.MeshStandardMaterial();

            // Create mesh
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = meshInfo.name || `Mesh_${index}`;

            // Apply transform if provided
            if (options.applyTransform && meshInfo.transform) {
                if (meshInfo.transform.position) {
                    mesh.position.set(...meshInfo.transform.position);
                }
                if (meshInfo.transform.rotation) {
                    mesh.rotation.set(...meshInfo.transform.rotation);
                }
                if (meshInfo.transform.scale) {
                    mesh.scale.set(...meshInfo.transform.scale);
                }
            }

            return mesh;
        });
    }

    /**
     * Create Three.js lights from VLB light data
     * @param {Array} lightData - Light data from VLB
     * @param {Object} options - Light options
     * @returns {Array} - Three.js lights
     */
    createLights(lightData, options = {}) {
        return lightData.map(lightInfo => {
            let light;

            switch (lightInfo.type) {
                case 'directional':
                    light = new THREE.DirectionalLight(
                        new THREE.Color(lightInfo.color[0], lightInfo.color[1], lightInfo.color[2]),
                        lightInfo.intensity
                    );
                    light.position.set(lightInfo.position[0], lightInfo.position[1], lightInfo.position[2]);
                    if (lightInfo.target) {
                        light.target.position.set(lightInfo.target[0], lightInfo.target[1], lightInfo.target[2]);
                    }
                    break;

                case 'point':
                    light = new THREE.PointLight(
                        new THREE.Color(lightInfo.color[0], lightInfo.color[1], lightInfo.color[2]),
                        lightInfo.intensity,
                        lightInfo.distance || 0
                    );
                    light.position.set(lightInfo.position[0], lightInfo.position[1], lightInfo.position[2]);
                    break;

                case 'spot':
                    light = new THREE.SpotLight(
                        new THREE.Color(lightInfo.color[0], lightInfo.color[1], lightInfo.color[2]),
                        lightInfo.intensity,
                        lightInfo.distance || 0,
                        lightInfo.angle || Math.PI / 4,
                        lightInfo.penumbra || 0
                    );
                    light.position.set(lightInfo.position[0], lightInfo.position[1], lightInfo.position[2]);
                    if (lightInfo.target) {
                        light.target.position.set(lightInfo.target[0], lightInfo.target[1], lightInfo.target[2]);
                    }
                    break;

                default:
                    light = new THREE.AmbientLight(
                        new THREE.Color(lightInfo.color[0], lightInfo.color[1], lightInfo.color[2]),
                        lightInfo.intensity
                    );
                    break;
            }

            light.name = lightInfo.name || 'Light';
            return light;
        });
    }

    /**
     * Create Three.js cameras from VLB camera data
     * @param {Array} cameraData - Camera data from VLB
     * @param {Object} options - Camera options
     * @returns {Array} - Three.js cameras
     */
    createCameras(cameraData, options = {}) {
        return cameraData.map(camInfo => {
            const camera = new THREE.PerspectiveCamera(
                camInfo.fov || 75,
                options.aspect || (window.innerWidth / window.innerHeight),
                camInfo.near_plane || 0.1,
                camInfo.far_plane || 1000
            );

            camera.position.set(camInfo.position[0], camInfo.position[1], camInfo.position[2]);

            if (camInfo.target) {
                camera.lookAt(new THREE.Vector3(camInfo.target[0], camInfo.target[1], camInfo.target[2]));
            }

            if (camInfo.up) {
                camera.up.set(camInfo.up[0], camInfo.up[1], camInfo.up[2]);
            }

            camera.name = camInfo.name || 'Camera';
            return camera;
        });
    }

    /**
     * Create Three.js animations from VLB animation data
     * @param {Array} animData - Animation data from VLB
     * @param {Array} meshes - Three.js meshes
     * @param {Object} options - Animation options
     * @returns {Array} - Three.js animation clips
     */
    createAnimations(animData, meshes, options = {}) {
        return animData.map(animInfo => {
            const tracks = [];

            if (animInfo.channels) {
                animInfo.channels.forEach(channel => {
                    const targetMesh = meshes.find(mesh => mesh.name === channel.target);
                    if (!targetMesh) return;

                    const times = channel.keyframes.map(kf => kf.time);
                    const values = channel.keyframes.map(kf => kf.value).flat();

                    let trackName;
                    switch (channel.property) {
                        case 'translation':
                            trackName = `${targetMesh.name}.position`;
                            break;
                        case 'rotation':
                            trackName = `${targetMesh.name}.quaternion`;
                            break;
                        case 'scale':
                            trackName = `${targetMesh.name}.scale`;
                            break;
                        default:
                            return;
                    }

                    const track = new THREE.VectorKeyframeTrack(trackName, times, values);
                    tracks.push(track);
                });
            }

            return new THREE.AnimationClip(animInfo.name, animInfo.duration, tracks);
        });
    }

    /**
     * Clear cached models
     * @param {string} modelId - Optional specific model to clear
     */
    clearCache(modelId = null) {
        if (modelId) {
            this.loadedModels.delete(modelId);
        } else {
            this.loadedModels.clear();
        }
    }

    /**
     * Get cached model
     * @param {string} modelId - Model identifier
     * @returns {Object|null} - Cached model or null
     */
    getCachedModel(modelId) {
        return this.loadedModels.get(modelId) || null;
    }

    /**
     * Get file information without full parsing
     * @param {string|File} input - VLB file
     * @returns {Promise<Object>} - File information
     */
    async getFileInfo(input) {
        let arrayBuffer;

        if (input instanceof File) {
            const headerBlob = input.slice(0, this.VLB_HEADER_SIZE);
            arrayBuffer = await headerBlob.arrayBuffer();
        } else if (typeof input === 'string') {
            const response = await fetch(input, {
                headers: {
                    'Range': `bytes=0-${this.VLB_HEADER_SIZE - 1}`
                }
            });
            arrayBuffer = await response.arrayBuffer();
        }

        if (!arrayBuffer || arrayBuffer.byteLength < this.VLB_HEADER_SIZE) {
            throw new VLBFormatError('Invalid VLB file format: header is truncated');
        }

        const dataView = new DataView(arrayBuffer);
        const magic = [];
        for (let i = 0; i < 4; i++) {
            magic.push(dataView.getUint8(i));
        }

        if (!this.arrayEquals(magic, this.VLB_MAGIC)) {
            throw new VLBFormatError('Invalid VLB file format');
        }

        const version = dataView.getUint32(4, true);
        const flags = dataView.getUint32(8, true);

        return {
            version,
            flags,
            valid: true
        };
    }

    /**
     * Utility functions
     */
    arrayEquals(a, b) {
        return a.length === b.length && a.every((val, index) => val === b[index]);
    }
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VLBLoader;
} else if (typeof window !== 'undefined') {
    window.VLBLoader = VLBLoader;
}
export default VLBLoader;
export { VLBFormatError, VLBEncryptedError };
