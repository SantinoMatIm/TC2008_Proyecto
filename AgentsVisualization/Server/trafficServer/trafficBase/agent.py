from mesa import Agent
from collections import deque

class Car(Agent):
    """
    Car agent that uses BFS pathfinding to reach its destination.
    """
    def __init__(self, unique_id, model):
        super().__init__(model)
        self.unique_id = unique_id
        self.destination = None
        self.facing_direction = None
        self.path_to_destination = None
        self.path_calculation_failures = 0  # Track failed path calculations
        self.wait_time = 0  # Track how many steps the car has been waiting
        self.last_position = None  # Track last position to detect if stuck
    
    def get_road_direction(self, position):
        """Gets the direction of the road at a given position."""
        cell_contents = self.model.grid.get_cell_list_contents([position])
        for agent in cell_contents:
            if isinstance(agent, Road):
                return agent.direction
        return None
    
    def get_traffic_light_state(self, position):
        """Gets the state of the traffic light at a given position."""
        cell_contents = self.model.grid.get_cell_list_contents([position])
        for agent in cell_contents:
            if isinstance(agent, Traffic_Light):
                return agent.state
        return None
    
    def has_obstacle(self, position):
        """Checks if position has an obstacle."""
        if not (0 <= position[0] < self.model.grid.width and 
                0 <= position[1] < self.model.grid.height):
            return True
        cell_contents = self.model.grid.get_cell_list_contents([position])
        return any(isinstance(agent, Obstacle) for agent in cell_contents)
    
    def has_car(self, position):
        """Checks if position has another car."""
        if not (0 <= position[0] < self.model.grid.width and 
                0 <= position[1] < self.model.grid.height):
            return False
        cell_contents = self.model.grid.get_cell_list_contents([position])
        for agent in cell_contents:
            if isinstance(agent, Car) and agent.unique_id != self.unique_id:
                return True
        return False
    
    def is_valid_move(self, from_pos, to_pos, avoid_cars=False):
        """
        Checks if moving from from_pos to to_pos is valid.
        A move is valid if:
        1. to_pos has a road
        2. to_pos doesn't have an obstacle
        3. The road direction at to_pos allows us to continue (not opposite to our movement)
        4. (optional) to_pos doesn't have another car if avoid_cars=True
        5. If to_pos has a Destination, it must be THIS car's destination
        """
        # Check bounds
        if not (0 <= to_pos[0] < self.model.grid.width and
                0 <= to_pos[1] < self.model.grid.height):
            return False

        # Check obstacle
        if self.has_obstacle(to_pos):
            return False

        # Check if position has a Destination agent
        # Only allow entry if it's THIS car's destination
        cell_contents = self.model.grid.get_cell_list_contents([to_pos])
        for agent in cell_contents:
            if isinstance(agent, Destination):
                # Only allow if this is our destination
                if self.destination != to_pos:
                    return False  # Not our destination, treat as blocked
                # If it IS our destination, allow the move (continue checking other conditions)

        # Optionally check for other cars (when recalculating to avoid traffic)
        if avoid_cars and self.has_car(to_pos):
            return False

        # Check road exists
        to_road_dir = self.get_road_direction(to_pos)
        if to_road_dir is None:
            return False

        # Calculate movement direction
        dx = to_pos[0] - from_pos[0]
        dy = to_pos[1] - from_pos[1]

        move_dir = None
        if dx == 1:
            move_dir = "Right"
        elif dx == -1:
            move_dir = "Left"
        elif dy == 1:
            move_dir = "Up"
        elif dy == -1:
            move_dir = "Down"
        # For diagonal movements
        elif dx != 0 and dy != 0:
            # Diagonal is valid, will check road direction separately
            move_dir = "Diagonal"

        if move_dir is None:
            return False

        # Can't enter a road if we'd be going against traffic
        # (our movement direction is opposite to the road direction)
        opposites = {"Up": "Down", "Down": "Up", "Left": "Right", "Right": "Left"}
        if move_dir != "Diagonal" and opposites.get(move_dir) == to_road_dir:
            return False

        # CRITICAL: Check if making a turn (changing road direction)
        # If turning, must be in the correct lane (side) for that turn
        from_road_dir = self.get_road_direction(from_pos)
        if from_road_dir and to_road_dir and from_road_dir != to_road_dir and move_dir != "Diagonal":
            # This is a turn (road direction changes)
            # Verify car is in correct lane for this turn
            if not self._is_in_correct_lane_for_turn(from_pos, to_pos, from_road_dir, to_road_dir, move_dir):
                return False  # Not in correct lane for this turn

        return True

    def _is_in_correct_lane_for_turn(self, from_pos, to_pos, from_dir, to_dir, move_dir):
        """
        Checks if the car is in the correct lane to make a turn.
        For example, to turn right, you should be in the right lane.
        """
        # Define which adjacent position should have traffic going same direction
        # to confirm we're in the correct lane for the turn

        # Map: (from_direction, to_direction) -> required adjacent check
        # The idea: if turning, check if there's a parallel lane and if we're on the correct side

        # For right turns (in direction of travel):
        # Going Right -> Up: should be in upper lane (check if lane below has same direction)
        # Going Right -> Down: should be in lower lane (check if lane above has same direction)
        # Going Up -> Right: should be in right lane (check if lane left has same direction)
        # Going Up -> Left: should be in left lane (check if lane right has same direction)
        # Going Down -> Right: should be in right lane (check if lane left has same direction)
        # Going Down -> Left: should be in left lane (check if lane right has same direction)
        # Going Left -> Up: should be in upper lane (check if lane below has same direction)
        # Going Left -> Down: should be in lower lane (check if lane above has same direction)

        turn_lane_checks = {
            ("Right", "Up"): (0, -1),     # Turning up from right: check lane below
            ("Right", "Down"): (0, 1),    # Turning down from right: check lane above
            ("Left", "Up"): (0, -1),      # Turning up from left: check lane below
            ("Left", "Down"): (0, 1),     # Turning down from left: check lane above
            ("Up", "Right"): (-1, 0),     # Turning right from up: check lane left
            ("Up", "Left"): (1, 0),       # Turning left from up: check lane right
            ("Down", "Right"): (-1, 0),   # Turning right from down: check lane left
            ("Down", "Left"): (1, 0),     # Turning left from down: check lane right
        }

        check_offset = turn_lane_checks.get((from_dir, to_dir))
        if not check_offset:
            # Not a recognized turn pattern, allow it
            return True

        # Check if there's a parallel lane
        parallel_pos = (from_pos[0] + check_offset[0], from_pos[1] + check_offset[1])

        # Check bounds
        if not (0 <= parallel_pos[0] < self.model.grid.width and
                0 <= parallel_pos[1] < self.model.grid.height):
            # No parallel lane (at edge), allow turn
            return True

        parallel_road_dir = self.get_road_direction(parallel_pos)

        # Logic: If there's a parallel lane with same direction on the "check side",
        # it means we're in the CORRECT lane for the turn.
        # If NO parallel lane exists on check side, we're in the WRONG lane.
        if parallel_road_dir == from_dir:
            # There IS a parallel lane with same direction on the check side
            # This means we're in the correct outer lane for this turn
            return True

        # No parallel lane with same direction on check side
        # This means we're in the inner lane (wrong for this turn)
        return False
    
    def get_neighbors(self, position, avoid_cars=False):
        """
        Gets all valid neighboring positions from current position.
        Returns list of (next_pos, road_direction) tuples.
        Includes diagonal movements for realistic lane changes (only forward diagonals).
        """
        neighbors = []

        # Get current road direction to determine forward direction
        current_road_dir = self.get_road_direction(position)

        # Straight movements (priority)
        straight_directions = [(0, 1), (0, -1), (1, 0), (-1, 0)]  # Up, Down, Right, Left
        for dx, dy in straight_directions:
            next_pos = (position[0] + dx, position[1] + dy)
            if self.is_valid_move(position, next_pos, avoid_cars=avoid_cars):
                road_dir = self.get_road_direction(next_pos)
                neighbors.append((next_pos, road_dir))

        # Diagonal movements (for lane changes while advancing forward only)
        # ONLY allow diagonals on straight roads, NOT at intersections
        if current_road_dir:
            # Map road direction to allowed diagonal movements (forward + lateral)
            forward_diagonals = {
                "Right": [(1, 1), (1, -1)],   # Right+Up, Right+Down
                "Left": [(-1, 1), (-1, -1)],  # Left+Up, Left+Down
                "Up": [(1, 1), (-1, 1)],      # Up+Right, Up+Left
                "Down": [(1, -1), (-1, -1)]   # Down+Right, Down+Left
            }

            diagonal_directions = forward_diagonals.get(current_road_dir, [])
            for dx, dy in diagonal_directions:
                next_pos = (position[0] + dx, position[1] + dy)

                # Check bounds first before accessing grid
                if not (0 <= next_pos[0] < self.model.grid.width and
                        0 <= next_pos[1] < self.model.grid.height):
                    continue  # Out of bounds, skip

                # Get destination road direction
                next_road_dir = self.get_road_direction(next_pos)

                # CRITICAL: Only allow diagonal if destination has SAME road direction
                # This prevents cutting corners at intersections
                # Diagonal moves are ONLY for lane changes on straight roads
                if next_road_dir != current_road_dir:
                    continue  # Skip this diagonal, it's a turn/intersection

                # CRITICAL: Cannot enter final destination diagonally
                # Must be directly in front of destination to enter
                if self.destination and next_pos == self.destination:
                    continue  # Skip diagonal to destination, must enter straight

                # Diagonal move is valid if:
                # 1. The diagonal position itself is valid
                # 2. The destination has the SAME road direction (same street, just different lane)
                # 3. At least one of the intermediate positions is valid (to ensure continuity)
                if self.is_valid_move(position, next_pos, avoid_cars=avoid_cars):
                    # Check if we can reach diagonal through intermediate steps
                    intermediate1 = (position[0] + dx, position[1])
                    intermediate2 = (position[0], position[1] + dy)

                    # At least one intermediate path should be valid
                    if (self.is_valid_move(position, intermediate1, avoid_cars=False) or
                        self.is_valid_move(position, intermediate2, avoid_cars=False)):
                        neighbors.append((next_pos, next_road_dir))

        return neighbors
    
    def bfs_to_destination(self, start, goal, avoid_cars=False):
        """
        BFS pathfinding from start to goal.
        Returns list of positions forming the path, or None if no path exists.
        If avoid_cars=True, treats current car positions as temporary obstacles.
        """
        if start == goal:
            return [start]

        queue = deque([(start, [start])])
        visited = {start}

        iterations = 0
        max_iterations = 1000  # Prevent infinite loops

        while queue and iterations < max_iterations:
            iterations += 1
            current_pos, path = queue.popleft()

            if current_pos == goal:
                return path

            # Get all valid neighbors
            neighbors = self.get_neighbors(current_pos, avoid_cars=avoid_cars)

            for next_pos, road_dir in neighbors:
                if next_pos in visited:
                    continue

                visited.add(next_pos)
                queue.append((next_pos, path + [next_pos]))
        return None
    
    def assign_new_destination(self):
        """Assigns a new reachable destination to the car."""
        import random
        destinations = []
        for agents, pos in self.model.grid.coord_iter():
            for agent in agents:
                if isinstance(agent, Destination):
                    destinations.append(pos)

        if not destinations:
            return

        # Try to find a reachable destination (exclude current destination)
        available_destinations = [dest for dest in destinations if dest != self.destination]
        if not available_destinations:
            available_destinations = destinations

        random.shuffle(available_destinations)
        for dest in available_destinations:
            test_path = self.bfs_to_destination(self.pos, dest)
            if test_path and len(test_path) > 1:
                self.destination = dest
                self.path_to_destination = None
                self.path_calculation_failures = 0
                # print(f"[NEW-DEST] {self.unique_id} assigned new reachable destination {self.destination}")
                return

        # If no reachable destination found, mark car for removal (grid will be cleaned by model)
        # print(f"[STUCK] {self.unique_id} cannot reach any destination, removing from simulation")
        self.to_be_removed = True

    def calculate_path(self):
        """Calculate or recalculate path to destination."""
        if self.destination is None:
            return

        if self.path_to_destination is None or len(self.path_to_destination) == 0:
            path = self.bfs_to_destination(self.pos, self.destination)
            if path and len(path) > 1:
                self.path_to_destination = path[1:]  # Remove current position
                self.path_calculation_failures = 0  # Reset failure counter
                # print(f"[BFS] {self.unique_id} calculated path from {self.pos} to {self.destination}: {len(self.path_to_destination)} steps")
            else:
                self.path_to_destination = None
                self.path_calculation_failures += 1
                # print(f"[BFS] {self.unique_id} NO PATH from {self.pos} to {self.destination} (failures: {self.path_calculation_failures})")

                # If failed too many times, assign a new reachable destination
                if self.path_calculation_failures >= 5:
                    # print(f"[BFS] {self.unique_id} destination {self.destination} seems unreachable, assigning new destination")
                    self.assign_new_destination()
    
    def move(self):
        """Move the car following BFS path."""
        # Already removed
        if getattr(self, "to_be_removed", False):
            return

        # Check if car hasn't moved in a while (stuck detection)
        if self.last_position == self.pos:
            self.wait_time += 1
        else:
            self.wait_time = 0

        self.last_position = self.pos

        # If stuck for too long, recalculate path avoiding current cars
        if self.wait_time >= 10:
            # print(f"[STUCK-DETECT] {self.unique_id} has been waiting at {self.pos} for {self.wait_time} steps, recalculating path avoiding traffic")
            # Try to find alternative path avoiding current car positions
            if self.destination:
                alternative_path = self.bfs_to_destination(self.pos, self.destination, avoid_cars=True)
                if alternative_path and len(alternative_path) > 1:
                    self.path_to_destination = alternative_path[1:]
                    # print(f"[REROUTE] {self.unique_id} found alternative path with {len(self.path_to_destination)} steps")
                else:
                    # If no alternative path found, just clear current path and try again later
                    self.path_to_destination = None
                    # print(f"[REROUTE] {self.unique_id} no alternative path found, will retry")
            self.wait_time = 0

        # Update facing direction
        road_dir = self.get_road_direction(self.pos)
        if road_dir:
            self.facing_direction = road_dir

        # Assign destination if none
        if self.destination is None:
            destinations = []
            for agents, pos in self.model.grid.coord_iter():
                for agent in agents:
                    if isinstance(agent, Destination):
                        destinations.append(pos)
            if destinations:
                import random
                # Assign completely random destination
                self.destination = random.choice(destinations)
                self.path_to_destination = None
                # print(f"[INIT] {self.unique_id} assigned destination {self.destination}")

        # Check if at destination (mark for removal, grid will be cleaned by model)
        if self.destination and self.pos == self.destination:
            # print(f"[ARRIVED] {self.unique_id} reached destination {self.destination}")
            self.to_be_removed = True
            return
        
        # Calculate path if needed
        self.calculate_path()
        
        # Follow path
        if self.path_to_destination and len(self.path_to_destination) > 0:
            next_pos = self.path_to_destination[0]
            
            # Check if next position is safe (no cars)
            if self.has_car(next_pos):
                # print(f"[WAIT] {self.unique_id} waiting - car at {next_pos}")
                return

            # Check traffic light
            traffic_light = self.get_traffic_light_state(next_pos)
            if traffic_light is False:
                # print(f"[WAIT] {self.unique_id} waiting - red light at {next_pos}")
                return

            # Move
            old_pos = self.pos
            self.model.grid.move_agent(self, next_pos)
            self.path_to_destination.pop(0)

            # Update facing direction
            new_road_dir = self.get_road_direction(self.pos)
            if new_road_dir:
                self.facing_direction = new_road_dir

            # print(f"[MOVE] {self.unique_id} {old_pos} -> {self.pos} (remaining: {len(self.path_to_destination)}, dest: {self.destination})")

            # Check if arrived (mark for removal, grid will be cleaned by model)
            if self.pos == self.destination:
                # print(f"[ARRIVED] {self.unique_id} reached destination {self.destination}")
                self.to_be_removed = True
        else:
            # No path available - stay still and try to recalculate next step
            pass
            # print(f"[NO-PATH] {self.unique_id} has no path to {self.destination}, staying still")
    
    def step(self):
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
