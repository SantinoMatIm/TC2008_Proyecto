/*
 * Traffic City Visualization
 * Shows the city with roads, traffic lights, buildings, and cars
 */


'use strict';

import * as twgl from 'twgl-base.js';
import GUI from 'lil-gui';
import { M4 } from '../libs/3d-lib';
import { Scene3D } from '../libs/scene3d';
import { Object3D } from '../libs/object3d';
import { Camera3D } from '../libs/camera3d';
import { cubeSingleColor } from '../libs/shapes';

// Functions and arrays for the communication with the API
import {
  cars, obstacles, trafficLights, destinations, roads,
  initTrafficModel, update, getCars, getObstacles,
  getTrafficLights, getDestinations, getRoads
} from '../libs/api_connection_traffic.js';

// Define the shader code, using GLSL 3.00
import vsGLSL from '../assets/shaders/vs_color.glsl?raw';
import fsGLSL from '../assets/shaders/fs_color.glsl?raw';

const scene = new Scene3D();

// Global variables
let colorProgramInfo = undefined;
let gl = undefined;
const duration = 1000; // ms
let elapsed = 0;
let then = 0;


// Main function is async to be able to make the requests
async function main() {
  // Setup the canvas area
  const canvas = document.querySelector('canvas');
  gl = canvas.getContext('webgl2');
  twgl.resizeCanvasToDisplaySize(gl.canvas);
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

  // Prepare the program with the shaders
  colorProgramInfo = twgl.createProgramInfo(gl, [vsGLSL, fsGLSL]);

  // Initialize the traffic model
  await initTrafficModel();

  // Get all the city elements
  await getRoads();
  await getObstacles();
  await getTrafficLights();
  await getDestinations();
  await getCars();

  // Initialize the scene
  setupScene();

  // Position the objects in the scene
  setupObjects(scene, gl, colorProgramInfo);

  // Prepare the user interface
  setupUI();

  // First call to the drawing loop
  drawScene();
}


function setupScene() {
  let camera = new Camera3D(0,
    35,             // Distance to target
    4.7,            // Azimut
    0.8,            // Elevation
    [12, 0, 12],    // Target position (center of the city)
    [0, 0, 0]);
  // These values are empirical.
  camera.panOffset = [0, 12, 0];
  scene.setCamera(camera);
  scene.camera.setupControls();
}

function setupObjects(scene, gl, programInfo) {
  // Create cubes with specific colors for each element type

  // Road cube (dark gray)
  const roadObj = new Object3D(-100);
  roadObj.arrays = cubeSingleColor(1, [0.3, 0.3, 0.3, 1]);
  roadObj.bufferInfo = twgl.createBufferInfoFromArrays(gl, roadObj.arrays);
  roadObj.vao = twgl.createVAOFromBufferInfo(gl, programInfo, roadObj.bufferInfo);

  // Building cube (gray-blue)
  const buildingObj = new Object3D(-101);
  buildingObj.arrays = cubeSingleColor(1, [0.5, 0.5, 0.6, 1.0]);
  buildingObj.bufferInfo = twgl.createBufferInfoFromArrays(gl, buildingObj.arrays);
  buildingObj.vao = twgl.createVAOFromBufferInfo(gl, programInfo, buildingObj.bufferInfo);

  // Traffic light cubes (red and green)
  const redLightObj = new Object3D(-102);
  redLightObj.arrays = cubeSingleColor(1, [1.0, 0.0, 0.0, 1.0]);
  redLightObj.bufferInfo = twgl.createBufferInfoFromArrays(gl, redLightObj.arrays);
  redLightObj.vao = twgl.createVAOFromBufferInfo(gl, programInfo, redLightObj.bufferInfo);

  const greenLightObj = new Object3D(-103);
  greenLightObj.arrays = cubeSingleColor(1, [0.0, 1.0, 0.0, 1.0]);
  greenLightObj.bufferInfo = twgl.createBufferInfoFromArrays(gl, greenLightObj.arrays);
  greenLightObj.vao = twgl.createVAOFromBufferInfo(gl, programInfo, greenLightObj.bufferInfo);

  // Destination cube (green-cyan)
  const destObj = new Object3D(-104);
  destObj.arrays = cubeSingleColor(1, [0.0, 1.0, 0.5, 1.0]);
  destObj.bufferInfo = twgl.createBufferInfoFromArrays(gl, destObj.arrays);
  destObj.vao = twgl.createVAOFromBufferInfo(gl, programInfo, destObj.bufferInfo);

  // Car cube (yellow)
  const carObj = new Object3D(-105);
  carObj.arrays = cubeSingleColor(1, [1.0, 0.8, 0.0, 1.0]);
  carObj.bufferInfo = twgl.createBufferInfoFromArrays(gl, carObj.arrays);
  carObj.vao = twgl.createVAOFromBufferInfo(gl, programInfo, carObj.bufferInfo);

  // Setup roads
  for (const road of roads) {
    road.arrays = roadObj.arrays;
    road.bufferInfo = roadObj.bufferInfo;
    road.vao = roadObj.vao;
    road.scale = { x: 1, y: 0.05, z: 1 };
    scene.addObject(road);
  }

  // Setup obstacles (buildings)
  for (const obstacle of obstacles) {
    obstacle.arrays = buildingObj.arrays;
    obstacle.bufferInfo = buildingObj.bufferInfo;
    obstacle.vao = buildingObj.vao;
    obstacle.scale = { x: 0.9, y: 2.5, z: 0.9 };
    obstacle.position.y = 1.25;  // Raise buildings
    scene.addObject(obstacle);
  }

  // Setup traffic lights
  for (const light of trafficLights) {
    light.scale = { x: 0.3, y: 0.8, z: 0.3 };
    light.position.y = 0.4;
    // Assign red or green based on initial state
    if (light.state) {
      light.arrays = greenLightObj.arrays;
      light.bufferInfo = greenLightObj.bufferInfo;
      light.vao = greenLightObj.vao;
      light.greenVao = greenLightObj.vao;
      light.redVao = redLightObj.vao;
    } else {
      light.arrays = redLightObj.arrays;
      light.bufferInfo = redLightObj.bufferInfo;
      light.vao = redLightObj.vao;
      light.greenVao = greenLightObj.vao;
      light.redVao = redLightObj.vao;
    }
    scene.addObject(light);
  }

  // Setup destinations
  for (const dest of destinations) {
    dest.arrays = destObj.arrays;
    dest.bufferInfo = destObj.bufferInfo;
    dest.vao = destObj.vao;
    dest.scale = { x: 0.8, y: 0.1, z: 0.8 };
    dest.position.y = 0.05;
    scene.addObject(dest);
  }

  // Setup cars
  for (const car of cars) {
    car.arrays = carObj.arrays;
    car.bufferInfo = carObj.bufferInfo;
    car.vao = carObj.vao;
    car.scale = { x: 0.4, y: 0.3, z: 0.6 };
    car.position.y = 0.15;
    scene.addObject(car);
  }
}

