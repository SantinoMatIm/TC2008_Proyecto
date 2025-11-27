from mesa import Agent

class Car(Agent):
    """
    Agent that moves using a subsumption architecture.
    Attributes:
        unique_id: Agent's ID 
        destination: Target destination position (if assigned)
    """
    def __init__(self, unique_id, model):
        """
        Creates a new car agent.
        Args:
            unique_id: The agent's ID
            model: Model reference for the agent
        """
        super().__init__(model)
        self.unique_id = unique_id
        self.destination = None  # Will be set if car has a destination
        self.facing_direction = None  # Direction the car is facing: "Up", "Down", "Left", "Right"
    
    def get_road_direction(self, position):
        """
        Gets the direction of the road at a given position.
        Returns: "Up", "Down", "Left", "Right", or None
        """
        cell_contents = self.model.grid.get_cell_list_contents([position])
        for agent in cell_contents:
            if isinstance(agent, Road):
                return agent.direction
        return None
    
    def get_traffic_light_state(self, position):
        """
        Gets the state of the traffic light at a given position.
        Returns: True (green), False (red), or None (no traffic light)
        """
        cell_contents = self.model.grid.get_cell_list_contents([position])
        for agent in cell_contents:
            if isinstance(agent, Traffic_Light):
                return agent.state
        return None
    
    def get_direction_vector(self, direction):
        """
        Converts direction string to coordinate offset.
        Returns: (dx, dy) tuple
        """
        direction_map = {
            "Up": (0, 1),
            "Down": (0, -1),
            "Left": (-1, 0),
            "Right": (1, 0)
        }
        return direction_map.get(direction, (0, 0))
    
    def get_position_in_direction(self, position, direction):
        """
        Gets the position in a given direction from a position.
        """
        dx, dy = self.get_direction_vector(direction)
        return (position[0] + dx, position[1] + dy)
    
    def has_car_nearby(self, position, min_distance=1):
        """
        Checks if there's a car within min_distance cells from the given position.
        This creates a larger "hitbox" to prevent cars from being too close.
        """
        # Check the target position and adjacent cells (orthogonal only)
        check_positions = [position]
        check_positions.extend([
            (position[0] + 1, position[1]),  # Right
            (position[0] - 1, position[1]),  # Left
            (position[0], position[1] + 1),  # Up
            (position[0], position[1] - 1),   # Down
        ])
        
        for check_pos in check_positions:
            # Check if position is within grid bounds
            if (0 <= check_pos[0] < self.model.grid.width and 
                0 <= check_pos[1] < self.model.grid.height):
                cell_contents = self.model.grid.get_cell_list_contents([check_pos])
                # Check for other cars (excluding self)
                for agent in cell_contents:
                    if isinstance(agent, Car) and agent.unique_id != self.unique_id:
                        return True
        return False
    
    def is_position_safe(self, position):
        """
        Checks if a position is safe to move to (no obstacles, no cars nearby, has road).
        Returns: True if safe, False otherwise.
        """
        # Check if position is within grid bounds
        if not (0 <= position[0] < self.model.grid.width and 
                0 <= position[1] < self.model.grid.height):
            return False
        
        cell_contents = self.model.grid.get_cell_list_contents([position])
        
        # Check for obstacles - never move into obstacles
        has_obstacle = any(isinstance(agent, Obstacle) for agent in cell_contents)
        if has_obstacle:
            return False
        
        # Check for other cars with larger hitbox - never move if car nearby
        if self.has_car_nearby(position, min_distance=1):
            return False
        
        # Check if there's a road - can only move on roads
        has_road = any(isinstance(agent, Road) for agent in cell_contents)
        if not has_road:
            return False
        
        return True
    
    def can_turn(self, new_direction):
        """
        Checks if the car can turn to a new direction.
        A turn is only allowed if the road in that direction exists and is safe.
        """
        next_pos = self.get_position_in_direction(self.pos, new_direction)
        return self.is_position_safe(next_pos)
    
    # SUBSumption Architecture - Level 0: Avoid Collisions (Highest Priority)
    def level_0_avoid_collisions(self):
        """
        Level 0: Avoid collisions with other cars and obstacles.
        Enforces strictly real-world lane following:
        - The car ONLY moves in the direction of the road under it.
        - No lateral sidesteps; turns happen implicitly when the road turns.
        Returns: List with the next forward position if safe, or empty list if it must stop.
        """
        safe_positions = []

        # Always align the car's facing direction with the road under it
        current_road_dir = self.get_road_direction(self.pos)
        if current_road_dir is None:
            return []  # Not on a road, do not move
        self.facing_direction = current_road_dir

        # Compute the next cell strictly along the road direction
        forward_pos = self.get_position_in_direction(self.pos, current_road_dir)

        # If that position is safe, we move; otherwise, we stop (no lateral moves)
        if self.is_position_safe(forward_pos):
            safe_positions.append(forward_pos)

        return safe_positions
    
    # SUBSumption Architecture - Level 1: Respect Traffic Lights
    def level_1_respect_traffic_lights(self, safe_positions):
        """
        Level 1: Filter positions based on traffic light states.
        Returns: List of positions where traffic lights are green or no traffic light exists.
        """
        valid_positions = []
        
        for position in safe_positions:
            # Check traffic light at destination
            traffic_light_state = self.get_traffic_light_state(position)
            
            # If no traffic light or green light, position is valid
            if traffic_light_state is None or traffic_light_state:  # None or True (green)
                valid_positions.append(position)
            # If red light, check if we're already at the intersection
            elif traffic_light_state is False:  # Red light
                # Don't move into red light positions
                continue
        
        return valid_positions if valid_positions else safe_positions  # If all blocked, return safe positions (will stop)
    
    # SUBSumption Architecture - Level 2: Follow Road Direction
    def level_2_follow_road_direction(self, valid_positions):
        """
        Level 2: Follow the road direction strictly.
        Since we already filtered to only valid road direction in level 0,
        this just returns the valid positions (should be only one).
        Returns: List of positions following road direction.
        """
        if not valid_positions:
            return []
        
        # At this point, valid_positions should only contain the position
        # in the direction of the current road (no diagonals allowed)
        return valid_positions
    
    # SUBSumption Architecture - Level 3: Move Toward Destination
    def level_3_move_toward_destination(self, preferred_positions):
        """
        Level 3: If destination exists, prefer moves toward destination.
        Returns: Best position to move toward destination, or preferred positions.
        """
        if not preferred_positions:
            return None
        
        # If no destination assigned, return first preferred position
        if self.destination is None:
            # Try to find a destination if we don't have one
            destinations = []
            for agents, pos in self.model.grid.coord_iter():
                for agent in agents:
                    if isinstance(agent, Destination):
                        destinations.append(pos)
            
            if destinations:
                # Assign closest destination
                import math
                min_dist = float('inf')
                closest_dest = None
                for dest in destinations:
                    dist = math.sqrt((dest[0] - self.pos[0])**2 + (dest[1] - self.pos[1])**2)
                    if dist < min_dist:
                        min_dist = dist
                        closest_dest = dest
                self.destination = closest_dest
        
        if self.destination is None:
            return preferred_positions[0] if preferred_positions else None
        
        # Find position that moves closest to destination
        import math
        best_pos = preferred_positions[0]
        min_dist = float('inf')
        
        for pos in preferred_positions:
            dist_to_dest = math.sqrt((self.destination[0] - pos[0])**2 + 
                                    (self.destination[1] - pos[1])**2)
            if dist_to_dest < min_dist:
                min_dist = dist_to_dest
                best_pos = pos
        
        return best_pos
    
    def move(self):
        """
        Moves the car using subsumption architecture.
        Each level can inhibit higher levels.
        """
        # Level 0: Avoid collisions (highest priority)
        safe_positions = self.level_0_avoid_collisions()
        
        if not safe_positions:
            return  # Cannot move safely, stay in place
        
        # Level 1: Respect traffic lights
        valid_positions = self.level_1_respect_traffic_lights(safe_positions)
        
        if not valid_positions:
            return  # Blocked by traffic lights, stay in place
        
        # Level 2: Follow road direction
        preferred_positions = self.level_2_follow_road_direction(valid_positions)
        
        if not preferred_positions:
            return  # No preferred moves, stay in place
        
        # Level 3: Move toward destination
        target_position = self.level_3_move_toward_destination(preferred_positions)
        
        if target_position:
            # Update facing direction based on movement
            dx = target_position[0] - self.pos[0]
            dy = target_position[1] - self.pos[1]
            
            # Determine new facing direction based on movement
            if dx > 0:
                self.facing_direction = "Right"
            elif dx < 0:
                self.facing_direction = "Left"
            elif dy > 0:
                self.facing_direction = "Up"
            elif dy < 0:
                self.facing_direction = "Down"
            
            self.model.grid.move_agent(self, target_position)
            
            # Check if we reached destination
            if self.destination and self.pos == self.destination:
                self.destination = None  # Clear destination, will find new one
    
    def step(self):
        """ 
        Executes one step of the car's behavior using subsumption architecture.
        """
        self.move()

