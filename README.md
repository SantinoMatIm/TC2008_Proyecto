# TC2008_Proyecto
# Santino Matias Im
# Luis Leonardo Rodríguez Gálvez

Simulación multiagente para explorar soluciones a la congestión vehicular en ciudades mexicanas. El proyecto modela automóviles y su interacción en entornos urbanos 3D, con el fin de evaluar estrategias como control de estacionamientos, uso compartido de vehículos, selección dinámica de rutas y coordinación inteligente de semáforos. A través de la visualización tridimensional de los datos generados, se busca analizar y proponer mejoras tangibles para la movilidad urbana y la calidad de vida.

## Cómo correr la simulación

### 1. Iniciar el servidor de tráfico

Navega a la carpeta `trafficServer` y ejecuta el servidor con Python:

```bash
cd trafficServer
python server_traffic.py
```

> Nota: Asegúrate de tener activado tu entorno virtual si usas uno.

### 2. Iniciar la visualización

En otra terminal, navega a la carpeta `AgentsVisualization` e inicia el servidor de desarrollo:

```bash
cd AgentsVisualization
npx vite
```

### 3. Abrir la simulación en el navegador

Una vez que ambos servidores estén corriendo, abre tu navegador y ve a:

```
http://localhost:5173/visualization/traffic.html
```