#version 300 es
in vec4 a_position;
in vec2 a_texCoord;

uniform mat4 u_worldViewProjection;

out vec2 v_texCoord;

void main() {
    gl_Position = u_worldViewProjection * a_position;
    v_texCoord = a_texCoord;
}
