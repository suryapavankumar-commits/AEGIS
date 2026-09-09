import { NextRequest, NextResponse } from "next/server";

// Duplicate-call guard. The destination is fixed server-side and cannot be
// overridden by the browser, so repeated triggers within the cooldown window
// are treated as duplicates and ignored.
const CALL_COOLDOWN_MS = 15_000;
let lastCallAt: number | null = null;

const toE164 = (value: string): string => {
  // Normalize a phone number such as "+1(864) 387-4731" or "+919008430189"
  // to E.164 ("+18643874731").
  const digits = String(value).replace(/[^\d]/g, "");
  if (digits.startsWith("00")) {
    return `+${digits.slice(2)}`;
  }
  return `+${digits}`;
};

export async function POST(request: NextRequest) {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
    const emergencyPhone = process.env.EMERGENCY_PHONE_NUMBER;

    if (!accountSid || !authToken || !twilioPhone || !emergencyPhone) {
      return NextResponse.json(
        { error: "Call service is not configured." },
        { status: 500 }
      );
    }

    // Duplicate-call prevention.
    const now = Date.now();
    if (lastCallAt !== null && now - lastCallAt < CALL_COOLDOWN_MS) {
      return NextResponse.json(
        { error: "An emergency call is already in progress." },
        { status: 429 }
      );
    }

    // The destination number is read only from the server environment. Any
    // body sent by the client is deliberately ignored so the browser cannot
    // override who is called.
    const destination = toE164(emergencyPhone);
    const from = toE164(twilioPhone);

    const twilio = await import("twilio");
    const client = twilio.default(accountSid, authToken);

    const call = await client.calls.create({
      to: destination,
      from,
      twiml:
        "<Response><Say voice='alice'>This is AEGIS, your emergency assistant. " +
        "An emergency situation has been reported and response is being coordinated. " +
        "Please stand by.</Say></Response>",
    });

    lastCallAt = now;

    console.log("AEGIS emergency call placed:", call.sid);

    return NextResponse.json({
      ok: true,
      sid: call.sid,
      to: destination,
    });
  } catch (error) {
    console.error("AEGIS emergency call failed:", error);
    return NextResponse.json(
      { error: "Failed to place the emergency call." },
      { status: 500 }
    );
  }
}
