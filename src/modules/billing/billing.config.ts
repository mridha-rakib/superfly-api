import { env } from "@/env";

export const stripeCheckoutUrls = {
  successUrl:
    env.STRIPE_CHECKOUT_SUCCESS_URL ||
    `${env.CLIENT_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
  cancelUrl:
    env.STRIPE_CHECKOUT_CANCEL_URL || `${env.CLIENT_URL}/checkout/cancel`,
};