class Traffic_Light(Agent):
    """
    Traffic light. Where the traffic lights are in the grid.
    """
    def __init__(self, unique_id, model, state = False, timeToChange = 10):
        """
        Creates a new Traffic light.
        Args:
            unique_id: The agent's ID
            model: Model reference for the agent
            state: Whether the traffic light is green or red
            timeToChange: After how many step should the traffic light change color 
        """
        super().__init__(model)
        self.unique_id = unique_id
        self.state = state
        self.timeToChange = timeToChange

    def step(self):
        """ 
        To change the state (green or red) of the traffic light in case you consider the time to change of each traffic light.
        """
        if self.model.steps % self.timeToChange == 0:
            self.state = not self.state

class Destination(Agent):
    """
    Destination agent. Where each car should go.
    """
    def __init__(self, unique_id, model):
        super().__init__(model)
        self.unique_id = unique_id

    def step(self):
        pass

class Obstacle(Agent):
    """
    Obstacle agent. Just to add obstacles to the grid.
    """
    def __init__(self, unique_id, model):
        super().__init__(model)
        self.unique_id = unique_id

    def step(self):
        pass

class Road(Agent):
    """
    Road agent. Determines where the cars can move, and in which direction.
    """
    def __init__(self, unique_id, model, direction= "Left"):
        """
        Creates a new road.
        Args:
            unique_id: The agent's ID
            model: Model reference for the agent
            direction: Direction where the cars can move
        """
        super().__init__(model)
        self.unique_id = unique_id
        self.direction = direction

    def step(self):
        pass
