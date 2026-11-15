import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { httpError } from "../http-error.js";

export function simulatorAccess(buyerToken: string | undefined, agentToken: string | undefined) {
  if (!buyerToken || !agentToken || buyerToken === agentToken || /\s/.test(buyerToken + agentToken)) {
    throw new Error("Set distinct COSIGN_BUYER_TOKEN and COSIGN_AGENT_TOKEN values for the simulator");
  }
  const buyer = Buffer.from(buyerToken);
  const agent = Buffer.from(agentToken);
  const matches = (provided: Buffer, expected: Buffer) =>
    provided.length === expected.length && timingSafeEqual(provided, expected);

  return (request: FastifyRequest, access: "read" | "buyer") => {
    const token = request.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) throw httpError(401, "A simulator bearer token is required");

    const provided = Buffer.from(token);
    if (matches(provided, buyer)) return "demo-buyer";
    if (!matches(provided, agent)) throw httpError(401, "Invalid simulator bearer token");
    if (access === "buyer") throw httpError(403, "Buyer authority is required");
    return "demo-agent";
  };
}
