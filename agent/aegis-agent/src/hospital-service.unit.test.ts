import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearHospitalCache,
  distanceKmBetween,
  findNearestSuitableHospital,
  findNearbyHospitals,
  googleMapsDirectionsUrl,
  roundDistanceKm,
  type GeoLocation,
} from './hospital-service.ts';

interface GooglePlace {
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
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface FetchMockConfig {
  placesStatus?: number;
  places?: (
    radius: number,
    center: { latitude: number; longitude: number },
  ) => GooglePlace[];
  directionsStatus?: 'OK' | 'NOT_FOUND' | 'REQUEST_DENIED';
  overpassStatus?: number;
  geocode?: { lat: number; lon: number; display_name: string };
}

function createFetchMock(config: FetchMockConfig = {}) {
  const placesCalls: Array<{
    body: Record<string, unknown>;
    center: { latitude: number; longitude: number };
    radius: number;
  }> = [];

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url;

      if (url.includes('places.googleapis.com')) {
        const body = JSON.parse(String(init?.body)) as {
          locationRestriction?: {
            circle?: {
              center?: { latitude: number; longitude: number };
              radius?: number;
            };
          };
        };
        const center = body.locationRestriction?.circle?.center ?? {
          latitude: 0,
          longitude: 0,
        };
        const radius = body.locationRestriction?.circle?.radius ?? 0;
        placesCalls.push({ body, center, radius });

        if (config.placesStatus !== undefined && config.placesStatus !== 200) {
          return jsonResponse({ error: 'boom' }, config.placesStatus);
        }

        const places = config.places
          ? config.places(radius, center)
          : [];
        return jsonResponse({ places });
      }

      if (url.includes('maps.googleapis.com')) {
        if (config.directionsStatus === 'NOT_FOUND') {
          return jsonResponse({ status: 'NOT_FOUND' });
        }
        if (config.directionsStatus === 'REQUEST_DENIED') {
          return jsonResponse({ status: 'REQUEST_DENIED' });
        }
        return jsonResponse({
          status: 'OK',
          routes: [{ legs: [{ duration: { value: 480 } }] }],
        });
      }

      if (url.includes('overpass')) {
        if (config.overpassStatus !== undefined) {
          return jsonResponse({}, config.overpassStatus);
        }
        return jsonResponse({ elements: [] });
      }

      if (url.includes('nominatim')) {
        if (!config.geocode) {
          return jsonResponse([]);
        }
        return jsonResponse([
          {
            lat: String(config.geocode.lat),
            lon: String(config.geocode.lon),
            display_name: config.geocode.display_name,
          },
        ]);
      }

      return jsonResponse({}, 500);
    },
  );

  return { fetchMock, placesCalls };
}

function place(overrides: Partial<GooglePlace> = {}): GooglePlace {
  return {
    id: `pl-${Math.random().toString(36).slice(2)}`,
    displayName: { text: 'Example Hospital' },
    formattedAddress: '1 Hospital Street, Test City',
    location: { latitude: 12.9716, longitude: 77.5946 },
    rating: 4.3,
    userRatingCount: 150,
    nationalPhoneNumber: '+91 90000 00000',
    googleMapsUri: 'https://maps.google.com/?cid=1',
    currentOpeningHours: { openNow: true },
    ...overrides,
  };
}

const ORIGIN = { latitude: 12.9716, longitude: 77.5946 };

