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
import { cubeFaceColors } from '../libs/shapes';

// Traemos las funciones y arrays para hablar con el servidor
import {
  cars, obstacles, trafficLights, destinations, roads,
  initTrafficModel, update, getCars, getObstacles,
  getTrafficLights, getDestinations, getRoads
} from '../libs/api_connection_traffic.js';

// Los shaders que hacen que todo se vea bonito con iluminación
import vsGLSL from '../assets/shaders/vs_phong.glsl?raw';
import fsGLSL from '../assets/shaders/fs_phong.glsl?raw';

const scene = new Scene3D();

// Variables globales que usamos en todo el código
let colorProgramInfo = undefined;
let gl = undefined;
const duration = 1000; // cuánto dura cada actualización en milisegundos
let elapsed = 0;
let then = 0;


// Función principal, es async para poder hacer peticiones al servidor
async function main() {
  // Preparar el canvas donde se va a dibujar todo
  const canvas = document.querySelector('canvas');
  gl = canvas.getContext('webgl2');
  twgl.resizeCanvasToDisplaySize(gl.canvas);
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

  // Preparar los shaders
  colorProgramInfo = twgl.createProgramInfo(gl, [vsGLSL, fsGLSL]);

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

  // Crear el sol para iluminar la ciudad
  const sun = new Light3D(
    0,
    [15, 30, 15],                           // posición del sol en el cielo
    [0.3, 0.3, 0.3, 1.0],                   // luz ambiental (gris suave)
    [1.0, 0.95, 0.8, 1.0],                  // luz directa (amarilla como el sol)
    [1.0, 1.0, 1.0, 1.0]                    // brillos (blancos)
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
  // Crear un cubo básico para usar en calles y destinos
  const baseCube = new Object3D(-100);
  baseCube.arrays = cubeFaceColors(1);
  baseCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, baseCube.arrays);
  baseCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, baseCube.bufferInfo);

  // Cargar el modelo 3D del semáforo
  const stoplightObj = new Object3D(-200);
  const stoplightData = await fetch('/assets/models/stoplight_1.obj').then(r => r.text());
  stoplightObj.prepareVAO(gl, programInfo, stoplightData);

  // Cargar los modelos de los coches
  const car2023Obj = new Object3D(-201);
  const car2023Data = await fetch('/assets/models/car-2023-textures.obj').then(r => r.text());
  car2023Obj.prepareVAO(gl, programInfo, car2023Data);

  const car2024Obj = new Object3D(-202);
  const car2024Data = await fetch('/assets/models/car-2024-301.obj').then(r => r.text());
  car2024Obj.prepareVAO(gl, programInfo, car2024Data);

  // Cargar los 3 modelos de edificios
  const building1Obj = new Object3D(-203);
  const building1Data = await fetch('/assets/models/building_1.obj').then(r => r.text());
  building1Obj.prepareVAO(gl, programInfo, building1Data);

  const building2Obj = new Object3D(-204);
  const building2Data = await fetch('/assets/models/building_2.obj').then(r => r.text());
  building2Obj.prepareVAO(gl, programInfo, building2Data);

  const building3Obj = new Object3D(-205);
  const building3Data = await fetch('/assets/models/Rv_Building_3.obj').then(r => r.text());
  building3Obj.prepareVAO(gl, programInfo, building3Data);

  // Configurar las calles
  for (const road of roads) {
    road.arrays = baseCube.arrays;
    road.bufferInfo = baseCube.bufferInfo;
    road.vao = baseCube.vao;
    road.scale = { x: 1, y: 0.05, z: 1 };
    road.color = [0.3, 0.3, 0.3, 1];
    scene.addObject(road);
  }

  // Agrupar edificios que estén pegados
  const buildingClusters = groupAdjacentObstacles(obstacles);

  // Crear los edificios agrupados con diferentes modelos
  let buildingIdCounter = 0;
  for (const cluster of buildingClusters) {
    // Calcular el centro y tamaño del grupo de edificios
    const centerX = (cluster.minX + cluster.maxX) / 2;
    const centerZ = (cluster.minZ + cluster.maxZ) / 2;
    const sizeX = cluster.maxX - cluster.minX + 1;
    const sizeZ = cluster.maxZ - cluster.minZ + 1;
    const area = sizeX * sizeZ;

    const building = new Object3D(`building-${buildingIdCounter++}`, [centerX, 0, centerZ]);

    // Elegir tipo de edificio dependiendo del tamaño (edificios grandes tienden a ser más altos)
    let buildingType;
    const rand = Math.random();

    if (area >= 6) {
      // Edificios grandes: más probabilidad de ser rascacielos
      buildingType = rand < 0.7 ? 2 : (rand < 0.85 ? 1 : 0);
    } else if (area >= 3) {
      // Edificios medianos: mezcla
      buildingType = rand < 0.4 ? 2 : (rand < 0.7 ? 1 : 0);
    } else {
      // Edificios pequeños: más probabilidad de ser bajos
      buildingType = rand < 0.2 ? 2 : (rand < 0.6 ? 1 : 0);
    }

    if (buildingType === 0) {
      building.arrays = building1Obj.arrays;
      building.bufferInfo = building1Obj.bufferInfo;
      building.vao = building1Obj.vao;
      building.scale = { x: 0.35 * sizeX, y: 1.2, z: 0.35 * sizeZ };
      building.position.y = 0;
      building.color = [0.6, 0.5, 0.5, 1.0];
    } else if (buildingType === 1) {
      building.arrays = building2Obj.arrays;
      building.bufferInfo = building2Obj.bufferInfo;
      building.vao = building2Obj.vao;
      building.scale = { x: 0.35 * sizeX, y: 2.0, z: 0.35 * sizeZ };
      building.position.y = 0;
      building.color = [0.5, 0.5, 0.6, 1.0];
    } else {
      building.arrays = building3Obj.arrays;
      building.bufferInfo = building3Obj.bufferInfo;
      building.vao = building3Obj.vao;
      building.scale = { x: 0.018 * sizeX, y: 0.15, z: 0.030 * sizeZ };
      building.position.y = 0;
      building.color = [0.55, 0.6, 0.5, 1.0];
    }

    scene.addObject(building);
  }

  // Configurar los semáforos
  for (const light of trafficLights) {
    light.arrays = stoplightObj.arrays;
    light.bufferInfo = stoplightObj.bufferInfo;
    light.vao = stoplightObj.vao;
    light.scale = { x: 1.0, y: 1.0, z: 1.0 };
    light.position.y = 0;
    // Color según su estado inicial
    if (light.state) {
      light.color = [0.0, 1.0, 0.0, 1.0];
    } else {
      light.color = [1.0, 0.0, 0.0, 1.0];
    }
    light.greenColor = [0.0, 1.0, 0.0, 1.0];
    light.redColor = [1.0, 0.0, 0.0, 1.0];
    scene.addObject(light);
  }

  // Configurar los destinos (donde van los coches)
  for (const dest of destinations) {
    dest.arrays = baseCube.arrays;
    dest.bufferInfo = baseCube.bufferInfo;
    dest.vao = baseCube.vao;
    dest.scale = { x: 0.8, y: 0.1, z: 0.8 };
    dest.position.y = 0.05;
    dest.color = [0.0, 1.0, 0.5, 1.0];
    scene.addObject(dest);
  }

  // Configurar los coches eligiendo aleatoriamente entre los 2 modelos
  for (const car of cars) {
    const useCar2023 = Math.random() < 0.5;

    if (useCar2023) {
      car.arrays = car2023Obj.arrays;
      car.bufferInfo = car2023Obj.bufferInfo;
      car.vao = car2023Obj.vao;
      car.scale = { x: 0.5, y: 0.5, z: 0.5 };
      car.yOffset = -1.08;
    } else {
      car.arrays = car2024Obj.arrays;
      car.bufferInfo = car2024Obj.bufferInfo;
      car.vao = car2024Obj.vao;
      car.scale = { x: 0.16, y: 0.16, z: 0.16 };
      car.yOffset = -1.0;
    }

    // Rotar el coche para que apunte en la dirección de la calle
    car.rotRad.y = -Math.PI / 2;
    car.color = [1.0, 0.8, 0.0, 1.0];
    scene.addObject(car);
  }

  // Crear una representación visual del sol
  const sun = scene.lights[0];
  const sunObj = new Object3D(-999);
  sunObj.arrays = baseCube.arrays;
  sunObj.bufferInfo = baseCube.bufferInfo;
  sunObj.vao = baseCube.vao;
  sunObj.position = sun.position;
  sunObj.scale = { x: 3, y: 3, z: 3 };
  sunObj.color = [1.0, 1.0, 0.0, 1.0];
  scene.addObject(sunObj);
}

