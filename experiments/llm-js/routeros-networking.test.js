import test from "node:test";
import assert from "node:assert/strict";
import {
  createSimulatedRouterOSLab,
  collectRouterOSEvidence,
  diagnoseRouterOS,
  evaluateDiagnosis,
  registerRouterOSLabTools,
  runRouterOSLabSuite
} from "./networking/routeros-lab.js";

test("all simulated RouterOS faults are diagnosed from observable evidence", async () => {
  const suite = await runRouterOSLabSuite();
  assert.equal(suite.metrics.caseCount, 5);
  assert.equal(suite.metrics.top1Accuracy, 1);
  assert.equal(suite.metrics.top3Accuracy, 1);
  assert.equal(suite.metrics.evidenceGroundingRate, 1);
});

test("the simulator keeps hidden ground truth out of tool results", async () => {
  const lab = createSimulatedRouterOSLab({ fault: "dns-misconfigured" });
  const evidence = await collectRouterOSEvidence(lab.tools);
  assert.equal(JSON.stringify(evidence).includes("dns-misconfigured"), false);
  assert.equal(evidence.probes.publicIp.reachable, true);
  assert.equal(evidence.probes.dnsName.reachable, false);
  assert.equal(lab.evaluation.faultId, "dns-misconfigured");
});

test("diagnosis identifies DNS only when IP connectivity succeeds and DNS fails", async () => {
  const lab = createSimulatedRouterOSLab({ fault: "dns-misconfigured" });
  const evidence = await collectRouterOSEvidence(lab.tools);
  const prediction = diagnoseRouterOS(evidence);
  assert.equal(prediction.diagnosis, "dns-misconfigured");
  assert.ok(prediction.evidenceRefs.length > 0);
  assert.deepEqual(prediction.proposedChanges, []);
  assert.equal(evaluateDiagnosis(prediction, "dns-misconfigured").correct, true);
});

test("tool surface is read-only and rejects invalid probe targets", async () => {
  const lab = createSimulatedRouterOSLab();
  assert.equal(lab.tools.some(tool => /set|update|delete|reboot|disable|enable/i.test(tool.name)), false);
  assert.ok(lab.tools.every(tool => tool.risk === "read-only" && tool.permissions.includes("network:read")));
  const probe = lab.tools.find(tool => tool.name === "routeros.probeConnectivity");
  assert.throws(() => probe.execute({ target: "change-default-route" }), /target must be/);
  assert.throws(() => probe.execute({ target: "gateway", extra: true }), /target must be/);
});

test("diagnosis refuses to invent a root cause when evidence is insufficient", () => {
  const prediction = diagnoseRouterOS({ interfaces: [], routes: [], dhcp: null, dns: null, probes: {} });
  assert.equal(prediction.diagnosis, "insufficient-evidence");
  assert.equal(prediction.proposedChanges.length, 0);
});

test("collector requires the full diagnostic tool contract", async () => {
  await assert.rejects(() => collectRouterOSEvidence([]), /Missing read-only diagnostic tool/);
});


test("lab tools register into the existing AgentRuntime without creating another runtime", () => {
  const lab = createSimulatedRouterOSLab();
  const registered = [];
  const runtime = { registerTool(tool) { registered.push(tool); return this; } };
  assert.equal(registerRouterOSLabTools(runtime, lab), runtime);
  assert.equal(registered.length, 5);
  assert.ok(registered.every(tool => tool.domain === "networking" && tool.fullName === tool.name));
  assert.ok(registered.every(tool => tool.capability.risk === "read-only"));
  assert.throws(() => registerRouterOSLabTools({}, lab), /existing AgentRuntime/);
});
