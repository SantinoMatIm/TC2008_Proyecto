/*
 * Visualización de la ciudad con tráfico
 * Aquí se muestra toda la ciudad: calles, semáforos, edificios y coches
 */


'use strict';

import * as twgl from 'twgl-base.js';
import GUI from 'lil-gui';
import { M4 } from '../libs/3d-lib';
import { Scene3D } from '../libs/scene3d';
import { Object3D } from '../libs/object3d';
import { Camera3D } from '../libs/camera3d';
import { Light3D } from '../libs/light3d';
import { cubeSingleColor, cubeTextured, cylinder } from '../libs/shapes';

// Traemos las funciones y arrays para hablar con el servidor
import {
  cars, obstacles, trafficLights, destinations, roads,
  initTrafficModel, update, getCars, getObstacles,
  getTrafficLights, getDestinations, getRoads,
  setSpawnInterval, getMetrics, initData, setOnNewCarsCallback
} from '../libs/api_connection_traffic.js';

// Importar el loader de materiales MTL
import { loadMtl, clearMaterials } from '../libs/obj_loader.js';

// Los shaders que hacen que todo se vea bonito con iluminación
import vsGLSL from '../assets/shaders/vs_phong.glsl?raw';
import fsGLSL from '../assets/shaders/fs_phong.glsl?raw';

// Shaders para texturas (para el sol de Luis Miguel)
import vsTextureGLSL from '../assets/shaders/vs_texture.glsl?raw';
import fsTextureGLSL from '../assets/shaders/fs_texture.glsl?raw';

const scene = new Scene3D();
// Hacer la escena accesible globalmente para poder eliminar coches
window.scene = scene;

// Mapa rápido para saber la dirección de la calle en cada celda (x, z)
const roadDirectionMap = new Map();

// Variables globales que usamos en todo el código
let colorProgramInfo = undefined;
let textureProgramInfo = undefined;
let luisMiguelTexture = undefined;
let gl = undefined;
const duration = 1000; // cuánto dura cada actualización en milisegundos
let elapsed = 0;
let then = 0;

// Variables de intensidad de luz
let sunIntensity = 0.5;
let trafficLightIntensity = 0.75;
let streetLightIntensity = 1.25;

// Array para guardar posiciones de postes de luz
let streetLightPositions = [];

// Sistema de lluvia
let isRaining = true;
let rainDrops = [];

// Sistema de rayos
let lightning = null;
let lightningTimer = 0; // Timer que se incrementa continuamente
let lightningDuration = 0;
let nextLightningTime = 5000; // Primer rayo a los 5 segundos
let lightningInterval = 15000; // 15 segundos entre rayos


// Función principal, es async para poder hacer peticiones al servidor
async function main() {
  // Preparar el canvas donde se va a dibujar todo
  const canvas = document.querySelector('canvas');
  gl = canvas.getContext('webgl2');
  twgl.resizeCanvasToDisplaySize(gl.canvas);
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

  // Preparar los shaders
  colorProgramInfo = twgl.createProgramInfo(gl, [vsGLSL, fsGLSL]);
  textureProgramInfo = twgl.createProgramInfo(gl, [vsTextureGLSL, fsTextureGLSL]);

  // Cargar la textura de Luis Miguel
  luisMiguelTexture = twgl.createTexture(gl, {
    src: '/assets/luismiguelamarillo.JPG',
    mag: gl.LINEAR,
    min: gl.LINEAR_MIPMAP_LINEAR,
  });

  // Inicializar el modelo en el servidor
  await initTrafficModel();

  // Traer todos los elementos de la ciudad del servidor
  await getRoads();
  await getObstacles();
  await getTrafficLights();
  await getDestinations();
  await getCars();

  // Configurar la escena (cámara y luz)
  setupScene();

  // Poner todos los objetos en la escena
  await setupObjects(scene, gl, colorProgramInfo);

  // Crear la interfaz para controlar la luz
  setupUI();

  // Empezar el loop de dibujado
  drawScene();
}


function setupScene() {
  // Crear la cámara apuntando al centro de la ciudad (ESCALADO 3x)
  // Mapa 36x35, escalado 3x = 108x105, centro en (54, 52.5)
  let camera = new Camera3D(0,
    100,            // distancia de la cámara
    4.7,            // rotación horizontal
    1.0,            // rotación vertical
    [54, 0, 52.5],  // centro del mapa 36x35 escalado 3x
    [0, 0, 0]);
  camera.panOffset = [0, 30, 0];
  scene.setCamera(camera);
  scene.camera.setupControls();

  // Crear la luna para iluminar la ciudad
  const sun = new Light3D(
    0,
    [-80, 120, -30],                        // posición de la luna (más arriba y a la izquierda)
    [0.35, 0.4, 0.5, 1.0],                  // luz ambiental (tono azulado frío)
    [0.9, 0.95, 1.0, 1.0],                  // luz directa (blanca como la luna)
    [1.0, 1.0, 1.0, 1.0]                    // brillos (blancos puros)
  );
  scene.addLight(sun);
}

// Ahora cada obstáculo tiene su propio edificio individual

// Función para agregar nuevos carros a la escena (definida antes de setupObjects)
async function addNewCarsToScene(newCars) {
  if (!window.car2023Data || !window.car2024Data || !gl || !colorProgramInfo) {
    return;
  }

  for (const car of newCars) {
    await setupCar(car, gl, colorProgramInfo, window.car2023Data, window.car2024Data);
  }
}

