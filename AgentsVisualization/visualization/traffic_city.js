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
import { Light3D } from '../libs/light3d';
import { cubeFaceColors } from '../libs/shapes';

// Functions and arrays for the communication with the API
import {
  cars, obstacles, trafficLights, destinations, roads,
  initTrafficModel, update, getCars, getObstacles,
  getTrafficLights, getDestinations, getRoads
} from '../libs/api_connection_traffic.js';

// Define the shader code, using GLSL 3.00
import vsGLSL from '../assets/shaders/vs_phong.glsl?raw';
import fsGLSL from '../assets/shaders/fs_phong.glsl?raw';

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

  // Create a sun (directional light)
  const sun = new Light3D(
    0,
    [15, 30, 15],                           // Position high in the sky
    [0.3, 0.3, 0.3, 1.0],                   // Ambient light (soft gray)
    [1.0, 0.95, 0.8, 1.0],                  // Diffuse light (warm sunlight)
    [1.0, 1.0, 1.0, 1.0]                    // Specular light (white highlights)
  );
  scene.addLight(sun);
}

function setupObjects(scene, gl, programInfo) {
  // Create base cube with normals (colors will be set via uniforms)
  const baseCube = new Object3D(-100);
  baseCube.arrays = cubeFaceColors(1);
  baseCube.bufferInfo = twgl.createBufferInfoFromArrays(gl, baseCube.arrays);
  baseCube.vao = twgl.createVAOFromBufferInfo(gl, programInfo, baseCube.bufferInfo);

  // Setup roads
  for (const road of roads) {
    road.arrays = baseCube.arrays;
    road.bufferInfo = baseCube.bufferInfo;
    road.vao = baseCube.vao;
    road.scale = { x: 1, y: 0.05, z: 1 };
    road.color = [0.3, 0.3, 0.3, 1]; // Dark gray
    scene.addObject(road);
  }

  // Setup obstacles (buildings)
  for (const obstacle of obstacles) {
    obstacle.arrays = baseCube.arrays;
    obstacle.bufferInfo = baseCube.bufferInfo;
    obstacle.vao = baseCube.vao;
    obstacle.scale = { x: 0.9, y: 2.5, z: 0.9 };
    obstacle.position.y = 1.25;  // Raise buildings
    obstacle.color = [0.5, 0.5, 0.6, 1.0]; // Gray-blue
    scene.addObject(obstacle);
  }

  // Setup traffic lights
  for (const light of trafficLights) {
    light.arrays = baseCube.arrays;
    light.bufferInfo = baseCube.bufferInfo;
    light.vao = baseCube.vao;
    light.scale = { x: 0.3, y: 0.8, z: 0.3 };
    light.position.y = 0.4;
    // Set colors based on initial state
    if (light.state) {
      light.color = [0.0, 1.0, 0.0, 1.0]; // Green
    } else {
      light.color = [1.0, 0.0, 0.0, 1.0]; // Red
    }
    light.greenColor = [0.0, 1.0, 0.0, 1.0];
    light.redColor = [1.0, 0.0, 0.0, 1.0];
    scene.addObject(light);
  }

  // Setup destinations
  for (const dest of destinations) {
    dest.arrays = baseCube.arrays;
    dest.bufferInfo = baseCube.bufferInfo;
    dest.vao = baseCube.vao;
    dest.scale = { x: 0.8, y: 0.1, z: 0.8 };
    dest.position.y = 0.05;
    dest.color = [0.0, 1.0, 0.5, 1.0]; // Green-cyan
    scene.addObject(dest);
  }

  // Setup cars
  for (const car of cars) {
    car.arrays = baseCube.arrays;
    car.bufferInfo = baseCube.bufferInfo;
    car.vao = baseCube.vao;
    car.scale = { x: 0.4, y: 0.3, z: 0.6 };
    car.position.y = 0.15;
    car.color = [1.0, 0.8, 0.0, 1.0]; // Yellow
    scene.addObject(car);
  }

  // Create a visual representation of the sun
  const sun = scene.lights[0];
  const sunObj = new Object3D(-999);
  sunObj.arrays = baseCube.arrays;
  sunObj.bufferInfo = baseCube.bufferInfo;
  sunObj.vao = baseCube.vao;
  sunObj.position = sun.position; // Link to sun position
  sunObj.scale = { x: 3, y: 3, z: 3 };
  sunObj.color = [1.0, 1.0, 0.0, 1.0]; // Bright yellow
  scene.addObject(sunObj);
}

// Draw an object with its corresponding transformations
function drawObject(gl, programInfo, object, viewProjectionMatrix, fract) {
  // Update traffic light color based on state
  if (trafficLights.includes(object)) {
    object.color = object.state ? object.greenColor : object.redColor;
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

  // Calculate matrices for Phong lighting
  const worldMatrix = transforms;
  const worldViewProjectionMatrix = M4.multiply(viewProjectionMatrix, transforms);
  const worldInverseTranspose = M4.transpose(M4.inverse(worldMatrix));

  // Get light from scene (the sun)
  const sun = scene.lights[0];

  // Model uniforms for Phong shading
  let objectUniforms = {
    // Scene uniforms
    u_lightWorldPosition: sun.posArray,
    u_viewWorldPosition: scene.camera.posArray,
    u_ambientLight: sun.ambient,
    u_diffuseLight: sun.diffuse,
    u_specularLight: sun.specular,

    // Model uniforms
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
  const gui = new GUI();

  // Settings for the light (sun)
  const sun = scene.lights[0];
  const lightFolder = gui.addFolder('Sun Light');
  lightFolder.add(sun.position, 'x', -50, 50).name('Position X');
  lightFolder.add(sun.position, 'y', 0, 60).name('Position Y (Height)');
  lightFolder.add(sun.position, 'z', -50, 50).name('Position Z');
  lightFolder.open();
}

main();
