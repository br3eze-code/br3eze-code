/**
 * Simulated RouterOS diagnostics for TinyGPT/AgentOS.
 *
 * This is a lab adapter, not an execution runtime and not a RouterOS client.
 * The canonical AgentRuntime remains responsible for planning, authorization,
 * tool execution, lifecycle, approvals and persistence.
 */
const FAULTS = new Set([
  "healthy",
  "wan-link-down",
  "default-route-missing",
  "dhcp-pool-exhausted",
  "dns-misconfigured"
]);

const TOOL_SCHEMAS = Object.freeze({
  "routeros.getInterfaces": {
    type: "object", properties: {}, additionalProperties: false
  },
  "routeros.getRoutes": {
    type: "object", properties: {}, additionalProperties: false
  },
  "routeros.getDhcp": {
    type: "object", properties: {}, additionalProperties: false
  },
  "routeros.getDns": {
    type: "object", properties: {}, additionalProperties: false
  },
  "routeros.probeConnectivity": {
    type: "object",
    properties: { target: { type: "string", enum: ["gateway", "public-ip", "dns-name"] } },
    required: ["target"],
    additionalProperties: false
  }
});

const clone = value => JSON.parse(JSON.stringify(value));

/**
 * Each lab instance has private ground truth. Tool results intentionally never
 * include faultId/rootCause; only the evaluator can access the hidden label.
 */
export function createSimulatedRouterOSLab({ fault = "healthy" } = {}) {
  if (!FAULTS.has(fault)) throw new TypeError(`Unsupported simulated fault: ${fault}`);
  const state = {
    interfaces: [
      { name: "ether1-wan", running: fault !== "wan-link-down", role: "wan" },
      { name: "bridge-lan", running: true, role: "lan" }
    ],
    routes: fault === "default-route-missing" ? [] : [
      { dst: "0.0.0.0/0", gateway: "198.51.100.1", active: fault !== "wan-link-down" }
    ],
    dhcp: {
      serverRunning: true,
      poolCapacity: 100,
      activeLeases: fault === "dhcp-pool-exhausted" ? 100 : 18,
      offersObserved: fault !== "dhcp-pool-exhausted"
    },
    dns: {
      allowRemoteRequests: true,
      servers: fault === "dns-misconfigured" ? [] : ["192.0.2.53"],
      resolutionWorks: fault !== "dns-misconfigured"
    },
    probes: {
      gateway: true,
      publicIp: fault !== "wan-link-down" && fault !== "default-route-missing",
      dnsName: fault !== "wan-link-down" && fault !== "default-route-missing" && fault !== "dns-misconfigured"
    }
  };

  const observations = Object.freeze({
    "routeros.getInterfaces": () => clone(state.interfaces),
    "routeros.getRoutes": () => clone(state.routes),
    "routeros.getDhcp": () => clone(state.dhcp),
    "routeros.getDns": () => clone(state.dns),
    "routeros.probeConnectivity": ({ target }) => {
      if (target === "gateway") return { target, reachable: state.probes.gateway };
      if (target === "public-ip") return { target, reachable: state.probes.publicIp };
      return { target, reachable: state.probes.dnsName };
    }
  });

  const tools = Object.entries(TOOL_SCHEMAS).map(([name, parameters]) => Object.freeze({
    name,
    description: `Read-only simulated RouterOS diagnostic: ${name}`,
    parameters,
    risk: "read-only",
    permissions: ["network:read"],
    execute(args = {}) {
      if (name !== "routeros.probeConnectivity" && Object.keys(args).length) {
        throw new TypeError(`${name} accepts no arguments`);
      }
      if (name === "routeros.probeConnectivity" && !["gateway", "public-ip", "dns-name"].includes(args.target)) {
        throw new TypeError("target must be gateway, public-ip, or dns-name");
      }
      return observations[name](args);
    }
  }));

  return Object.freeze({
    tools,
    // Only evaluation/test code should receive the answer key.
    evaluation: Object.freeze({ faultId: fault }),
    snapshot() {
      return {
        interfaces: observations["routeros.getInterfaces"](),
        routes: observations["routeros.getRoutes"](),
        dhcp: observations["routeros.getDhcp"](),
        dns: observations["routeros.getDns"](),
        probes: {
          gateway: observations["routeros.probeConnectivity"]({ target: "gateway" }),
          publicIp: observations["routeros.probeConnectivity"]({ target: "public-ip" }),
          dnsName: observations["routeros.probeConnectivity"]({ target: "dns-name" })
        }
      };
    }
  });
}

export const ROUTEROS_ROOT_CAUSES = Object.freeze({
  healthy: "no-fault-detected",
  "wan-link-down": "wan-link-down",
  "default-route-missing": "default-route-missing",
  "dhcp-pool-exhausted": "dhcp-pool-exhausted",
  "dns-misconfigured": "dns-misconfigured"
});

/**
 * Baseline diagnosis is deliberately deterministic and inspectable. TinyGPT
 * may rank hypotheses, but must not override direct contradictory evidence.
 */
