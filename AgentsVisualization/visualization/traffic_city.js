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
  setSpawnInterval, initData, setOnNewCarsCallback
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
let sunIntensity = 1.0;
let trafficLightIntensity = 0.15;
let streetLightIntensity = 0.5;

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
    150,            // qué tan lejos está (escalado 3x)
    4.7,            // rotación horizontal
    1.2,            // rotación vertical (más arriba para ver todo)
    [54, 0, 52.5],  // centro del mapa 36x35 escalado 3x
    [0, 0, 0]);
  camera.panOffset = [0, 50, 0];
  scene.setCamera(camera);
  scene.camera.setupControls();

  // Crear la luna para iluminar la ciudad
  const sun = new Light3D(
    0,
    [-30, 90, -30],                         // posición de la luna en una esquina (3x más lejos)
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
  // DEBUG: ROJO para visualizar las carreteras
  roadCube.arrays = cubeSingleColor(1, [1.0, 0.0, 0.0, 1.0]);
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
  const debugObstacleCube = new Object3D(-115);
  debugObstacleCube.arrays = cubeSingleColor(1, [1.0, 1.0, 0.0, 1.0]); // Amarillo brillante
  debugObstacleCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, debugObstacleCube.arrays);
  debugObstacleCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, debugObstacleCube.bufferInfo);

  // Cilindro para ruedas - negro, más segmentos para verse mejor
  const wheelCylinder = new Object3D(-116);
  wheelCylinder.arrays = cylinder(24, [0.15, 0.15, 0.15, 1.0]); // Gris oscuro/negro
  wheelCylinder.bufferInfo = twgl.createBufferInfoFromArrays(gl, wheelCylinder.arrays);
  wheelCylinder.vao = twgl.createVAOFromBufferInfo(gl, programInfo, wheelCylinder.bufferInfo);
  // Guardar globalmente para usar en setupCar
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

  // Cargar semáforo con luz verde
  clearMaterials();
  const stoplightGreenMtl = `newmtl StopLightMat
Ns 250.000000
Ka 1.000000 1.000000 1.000000
Kd 0.030365 0.179125 0.020979
Ks 0.500000 0.500000 0.500000
Ke 0.000000 0.000000 0.000000
Ni 1.450000
d 1.000000
illum 2

newmtl GreenLightMat
Ns 250.000000
Ka 5.000000 5.000000 5.000000
Kd 0.200000 1.000000 0.400000
Ks 0.800000 0.800000 0.800000
Ke 0.000000 0.000000 0.000000
Ni 1.500000
d 1.000000
illum 2

newmtl AmberLightMat
Ns 250.000000
Ka 1.000000 1.000000 1.000000
Kd 0.100000 0.100000 0.050000
Ks 0.500000 0.500000 0.500000
Ke 0.000000 0.000000 0.000000
Ni 1.500000
d 1.000000
illum 2

newmtl RedLightMat
Ns 250.000000
Ka 1.000000 1.000000 1.000000
Kd 0.100000 0.000000 0.000000
Ks 0.500000 0.500000 0.500000
Ke 0.000000 0.000000 0.000000
Ni 1.500000
d 1.000000
illum 2
`;
  loadMtl(stoplightGreenMtl);
  const stoplightGreenObj = new Object3D(-200);
  const stoplightData = await fetch('/assets/models/stoplight_1.obj').then(r => r.text());
  stoplightGreenObj.prepareVAO(gl, programInfo, stoplightData);

  // Cargar semáforo con luz roja
  clearMaterials();
  const stoplightRedMtl = `newmtl StopLightMat
Ns 250.000000
Ka 1.000000 1.000000 1.000000
Kd 0.030365 0.179125 0.020979
Ks 0.500000 0.500000 0.500000
Ke 0.000000 0.000000 0.000000
Ni 1.450000
d 1.000000
illum 2

newmtl GreenLightMat
Ns 250.000000
Ka 1.000000 1.000000 1.000000
Kd 0.000000 0.100000 0.000000
Ks 0.500000 0.500000 0.500000
Ke 0.000000 0.000000 0.000000
Ni 1.500000
d 1.000000
illum 2

newmtl AmberLightMat
Ns 250.000000
Ka 1.000000 1.000000 1.000000
Kd 0.100000 0.100000 0.050000
Ks 0.500000 0.500000 0.500000
Ke 0.000000 0.000000 0.000000
Ni 1.500000
d 1.000000
illum 2

newmtl RedLightMat
Ns 250.000000
Ka 5.000000 5.000000 5.000000
Kd 1.000000 0.000000 0.000000
Ks 0.800000 0.800000 0.800000
Ke 0.000000 0.000000 0.000000
Ni 1.500000
d 1.000000
illum 2
`;
  loadMtl(stoplightRedMtl);
  const stoplightRedObj = new Object3D(-201);
  stoplightRedObj.prepareVAO(gl, programInfo, stoplightData);

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

  // Poste de luz deshabilitado para mejorar rendimiento
  // clearMaterials();
  // const streetlightMtlData = await fetch('/assets/models/streetlight.mtl').then(r => r.text());
  // loadMtl(streetlightMtlData);
  // const streetlightObj = new Object3D(-210);
  // const streetlightData = await fetch('/assets/models/streetlight.obj').then(r => r.text());
  // streetlightObj.prepareVAO(gl, programInfo, streetlightData);

  // Configurar las calles (ROJO para debug) - ESCALADO 3x
  for (const road of roads) {
    road.arrays = roadCube.arrays;
    road.bufferInfo = roadCube.bufferInfo;
    road.vao = roadCube.vao;
    // Cubo base es 2x2, scale 1.5 = tamaño 3x3 para llenar celda escalada
    road.scale = { x: 1.5, y: 0.15, z: 1.5 };
    road.color = [1.0, 0.0, 0.0, 1.0];

    // Guardar dirección ANTES de escalar para el mapa de direcciones
    const key = `${Math.round(road.position.x * 3 + 1.5)},${Math.round(road.position.z * 3 + 1.5)}`;
    roadDirectionMap.set(key, road.direction);

    // Centrar en la celda escalada (3x + 1.5)
    road.position.x = road.position.x * 3 + 1.5;
    road.position.z = road.position.z * 3 + 1.5;

    scene.addObject(road);
  }

  // Poner cubos amarillos en CADA obstáculo - ESCALADO 3x
  for (let i = 0; i < obstacles.length; i++) {
    const obstacle = obstacles[i];

    // Centrar en la celda escalada (3x + 1.5)
    const scaledX = obstacle.position.x * 3 + 1.5;
    const scaledZ = obstacle.position.z * 3 + 1.5;

    const debugCube = new Object3D(`obstacle-${i}`, [scaledX, 1.5, scaledZ]);
    debugCube.arrays = debugObstacleCube.arrays;
    debugCube.bufferInfo = debugObstacleCube.bufferInfo;
    debugCube.vao = debugObstacleCube.vao;
    // Cubo base es 2x2, scale 1.5 = tamaño 3x3 para llenar celda escalada
    debugCube.scale = { x: 1.5, y: 1.5, z: 1.5 };

    scene.addObject(debugCube);
  }

  // Configurar los semáforos
  for (const light of trafficLights) {
    // Asignar el modelo según el estado inicial
    if (light.state) {
      light.arrays = stoplightGreenObj.arrays;
      light.bufferInfo = stoplightGreenObj.bufferInfo;
      light.vao = stoplightGreenObj.vao;
    } else {
      light.arrays = stoplightRedObj.arrays;
      light.bufferInfo = stoplightRedObj.bufferInfo;
      light.vao = stoplightRedObj.vao;
    }
    light.scale = { x: 3.0, y: 3.0, z: 3.0 };
    // Centrar en la celda escalada
    light.position.x = light.position.x * 3 + 1.5;
    light.position.z = light.position.z * 3 + 1.5;
    light.position.y = 0;
    // Guardar referencias para cambiar después
    light.greenModel = { arrays: stoplightGreenObj.arrays, bufferInfo: stoplightGreenObj.bufferInfo, vao: stoplightGreenObj.vao };
    light.redModel = { arrays: stoplightRedObj.arrays, bufferInfo: stoplightRedObj.bufferInfo, vao: stoplightRedObj.vao };
    scene.addObject(light);
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

  // Crear carretera infinita que se extiende hacia el horizonte
  const highway = new Object3D('highway', [162, -0.08, 12]);
  highway.arrays = roadCube.arrays;
  highway.bufferInfo = roadCube.bufferInfo;
  highway.vao = roadCube.vao;
  highway.scale = { x: 135, y: 0.05, z: 2 };
  highway.shininess = 100.0;
  scene.addObject(highway);

  // Crear líneas amarillas en el centro de la carretera (optimizado)
  for (let i = 0; i < 54; i++) {
    const line = new Object3D(`highway-line-${i}`, [26 + (i * 5), -0.04, 12]);
    line.arrays = yellowLineCube.arrays;
    line.bufferInfo = yellowLineCube.bufferInfo;
    line.vao = yellowLineCube.vao;
    line.scale = { x: 1.2, y: 0.05, z: 0.15 };
    line.shininess = 80.0;
    scene.addObject(line);
  }

  // Función para crear semicírculos (usado para el túnel de luz)
  function createSemicircle(radius, segments, color) {
    const positions = [0, 0, 0];
    const normals = [];
    const colors = [];
    const indices = [];

    for (let i = 0; i <= segments; i++) {
      const angle = Math.PI * i / segments;
      const x = 0;
      const y = radius * Math.sin(angle);
      const z = radius * Math.cos(angle) - radius;
      positions.push(x, y, z);
    }

    for (let i = 0; i <= segments + 1; i++) {
      normals.push(-1, 0, 0);
    }

    for (let i = 0; i <= segments + 1; i++) {
      colors.push(...color);
    }

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

  // Crear túnel de luz decorativo al final de la carretera (optimizado - 2 capas)
  const lightTunnel = new Object3D('light-tunnel', [295, 0, 22]);
  lightTunnel.arrays = createSemicircle(6, 24, [1.0, 1.0, 1.0, 1.0]);
  lightTunnel.bufferInfo = twgl.createBufferInfoFromArrays(gl, lightTunnel.arrays);
  lightTunnel.vao = twgl.createVAOFromBufferInfo(gl, programInfo, lightTunnel.bufferInfo);
  lightTunnel.shininess = 1000.0;
  scene.addObject(lightTunnel);

  const lightTunnelOuter = new Object3D('light-tunnel-outer', [295, 0, 22]);
  lightTunnelOuter.arrays = createSemicircle(10, 24, [1.0, 0.9, 0.7, 0.6]);
  lightTunnelOuter.bufferInfo = twgl.createBufferInfoFromArrays(gl, lightTunnelOuter.arrays);
  lightTunnelOuter.vao = twgl.createVAOFromBufferInfo(gl, programInfo, lightTunnelOuter.bufferInfo);
  lightTunnelOuter.shininess = 1000.0;
  scene.addObject(lightTunnelOuter);

  // Crear 400 gotas de lluvia (optimizado para rendimiento)
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
  lightning = new Object3D('lightning', [
    Math.random() * 30,
    30,
    Math.random() * 30
  ]);
  lightning.arrays = lightningCube.arrays;
  lightning.bufferInfo = lightningCube.bufferInfo;
  lightning.vao = lightningCube.vao;
  lightning.scale = { x: 0.3, y: 60, z: 0.3 };
  lightning.visible = false;
  scene.addObject(lightning);

  // Generar 800 objetos de flora alrededor del mapa (optimizado para rendimiento)
  const cityMinX = -1;
  const cityMaxX = 25;
  const cityMinZ = -1;
  const cityMaxZ = 25;
  const minSeparation = 4;
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

// Función helper para configurar un carro (puede ser llamada después de la inicialización)
async function setupCar(car, gl, programInfo, car2023Data, car2024Data) {
  // Solo configurar si el carro no está ya configurado
  if (car.isCar2024 !== undefined) {
    return;
  }

  const useCar2023 = Math.random() < 0.5;

  // Generar un color random para el cuerpo del coche
  const randomR = Math.random() * 0.7 + 0.3; // 0.3 a 1.0
  const randomG = Math.random() * 0.7 + 0.3;
  const randomB = Math.random() * 0.7 + 0.3;

  // Limpiar materiales previos
  clearMaterials();

  if (useCar2023) {
    // Car 2023 solo tiene un material, así que todo el coche será del color random
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
    car.scale = { x: 0.9, y: 0.9, z: 0.9 };  // Escala para igualar visualmente al car 2024
    car.yOffset = 0.1;
    car.isCar2024 = false;
  } else {
    // Car 2024 tiene materiales separados: cuerpo random, ventanas azul claro
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

    // Crear 4 ruedas para el coche
    const wheelTemplate = window.wheelTemplate;
    if (wheelTemplate) {
      car.wheels = [];
      car.wheelRotation = 0; // Rotación de las ruedas (animación)

      // Posiciones relativas de las ruedas según el modelo (escaladas del debug)
      // Ruedas a nivel del suelo (y=0), coche elevado con yOffset
      let wheelPositions;
      let wheelScale;
      let wheelRotAxis; // 'x' o 'z' para orientar el cilindro horizontal

      if (car.isCar2024) {
        // Car 2024 - NO TOCAR
        wheelPositions = [
          { x: 1.6, y: 0.2, z: 0.7 },
          { x: -1.6, y: 0.2, z: 0.7 },
          { x: 1.6, y: 0.2, z: -0.7 },
          { x: -1.6, y: 0.2, z: -0.7 }
        ];
        wheelScale = { x: 0.3, y: 0.25, z: 0.33 };
        wheelRotAxis = 'x';
      } else {
        // Car 2023
        wheelPositions = [
          { x: 1.0, y: 0.2, z: 0.8 },
          { x: -1.0, y: 0.2, z: 0.8 },
          { x: 1.0, y: 0.2, z: -0.8 },
          { x: -1.0, y: 0.2, z: -0.8 }
        ];
        wheelScale = { x: 0.3, y: 0.25, z: 0.33 };
        wheelRotAxis = 'z';
      }

      for (let i = 0; i < 4; i++) {
        const wheel = new Object3D(`wheel-${car.id}-${i}`, [0, 0, 0]);
        wheel.arrays = wheelTemplate.arrays;
        wheel.bufferInfo = wheelTemplate.bufferInfo;
        wheel.vao = wheelTemplate.vao;
        wheel.scale = wheelScale;
        wheel.relativePos = wheelPositions[i]; // Posición relativa al coche
        wheel.wheelRotAxis = wheelRotAxis; // Guardar eje de rotación
        // Orientar cilindro horizontal
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


// Función para dibujar un objeto con todas sus transformaciones
function drawObject(gl, programInfo, object, viewProjectionMatrix, fract) {
  // No dibujar gotas de lluvia si no están visibles
  if (object.visible === false) return;

  // Las ruedas se dibujan junto con su coche, no por separado
  if (object.isWheel) return;

  // Actualizar modelo del semáforo según su estado
  if (trafficLights.includes(object)) {
    if (object.state) {
      object.arrays = object.greenModel.arrays;
      object.bufferInfo = object.greenModel.bufferInfo;
      object.vao = object.greenModel.vao;
    } else {
      object.arrays = object.redModel.arrays;
      object.bufferInfo = object.redModel.bufferInfo;
      object.vao = object.redModel.vao;
    }
  }

  // Marcar si es el sol, el rayo o el túnel de luz para aplicar iluminación especial
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

  // Si es un coche, alinéalo con la dirección de la calle bajo él
  if (cars.includes(object)) {
    // INTERPOLACIÓN SUAVE: Mezclar entre posición anterior y actual
    if (object.oldPosArray && fract < 1.0) {
      const oldX = object.oldPosArray[0];
      const oldY = object.oldPosArray[1];
      const oldZ = object.oldPosArray[2];

      const newX = object.posArray[0];
      const newY = object.posArray[1];
      const newZ = object.posArray[2];

      // Interpolar linealmente entre oldPos y newPos
      v3_tra = [
        oldX + (newX - oldX) * fract,
        oldY + (newY - oldY) * fract,
        oldZ + (newZ - oldZ) * fract
      ];
    }

    const key = `${Math.round(object.position.x)},${Math.round(object.position.z)}`;
    const dir = roadDirectionMap.get(key);

    if (dir) {
      // El car-2024 tiene una orientación diferente en su modelo 3D
      // Necesita una rotación base de -90 grados para alinearse correctamente
      const baseRotation = object.isCar2024 ? -Math.PI / 2 : 0;

      // Mapear la dirección lógica a un ángulo de rotación en Y
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

    // Aplicar offset en Y para los coches (para que no floten)
    if (object.yOffset !== undefined) {
      v3_tra = [v3_tra[0], v3_tra[1] + object.yOffset, v3_tra[2]];
    }
  }

  // Crear las matrices de transformación individuales
  const scaMat = M4.scale(v3_sca);
  const rotXMat = M4.rotationX(object.rotRad.x);
  const rotYMat = M4.rotationY(object.rotRad.y);
  const rotZMat = M4.rotationZ(object.rotRad.z);
  const traMat = M4.translation(v3_tra);

  // Combinar todas las transformaciones en una sola matriz
  let transforms = M4.identity();
  transforms = M4.multiply(scaMat, transforms);
  transforms = M4.multiply(rotXMat, transforms);
  transforms = M4.multiply(rotYMat, transforms);
  transforms = M4.multiply(rotZMat, transforms);
  transforms = M4.multiply(traMat, transforms);

  object.matrix = transforms;

  // Calcular matrices para la iluminación
  const worldMatrix = transforms;
  const worldViewProjectionMatrix = M4.multiply(viewProjectionMatrix, transforms);
  const worldInverseTranspose = M4.transpose(M4.inverse(worldMatrix));

  // Obtener el sol
  const sun = scene.lights[0];

  // Si es el sol, el rayo o el túnel de luz, usar iluminación completa para que brille por sí mismo
  const ambientLight = (isSun || isLightning || isLightTunnel) ? [1.0, 1.0, 1.0, 1.0] : sun.ambient;
  const diffuseLight = (isSun || isLightning || isLightTunnel) ? [0.0, 0.0, 0.0, 1.0] : sun.diffuse;
  const specularLight = (isSun || isLightning || isLightTunnel) ? [0.0, 0.0, 0.0, 1.0] : sun.specular;

  // Preparar arrays de posiciones y colores de semáforos Y postes de luz
  const allLightPositions = [];
  const allLightColors = [];

  // Agregar semáforos
  for (const light of trafficLights) {
    // Posición del semáforo elevada para simular la luz desde arriba
    allLightPositions.push(light.position.x, light.position.y + 4.5, light.position.z);

    // Color según el estado del semáforo
    if (light.state) {
      // Verde brillante
      allLightColors.push(0.2, 1.0, 0.4, 1.0);
    } else {
      // Rojo brillante
      allLightColors.push(1.0, 0.0, 0.0, 1.0);
    }
  }

  // (Postes de luz eliminados para mejorar rendimiento)

  const totalLights = trafficLights.length;

  // Pasar toda la info de iluminación a los shaders
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

  // Si es un coche con ruedas, dibujarlas
  if (cars.includes(object) && object.wheels) {
    // Animar rotación de ruedas basado en movimiento
    if (object.oldPosArray) {
      const dx = object.posArray[0] - object.oldPosArray[0];
      const dz = object.posArray[2] - object.oldPosArray[2];
      const distance = Math.sqrt(dx * dx + dz * dz);
      // Rotar ruedas proporcional a la distancia recorrida
      object.wheelRotation += distance * 0.5 * fract;
    }

    // Dibujar cada rueda
    for (const wheel of object.wheels) {
      // Calcular posición de la rueda en coordenadas del mundo
      const cosY = Math.cos(object.rotRad.y);
      const sinY = Math.sin(object.rotRad.y);
      const relX = wheel.relativePos.x;
      const relZ = wheel.relativePos.z;

      // Rotar la posición relativa según la orientación del coche
      const rotatedX = relX * cosY - relZ * sinY;
      const rotatedZ = relX * sinY + relZ * cosY;

      // Posición final de la rueda
      const wheelPos = [
        v3_tra[0] + rotatedX,
        v3_tra[1] + wheel.relativePos.y,
        v3_tra[2] + rotatedZ
      ];

      // Crear transformaciones para la rueda
      // Orden: Scale -> Orientar cilindro -> Animar giro -> Seguir coche -> Trasladar
      const wheelScaMat = M4.scale(wheel.scaArray);
      const wheelTraMat = M4.translation(wheelPos);
      const wheelRotYMat = M4.rotationY(object.rotRad.y); // Seguir dirección del coche

      let wheelTransforms = M4.identity();
      wheelTransforms = M4.multiply(wheelScaMat, wheelTransforms);

      if (wheel.wheelRotAxis === 'x') {
        // Car 2024 - NO TOCAR
        const wheelAnimMat = M4.rotationY(object.wheelRotation);
        const wheelOrientMat = M4.rotationX(Math.PI / 2);
        wheelTransforms = M4.multiply(wheelAnimMat, wheelTransforms);
        wheelTransforms = M4.multiply(wheelOrientMat, wheelTransforms);
      } else {
        // Car 2023 - misma rueda, misma animación Y, solo diferente orientación Z
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

      // Uniforms para la rueda
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

// Loop principal que dibuja todo en cada frame
async function drawScene() {
  // Calcular tiempo transcurrido
  let now = Date.now();

  // Inicializar 'then' en el primer frame
  if (then === 0) {
    then = now;
  }

  let deltaTime = now - then;
  elapsed += deltaTime;
  let fract = Math.min(1.0, elapsed / duration);
  then = now;

  // Limpiar el canvas
  gl.clearColor(0.0, 0.0, 0.0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Habilitar culling y depth test
  gl.enable(gl.CULL_FACE);
  gl.enable(gl.DEPTH_TEST);

  // Actualizar lluvia
  if (isRaining) {
    for (let drop of rainDrops) {
      drop.visible = true;
      // Mover gota hacia abajo
      drop.position.y -= drop.velocity;

      // Si llega al suelo, reiniciar arriba (dentro del mundo)
      if (drop.position.y < 0) {
        drop.position.y = Math.random() * 20 + 50; // Entre 50 y 70
        drop.position.x = Math.random() * 600 - 300; // -300 a 300
        drop.position.z = Math.random() * 600 - 300; // -300 a 300
      }
    }
  } else {
    // Ocultar todas las gotas cuando no llueve
    for (let drop of rainDrops) {
      drop.visible = false;
    }
  }

  // Actualizar rayo
  lightningTimer += deltaTime;

  // Disparar rayo cuando se alcanza el tiempo programado
  // Nota: 'lightning' puede ser null si aún no se ha creado el objeto.
  // Para evitar errores en tiempo de ejecución, solo actualizar si existe.
  if (lightning && lightningTimer >= nextLightningTime && lightningDuration <= 0) {
    // Posicionar rayo en la ciudad
    lightning.position.x = Math.random() * 30;
    lightning.position.z = Math.random() * 30;
    lightning.visible = true;
    lightningDuration = 200; // 200ms de duración
    nextLightningTime = lightningTimer + lightningInterval; // Siguiente rayo en 15 segundos
  }

  // Desactivar rayo después de la duración
  if (lightning && lightningDuration > 0) {
    lightningDuration -= deltaTime;
    if (lightningDuration <= 0) {
      lightning.visible = false;
    }
  }

  scene.camera.checkKeys();
  const viewProjectionMatrix = setupViewProjection(gl);

  // Dibujar primero todos los objetos opacos (sin blending)
  gl.disable(gl.BLEND);
  gl.useProgram(colorProgramInfo.program);
  for (let object of scene.objects) {
    // Dibujar solo objetos que NO son gotas de lluvia
    const isRainDrop = object.id && object.id.toString().startsWith('rain-');
    if (!isRainDrop) {
      drawObject(gl, colorProgramInfo, object, viewProjectionMatrix, fract);
    }
  }

  // Luego dibujar las gotas de lluvia con blending
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

  // Actualizar la simulación cada cierto tiempo
  if (elapsed >= duration) {
    elapsed = 0;
    await update();
  }

  requestAnimationFrame(drawScene);
}

function setupViewProjection(gl) {
  // Campo de visión de 60 grados
  const fov = 60 * Math.PI / 180;
  const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;

  // Crear matrices de proyección y vista (aumentar far plane para ver más lejos)
  const projectionMatrix = M4.perspective(fov, aspect, 1, 500);

  const cameraPosition = scene.camera.posArray;
  const target = scene.camera.targetArray;
  const up = [0, 1, 0];

  const cameraMatrix = M4.lookAt(cameraPosition, target, up);
  const viewMatrix = M4.inverse(cameraMatrix);
  const viewProjectionMatrix = M4.multiply(projectionMatrix, viewMatrix);

  return viewProjectionMatrix;
}

// Crear la interfaz para controlar el sol
function setupUI() {
  const gui = new GUI();

  // Control de spawn de carros
  const spawnControls = {
    spawnInterval: initData.SpawnInterval
  };
  const spawnFolder = gui.addFolder('Car Spawning');
  spawnFolder.add(spawnControls, 'spawnInterval', 1, 50, 1).name('Spawn Interval (steps)').onChange(async (value) => {
    spawnControls.spawnInterval = value;
    initData.SpawnInterval = value;
    await setSpawnInterval(value);
  });
  spawnFolder.open();

  const sun = scene.lights[0];
  const lightFolder = gui.addFolder('Moon Light');
  lightFolder.add(sun.position, 'x', -50, 50).name('Position X');
  lightFolder.add(sun.position, 'y', 0, 60).name('Position Y (Height)');
  lightFolder.add(sun.position, 'z', -50, 50).name('Position Z');
  lightFolder.open();

  // Controles de intensidad de luz
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

  // Control de clima
  const weatherFolder = gui.addFolder('Weather');
  weatherFolder.add({ rain: isRaining }, 'rain').name('Rain').onChange((value) => {
    isRaining = value;
  });

  // Botón para activar rayo manualmente
  const lightningControls = {
    triggerLightning: () => {
      // Posicionar rayo en la ciudad
      lightning.position.x = Math.random() * 30;
      lightning.position.z = Math.random() * 30;
      lightning.visible = true;
      lightningDuration = 200; // 200ms de duración
      // NO resetear el timer para no romper el ciclo automático
    }
  };
  weatherFolder.add(lightningControls, 'triggerLightning').name('Lightning Strike');
  weatherFolder.open();

  // Controles de cámara
  const cameraFolder = gui.addFolder('Camera');
  const cameraControls = {
    zoomIn: () => {
      scene.camera.zoom(-2);
    },
    zoomOut: () => {
      scene.camera.zoom(2);
    }
  };
  cameraFolder.add(cameraControls, 'zoomIn').name('Zoom In (+)');
  cameraFolder.add(cameraControls, 'zoomOut').name('Zoom Out (-)');
  cameraFolder.open();
}

main();
