# TC2008B. Sistemas Multiagentes y Gráficas Computacionales
# Python flask server to interact with WebGL.
# Octavio Navarro. October 2023

from flask import Flask, request, jsonify
from flask_cors import CORS, cross_origin
from trafficBase.model import CityModel
from trafficBase.agent import Road, Traffic_Light, Obstacle, Destination, Car
import os

# Size of the board:
number_agents = 10
cityModel = None
currentStep = 0
spawn_interval = 10  # Default spawn interval

# This application will be used to interact with WebGL
app = Flask("Traffic example")
cors = CORS(app, origins=['http://localhost'])

# This route will be used to send the parameters of the simulation to the server.
@app.route('/init', methods=['GET', 'POST'])
@cross_origin()
def initModel():
    global currentStep, cityModel, number_agents, spawn_interval

    if request.method == 'POST':
        try:
            number_agents = int(request.json.get('NAgents', 10))
            spawn_interval = int(request.json.get('SpawnInterval', 10))
            currentStep = 0
        except Exception as e:
            print(e)
            return jsonify({"message": "Error initializing the model"}), 500

    print(f"Model parameters: {number_agents} agents, spawn interval: {spawn_interval}")

    # Create the model using the parameters sent by the application
    cityModel = CityModel(number_agents)
    cityModel.set_spawn_interval(spawn_interval)

    # Return a message saying that the model was created successfully
    return jsonify({"message": f"Parameters received, model initiated.\nAgents: {number_agents}, Spawn Interval: {spawn_interval}"})


# This route will be used to get the positions of the traffic lights
@app.route('/getTrafficLights', methods=['GET'])
@cross_origin()
def getTrafficLights():
    global cityModel

    if request.method == 'GET':
        try:
            # Get all traffic lights from the grid
            trafficLightPositions = []
            for agents, (x, z) in cityModel.grid.coord_iter():
                for agent in agents:
                    if isinstance(agent, Traffic_Light):
                        trafficLightPositions.append({
                            "id": str(agent.unique_id),
                            "x": x,
                            "y": 1,
                            "z": z,
                            "state": agent.state  # True = green, False = red
                        })

            return jsonify({'positions': trafficLightPositions})
        except Exception as e:
            print(e)
            return jsonify({"message": "Error with traffic light positions"}), 500


# This route will be used to get the positions of the obstacles (buildings)
@app.route('/getObstacles', methods=['GET'])
@cross_origin()
def getObstacles():
    global cityModel

    if request.method == 'GET':
        try:
            # Get all obstacles from the grid
            obstaclePositions = []
            for agents, (x, z) in cityModel.grid.coord_iter():
                for agent in agents:
                    if isinstance(agent, Obstacle):
                        obstaclePositions.append({
                            "id": str(agent.unique_id),
                            "x": x,
                            "y": 1,
                            "z": z
                        })

            return jsonify({'positions': obstaclePositions})
        except Exception as e:
            print(e)
            return jsonify({"message": "Error with obstacle positions"}), 500


# This route will be used to get the positions of the destinations
@app.route('/getDestinations', methods=['GET'])
@cross_origin()
def getDestinations():
    global cityModel

    if request.method == 'GET':
        try:
            # Get all destinations from the grid
            destinationPositions = []
            for agents, (x, z) in cityModel.grid.coord_iter():
                for agent in agents:
                    if isinstance(agent, Destination):
                        destinationPositions.append({
                            "id": str(agent.unique_id),
                            "x": x,
                            "y": 1,
                            "z": z
                        })

            return jsonify({'positions': destinationPositions})
        except Exception as e:
            print(e)
            return jsonify({"message": "Error with destination positions"}), 500


# This route will be used to get the positions and directions of the roads
@app.route('/getRoads', methods=['GET'])
@cross_origin()
def getRoads():
    global cityModel

    if request.method == 'GET':
        try:
            # Get all roads from the grid
            roadPositions = []
            for agents, (x, z) in cityModel.grid.coord_iter():
                for agent in agents:
                    if isinstance(agent, Road):
                        roadPositions.append({
                            "id": str(agent.unique_id),
                            "x": x,
                            "y": 0,
                            "z": z,
                            "direction": agent.direction
                        })

            return jsonify({'positions': roadPositions})
        except Exception as e:
            print(e)
            return jsonify({"message": "Error with road positions"}), 500


# This route will be used to get the positions of the cars
@app.route('/getCars', methods=['GET'])
@cross_origin()
def getCars():
    global cityModel

    if request.method == 'GET':
        try:
            # Get all cars from the grid
            carPositions = []
            for agents, (x, z) in cityModel.grid.coord_iter():
                for agent in agents:
                    if isinstance(agent, Car):
                        carPositions.append({
                            "id": str(agent.unique_id),
                            "x": x,
                            "y": 1,
                            "z": z
                        })

            return jsonify({'positions': carPositions})
        except Exception as e:
            print(e)
            return jsonify({"message": "Error with car positions"}), 500


# This route will be used to update the model
@app.route('/update', methods=['GET'])
@cross_origin()
def updateModel():
    global currentStep, cityModel
    if request.method == 'GET':
        try:
            # Only update the model if it is still running
            if cityModel.running:
                cityModel.step()
                currentStep += 1
            return jsonify({
                'message': f'Model updated to step {currentStep}.',
                'currentStep': currentStep,
                'running': cityModel.running
            })
        except Exception as e:
            print(e)
            return jsonify({"message": "Error during step."}), 500


# This route will be used to set the spawn interval
@app.route('/setSpawnInterval', methods=['POST'])
@cross_origin()
def setSpawnInterval():
    global cityModel, spawn_interval
    if request.method == 'POST':
        try:
            spawn_interval = int(request.json.get('interval', 10))
            if cityModel:
                cityModel.set_spawn_interval(spawn_interval)
            return jsonify({'message': f'Spawn interval set to {spawn_interval} steps.', 'interval': spawn_interval})
        except Exception as e:
            print(e)
            return jsonify({"message": "Error setting spawn interval."}), 500


# This route will be used to get simulation metrics
@app.route('/getMetrics', methods=['GET'])
@cross_origin()
def getMetrics():
    global cityModel
    if request.method == 'GET':
        try:
            if cityModel:
                return jsonify({
                    'totalCarsSpawned': cityModel.total_cars_spawned,
                    'carsReachedDestination': cityModel.cars_reached_destination,
                    'currentCarsInSimulation': cityModel.current_cars_in_simulation,
                    'currentStep': currentStep
                })
            else:
                return jsonify({"message": "Model not initialized"}), 400
        except Exception as e:
            print(e)
            return jsonify({"message": "Error getting metrics"}), 500


if __name__ == '__main__':
    # Run the flask server in port 8585
    app.run(host="localhost", port=8585, debug=True)