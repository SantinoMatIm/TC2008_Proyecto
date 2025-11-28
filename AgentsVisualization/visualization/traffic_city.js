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
import { cubeSingleColor, cubeTextured } from '../libs/shapes';

// Traemos las funciones y arrays para hablar con el servidor
import {
  cars, obstacles, trafficLights, destinations, roads,
  initTrafficModel, update, getCars, getObstacles,
  getTrafficLights, getDestinations, getRoads
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
  // Crear la cámara apuntando al centro de la ciudad
  let camera = new Camera3D(0,
    35,             // qué tan lejos está
    4.7,            // rotación horizontal
    0.8,            // rotación vertical
    [12, 0, 12],    // está mirando al centro de la ciudad
    [0, 0, 0]);
  camera.panOffset = [0, 12, 0];
  scene.setCamera(camera);
  scene.camera.setupControls();

  // Crear la luna para iluminar la ciudad
  const sun = new Light3D(
    0,
    [-10, 30, -10],                         // posición de la luna en una esquina
    [0.35, 0.4, 0.5, 1.0],                  // luz ambiental (tono azulado frío)
    [0.9, 0.95, 1.0, 1.0],                  // luz directa (blanca como la luna)
    [1.0, 1.0, 1.0, 1.0]                    // brillos (blancos puros)
  );
  scene.addLight(sun);
}

// Función para agrupar edificios que están pegados y hacerlos un solo edificio grande
function groupAdjacentObstacles(obstacles) {
  if (obstacles.length === 0) return [];

  // Mapa para buscar rápido si hay un edificio en una posición
  const obstacleMap = new Map();
  for (const obs of obstacles) {
    const key = `${Math.round(obs.position.x)},${Math.round(obs.position.z)}`;
    obstacleMap.set(key, obs);
  }

  const visited = new Set();
  const clusters = [];

  // Función para obtener los vecinos de una celda (arriba, abajo, izquierda, derecha)
  function getNeighbors(x, z) {
    return [
      [x + 1, z],
      [x - 1, z],
      [x, z + 1],
      [x, z - 1]
    ];
  }

  // Buscar todos los edificios conectados empezando desde uno
  function findCluster(startX, startZ) {
    const queue = [[startX, startZ]];
    const clusterCells = [];
    let minX = startX, maxX = startX;
    let minZ = startZ, maxZ = startZ;

    while (queue.length > 0) {
      const [x, z] = queue.shift();
      const key = `${x},${z}`;

      if (visited.has(key)) continue;
      if (!obstacleMap.has(key)) continue;

      visited.add(key);
      clusterCells.push([x, z]);

      // Actualizar los límites del grupo
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);

      // Agregar los vecinos a la cola para seguir buscando
      for (const [nx, nz] of getNeighbors(x, z)) {
        const nKey = `${nx},${nz}`;
        if (!visited.has(nKey) && obstacleMap.has(nKey)) {
          queue.push([nx, nz]);
        }
      }
    }

    return { minX, maxX, minZ, maxZ, cells: clusterCells };
  }

  // Encontrar todos los grupos de edificios
  for (const obs of obstacles) {
    const x = Math.round(obs.position.x);
    const z = Math.round(obs.position.z);
    const key = `${x},${z}`;

    if (!visited.has(key)) {
      const cluster = findCluster(x, z);
      clusters.push(cluster);
    }
  }

  return clusters;
}

