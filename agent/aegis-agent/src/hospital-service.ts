export interface GeoLocation {
  latitude: number;
  longitude: number;
  label?: string;
  accuracy?: number;
  timestamp?: string | number;
}

export interface Hospital {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  distanceKm: number;
  travelTimeMinutes: number | null;
  isOpen: boolean | null;
  phone: string | null;
  rating: number | null;
  reviewCount: number | null;
  mapsUrl: string;
  placeId?: string;
  source: 'google' | 'openstreetmap';
  recommendationScore: number;
}

export type LocationSource = 'gps' | 'geocoded' | 'spoken';

export interface HospitalSearchResult {
  origin: GeoLocation;
  hospitals: Hospital[];
  locationSource: LocationSource;
}

export interface HospitalIntelligenceResult {
  nearestHospital: Hospital | null;
  alternatives: Hospital[];
  origin: GeoLocation;
  locationSource: LocationSource;
  hospitalStatus: 'available' | 'unavailable';
}

const USER_AGENT = 'AEGIS-Emergency-Coordination/1.0';

// Nearby search starts at 5 km. When no suitable hospital is found the radius
// is expanded to 10 km before giving up.
const BASE_RADIUS_METERS = 5000;
const EXPANDED_RADIUS_METERS = 10000;
const REQUEST_TIMEOUT_MS = 8000;

const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const EMPTY_SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;
const ETA_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
}

const searchCache = new Map<string, CacheEntry<Hospital[]>>();
const etaCache = new Map<string, CacheEntry<number | null>>();

/** Ground the origin/hospital search cache. Export only for tests. */
export function clearHospitalCache(): void {
  searchCache.clear();
  etaCache.clear();
}

function pruneCache(cache: Map<string, CacheEntry<unknown>>, ttlMs: number): void {
  if (cache.size < MAX_CACHE_ENTRIES) return;
  const cutoff = Date.now() - ttlMs;
  for (const [key, entry] of cache) {
    if (entry.cachedAt < cutoff) {
      cache.delete(key);
    }
  }
}

/**
 * Snap a coordinate so repeated searches from nearly the same GPS fix
 * (within roughly a couple of hundred meters) reuse the same cache entry.
 */
function snapCoordinate(value: number): string {
  return Math.round(value * 400).toString();
}

function searchCacheKey(origin: GeoLocation, radiusMeters: number): string {
  return `${snapCoordinate(origin.latitude)}:${snapCoordinate(origin.longitude)}:${radiusMeters}`;
}

function getCachedSearch(origin: GeoLocation, radiusMeters: number): Hospital[] | null {
  const key = searchCacheKey(origin, radiusMeters);
  const cached = searchCache.get(key);
  if (!cached) return null;

  const ttlMs =
    cached.value.length === 0 ? EMPTY_SEARCH_CACHE_TTL_MS : SEARCH_CACHE_TTL_MS;
  if (Date.now() - cached.cachedAt >= ttlMs) {
    searchCache.delete(key);
    return null;
  }
  return cached.value;
}

function setCachedSearch(origin: GeoLocation, radiusMeters: number, hospitals: Hospital[]): void {
  searchCache.set(searchCacheKey(origin, radiusMeters), {
    value: hospitals,
    cachedAt: Date.now(),
  });
  pruneCache(searchCache, SEARCH_CACHE_TTL_MS);
}

function etaCacheKey(origin: GeoLocation, destination: GeoLocation): string {
  const originLat = origin.latitude.toFixed(4);
  const originLng = origin.longitude.toFixed(4);
  const destLat = destination.latitude.toFixed(4);
  const destLng = destination.longitude.toFixed(4);
  return `${originLat}:${originLng}:${destLat}:${destLng}`;
}

function getCachedEta(origin: GeoLocation, destination: GeoLocation): number | null | undefined {
  const key = etaCacheKey(origin, destination);
  const cached = etaCache.get(key);
  if (!cached) return undefined;
  if (Date.now() - cached.cachedAt >= ETA_CACHE_TTL_MS) {
    etaCache.delete(key);
    return undefined;
  }
  return cached.value;
}

