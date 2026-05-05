export const MIAMI_SESSION_KEY = 9078;  // Miami 2023 Race (2024 has no location data in OpenF1)
export const DEFAULT_CIRCUIT = 'miami';
export const SESSION_CIRCUIT_MAP = { 9078: 'miami' };
export const OPENF1_BASE_URL = 'https://api.openf1.org/v1';

export const DEFAULT_PLAYBACK_SPEED = 1.0;
export const MAX_PLAYBACK_SPEED = 20.0;
export const MIN_PLAYBACK_SPEED = 0.1;

export const BOUNDS_MARGIN = 0.05;
export const SPLINE_TENSION = 0.5;
export const SPLINE_SAMPLE_COUNT = 600;

export const LERP_RATE = 0.05;
export const DOT_RADIUS = 0.7;
export const DOT_EMISSIVE_INTENSITY = 6.0;

export const CENTERLINE_RAYCAST_OFFSET = 0.05;

export const CAMERA_FOV = 50;
export const ORBIT_TILT_DEG = 15;     // camera elevation above horizontal (0=side, 90=top-down)
export const ORBIT_SPEED = 0.000021;  // rad/ms — one full revolution ≈ 5 min
export const ORBIT_RADIUS_MULT = 1.3; // orbit distance as multiple of max circuit dimension

export const BLOOM_STRENGTH = 1.5;
export const BLOOM_RADIUS = 0.5;
export const BLOOM_THRESHOLD = 0.3;

export const FPS_UPDATE_INTERVAL = 500;