describe('hospital-service intelligence', () => {
  beforeEach(() => {
    clearHospitalCache();
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-gmaps-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('computes and rounds haversine distance sensibly', () => {
    const hospital = { latitude: 12.9352, longitude: 77.6245 };
    const km = distanceKmBetween(ORIGIN, hospital);
    expect(km).toBeGreaterThan(4);
    expect(km).toBeLessThan(6);

    expect(roundDistanceKm(2.438293829)).toBe(2.4);
    expect(roundDistanceKm(0.96)).toBe(1);
    expect(roundDistanceKm(0.949)).toBe(0.9);
    expect(roundDistanceKm(12.049)).toBe(12);
  });

  it('selects the nearest suitable hospital, not merely the first API result', async () => {
    const closedNearby = place({
      id: 'pl-a',
      displayName: { text: 'Nearby Closed Clinic' },
      location: { latitude: 12.9731, longitude: 77.597 },
      rating: 4.9,
      currentOpeningHours: { openNow: false },
      nationalPhoneNumber: undefined,
      internationalPhoneNumber: undefined,
    });
    const openNearby = place({
      id: 'pl-b',
      displayName: { text: 'Open Community Hospital' },
      location: { latitude: 12.9765, longitude: 77.5988 },
      rating: 4.3,
    });
    const farther = place({
      id: 'pl-c',
      displayName: { text: 'Farther City Hospital' },
      location: { latitude: 12.9905, longitude: 77.5975 },
      rating: 4.1,
    });
    const moreOptions = place({
      id: 'pl-d',
      displayName: { text: 'District General Hospital' },
      location: { latitude: 12.945, longitude: 77.582 },
      rating: 4.0,
    });
    const lastOption = place({
      id: 'pl-e',
      displayName: { text: 'Westside Medical Center' },
      location: { latitude: 13.01, longitude: 77.6 },
      rating: 4.2,
    });

    const { fetchMock, placesCalls } = createFetchMock({
      places: () => [closedNearby, openNearby, farther, moreOptions, lastOption],
      directionsStatus: 'OK',
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await findNearestSuitableHospital(
      ORIGIN.latitude,
      ORIGIN.longitude,
      { accuracy: 15, timestamp: '2026-01-01T00:00:00Z' },
    );

    expect(result.hospitalStatus).toBe('available');
    expect(result.nearestHospital?.name).toBe('Open Community Hospital');
    expect(result.alternatives.length).toBeGreaterThanOrEqual(3);
    expect(placesCalls[0]).toMatchObject({
      center: { latitude: ORIGIN.latitude, longitude: ORIGIN.longitude },
      radius: 5000,
    });
    expect(placesCalls[0].body.rankPreference).toBe('DISTANCE');
    expect(placesCalls[0].body.includedTypes).toEqual(['hospital']);

    const nearest = result.nearestHospital!;
    expect(nearest.distanceKm).toBeGreaterThan(0);
    expect(nearest.travelTimeMinutes).toBe(8);
    expect(nearest.isOpen).toBe(true);
    expect(nearest.phone).toBe('+91 90000 00000');
    expect(nearest.mapsUrl).toContain('google.com/maps/dir/');
    expect(decodeURIComponent(nearest.mapsUrl)).toContain(
      `origin=${ORIGIN.latitude},${ORIGIN.longitude}`,
    );
    expect(decodeURIComponent(nearest.mapsUrl)).toContain(
      `destination=${nearest.latitude},${nearest.longitude}`,
    );
  });

  it('searches from the provided coordinates in a different city (worldwide)', async () => {
    const mumbai = { latitude: 19.076, longitude: 72.8777 };
    const { fetchMock, placesCalls } = createFetchMock({
      places: (radius, center) => [
        place({
          id: 'pl-mumbai',
          displayName: { text: 'Mumbai Hospital' },
          location: { latitude: center.latitude + 0.02, longitude: center.longitude },
        }),
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await findNearestSuitableHospital(
      mumbai.latitude,
      mumbai.longitude,
    );

    expect(result.nearestHospital?.name).toBe('Mumbai Hospital');
    expect(placesCalls[0].center).toEqual(mumbai);
  });

  it('geocodes a spoken location when GPS is unavailable', async () => {
    const { fetchMock, placesCalls } = createFetchMock({
      geocode: { lat: 15.85, lon: 74.5, display_name: 'Belgaum, Karnataka' },
      places: (radius, center) => [
        place({
          id: 'pl-belgaum',
          displayName: { text: 'Belgaum District Hospital' },
          location: { latitude: center.latitude + 0.01, longitude: center.longitude },
        }),
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await findNearbyHospitals('Belgaum, Karnataka');

    expect(result.locationSource).toBe('geocoded');
    expect(result.origin.latitude).toBeCloseTo(15.85, 3);
    expect(placesCalls[0].center).toMatchObject({ latitude: 15.85, longitude: 74.5 });
    expect(result.hospitals[0]?.name).toBe('Belgaum District Hospital');
  });

  it('expands the search radius from 5 km to 10 km when nothing is nearby', async () => {
    const { fetchMock, placesCalls } = createFetchMock({
      places: (radius) =>
        radius === 10000
          ? [
              place({
                id: 'pl-far',
                displayName: { text: 'Rural Referral Hospital' },
                location: { latitude: ORIGIN.latitude + 0.06, longitude: ORIGIN.longitude },
              }),
            ]
          : [],
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await findNearestSuitableHospital(
      ORIGIN.latitude,
      ORIGIN.longitude,
    );

    expect(result.hospitalStatus).toBe('available');
    expect(placesCalls.map((call) => call.radius)).toEqual([5000, 10000]);
    expect(result.nearestHospital?.name).toBe('Rural Referral Hospital');
  });

  it('never blocks the emergency workflow when providers fail', async () => {
    const { fetchMock } = createFetchMock({
      placesStatus: 500,
      overpassStatus: 503,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await findNearestSuitableHospital(
      ORIGIN.latitude,
      ORIGIN.longitude,
    );

    expect(result.hospitalStatus).toBe('unavailable');
    expect(result.nearestHospital).toBeNull();
    expect(result.alternatives).toEqual([]);
  });

  it('returns the hospital and distance when routing is unavailable (no fake ETA)', async () => {
    const { fetchMock } = createFetchMock({
      places: () => [
        place({
          id: 'pl-no-routing',
          displayName: { text: 'No Routing Hospital' },
          location: { latitude: ORIGIN.latitude + 0.02, longitude: ORIGIN.longitude },
        }),
      ],
      directionsStatus: 'NOT_FOUND',
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await findNearestSuitableHospital(
      ORIGIN.latitude,
      ORIGIN.longitude,
    );

    expect(result.hospitalStatus).toBe('available');
    expect(result.nearestHospital?.name).toBe('No Routing Hospital');
    expect(result.nearestHospital?.distanceKm).toBeGreaterThan(0);
    expect(result.nearestHospital?.travelTimeMinutes).toBeNull();
  });

  it('still returns a hospital when no phone number is available', async () => {
    const { fetchMock } = createFetchMock({
      places: () => [
        place({
          id: 'pl-no-phone',
          displayName: { text: 'No Phone Hospital' },
          location: { latitude: ORIGIN.latitude + 0.01, longitude: ORIGIN.longitude },
          nationalPhoneNumber: undefined,
          internationalPhoneNumber: undefined,
        }),
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await findNearestSuitableHospital(
      ORIGIN.latitude,
      ORIGIN.longitude,
    );

    expect(result.nearestHospital?.name).toBe('No Phone Hospital');
    expect(result.nearestHospital?.phone).toBeNull();
  });

  it('reuses a recent server-side search instead of re-querying the API', async () => {
    const { fetchMock, placesCalls } = createFetchMock({
      places: () => [
        place({
          id: 'pl-cached',
          displayName: { text: 'Cached General Hospital' },
          location: { latitude: ORIGIN.latitude + 0.015, longitude: ORIGIN.longitude },
        }),
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    await findNearestSuitableHospital(ORIGIN.latitude, ORIGIN.longitude);
    await findNearestSuitableHospital(ORIGIN.latitude, ORIGIN.longitude);

    expect(placesCalls).toHaveLength(1);
  });

  it('builds a Google Maps directions URL from a user origin', () => {
    const hospital: GeoLocation = { latitude: 12.9352, longitude: 77.6245 };
    const origin: GeoLocation = { latitude: 12.9716, longitude: 77.5946 };
    const url = googleMapsDirectionsUrl(
      {
        id: 'p',
        name: 'H',
        address: 'A',
        latitude: hospital.latitude,
        longitude: hospital.longitude,
        distanceMeters: 2400,
        distanceKm: 2.4,
        travelTimeMinutes: null,
        isOpen: null,
        phone: null,
        rating: null,
        reviewCount: null,
        mapsUrl: '',
        placeId: 'pl-x',
        source: 'google',
        recommendationScore: 0,
      },
      origin,
    );

    expect(url).toContain('google.com/maps/dir/');
    expect(decodeURIComponent(url)).toContain(`origin=${origin.latitude},${origin.longitude}`);
    expect(decodeURIComponent(url)).toContain(
      `destination=${hospital.latitude},${hospital.longitude}`,
    );
    expect(url).toContain('destination_place_id=pl-x');
  });
});