/*
 * Functions to connect to traffic API to get the city elements
 */


'use strict';

import { Object3D } from '../libs/object3d';

// Define the agent server URI
const agent_server_uri = "http://localhost:8585/";

// Initialize arrays to store different city elements
const cars = [];
const obstacles = [];
const trafficLights = [];
const destinations = [];
const roads = [];

// Callback function to handle new cars (set from visualization)
let onNewCarsCallback = null;

function setOnNewCarsCallback(callback) {
    onNewCarsCallback = callback;
}

// Define the data object
const initData = {
    NAgents: 5,
    SpawnInterval: 10
};


/* FUNCTIONS FOR THE INTERACTION WITH THE MESA SERVER */

/*
 * Initializes the traffic model by sending a POST request to the agent server.
 */
async function initTrafficModel() {
    try {
        // Send a POST request to the agent server to initialize the model
        let response = await fetch(agent_server_uri + "init", {
            method: 'POST',
            headers: { 'Content-Type':'application/json' },
            body: JSON.stringify(initData)
        });

        // Check if the response was successful
        if (response.ok) {
            // Parse the response as JSON and log the message
            let result = await response.json();
            console.log(result.message);
        }

    } catch (error) {
        // Log any errors that occur during the request
        console.log(error);
    }
}

/*
 * Retrieves the current positions of all cars from the server.
 */
async function getCars() {
    try {
        // Send a GET request to the server to retrieve the car positions
        let response = await fetch(agent_server_uri + "getCars");

        // Check if the response was successful
        if (response.ok) {
            // Parse the response as JSON
            let result = await response.json();

            // Check if the cars array is empty
            if (cars.length == 0) {
                // Create new cars and add them to the cars array
                for (const car of result.positions) {
                    const newCar = new Object3D(car.id, [car.x, car.y, car.z]);
                    newCar['oldPosArray'] = newCar.posArray;
                    cars.push(newCar);
                }
            } else {
                // Update the positions of existing cars and add new ones
                const existingCarIds = new Set(cars.map(c => c.id));
                const newCars = [];
                
                for (const car of result.positions) {
                    const current_car = cars.find((object3d) => object3d.id == car.id);

                    // Check if the car exists in the cars array
                    if(current_car != undefined){
                        // Update the car's position
                        current_car.oldPosArray = current_car.posArray;
                        current_car.position = {x: car.x, y: car.y, z: car.z};
                    } else {
                        // This is a new car that was spawned, add it to the array
                        const newCar = new Object3D(car.id, [car.x, car.y, car.z]);
                        newCar['oldPosArray'] = newCar.posArray;
                        cars.push(newCar);
                        newCars.push(newCar);
                    }
                }
                
                // Notify about new cars if callback is set
                if (newCars.length > 0 && onNewCarsCallback) {
                    onNewCarsCallback(newCars);
                }
            }
        }

    } catch (error) {
        // Log any errors that occur during the request
        console.log(error);
    }
}

/*
 * Retrieves the current positions of all obstacles from the server.
 */
async function getObstacles() {
    try {
        // Send a GET request to the server to retrieve the obstacle positions
        let response = await fetch(agent_server_uri + "getObstacles");

        // Check if the response was successful
        if (response.ok) {
            // Parse the response as JSON
            let result = await response.json();

            // Create new obstacles and add them to the obstacles array
            for (const obstacle of result.positions) {
                const newObstacle = new Object3D(obstacle.id, [obstacle.x, obstacle.y, obstacle.z]);
                obstacles.push(newObstacle);
            }
        }

    } catch (error) {
        // Log any errors that occur during the request
        console.log(error);
    }
}

/*
 * Retrieves the current positions and states of all traffic lights from the server.
 */
async function getTrafficLights() {
    try {
        // Send a GET request to the server to retrieve the traffic light positions
        let response = await fetch(agent_server_uri + "getTrafficLights");

        // Check if the response was successful
        if (response.ok) {
            // Parse the response as JSON
            let result = await response.json();

            // Check if the trafficLights array is empty
            if (trafficLights.length == 0) {
                // Create new traffic lights and add them to the array
                for (const light of result.positions) {
                    const newLight = new Object3D(light.id, [light.x, light.y, light.z]);
                    newLight.state = light.state;  // Store the state
                    trafficLights.push(newLight);
                }
            } else {
                // Update the state of existing traffic lights
                for (const light of result.positions) {
                    const current_light = trafficLights.find((object3d) => object3d.id == light.id);

                    // Check if the traffic light exists in the array
                    if(current_light != undefined){
                        current_light.state = light.state;
                    }
                }
            }
        }

    } catch (error) {
        // Log any errors that occur during the request
        console.log(error);
    }
}

/*
 * Retrieves the current positions of all destinations from the server.
 */
async function getDestinations() {
    try {
        // Send a GET request to the server to retrieve the destination positions
        let response = await fetch(agent_server_uri + "getDestinations");

        // Check if the response was successful
        if (response.ok) {
            // Parse the response as JSON
            let result = await response.json();

            // Create new destinations and add them to the destinations array
            for (const dest of result.positions) {
                const newDest = new Object3D(dest.id, [dest.x, dest.y, dest.z]);
                destinations.push(newDest);
            }
        }

    } catch (error) {
        // Log any errors that occur during the request
        console.log(error);
    }
}

/*
 * Retrieves the positions and directions of all roads from the server.
 */
async function getRoads() {
    try {
        // Send a GET request to the server to retrieve the road positions
        let response = await fetch(agent_server_uri + "getRoads");

        // Check if the response was successful
        if (response.ok) {
            // Parse the response as JSON
            let result = await response.json();

            // Create new roads and add them to the roads array
            for (const road of result.positions) {
                const newRoad = new Object3D(road.id, [road.x, road.y, road.z]);
                newRoad.direction = road.direction;  // Store the direction
                roads.push(newRoad);
            }
        }

    } catch (error) {
        // Log any errors that occur during the request
        console.log(error);
    }
}

/*
 * Updates the simulation by sending a request to the server.
 */
async function update() {
    try {
        // Send a request to the server to update the simulation
        let response = await fetch(agent_server_uri + "update");

        // Check if the response was successful
        if (response.ok) {
            // Retrieve the updated positions
            await getCars();
            await getTrafficLights();  // Update traffic light states
        }

    } catch (error) {
        // Log any errors that occur during the request
        console.log(error);
    }
}

/*
 * Sets the spawn interval for new cars.
 */
async function setSpawnInterval(interval) {
    try {
        // Send a POST request to the server to set the spawn interval
        let response = await fetch(agent_server_uri + "setSpawnInterval", {
            method: 'POST',
            headers: { 'Content-Type':'application/json' },
            body: JSON.stringify({ interval: interval })
        });

        // Check if the response was successful
        if (response.ok) {
            let result = await response.json();
            console.log(result.message);
        }

    } catch (error) {
        // Log any errors that occur during the request
        console.log(error);
    }
}

export {
    cars,
    obstacles,
    trafficLights,
    destinations,
    roads,
    initTrafficModel,
    update,
    getCars,
    getObstacles,
    getTrafficLights,
    getDestinations,
    getRoads,
    setSpawnInterval,
    initData,
    setOnNewCarsCallback
};
