// Aide de l'e2e : lit un événement Stripe (JSON, stdin) et affiche l'action que
// le webhook enverrait à apply_stripe_event (`routeStripeEvent`, même code que la fonction déployée).
// deno run --config supabase/functions/deno.json e2e/stripe-route.ts < event.json
import { routeStripeEvent } from '../supabase/functions/_shared/stripeWebhook.ts';

const raw = await new Response(Deno.stdin.readable).text();
console.log(JSON.stringify(routeStripeEvent(JSON.parse(raw))));