async function setupObjects(scene, gl, programInfo) {
  // Crear cubos con diferentes colores para calles, destinos y sol
  const roadCube = new Object3D(-100);
  // Gris asfalto para las calles
  roadCube.arrays = cubeSingleColor(1, [0.25, 0.25, 0.28, 1.0]);
  roadCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, roadCube.arrays);
  roadCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, roadCube.bufferInfo);

  const destCube = new Object3D(-101);
  destCube.arrays = cubeSingleColor(1, [0.0, 1.0, 0.5, 1.0]);
  destCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, destCube.arrays);
  destCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, destCube.bufferInfo);

  // Cubo para la luna con color blanco
  const sunCube = new Object3D(-102);
  sunCube.arrays = cubeSingleColor(1, [1.0, 1.0, 1.0, 1.0]); // Blanco puro
  sunCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, sunCube.arrays);
  sunCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, sunCube.bufferInfo);

  // Cubo amarillo para marcar obstacles del servidor
  const obstacleCubeTemplate = new Object3D(-115);
  obstacleCubeTemplate.arrays = cubeSingleColor(1, [1.0, 1.0, 0.0, 1.0]);
  obstacleCubeTemplate.bufferInfo = twgl.createBufferInfoFromArrays(gl, obstacleCubeTemplate.arrays);
  obstacleCubeTemplate.vao = twgl.createVAOFromBufferInfo(gl, programInfo, obstacleCubeTemplate.bufferInfo);

  // Cilindro para las ruedas de los coches
  // Usamos 24 lados para que se note cuando gira
  const wheelCylinder = new Object3D(-116);
  wheelCylinder.arrays = cylinder(24, [0.15, 0.15, 0.15, 1.0]);
  wheelCylinder.bufferInfo = twgl.createBufferInfoFromArrays(gl, wheelCylinder.arrays);
  wheelCylinder.vao = twgl.createVAOFromBufferInfo(gl, programInfo, wheelCylinder.bufferInfo);
  window.wheelTemplate = wheelCylinder;

  // Césped húmedo - verde oscuro
  const grassCube = new Object3D(-104);
  grassCube.arrays = cubeSingleColor(1, [0.2, 0.5, 0.2, 1.0]); // Verde oscuro húmedo
  grassCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, grassCube.arrays);
  grassCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, grassCube.bufferInfo);

  // Gotas de lluvia - azul transparente
  const rainDropCube = new Object3D(-105);
  rainDropCube.arrays = cubeSingleColor(1, [0.7, 0.8, 0.9, 0.6]); // Azul claro semi-transparente
  rainDropCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, rainDropCube.arrays);
  rainDropCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, rainDropCube.bufferInfo);

  // Rayo - blanco brillante
  const lightningCube = new Object3D(-106);
  lightningCube.arrays = cubeSingleColor(1, [1.0, 1.0, 0.9, 1.0]); // Blanco amarillento brillante
  lightningCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, lightningCube.arrays);
  lightningCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, lightningCube.bufferInfo);

  // Arbustos verdes
  const bushCube = new Object3D(-107);
  bushCube.arrays = cubeSingleColor(1, [0.15, 0.45, 0.15, 1.0]);
  bushCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, bushCube.arrays);
  bushCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, bushCube.bufferInfo);

  // Arbustos verde oscuro
  const darkBushCube = new Object3D(-108);
  darkBushCube.arrays = cubeSingleColor(1, [0.1, 0.3, 0.1, 1.0]);
  darkBushCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, darkBushCube.arrays);
  darkBushCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, darkBushCube.bufferInfo);

  // Arbustos amarillentos
  const yellowBushCube = new Object3D(-109);
  yellowBushCube.arrays = cubeSingleColor(1, [0.4, 0.45, 0.2, 1.0]);
  yellowBushCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, yellowBushCube.arrays);
  yellowBushCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, yellowBushCube.bufferInfo);

  // Rocas
  const rockCube = new Object3D(-110);
  rockCube.arrays = cubeSingleColor(1, [0.4, 0.4, 0.45, 1.0]);
  rockCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, rockCube.arrays);
  rockCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, rockCube.bufferInfo);

  // Arbustos secos
  const deadBushCube = new Object3D(-111);
  deadBushCube.arrays = cubeSingleColor(1, [0.35, 0.25, 0.15, 1.0]);
  deadBushCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, deadBushCube.arrays);
  deadBushCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, deadBushCube.bufferInfo);

  // Plantas pequeñas
  const smallPlantCube = new Object3D(-112);
  smallPlantCube.arrays = cubeSingleColor(1, [0.2, 0.5, 0.25, 1.0]);
  smallPlantCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, smallPlantCube.arrays);
  smallPlantCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, smallPlantCube.bufferInfo);

  // Matas de hierba
  const grassClumpCube = new Object3D(-113);
  grassClumpCube.arrays = cubeSingleColor(1, [0.25, 0.55, 0.2, 1.0]);
  grassClumpCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, grassClumpCube.arrays);
  grassClumpCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, grassClumpCube.bufferInfo);

  // Líneas amarillas para la carretera
  const yellowLineCube = new Object3D(-114);
  yellowLineCube.arrays = cubeSingleColor(1, [0.9, 0.8, 0.2, 1.0]);
  yellowLineCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, yellowLineCube.arrays);
  yellowLineCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, yellowLineCube.bufferInfo);

  // Línea blanca para dividir carriles
  const whiteLineCube = new Object3D(-117);
  whiteLineCube.arrays = cubeSingleColor(1, [1.0, 1.0, 1.0, 1.0]);
  whiteLineCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, whiteLineCube.arrays);
  whiteLineCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, whiteLineCube.bufferInfo);

  // Cubos para semáforos - hechos con código, no OBJ
  // Caja negra del semáforo
  const trafficHousingCube = new Object3D(-200);
  trafficHousingCube.arrays = cubeSingleColor(1, [0.15, 0.15, 0.15, 1.0]);
  trafficHousingCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, trafficHousingCube.arrays);
  trafficHousingCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, trafficHousingCube.bufferInfo);

  // Luz roja brillante (encendida)
  const redLightOnCube = new Object3D(-201);
  redLightOnCube.arrays = cubeSingleColor(1, [1.0, 0.1, 0.1, 1.0]);
  redLightOnCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, redLightOnCube.arrays);
  redLightOnCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, redLightOnCube.bufferInfo);

  // Luz roja apagada
  const redLightOffCube = new Object3D(-202);
  redLightOffCube.arrays = cubeSingleColor(1, [0.3, 0.05, 0.05, 1.0]);
  redLightOffCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, redLightOffCube.arrays);
  redLightOffCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, redLightOffCube.bufferInfo);

  // Luz verde brillante (encendida)
  const greenLightOnCube = new Object3D(-203);
  greenLightOnCube.arrays = cubeSingleColor(1, [0.1, 1.0, 0.3, 1.0]);
  greenLightOnCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, greenLightOnCube.arrays);
  greenLightOnCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, greenLightOnCube.bufferInfo);

  // Luz verde apagada
  const greenLightOffCube = new Object3D(-204);
  greenLightOffCube.arrays = cubeSingleColor(1, [0.05, 0.25, 0.08, 1.0]);
  greenLightOffCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, greenLightOffCube.arrays);
  greenLightOffCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, greenLightOffCube.bufferInfo);

  // Guardar referencias globales para los templates de semáforo
  window.trafficLightTemplates = {
    housing: trafficHousingCube,
    redOn: redLightOnCube,
    redOff: redLightOffCube,
    greenOn: greenLightOnCube,
    greenOff: greenLightOffCube
  };

  // Los coches se cargarán individualmente con colores random
  const car2023Data = await fetch('/assets/models/car-2023-textures.obj').then(r => r.text());
  const car2024Data = await fetch('/assets/models/car-2024-301.obj').then(r => r.text());

  // Cargar edificio 1 con sus materiales
  clearMaterials();
  const building1MtlData = await fetch('/assets/models/building_1.mtl').then(r => r.text());
  loadMtl(building1MtlData);
  const building1Obj = new Object3D(-203);
  const building1Data = await fetch('/assets/models/building_1.obj').then(r => r.text());
  building1Obj.prepareVAO(gl, programInfo, building1Data);

  // Cargar edificio 2 con sus materiales
  clearMaterials();
  const building2MtlData = await fetch('/assets/models/building_2.mtl').then(r => r.text());
  loadMtl(building2MtlData);
  const building2Obj = new Object3D(-204);
  const building2Data = await fetch('/assets/models/building_2.obj').then(r => r.text());
  building2Obj.prepareVAO(gl, programInfo, building2Data);

  // Cargar casa de suburbios con sus materiales
  clearMaterials();
  const suburbanHouseMtlData = await fetch('/assets/models/suburban_house.mtl').then(r => r.text());
  loadMtl(suburbanHouseMtlData);
  const building3Obj = new Object3D(-205);
  const building3Data = await fetch('/assets/models/suburban_house.obj').then(r => r.text());
  building3Obj.prepareVAO(gl, programInfo, building3Data);

  // Cargar edificio de departamentos con sus materiales
  clearMaterials();
  const apartmentMtlData = await fetch('/assets/models/apartment_building.mtl').then(r => r.text());
  loadMtl(apartmentMtlData);
  const building4Obj = new Object3D(-206);
  const building4Data = await fetch('/assets/models/apartment_building.obj').then(r => r.text());
  building4Obj.prepareVAO(gl, programInfo, building4Data);

  // Cargar torre de oficinas con sus materiales
  clearMaterials();
  const officeTowerMtlData = await fetch('/assets/models/office_tower.mtl').then(r => r.text());
  loadMtl(officeTowerMtlData);
  const building5Obj = new Object3D(-207);
  const building5Data = await fetch('/assets/models/office_tower.obj').then(r => r.text());
  building5Obj.prepareVAO(gl, programInfo, building5Data);

  // Cargar warehouse con sus materiales
  clearMaterials();
  const warehouseMtlData = await fetch('/assets/models/warehouse.mtl').then(r => r.text());
  loadMtl(warehouseMtlData);
  const building6Obj = new Object3D(-208);
  const building6Data = await fetch('/assets/models/warehouse.obj').then(r => r.text());
  building6Obj.prepareVAO(gl, programInfo, building6Data);

  // Cargar árbol con sus materiales
  clearMaterials();
  const treeMtlData = await fetch('/assets/models/tree.mtl').then(r => r.text());
  loadMtl(treeMtlData);
  const treeObj = new Object3D(-209);
  const treeData = await fetch('/assets/models/tree.obj').then(r => r.text());
  treeObj.prepareVAO(gl, programInfo, treeData);

  // Poste de luz
  clearMaterials();
  const streetlightMtlData = await fetch('/assets/models/streetlight.mtl').then(r => r.text());
  loadMtl(streetlightMtlData);
  const streetlightObj = new Object3D(-210);
  const streetlightData = await fetch('/assets/models/streetlight.obj').then(r => r.text());
  streetlightObj.prepareVAO(gl, programInfo, streetlightData);

  // Configurar las calles - ESCALADO 3x
  let lineIndex = 0;
  let roadIndex = 0;
  for (const road of roads) {
    road.arrays = roadCube.arrays;
    road.bufferInfo = roadCube.bufferInfo;
    road.vao = roadCube.vao;
    road.scale = { x: 1.5, y: 0.15, z: 1.5 };
    road.color = [0.25, 0.25, 0.28, 1.0];

    // Guardar dirección ANTES de escalar para el mapa de direcciones
    const key = `${Math.round(road.position.x * 3 + 1.5)},${Math.round(road.position.z * 3 + 1.5)}`;
    roadDirectionMap.set(key, road.direction);

    // Centrar en la celda escalada (3x + 1.5)
    const scaledX = road.position.x * 3 + 1.5;
    const scaledZ = road.position.z * 3 + 1.5;
    road.position.x = scaledX;
    road.position.z = scaledZ;
    scene.addObject(road);

    roadIndex++;

    // Agregar media línea blanca en el borde del carril
    // Cuando dos carriles opuestos están juntos, sus medias líneas forman la división
    const dir = road.direction;
    const halfOffset = 1.4; // Casi en el borde de la celda (celda es 3x3)

    if (dir === 'Up') {
      // Carril hacia arriba media línea en el borde derecho (+X)
      const line = new Object3D(`road-line-${lineIndex++}`, [scaledX + halfOffset, 0.16, scaledZ]);
      line.arrays = whiteLineCube.arrays;
      line.bufferInfo = whiteLineCube.bufferInfo;
      line.vao = whiteLineCube.vao;
      line.scale = { x: 0.05, y: 0.02, z: 1.2 };
      scene.addObject(line);
    } else if (dir === 'Down') {
      // Carril hacia abajo media línea en el borde izquierdo (-X)
      const line = new Object3D(`road-line-${lineIndex++}`, [scaledX - halfOffset, 0.16, scaledZ]);
      line.arrays = whiteLineCube.arrays;
      line.bufferInfo = whiteLineCube.bufferInfo;
      line.vao = whiteLineCube.vao;
      line.scale = { x: 0.05, y: 0.02, z: 1.2 };
      scene.addObject(line);
    } else if (dir === 'Right') {
      // Carril hacia la derecha media línea en el borde inferior (-Z)
      const line = new Object3D(`road-line-${lineIndex++}`, [scaledX, 0.16, scaledZ - halfOffset]);
      line.arrays = whiteLineCube.arrays;
      line.bufferInfo = whiteLineCube.bufferInfo;
      line.vao = whiteLineCube.vao;
      line.scale = { x: 1.2, y: 0.02, z: 0.05 };
      scene.addObject(line);
    } else if (dir === 'Left') {
      // Carril hacia la izquierda media línea en el borde superior (+Z)
      const line = new Object3D(`road-line-${lineIndex++}`, [scaledX, 0.16, scaledZ + halfOffset]);
      line.arrays = whiteLineCube.arrays;
      line.bufferInfo = whiteLineCube.bufferInfo;
      line.vao = whiteLineCube.vao;
      line.scale = { x: 1.2, y: 0.02, z: 0.05 };
      scene.addObject(line);
    }
  }

  // Sistema de edificios: UN edificio por cada CLUSTER de obstáculos
  // Paso 1: Crear set de posiciones de obstáculos
  const obstacleSet = new Set();
  for (const obs of obstacles) {
    obstacleSet.add(`${obs.position.x},${obs.position.z}`);
  }

  // Paso 2: Flood-fill para encontrar clusters de celdas adyacentes
  const visited = new Set();
  const clusters = [];

  function floodFill(startX, startZ) {
    const cluster = [];
    const stack = [[startX, startZ]];
    while (stack.length > 0) {
      const [x, z] = stack.pop();
      const key = `${x},${z}`;
      if (visited.has(key) || !obstacleSet.has(key)) continue;
      visited.add(key);
      cluster.push({ x, z });
      stack.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]);
    }
    return cluster;
  }

  for (const obs of obstacles) {
    const key = `${obs.position.x},${obs.position.z}`;
    if (!visited.has(key)) {
      const cluster = floodFill(obs.position.x, obs.position.z);
      if (cluster.length > 0) clusters.push(cluster);
    }
  }

  // Rascacielos (building1 y building2) - máximo 2 en total, los más altos
  const skyscrapers = [
    { obj: building1Obj, scaleMult: 0.3, isSkyscraper: true },
    { obj: building2Obj, scaleMult: 0.3, isSkyscraper: true },
  ];

  // Edificios normales (los otros 4) - mismo ratio de aparición
  const normalBuildings = [
    { obj: building3Obj, heightMult: 0.8, scaleMult: 1.0 },
    { obj: building4Obj, heightMult: 1.4, scaleMult: 1.0 },
    { obj: building5Obj, heightMult: 1.6, scaleMult: 0.5 },  // office_tower más pequeño
    { obj: building6Obj, heightMult: 1.0, scaleMult: 0.5 },  // warehouse/ladrillo más pequeño
  ];

  // Tamaño base de los modelos OBJ (entre 1.5 y 3 según pruebas)
  const MODEL_BASE_SIZE = 2.0;

  // Contador de rascacielos colocados (máximo 2)
  let skyscrapersPlaced = 0;
  const MAX_SKYSCRAPERS = 2;


  // Asignación de edificios por cluster (0=árboles, 1-2=rascacielos, 3=casa, 4=depto, 5=oficina, 6=bodega)
  const clusterToBuilding = {
    0: 6,
    1: 4,
    2: 0,
    5: 0,
    26: 4,
  };

  const rotatedClusters = [5, 11];

  // Todos los edificios disponibles
  const allBuildings = {
    1: { obj: building1Obj, scaleMult: 0.6, isSkyscraper: true },
    2: { obj: building2Obj, scaleMult: 0.6, isSkyscraper: true },
    3: { obj: building3Obj, heightMult: 0.8, scaleMult: 1.0 },
    4: { obj: building4Obj, heightMult: 0.4, scaleMult: 1.0 },
    5: { obj: building5Obj, heightMult: 1.6, scaleMult: 0.5 },
    6: { obj: building6Obj, heightMult: 1.0, scaleMult: 0.5 },
  };


  // Paso 3: Colocar UN edificio por cada cluster
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];

    // Calcular bounding box del cluster
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const cell of cluster) {
      minX = Math.min(minX, cell.x);
      maxX = Math.max(maxX, cell.x);
      minZ = Math.min(minZ, cell.z);
      maxZ = Math.max(maxZ, cell.z);
    }

    // Dimensiones del cluster en celdas
    const widthCells = maxX - minX + 1;
    const depthCells = maxZ - minZ + 1;

    // Dimensiones EXACTAS en unidades del mundo (cada celda = 3 unidades)
    const worldWidth = widthCells * 3;
    const worldDepth = depthCells * 3;

    // Centro del cluster en coordenadas del mundo
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const scaledCenterX = centerX * 3 + 1.5;
    const scaledCenterZ = centerZ * 3 + 1.5;

    // Asignar edificios a clusters ABAJO que serían casas
    const isBottom = centerZ < 15;
    const isNotThin = widthCells > 1 && depthCells > 1;
    if (isBottom && isNotThin && clusterToBuilding[i] === undefined) {
      // Solo UN rascacielos de cada tipo
      if (!window.sky1Done && centerX < 12 && cluster.length > 4) {
        clusterToBuilding[i] = 1;
        window.sky1Done = true;
      } else if (!window.sky2Done && centerX > 24 && cluster.length > 4) {
        clusterToBuilding[i] = 2;
        window.sky2Done = true;
      } else if (centerZ < 7) {
        clusterToBuilding[i] = 4;  // Apartment
      } else if (centerZ < 12) {
        clusterToBuilding[i] = 5;  // Office tower
      } else {
        clusterToBuilding[i] = 6;  // Warehouse
      }
    }

    // Elegir edificio del mapeo manual, o default si no está definido
    // Clusters delgados (1 celda de ancho o alto) automáticamente son árboles y postes
    let buildingNum;
    if (clusterToBuilding[i] !== undefined) {
      buildingNum = clusterToBuilding[i];
    } else if (widthCells === 1 || depthCells === 1) {
      buildingNum = 0;  // árboles y postes para clusters delgados
    } else {
      buildingNum = 3;  // default: suburban_house
    }


    // Caso especial: 0 = árboles y postes de luz intercalados
    if (buildingNum === 0) {
      let itemIndex = 0;
      const clusterSize = cluster.length;

      for (const cell of cluster) {
        const cellX = cell.x * 3 + 1.5;
        const cellZ = cell.z * 3 + 1.5;

        // Si el cluster tiene 1 sola celda, poner poste de luz
        // Si no, poner poste cada 4 elementos (después de 3 árboles)
        // También poner poste en el último elemento si no hay ninguno aún
        const isLastItem = itemIndex === clusterSize - 1;
        const noLightsYet = itemIndex < 3;
        const forceLight = isLastItem && noLightsYet && clusterSize > 1;
        if (clusterSize === 1 || itemIndex % 4 === 3 || forceLight) {
          // Poste de luz
          const post = new Object3D(`light-cluster${i}-${itemIndex}`, [cellX, 0, cellZ]);
          post.arrays = streetlightObj.arrays;
          post.bufferInfo = streetlightObj.bufferInfo;
          post.vao = streetlightObj.vao;
          post.scale = { x: 1.0, y: 1.0, z: 1.0 };

          // Rotar si está en la lista de clusters rotados
          // O si es un cluster delgado en la parte derecha del mapa (x > 20)
          const shouldRotate = rotatedClusters.includes(i) || (cell.x > 20 && (widthCells === 1 || depthCells === 1));
          if (shouldRotate) {
            post.rotRad.y = Math.PI / 2;  // 90 grados
          }

          scene.addObject(post);

          // Agregar posición para que emita luz
          streetLightPositions.push({ x: cellX, y: 4, z: cellZ });
        } else {
          // Árbol
          const tree = new Object3D(`tree-cluster${i}-${itemIndex}`, [cellX, 0, cellZ]);
          tree.arrays = treeObj.arrays;
          tree.bufferInfo = treeObj.bufferInfo;
          tree.vao = treeObj.vao;
          tree.scale = { x: 1.0, y: 1.0, z: 1.0 };
          scene.addObject(tree);
        }
        itemIndex++;
      }
      continue;
    }

    const buildingType = allBuildings[buildingNum];

    // Escalar X y Z INDEPENDIENTEMENTE, ajustado por scaleMult del modelo
    const scaleX = (worldWidth / MODEL_BASE_SIZE) * buildingType.scaleMult;
    const scaleZ = (worldDepth / MODEL_BASE_SIZE) * buildingType.scaleMult;

    const building = new Object3D(`building-${i}`, [scaledCenterX, 0, scaledCenterZ]);
    building.arrays = buildingType.obj.arrays;
    building.bufferInfo = buildingType.obj.bufferInfo;
    building.vao = buildingType.obj.vao;

    // Altura: rascacielos siempre los más altos, edificios normales limitados
    const SKYSCRAPER_HEIGHT = 8;
    const MAX_NORMAL_HEIGHT = 4;

    let buildingHeight;
    if (buildingType.isSkyscraper) {
      buildingHeight = SKYSCRAPER_HEIGHT;
    } else {
      const rawHeight = Math.min(scaleX, scaleZ) * (buildingType.heightMult || 1.0);
      buildingHeight = Math.min(rawHeight, MAX_NORMAL_HEIGHT);
    }

    building.scale = {
      x: scaleX,
      y: buildingHeight,
      z: scaleZ
    };
    scene.addObject(building);
  }


  // Configurar los semáforos como cabinas flotantes orientadas según la calle
  const templates = window.trafficLightTemplates;
  for (const light of trafficLights) {
    const scaledX = light.position.x * 3 + 1.5;
    const scaledZ = light.position.z * 3 + 1.5;
    const floatHeight = 4.5;

    // Buscar la dirección de la calle para orientar el semáforo
    const lightKey = `${Math.round(scaledX)},${Math.round(scaledZ)}`;
    const roadDir = roadDirectionMap.get(lightKey);

    // Calcular offsets para las luces según la orientación
    // Las luces deben sobresalir hacia donde vienen los coches (opuesto a la dirección)
    let lightOffsetX = 0;
    let lightOffsetZ = 0;
    let housingScaleX = 0.6;
    let housingScaleZ = 0.4;
    let rotation = 0;

    switch (roadDir) {
      case 'Up':
        // Coches van hacia +Z, semáforo mira hacia -Z
        lightOffsetZ = -0.5;
        rotation = Math.PI;
        break;
      case 'Down':
        // Coches van hacia -Z, semáforo mira hacia +Z
        lightOffsetZ = 0.5;
        rotation = 0;
        break;
      case 'Right':
        // Coches van hacia +X, semáforo mira hacia -X
        lightOffsetX = -0.5;
        housingScaleX = 0.4;
        housingScaleZ = 0.6;
        rotation = -Math.PI / 2;
        break;
      case 'Left':
        // Coches van hacia -X, semáforo mira hacia +X
        lightOffsetX = 0.5;
        housingScaleX = 0.4;
        housingScaleZ = 0.6;
        rotation = Math.PI / 2;
        break;
      default:
        lightOffsetZ = 0.5;
        break;
    }

    // Crear la caja negra del semáforo (housing)
    const housing = new Object3D(`tl-housing-${light.id}`, [scaledX, floatHeight, scaledZ]);
    housing.arrays = templates.housing.arrays;
    housing.bufferInfo = templates.housing.bufferInfo;
    housing.vao = templates.housing.vao;
    housing.scale = { x: housingScaleX, y: 1.5, z: housingScaleZ };
    housing.rotRad.y = rotation;
    scene.addObject(housing);

    // Crear luz roja (arriba) - sobresale en la dirección correcta
    const redLight = new Object3D(`tl-red-${light.id}`, [
      scaledX + lightOffsetX,
      floatHeight + 0.45,
      scaledZ + lightOffsetZ
    ]);
    redLight.arrays = light.state ? templates.redOff.arrays : templates.redOn.arrays;
    redLight.bufferInfo = light.state ? templates.redOff.bufferInfo : templates.redOn.bufferInfo;
    redLight.vao = light.state ? templates.redOff.vao : templates.redOn.vao;
    redLight.scale = { x: 0.35, y: 0.35, z: 0.35 };
    scene.addObject(redLight);

    // Crear luz verde (abajo) - sobresale en la dirección correcta
    const greenLight = new Object3D(`tl-green-${light.id}`, [
      scaledX + lightOffsetX,
      floatHeight - 0.45,
      scaledZ + lightOffsetZ
    ]);
    greenLight.arrays = light.state ? templates.greenOn.arrays : templates.greenOff.arrays;
    greenLight.bufferInfo = light.state ? templates.greenOn.bufferInfo : templates.greenOff.bufferInfo;
    greenLight.vao = light.state ? templates.greenOn.vao : templates.greenOff.vao;
    greenLight.scale = { x: 0.35, y: 0.35, z: 0.35 };
    scene.addObject(greenLight);

    // Guardar referencias a los componentes
    light.housingObj = housing;
    light.redLightObj = redLight;
    light.greenLightObj = greenLight;

    // Guardar posición para el sistema de luces del shader
    light.position.x = scaledX;
    light.position.z = scaledZ;
    light.position.y = floatHeight;
  }

  // Configurar los destinos (donde van los coches)
  for (const dest of destinations) {
    dest.arrays = destCube.arrays;
    dest.bufferInfo = destCube.bufferInfo;
    dest.vao = destCube.vao;
    dest.scale = { x: 2.4, y: 0.3, z: 2.4 };
    // Centrar en la celda escalada
    dest.position.x = dest.position.x * 3 + 1.5;
    dest.position.z = dest.position.z * 3 + 1.5;
    dest.position.y = 0.15;
    scene.addObject(dest);
  }

  // Guardar referencias a los modelos de carros para poder crear nuevos después
  window.car2023Data = car2023Data;
  window.car2024Data = car2024Data;
  window.setupCar = setupCar;

  // Configurar los coches eligiendo aleatoriamente entre los 2 modelos
  // Cada coche tendrá un color random pero ventanas azul claro
  for (const car of cars) {
    setupCar(car, gl, programInfo, car2023Data, car2024Data);
  }

  // Configurar callback para nuevos carros después de que los modelos estén cargados
  setOnNewCarsCallback(addNewCarsToScene);

  // Crear una representación visual de la luna
  const sun = scene.lights[0];
  const sunObj = new Object3D(-999);
  sunObj.arrays = sunCube.arrays;
  sunObj.bufferInfo = sunCube.bufferInfo;
  sunObj.vao = sunCube.vao;
  sunObj.position = sun.position;
  sunObj.scale = { x: 21, y: 21, z: 21 };
  scene.addObject(sunObj);

  // Crear pasto que cubre todo el mapa
  const grassGround = new Object3D('grass-ground', [0, -0.15, 0]);
  grassGround.arrays = grassCube.arrays;
  grassGround.bufferInfo = grassCube.bufferInfo;
  grassGround.vao = grassCube.vao;
  grassGround.scale = { x: 300, y: 0.1, z: 300 };
  scene.addObject(grassGround);

  // Crear carretera infinita que se extiende desde el borde derecho de la ciudad
  // Ciudad termina en x=108, carretera empieza ahí y va hasta el límite del mundo (300)
  const highwayStartX = 110;
  const highwayCenterZ = 52.5;  // Centro de la ciudad en Z
  const highwayEndX = 295;      // Casi al límite del pasto (300)
  const highwayLength = highwayEndX - highwayStartX;
  const highway = new Object3D('highway', [highwayStartX + highwayLength/2, -0.08, highwayCenterZ]);
  highway.arrays = roadCube.arrays;
  highway.bufferInfo = roadCube.bufferInfo;
  highway.vao = roadCube.vao;
  highway.scale = { x: highwayLength, y: 0.1, z: 6 };
  highway.shininess = 100.0;
  scene.addObject(highway);

  // Crear líneas amarillas en el centro de la carretera
  const numLines = Math.floor(highwayLength / 6);
  for (let i = 0; i < numLines; i++) {
    const line = new Object3D(`highway-line-${i}`, [highwayStartX + 5 + (i * 6), -0.02, highwayCenterZ]);
    line.arrays = yellowLineCube.arrays;
    line.bufferInfo = yellowLineCube.bufferInfo;
    line.vao = yellowLineCube.vao;
    line.scale = { x: 2.5, y: 0.08, z: 0.25 };
    line.shininess = 80.0;
    scene.addObject(line);
  }

  // Función para crear semicírculos centrados (usado para el túnel de luz)
  function createSemicircle(radius, segments, color) {
    const positions = [];
    const normals = [];
    const colors = [];
    const indices = [];

    // Centro del semicírculo
    positions.push(0, 0, 0);
    normals.push(-1, 0, 0);  // Normal del centro apunta hacia el espectador
    colors.push(...color);

    // Vértices del arco con normales que apuntan hacia afuera
    for (let i = 0; i <= segments; i++) {
      const angle = Math.PI * i / segments;
      const y = radius * Math.sin(angle);
      const z = radius * Math.cos(angle);
      positions.push(0, y, z);
      // Normal apunta hacia afuera (hacia -X, donde está el espectador)
      normals.push(-1, 0, 0);
      colors.push(...color);
    }

    // Triángulos desde el centro hacia el arco
    for (let i = 0; i < segments; i++) {
      indices.push(0, i + 1, i + 2);
    }

    return {
      a_position: { numComponents: 3, data: positions },
      a_normal: { numComponents: 3, data: normals },
      a_color: { numComponents: 4, data: colors },
      indices: { numComponents: 3, data: indices }
    };
  }

  // Crear túnel de luz decorativo al final de la carretera (4 capas)
  // Carretera termina en x=295, túnel justo ahí, centrado en Z=52.5
  const tunnelX = 295;
  const tunnelZ = 52.5;  // Mismo centro Z que la carretera

  const lightTunnel1 = new Object3D('light-tunnel', [tunnelX, 0, tunnelZ]);
  lightTunnel1.arrays = createSemicircle(6, 32, [1.0, 1.0, 1.0, 1.0]);
  lightTunnel1.bufferInfo = twgl.createBufferInfoFromArrays(gl, lightTunnel1.arrays);
  lightTunnel1.vao = twgl.createVAOFromBufferInfo(gl, programInfo, lightTunnel1.bufferInfo);
  lightTunnel1.shininess = 1000.0;
  scene.addObject(lightTunnel1);

  const lightTunnel2 = new Object3D('light-tunnel-2', [tunnelX, 0, tunnelZ]);
  lightTunnel2.arrays = createSemicircle(12, 32, [1.0, 1.0, 0.9, 0.9]);
  lightTunnel2.bufferInfo = twgl.createBufferInfoFromArrays(gl, lightTunnel2.arrays);
  lightTunnel2.vao = twgl.createVAOFromBufferInfo(gl, programInfo, lightTunnel2.bufferInfo);
  lightTunnel2.shininess = 1000.0;
  scene.addObject(lightTunnel2);

  const lightTunnel3 = new Object3D('light-tunnel-3', [tunnelX, 0, tunnelZ]);
  lightTunnel3.arrays = createSemicircle(18, 32, [1.0, 0.95, 0.8, 0.7]);
  lightTunnel3.bufferInfo = twgl.createBufferInfoFromArrays(gl, lightTunnel3.arrays);
  lightTunnel3.vao = twgl.createVAOFromBufferInfo(gl, programInfo, lightTunnel3.bufferInfo);
  lightTunnel3.shininess = 1000.0;
  scene.addObject(lightTunnel3);

  const lightTunnel4 = new Object3D('light-tunnel-outer', [tunnelX, 0, tunnelZ]);
  lightTunnel4.arrays = createSemicircle(25, 32, [1.0, 0.9, 0.7, 0.5]);
  lightTunnel4.bufferInfo = twgl.createBufferInfoFromArrays(gl, lightTunnel4.arrays);
  lightTunnel4.vao = twgl.createVAOFromBufferInfo(gl, programInfo, lightTunnel4.bufferInfo);
  lightTunnel4.shininess = 1000.0;
  scene.addObject(lightTunnel4);

  // Crear 400 gotas de lluvia 
  for (let i = 0; i < 400; i++) {
    const drop = new Object3D(`rain-${i}`, [
      Math.random() * 600 - 300,
      Math.random() * 60 + 10,
      Math.random() * 600 - 300
    ]);
    drop.arrays = rainDropCube.arrays;
    drop.bufferInfo = rainDropCube.bufferInfo;
    drop.vao = rainDropCube.vao;
    drop.scale = { x: 0.08, y: 0.8, z: 0.08 };
    drop.velocity = Math.random() * 0.3 + 0.5;
    drop.visible = false;
    rainDrops.push(drop);
    scene.addObject(drop);
  }

  // Crear rayo que aparecerá durante la lluvia
  // Ciudad es 108x105 unidades
  lightning = new Object3D('lightning', [
    Math.random() * 108,
    40,
    Math.random() * 105
  ]);
  lightning.arrays = lightningCube.arrays;
  lightning.bufferInfo = lightningCube.bufferInfo;
  lightning.vao = lightningCube.vao;
  lightning.scale = { x: 0.5, y: 80, z: 0.5 };
  lightning.visible = false;
  scene.addObject(lightning);

  // Generar 800 objetos de flora alrededor del mapa (optimizado para rendimiento)
  // Ciudad es 36x35 celdas escaladas 3x = 108x105 unidades
  const cityMinX = -3;
  const cityMaxX = 111;
  const cityMinZ = -3;
  const cityMaxZ = 108;
  const minSeparation = 5;
  const worldLimit = 300;

  for (let i = 0; i < 800; i++) {
    let x, z;
    const zone = i % 4;

    // Distribuir la flora en 4 zonas alrededor de la ciudad
    if (zone === 0) {
      x = Math.random() * (worldLimit * 2) - worldLimit;
      z = Math.random() * (worldLimit - cityMaxZ - minSeparation) + (cityMaxZ + minSeparation);
    } else if (zone === 1) {
      x = Math.random() * (worldLimit * 2) - worldLimit;
      z = Math.random() * (worldLimit - minSeparation) - worldLimit;
    } else if (zone === 2) {
      x = Math.random() * (worldLimit - cityMaxX - minSeparation) + (cityMaxX + minSeparation);
      z = Math.random() * (worldLimit * 2) - worldLimit;
    } else {
      x = Math.random() * (worldLimit - minSeparation) - worldLimit;
      z = Math.random() * (worldLimit * 2) - worldLimit;
    }

    // No colocar flora en la carretera infinita
    if (x >= 24 && x <= 295 && z >= 10 && z <= 14) {
      continue;
    }

    const type = Math.random();

    if (type < 0.20) {
      // 20% arbustos verdes
      const bush = new Object3D(`bush-${i}`, [x, 0, z]);
      bush.arrays = bushCube.arrays;
      bush.bufferInfo = bushCube.bufferInfo;
      bush.vao = bushCube.vao;
      const scale = 0.3 + Math.random() * 0.5;
      bush.scale = { x: scale, y: scale * 0.6, z: scale };
      bush.shininess = 150.0;
      scene.addObject(bush);
    } else if (type < 0.35) {
      // 15% arbustos oscuros
      const darkBush = new Object3D(`darkbush-${i}`, [x, 0, z]);
      darkBush.arrays = darkBushCube.arrays;
      darkBush.bufferInfo = darkBushCube.bufferInfo;
      darkBush.vao = darkBushCube.vao;
      const scale = 0.25 + Math.random() * 0.45;
      darkBush.scale = { x: scale, y: scale * 0.7, z: scale };
      darkBush.shininess = 120.0;
      scene.addObject(darkBush);
    } else if (type < 0.45) {
      // 10% arbustos amarillentos
      const yellowBush = new Object3D(`yellowbush-${i}`, [x, 0, z]);
      yellowBush.arrays = yellowBushCube.arrays;
      yellowBush.bufferInfo = yellowBushCube.bufferInfo;
      yellowBush.vao = yellowBushCube.vao;
      const scale = 0.2 + Math.random() * 0.4;
      yellowBush.scale = { x: scale, y: scale * 0.5, z: scale };
      yellowBush.shininess = 100.0;
      scene.addObject(yellowBush);
    } else if (type < 0.60) {
      // 15% rocas
      const rock = new Object3D(`rock-${i}`, [x, 0, z]);
      rock.arrays = rockCube.arrays;
      rock.bufferInfo = rockCube.bufferInfo;
      rock.vao = rockCube.vao;
      const scale = 0.15 + Math.random() * 0.5;
      rock.scale = { x: scale, y: scale * 0.8, z: scale * 1.2 };
      rock.shininess = 80.0;
      rock.rotRad.y = Math.random() * Math.PI * 2;
      scene.addObject(rock);
    } else if (type < 0.85) {
      // 25% árboles
      const tree = new Object3D(`tree-wild-${i}`, [x, 0, z]);
      tree.arrays = treeObj.arrays;
      tree.bufferInfo = treeObj.bufferInfo;
      tree.vao = treeObj.vao;
      const scale = 0.4 + Math.random() * 1.1;
      tree.scale = { x: scale, y: scale, z: scale };
      tree.shininess = 250.0;
      tree.rotRad.y = Math.random() * Math.PI * 2;
      scene.addObject(tree);
    } else if (type < 0.90) {
      // 5% arbustos secos
      const deadBush = new Object3D(`deadbush-${i}`, [x, 0, z]);
      deadBush.arrays = deadBushCube.arrays;
      deadBush.bufferInfo = deadBushCube.bufferInfo;
      deadBush.vao = deadBushCube.vao;
      const scale = 0.2 + Math.random() * 0.3;
      deadBush.scale = { x: scale, y: scale * 0.4, z: scale };
      deadBush.shininess = 90.0;
      scene.addObject(deadBush);
    } else if (type < 0.95) {
      // 5% plantas pequeñas
      const smallPlant = new Object3D(`plant-${i}`, [x, 0, z]);
      smallPlant.arrays = smallPlantCube.arrays;
      smallPlant.bufferInfo = smallPlantCube.bufferInfo;
      smallPlant.vao = smallPlantCube.vao;
      const scale = 0.1 + Math.random() * 0.15;
      smallPlant.scale = { x: scale, y: scale * 1.5, z: scale };
      smallPlant.shininess = 130.0;
      scene.addObject(smallPlant);
    } else {
      // 5% matas de hierba
      const grassClump = new Object3D(`grass-${i}`, [x, 0, z]);
      grassClump.arrays = grassClumpCube.arrays;
      grassClump.bufferInfo = grassClumpCube.bufferInfo;
      grassClump.vao = grassClumpCube.vao;
      const scale = 0.08 + Math.random() * 0.12;
      grassClump.scale = { x: scale * 1.3, y: scale * 0.8, z: scale * 1.3 };
      grassClump.shininess = 140.0;
      scene.addObject(grassClump);
    }
  }
}