async function setupObjects(scene, gl, programInfo) {
  // Crear cubos con diferentes colores para calles, destinos y sol
  const roadCube = new Object3D(-100);
  // Color más oscuro para asfalto húmedo que refleja mejor las luces
  roadCube.arrays = cubeSingleColor(1, [0.2, 0.2, 0.22, 1]);
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

  // Banquetas (aceras/sidewalks) - color gris claro
  const sidewalkCube = new Object3D(-103);
  sidewalkCube.arrays = cubeSingleColor(1, [0.6, 0.6, 0.65, 1.0]); // Gris claro
  sidewalkCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, sidewalkCube.arrays);
  sidewalkCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, sidewalkCube.bufferInfo);

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

  // Cargar poste de luz con sus materiales
  clearMaterials();
  const streetlightMtlData = await fetch('/assets/models/streetlight.mtl').then(r => r.text());
  loadMtl(streetlightMtlData);
  const streetlightObj = new Object3D(-210);
  const streetlightData = await fetch('/assets/models/streetlight.obj').then(r => r.text());
  streetlightObj.prepareVAO(gl, programInfo, streetlightData);

  // Configurar las calles
  for (const road of roads) {
    road.arrays = roadCube.arrays;
    road.bufferInfo = roadCube.bufferInfo;
    road.vao = roadCube.vao;
    road.scale = { x: 1, y: 0.05, z: 1 };
    road.shininess = 100.0; // Superficie reflectante para que refleje las luces
    scene.addObject(road);
  }

  // Agrupar edificios que estén pegados
  const buildingClusters = groupAdjacentObstacles(obstacles);

  // Filtrar clusters grandes (sizeX >= 2 Y sizeZ >= 2) para Building 1 y Building 2
  const largeClusters = [];
  for (let i = 0; i < buildingClusters.length; i++) {
    const cluster = buildingClusters[i];
    const sizeX = cluster.maxX - cluster.minX + 1;
    const sizeZ = cluster.maxZ - cluster.minZ + 1;
    // Ambas dimensiones deben ser >= 2 para evitar edificios muy delgados (como 4x1)
    if (sizeX >= 2 && sizeZ >= 2) {
      largeClusters.push(i);
    }
  }

  // Seleccionar índices aleatorios para Building 1 y Building 2 (solo en clusters grandes)
  let building1Index = -1;
  let building2Index = -1;

  if (largeClusters.length >= 1) {
    const randomIndex1 = Math.floor(Math.random() * largeClusters.length);
    building1Index = largeClusters[randomIndex1];

    if (largeClusters.length >= 2) {
      let randomIndex2;
      do {
        randomIndex2 = Math.floor(Math.random() * largeClusters.length);
      } while (randomIndex2 === randomIndex1);
      building2Index = largeClusters[randomIndex2];
    }
  }

  // Crear los edificios agrupados con diferentes modelos
  let buildingIdCounter = 0;
  for (let i = 0; i < buildingClusters.length; i++) {
    const cluster = buildingClusters[i];
    // Calcular el centro y tamaño del grupo de edificios
    const centerX = (cluster.minX + cluster.maxX) / 2;
    const centerZ = (cluster.minZ + cluster.maxZ) / 2;
    const sizeX = cluster.maxX - cluster.minX + 1;
    const sizeZ = cluster.maxZ - cluster.minZ + 1;
    const area = sizeX * sizeZ;

    // Espacios delgados = banquetas, espacios normales = edificios
    const isNarrowSpace = (sizeX === 1) || (sizeZ === 1);

    if (isNarrowSpace) {
      let position = 0;
      for (const [x, z] of cluster.cells) {
        // Crear banqueta
        const sidewalk = new Object3D(`sidewalk-${buildingIdCounter++}`, [x, 0, z]);
        sidewalk.arrays = sidewalkCube.arrays;
        sidewalk.bufferInfo = sidewalkCube.bufferInfo;
        sidewalk.vao = sidewalkCube.vao;
        sidewalk.scale = { x: 1, y: 0.15, z: 1 };
        sidewalk.position.y = 0.075;
        sidewalk.shininess = 50.0;
        scene.addObject(sidewalk);

        // Colocar árboles y postes de luz cada 2 posiciones
        if (position % 2 === 0) {
          const obj = new Object3D(`tree-light-${buildingIdCounter++}`, [x, 0.15, z]);
          const isTree = (position % 4 === 0);

          if (isTree) {
            // Árbol
            obj.arrays = treeObj.arrays;
            obj.bufferInfo = treeObj.bufferInfo;
            obj.vao = treeObj.vao;
            obj.scale = { x: 0.8, y: 0.8, z: 0.8 };
            obj.shininess = 250.0;
          } else {
            // Poste de luz
            obj.arrays = streetlightObj.arrays;
            obj.bufferInfo = streetlightObj.bufferInfo;
            obj.vao = streetlightObj.vao;
            obj.scale = { x: 1.0, y: 1.0, z: 1.0 };
            obj.shininess = 250.0;

            // Agregar posiciones de luces según orientación
            if (sizeX === 1) {
              streetLightPositions.push({ x: x + 1.2, y: 3.55, z: z });
              streetLightPositions.push({ x: x - 1.2, y: 3.55, z: z });
            } else {
              obj.rotRad.y = Math.PI / 2;
              streetLightPositions.push({ x: x, y: 3.55, z: z + 1.2 });
              streetLightPositions.push({ x: x, y: 3.55, z: z - 1.2 });
            }
          }
          scene.addObject(obj);
        }
        position++;
      }
    } else {
      // Crear edificio
      const building = new Object3D(`building-${buildingIdCounter++}`, [centerX, 0, centerZ]);
      let buildingType;

      if (i === building1Index) {
        buildingType = 0; // Building 1
      } else if (i === building2Index) {
        buildingType = 1; // Building 2
      } else {
        // El resto: Suburban house (2), Apartment (3), Office tower (4), o Warehouse (5)
        buildingType = 2 + Math.floor(Math.random() * 4);
      }

      if (buildingType === 0) {
        // Building 1 - gris con ventanas blancas
        building.arrays = building1Obj.arrays;
        building.bufferInfo = building1Obj.bufferInfo;
        building.vao = building1Obj.vao;
        building.scale = { x: 0.35 * sizeX, y: 1.2, z: 0.35 * sizeZ };
        building.position.y = 0;
      } else if (buildingType === 1) {
        // Building 2 - gris con ventanas azules
        building.arrays = building2Obj.arrays;
        building.bufferInfo = building2Obj.bufferInfo;
        building.vao = building2Obj.vao;
        building.scale = { x: 0.35 * sizeX, y: 2.0, z: 0.35 * sizeZ };
        building.position.y = 0;
      } else if (buildingType === 2) {
        // Suburban house - casa de suburbios
        building.arrays = building3Obj.arrays;
        building.bufferInfo = building3Obj.bufferInfo;
        building.vao = building3Obj.vao;
        building.scale = { x: 0.45 * sizeX, y: 0.8, z: 0.45 * sizeZ };
        building.position.y = 0;
      } else if (buildingType === 3) {
        // Apartment building - edificio de departamentos
        building.arrays = building4Obj.arrays;
        building.bufferInfo = building4Obj.bufferInfo;
        building.vao = building4Obj.vao;
        building.scale = { x: 0.25 * sizeX, y: 0.6, z: 0.25 * sizeZ };
        building.position.y = 0;
      } else if (buildingType === 4) {
        // Office tower - torre de oficinas escalonada
        building.arrays = building5Obj.arrays;
        building.bufferInfo = building5Obj.bufferInfo;
        building.vao = building5Obj.vao;
        building.scale = { x: 0.3 * sizeX, y: 0.7, z: 0.3 * sizeZ };
        building.position.y = 0;
      } else {
        // Warehouse - almacén industrial
        building.arrays = building6Obj.arrays;
        building.bufferInfo = building6Obj.bufferInfo;
        building.vao = building6Obj.vao;
        building.scale = { x: 0.35 * sizeX, y: 0.9, z: 0.35 * sizeZ };
        building.position.y = 0;
      }

      scene.addObject(building);
    }
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
    light.scale = { x: 1.0, y: 1.0, z: 1.0 };
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
    dest.scale = { x: 0.8, y: 0.1, z: 0.8 };
    dest.position.y = 0.05;
    scene.addObject(dest);
  }

  // Configurar los coches eligiendo aleatoriamente entre los 2 modelos
  // Cada coche tendrá un color random pero ventanas azul claro
  for (const car of cars) {
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
      car.scale = { x: 0.5, y: 0.5, z: 0.5 };
      car.yOffset = -1.08;
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
      car.scale = { x: 0.16, y: 0.16, z: 0.16 };
      car.yOffset = -1.0;
    }

    // Rotar el coche para que apunte en la dirección de la calle
    car.rotRad.y = -Math.PI / 2;
    scene.addObject(car);
  }

  // Crear una representación visual de la luna
  const sun = scene.lights[0];
  const sunObj = new Object3D(-999);
  sunObj.arrays = sunCube.arrays;
  sunObj.bufferInfo = sunCube.bufferInfo;
  sunObj.vao = sunCube.vao;
  sunObj.position = sun.position;
  sunObj.scale = { x: 7, y: 7, z: 7 };
  scene.addObject(sunObj);

  const grassGround = new Object3D('grass-ground', [0, -0.15, 0]);
  grassGround.arrays = grassCube.arrays;
  grassGround.bufferInfo = grassCube.bufferInfo;
  grassGround.vao = grassCube.vao;
  grassGround.scale = { x: 165, y: 0.1, z: 165 };
  scene.addObject(grassGround);

  const highway = new Object3D('highway', [94.5, -0.08, 12]);
  highway.arrays = roadCube.arrays;
  highway.bufferInfo = roadCube.bufferInfo;
  highway.vao = roadCube.vao;
  highway.scale = { x: 70.5, y: 0.05, z: 2 };
  highway.shininess = 100.0;
  scene.addObject(highway);

  const yellowLineCube = new Object3D(-114);
  yellowLineCube.arrays = cubeSingleColor(1, [0.9, 0.8, 0.2, 1.0]);
  yellowLineCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, yellowLineCube.arrays);
  yellowLineCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, yellowLineCube.bufferInfo);

  for (let i = 0; i < 56; i++) {
    const line = new Object3D(`highway-line-${i}`, [26 + (i * 2.5), -0.04, 12]);
    line.arrays = yellowLineCube.arrays;
    line.bufferInfo = yellowLineCube.bufferInfo;
    line.vao = yellowLineCube.vao;
    line.scale = { x: 1.2, y: 0.05, z: 0.15 };
    line.shininess = 80.0;
    scene.addObject(line);
  }

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

  const lightTunnel = new Object3D('light-tunnel', [165, 0, 22]);
  lightTunnel.arrays = createSemicircle(4, 32, [1.0, 1.0, 1.0, 1.0]);
  lightTunnel.bufferInfo = twgl.createBufferInfoFromArrays(gl, lightTunnel.arrays);
  lightTunnel.vao = twgl.createVAOFromBufferInfo(gl, programInfo, lightTunnel.bufferInfo);
  lightTunnel.shininess = 1000.0;
  scene.addObject(lightTunnel);

  const lightTunnel2 = new Object3D('light-tunnel-2', [165, 0, 22]);
  lightTunnel2.arrays = createSemicircle(6, 32, [1.0, 0.98, 0.9, 1.0]);
  lightTunnel2.bufferInfo = twgl.createBufferInfoFromArrays(gl, lightTunnel2.arrays);
  lightTunnel2.vao = twgl.createVAOFromBufferInfo(gl, programInfo, lightTunnel2.bufferInfo);
  lightTunnel2.shininess = 1000.0;
  scene.addObject(lightTunnel2);

  const lightTunnel3 = new Object3D('light-tunnel-3', [165, 0, 22]);
  lightTunnel3.arrays = createSemicircle(8, 32, [1.0, 0.95, 0.8, 0.9]);
  lightTunnel3.bufferInfo = twgl.createBufferInfoFromArrays(gl, lightTunnel3.arrays);
  lightTunnel3.vao = twgl.createVAOFromBufferInfo(gl, programInfo, lightTunnel3.bufferInfo);
  lightTunnel3.shininess = 1000.0;
  scene.addObject(lightTunnel3);

  const lightTunnelOuter = new Object3D('light-tunnel-outer', [165, 0, 22]);
  lightTunnelOuter.arrays = createSemicircle(10, 32, [1.0, 0.9, 0.7, 0.6]);
  lightTunnelOuter.bufferInfo = twgl.createBufferInfoFromArrays(gl, lightTunnelOuter.arrays);
  lightTunnelOuter.vao = twgl.createVAOFromBufferInfo(gl, programInfo, lightTunnelOuter.bufferInfo);
  lightTunnelOuter.shininess = 1000.0;
  scene.addObject(lightTunnelOuter);
  for (let i = 0; i < 800; i++) {
    const drop = new Object3D(`rain-${i}`, [
      Math.random() * 330 - 165,
      Math.random() * 60 + 10,
      Math.random() * 330 - 165
    ]);
    drop.arrays = rainDropCube.arrays;
    drop.bufferInfo = rainDropCube.bufferInfo;
    drop.vao = rainDropCube.vao;
    drop.scale = { x: 0.02, y: 0.5, z: 0.02 };
    drop.velocity = Math.random() * 0.3 + 0.5;
    drop.visible = false;
    rainDrops.push(drop);
    scene.addObject(drop);
  }

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

  const bushCube = new Object3D(-107);
  bushCube.arrays = cubeSingleColor(1, [0.15, 0.45, 0.15, 1.0]);
  bushCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, bushCube.arrays);
  bushCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, bushCube.bufferInfo);

  const darkBushCube = new Object3D(-108);
  darkBushCube.arrays = cubeSingleColor(1, [0.1, 0.3, 0.1, 1.0]);
  darkBushCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, darkBushCube.arrays);
  darkBushCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, darkBushCube.bufferInfo);

  const yellowBushCube = new Object3D(-109);
  yellowBushCube.arrays = cubeSingleColor(1, [0.4, 0.45, 0.2, 1.0]);
  yellowBushCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, yellowBushCube.arrays);
  yellowBushCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, yellowBushCube.bufferInfo);

  const rockCube = new Object3D(-110);
  rockCube.arrays = cubeSingleColor(1, [0.4, 0.4, 0.45, 1.0]);
  rockCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, rockCube.arrays);
  rockCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, rockCube.bufferInfo);

  const deadBushCube = new Object3D(-111);
  deadBushCube.arrays = cubeSingleColor(1, [0.35, 0.25, 0.15, 1.0]);
  deadBushCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, deadBushCube.arrays);
  deadBushCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, deadBushCube.bufferInfo);

  const smallPlantCube = new Object3D(-112);
  smallPlantCube.arrays = cubeSingleColor(1, [0.2, 0.5, 0.25, 1.0]);
  smallPlantCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, smallPlantCube.arrays);
  smallPlantCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, smallPlantCube.bufferInfo);

  const grassClumpCube = new Object3D(-113);
  grassClumpCube.arrays = cubeSingleColor(1, [0.25, 0.55, 0.2, 1.0]);
  grassClumpCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, grassClumpCube.arrays);
  grassClumpCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, grassClumpCube.bufferInfo);
  const cityMinX = -1;
  const cityMaxX = 25;
  const cityMinZ = -1;
  const cityMaxZ = 25;
  const minSeparation = 4;
  const worldLimit = 165;

  for (let i = 0; i < 1800; i++) {
    let x, z;
    const zone = i % 4;

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

    if (x >= 24 && x <= 165 && z >= 10 && z <= 14) {
      continue;
    }

    const type = Math.random();

    if (type < 0.20) {
      const bush = new Object3D(`bush-${i}`, [x, 0, z]);
      bush.arrays = bushCube.arrays;
      bush.bufferInfo = bushCube.bufferInfo;
      bush.vao = bushCube.vao;
      const scale = 0.3 + Math.random() * 0.5;
      bush.scale = { x: scale, y: scale * 0.6, z: scale };
      bush.shininess = 150.0;
      scene.addObject(bush);
    } else if (type < 0.35) {
      const darkBush = new Object3D(`darkbush-${i}`, [x, 0, z]);
      darkBush.arrays = darkBushCube.arrays;
      darkBush.bufferInfo = darkBushCube.bufferInfo;
      darkBush.vao = darkBushCube.vao;
      const scale = 0.25 + Math.random() * 0.45;
      darkBush.scale = { x: scale, y: scale * 0.7, z: scale };
      darkBush.shininess = 120.0;
      scene.addObject(darkBush);
    } else if (type < 0.45) {
      const yellowBush = new Object3D(`yellowbush-${i}`, [x, 0, z]);
      yellowBush.arrays = yellowBushCube.arrays;
      yellowBush.bufferInfo = yellowBushCube.bufferInfo;
      yellowBush.vao = yellowBushCube.vao;
      const scale = 0.2 + Math.random() * 0.4;
      yellowBush.scale = { x: scale, y: scale * 0.5, z: scale };
      yellowBush.shininess = 100.0;
      scene.addObject(yellowBush);
    } else if (type < 0.60) {
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
      const deadBush = new Object3D(`deadbush-${i}`, [x, 0, z]);
      deadBush.arrays = deadBushCube.arrays;
      deadBush.bufferInfo = deadBushCube.bufferInfo;
      deadBush.vao = deadBushCube.vao;
      const scale = 0.2 + Math.random() * 0.3;
      deadBush.scale = { x: scale, y: scale * 0.4, z: scale };
      deadBush.shininess = 90.0;
      scene.addObject(deadBush);
    } else if (type < 0.95) {
      const smallPlant = new Object3D(`plant-${i}`, [x, 0, z]);
      smallPlant.arrays = smallPlantCube.arrays;
      smallPlant.bufferInfo = smallPlantCube.bufferInfo;
      smallPlant.vao = smallPlantCube.vao;
      const scale = 0.1 + Math.random() * 0.15;
      smallPlant.scale = { x: scale, y: scale * 1.5, z: scale };
      smallPlant.shininess = 130.0;
      scene.addObject(smallPlant);
    } else {
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

// Función para dibujar un objeto con todas sus transformaciones
function drawObject(gl, programInfo, object, viewProjectionMatrix, fract) {
  // No dibujar gotas de lluvia si no están visibles
  if (object.visible === false) return;

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
  const isLightTunnel = object.id === 'light-tunnel' || object.id === 'light-tunnel-outer' || object.id === 'light-tunnel-2' || object.id === 'light-tunnel-3';

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

  // Aplicar offset en Y para los coches (para que no floten)
  if (cars.includes(object) && object.yOffset !== undefined) {
    v3_tra = [v3_tra[0], v3_tra[1] + object.yOffset, v3_tra[2]];
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
    allLightPositions.push(light.position.x, light.position.y + 1.5, light.position.z);

    // Color según el estado del semáforo
    if (light.state) {
      // Verde brillante
      allLightColors.push(0.2, 1.0, 0.4, 1.0);
    } else {
      // Rojo brillante
      allLightColors.push(1.0, 0.0, 0.0, 1.0);
    }
  }

  // Agregar postes de luz (amarillo cálido)
  for (const streetLight of streetLightPositions) {
    allLightPositions.push(streetLight.x, streetLight.y, streetLight.z);
    allLightColors.push(1.0, 0.9, 0.7, 1.0); // Amarillo cálido de poste de luz
  }

  const totalLights = trafficLights.length + streetLightPositions.length;

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
        drop.position.x = Math.random() * 330 - 165; // -165 a 165
        drop.position.z = Math.random() * 330 - 165; // -165 a 165
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
  if (lightningTimer >= nextLightningTime && lightningDuration <= 0) {
    // Posicionar rayo en la ciudad
    lightning.position.x = Math.random() * 30;
    lightning.position.z = Math.random() * 30;
    lightning.visible = true;
    lightningDuration = 200; // 200ms de duración
    nextLightningTime = lightningTimer + lightningInterval; // Siguiente rayo en 15 segundos
  }

  // Desactivar rayo después de la duración
  if (lightningDuration > 0) {
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

  // Crear matrices de proyección y vista
  const projectionMatrix = M4.perspective(fov, aspect, 1, 200);

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
