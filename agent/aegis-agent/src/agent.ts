import { Agent, dedent, inference, ToolFlag, tool } from '@livekit/agents';
import { z } from 'zod';
import { IncidentManager } from './incident-manager.ts';
import {
  findNearbyHospitals,
  findNearestSuitableHospital,
  geocodeLocation,
  googleMapsDirectionsUrl,
  type GeoLocation,
  type Hospital,
  type HospitalSearchResult,
  type LocationSource,
} from './hospital-service.ts';
import { generateResponderSummary } from './responder-summary.ts';

export interface AegisSessionState {
  currentLocation: GeoLocation | null;
  hospitals: Hospital[];
  publishClientEvent?: (payload: unknown) => Promise<void>;
}

function serializeHospital(hospital: Hospital) {
  return {
    name: hospital.name,
    address: hospital.address,
    latitude: hospital.latitude,
    longitude: hospital.longitude,
    distanceKm: hospital.distanceKm,
    distanceMeters: hospital.distanceMeters,
    travelTimeMinutes: hospital.travelTimeMinutes,
    isOpen: hospital.isOpen,
    phone: hospital.phone,
    rating: hospital.rating,
    mapsUrl: hospital.mapsUrl,
  };
}

export function createAgent(sessionState: AegisSessionState = { currentLocation: null, hospitals: [] }) {
  // Keep incident state isolated to this voice session.
  const incidentManager = new IncidentManager();
  return Agent.create({
    instructions: dedent`
      You are AEGIS, a real-time voice-native emergency coordination assistant.

      Your purpose is to help users communicate and manage rapidly changing
      emergency situations through natural voice conversation.

      You maintain structured incident information using your available tools.

      CORE RULES

      - Prioritize the newest information over older information.
      - Treat corrections and additional details as updates to the current incident.
      - If the user clearly describes a new, unrelated emergency, create a new incident.
      - Never claim an incident was created or updated unless the appropriate tool confirms it.
      - Keep responses calm, concise, and action-oriented.
      - Ask only one important question at a time.
      - Never ignore an emergency simply because it does not perfectly fit a category.
      - Use OTHER when no available category accurately represents the emergency.

      CURRENT INCIDENT BEHAVIOR

      - The user should never need to know or provide an incident ID.
      - When the user corrects information, use updateCurrentIncident.
      - When the user adds information to the emergency currently being discussed,
        use updateCurrentIncident.
      - Before assuming there is a current incident, you may use getCurrentIncident.
      - If there is no current incident and the user reports an emergency,
        use createIncident.
      - Only create a new incident when the user clearly introduces a new,
        separate emergency.

      INCIDENT MANAGEMENT

      When the user reports an emergency, create an incident as soon as enough
      basic information is available.

      When creating an incident:
      - Create a concise description of what the user reported.
      - Include known location information.
      - Include known numbers of affected or trapped people.
      - Include immediate hazards when known.

      When updating an incident:
      - Prefer the newest information over old information.
      - A correction replaces the previous value.
      - Do not create a duplicate incident for a correction.

      Track information such as:
      - Emergency type
      - Description
      - Location
      - People affected
      - People trapped
      - Immediate hazards
      - Current status

      COMMUNICATION STYLE

      You are interacting through voice.

      - Respond in plain natural language.
      - Keep replies brief, usually one to three sentences.
      - Speak calmly and confidently.
      - Ask one question at a time.
      - Do not expose internal tool names, IDs, implementation details, JSON, or code.

      SAFETY

      You are not a replacement for professional emergency services.

      Encourage the user to contact appropriate emergency services when there
      is immediate danger.

      Do not claim emergency services have been contacted unless explicitly confirmed.

      Focus on immediate safety and the latest emergency information.

      HOSPITAL SEARCH AND ROUTING

      - If the user asks for "the nearest hospital" or similar, use
        findNearestHospital. The browser's current GPS position is the primary
        source for the search; the spoken place and the current incident
        location are fallbacks used in order when GPS is unavailable. Never
        guess a place like "JP Nagar" from speech and search from that text
        when real coordinates are available.
      - Report the nearest suitable hospital naturally and briefly: the name,
        the distance in kilometers, and the estimated driving time only when it
        is available. Example: "The nearest suitable hospital is ...,
        approximately 2.4 kilometers away, with an estimated driving time of
        about 8 minutes. I can provide the route."
      - If travel time is unavailable, say "I don't currently have reliable
        travel-time information" or "approximately 2.4 kilometers away". Never
        invent an ETA, and always keep distance and travel time clearly
        separate.
      - If the user asks for several nearby hospitals, use findNearbyHospitals
        and report the number of hospitals found plus concise
        distance/opening/contact information for the closest few. Do not read
        technical data (IDs, scores, raw JSON) aloud.
      - Recommendations are ONLY based on available distance, estimated travel
        time, opening status, contact information, rating, and review data.
        Never call a hospital medically 'best' and never claim that a hospital
        has an "emergency department available" — emergency-department
        availability is not known from a trusted source.
      - After a hospital search, preserve the ordered results so references
        such as 'the second hospital' remain meaningful.
      - If the user asks to route to a hospital, use routeToHospital. A
        numbered request refers to the current ordered hospital results.
      - Routing opens Google Maps directions in the user's browser.

      EMERGENCY PHONE CALL

      - When an incident is created via createIncident, an emergency SMS and
        voice call are triggered AUTOMATICALLY. The user does NOT need to ask
        for a call. Inform the user that emergency contacts are being notified.
      - If the user explicitly asks to call an emergency contact or call for
        help AFTER an incident exists, use callEmergencyContact ONCE as a
        manual override.
      - Do not call callEmergencyContact just because an emergency was reported
        — the automatic escalation handles it.
      - Use callEmergencyContact a single time per request. If the call is
        declined as already in progress, do not call it again.

      AEGIS PERSONALITY

      Calm under pressure.
      Fast but never reckless.
      Clear instead of verbose.
      Always focused on the latest situation.
    `,

    llm: new inference.LLM({
      model: 'google/gemma-4-31b-it',
    }),

    tools: [
      tool({
        name: 'createIncident',
        description:
          'Create a new emergency incident when the user clearly reports a new emergency situation.',

        parameters: z.object({
          type: z
            .enum([
              'FIRE',
              'MEDICAL',
              'ROAD_ACCIDENT',
              'GAS_LEAK',
              'NATURAL_DISASTER',
              'CRIME_OR_SECURITY',
              'INDUSTRIAL_ACCIDENT',
              'INFRASTRUCTURE_FAILURE',
              'OTHER',
            ])
            .describe('The type of emergency'),

          description: z
            .string()
            .describe(
              'A concise description of the emergency based on the user report',
            ),

          location: z
            .string()
            .nullable()
            .optional()
            .describe('The location of the emergency, if known'),

          peopleAffected: z
            .number()
            .nullable()
            .optional()
            .describe('Number of people affected, if known'),

          peopleTrapped: z
            .number()
            .nullable()
            .optional()
            .describe('Number of people trapped, if known'),

          immediateHazards: z
            .array(z.string())
            .optional()
            .describe(
              'Immediate hazards such as ACTIVE_FIRE, GAS_LEAK, LEAKING_FUEL, or CHEMICAL_SPILL',
            ),
        }),

        execute: async ({
          type,
          description,
          location,
          peopleAffected,
          peopleTrapped,
          immediateHazards,
        }) => {
          const incident = incidentManager.createIncident({
            type,
            description,
            location: location ?? null,
            peopleAffected: peopleAffected ?? null,
            peopleTrapped: peopleTrapped ?? null,
            immediateHazards: immediateHazards ?? [],
          });

          // Generate initial responder summary (hospital data will be added later)
          incident.responderSummary = generateResponderSummary(
            incident,
            sessionState.currentLocation,
            null,
          );

          console.log('AEGIS INCIDENT CREATED:', incident);

          // AUTOMATIC EMERGENCY ESCALATION
          // Fire-and-forget: trigger SMS + Voice call without blocking the
          // agent response to the user.
          const escalateAsync = async () => {
            try {
              const baseUrl =
                process.env.AEGIS_WEB_BASE_URL ?? 'http://localhost:3000';

              // Hospital intelligence runs in the background and can never
              // block the Twilio escalation. Resolve the best available
              // origin: browser GPS first, then the incident's spoken
              // location via geocoding.
              let origin: GeoLocation | null = sessionState.currentLocation;
              let locationSource: LocationSource = 'gps';
              if (!origin && incident.location) {
                try {
                  origin = await geocodeLocation(incident.location);
                  locationSource = 'geocoded';
                  console.log(
                    '[AEGIS] GPS unavailable; geocoded incident location for hospital search',
                  );
                } catch (error) {
                  console.warn(
                    '[AEGIS] Incident location geocoding failed:',
                    error instanceof Error ? error.message : String(error),
                  );
                }
              }

              let hospital: Hospital | null = null;
              let alternativeCount = 0;
              let hospitalStatus: 'available' | 'unavailable' = 'unavailable';
              if (origin) {
                try {
                  const hospitalResult = await findNearestSuitableHospital(
                    origin.latitude,
                    origin.longitude,
                    {
                      ...(origin.accuracy !== undefined
                        ? { accuracy: origin.accuracy }
                        : {}),
                      ...(origin.timestamp !== undefined
                        ? { timestamp: origin.timestamp }
                        : {}),
                      ...(origin.label !== undefined
                        ? { label: origin.label }
                        : {}),
                    },
                  );
                  hospital = hospitalResult.nearestHospital;
                  alternativeCount = hospitalResult.alternatives.length;
                  hospitalStatus = hospitalResult.hospitalStatus;
                  if (hospital) {
                    console.log(
                      `[AEGIS] Nearest suitable hospital for ${incident.id}: ${hospital.name} (${hospital.distanceKm} km)`,
                    );
                  } else {
                    console.warn(
                      `[AEGIS] Hospital search unavailable for ${incident.id}`,
                    );
                  }
                } catch (err) {
                  console.warn(
                    '[AEGIS] Hospital lookup failed during escalation:',
                    err instanceof Error ? err.message : String(err),
                  );
                }
              }

              // Send escalation request to the web backend for Twilio SMS + Voice.
              // Generate a complete responder summary including hospital data.
              const responderSummary = generateResponderSummary(
                incident,
                origin,
                hospital,
              );

              const escalationResponse = await fetch(`${baseUrl}/api/escalation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  incidentId: incident.id,
                  incidentType: incident.type,
                  incidentDescription: incident.description,
                  latitude: origin?.latitude,
                  longitude: origin?.longitude,
                  locationSource,
                  hospitalName: hospital?.name,
                  hospitalDistance: hospital ? `${hospital.distanceKm} km` : undefined,
                  hospitalStatus,
                  alternativeHospitalCount: alternativeCount,
                  hospital: hospital
                    ? {
                        name: hospital.name,
                        address: hospital.address,
                        latitude: hospital.latitude,
                        longitude: hospital.longitude,
                        phone: hospital.phone,
                        distanceKm: hospital.distanceKm,
                        distanceMeters: hospital.distanceMeters,
                        travelTimeMinutes: hospital.travelTimeMinutes,
                        isOpen: hospital.isOpen,
                        rating: hospital.rating,
                        mapsUrl: hospital.mapsUrl,
                      }
                    : null,
                  responderSummary,
                }),
              });

              const escalationBody = await escalationResponse.json().catch(() => null);

              if (!escalationResponse.ok) {
                console.error(
                  `[AEGIS] Escalation endpoint returned ${escalationResponse.status}:`,
                  escalationBody,
                );
              } else {
                console.log(
                  `[AEGIS] Escalation triggered for ${incident.id}`,
                  JSON.stringify(escalationBody),
                );
              }
            } catch (err) {
              console.error('[AEGIS] Escalation request failed:', err);
            }
          };

          escalateAsync();

          return JSON.stringify(incident);
        },
      }),

      tool({
        name: 'updateCurrentIncident',
        description:
          'Update the emergency incident currently being discussed. Use this for corrections or new details about the current emergency. The user does not need to provide an incident ID.',

        parameters: z.object({
          description: z
            .string()
            .optional()
            .describe('Updated description of the emergency'),

          location: z
            .string()
            .nullable()
            .optional()
            .describe('Updated location'),

          peopleAffected: z
            .number()
            .nullable()
            .optional()
            .describe('Updated number of people affected'),

          peopleTrapped: z
            .number()
            .nullable()
            .optional()
            .describe('Updated number of people trapped'),

          immediateHazards: z
            .array(z.string())
            .optional()
            .describe('Updated immediate hazards'),

          status: z
            .enum(['ACTIVE', 'RESPONDING', 'RESOLVED'])
            .optional()
            .describe('Updated incident status'),
        }),

        execute: async ({
          description,
          location,
          peopleAffected,
          peopleTrapped,
          immediateHazards,
          status,
        }) => {
          const incident = incidentManager.updateCurrentIncident({
            ...(description !== undefined ? { description } : {}),
            ...(location !== undefined ? { location } : {}),
            ...(peopleAffected !== undefined
              ? { peopleAffected }
              : {}),
            ...(peopleTrapped !== undefined
              ? { peopleTrapped }
              : {}),
            ...(immediateHazards !== undefined
              ? { immediateHazards }
              : {}),
            ...(status !== undefined ? { status } : {}),
          });

          if (!incident) {
            return 'No current incident exists to update.';
          }

          // Reflect the updated incident in the responder summary. Hospital and
          // location data are preserved because this update only changes
          // incident fields (people, hazards, description, status).
          incident.responderSummary = generateResponderSummary(
            incident,
            sessionState.currentLocation,
            null,
          );

          console.log('AEGIS CURRENT INCIDENT UPDATED:', incident);

          return JSON.stringify(incident);
        },
      }),

      tool({
        name: 'setCurrentLocation',
        description:
          "Set the user's current GPS location when the browser provides it, or update the current location when the user explicitly gives a location.",
        parameters: z.object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
          label: z.string().optional(),
          accuracy: z.number().positive().optional(),
          timestamp: z.union([z.string(), z.number()]).optional(),
        }),
        execute: async ({ latitude, longitude, label, accuracy, timestamp }) => {
          sessionState.currentLocation = {
            latitude,
            longitude,
            ...(label !== undefined ? { label } : {}),
            ...(accuracy !== undefined ? { accuracy } : {}),
            ...(timestamp !== undefined ? { timestamp } : {}),
          };
          return 'Current location updated.';
        },
      }),

      tool({
        name: 'findNearbyHospitals',
        description:
          "Find nearby hospitals using the user's current GPS location or the current incident location. Results are ordered by a transparent composite of available rating, review volume, and distance. Use this for requests such as nearby hospitals, hospitals around me, or hospitals near the incident.",
        parameters: z.object({
          radiusKm: z.number().min(1).max(50).default(10),
          location: z.string().nullable().optional().describe('Optional location name/address when GPS is unavailable'),
        }),
        execute: async ({ radiusKm, location }) => {
          const incident = incidentManager.getCurrentIncident();

          // GPS is the primary location source. The spoken place and the
          // incident location are fallbacks used in order when GPS is
          // unavailable or returns no results.
          const candidates: Array<{
            label: string;
            query: GeoLocation | string;
          }> = [];
          if (sessionState.currentLocation) {
            candidates.push({ label: 'browser GPS', query: sessionState.currentLocation });
          }
          if (location) {
            candidates.push({ label: `spoken "${location}"`, query: location });
          }
          if (incident?.location && incident.location !== location) {
            candidates.push({ label: `incident "${incident.location}"`, query: incident.location });
          }

          if (candidates.length === 0) {
            return 'I need your current location or the incident location before I can search nearby hospitals.';
          }

          let lastResult: HospitalSearchResult | null = null;
          for (const candidate of candidates) {
            try {
              const result = await findNearbyHospitals(candidate.query, radiusKm);
              lastResult = result;
              if (result.hospitals.length === 0) {
                console.log(`[AEGIS HOSPITAL] No results from ${candidate.label}`);
                continue;
              }

              sessionState.hospitals = result.hospitals;

              return JSON.stringify({
                count: result.hospitals.length,
                origin: result.origin,
                locationSource: result.locationSource,
                hospitals: result.hospitals.map((hospital, index) => ({
                  number: index + 1,
                  name: hospital.name,
                  address: hospital.address,
                  latitude: hospital.latitude,
                  longitude: hospital.longitude,
                  distanceKm: hospital.distanceKm,
                  distanceMeters: hospital.distanceMeters,
                  travelTimeMinutes: hospital.travelTimeMinutes,
                  isOpen: hospital.isOpen,
                  phone: hospital.phone,
                  rating: hospital.rating,
                  reviewCount: hospital.reviewCount,
                  source: hospital.source,
                  recommendationScore: Number(hospital.recommendationScore.toFixed(3)),
                  mapsUrl: hospital.mapsUrl,
                })),
              });
            } catch (error) {
              console.error(
                `[AEGIS HOSPITAL] Search failed for ${candidate.label}:`,
                error instanceof Error ? error.message : String(error),
              );
            }
          }

          if (lastResult) {
            return JSON.stringify({
              count: 0,
              hospitals: [],
              origin: lastResult.origin,
              locationSource: lastResult.locationSource,
            });
          }

          return 'Hospital search is temporarily unavailable. Please try again.';
        },
      }),

      tool({
        name: 'findNearestHospital',
        description:
          "Find the single nearest suitable hospital for emergency response based on real coordinates. Browser GPS is preferred; the spoken place and the incident location are used as fallbacks when GPS is unavailable. Returns the nearest suitable hospital, alternative hospitals, distance, travel time when available, opening status, phone, and a Google Maps route. Use this for requests such as 'nearest hospital' or 'where should I go'.",
        parameters: z.object({
          location: z
            .string()
            .nullable()
            .optional()
            .describe('Optional location name/address used only when GPS is unavailable'),
          radiusKm: z
            .number()
            .min(1)
            .max(50)
            .optional()
            .describe('Optional search radius in kilometers (defaults to 5, expanding to 10)'),
        }),
        execute: async ({ location, radiusKm }) => {
          const incident = incidentManager.getCurrentIncident();

          const resolveOrigin = async (): Promise<{
            origin: GeoLocation;
            source: LocationSource;
          } | null> => {
            if (sessionState.currentLocation) {
              return { origin: sessionState.currentLocation, source: 'gps' };
            }

            const candidates: Array<{ label: string; query: string }> = [];
            if (location) {
              candidates.push({ label: `spoken "${location}"`, query: location });
            }
            if (incident?.location && incident.location !== location) {
              candidates.push({
                label: `incident "${incident.location}"`,
                query: incident.location,
              });
            }

            for (const candidate of candidates) {
              try {
                const origin = await geocodeLocation(candidate.query);
                console.log(
                  `[AEGIS LOCATION] Geocoded ${candidate.label}:`,
                  origin.latitude,
                  origin.longitude,
                );
                return { origin, source: 'geocoded' };
              } catch (error) {
                console.error(
                  `[AEGIS LOCATION] Geocoding failed for ${candidate.label}:`,
                  error instanceof Error ? error.message : String(error),
                );
              }
            }

            return null;
          };

          const resolved = await resolveOrigin();
          if (!resolved) {
            return 'I need your current GPS location or the incident location before I can find the nearest hospital.';
          }

          try {
            const result = await findNearestSuitableHospital(
              resolved.origin.latitude,
              resolved.origin.longitude,
              {
                ...(resolved.origin.accuracy != null
                  ? { accuracy: resolved.origin.accuracy }
                  : {}),
                ...(resolved.origin.timestamp != null
                  ? { timestamp: resolved.origin.timestamp }
                  : {}),
                ...(resolved.origin.label != null ? { label: resolved.origin.label } : {}),
                ...(radiusKm != null ? { radiusKm } : {}),
              },
            );

            const allHospitals = result.nearestHospital
              ? [result.nearestHospital, ...result.alternatives]
              : [];
            sessionState.hospitals = allHospitals;

            if (result.hospitalStatus === 'unavailable' || !result.nearestHospital) {
              return JSON.stringify({
                hospitalStatus: 'unavailable',
                nearestHospital: null,
                alternatives: [],
                origin: {
                  latitude: result.origin.latitude,
                  longitude: result.origin.longitude,
                },
                locationSource: result.locationSource,
              });
            }

            return JSON.stringify({
              hospitalStatus: 'available',
              nearestHospital: serializeHospital(result.nearestHospital),
              alternatives: result.alternatives.map(serializeHospital),
              origin: {
                latitude: result.origin.latitude,
                longitude: result.origin.longitude,
              },
              locationSource: result.locationSource,
            });
          } catch (error) {
            console.error(
              '[AEGIS HOSPITAL] Nearest hospital search failed:',
              error instanceof Error ? error.message : String(error),
            );
            return JSON.stringify({
              hospitalStatus: 'unavailable',
              nearestHospital: null,
              alternatives: [],
            });
          }
        },
      }),

      tool({
        name: 'routeToHospital',
        description:
          'Open Google Maps directions to a hospital from the most recent hospital search. Use hospitalNumber for requests like the second hospital, or hospitalName for a named hospital. If neither is supplied, route to the top recommendation.',
        parameters: z.object({
          hospitalNumber: z.number().int().min(1).max(6).nullable().optional(),
          hospitalName: z.string().nullable().optional(),
        }),
        execute: async ({ hospitalNumber, hospitalName }) => {
          if (sessionState.hospitals.length === 0) {
            return 'I do not have a recent hospital list. Please ask me to find nearby hospitals first.';
          }

          let hospital: Hospital | undefined;
          if (hospitalNumber != null) {
            hospital = sessionState.hospitals[hospitalNumber - 1];
          } else if (hospitalName) {
            const target = hospitalName.toLowerCase();
            hospital = sessionState.hospitals.find((item) =>
              item.name.toLowerCase().includes(target),
            );
          } else {
            hospital = sessionState.hospitals[0];
          }

          if (!hospital) {
            return 'I could not match that hospital to the current hospital list.';
          }

          const url = googleMapsDirectionsUrl(
            hospital,
            sessionState.currentLocation ?? undefined,
          );
          if (sessionState.publishClientEvent) {
            await sessionState.publishClientEvent({
              type: 'route_to_hospital',
              hospital: {
                name: hospital.name,
                address: hospital.address,
                latitude: hospital.latitude,
                longitude: hospital.longitude,
              },
              url,
            });
          }

          return JSON.stringify({
            routed: true,
            name: hospital.name,
            distanceKm: hospital.distanceKm,
            travelTimeMinutes: hospital.travelTimeMinutes,
            url,
          });
        },
      }),

      tool({
        name: 'callEmergencyContact',
        description:
          'Place an outbound emergency phone call to the configured emergency contact. Use this when the user explicitly asks AEGIS to call an emergency contact, call an emergency number, call for help, or notify a family member. The destination is fixed server-side and cannot be changed.',
        parameters: z.object({}),
        execute: async () => {
          const baseUrl =
            process.env.AEGIS_WEB_BASE_URL ?? 'http://localhost:3000';
          const response = await fetch(`${baseUrl}/api/call`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'aegis-agent' }),
          });

          if (!response.ok) {
            console.warn(
              'AEGIS emergency call request rejected:',
              response.status,
              await response.text(),
            );
            return 'The emergency call could not be placed. Please contact emergency services directly.';
          }

          const result = (await response.json()) as { sid?: string };
          console.log('AEGIS emergency call request accepted:', result.sid);

          return 'The emergency contact has been called and notified. Response is being coordinated.';
        },
      }),

      tool({
        name: 'verifyEmergencySituation',
        description:
          'Run a deliberately slow, cancellable verification lookup for the interruption/recovery stress test. Use only when the user explicitly asks to verify the current emergency situation.',
        flags: ToolFlag.CANCELLABLE,
        parameters: z.object({
          delayMs: z
            .number()
            .int()
            .min(1000)
            .max(10000)
            .default(5000)
            .describe('Simulated verification delay in milliseconds'),
        }),
        execute: async ({ delayMs }, { ctx, abortSignal }) => {
          await ctx.update('Verification started. You can interrupt or correct the emergency at any time.');
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, delayMs);
            const onAbort = () => {
              clearTimeout(timer);
              reject(new DOMException('Verification cancelled', 'AbortError'));
            };

            if (abortSignal.aborted) {
              onAbort();
              return;
            }

            abortSignal.addEventListener('abort', onAbort, { once: true });
          });

          return 'Verification completed. Treat this result as valid only if the user has not corrected the emergency since the lookup began.';
        },
      }),

      tool({
        name: 'getCurrentIncident',
        description:
          'Get the latest structured information about the emergency currently being discussed.',

        parameters: z.object({}),

        execute: async () => {
          const incident = incidentManager.getCurrentIncident();

          if (!incident) {
            return 'No current incident exists.';
          }

          return JSON.stringify(incident);
        },
      }),

      tool({
        name: 'getIncident',
        description:
          'Get the latest structured information about a specific incident when its ID is already known internally.',

        parameters: z.object({
          id: z.string().describe('The incident ID'),
        }),

        execute: async ({ id }) => {
          const incident = incidentManager.getIncident(id);

          if (!incident) {
            return 'Incident not found.';
          }

          return JSON.stringify(incident);
        },
      }),

      tool({
        name: 'getActiveIncidents',
        description: 'Get all currently active emergency incidents.',

        parameters: z.object({}),

        execute: async () => {
          const incidents = incidentManager.getActiveIncidents();

          return JSON.stringify(incidents);
        },
      }),
    ],
  });
}