export function diagnoseRouterOS(evidence) {
  if (!evidence || typeof evidence !== "object") throw new TypeError("evidence object required");
  const hypotheses = [];
  const add = (id, score, reasons) => hypotheses.push({ id, score, reasons });

  const wan = evidence.interfaces?.find(item => item.role === "wan" || item.name === "ether1-wan");
  const defaultRoute = evidence.routes?.find(route => route.dst === "0.0.0.0/0" && route.active);
  const dhcp = evidence.dhcp;
  const dns = evidence.dns;
  const probes = evidence.probes;

  if (wan && !wan.running) add("wan-link-down", 0.99, ["WAN interface is not running"]);
  if (!defaultRoute) add("default-route-missing", 0.98, ["No active default route was observed"]);
  if (dhcp && dhcp.serverRunning && dhcp.activeLeases >= dhcp.poolCapacity && !dhcp.offersObserved) {
    add("dhcp-pool-exhausted", 0.97, ["DHCP pool is full", "No DHCP offers were observed"]);
  }
  if (dns && (!dns.allowRemoteRequests || !dns.servers?.length || dns.resolutionWorks === false) &&
      probes?.publicIp?.reachable && !probes?.dnsName?.reachable) {
    add("dns-misconfigured", 0.96, ["Public IP connectivity works", "DNS resolution fails", "DNS configuration is incomplete or failing"]);
  }
  if (!hypotheses.length) {
    if (probes?.publicIp?.reachable && probes?.dnsName?.reachable) {
      add("no-fault-detected", 0.9, ["Public IP and DNS-name probes both succeeded"]);
    } else {
      add("insufficient-evidence", 0.25, ["Observed signals do not isolate a supported root cause"]);
    }
  }
  hypotheses.sort((a, b) => b.score - a.score);
  return Object.freeze({
    diagnosis: hypotheses[0].id,
    confidence: hypotheses[0].score,
    hypotheses,
    evidenceRefs: hypotheses[0].reasons.map((reason, index) => ({ id: `E${index + 1}`, reason })),
    recommendation: hypotheses[0].id === "insufficient-evidence"
      ? "Collect interface, route, DHCP, DNS and connectivity-probe evidence before concluding."
      : hypotheses[0].id === "no-fault-detected"
        ? "No fault was detected by this probe set; run additional tests if the symptom persists."
        : "Confirm the supporting observations and test the suspected cause in the isolated lab before proposing a change.",
    proposedChanges: []
  });
}

export async function collectRouterOSEvidence(tools) {
  if (!Array.isArray(tools)) throw new TypeError("tools array required");
  const byName = new Map(tools.map(tool => [tool.name, tool]));
  const required = Object.keys(TOOL_SCHEMAS);
  for (const name of required) {
    if (!byName.has(name)) throw new Error(`Missing read-only diagnostic tool: ${name}`);
  }
  const call = (name, args = {}) => byName.get(name).execute(args, { mode: "simulated-lab", permissions: ["network:read"] });
  const [interfaces, routes, dhcp, dns, gateway, publicIp, dnsName] = await Promise.all([
    call("routeros.getInterfaces"), call("routeros.getRoutes"), call("routeros.getDhcp"),
    call("routeros.getDns"), call("routeros.probeConnectivity", { target: "gateway" }),
    call("routeros.probeConnectivity", { target: "public-ip" }),
    call("routeros.probeConnectivity", { target: "dns-name" })
  ]);
  return { interfaces, routes, dhcp, dns, probes: { gateway, publicIp, dnsName } };
}

export function evaluateDiagnosis(prediction, expectedFault) {
  if (!prediction || typeof prediction.diagnosis !== "string") throw new TypeError("prediction.diagnosis required");
  if (!FAULTS.has(expectedFault)) throw new TypeError("expectedFault must be a supported fault ID");
  const expected = ROUTEROS_ROOT_CAUSES[expectedFault];
  const ranked = prediction.hypotheses ?? [];
  return Object.freeze({
    correct: prediction.diagnosis === expected,
    top3: prediction.diagnosis === expected || ranked.slice(0, 3).some(item => item.id === expected),
    confidence: Number.isFinite(prediction.confidence) ? prediction.confidence : 0,
    evidenceGrounded: prediction.diagnosis === "insufficient-evidence" ||
      (Array.isArray(prediction.evidenceRefs) && prediction.evidenceRefs.length > 0),
    expected,
    predicted: prediction.diagnosis
  });
}

export async function runRouterOSLabSuite() {
  const faults = [...FAULTS];
  const rows = [];
  for (const fault of faults) {
    const lab = createSimulatedRouterOSLab({ fault });
    const evidence = await collectRouterOSEvidence(lab.tools);
    const prediction = diagnoseRouterOS(evidence);
    rows.push({ fault, ...evaluateDiagnosis(prediction, fault) });
  }
  const count = rows.length;
  return {
    version: "routeros-diagnosis-eval-v1",
    cases: rows,
    metrics: {
      caseCount: count,
      top1Accuracy: rows.filter(row => row.correct).length / count,
      top3Accuracy: rows.filter(row => row.top3).length / count,
      evidenceGroundingRate: rows.filter(row => row.evidenceGrounded).length / count,
      meanConfidence: rows.reduce((sum, row) => sum + row.confidence, 0) / count
    }
  };
}
