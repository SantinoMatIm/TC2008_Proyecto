#version 300 es
precision highp float;

in vec2 v_texCoord;

uniform sampler2D u_texture;

out vec4 outColor;

void main() {
    outColor = texture(u_texture, vec2(v_texCoord.x, 1.0 - v_texCoord.y));
}
