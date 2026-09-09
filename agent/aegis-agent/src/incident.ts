export type IncidentType =
  | 'FIRE'
  | 'MEDICAL'
  | 'ROAD_ACCIDENT'
  | 'GAS_LEAK'
  | 'NATURAL_DISASTER'
  | 'CRIME_OR_SECURITY'
  | 'INDUSTRIAL_ACCIDENT'
  | 'INFRASTRUCTURE_FAILURE'
  | 'OTHER';

export type IncidentSeverity =
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'CRITICAL';

export type IncidentStatus =
  | 'ACTIVE'
  | 'RESPONDING'
  | 'RESOLVED';

export interface ResponderSummary {
  incidentId: string;
  incidentType: string;
  severity: string;
  confidence: number | null;
  timestamp: string;
  location: {
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    humanReadable: string | null;
    mapsUrl: string | null;
  };
  userDescription: string;
  peopleInvolved: number | null;
  injuryStatus: string;
  consciousnessStatus: string;
  trappedStatus: string;
  hazards: string[];
  nearestHospital: {
    name: string | null;
    distance: string | null;
    eta: string | null;
    address: string | null;
    phone: string | null;
    mapsUrl: string | null;
  };
  responseStatus: string;
}

export interface Incident {
  id: string;

  type: IncidentType;

  description: string;

  location: string | null;

  severity: IncidentSeverity;

  priorityScore: number;

  peopleAffected: number | null;

  peopleTrapped: number | null;

  immediateHazards: string[];

  status: IncidentStatus;

  createdAt: Date;

  updatedAt: Date;

  responderSummary?: ResponderSummary;
}