// Draw an object with its corresponding transformations
function drawObject(gl, programInfo, object, viewProjectionMatrix, fract) {
  // Update traffic light VAO based on state
  if (trafficLights.includes(object)) {
    object.vao = object.state ? object.greenVao : object.redVao;
  }

  // Prepare the vector for translation and scale
  let v3_tra = object.posArray;
  let v3_sca = object.scaArray;

  // Create the individual transform matrices
  const scaMat = M4.scale(v3_sca);
  const rotXMat = M4.rotationX(object.rotRad.x);
  const rotYMat = M4.rotationY(object.rotRad.y);
  const rotZMat = M4.rotationZ(object.rotRad.z);
  const traMat = M4.translation(v3_tra);

  // Create the composite matrix with all transformations
  let transforms = M4.identity();
  transforms = M4.multiply(scaMat, transforms);
  transforms = M4.multiply(rotXMat, transforms);
  transforms = M4.multiply(rotYMat, transforms);
  transforms = M4.multiply(rotZMat, transforms);
  transforms = M4.multiply(traMat, transforms);

  object.matrix = transforms;

  // Apply the projection to the final matrix for the
  // World-View-Projection
  const wvpMat = M4.multiply(viewProjectionMatrix, transforms);

  // Model uniforms
  let objectUniforms = {
    u_transforms: wvpMat
  }
  twgl.setUniforms(programInfo, objectUniforms);

  gl.bindVertexArray(object.vao);
  twgl.drawBufferInfo(gl, object.bufferInfo);
}

// Function to do the actual display of the objects
async function drawScene() {
  // Compute time elapsed since last frame
  let now = Date.now();
  let deltaTime = now - then;
  elapsed += deltaTime;
  let fract = Math.min(1.0, elapsed / duration);
  then = now;

  // Clear the canvas
  gl.clearColor(0.1, 0.1, 0.15, 1);  // Dark blue background
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // tell webgl to cull faces
  gl.enable(gl.CULL_FACE);
  gl.enable(gl.DEPTH_TEST);

  scene.camera.checkKeys();
  const viewProjectionMatrix = setupViewProjection(gl);

  // Draw the objects
  gl.useProgram(colorProgramInfo.program);
  for (let object of scene.objects) {
    drawObject(gl, colorProgramInfo, object, viewProjectionMatrix, fract);
  }

  // Update the scene after the elapsed duration
  if (elapsed >= duration) {
    elapsed = 0;
    await update();
  }

  requestAnimationFrame(drawScene);
}

function setupViewProjection(gl) {
  // Field of view of 60 degrees vertically, in radians
  const fov = 60 * Math.PI / 180;
  const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;

  // Matrices for the world view
  const projectionMatrix = M4.perspective(fov, aspect, 1, 200);

  const cameraPosition = scene.camera.posArray;
  const target = scene.camera.targetArray;
  const up = [0, 1, 0];

  const cameraMatrix = M4.lookAt(cameraPosition, target, up);
  const viewMatrix = M4.inverse(cameraMatrix);
  const viewProjectionMatrix = M4.multiply(projectionMatrix, viewMatrix);

  return viewProjectionMatrix;
}

// Setup a ui.
function setupUI() {
  // UI can be added here if needed
}

main();
