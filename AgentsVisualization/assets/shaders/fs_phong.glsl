#version 300 es
precision highp float;

in vec3 v_normal;
in vec3 v_surfaceToLight;
in vec3 v_surfaceToView;
in vec4 v_color;
in vec3 v_surfaceWorldPosition;

// Scene uniforms
uniform vec4 u_ambientLight;
uniform vec4 u_diffuseLight;
uniform vec4 u_specularLight;
uniform float u_sunIntensity;

// Traffic light uniforms (includes streetlights)
uniform int u_numTrafficLights;
uniform int u_numTrafficLightsOnly;
uniform vec3 u_trafficLightPositions[50];
uniform vec4 u_trafficLightColors[50];
uniform float u_trafficLightIntensity;
uniform float u_streetLightIntensity;

// Model uniforms
uniform vec4 u_specularColor;
uniform float u_shininess;

out vec4 outColor;

void main() {
    // v_normal must be normalized because the shader will interpolate
    // it for each pixel
    vec3 normal = normalize(v_normal);

    vec3 surfToLigthDirection = normalize(v_surfaceToLight);
    vec3 surfToViewDirection = normalize(v_surfaceToView);

    // Finding the reflection vector for main light
    // https://en.wikipedia.org/wiki/Phong_reflection_model
    vec3 reflectionVector = (2.0 * dot(surfToLigthDirection, normal)
        * normal - surfToLigthDirection);

    float light = max(dot(normal, surfToLigthDirection), 0.0);
    float specular = 0.0;
    if (light > 0.0) {
        float specular_dot = dot(surfToViewDirection, reflectionVector);
        if (specular_dot > 0.0) {
            specular = pow(specular_dot, u_shininess);
        }
    }

    // Compute the three parts of the Phong lighting model using main light
    vec4 ambientColor = v_color * u_ambientLight * u_sunIntensity;
    vec4 diffuseColor = light * v_color * u_diffuseLight * u_sunIntensity;
    vec4 specularColor = specular * u_specularColor * u_specularLight * u_sunIntensity;

    // Add contributions from traffic lights
    vec4 trafficLightContribution = vec4(0.0, 0.0, 0.0, 0.0);
    for (int i = 0; i < u_numTrafficLights; i++) {
        vec3 surfaceToTrafficLight = u_trafficLightPositions[i] - v_surfaceWorldPosition;
        float distance = length(surfaceToTrafficLight);

        // Attenuation based on distance
        float attenuation = 1.0 / (1.0 + 0.09 * distance + 0.032 * distance * distance);

        vec3 trafficLightDirection = normalize(surfaceToTrafficLight);

        // Diffuse component for traffic light
        float trafficDiffuse = max(dot(normal, trafficLightDirection), 0.0);

        // Specular component for traffic light
        vec3 trafficReflection = (2.0 * dot(trafficLightDirection, normal)
            * normal - trafficLightDirection);
        float trafficSpecular = 0.0;
        if (trafficDiffuse > 0.0) {
            float spec_dot = dot(surfToViewDirection, trafficReflection);
            if (spec_dot > 0.0) {
                trafficSpecular = pow(spec_dot, u_shininess);
            }
        }

        // Determine which intensity to use: traffic lights or street lights
        float lightIntensity = (i < u_numTrafficLightsOnly) ? u_trafficLightIntensity : u_streetLightIntensity;

        // Add this light's contribution with attenuation and intensity
        trafficLightContribution += attenuation * lightIntensity * (
            trafficDiffuse * v_color * u_trafficLightColors[i] +
            trafficSpecular * u_specularColor * u_trafficLightColors[i]
        );
    }

    // Combine main light and traffic lights
    outColor = ambientColor + diffuseColor + specularColor + trafficLightContribution;
}
