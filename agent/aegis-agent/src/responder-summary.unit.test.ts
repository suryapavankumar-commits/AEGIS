import { describe, expect, it } from 'vitest';
import { IncidentManager } from './incident-manager.ts';
import {
  generateResponderSummary,
  formatSummaryForSms,
} from './responder-summary.ts';
import type { GeoLocation, Hospital } from './hospital-service.ts';
import type { ResponderSummary } from './incident.ts';

const hospital: Hospital = {
  id: 'h1',
  name: 'Aster RV Hospital',
  address: 'JP Nagar, Bengaluru',
  latitude: 12.9,
  longitude: 77.58,
  distanceMeters: 2400,
  distanceKm: 2.4,
  travelTimeMinutes: 8,
  isOpen: true,
  phone: '+91 80 0000 0000',
  rating: 4.3,
  reviewCount: 100,
  mapsUrl: 'https://www.google.com/maps?q=12.9,77.58',
  source: 'google',
  recommendationScore: 0.9,
};

const gps: GeoLocation = {
  latitude: 12.9,
  longitude: 77.58,
  accuracy: 15,
  label: 'JP Nagar, Bengaluru',
};

function buildSummary(
  manager: IncidentManager,
  incidentOpts: Parameters<IncidentManager['createIncident']>[0],
  location: GeoLocation | null = gps,
  incidentHospital: Hospital | null = hospital,
): ResponderSummary {
  const incident = manager.createIncident(incidentOpts);
  return generateResponderSummary(incident, location, incidentHospital);
}

describe('ResponderSummary - vehicle accident', () => {
  it('captures a vehicle accident with a friend involved', () => {
    const manager = new IncidentManager();
    const summary = buildSummary(manager, {
      type: 'ROAD_ACCIDENT',
      description: 'Friend was involved in a vehicle accident.',
      location: 'JP Nagar, Bengaluru',
      peopleAffected: 1,
    });

    expect(summary.incidentType).toBe('ROAD_ACCIDENT');
    expect(summary.userDescription).toBe(
      'Friend was involved in a vehicle accident.',
    );
    expect(summary.peopleInvolved).toBe(1);
    expect(summary.injuryStatus).toBe('Possible injury');
    expect(summary.nearestHospital.name).toBe('Aster RV Hospital');
    expect(summary.nearestHospital.distance).toBe('2.4 km');
    expect(summary.nearestHospital.eta).toBe('8 minutes');
  });
});

describe('ResponderSummary - medical emergency', () => {
  it('records a medical emergency without inventing injury severity', () => {
    const manager = new IncidentManager();
    const summary = buildSummary(manager, {
      type: 'MEDICAL',
      description: 'User reported chest pain.',
      peopleAffected: 1,
    });

    expect(summary.incidentType).toBe('MEDICAL');
    expect(summary.injuryStatus).toBe('Medical emergency reported');
    expect(summary.peopleInvolved).toBe(1);
  });
});

describe('ResponderSummary - fire with trapped people', () => {
  it('marks trapped status and severe hazards', () => {
    const manager = new IncidentManager();
    const summary = buildSummary(manager, {
      type: 'FIRE',
      description: 'Fire in the kitchen.',
      peopleAffected: 3,
      peopleTrapped: 2,
      immediateHazards: ['ACTIVE_FIRE'],
    });

    expect(summary.incidentType).toBe('FIRE');
    expect(summary.trappedStatus).toContain('Yes');
    expect(summary.hazards).toContain('ACTIVE_FIRE');
    expect(summary.injuryStatus).toBe('Possible injury');
  });
});

describe('ResponderSummary - unknown emergency', () => {
  it('marks unknown fields instead of inventing details', () => {
    const manager = new IncidentManager();
    const summary = buildSummary(manager, {
      type: 'OTHER',
      description: 'Something happened near the main gate.',
    });

    expect(summary.incidentType).toBe('OTHER');
    expect(summary.peopleInvolved).toBeNull();
    expect(summary.injuryStatus).toBe('Unknown');
    expect(summary.consciousnessStatus).toBe('Unknown');
    expect(summary.trappedStatus).toBe('No');
  });
});

describe('ResponderSummary - GPS unavailable', () => {
  it('keeps location fields as null when no GPS', () => {
    const manager = new IncidentManager();
    const summary = buildSummary(manager, {
      type: 'MEDICAL',
      description: 'Chest pain reported.',
      location: 'JP Nagar, Bengaluru',
    }, null);

    expect(summary.location.latitude).toBeNull();
    expect(summary.location.longitude).toBeNull();
    expect(summary.location.mapsUrl).toBeNull();
    expect(summary.location.humanReadable).toBe('JP Nagar, Bengaluru');
    expect(summary.nearestHospital.name).toBe('Aster RV Hospital');
  });
});

describe('ResponderSummary - hospital unavailable', () => {
  it('keeps hospital fields as null when no hospital', () => {
    const manager = new IncidentManager();
    const summary = buildSummary(manager, {
      type: 'ROAD_ACCIDENT',
      description: 'Vehicle accident reported.',
    }, gps, null);

    expect(summary.nearestHospital.name).toBeNull();
    expect(summary.nearestHospital.distance).toBeNull();
    expect(summary.nearestHospital.eta).toBeNull();
  });
});

describe('ResponderSummary - missing injury information', () => {
  it('marks injury as unknown when not stated', () => {
    const manager = new IncidentManager();
    const summary = buildSummary(manager, {
      type: 'OTHER',
      description: 'Situation reported.',
    });

    expect(summary.injuryStatus).toBe('Unknown');
  });
});

describe('ResponderSummary - duplicate emergency trigger', () => {
  it('uses the incident idempotency so duplicates do not duplicate summary state', () => {
    const manager = new IncidentManager();
    const first = manager.createIncident({
      type: 'MEDICAL',
      description: 'First report.',
    });
    const firstSummary = generateResponderSummary(first, gps, hospital);

    const second = manager.createIncident({
      type: 'MEDICAL',
      description: 'Second, separate report.',
    });
    const secondSummary = generateResponderSummary(second, gps, hospital);

    expect(firstSummary.incidentId).toBe('INC-001');
    expect(secondSummary.incidentId).toBe('INC-002');
    expect(firstSummary.userDescription).toBe('First report.');
    expect(secondSummary.userDescription).toBe('Second, separate report.');
  });
});

describe('formatSummaryForSms', () => {
  it('formats a concise responder SMS', () => {
    const manager = new IncidentManager();
    const incident = manager.createIncident({
      type: 'ROAD_ACCIDENT',
      description: 'Friend was involved in a vehicle accident.',
      location: 'JP Nagar, Bengaluru',
      peopleAffected: 1,
    });
    const summary = generateResponderSummary(incident, gps, hospital);
    const sms = formatSummaryForSms(summary);

    expect(sms).toContain('AEGIS EMERGENCY ALERT');
    expect(sms).toContain('INCIDENT: ROAD_ACCIDENT');
    expect(sms).toContain('SEVERITY:');
    expect(sms).toContain('Friend was involved in a vehicle accident.');
    expect(sms).toContain('Nearest Hospital:');
    expect(sms).toContain('2.4 km');
    expect(sms).toContain('8 minutes');
  });
});
