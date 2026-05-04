// ── Session ──────────────────────────────────────────────────────
// Change this to test a different session. Find keys at:
// https://api.openf1.org/v1/sessions
export const MIAMI_SESSION_KEY = 9580;
export const DEFAULT_CIRCUIT = 'miami';
export const SESSION_CIRCUIT_MAP = {
  9580: 'miami',
};

// ── API ──────────────────────────────────────────────────────────
export const OPENF1_BASE_URL = 'https://api.openf1.org/v1';

// ── Playback ─────────────────────────────────────────────────────
export const DEFAULT_PLAYBACK_SPEED = 1.0;
export const MAX_PLAYBACK_SPEED = 20.0;
export const MIN_PLAYBACK_SPEED = 0.1;

// ── Coordinate Transform ─────────────────────────────────────────
export const BOUNDS_MARGIN = 0.05;

// ── Spline ────────────────────────────────────────────────────────
export const SPLINE_TENSION = 0.5;
export const SPLINE_SAMPLE_COUNT = 600;

// ── Driver Dot Rendering ─────────────────────────────────────────
export const LERP_RATE = 0.05;
export const DOT_RADIUS = 0.4;
export const DOT_EMISSIVE_INTENSITY = 2.5;

// ── Raycast Elevation Snap ────────────────────────────────────────
export const CENTERLINE_RAYCAST_OFFSET = 0.05;

// ── Camera ────────────────────────────────────────────────────────
export const CAMERA_FOV = 50;
export const CAMERA_HEIGHT_MULTIPLIER = 0.9;
export const CAMERA_TILT_Z_MULTIPLIER = 0.15;

// ── Post-Processing ───────────────────────────────────────────────
export const BLOOM_STRENGTH = 1.2;
export const BLOOM_RADIUS = 0.4;
export const BLOOM_THRESHOLD = 0.75;

// ── Dev Panel ─────────────────────────────────────────────────────
export const FPS_UPDATE_INTERVAL = 500;
