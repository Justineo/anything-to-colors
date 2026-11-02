export type Program = { handle: WebGLProgram; u: Record<string, WebGLUniformLocation> };
export type Target = {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
};
export type Double = { read: Target; write: Target; swap(): void };

export function createProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const shaders = [vertex, fragment].map((source, i) => {
    const shader = gl.createShader(i ? gl.FRAGMENT_SHADER : gl.VERTEX_SHADER)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(error || "Shader compilation failed");
    }
    return shader;
  });
  const handle = gl.createProgram()!;
  shaders.forEach((shader) => gl.attachShader(handle, shader));
  gl.linkProgram(handle);
  shaders.forEach((shader) => gl.deleteShader(shader));
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(handle) || "Shader linking failed");
  const u: Program["u"] = {};
  for (let i = 0; i < gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS); i++) {
    const name = gl.getActiveUniform(handle, i)!.name;
    u[name.replace(/\[0\]$/, "")] = gl.getUniformLocation(handle, name)!;
  }
  return { handle, u } satisfies Program;
}

export function createTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internal: number,
  format: number,
  filter: number,
): Target {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, gl.HALF_FLOAT, null);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
    throw new Error("Half-float render targets unavailable");
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { texture, fbo, width, height };
}

export function createDouble(...args: Parameters<typeof createTarget>): Double {
  return {
    read: createTarget(...args),
    write: createTarget(...args),
    swap() {
      [this.read, this.write] = [this.write, this.read];
    },
  };
}

export function deleteTarget(gl: WebGL2RenderingContext, target: Target) {
  gl.deleteTexture(target.texture);
  gl.deleteFramebuffer(target.fbo);
}
