import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js'
import GUI from 'lil-gui'
import gsap from 'gsap'
import particlesVertexShader from './Shaders/Particles/vertex.glsl'
import particlesFragmentShader from './Shaders/Particles/fragment.glsl'
import overlayVertexShader from './Shaders/Overlay/vertex.glsl'
import overlayFragmentShader from './Shaders/Overlay/fragment.glsl'
import gpgpuParticlesShader from './Shaders/gpgpu/gpgpu.glsl'
import { BufferGeometryUtils } from 'three/examples/jsm/Addons.js'


/**
 * Loaders
 */
// Loading
const loaderElement = document.querySelector('.loading')
const loadingManager = new THREE.LoadingManager(
    // Loaded
    () => {
        gsap.delayedCall(1, () => {

            loaderElement.style.display = 'none'

            gsap.to(
                overlayMaterial.uniforms.uAlpha, 
                { duration: 1.5, value: 0, delay: 0.5 }
            )

            window.setTimeout(() => {
                initGUI()
            }, 2000)
        })
    },
    // Progress
    (itemUrl, itemsLoaded, itemsTotal) => 
    {
        loaderElement.style.display = 'block'
    }
)

const dracoLoader = new DRACOLoader(loadingManager)
dracoLoader.setDecoderPath('/draco/')

const gltfLoader = new GLTFLoader(loadingManager)
gltfLoader.setDRACOLoader(dracoLoader)

/**
 * Base
 */
// Debug
let debugObject = {}

// Canvas
const canvas = document.querySelector('canvas.webgl')

// Scene
const scene = new THREE.Scene()

/**
 * Overlay
 */
const overlayGeometry = new THREE.PlaneGeometry(2, 2, 1, 1)
const overlayMaterial = new THREE.ShaderMaterial({
    vertexShader: overlayVertexShader,
    fragmentShader: overlayFragmentShader,
    uniforms: {
        uAlpha: new THREE.Uniform(1)
    },
    transparent: true,
    depthWrite: false,
})
const overlay = new THREE.Mesh(overlayGeometry, overlayMaterial)
scene.add(overlay)

/**
 * Sizes
 */
const sizes = {
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: Math.min(window.devicePixelRatio, 2)
}

window.addEventListener('resize', () =>
    {
        // Update sizes
        sizes.width = window.innerWidth
        sizes.height = window.innerHeight
        sizes.pixelRatio = Math.min(window.devicePixelRatio, 2)
    
        // Materials
        particles.material.uniforms.uResolution.value.set(sizes.width * sizes.pixelRatio, sizes.height * sizes.pixelRatio)
    
        // Update camera
        camera.aspect = sizes.width / sizes.height
        camera.updateProjectionMatrix()
    
        // Update renderer
        renderer.setSize(sizes.width, sizes.height)
        renderer.setPixelRatio(sizes.pixelRatio)
    })

/**
 * Camera
 */
// Base camera
const camera = new THREE.PerspectiveCamera(35, sizes.width / sizes.height, 0.1, 100)
camera.position.set(9.5, 10, 10)
scene.add(camera)


// Controls
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true

/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
})
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(sizes.pixelRatio)

debugObject.clearColor = '#021c1c'
renderer.setClearColor(debugObject.clearColor)

/**
 * Model
 */
const wine = await gltfLoader.loadAsync('./Model/wine.glb')

/**
 * Base geometry
 */
const baseGeometry = {}
// baseGeometry.instance = gltf.scene.children[0].geometry
const group = wine.scene.children[0] // El grupo que contiene los Mesha
const geometries = []

group.children.forEach(child => {
    if (child.isMesh) {
        geometries.push(child.geometry) // Agregar la geometría de cada Mesh al array
    }
});

if (geometries.length > 0) {
    // Combinar todas las geometrías en una sola
    const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries)
    baseGeometry.instance = mergedGeometry // Asignar la geometría combinada
}
baseGeometry.count = baseGeometry.instance.attributes.position.count 

/**
 * GPU compute
 */
// Set up
const gpgpu = {} 
gpgpu.size = Math.ceil(Math.sqrt(baseGeometry.count))
gpgpu.computation = new GPUComputationRenderer(gpgpu.size, gpgpu.size, renderer)

// Base particles
const baseParticlesTexture = gpgpu.computation.createTexture()

for(let i = 0; i < baseGeometry.count; i++)
{
    const i3 = i * 3
    const i4 = i * 4

    // Position based on geometry
    baseParticlesTexture.image.data[i4 + 0] = 
        baseGeometry.instance.attributes.position.array[i3 + 0]
    baseParticlesTexture.image.data[i4 + 1] = 
        baseGeometry.instance.attributes.position.array[i3 + 1]
    baseParticlesTexture.image.data[i4 + 2] = 
        baseGeometry.instance.attributes.position.array[i3 + 2]
    baseParticlesTexture.image.data[i4 + 3] = Math.random()
}