// Configura un coche nuevo con modelo aleatorio, color aleatorio y sus 4 ruedas
async function setupCar(car, gl, programInfo, car2023Data, car2024Data) {
  // Si ya está configurado no hacer nada
  if (car.isCar2024 !== undefined) {
    return;
  }

  // 50% de probabilidad de usar cada modelo
  const useCar2023 = Math.random() < 0.5;

  // Color aleatorio para la carrocería, valores entre 0.3 y 1.0 para que no sea muy oscuro
  const randomR = Math.random() * 0.7 + 0.3;
  const randomG = Math.random() * 0.7 + 0.3;
  const randomB = Math.random() * 0.7 + 0.3;

  clearMaterials();

  if (useCar2023) {
    // El modelo 2023 es más simple, tiene un solo material para todo
    const car2023Mtl = `newmtl CarMat
Ns 250.000000
Ka 1.000000 1.000000 1.000000
Kd ${randomR.toFixed(6)} ${randomG.toFixed(6)} ${randomB.toFixed(6)}
Ks 0.500000 0.500000 0.500000
Ke 0.000000 0.000000 0.000000
Ni 1.450000
d 1.000000
illum 2
`;
    loadMtl(car2023Mtl);
    car.prepareVAO(gl, programInfo, car2023Data);
    car.scale = { x: 0.9, y: 0.9, z: 0.9 };
    car.yOffset = 0.1;  // Elevar un poco el coche para que las ruedas toquen el suelo
    car.isCar2024 = false;
  } else {
    // El modelo 2024 tiene varios materiales: carrocería, ventanas, detalles y luces
    const car2024Mtl = `newmtl CarBodyMat
Ns 640.000000
Ka 0.700000 0.700000 0.700000
Kd ${randomR.toFixed(6)} ${randomG.toFixed(6)} ${randomB.toFixed(6)}
Ks 0.500000 0.500000 0.500000
Ke 0.000000 0.000000 0.000000
Ni 1.500000
d 1.000000
illum 3

newmtl CarWindowMat
Ns 1000.000000
Ka 0.800000 0.800000 0.800000
Kd 0.400000 0.600000 0.900000
Ks 0.500000 0.500000 0.500000
Ke 0.000000 0.000000 0.000000
Ni 1.500000
d 1.000000
illum 3

newmtl CarDetailsMat
Ns 640.000000
Ka 1.000000 1.000000 1.000000
Kd 0.200000 0.200000 0.200000
Ks 0.500000 0.500000 0.500000
Ke 0.000000 0.000000 0.000000
Ni 1.500000
d 1.000000
illum 3

newmtl CarLightsMat
Ns 250.000000
Ka 1.000000 1.000000 1.000000
Kd 0.900000 0.900000 0.200000
Ks 0.500000 0.500000 0.500000
Ke 0.000000 0.000000 0.000000
Ni 1.500000
d 1.000000
illum 2
`;
    loadMtl(car2024Mtl);
    car.prepareVAO(gl, programInfo, car2024Data);
    car.scale = { x: 0.48, y: 0.48, z: 0.48 };
    car.yOffset = 0.1;
    car.isCar2024 = true;
  }

    // La rotación inicial se ajustará dinámicamente en drawObject según la calle
    car.rotRad.y = 0;
    car.color = [1.0, 0.8, 0.0, 1.0];
    scene.addObject(car);

    // Agregar las 4 ruedas al coche
    const wheelTemplate = window.wheelTemplate;
    if (wheelTemplate) {
      car.wheels = [];
      car.wheelRotation = 0;

      // Cada modelo de coche tiene diferentes posiciones para las ruedas
      let wheelPositions;
      let wheelScale;
      let wheelRotAxis;

      if (car.isCar2024) {
        wheelPositions = [
          { x: 1.6, y: 0.2, z: 0.7 },    // delantera derecha
          { x: -1.6, y: 0.2, z: 0.7 },   // delantera izquierda
          { x: 1.6, y: 0.2, z: -0.7 },   // trasera derecha
          { x: -1.6, y: 0.2, z: -0.7 }   // trasera izquierda
        ];
        // La escala z es diferente a x para que se vea el giro (elipse, no círculo)
        wheelScale = { x: 0.3, y: 0.25, z: 0.33 };
        wheelRotAxis = 'x';
      } else {
        wheelPositions = [
          { x: 1.0, y: 0.2, z: 0.8 },
          { x: -1.0, y: 0.2, z: 0.8 },
          { x: 1.0, y: 0.2, z: -0.8 },
          { x: -1.0, y: 0.2, z: -0.8 }
        ];
        wheelScale = { x: 0.3, y: 0.25, z: 0.33 };
        wheelRotAxis = 'z';
      }

      // Crear cada rueda y pegarla al coche
      for (let i = 0; i < 4; i++) {
        const wheel = new Object3D(`wheel-${car.id}-${i}`, [0, 0, 0]);
        wheel.arrays = wheelTemplate.arrays;
        wheel.bufferInfo = wheelTemplate.bufferInfo;
        wheel.vao = wheelTemplate.vao;
        wheel.scale = wheelScale;
        wheel.relativePos = wheelPositions[i];
        wheel.wheelRotAxis = wheelRotAxis;

        // Acostar el cilindro para que quede horizontal
        if (wheelRotAxis === 'x') {
          wheel.rotRad.x = Math.PI / 2;
        } else {
          wheel.rotRad.z = Math.PI / 2;
        }
        wheel.isWheel = true;
        car.wheels.push(wheel);
        scene.addObject(wheel);
      }
    }
  }