function setCachedEta(
  origin: GeoLocation,
  destination: GeoLocation,
  minutes: number | null,
): void {
  etaCache.set(etaCacheKey(origin, destination), {
    value: minutes,
    cachedAt: Date.now(),
  });
  pruneCache(etaCache, ETA_CACHE_TTL_MS);
}

/**
 * Haversine straight-line distance between two geographic points, in
 * kilometers.
 */
export function distanceKmBetween(a: GeoLocation, b: GeoLocation): number {
  const earthRadiusKm = 6371;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Round a kilometer distance to one decimal ("2.4 km", never "2.438293829 km"). */
export function roundDistanceKm(km: number): number {
  return Number(km.toFixed(1));
}

/**
 * Emergency suitability score for ranking candidates.
 *
 * Real emergency-department availability is not exposed by a trusted public
 * API, so AEGIS never claims "emergency department available". Ranking instead
 * favours distance and travel time above all, then opening status and contact
 * availability, with ratings used only as a small tie-breaker.
 */
function scoreHospital(hospital: Omit<Hospital, 'recommendationScore'>): number {
  const distanceScore = Math.max(0, 1 - hospital.distanceKm / 12);
  const travelTimeScore =
    hospital.travelTimeMinutes == null
      ? 0.5
      : Math.max(0, 1 - hospital.travelTimeMinutes / 20);
  const openScore = hospital.isOpen === true ? 1 : hospital.isOpen === false ? 0.2 : 0.6;
  const contactScore = hospital.phone ? 1 : 0.4;
  const ratingScore = hospital.rating == null ? 0.5 : hospital.rating / 5;

  return (
    distanceScore * 0.45 +
    travelTimeScore * 0.2 +
    openScore * 0.15 +
    contactScore * 0.1 +
    ratingScore * 0.1
  );
}

export async function geocodeLocation(location: string): Promise<GeoLocation> {
  const params = new URLSearchParams({
    q: location,
    format: 'jsonv2',
    limit: '1',
  });

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT },
    },
  );

  if (!response.ok) {
    throw new Error(`Location lookup failed (${response.status})`);
  }

  const results = (await response.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
  }>;

  if (!results[0]) {
    throw new Error(`Could not locate "${location}".`);
  }

  return {
    latitude: Number(results[0].lat),
    longitude: Number(results[0].lon),
    label: results[0].display_name,
  };
}

async function searchGoogle(
  location: GeoLocation,
  radiusMeters: number,
): Promise<Hospital[] | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.location',
        'places.rating',
        'places.userRatingCount',
        'places.nationalPhoneNumber',
        'places.internationalPhoneNumber',
        'places.googleMapsUri',
        'places.currentOpeningHours',
      ].join(','),
    },
    body: JSON.stringify({
      includedTypes: ['hospital'],
      maxResultCount: 20,
      rankPreference: 'DISTANCE',
      locationRestriction: {
        circle: {
          center: {
            latitude: location.latitude,
            longitude: location.longitude,
          },
          radius: radiusMeters,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Google Places lookup failed (${response.status})`);
  }

  const body = (await response.json()) as {
    places?: Array<{
      id: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
      rating?: number;
      userRatingCount?: number;
      nationalPhoneNumber?: string;
      internationalPhoneNumber?: string;
      googleMapsUri?: string;
      currentOpeningHours?: { openNow?: boolean };
    }>;
  };

  return (body.places ?? [])
    .map((item) => {
      const latitude = item.location?.latitude;
      const longitude = item.location?.longitude;
      if (latitude == null || longitude == null || item.id == null) return null;

      const distanceKm = distanceKmBetween(location, { latitude, longitude });

      const hospital: Omit<Hospital, 'recommendationScore'> = {
        id: item.id,
        name: item.displayName?.text ?? 'Unnamed hospital',
        address: item.formattedAddress ?? 'Address unavailable',
        latitude,
        longitude,
        distanceMeters: Math.round(distanceKm * 1000),
        distanceKm: roundDistanceKm(distanceKm),
        travelTimeMinutes: null,
        isOpen: item.currentOpeningHours?.openNow ?? null,
        phone: item.internationalPhoneNumber ?? item.nationalPhoneNumber ?? null,
        rating: item.rating ?? null,
        reviewCount: item.userRatingCount ?? null,
        placeId: item.id,
        mapsUrl: `https://www.google.com/maps?q=${latitude},${longitude}`,
        source: 'google' as const,
      };

      return { ...hospital, recommendationScore: scoreHospital(hospital) } satisfies Hospital;
    })
    .filter((item): item is Hospital => item !== null);
}

