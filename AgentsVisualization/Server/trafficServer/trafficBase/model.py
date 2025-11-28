from mesa import Model
from mesa.space import MultiGrid
from trafficBase.agent import *
import json

class CityModel(Model):
    """
        Creates a model based on a city map.

        Args:
            N: Number of agents in the simulation
    """
    def __init__(self, N):
        super().__init__()
        
        # Load the map dictionary. The dictionary maps the characters in the map file to the corresponding agent.
        dataDictionary = json.load(open("city_files/mapDictionary.json"))

        self.traffic_lights = []

        # Load the map file. The map file is a text file where each character represents an agent.
        with open('city_files/2022_base.txt') as baseFile:
            lines = baseFile.readlines()
            self.width = len(lines[0])-1
            self.height = len(lines)

            self.grid = MultiGrid(self.width, self.height, torus = False) 

            # Goes through each character in the map file and creates the corresponding agent.
            for r, row in enumerate(lines):
                for c, col in enumerate(row):
                    if col in ["v", "^", ">", "<"]:
                        agent = Road(f"r_{r*self.width+c}", self, dataDictionary[col])
                        self.grid.place_agent(agent, (c, self.height - r - 1))

                    elif col in ["S", "s"]:
                        agent = Traffic_Light(f"tl_{r*self.width+c}", self, False if col == "S" else True, int(dataDictionary[col]))
                        self.grid.place_agent(agent, (c, self.height - r - 1))
                        self.traffic_lights.append(agent)

                    elif col == "#":
                        agent = Obstacle(f"ob_{r*self.width+c}", self)
                        self.grid.place_agent(agent, (c, self.height - r - 1))

                    elif col == "D":
                        agent = Destination(f"d_{r*self.width+c}", self)
                        self.grid.place_agent(agent, (c, self.height - r - 1))

        self.num_agents = N

        # Create cars and place them on random road positions
        road_positions = []
        for agents, pos in self.grid.coord_iter():
            for agent in agents:
                if isinstance(agent, Road):
                    road_positions.append(pos)

        # Select random road positions for cars
        import random
        random.shuffle(road_positions)
        for i in range(min(N, len(road_positions))):
            car = Car(f"car_{i}", self)
            self.grid.place_agent(car, road_positions[i])

        self.running = True

    def step(self):
        '''Advance the model by one step.'''
        for agent in self.agents:
            agent.step()