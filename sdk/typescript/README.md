# Zinloop Agent Control Plane SDK (TypeScript / JavaScript)

Uses the existing Next.js/TypeScript stack. No Python server or runtime dependencies.

Features: self-registration, global or per-agent runtime policies, model choice and USD budget reservations, shared task channel and optional observability callback.

## Set up

Create a scoped enrollment key in the MSP console at /app/agents (24-hour expiration). The running agent calls register on first use. Save the resulting agent credential in a secrets manager for subsequent process starts.

Environment:

    ZINLOOP_URL=https://zinloop.com
    ZINLOOP_ENROLLMENT_TOKEN=zle_...
    ZINLOOP_AGENT_NAME=research-agent

Later, set ZINLOOP_AGENT_TOKEN=zla_... instead of the enrollment key.

Example:

    import { ZinloopAgent } from "./index.js";
    const agent = new ZinloopAgent({
      url: process.env.ZINLOOP_URL!,
      name: process.env.ZINLOOP_AGENT_NAME || "research-agent",
      framework: "custom",
      agentToken: process.env.ZINLOOP_AGENT_TOKEN,
      enrollmentToken: process.env.ZINLOOP_ENROLLMENT_TOKEN
    });
    const answer = await agent.run(
      { input: "Summarize the report", maxUsd: 0.05, requestedModel: "approved-provider-model" },
      async selectedModel => {
        const response = await yourProviderCall({model: selectedModel, maxOutputTokens: 500});
        return { value: response.text, outputText: response.text, costUsd: response.verifiedUsdCost };
      }
    );

Decorator-style wrapping of existing tool calls:

    const protectedTool = agent.guard(
      async (query: string) => {
        const rows = await databaseTool(query);
        return {value: rows, outputText: JSON.stringify(rows), costUsd: 0.001};
      },
      {input: query => query, maxUsd: 0.002, model:"approved-provider-model", phase:"tool"}
    );

    await protectedTool("select * from orders limit 5");

Shared task channel:

    const {tasks} = await agent.tasks(); // discover eligible tasks
    const {task} = await agent.claim();
    if (task) {
      await agent.message(task.id, "Schema reviewed; assigning tests.", "handoff");
      const {messages} = await agent.poll(task.id);
      const cursor = Number(messages.at(-1)?.id || 0);
      await agent.poll(task.id, cursor);
      await agent.heartbeat(task.id); // renew the 15-minute lease
      await agent.finish(task.id, "done");
    }

Additional locally enforced evaluator:

    agent.addEvaluator("sensitive-internal-tag", (_phase,text) => text.includes("INTERNAL-ONLY"));

Custom evaluators run locally before the mandatory remote policy call. They cannot override a server block. For additional centrally configured types, add and test a registered server evaluator in console/lib/cp-rules.ts.

## Observability and privacy

The SDK sends guarded text to the configured Zinloop control plane for evaluation. This is different from the offline laptop scanner. The server stores rule/verdict metadata without prompt text, but the centralized runtime sees input/output in transit. Share only authorized material.

Channel messages are intentionally stored and visible to appropriate MSP users. Do not send secrets or raw user conversations through collaboration messages.

Optional OpenTelemetry: supply an onTelemetry callback to construct spans using an already initialized @opentelemetry/api tracer. The SDK does not install or configure an exporter. Do not attach prompt text or secrets to spans.

## Runtime endpoints

- POST /api/control-plane/register with {enrollmentToken,name,framework}.
- POST /api/control-plane/runtime with Authorization: Bearer zla_... and actions:
  evaluate (phase, content), reserve (maxUsd, requestedModel, taskId), settle (reservationId, actualUsd, status), claim (taskId), tasks, heartbeat (taskId), finish (taskId, status), message (taskId, kind, body), poll (taskId, after).

## Explicit v1 limitations

- PII/prompt injection detection is heuristic, not a comprehensive security guarantee.
- Regex is deliberately restricted; JSON checks top-level keys; SQL checks text patterns only.
- Reservations atomically limit reported spend commitments but cannot control external provider billing. Configure provider caps, enforce output-token bounds, and reconcile billed usage.
- Abandoned reservations and expired task leases need production background cleanup/renewal workers.
- Existing ChatGPT and Claude consumer sessions are not automatically visible or controllable. Use API-driven agents with the SDK or a supported gateway.
- Offline scanning keeps all content local; online runtime evaluations explicitly send text to the server.
