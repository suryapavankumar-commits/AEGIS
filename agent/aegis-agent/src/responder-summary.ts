import type { Incident, ResponderSummary } from './incident.ts';
import type { GeoLocation, Hospital } from './hospital-service.ts';

export type { ResponderSummary } from './incident.ts';

function inferConsciousnessStatus(): string {
  // The AEGIS incident model does not capture consciousness directly, so this
  // is never asserted. Kept explicit to avoid inventing information.
  return 'Unknown';
}

function inferInjuryStatus(incident: Incident): string {
  const hazards = incident.immediateHazards ?? [];
  const hasSevereHazards =
    hazards.includes('ACTIVE_FIRE') ||
    hazards.includes('GAS_LEAK') ||
    hazards.includes('CHEMICAL_SPILL');

  if (hasSevereHazards) {
    return 'Possible injury';
  }

  if (incident.type === 'MEDICAL') {
    return 'Medical emergency reported';
  }

  if (incident.type === 'ROAD_ACCIDENT') {
    return 'Possible injury';
  }

  if (incident.peopleAffected != null && incident.peopleAffected > 0) {
    return 'Possible injury';
  }

  return 'Unknown';
}

function inferTrappedStatus(incident: Incident): string {
  if (incident.peopleTrapped != null && incident.peopleTrapped > 0) {
    return `Yes (${incident.peopleTrapped})`;
  }
  return 'No';
}

function resolveLocation(
  incident: Incident,
  currentLocation: GeoLocation | null,
): ResponderSummary['location'] {
  const latitude = currentLocation?.latitude ?? null;
  const longitude = currentLocation?.longitude ?? null;
  const accuracy = currentLocation?.accuracy ?? null;

  const humanReadable =
    currentLocation?.label ?? incident.location ?? null;

  let mapsUrl: string | null = null;
  if (latitude != null && longitude != null) {
    mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
  }

  return { latitude, longitude, accuracy, humanReadable, mapsUrl };
}

function resolveHospital(
  hospital: Hospital | null,
): ResponderSummary['nearestHospital'] {
  if (!hospital) {
    return {
      name: null,
      distance: null,
      eta: null,
      address: null,
      phone: null,
      mapsUrl: null,
    };
  }

  return {
    name: hospital.name,
    distance: `${hospital.distanceKm} km`,
    eta:
      hospital.travelTimeMinutes != null
        ? `${hospital.travelTimeMinutes} minutes`
        : null,
    address: hospital.address,
    phone: hospital.phone,
    mapsUrl: hospital.mapsUrl,
  };
}

export function generateResponderSummary(
  incident: Incident,
  currentLocation: GeoLocation | null,
  hospital: Hospital | null,
  responseStatus = 'Emergency contact notified',
): ResponderSummary {
  return {
    incidentId: incident.id,
    incidentType: incident.type,
    severity: incident.severity,
    confidence: null,
    timestamp: incident.createdAt.toISOString(),
    location: resolveLocation(incident, currentLocation),
    userDescription: incident.description,
    peopleInvolved: incident.peopleAffected,
    injuryStatus: inferInjuryStatus(incident),
    consciousnessStatus: inferConsciousnessStatus(),
    trappedStatus: inferTrappedStatus(incident),
    hazards: incident.immediateHazards,
    nearestHospital: resolveHospital(hospital),
    responseStatus,
  };
}

export function formatSummaryForSms(summary: ResponderSummary): string {
  const lines: string[] = [];

  lines.push('AEGIS EMERGENCY ALERT');
  lines.push('');
  lines.push(`INCIDENT: ${summary.incidentType}`);
  lines.push(`SEVERITY: ${summary.severity}`);
  lines.push(`ID: ${summary.incidentId}`);

  lines.push('');
  lines.push('What happened:');
  lines.push(summary.userDescription);

  if (summary.location.humanReadable) {
    lines.push('');
    lines.push('Location:');
    lines.push(summary.location.humanReadable);
  }

  if (summary.location.mapsUrl) {
    lines.push(summary.location.mapsUrl);
  }

  if (summary.peopleInvolved != null) {
    lines.push('');
    lines.push(`People involved: ${summary.peopleInvolved}`);
  }

  lines.push('');
  lines.push(`Injury: ${summary.injuryStatus}`);
  lines.push(`Conscious: ${summary.consciousnessStatus}`);
  lines.push(`Trapped: ${summary.trappedStatus}`);

  if (summary.hazards.length > 0) {
    lines.push('');
    lines.push(`Hazards: ${summary.hazards.join(', ')}`);
  }

  if (summary.nearestHospital.name) {
    lines.push('');
    lines.push('Nearest Hospital:');
    lines.push(summary.nearestHospital.name);

    if (summary.nearestHospital.distance) {
      lines.push(`Distance: ${summary.nearestHospital.distance}`);
    }

    if (summary.nearestHospital.eta) {
      lines.push(`ETA: ${summary.nearestHospital.eta}`);
    }

    if (summary.nearestHospital.address) {
      lines.push(`Address: ${summary.nearestHospital.address}`);
    }

    if (summary.nearestHospital.phone) {
      lines.push(`Phone: ${summary.nearestHospital.phone}`);
    }

    if (summary.nearestHospital.mapsUrl) {
      lines.push(summary.nearestHospital.mapsUrl);
    }
  }

  lines.push('');
  lines.push(`Status: ${summary.responseStatus}`);

  return lines.join('\n');
}
