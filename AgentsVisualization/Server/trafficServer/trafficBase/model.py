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
    def __init__(self, N, spawn_interval=None, model_params=None, **kwargs):
        super().__init__()
        
        # Si spawn_interval no se pasó como argumento, intentar obtenerlo de kwargs
        # (SolaraViz puede pasar parámetros de diferentes maneras)
        if spawn_interval is None:
            spawn_interval = kwargs.get('spawn_interval', 10)
        
        # Asegurar que spawn_interval sea un entero válido
        spawn_interval = max(1, int(spawn_interval))
        
        # Guardar referencia a model_params para actualización dinámica (usado por Solara)
        self.model_params = model_params
        
        # Log para debug: ver qué parámetros está recibiendo el modelo
        print(f"[MODEL-INIT] Creating CityModel with N={N}, spawn_interval={spawn_interval}, kwargs={kwargs}")

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
                        # Determine road direction for destination by checking neighbors
                        road_direction = self._get_road_direction_for_traffic_light(lines, r, c, dataDictionary)

                        # Place a road under the destination so cars can reach it
                        road_agent = Road(f"r_{r*self.width+c}", self, road_direction)
                        self.grid.place_agent(road_agent, (c, self.height - r - 1))

                        # Place destination on top of the road
                        agent = Destination(f"d_{r*self.width+c}", self)
                        self.grid.place_agent(agent, (c, self.height - r - 1))

        self.num_agents = N
        self.steps = 0
        # Intervalo de spawn configurable (usado por Solara y por la API REST)
        self.spawn_interval = 10  # Spawn cars every 10 steps
        self.next_car_id = 0
        self.cars_can_move = False  # Cars won't move until first spawn
        self.consecutive_failed_spawns = 0  # Para detectar cuando ya no se pueden agregar coches
        
        # Find corner positions with roads
        self.corner_positions = self._find_corner_positions()
        
        # Find all destination positions
        self.destination_positions = []
        for agents, pos in self.grid.coord_iter():
            for agent in agents:
                if isinstance(agent, Destination):
                    self.destination_positions.append(pos)

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

    def _find_corner_positions(self):
        """
        Finds road positions at the four corners of the map.
        Returns: List of 4 positions [(x1, y1), (x2, y2), (x3, y3), (x4, y4)]
        """
        import random
        corners = []
        
        # Find positions near each corner that have roads
        # Corner 1: Top-left (near 0, height-1)
        # Corner 2: Top-right (near width-1, height-1)
        # Corner 3: Bottom-left (near 0, 0)
        # Corner 4: Bottom-right (near width-1, 0)
        
        corner_targets = [
            (0, self.height - 1),  # Top-left
            (self.width - 1, self.height - 1),  # Top-right
            (0, 0),  # Bottom-left
            (self.width - 1, 0)  # Bottom-right
        ]
        
        for target_x, target_y in corner_targets:
            # Find the closest road position to this corner
            best_pos = None
            min_dist = float('inf')
            
            for agents, pos in self.grid.coord_iter():
                for agent in agents:
                    if isinstance(agent, Road):
                        dist = abs(pos[0] - target_x) + abs(pos[1] - target_y)
                        if dist < min_dist:
                            min_dist = dist
                            best_pos = pos
            
            if best_pos:
                corners.append(best_pos)
        
        return corners if len(corners) == 4 else []
    
    def spawn_cars_at_corners(self):
        """
        Spawns 4 cars at the four corners of the map.
        Each car gets assigned a random destination from the D positions.
        """
        import random
        
        if len(self.corner_positions) < 4:
            return 0
        
        if len(self.destination_positions) == 0:
            return 0
        
        spawned = 0
        for corner_pos in self.corner_positions:
            # Check if position is safe (no car already there)
            cell_contents = self.grid.get_cell_list_contents([corner_pos])
            has_car = any(isinstance(agent, Car) for agent in cell_contents)
            
            if not has_car:
                # Create new car
                car = Car(f"car_{self.next_car_id}", self)
                self.next_car_id += 1
                
                # Assign random destination
                destination = random.choice(self.destination_positions)
                car.destination = destination
                
                # Place car at corner
                self.grid.place_agent(car, corner_pos)
                spawned += 1
                
                # Initialize car's facing direction based on road direction
                # (buscar de nuevo el contenido de la celda ya con el coche colocado)
                new_cell_contents = self.grid.get_cell_list_contents([corner_pos])
                for agent in new_cell_contents:
                    if isinstance(agent, Road):
                        car.facing_direction = agent.direction
                        break

        return spawned
    
    def set_spawn_interval(self, interval):
        """Sets the interval for spawning new cars."""
        self.spawn_interval = max(1, int(interval))
    
    def step(self):
        '''Advance the model by one step.'''
        # DESHABILITADO para debug: spawn_interval está hardcodeado a 100
        # Si tenemos model_params (desde Solara), verificar si cambió spawn_interval
        # if self.model_params is not None and "spawn_interval" in self.model_params:
        #     try:
        #         slider = self.model_params["spawn_interval"]
        #         # Intentar diferentes formas de acceder al valor
        #         if hasattr(slider, 'value'):
        #             new_interval = slider.value
        #         elif hasattr(slider, 'get_value'):
        #             new_interval = slider.get_value()
        #         elif callable(slider):
        #             new_interval = slider()
        #         else:
        #             new_interval = slider
        #         
        #         # Convertir a int si es necesario
        #         new_interval = int(new_interval)
        #         
        #         if new_interval != self.spawn_interval:
        #             print(f"[MODEL-STEP] Updating spawn_interval from {self.spawn_interval} to {new_interval}")
        #             self.set_spawn_interval(new_interval)
        #         else:
        #             # Log cada 10 steps para verificar que está funcionando
        #             if self.steps % 10 == 0:
        #                 print(f"[MODEL-STEP] Current spawn_interval: {self.spawn_interval}, slider value: {new_interval}")
        #     except Exception as e:
        #         # Log el error para debug
        #         if self.steps % 10 == 0:
        #             print(f"[MODEL-STEP] Error accessing slider value: {e}")
        
        self.steps += 1
        
        # Spawn cars at corners if it's time
        if self.steps % self.spawn_interval == 0:
            print(f"[MODEL-STEP] Step {self.steps}: Attempting to spawn cars (spawn_interval={self.spawn_interval})")
            spawned = self.spawn_cars_at_corners()
            print(f"[MODEL-STEP] Step {self.steps}: Spawned {spawned} cars")

            if spawned > 0:
                self.consecutive_failed_spawns = 0
                # After first successful spawn, allow all cars to move
                if not self.cars_can_move:
                    self.cars_can_move = True
            else:
                self.consecutive_failed_spawns += 1

        # Only move cars if they're allowed to
        for agent in list(self.agents):
            if isinstance(agent, Car):
                if self.cars_can_move:
                    agent.step()
            else:
                agent.step()

        # Eliminar coches que llegaron a su destino
        to_remove = [a for a in self.agents if isinstance(a, Car) and getattr(a, "to_be_removed", False)]
        for car in to_remove:
            print(f"[MODEL-CLEANUP] Removing {car.unique_id} from simulation")
            # Remove from grid if still there
            if car.pos is not None:
                self.grid.remove_agent(car)
            # Remove from agent dict (Mesa uses dict, not list)
            if car.unique_id in self._agents:
                del self._agents[car.unique_id]

        # Si consecutivamente no se pueden agregar coches, detener la simulación
        # (se asume congestión o saturación)
        if self.consecutive_failed_spawns >= 5:
            self.running = False
