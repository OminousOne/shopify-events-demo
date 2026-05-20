# Shopify Events demo (built on Gadget)

[![Fork on Gadget](https://assets.gadget.dev/assets/fork-button.svg)](https://app.gadget.dev/auth/fork?domain=shopify-events-demo.gadget.app)

A minimal demo of Shopify's new [Events](https://shopify.dev/docs/apps/build/events/get-started) feature, built on [Gadget](https://gadget.dev). When a product is created or updated in a Shopify store, the event fires an HTTP request to this app, which verifies the HMAC signature and upserts the product record into Gadget's database. Product deletes are handled by Gadget's standard Shopify webhook pipeline.

## What this shows

1. Subscribing to Product `create` and `update` events via `shopify.app.development.toml`.
2. Receiving the event on a custom Gadget HTTP route at `/events/products`.
3. Verifying the `Shopify-Hmac-Sha256` signature using the app's client secret.
4. Upserting into the `shopifyProduct` model with the [public API](https://docs.gadget.dev/guides/glossary#public-api) (`api.shopifyProduct.upsert`), so model actions and effects run.
5. Letting `products/delete` ride the normal Gadget webhooks subscription, which auto-deletes the `shopifyProduct` row.

See `api/routes/events/POST-products.ts` for the whole route.

## Try it

The easiest way to follow along is to fork this app on Gadget using the button above. That gives you a copy of the app, the models, the route, and a starting `shopify.app.development.toml`. Then:

1. Open your forked app in the Gadget editor.
2. Connect it to your Shopify Partner account and install on a dev store.
3. Set the `SHOPIFY_API_SECRET` environment variable in the Gadget editor (Settings, then Environment Variables). The value is your app's client secret, which you can find in the Shopify Partner dashboard under your app's API credentials. The HMAC check in the route reads from this variable.
4. Make every TOML change in `shopify.app.development.toml` before you release. Releasing a new version is what actually registers the Events subscriptions and webhook topics with Shopify, so anything missing from the file at release time will not be live. In particular, do both of these edits in the same pass:

   a. Add the full `[events]` block with the `product_create_events` and `product_update_events` subscriptions (see the "Events subscriptions" section below for the exact shape).
   b. In the `[[webhooks.subscriptions]]` block, remove `products/create` and `products/update` from the `topics` array so the Events subscriptions are the only thing handling those changes. Keep `products/delete` so Gadget continues handling deletes the standard way. After the edit, the line should look like this:

      ```toml
      topics = ["shop/update", "app/uninstalled", "products/delete"]
      ```
5. Once both edits are in the file, open `shopify.app.development.toml` in the Gadget editor file tree and click "Release new version" at the bottom. This single release deploys the new Events subscriptions and the updated webhook topics together. If you release before adding the `[events]` block, Shopify will not have any Events subscriptions registered and no events will fire.
6. Create or edit a product in your dev store. The event will land in the Gadget logs, and the row in `shopifyProduct` will be inserted or updated.

## Events subscriptions (`shopify.app.development.toml`)

```toml
[events]
api_version = "unstable"

[[events.subscription]]
handle = "product_create_events"
topic = "Product"
actions = ["create"]
uri = "https://YOUR-APP-URL/events/products"
query = """
query product_created($productId: ID!) {
  product(id: $productId) {
    id title handle descriptionHtml status vendor productType
  }
  shop { id }
}
"""

[[events.subscription]]
handle = "product_update_events"
topic = "Product"
actions = ["update"]
uri = "https://YOUR-APP-URL/events/products"
query = """
query product_updated($productId: ID!) {
  product(id: $productId) {
    id title handle descriptionHtml status vendor productType
  }
  shop { id }
}
"""
```

Both queries include `shop { id }` because the route links the product to a shop on first insert (via Gadget's `_link`). Deletes are not subscribed here; they come in over `products/delete` on the regular webhooks subscription above, and Gadget's built-in Shopify webhook handler removes the row.

## HMAC verification

Shopify signs every Events delivery with HMAC-SHA256 over the raw request body, using your app's client secret. The signature arrives in the `shopify-hmac-sha256` header (base64). Gadget exposes the client secret on the route context as `config.SHOPIFY_API_SECRET`.

One catch: Gadget routes use Fastify, which parses the JSON body before your handler runs, so the raw bytes are normally gone. The route uses a `preParsing` hook to buffer the bytes into `request.rawBody` first, then re-emits them so the JSON parser still works.

## A note on payload shape

Shopify Events sometimes deliver an update notification with no `data` field at all (for example, when the change is to a nested resource like a product option value). The route guards against this by skipping the upsert and logging a warning when `body.data?.product` is missing, so a stray "field changed" notification never crashes the handler.
