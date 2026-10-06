import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from './motion.js';

const vertexSource = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

// Ruido fbm con deformación de dominio: un "líquido" lento en azul marino con vetas naranjas.
const fragmentSource = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uScroll;
uniform vec3 uNavy;
uniform vec3 uOrange;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec2 m = (uMouse - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime * 0.05 + uScroll * 0.6;

  float md = length(p - m);
  float pull = smoothstep(0.8, 0.0, md);
  vec2 warp = p + (m - p) * pull * 0.12;

  vec2 q = vec2(fbm(warp * 1.3 + t), fbm(warp * 1.3 - t + 3.1));
  vec2 r = vec2(fbm(warp * 1.7 + 2.0 * q + vec2(1.7, 9.2) + t * 1.3), fbm(warp * 1.7 + 2.0 * q + vec2(8.3, 2.8) - t));
  float f = fbm(warp * 1.5 + 2.4 * r);

  vec3 deep = uNavy * 0.55;
  vec3 col = mix(deep, uNavy * 1.15, smoothstep(0.15, 0.85, f));

  float veins = smoothstep(0.62, 0.92, f + 0.18 * pull) * smoothstep(0.0, 0.7, uv.x);
  col = mix(col, uOrange, veins * 0.42);
  col += uOrange * pull * 0.06;

  col *= mix(0.72, 1.0, smoothstep(1.35, 0.25, length(p - vec2(0.2, 0.0))));
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) * 0.03;
  gl_FragColor = vec4(col, 1.0);
}
`;

function hexToRgb(value, fallback) {
  const hex = value.trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return fallback;
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Fondo animado del hero. Si WebGL no está disponible, queda el degradado CSS de .hero-wrap. */
export function HeroShader() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) return undefined;

    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertex || !fragment) return undefined;
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return undefined;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uniform = (name) => gl.getUniformLocation(program, name);
    const uRes = uniform('uRes');
    const uTime = uniform('uTime');
    const uMouse = uniform('uMouse');
    const uScroll = uniform('uScroll');
    const styles = getComputedStyle(document.documentElement);
    gl.uniform3fv(uniform('uNavy'), hexToRgb(styles.getPropertyValue('--brand-navy'), [0.106, 0.188, 0.29]));
    gl.uniform3fv(uniform('uOrange'), hexToRgb(styles.getPropertyValue('--brand-orange'), [0.984, 0.478, 0.235]));

    // El ruido es suave: se renderiza a media resolución y el navegador lo escala.
    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.5;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    const mouse = { x: 0.62, y: 0.55, tx: 0.62, ty: 0.55 };
    const onPointerMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      mouse.tx = (event.clientX - rect.left) / rect.width;
      mouse.ty = 1 - (event.clientY - rect.top) / rect.height;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    const reduced = prefersReducedMotion();
    let frame = 0;
    let visible = true;
    const start = performance.now();
    const draw = (now) => {
      mouse.x += (mouse.tx - mouse.x) * 0.045;
      mouse.y += (mouse.ty - mouse.y) * 0.045;
      gl.uniform1f(uTime, reduced ? 12 : (now - start) / 1000);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform1f(uScroll, Math.min(1, window.scrollY / Math.max(1, canvas.clientHeight)));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduced && visible && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const resume = () => {
      cancelAnimationFrame(frame);
      if (visible && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const visibilityObserver = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; resume(); });
    visibilityObserver.observe(canvas);
    document.addEventListener('visibilitychange', resume);
    frame = requestAnimationFrame(draw);
    canvas.classList.add('is-ready');

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pointermove', onPointerMove);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteBuffer(buffer);
    };
  }, []);

  return <canvas ref={canvasRef} className="hero-shader" aria-hidden="true" />;
}
