import { describe, expect, it } from 'vitest';
import { IncidentManager } from './incident-manager.ts';

describe('IncidentManager', () => {
  it('creates and prioritizes a critical trapped-person fire', () => {
    const manager = new IncidentManager();
    const incident = manager.createIncident({
      type: 'FIRE',
      description: 'Fire in engineering building',
      location: 'Engineering building',
      peopleAffected: 3,
      peopleTrapped: 2,
      immediateHazards: ['ACTIVE_FIRE'],
    });

    expect(incident.id).toBe('INC-001');
    expect(incident.severity).toBe('CRITICAL');
    expect(incident.priorityScore).toBe(100);
  });

  it('treats a correction as an update to the current incident', () => {
    const manager = new IncidentManager();
    const first = manager.createIncident({
      type: 'FIRE',
      description: 'Fire near main gate',
      location: 'main gate',
      peopleTrapped: 2,
      immediateHazards: ['ACTIVE_FIRE'],
    });

    const updated = manager.updateCurrentIncident({
      location: 'north gate',
      peopleTrapped: 0,
      immediateHazards: [],
    });

    expect(updated?.id).toBe(first.id);
    expect(updated?.location).toBe('north gate');
    expect(updated?.peopleTrapped).toBe(0);
    expect(manager.getActiveIncidents()).toHaveLength(1);
  });
});