// Dibuja cualquier objeto de la escena con su posición, rotación y escala
// También se encarga de dibujar las ruedas de los coches y cambiar el modelo del semáforo
function drawObject(gl, programInfo, object, viewProjectionMatrix, fract) {
  // Saltar objetos invisibles
  if (object.visible === false) return;

  // Las ruedas no se dibujan aquí, se dibujan cuando se dibuja el coche
  if (object.isWheel) return;


  // Estos objetos especiales brillan solos, no les afecta la iluminación normal
  const isSun = object.id === -999;
  const isLightning = object.id === 'lightning';
  const isLightTunnel = object.id === 'light-tunnel' || object.id === 'light-tunnel-outer';

  // Si el objeto usa texturas, usar el shader de texturas
  if (object.isTextured) {
    gl.useProgram(textureProgramInfo.program);

    const worldMatrix = M4.identity();
    const scaMat = M4.scale(object.scaArray);
    const rotXMat = M4.rotationX(object.rotRad.x);
    const rotYMat = M4.rotationY(object.rotRad.y);
    const rotZMat = M4.rotationZ(object.rotRad.z);
    const traMat = M4.translation(object.posArray);

    let transforms = M4.identity();
    transforms = M4.multiply(scaMat, transforms);
    transforms = M4.multiply(rotXMat, transforms);
    transforms = M4.multiply(rotYMat, transforms);
    transforms = M4.multiply(rotZMat, transforms);
    transforms = M4.multiply(traMat, transforms);

    const worldViewProjectionMatrix = M4.multiply(viewProjectionMatrix, transforms);

    twgl.setUniforms(textureProgramInfo, {
      u_worldViewProjection: worldViewProjectionMatrix,
      u_texture: luisMiguelTexture,
    });

    gl.bindVertexArray(object.vao);
    twgl.drawBufferInfo(gl, object.bufferInfo);
    gl.useProgram(programInfo.program);
    return;
  }

  // Preparar vectores de posición y escala
  let v3_tra = object.posArray;
  let v3_sca = object.scaArray;

  // Los coches necesitan tratamiento especial
  if (cars.includes(object)) {
    // Interpolar la posición entre el frame anterior y el actual para que se vea suave
    if (object.oldPosArray && fract < 1.0) {
      const oldX = object.oldPosArray[0];
      const oldY = object.oldPosArray[1];
      const oldZ = object.oldPosArray[2];
      const newX = object.posArray[0];
      const newY = object.posArray[1];
      const newZ = object.posArray[2];
      v3_tra = [
        oldX + (newX - oldX) * fract,
        oldY + (newY - oldY) * fract,
        oldZ + (newZ - oldZ) * fract
      ];
    }

    // Ver en qué calle está el coche y hacia dónde apunta esa calle
    const key = `${Math.round(object.position.x)},${Math.round(object.position.z)}`;
    const dir = roadDirectionMap.get(key);

    if (dir) {
      // El modelo 2024 viene orientado diferente, hay que compensar
      const baseRotation = object.isCar2024 ? -Math.PI / 2 : 0;

      // Girar el coche según la dirección de la calle
      switch (dir) {
        case 'Up':
          object.rotRad.y = 0 + baseRotation;
          break;
        case 'Down':
          object.rotRad.y = Math.PI + baseRotation;
          break;
        case 'Left':
          object.rotRad.y = -Math.PI / 2 + baseRotation;
          break;
        case 'Right':
          object.rotRad.y = Math.PI / 2 + baseRotation;
          break;
      }
    }

    // Subir un poco el coche para que las ruedas queden bien
    if (object.yOffset !== undefined) {
      v3_tra = [v3_tra[0], v3_tra[1] + object.yOffset, v3_tra[2]];
    }
  }

  // Crear matrices para cada transformación: escala, rotación en cada eje, y posición
  const scaMat = M4.scale(v3_sca);
  const rotXMat = M4.rotationX(object.rotRad.x);
  const rotYMat = M4.rotationY(object.rotRad.y);
  const rotZMat = M4.rotationZ(object.rotRad.z);
  const traMat = M4.translation(v3_tra);

  // Multiplicar todas las matrices en orden: escala, rotaciones, traslación
  let transforms = M4.identity();
  transforms = M4.multiply(scaMat, transforms);
  transforms = M4.multiply(rotXMat, transforms);
  transforms = M4.multiply(rotYMat, transforms);
  transforms = M4.multiply(rotZMat, transforms);
  transforms = M4.multiply(traMat, transforms);
  object.matrix = transforms;

  // Matrices que necesita el shader para calcular la iluminación
  const worldMatrix = transforms;
  const worldViewProjectionMatrix = M4.multiply(viewProjectionMatrix, transforms);
  const worldInverseTranspose = M4.transpose(M4.inverse(worldMatrix));

  const sun = scene.lights[0];

  // Objetos que brillan solos (sol, rayos) no reciben iluminación normal
  const ambientLight = (isSun || isLightning || isLightTunnel) ? [1.0, 1.0, 1.0, 1.0] : sun.ambient;
  const diffuseLight = (isSun || isLightning || isLightTunnel) ? [0.0, 0.0, 0.0, 1.0] : sun.diffuse;
  const specularLight = (isSun || isLightning || isLightTunnel) ? [0.0, 0.0, 0.0, 1.0] : sun.specular;

  // Los semáforos emiten luz verde o roja que afecta a los objetos cercanos
  const allLightPositions = [];
  const allLightColors = [];

  for (const light of trafficLights) {
    allLightPositions.push(light.position.x, light.position.y + 4.5, light.position.z);
    if (light.state) {
      allLightColors.push(0.2, 1.0, 0.4, 1.0);  // verde
    } else {
      allLightColors.push(1.0, 0.0, 0.0, 1.0);  // rojo
    }
  }

  // Agregar postes de luz - cada uno emite su propia luz
  // LIMITE: el shader soporta 150 luces en total
  const MAX_LIGHTS = 150;
  const availableSlots = MAX_LIGHTS - trafficLights.length;

  for (let i = 0; i < Math.min(streetLightPositions.length, availableSlots); i++) {
    const streetLight = streetLightPositions[i];
    allLightPositions.push(streetLight.x, streetLight.y, streetLight.z);
    allLightColors.push(1.0, 0.9, 0.7, 1.0);  // luz cálida visible
  }

  const totalLights = Math.min(trafficLights.length + streetLightPositions.length, MAX_LIGHTS);

  // Mandar todos los datos de iluminación al shader
  let objectUniforms = {
    u_lightWorldPosition: sun.posArray,
    u_viewWorldPosition: scene.camera.posArray,
    u_ambientLight: ambientLight,
    u_diffuseLight: diffuseLight,
    u_specularLight: specularLight,
    u_sunIntensity: sunIntensity,
    u_world: worldMatrix,
    u_worldInverseTransform: worldInverseTranspose,
    u_worldViewProjection: worldViewProjectionMatrix,
    u_specularColor: [1.0, 1.0, 1.0, 1.0],
    u_shininess: object.shininess,
    u_numTrafficLights: totalLights,
    u_numTrafficLightsOnly: trafficLights.length,
    u_trafficLightPositions: allLightPositions,
    u_trafficLightColors: allLightColors,
    u_trafficLightIntensity: trafficLightIntensity,
    u_streetLightIntensity: streetLightIntensity
  }
  twgl.setUniforms(programInfo, objectUniforms);

  gl.bindVertexArray(object.vao);
  twgl.drawBufferInfo(gl, object.bufferInfo);

  // Dibujar las ruedas del coche
  if (cars.includes(object) && object.wheels) {
    // Calcular cuánto se movió el coche para animar las ruedas
    if (object.oldPosArray) {
      const dx = object.posArray[0] - object.oldPosArray[0];
      const dz = object.posArray[2] - object.oldPosArray[2];
      const distance = Math.sqrt(dx * dx + dz * dz);
      object.wheelRotation += distance * 0.5 * fract;
    }

    for (const wheel of object.wheels) {
      // Calcular dónde va la rueda en el mundo
      // Hay que rotar la posición relativa según hacia dónde mira el coche
      const cosY = Math.cos(object.rotRad.y);
      const sinY = Math.sin(object.rotRad.y);
      const relX = wheel.relativePos.x;
      const relZ = wheel.relativePos.z;
      const rotatedX = relX * cosY - relZ * sinY;
      const rotatedZ = relX * sinY + relZ * cosY;

      const wheelPos = [
        v3_tra[0] + rotatedX,
        v3_tra[1] + wheel.relativePos.y,
        v3_tra[2] + rotatedZ
      ];

      // Armar la matriz de transformación de la rueda
      const wheelScaMat = M4.scale(wheel.scaArray);
      const wheelTraMat = M4.translation(wheelPos);
      const wheelRotYMat = M4.rotationY(object.rotRad.y);

      let wheelTransforms = M4.identity();
      wheelTransforms = M4.multiply(wheelScaMat, wheelTransforms);

      // Aplicar animación y orientación según el modelo
      if (wheel.wheelRotAxis === 'x') {
        const wheelAnimMat = M4.rotationY(object.wheelRotation);
        const wheelOrientMat = M4.rotationX(Math.PI / 2);
        wheelTransforms = M4.multiply(wheelAnimMat, wheelTransforms);
        wheelTransforms = M4.multiply(wheelOrientMat, wheelTransforms);
      } else {
        const wheelAnimMat = M4.rotationY(object.wheelRotation);
        const wheelOrientMat = M4.rotationZ(Math.PI / 2);
        wheelTransforms = M4.multiply(wheelAnimMat, wheelTransforms);
        wheelTransforms = M4.multiply(wheelOrientMat, wheelTransforms);
      }

      wheelTransforms = M4.multiply(wheelRotYMat, wheelTransforms);
      wheelTransforms = M4.multiply(wheelTraMat, wheelTransforms);

      const wheelWorldMatrix = wheelTransforms;
      const wheelWorldViewProjection = M4.multiply(viewProjectionMatrix, wheelTransforms);
      const wheelWorldInverseTranspose = M4.transpose(M4.inverse(wheelWorldMatrix));

      let wheelUniforms = {
        u_lightWorldPosition: sun.posArray,
        u_viewWorldPosition: scene.camera.posArray,
        u_ambientLight: sun.ambient,
        u_diffuseLight: sun.diffuse,
        u_specularLight: sun.specular,
        u_sunIntensity: sunIntensity,
        u_world: wheelWorldMatrix,
        u_worldInverseTransform: wheelWorldInverseTranspose,
        u_worldViewProjection: wheelWorldViewProjection,
        u_specularColor: [1.0, 1.0, 1.0, 1.0],
        u_shininess: 50.0,
        u_numTrafficLights: totalLights,
        u_numTrafficLightsOnly: trafficLights.length,
        u_trafficLightPositions: allLightPositions,
        u_trafficLightColors: allLightColors,
        u_trafficLightIntensity: trafficLightIntensity,
        u_streetLightIntensity: streetLightIntensity
      };
      twgl.setUniforms(programInfo, wheelUniforms);

      gl.bindVertexArray(wheel.vao);
      twgl.drawBufferInfo(gl, wheel.bufferInfo);
    }
  }
}

