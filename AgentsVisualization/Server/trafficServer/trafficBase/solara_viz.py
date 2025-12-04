import sys
from pathlib import Path

from mesa.visualization import SolaraViz, make_space_component, Slider
from mesa.visualization.components import AgentPortrayalStyle
import solara

# Asegurar que el directorio 'AgentsVisualization/Server/trafficServer' esté en sys.path
# para que los imports 'trafficBase.*' funcionen igual que en server_traffic.py
SERVER_ROOT = Path(__file__).resolve().parents[1]  # .../Server/trafficServer
if str(SERVER_ROOT) not in sys.path:
    sys.path.append(str(SERVER_ROOT))

from trafficBase.agent import Road, Traffic_Light, Destination, Obstacle, Car
from trafficBase.model import CityModel


def agent_portrayal(agent):
    """Representación 2D de los agentes del modelo."""
    if agent is None:
        return

    p = AgentPortrayalStyle(marker="s")

    if isinstance(agent, Road):
        p.color = "#888888"
        p.size = 0.9

    elif isinstance(agent, Destination):
        p.color = "lightgreen"
        p.size = 0.9

    elif isinstance(agent, Traffic_Light):
        p.color = "green" if agent.state else "red"
        p.size = 0.7

    elif isinstance(agent, Obstacle):
        p.color = "#555555"
        p.size = 0.9

    elif isinstance(agent, Car):
        p.color = "deepskyblue"
        p.size = 0.7

    return p


def post_process(ax):
    ax.set_aspect("equal")


@solara.component
def MetricsDisplay(model):
    """Component to display simulation metrics in real-time."""
    # Create a card to display metrics
    with solara.Card("Simulation Metrics", style={"margin": "10px", "padding": "15px"}):
        solara.Markdown(f"""
### Current Statistics:
- **Total Cars Spawned:** {model.total_cars_spawned}
- **Cars Reached Destination:** {model.cars_reached_destination}
- **Current Cars in Simulation:** {model.current_cars_in_simulation}
- **Current Step:** {model.steps}
        """)


# Los nombres de las claves deben coincidir EXACTAMENTE con los parámetros del constructor
model_params = {
    "N": Slider("Initial number of cars", 5, 1, 40),
    "spawn_interval": Slider("Spawn interval (steps)", 10, 1, 50),
}

# Crear el modelo inicial
model = CityModel(
    N=model_params["N"].value,
    spawn_interval=100,
    model_params=model_params
)

space_component = make_space_component(
    agent_portrayal,
    draw_grid=False,
    post_process=post_process,
)

# Usar el modelo en SolaraViz
# Nota: SolaraViz no recrea el modelo cuando cambian los sliders,
# pero el modelo verifica spawn_interval en cada step() y se actualiza automáticamente
page = SolaraViz(
    model,
    components=[space_component, MetricsDisplay],
    model_params=model_params,
    name="Traffic City",
)


