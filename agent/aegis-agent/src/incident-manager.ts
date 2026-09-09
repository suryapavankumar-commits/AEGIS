import {
  type Incident,
  type IncidentSeverity,
  type IncidentType,
} from './incident.ts';

export class IncidentManager {
  private incidents: Map<string, Incident> = new Map();

  private nextId = 1;

  // Stores the incident currently being discussed
  private currentIncidentId: string | null = null;

  createIncident(data: {
    type: IncidentType;
    description: string;
    location?: string | null;
    peopleAffected?: number | null;
    peopleTrapped?: number | null;
    immediateHazards?: string[];
  }): Incident {
    const now = new Date();

    const severity = this.calculateSeverity(data);

    const incident: Incident = {
      id: `INC-${String(this.nextId++).padStart(3, '0')}`,
      type: data.type,
      description: data.description,
      location: data.location ?? null,
      severity,
      priorityScore: this.calculatePriorityScore({
        ...data,
        severity,
        status: 'ACTIVE',
      }),
      peopleAffected: data.peopleAffected ?? null,
      peopleTrapped: data.peopleTrapped ?? null,
      immediateHazards: data.immediateHazards ?? [],
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };

    this.incidents.set(incident.id, incident);

    // The newest incident becomes the current incident
    this.currentIncidentId = incident.id;

    return incident;
  }

  updateIncident(
    id: string,
    updates: Partial<
      Pick<
        Incident,
        | 'description'
        | 'location'
        | 'peopleAffected'
        | 'peopleTrapped'
        | 'immediateHazards'
        | 'status'
      >
    >,
  ): Incident | null {
    const incident = this.incidents.get(id);

    if (!incident) {
      return null;
    }

    Object.assign(incident, updates);

    incident.severity = this.calculateSeverity({
      peopleAffected: incident.peopleAffected,
      peopleTrapped: incident.peopleTrapped,
      immediateHazards: incident.immediateHazards,
    });

    incident.priorityScore = this.calculatePriorityScore({
      severity: incident.severity,
      peopleAffected: incident.peopleAffected,
      peopleTrapped: incident.peopleTrapped,
      immediateHazards: incident.immediateHazards,
      status: incident.status,
    });

    incident.updatedAt = new Date();

    // Keep this incident as the current one
    this.currentIncidentId = incident.id;

    return incident;
  }

  updateCurrentIncident(
    updates: Partial<
      Pick<
        Incident,
        | 'description'
        | 'location'
        | 'peopleAffected'
        | 'peopleTrapped'
        | 'immediateHazards'
        | 'status'
      >
    >,
  ): Incident | null {
    if (!this.currentIncidentId) {
      return null;
    }

    return this.updateIncident(this.currentIncidentId, updates);
  }

  getCurrentIncident(): Incident | null {
    if (!this.currentIncidentId) {
      return null;
    }

    return this.incidents.get(this.currentIncidentId) ?? null;
  }

  setCurrentIncident(id: string): Incident | null {
    const incident = this.incidents.get(id);

    if (!incident) {
      return null;
    }

    this.currentIncidentId = id;

    return incident;
  }

  getIncident(id: string): Incident | null {
    return this.incidents.get(id) ?? null;
  }

  getActiveIncidents(): Incident[] {
    return [...this.incidents.values()]
      .filter(
        (incident) =>
          incident.status === 'ACTIVE' ||
          incident.status === 'RESPONDING',
      )
      .sort((a, b) => b.priorityScore - a.priorityScore);
  }

  private calculateSeverity(data: {
    peopleAffected?: number | null;
    peopleTrapped?: number | null;
    immediateHazards?: string[];
  }): IncidentSeverity {
    const hazards = data.immediateHazards ?? [];

    if (
      (data.peopleTrapped ?? 0) > 0 ||
      hazards.includes('ACTIVE_FIRE') ||
      hazards.includes('GAS_LEAK') ||
      hazards.includes('CHEMICAL_SPILL')
    ) {
      return 'CRITICAL';
    }

    if ((data.peopleAffected ?? 0) >= 5) {
      return 'HIGH';
    }

    if ((data.peopleAffected ?? 0) > 0) {
      return 'MEDIUM';
    }

    return 'LOW';
  }

  private calculatePriorityScore(data: {
    severity: IncidentSeverity;
    peopleAffected?: number | null;
    peopleTrapped?: number | null;
    immediateHazards?: string[];
    status: string;
  }): number {
    let score = 0;

    // Base score from severity
    switch (data.severity) {
      case 'LOW':
        score += 20;
        break;

      case 'MEDIUM':
        score += 40;
        break;

      case 'HIGH':
        score += 65;
        break;

      case 'CRITICAL':
        score += 80;
        break;
    }

    // Trapped people significantly increase priority
    const trapped = data.peopleTrapped ?? 0;
    score += Math.min(trapped * 5, 15);

    // Number of affected people also increases priority
    const affected = data.peopleAffected ?? 0;
    score += Math.min(Math.floor(affected / 2) * 2, 10);

    // Immediate hazards
    const hazards = data.immediateHazards ?? [];

    if (hazards.includes('ACTIVE_FIRE')) {
      score += 10;
    }

    if (hazards.includes('GAS_LEAK')) {
      score += 10;
    }

    if (hazards.includes('CHEMICAL_SPILL')) {
      score += 10;
    }

    if (hazards.includes('LEAKING_FUEL')) {
      score += 5;
    }

    // An incident already being responded to is slightly lower priority
    // than one that has not yet received a response.
    if (data.status === 'RESPONDING') {
      score -= 10;
    }

    // Keep score between 0 and 100
    return Math.max(0, Math.min(score, 100));
  }
}