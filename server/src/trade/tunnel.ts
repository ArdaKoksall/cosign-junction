import type { Listener } from "@ngrok/ngrok";

export async function openTradeTunnel(token: string, hostname: string, upstream: string): Promise<Listener> {
  let listener: Listener;
  try {
    const { forward } = await import("@ngrok/ngrok");
    listener = await forward({ addr: upstream, authtoken: token, domain: hostname });
  } catch (error) {
    const code = error instanceof Error ? error.message.match(/\bERR_NGROK_\d+\b/)?.[0] : undefined;
    throw new Error(`Could not open Cosign's ngrok tunnel${code ? ` (${code})` : ""}`);
  }

  if (listener.url()?.replace(/\/$/, "") !== `https://${hostname}`) {
    await listener.close();
    throw new Error("ngrok did not assign the configured Cosign hostname");
  }
  return listener;
}
