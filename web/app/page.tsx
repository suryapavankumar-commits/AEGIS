"use client";

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, TranscriptionSegment } from "livekit-client";

type IncidentState = {
  type: string;
  location: string;
  affected: string;
  hazard: string;
  summary: string;
};

const INITIAL_INCIDENT: IncidentState = {
  type: "AWAITING REPORT",
  location: "NOT ESTABLISHED",
  affected: "UNKNOWN",
  hazard: "UNKNOWN",
  summary: "Start the live voice console. AEGIS will listen for the emergency report and keep the conversation visible here.",
};

export default function Home() {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("PRESS TO START LIVE AEGIS");
  const [transcript, setTranscript] = useState("");
  const [booted, setBooted] = useState(false);
  const [incident, setIncident] = useState(INITIAL_INCIDENT);
  const roomRef = useRef<Room | null>(null);
  const audioElementsRef = useRef<HTMLAudioElement[]>([]);
  const connectingRef = useRef(false);

  const cleanupAudio = () => {
    audioElementsRef.current.forEach((element) => {
      element.pause();
      element.srcObject = null;
      element.remove();
    });
    audioElementsRef.current = [];
  };

  const generateRoomName = () =>
    `aegis-emergency-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const startVoiceSession = async () => {
    if (connectingRef.current || roomRef.current) return;
    connectingRef.current = true;

    try {
      setStatus("CONNECTING TO AEGIS...");
      setTranscript("");
      setIncident(INITIAL_INCIDENT);
      const roomName = generateRoomName();
      const response = await fetch(`/api/token?room=${encodeURIComponent(roomName)}`);
      if (!response.ok) throw new Error("Failed to get LiveKit token");
      const data = await response.json();
      const room = new Room();

      room.on(RoomEvent.TranscriptionReceived, (segments: TranscriptionSegment[]) => {
        for (const segment of segments) {
          if (segment.final && segment.text.trim()) {
            setTranscript((previous) => `${previous} ${segment.text}`.trim().slice(-2500));
          }
        }
      });

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        const audioElement = track.attach();
        audioElement.autoplay = true;
        audioElement.volume = 1;
        document.body.appendChild(audioElement);
        audioElementsRef.current.push(audioElement);
        audioElement.play().catch(console.error);
        if (roomRef.current === room) setStatus("AEGIS IS SPEAKING");
      });

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        track.detach().forEach((element) => {
          element.remove();
          audioElementsRef.current = audioElementsRef.current.filter((audio) => audio !== element);
        });
      });

      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current !== room) return;
        cleanupAudio();
        roomRef.current = null;
        connectingRef.current = false;
        setActive(false);
        setStatus("PRESS TO START LIVE AEGIS");
      });

      room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        if (topic !== "aegis.navigation") return;
        try {
          const message = JSON.parse(new TextDecoder().decode(payload)) as { type?: string; url?: string };
          if (message.type === "route_to_hospital" && message.url) {
            const opened = window.open(message.url, "_blank", "noopener,noreferrer");
            if (!opened) window.location.assign(message.url);
          }
        } catch (error) {
          console.error("Invalid AEGIS navigation message:", error);
        }
      });

      await room.connect(data.url, data.token);
      roomRef.current = room;
      await room.startAudio();
      await room.localParticipant.setMicrophoneEnabled(true);

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            try {
              const payload = new TextEncoder().encode(JSON.stringify({
                type: "location",
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                timestamp: position.timestamp,
              }));
              await room.localParticipant.publishData(payload, { reliable: true, topic: "aegis.location" });
              setIncident((current) => ({ ...current, location: "LIVE GPS SHARED" }));
            } catch (error) {
              console.warn("Could not share location with AEGIS:", error);
            }
          },
          (error) => console.warn("Browser location unavailable:", error.message),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
        );
      }

      setActive(true);
      setStatus("CONNECTED — AEGIS IS LISTENING");
    } catch (error) {
      console.error("AEGIS connection error:", error);
      cleanupAudio();
      if (roomRef.current) roomRef.current.disconnect();
      roomRef.current = null;
      setActive(false);
      setStatus("CONNECTION FAILED — TRY AGAIN");
    } finally {
      connectingRef.current = false;
    }
  };

  const stopVoiceSession = async () => {
    const room = roomRef.current;
    roomRef.current = null;
    setActive(false);
    setStatus("ENDING SESSION...");
    if (room) {
      try { await room.localParticipant.setMicrophoneEnabled(false); } catch {}
      room.disconnect();
    }
    cleanupAudio();
    setStatus("PRESS TO START LIVE AEGIS");
  };

  const toggleVoiceSession = () => active || roomRef.current ? stopVoiceSession() : startVoiceSession();

  useEffect(() => {
    const preloader = document.getElementById("preloader");
    const bar = document.getElementById("loaderBar") as HTMLElement | null;
    const percent = document.getElementById("loaderPercent");
    const loaderStatus = document.getElementById("loaderStatus");
    const messages = ["SIGNAL / 00", "AUDIO / 12", "VOICE / 31", "MEMORY / 57", "INCIDENT / 79", "AEGIS / 100"];
    const start = performance.now();
    const duration = 2350;
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const value = Math.floor(eased * 100);
      if (bar) bar.style.width = `${value}%`;
      if (percent) percent.textContent = String(value).padStart(3, "0");
      if (loaderStatus) loaderStatus.textContent = messages[Math.min(messages.length - 1, Math.floor(value / 20))];
      if (p < 1) frame = requestAnimationFrame(tick);
      else setTimeout(() => { preloader?.classList.add("exit"); setTimeout(() => preloader?.classList.add("open"), 760); setTimeout(() => { preloader?.classList.add("done"); setBooted(true); }, 2250); }, 260);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const progress = document.getElementById("progress");
    const update = () => {
      const h = document.documentElement.scrollHeight - innerHeight;
      if (progress) progress.style.width = `${h > 0 ? (scrollY / h) * 100 : 0}%`;
      document.body.classList.toggle("fast-scroll", false);
    };
    addEventListener("scroll", update, { passive: true });
    update();
    return () => removeEventListener("scroll", update);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add("in")), { threshold: 0.12 });
    document.querySelectorAll(".reveal,.clip").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [booted]);

  useEffect(() => {
    const cursor = document.querySelector(".cursor") as HTMLElement | null;
    const cursorText = document.querySelector(".cursorText") as HTMLElement | null;
    const move = (e: MouseEvent) => {
      if (!cursor || !cursorText) return;
      cursor.style.left = `${e.clientX}px`; cursor.style.top = `${e.clientY}px`;
      cursorText.style.left = `${e.clientX}px`; cursorText.style.top = `${e.clientY}px`;
    };
    const enter = () => document.body.classList.add("pointer");
    const leave = () => document.body.classList.remove("pointer");
    addEventListener("mousemove", move);
    const controls = document.querySelectorAll("a,button,.step,.cell");
    controls.forEach((el) => { el.addEventListener("mouseenter", enter); el.addEventListener("mouseleave", leave); });
    return () => { removeEventListener("mousemove", move); controls.forEach((el) => { el.removeEventListener("mouseenter", enter); el.removeEventListener("mouseleave", leave); }); };
  }, [booted, active]);

  useEffect(() => () => { const room = roomRef.current; roomRef.current = null; room?.disconnect(); cleanupAudio(); }, []);

  return <>
    <div id="progress" />
    <div className="signalRail left"><i /></div><div className="signalRail right"><i /></div>
    <div className="cursor" /><div className="cursorText">OPEN / AEGIS</div>

    <div id="preloader">
      <div className="loaderGrid" /><div className="loaderNoise" /><div className="loaderScan" />
      <div className="loaderCorner top"><span>AEGIS / VOICE-NATIVE EMERGENCY COORDINATION</span><span>BOOT / 001</span></div>
      <div className="loaderCore">
        <div className="loaderMeta"><span>SYSTEM INITIALIZATION</span><span>INDIA / LIVE</span></div>
        <div className="loaderLogoWrap"><div className="loaderMark"><span className="markE"/><span className="markG"/><span className="markI"/><span className="markS"/></div><div className="loaderLogo clipLoader"><span>AEGIS</span></div></div>
        <div className="loaderLine"><i id="loaderBar" /></div>
        <div className="loaderPercent"><span id="loaderStatus">SIGNAL / 00</span><strong id="loaderPercent">000</strong></div>
        <div className="bootGlyph">LISTEN · UNDERSTAND · ADAPT · COORDINATE</div>
      </div>
      <div className="loaderCorner bottom"><span>REAL-TIME INCIDENT STATE</span><span>WHEN EVERY SECOND MATTERS</span></div>
      <div className="loaderCurtain curtainLeft"/><div className="loaderCurtain curtainRight"/><div className="loaderFlash"/>
    </div>

    <nav className="nav">
      <div className="brand">AEGIS</div>
      <div className="status"><i /><span>{active ? "LIVE / ACTIVE" : "SYSTEM / STANDBY"}</span></div>
      <div className="links"><a href="#idea">THE IDEA</a><a href="#flow">FLOW</a><a href="#intel">INTELLIGENCE</a><a href="#live">LIVE CONSOLE</a></div>
    </nav>

    <main>
      <section className="hero">
        <div className="heroLeft">
          <div>
            <div className="heroTop tiny"><span>01 / VOICE-NATIVE EMERGENCY COORDINATION</span><span>AEGIS / 2026</span></div>
            <h1 className="heroTitle">WHEN<br/>EVERY<br/><span className="red">SECOND</span><br/>MATTERS.</h1>
            <div className="heroSub"><p>AEGIS listens to spoken emergency reports and turns rapidly changing information into a current, structured incident picture.</p><p>Built for pressure: fewer forms, fewer assumptions, one clear operational story that evolves as new information arrives.</p></div>
          </div>
          <a className="heroCta" href="#live">ENTER LIVE CONSOLE ↘</a>
        </div>
        <div className="heroRight" id="live">
          <div className="signal" />
          <div className="liveConsole">
            <div className="liveConsoleHead tiny"><span>AEGIS / LIVE VOICE CONSOLE</span><span><i className="liveDot" />{active ? "LIVE" : "READY"}</span></div>
            <div className="orbWrap"><button onClick={toggleVoiceSession} className="orb" aria-label={active ? "Stop AEGIS voice session" : "Start AEGIS voice session"}><span className="mic"><svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round"><rect x="8" y="2" width="8" height="12" rx="4"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"/></svg></span></button></div>
            <div className="liveTranscript">{transcript}</div>
            <div className="liveConsoleFoot"><span className="liveStatus"><i />{status}</span><button onClick={toggleVoiceSession} className={`liveConsoleButton ${active ? "stop" : ""}`}>{active ? "END SESSION" : "START AEGIS"}</button></div>
          </div>
        </div>
      </section>

      <section id="idea" className="section idea">
        <div className="sectionNo">02</div><div className="ideaIntro tiny"><span>The problem</span><span>Emergency communication breaks under pressure.</span></div>
        <div className="ideaGrid"><h2 className="reveal">Emergency<br/>stories<br/><span style={{color:"var(--red)"}}>move.</span></h2><div className="ideaCopy"><p className="reveal">A person in an emergency does not experience a stable form. Details arrive out of order. Locations change. Hazards appear after the first report. People correct themselves.</p><p className="reveal">AEGIS is designed for that condition: a moving, uncertain situation. Voice stays natural while the system keeps shaping what was said into a current incident record.</p></div></div>
      </section>

      <section id="flow" className="section flow"><div className="flowIntro tiny"><span>03 / The operating loop</span><span>Four movements / One live state</span></div><div className="steps">
        {[['01','Listen.','Voice is the fastest interface when hands, attention and time are limited.'],['02','Understand.','The conversation becomes structured information: type, location, people, hazards and unknowns.'],['03','Adapt.','When the situation changes, AEGIS updates the current incident instead of creating a second version.'],['04','Coordinate.','The result is a concise operational picture: what is happening, where, who is affected and what matters next.']].map(([n,t,p])=><article className="step reveal" key={n}><div className="stepNum">{n}</div><h3>{t}</h3><p>{p}</p><div className="stepLine"><i /></div></article>)}
      </div></section>

      <section id="intel" className="section intel"><div className="intelCopy"><div><div className="kicker reveal">04 / Emergency intelligence</div><h2 className="reveal">Chaos<br/>in.<br/><span style={{color:"var(--red)"}}>Clarity out.</span></h2></div><p className="reveal">The panel below is connected to this browser session: the transcript updates live, and the location status updates when browser GPS is shared with the AEGIS agent.</p></div>
        <div className="dashboard"><div className="panel reveal"><div className="panelTop tiny"><span>INCIDENT / CURRENT STATE</span><span><i className="liveDot" />{active ? "LIVE" : "STANDBY"}</span></div><div className="panelGrid">
          <div className="cell red"><div className="tiny">Emergency type</div><div className="value">{incident.type}</div></div><div className="cell"><div className="tiny">Location</div><div className="value">{incident.location}</div></div><div className="cell"><div className="tiny">People affected</div><div className="value">{incident.affected}</div></div><div className="cell"><div className="tiny">Immediate hazards</div><div className="value">{incident.hazard}</div></div><div className="cell summary"><div className="tiny">Situation summary</div><div className="value">{transcript || incident.summary}</div></div>
        </div></div></div>
      </section>

      <section className="story section"><div className="storyInner"><div className="storyLabel tiny">05 / A situation changes<br/><br/>AEGIS keeps one current story.</div><div className="storyMain"><h2 className="reveal">The first<br/>sentence is<br/>never the<br/><span style={{color:"#ff2b16"}}>whole truth.</span></h2><div className="timeline">
        <div className="event reveal"><div className="time">00:00 / REPORT</div><div><h3>“There is smoke in the building.”</h3><p>AEGIS identifies a possible fire and begins asking for the most important missing detail: location.</p></div></div>
        <div className="event reveal"><div className="time">00:18 / CORRECTION</div><div><h3>“Actually, it is the fourth floor.”</h3><p>The location is updated. The system does not duplicate the incident; it corrects the current record.</p></div></div>
        <div className="event reveal"><div className="time">00:41 / ESCALATION</div><div><h3>“One person may still be inside.”</h3><p>The affected-person picture changes. AEGIS surfaces the newest critical information as the situation evolves.</p></div></div>
      </div></div></div></section>

      <section className="section principles"><div className="label tiny">06 / Design principles<br/><br/>Built for pressure</div><div className="principlesMain"><article className="principle reveal"><h3>Calm, not robotic.</h3><p>Emergency communication needs confidence without unnecessary words. AEGIS keeps responses concise, asks one important question at a time and avoids pretending to know what it does not know.</p></article><article className="principle reveal"><h3>Current, not cumulative.</h3><p>A growing transcript is useful, but an operator needs the current state. AEGIS continuously turns changing speech into a single, updateable incident picture.</p></article><article className="principle reveal"><h3>Human, not autonomous fantasy.</h3><p>AEGIS is a coordination layer, not a replacement for professional emergency services. It should never claim that help has been contacted unless that action is actually confirmed.</p></article></div></section>

      <section id="demo" className="section demo"><div className="demoCopy"><div className="kicker">07 / See the conversation</div><h2>Speak.<br/>Watch it<br/><span style={{color:"var(--red)"}}>become</span><br/>structure.</h2><p>The live console above uses your existing LiveKit voice session. This visual sequence shows the interaction model AEGIS is designed around: report, clarification, correction, escalation.</p><a className="demoButton" href="#live">OPEN LIVE CONSOLE ↗</a></div><div className="demoScreen"><div className="demoWindow"><div className="demoBar tiny"><span>VOICE TRANSCRIPT / LIVE</span><span>{active ? "LIVE" : "00:00"}</span></div><div className="transcript"><div className="msg show user"><div className="tag">USER / REPORT</div>“There is a fire somewhere in the building—wait, I think it is on the fourth floor.”</div><div className="msg show aegis"><div className="tag">AEGIS / CLARIFY</div>“Understood. Fourth floor. Are people still inside?”</div><div className="msg show user"><div className="tag">USER / UPDATE</div>“Most are getting out. I think one person is still inside.”</div><div className="msg show aegis"><div className="tag">AEGIS / CURRENT STATE</div>“I have updated the incident. One person may still be inside.”</div></div><div className="demoState"><span className="liveDot" />{active ? "LIVE / CONNECTED TO AEGIS" : "READY / PRESS START ABOVE"}</div></div></div></section>

      <footer className="final"><div className="finalTop tiny"><span>AEGIS / VOICE-NATIVE EMERGENCY COORDINATION</span><span>END / 001</span></div><div><div className="kicker">A better emergency interface starts with a better question.</div><h2>When every<br/>second <span>matters.</span></h2></div><div className="finalBottom"><div className="tiny">AEGIS / 2026 / LISTEN · UNDERSTAND · ADAPT · COORDINATE</div><div><a href="#idea">THE IDEA ↗</a> <a href="#flow">HOW IT WORKS ↗</a> <a href="#live">LIVE CONSOLE ↗</a></div></div></footer>
    </main>
  </>;
}