async function searchOpenStreetMap(
  location: GeoLocation,
  radiusMeters: number,
): Promise<Hospital[]> {
  const query = `
[out:json][timeout:15];
(
  node[amenity=hospital](around:${radiusMeters},${location.latitude},${location.longitude});
  way[amenity=hospital](around:${radiusMeters},${location.latitude},${location.longitude});
  relation[amenity=hospital](around:${radiusMeters},${location.latitude},${location.longitude});
);
out center tags;`;

  // The primary Overpass mirror is frequently rate-limited or timed out.
  // Fall back to alternate mirrors so a transient provider failure does not
  // abort the hospital search. Each mirror request has a bounded timeout so a
  // hang on one provider cannot stall the emergency pipeline.
  const mirrors = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.osm.ch/api/interpreter',
  ];
  let lastError: Error | null = null;

  for (const mirror of mirrors) {
    try {
      const response = await fetch(mirror, {
        method: 'POST',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
          'User-Agent': USER_AGENT,
        },
        body: query,
      });

      if (!response.ok) {
        lastError = new Error(`OpenStreetMap hospital lookup failed (${response.status} on ${mirror})`);
        continue;
      }

      const body = (await response.json()) as {
        elements: Array<{
          type: string;
          id: number;
          lat?: number;
          lon?: number;
          center?: { lat: number; lon: number };
          tags?: Record<string, string>;
        }>;
      };

      const results = body.elements
        .map((item) => {
          const latitude = item.lat ?? item.center?.lat;
          const longitude = item.lon ?? item.center?.lon;
          if (latitude == null || longitude == null) return null;

          const distanceKm = distanceKmBetween(location, { latitude, longitude });

          const hospital: Omit<Hospital, 'recommendationScore'> = {
            id: `osm-${item.type}-${item.id}`,
            name: item.tags?.name ?? 'Unnamed hospital',
            address:
              item.tags?.['addr:full'] ??
              (
                [
                  item.tags?.['addr:housenumber'],
                  item.tags?.['addr:street'],
                  item.tags?.['addr:city'],
                ]
                  .filter(Boolean)
                  .join(' ') || 'Address unavailable'
              ),
            latitude,
            longitude,
            distanceMeters: Math.round(distanceKm * 1000),
            distanceKm: roundDistanceKm(distanceKm),
            travelTimeMinutes: null,
            isOpen: null,
            phone: item.tags?.['contact:phone'] ?? item.tags?.phone ?? null,
            rating: null,
            reviewCount: null,
            mapsUrl: `https://www.google.com/maps?q=${latitude},${longitude}`,
            source: 'openstreetmap' as const,
          };

          return { ...hospital, recommendationScore: scoreHospital(hospital) } satisfies Hospital;
        })
        .filter((item): item is Hospital => item !== null);

      if (results.length > 0) {
        return results;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (lastError) {
    throw lastError;
  }

  return [];
}

/**
 * Routing-based driving time estimate from the user's position to a hospital.
 * Uses the Google Directions API. Returns null whenever routing information is
 * unavailable so AEGIS never invents an ETA.
 */
export async function getTravelTimeMinutes(
  origin: GeoLocation,
  destination: GeoLocation,
): Promise<number | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const cached = getCachedEta(origin, destination);
  if (cached !== undefined) return cached;

  try {
    const params = new URLSearchParams({
      origin: `${origin.latitude},${origin.longitude}`,
      destination: `${destination.latitude},${destination.longitude}`,
      mode: 'driving',
      key: apiKey,
    });

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );

    if (!response.ok) {
      setCachedEta(origin, destination, null);
      return null;
    }

    const body = (await response.json()) as {
      status?: string;
      routes?: Array<{ legs?: Array<{ duration?: { value?: number } }> }>;
    };

    if (body.status !== 'OK') {
      setCachedEta(origin, destination, null);
      return null;
    }

    const seconds = body.routes?.[0]?.legs?.[0]?.duration?.value;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
      setCachedEta(origin, destination, null);
      return null;
    }

    const minutes = Math.max(1, Math.round(seconds / 60));
    setCachedEta(origin, destination, minutes);
    return minutes;
  } catch {
    setCachedEta(origin, destination, null);
    return null;
  }
}