// Se llama en cada frame para dibujar toda la escena
async function drawScene() {
  // Calcular cuánto tiempo pasó desde el último frame
  let now = Date.now();
  if (then === 0) then = now;
  let deltaTime = now - then;
  elapsed += deltaTime;
  let fract = Math.min(1.0, elapsed / duration);  // fract va de 0 a 1 para interpolar movimientos
  then = now;

  // Limpiar pantalla con negro
  gl.clearColor(0.0, 0.0, 0.0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.CULL_FACE);
  gl.enable(gl.DEPTH_TEST);

  // Mover las gotas de lluvia hacia abajo
  if (isRaining) {
    for (let drop of rainDrops) {
      drop.visible = true;
      drop.position.y -= drop.velocity;
      // Cuando llega al suelo, reiniciar arriba en posición aleatoria
      if (drop.position.y < 0) {
        drop.position.y = Math.random() * 20 + 50;
        drop.position.x = Math.random() * 600 - 300;
        drop.position.z = Math.random() * 600 - 300;
      }
    }
  } else {
    for (let drop of rainDrops) {
      drop.visible = false;
    }
  }

  // Sistema de rayos que aparecen cada cierto tiempo
  lightningTimer += deltaTime;
  if (lightning && lightningTimer >= nextLightningTime && lightningDuration <= 0) {
    lightning.position.x = Math.random() * 108;
    lightning.position.z = Math.random() * 105;
    lightning.visible = true;
    lightningDuration = 200;
    nextLightningTime = lightningTimer + lightningInterval;
  }
  if (lightning && lightningDuration > 0) {
    lightningDuration -= deltaTime;
    if (lightningDuration <= 0) {
      lightning.visible = false;
    }
  }

  scene.camera.checkKeys();
  const viewProjectionMatrix = setupViewProjection(gl);

  // Actualizar colores de las luces del semáforo según el estado actual
  const templates = window.trafficLightTemplates;
  if (templates) {
    for (const light of trafficLights) {
      if (light.redLightObj && light.greenLightObj) {
        if (light.state) {
          // Verde encendido, rojo apagado
          light.redLightObj.arrays = templates.redOff.arrays;
          light.redLightObj.bufferInfo = templates.redOff.bufferInfo;
          light.redLightObj.vao = templates.redOff.vao;
          light.greenLightObj.arrays = templates.greenOn.arrays;
          light.greenLightObj.bufferInfo = templates.greenOn.bufferInfo;
          light.greenLightObj.vao = templates.greenOn.vao;
        } else {
          // Rojo encendido, verde apagado
          light.redLightObj.arrays = templates.redOn.arrays;
          light.redLightObj.bufferInfo = templates.redOn.bufferInfo;
          light.redLightObj.vao = templates.redOn.vao;
          light.greenLightObj.arrays = templates.greenOff.arrays;
          light.greenLightObj.bufferInfo = templates.greenOff.bufferInfo;
          light.greenLightObj.vao = templates.greenOff.vao;
        }
      }
    }
  }

  // Primero dibujar objetos sólidos (todo menos la lluvia)
  gl.disable(gl.BLEND);
  gl.useProgram(colorProgramInfo.program);
  for (let object of scene.objects) {
    const isRainDrop = object.id && object.id.toString().startsWith('rain-');
    if (!isRainDrop) {
      drawObject(gl, colorProgramInfo, object, viewProjectionMatrix, fract);
    }
  }

  // Después dibujar la lluvia con transparencia
  if (isRaining) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (let object of scene.objects) {
      const isRainDrop = object.id && object.id.toString().startsWith('rain-');
      if (isRainDrop) {
        drawObject(gl, colorProgramInfo, object, viewProjectionMatrix, fract);
      }
    }
    gl.disable(gl.BLEND);
  }

  // Cada segundo pedir al servidor la nueva posición de los coches
  if (elapsed >= duration) {
    elapsed = 0;
    await update();

    // Actualizar métricas
    const metricsData = await getMetrics();
    if (metricsData) {
      metrics.totalCarsSpawned = metricsData.totalCarsSpawned;
      metrics.carsReachedDestination = metricsData.carsReachedDestination;
      metrics.currentCarsInSimulation = metricsData.currentCarsInSimulation;
      metrics.currentStep = metricsData.currentStep;
    }
  }

  requestAnimationFrame(drawScene);
}

