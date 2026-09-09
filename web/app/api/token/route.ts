import { AccessToken, RoomConfiguration } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const roomName =
      request.nextUrl.searchParams.get("room") ||
      "aegis-emergency-room";

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !livekitUrl) {
      return NextResponse.json(
        { error: "Missing LiveKit environment variables" },
        { status: 500 }
      );
    }

    // Create a unique participant identity
    const identity = `user-${Date.now()}`;

    const token = new AccessToken(apiKey, apiSecret, {
      identity,
      name: "AEGIS User",
    });

    // Allow the user to join the room
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
    });

    // IMPORTANT: Dispatch our AEGIS agent to this room
    token.roomConfig = new RoomConfiguration({
      agents: [
        {
          agentName: "my-agent",
        },
      ],
    });

    const jwt = await token.toJwt();

    return NextResponse.json({
      token: jwt,
      url: livekitUrl,
    });
  } catch (error) {
    console.error("Token generation error:", error);

    return NextResponse.json(
      { error: "Failed to generate token" },
      { status: 500 }
    );
  }
}