export function googleMapsDirectionsUrl(hospital: Hospital, origin?: GeoLocation) {
  const params = new URLSearchParams({
    api: '1',
    destination: `${hospital.latitude},${hospital.longitude}`,
  });

  if (hospital.placeId) {
    params.set('destination_place_id', hospital.placeId);
  }

  if (origin) {
    params.set('origin', `${origin.latitude},${origin.longitude}`);
    params.set('travelmode', 'driving');
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Query a single provider radius, honoring the server-side search cache so the
 * same coordinates within a small radius are not repeatedly re-queried.
 */
async function searchProviders(origin: GeoLocation, radiusMeters: number): Promise<Hospital[]> {
  const cached = getCachedSearch(origin, radiusMeters);
  if (cached) {
    console.log(`[AEGIS] Hospital search cache hit at ${radiusMeters} m`);
    return cached;
  }

  let hospitals: Hospital[] = [];

  try {
    const googleHospitals = await searchGoogle(origin, radiusMeters);
    if (googleHospitals !== null && googleHospitals.length > 0) {
      hospitals = googleHospitals;
    } else if (googleHospitals === null) {
      console.log('[AEGIS] Google Places unavailable (GOOGLE_MAPS_API_KEY not configured); falling back to OpenStreetMap');
    }
  } catch (error) {
    console.error(
      '[AEGIS] Google Places search failed:',
      error instanceof Error ? error.message : String(error),
    );
  }

  if (hospitals.length === 0) {
    try {
      hospitals = await searchOpenStreetMap(origin, radiusMeters);
    } catch (error) {
      console.error(
        '[AEGIS] OpenStreetMap search failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Never return a result outside the requested geographic radius, even if an
  // upstream provider returns an inconsistent result.
  hospitals = hospitals.filter(
    (hospital) =>
      Number.isFinite(hospital.latitude) &&
      Number.isFinite(hospital.longitude) &&
      hospital.distanceMeters <= radiusMeters,
  );

  setCachedSearch(origin, radiusMeters, hospitals);
  return hospitals;
}

interface RadiiSearchResult {
  hospitals: Hospital[];
  expandedRadiusMeters: number | null;
}

/**
 * Search starting at the smallest radius and, only if no suitable hospital is
 * found, expand to the next radius. Stops at the first radius that returns at
 * least one hospital so API calls are not wasted.
 */
async function searchByRadii(
  origin: GeoLocation,
  radiiMeters: number[],
): Promise<RadiiSearchResult> {
  let hospitals: Hospital[] = [];
  let expandedRadiusMeters: number | null = null;

  for (let index = 0; index < radiiMeters.length; index += 1) {
    const radiusMeters = radiiMeters[index]!;
    hospitals = await searchProviders(origin, radiusMeters);

    if (hospitals.length > 0) {
      break;
    }

    const isLast = index === radiiMeters.length - 1;
    if (!isLast) {
      const nextRadius = radiiMeters[index + 1]!;
      console.log(
        `[AEGIS] No suitable hospitals within ${radiusMeters / 1000} km, expanding to ${nextRadius / 1000} km`,
      );
      expandedRadiusMeters = radiusMeters;
    }
  }

  if (hospitals.length === 0) {
    console.error('[AEGIS] Hospital search failed');
    console.error('[AEGIS] Error: no hospital providers returned results');
  } else {
    console.log(`[AEGIS] ${hospitals.length} hospitals found`);
  }

  return { hospitals, expandedRadiusMeters };
}

/**
 * Keep candidate hospitals local, fetch driving ETA for the nearest few, and
 * rank them for emergency suitability. Returns up to six candidates ordered
 * by suitability, each with a Google Maps route URL from the origin.
 */
async function prepareCandidates(
  origin: GeoLocation,
  hospitals: Hospital[],
): Promise<Hospital[]> {
  const nearestFirst = [...hospitals]
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 6);

  const withEta = await Promise.all(
    nearestFirst.map(async (hospital) => {
      hospital.travelTimeMinutes = await getTravelTimeMinutes(origin, hospital);
      return hospital;
    }),
  );

  return withEta
    .map((hospital) => {
      hospital.mapsUrl = googleMapsDirectionsUrl(hospital, origin);
      hospital.recommendationScore = scoreHospital(hospital);
      return hospital;
    })
    .sort((a, b) => b.recommendationScore - a.recommendationScore);
}

export async function findNearbyHospitals(
  location: GeoLocation | string,
  radiusKm = 10,
): Promise<HospitalSearchResult> {
  console.log('[AEGIS] Hospital search started');

  let origin: GeoLocation;
  let locationSource: LocationSource;
  if (typeof location === 'string') {
    console.log('[AEGIS] Location: geocoding spoken location:', location);
    origin = await geocodeLocation(location);
    locationSource = 'geocoded';
    console.log('[AEGIS] Geocoded:', origin.latitude, origin.longitude);
  } else {
    origin = location;
    locationSource = 'gps';
    console.log('[AEGIS] GPS acquired');
    console.log('[AEGIS] Origin:', origin.latitude, origin.longitude);
  }

  const radiusMeters = Math.min(Math.max(radiusKm * 1000, 1000), 50000);
  const { hospitals } = await searchByRadii(origin, [radiusMeters]);
  const prepared = await prepareCandidates(origin, hospitals);

  if (prepared.length > 0) {
    const nearest = prepared[0]!;
    console.log('[AEGIS] Nearest hospital selected:', nearest.name);
    if (nearest.travelTimeMinutes != null) {
      console.log('[AEGIS] Route information retrieved');
    } else {
      console.log('[AEGIS] Routing unavailable — distance only');
    }
  }

  return { origin, hospitals: prepared, locationSource };
}

/**
 * Find the single most suitable hospital for emergency response around a set
 * of real coordinates, plus fallback alternatives. Never blocks the emergency
 * workflow: every failure path converges on hospitalStatus "unavailable".
 */
export async function findNearestSuitableHospital(
  latitude: number,
  longitude: number,
  options: {
    accuracy?: number;
    timestamp?: string | number;
    label?: string;
    radiusKm?: number;
  } = {},
): Promise<HospitalIntelligenceResult> {
  const origin: GeoLocation = {
    latitude,
    longitude,
    ...(options.accuracy != null ? { accuracy: options.accuracy } : {}),
    ...(options.timestamp != null ? { timestamp: options.timestamp } : {}),
    ...(options.label != null ? { label: options.label } : {}),
  };

  console.log('[AEGIS] Hospital search started');
  console.log('[AEGIS] GPS acquired:', origin.latitude, origin.longitude);

  const radiiMeters =
    options.radiusKm != null
      ? [Math.min(Math.max(options.radiusKm * 1000, 1000), 50000)]
      : [BASE_RADIUS_METERS, EXPANDED_RADIUS_METERS];

  const { hospitals } = await searchByRadii(origin, radiiMeters);
  const prepared = await prepareCandidates(origin, hospitals);

  const nearestHospital = prepared[0] ?? null;
  const alternatives = prepared.slice(1);

  if (nearestHospital) {
    console.log('[AEGIS] Nearest hospital selected:', nearestHospital.name);
    console.log(`[AEGIS] Distance: ${nearestHospital.distanceKm} km`);
    if (nearestHospital.travelTimeMinutes != null) {
      console.log(
        `[AEGIS] Route information retrieved: ~${nearestHospital.travelTimeMinutes} min`,
      );
    } else {
      console.log('[AEGIS] Routing unavailable — returning hospital and distance');
    }
  }

  return {
    nearestHospital,
    alternatives,
    origin,
    locationSource: 'gps',
    hospitalStatus: nearestHospital ? 'available' : 'unavailable',
  };
}