// Calcula la matriz de vista y proyección de la cámara
function setupViewProjection(gl) {
  const fov = 60 * Math.PI / 180;
  const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
  const projectionMatrix = M4.perspective(fov, aspect, 1, 500);

  const cameraPosition = scene.camera.posArray;
  const target = scene.camera.targetArray;
  const up = [0, 1, 0];
  const cameraMatrix = M4.lookAt(cameraPosition, target, up);
  const viewMatrix = M4.inverse(cameraMatrix);

  return M4.multiply(projectionMatrix, viewMatrix);
}

// Objeto para almacenar las métricas
const metrics = {
  totalCarsSpawned: 0,
  carsReachedDestination: 0,
  currentCarsInSimulation: 0,
  currentStep: 0
};

// Crea los controles de la interfaz con lil-gui
function setupUI() {
  const gui = new GUI();

  // Métricas de la simulación
  const metricsFolder = gui.addFolder('Simulation Metrics');
  metricsFolder.add(metrics, 'totalCarsSpawned').name('Total Spawned').listen().disable();
  metricsFolder.add(metrics, 'carsReachedDestination').name('Reached Destination').listen().disable();
  metricsFolder.add(metrics, 'currentCarsInSimulation').name('Current Cars').listen().disable();
  metricsFolder.add(metrics, 'currentStep').name('Current Step').listen().disable();
  metricsFolder.open();

  // Cada cuántos pasos aparece un coche nuevo
  const spawnControls = { spawnInterval: initData.SpawnInterval };
  const spawnFolder = gui.addFolder('Car Spawning');
  spawnFolder.add(spawnControls, 'spawnInterval', 1, 50, 1).name('Spawn Interval (steps)').onChange(async (value) => {
    spawnControls.spawnInterval = value;
    initData.SpawnInterval = value;
    await setSpawnInterval(value);
  });
  spawnFolder.open();

  // Qué tan fuerte brilla cada tipo de luz
  const intensityFolder = gui.addFolder('Light Intensity');
  intensityFolder.add({ sunIntensity }, 'sunIntensity', 0, 3).name('Moon Intensity').onChange((value) => {
    sunIntensity = value;
  });
  intensityFolder.add({ trafficLightIntensity }, 'trafficLightIntensity', 0, 10).name('Traffic Lights Intensity').onChange((value) => {
    trafficLightIntensity = value;
  });
  intensityFolder.add({ streetLightIntensity }, 'streetLightIntensity', 0, 2).name('Street Lights Intensity').onChange((value) => {
    streetLightIntensity = value;
  });
  intensityFolder.open();

  // Controles del clima
  const weatherFolder = gui.addFolder('Weather');
  weatherFolder.add({ rain: isRaining }, 'rain').name('Rain').onChange((value) => {
    isRaining = value;
  });
  const lightningControls = {
    triggerLightning: () => {
      lightning.position.x = Math.random() * 108;
      lightning.position.z = Math.random() * 105;
      lightning.visible = true;
      lightningDuration = 200;
    }
  };
  weatherFolder.add(lightningControls, 'triggerLightning').name('Lightning Strike');
  weatherFolder.open();

  // Zoom de cámara
  const cameraFolder = gui.addFolder('Camera');
  const cameraControls = {
    zoomIn: () => { scene.camera.zoom(-2); },
    zoomOut: () => { scene.camera.zoom(2); }
  };
  cameraFolder.add(cameraControls, 'zoomIn').name('Zoom In (+)');
  cameraFolder.add(cameraControls, 'zoomOut').name('Zoom Out (-)');
  cameraFolder.open();
}

main();
