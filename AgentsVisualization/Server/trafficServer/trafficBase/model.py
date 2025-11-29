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
                        # Determine road direction for traffic light by checking neighbors
                        road_direction = self._get_road_direction_for_traffic_light(lines, r, c, dataDictionary)

                        # Place a road under the traffic light so cars can pass through
                        road_agent = Road(f"r_{r*self.width+c}", self, road_direction)
                        self.grid.place_agent(road_agent, (c, self.height - r - 1))

                        # Place traffic light on top of the road
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
            pos = road_positions[i]
            self.grid.place_agent(car, pos)
            # Initialize car's facing direction based on road direction
            cell_contents = self.grid.get_cell_list_contents([pos])
            for agent in cell_contents:
                if isinstance(agent, Road):
                    car.facing_direction = agent.direction
                    break

        self.running = True

    def _get_road_direction_for_traffic_light(self, lines, r, c, dataDictionary):
        """
        Determines the road direction for a traffic light by checking neighboring cells.
        Returns: "Up", "Down", "Left", or "Right"
        """
        # Check all four neighbors to find road directions
        height = len(lines)
        width = len(lines[0]) - 1

        # Check left neighbor
        if c > 0 and lines[r][c-1] in ["v", "^", ">", "<"]:
            neighbor_dir = dataDictionary[lines[r][c-1]]
            # If left neighbor points right, this road should go right
            if neighbor_dir == "Right":
                return "Right"
            # If left neighbor points left, this road should go left
            if neighbor_dir == "Left":
                return "Left"

        # Check right neighbor
        if c < width - 1 and lines[r][c+1] in ["v", "^", ">", "<"]:
            neighbor_dir = dataDictionary[lines[r][c+1]]
            # If right neighbor points left, this road should go left
            if neighbor_dir == "Left":
                return "Left"
            # If right neighbor points right, this road should go right
            if neighbor_dir == "Right":
                return "Right"

        # Check top neighbor (r-1 because text file is top-down)
        if r > 0 and lines[r-1][c] in ["v", "^", ">", "<"]:
            neighbor_dir = dataDictionary[lines[r-1][c]]
            # If top neighbor points down, this road should go down
            if neighbor_dir == "Down":
                return "Down"
            # If top neighbor points up, this road should go up
            if neighbor_dir == "Up":
                return "Up"

        # Check bottom neighbor
        if r < height - 1 and lines[r+1][c] in ["v", "^", ">", "<"]:
            neighbor_dir = dataDictionary[lines[r+1][c]]
            # If bottom neighbor points up, this road should go up
            if neighbor_dir == "Up":
                return "Up"
            # If bottom neighbor points down, this road should go down
            if neighbor_dir == "Down":
                return "Down"

        # Default to "Right" if no neighbors found
        return "Right"

    def step(self):
        '''Advance the model by one step.'''
        for agent in self.agents:
            agent.step()
