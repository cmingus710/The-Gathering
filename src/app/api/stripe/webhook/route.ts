import Stripe from "stripe";
import { handleEvent, RetryLaterError } from "@/lib/giving/processor";
import { getGivingServer, stripeClient } from "@/lib/giving/server";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook (test mode). The signature is verified against the raw
 * request body before anything else. Processing is idempotent per event id,
 * so Stripe's retries and duplicate deliveries are safe. Responses and logs
 * carry only the event id/type, never payload data.
 */
export async function POST(request: Request) {
  const server = getGivingServer();
  if (!server || !server.config.webhookSecret) {
    return new Response("Giving webhooks are not configured", { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripeClient(server).webhooks.constructEvent(body, signature, server.config.webhookSecret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    const outcome = await handleEvent(server, event as unknown as Parameters<typeof handleEvent>[1]);
    return Response.json({ received: true, outcome });
  } catch (err) {
    if (err instanceof RetryLaterError) return new Response("Busy, retry later", { status: 409 });
    console.error("[giving] webhook processing failed", { id: event.id, type: event.type, error: (err as Error)?.name });
    // Non-2xx makes Stripe retry with backoff; reconciliation repairs anything still missing.
    return new Response("Processing failed", { status: 500 });
  }
}