// Particles 
gpgpu.particlesVarible = gpgpu.computation.addVariable('uParticles', gpgpuParticlesShader, baseParticlesTexture)
gpgpu.computation.setVariableDependencies(gpgpu.particlesVarible, [ gpgpu.particlesVarible ])

// Uniforms
gpgpu.particlesVarible.material.uniforms.uTime = new THREE.Uniform(0)
gpgpu.particlesVarible.material.uniforms.uDeltaTime = new THREE.Uniform(0)
gpgpu.particlesVarible.material.uniforms.uBase = new THREE.Uniform(baseParticlesTexture)
gpgpu.particlesVarible.material.uniforms.uFlowFieldInfluence = 
    new THREE.Uniform(0.425)
gpgpu.particlesVarible.material.uniforms.uFlowFieldStrength = 
    new THREE.Uniform(1.065)
gpgpu.particlesVarible.material.uniforms.uFlowFieldFrequency = 
    new THREE.Uniform(0.238)

// Init
gpgpu.computation.init()

// Debug
gpgpu.debug = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 3),
    new THREE.MeshBasicMaterial({
        map: gpgpu.computation.getCurrentRenderTarget(
            gpgpu.particlesVarible
        ).texture
    })
)
gpgpu.debug.position.x = 3
scene.add(gpgpu.debug)
gpgpu.debug.visible = false

/**
 * Particles
 */
const particles = {}

// Geometry
particles.geometry = new THREE.BufferGeometry()
particles.geometry.setDrawRange(0, baseGeometry.count)

const particlesUvArray = new Float32Array(baseGeometry.count * 2)
const sizesArray = new Float32Array(baseGeometry.count)

for(let y = 0; y < gpgpu.size; y++)
{
    for(let x = 0; x < gpgpu.size; x++)
    {
        const i = (y * gpgpu.size + x)
        const i2 = i * 2

        // Particles UV
        const uvX = (x + 0.5) / gpgpu.size
        const uvY = (y + 0.5) / gpgpu.size

        particlesUvArray[i2 + 0] = uvX
        particlesUvArray[i2 + 1] = uvY

        // Size
        sizesArray[i] = Math.random()
    }
}

particles.geometry = new THREE.BufferGeometry()
particles.geometry.setDrawRange(0, baseGeometry.count)
particles.geometry.setAttribute('aParticlesUv', new THREE.BufferAttribute(particlesUvArray, 2))
particles.geometry.setAttribute('aColor', baseGeometry.instance.attributes.color)
particles.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizesArray, 1))

// Material
particles.material = new THREE.ShaderMaterial({
    vertexShader: particlesVertexShader,
    fragmentShader: particlesFragmentShader,
    uniforms:
    {
        uSize: new THREE.Uniform(0.169),
        uResolution: new THREE.Uniform(new THREE.Vector2(sizes.width * sizes.pixelRatio, sizes.height * sizes.pixelRatio)),
        uParticlesTexture: new THREE.Uniform()
    }
})

// Points
particles.points = new THREE.Points(particles.geometry, particles.material)
scene.add(particles.points)

/**
 * Tweaks
 */
function initGUI() {

    const gui = new GUI({ width: 340 })

    gui.addColor(debugObject, 'clearColor').onChange(() => { renderer.setClearColor(debugObject.clearColor) })
    gui.add(particles.material.uniforms.uSize, 'value').min(0).max(1).step(0.001).name('Size')
    gui.add(gpgpu.particlesVarible.material.uniforms.uFlowFieldInfluence, 'value').min(0).max(1).step(0.001).name('FlowField Influence')
    gui.add(gpgpu.particlesVarible.material.uniforms.uFlowFieldStrength, 'value').min(0).max(10).step(0.001).name('FlowField Strength')
    gui.add(gpgpu.particlesVarible.material.uniforms.uFlowFieldFrequency, 'value').min(0).max(1).step(0.001).name('FlowField Frequency')
}

/**
 * Animate
 */
const clock = new THREE.Clock()
let previousTime = 0

const tick = () =>
{
    const elapsedTime = clock.getElapsedTime()
    const deltaTime = elapsedTime - previousTime
    previousTime = elapsedTime
    
    // Update controls
    controls.update()
    
    // GPGPU update
    gpgpu.particlesVarible.material.uniforms.uTime.value = elapsedTime
    gpgpu.particlesVarible.material.uniforms.uDeltaTime.value = deltaTime
    gpgpu.computation.compute()
    particles.material.uniforms.uParticlesTexture.value =
        gpgpu.computation.getCurrentRenderTarget(
            gpgpu.particlesVarible
        ).texture

    // Render normal scene
    renderer.render(scene, camera)

    // Call tick again on the next frame
    window.requestAnimationFrame(tick)
}

tick()