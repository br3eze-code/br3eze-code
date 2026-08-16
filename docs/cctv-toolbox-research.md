# CCTV Toolbox Research Notes

## Standards findings

- ONVIF Profile S covers basic IP video streaming and can include PTZ control, audio input, multicast, and relay outputs. ONVIF notes that Profile S is in deprecation transition, with the last product conformance submissions scheduled for March 31, 2027.
- ONVIF Profile T covers advanced video streaming, H.264/H.265, imaging settings, motion and tampering events, metadata streaming, bidirectional audio, HTTPS streaming, PTZ control, and related configuration.
- ONVIF Profile M covers metadata and events for analytics applications, including object classification, people/vehicle/license-plate/face/body metadata, event interfaces, MQTT transport, and rule configuration. Profile M can be combined with Profiles S and T.
- WebRTC is the browser-facing real-time media API. Its signaling channel is application-defined and commonly uses WebSocket or HTTP; the media connection uses ICE/STUN/TURN and DTLS-SRTP-style browser transport rather than exposing RTSP directly to the browser.

## Design consequences for AgentOS

- Keep vendor adapters behind a normalized CCTV facade. Add ONVIF as a provider capability rather than embedding Hikvision or Dahua assumptions in channel code.
- Treat RTSP URLs as server-side secrets. Do not return URLs containing device credentials to WebSocket clients or mini-apps. Prefer short-lived, server-minted playback tokens or a media gateway that exposes WebRTC/HLS endpoints.
- Model NVR channels as explicit resources with device, provider, channel, stream profile, codec, and authorization scope. Bound multi-channel fan-out and require authorization before channel enumeration or URL generation.
- Separate control-plane WebSocket messages from media-plane streaming. WebSocket should carry authenticated signaling, channel selection, stream status, and token exchange; WebRTC or a media gateway should carry video.
- Use capability detection for Profile S/T/M and vendor-specific fallbacks. Event and analytics tools should expose source, timestamp, event type, channel, confidence/metadata, and correlation identifiers.

## Sources

[1] ONVIF Profile S: https://www.onvif.org/profiles/profile-s/
[2] ONVIF Profile T: https://www.onvif.org/profiles/profile-t/
[3] ONVIF Profile M: https://www.onvif.org/profiles/profile-m/
[4] W3C WebRTC Recommendation: https://www.w3.org/TR/webrtc/

## Open-source implementation findings

- The `agsh/onvif` Node.js implementation supports ONVIF Profile S and G, NVR recording discovery, PTZ, events, WS-Discovery, and a Promise API. It is a strong candidate for an optional ONVIF provider adapter, but its examples show that device credentials are required for most operations and must remain server-side.
- Janus is a general-purpose WebRTC server with JSON signaling and pluggable server-side media/application plugins. It can provide a media-plane boundary for browser playback, but it is primarily Linux-oriented and is not officially supported on native Windows. This makes a browser-facing media gateway an optional deployment capability rather than a required Node-only dependency.
- ONVIF’s own resource page lists the Node.js `onvif` library and other implementations as external projects, confirming that AgentOS should isolate third-party protocol clients behind provider adapters.

## Additional sources

[5] agsh/onvif Node.js implementation: https://github.com/agsh/onvif
[6] Janus Gateway repository: https://github.com/meetecho/janus-gateway
[7] Janus documentation: https://janus.conf.meetecho.com/
[8] ONVIF developer resources: https://www.onvif.org/resources/
