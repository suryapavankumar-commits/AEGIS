import { NextRequest, NextResponse } from "next/server";

const ESCALATION_COOLDOWN_MS = 5 * 60_000;
const escalatedIncidents = new Map<string, number>();

const toE164 = (value: string): string => {
  const digits = String(value).replace(/[^\d]/g, "");
  if (digits.startsWith("00")) {
    return `+${digits.slice(2)}`;
  }
  return `+${digits}`;
};

function extractTwilioError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const code = e.code ?? e.ErrorCode;
    const message = e.message ?? e.Message;
    const status = e.status ?? e.StatusCode;
    const parts: string[] = [];
    if (status) parts.push(`HTTP ${status}`);
    if (code) parts.push(`Code ${code}`);
    if (message) parts.push(String(message));
    if (parts.length > 0) return parts.join(" | ");
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function POST(request: NextRequest) {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
    const emergencyPhone = process.env.EMERGENCY_PHONE_NUMBER;

    console.log("[AEGIS SMS] Attempting SMS");
    console.log("[AEGIS SMS] From configured:", Boolean(twilioPhone));
    console.log("[AEGIS SMS] To configured:", Boolean(emergencyPhone));

    if (!accountSid || !authToken || !twilioPhone || !emergencyPhone) {
      console.error("[AEGIS SMS] Failed: missing Twilio environment variables");
      return NextResponse.json(
        { error: "Emergency escalation service is not configured." },
        { status: 500 }
      );
    }

    const body = await request.json();
    const {
      incidentId,
      latitude,
      longitude,
      hospitalName,
      hospitalDistance,
      hospital,
      incidentType,
      incidentDescription,
      responderSummary,
    } = body as {
      incidentId?: string;
      latitude?: number;
      longitude?: number;
      hospitalName?: string;
      hospitalDistance?: string;
      incidentType?: string;
      incidentDescription?: string;
      responderSummary?: {
        incidentId?: string;
        incidentType?: string;
        severity?: string;
        location?: {
          latitude?: number | null;
          longitude?: number | null;
          accuracy?: number | null;
          humanReadable?: string | null;
          mapsUrl?: string | null;
        };
        userDescription?: string;
        peopleInvolved?: number | null;
        injuryStatus?: string;
        consciousnessStatus?: string;
        trappedStatus?: string;
        hazards?: string[];
        nearestHospital?: {
          name?: string | null;
          distance?: string | null;
          eta?: string | null;
          address?: string | null;
          phone?: string | null;
          mapsUrl?: string | null;
        } | null;
        responseStatus?: string;
      };
      hospital?: {
        name?: string;
        address?: string;
        phone?: string;
        distanceKm?: number;
        distanceMeters?: number;
        travelTimeMinutes?: number | null;
        isOpen?: boolean | null;
        rating?: number | null;
        mapsUrl?: string;
      } | null;
    };

    if (incidentId) {
      const lastEscalated = escalatedIncidents.get(incidentId);
      if (
        lastEscalated &&
        Date.now() - lastEscalated < ESCALATION_COOLDOWN_MS
      ) {
        console.log(
          `[AEGIS SMS] Duplicate escalation blocked for ${incidentId}`
        );
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: "duplicate",
        });
      }
    }

    const destination = toE164(emergencyPhone);
    const from = toE164(twilioPhone);

    const incidentMapsUrl =
      typeof latitude === "number" && typeof longitude === "number"
        ? `https://www.google.com/maps?q=${latitude},${longitude}`
        : null;

    const effectiveHospitalName = hospital?.name || hospitalName;
    const effectiveHospitalDistance =
      hospital?.distanceKm != null
        ? `${hospital.distanceKm} km`
        : hospitalDistance;

    // When a responder summary is provided, use it as the SMS body so
    // responders get a concise, structured picture of the incident. Fall back
    // to the original body format when the summary is absent.
    let smsBody: string;

    if (responderSummary) {
      const lines: string[] = [];

      lines.push("AEGIS EMERGENCY ALERT");
      lines.push("");

      const incidentLabel =
        responderSummary.incidentType || incidentDescription || incidentType;
      lines.push(`INCIDENT: ${incidentLabel}`);
      if (responderSummary.severity) {
        lines.push(`SEVERITY: ${responderSummary.severity}`);
      }
      if (responderSummary.incidentId) {
        lines.push(`ID: ${responderSummary.incidentId}`);
      }

      if (responderSummary.userDescription) {
        lines.push("");
        lines.push("What happened:");
        lines.push(responderSummary.userDescription);
      }

      const humanReadable = responderSummary.location?.humanReadable;
      if (humanReadable) {
        lines.push("");
        lines.push("Location:");
        lines.push(humanReadable);
      }

      const maps = responderSummary.location?.mapsUrl || incidentMapsUrl;
      if (maps) {
        lines.push(maps);
      }

      if (responderSummary.peopleInvolved != null) {
        lines.push("");
        lines.push(`People involved: ${responderSummary.peopleInvolved}`);
      }

      lines.push("");
      lines.push(
        `Injury: ${responderSummary.injuryStatus || "Unknown"}`
      );
      lines.push(
        `Conscious: ${responderSummary.consciousnessStatus || "Unknown"}`
      );
      lines.push(
        `Trapped: ${responderSummary.trappedStatus || "Unknown"}`
      );

      if (
        responderSummary.hazards &&
        responderSummary.hazards.length > 0
      ) {
        lines.push("");
        lines.push(`Hazards: ${responderSummary.hazards.join(", ")}`);
      }

      const nh = responderSummary.nearestHospital;
      const nhName = nh?.name || effectiveHospitalName;
      if (nhName) {
        lines.push("");
        lines.push(`Nearest Hospital: ${nhName}`);

        const distance =
          nh?.distance || effectiveHospitalDistance;
        if (distance) {
          lines.push(`Distance: ${distance}`);
        }

        if (nh?.eta) {
          lines.push(`ETA: ${nh.eta}`);
        }

        if (nh?.address || hospital?.address) {
          lines.push(`Address: ${nh?.address || hospital?.address}`);
        }

        if (nh?.phone || hospital?.phone) {
          lines.push(`Phone: ${nh?.phone || hospital?.phone}`);
        }

        if (nh?.mapsUrl || hospital?.mapsUrl) {
          lines.push(nh?.mapsUrl || hospital?.mapsUrl || "");
        }
      }

      lines.push("");
      lines.push(
        `Status: ${responderSummary.responseStatus || "Emergency contact notified"}`
      );

      smsBody = lines.join("\n");
    } else {
      smsBody = "AEGIS EMERGENCY ALERT\n\nEmergency detected.";

      const incidentLabel = incidentDescription || incidentType;
      if (incidentLabel) {
        smsBody += `\n\nIncident:\n${incidentLabel}`;
      }

      if (incidentMapsUrl) {
        smsBody += `\n\nLocation:\n${incidentMapsUrl}`;
      }

      if (effectiveHospitalName) {
        smsBody += `\n\nNearest suitable hospital:\n${effectiveHospitalName}`;
      }

      if (effectiveHospitalDistance) {
        smsBody += `\n\nDistance:\n${effectiveHospitalDistance}`;
      }

      if (hospital?.travelTimeMinutes != null) {
        smsBody += `\n\nEstimated travel time:\n${hospital.travelTimeMinutes} minutes by road`;
      }

      if (hospital?.address) {
        smsBody += `\n\nHospital address:\n${hospital.address}`;
      }

      if (hospital?.phone) {
        smsBody += `\n\nHospital phone:\n${hospital.phone}`;
      }

      if (hospital?.mapsUrl) {
        smsBody += `\n\nHospital route:\n${hospital.mapsUrl}`;
      }

      smsBody += "\n\nPlease respond immediately.";
    }

    let voiceMessage =
      "Emergency alert from AEGIS. An emergency has been detected. ";
    if (incidentMapsUrl) {
      voiceMessage +=
        "The user's current location has been sent by SMS. ";
    }
    if (effectiveHospitalName) {
      voiceMessage += `The nearest suitable hospital is ${effectiveHospitalName}. `;
    }
    if (effectiveHospitalDistance) {
      voiceMessage += `It is approximately ${effectiveHospitalDistance} away. `;
    }
    if (hospital?.travelTimeMinutes != null) {
      voiceMessage += `Estimated travel time is about ${hospital.travelTimeMinutes} minutes. `;
    }
    voiceMessage += "Please respond immediately.";

    const twiml = `<Response><Say voice='alice'>${voiceMessage}</Say></Response>`;

    const twilio = await import("twilio");
    const client = twilio.default(accountSid, authToken);

    console.log("[AEGIS SMS] Twilio request started");

    const results = await Promise.allSettled([
      client.messages.create({
        to: destination,
        from,
        body: smsBody,
      }),
      client.calls.create({
        to: destination,
        from,
        twiml,
      }),
    ]);

    const smsResult = results[0];
    const callResult = results[1];

    if (smsResult.status === "fulfilled") {
      console.log("[AEGIS SMS] Success:", smsResult.value.sid);
    } else {
      console.error("[AEGIS SMS] Failed:", extractTwilioError(smsResult.reason));
    }

    if (callResult.status === "fulfilled") {
      console.log("[AEGIS] Emergency call initiated:", callResult.value.sid);
    } else {
      console.error(
        "[AEGIS] Emergency call failed:",
        extractTwilioError(callResult.reason)
      );
    }

    if (incidentId) {
      escalatedIncidents.set(incidentId, Date.now());
    }

    if (escalatedIncidents.size > 100) {
      const cutoff = Date.now() - ESCALATION_COOLDOWN_MS;
      for (const [id, timestamp] of escalatedIncidents) {
        if (timestamp < cutoff) {
          escalatedIncidents.delete(id);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      sms:
        smsResult.status === "fulfilled"
          ? { sid: smsResult.value.sid }
          : { error: extractTwilioError(smsResult.reason) },
      call:
        callResult.status === "fulfilled"
          ? { sid: callResult.value.sid }
          : { error: extractTwilioError(callResult.reason) },
    });
  } catch (error) {
    console.error("[AEGIS SMS] Failed:", error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      { error: "Emergency escalation failed." },
      { status: 500 }
    );
  }
}