// Función para dibujar un objeto con todas sus transformaciones
function drawObject(gl, programInfo, object, viewProjectionMatrix, fract) {
  // Actualizar color del semáforo según su estado
  if (trafficLights.includes(object)) {
    object.color = object.state ? object.greenColor : object.redColor;
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

  // Pasar toda la info de iluminación a los shaders
  let objectUniforms = {
    u_lightWorldPosition: sun.posArray,
    u_viewWorldPosition: scene.camera.posArray,
    u_ambientLight: sun.ambient,
    u_diffuseLight: sun.diffuse,
    u_specularLight: sun.specular,
    u_world: worldMatrix,
    u_worldInverseTransform: worldInverseTranspose,
    u_worldViewProjection: worldViewProjectionMatrix,
    u_ambientColor: object.color,
    u_diffuseColor: object.color,
    u_specularColor: [1.0, 1.0, 1.0, 1.0],
    u_shininess: object.shininess
  }
  twgl.setUniforms(programInfo, objectUniforms);

  gl.bindVertexArray(object.vao);
  twgl.drawBufferInfo(gl, object.bufferInfo);
}

// Loop principal que dibuja todo en cada frame
async function drawScene() {
  // Calcular tiempo transcurrido
  let now = Date.now();
  let deltaTime = now - then;
  elapsed += deltaTime;
  let fract = Math.min(1.0, elapsed / duration);
  then = now;

  // Limpiar el canvas
  gl.clearColor(0.1, 0.1, 0.15, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Habilitar culling y depth test
  gl.enable(gl.CULL_FACE);
  gl.enable(gl.DEPTH_TEST);

  scene.camera.checkKeys();
  const viewProjectionMatrix = setupViewProjection(gl);

  // Dibujar todos los objetos
  gl.useProgram(colorProgramInfo.program);
  for (let object of scene.objects) {
    drawObject(gl, colorProgramInfo, object, viewProjectionMatrix, fract);
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
  const lightFolder = gui.addFolder('Sun Light');
  lightFolder.add(sun.position, 'x', -50, 50).name('Position X');
  lightFolder.add(sun.position, 'y', 0, 60).name('Position Y (Height)');
  lightFolder.add(sun.position, 'z', -50, 50).name('Position Z');
  lightFolder.open();
}

main();
