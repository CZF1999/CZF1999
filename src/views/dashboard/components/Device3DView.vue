<template>
  <ChartBox
    title="3D 设备模型"
    :subtitle="selectedDevice?.deviceName ?? '点击选择设备'"
  >
    <div ref="threeContainer" class="three-container"></div>
  </ChartBox>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useDeviceStore } from '@/stores/deviceStore'
import { useLayoutStore } from '@/stores/layoutStore'
import { getOptimalDPR } from '@/utils/dashboard'
import type { DeviceData, DeviceSummary } from '@/types/dashboard'
import ChartBox from '@/components/ChartBox.vue'

const threeContainer = ref<HTMLElement | null>(null)
const deviceStore = useDeviceStore()
const layoutStore = useLayoutStore()

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let animFrameId: number | null = null
let deviceMesh: THREE.Group | null = null
let resizeObserver: ResizeObserver | null = null

const selectedDevice = ref<DeviceSummary | null>(null)
let subscriberId: string | null = null

function initScene(): void {
  if (!threeContainer.value) return

  const dpr = getOptimalDPR()
  const w = threeContainer.value.clientWidth
  const h = threeContainer.value.clientHeight
  if (w === 0 || h === 0) return

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(dpr)
  renderer.setSize(w, h, false)
  threeContainer.value.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000)
  camera.position.set(5, 4, 8)
  camera.lookAt(0, 0, 0)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08

  scene.add(new THREE.AmbientLight(0x404060, 1.5))
  const dirLight = new THREE.DirectionalLight(0xffffff, 1)
  dirLight.position.set(5, 10, 7)
  scene.add(dirLight)

  const gridHelper = new THREE.GridHelper(6, 20, 0x335577, 0x223344)
  scene.add(gridHelper)

  buildDefaultModel()
}

function buildDefaultModel(): void {
  if (!scene) return
  if (deviceMesh) scene.remove(deviceMesh)

  deviceMesh = new THREE.Group()

  const bodyGeo = new THREE.CylinderGeometry(0.4, 0.5, 1.2, 32)
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x409eff, metalness: 0.6, roughness: 0.3,
  })
  const body = new THREE.Mesh(bodyGeo, bodyMat)
  body.position.y = 0.6
  deviceMesh.add(body)

  const topGeo = new THREE.SphereGeometry(0.3, 32, 16)
  const topMat = new THREE.MeshStandardMaterial({
    color: 0x40c8ff, emissive: 0x40c8ff, emissiveIntensity: 0.4,
  })
  const top = new THREE.Mesh(topGeo, topMat)
  top.position.y = 1.35
  deviceMesh.add(top)

  const baseGeo = new THREE.CylinderGeometry(0.55, 0.6, 0.2, 32)
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x336699, metalness: 0.8 })
  const base = new THREE.Mesh(baseGeo, baseMat)
  base.position.y = 0.1
  deviceMesh.add(base)

  scene.add(deviceMesh)
}

function animate(): void {
  animFrameId = requestAnimationFrame(animate)
  controls?.update()

  const selId = layoutStore.selectedDeviceId
  if (selId && deviceMesh) {
    const data = deviceStore.getDevice(selId)
    if (data) {
      const speed = data.metrics.speed ?? 0
      const temp = data.metrics.temperature ?? 25
      deviceMesh.rotation.y += (speed / 1500) * 0.05
      const color = temp > 80 ? 0xf56c6c : temp > 50 ? 0xe6a23c : 0x409eff
      ;(deviceMesh.children[0] as THREE.Mesh).material = new THREE.MeshStandardMaterial({
        color, metalness: 0.6, roughness: 0.3,
      })
    }
  }

  renderer?.render(scene!, camera!)
}

function handleResize(): void {
  if (!threeContainer.value || !renderer || !camera) return
  const w = threeContainer.value.clientWidth
  const h = threeContainer.value.clientHeight
  if (w === 0 || h === 0) return
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}

let rafPending = false
function scheduleResize(): void {
  if (!rafPending) {
    rafPending = true
    requestAnimationFrame(() => {
      rafPending = false
      handleResize()
    })
  }
}

watch(() => layoutStore.selectedDeviceId, (deviceId) => {
  if (deviceId) {
    const data = deviceStore.getDevice(deviceId)
    if (data) {
      selectedDevice.value = {
        deviceId: data.deviceId,
        deviceName: data.deviceName,
        type: data.type,
        status: data.status,
        position: data.position,
      }
    }
  }
})

onMounted(() => {
  initScene()
  animate()
  subscriberId = deviceStore.subscribe([layoutStore.selectedDeviceId].filter(Boolean) as string[])
  if (threeContainer.value) {
    resizeObserver = new ResizeObserver(() => scheduleResize())
    resizeObserver.observe(threeContainer.value)
  }
})

onBeforeUnmount(() => {
  if (animFrameId) cancelAnimationFrame(animFrameId)
  if (subscriberId) deviceStore.unsubscribe(subscriberId)
  resizeObserver?.disconnect()
  resizeObserver = null
  renderer?.dispose()
  controls?.dispose()
})
</script>

<style scoped lang="less">
.three-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
