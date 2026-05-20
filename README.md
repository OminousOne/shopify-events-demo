# Shopify Events demo (built on Gadget)

[![Fork on Gadget](https://assets.gadget.dev/assets/fork-button.svg)](https://app.gadget.dev/auth/fork?domain=shopify-events-demo.gadget.app)

A minimal demo of Shopify's new [Events](https://shopify.dev/docs/apps/build/events/get-started) feature, built on [Gadget](https://gadget.dev). When a product is created, updated, or deleted in a Shopify store, the event fires an HTTP request to this app, which verifies the HMAC signature and syncs the product record into Gadget's database.

## What this shows

1. Subscribing to Product `create`, `update`, and `delete` events via `shopify.app.development.toml`.
2. Receiving the event on a custom Gadget HTTP route at `/events/products`.
3. Verifying the `Shopify-Hmac-Sha256` signature using the app's client secret.
4. Writing to the `shopifyProduct` model with `api.internal.shopifyProduct.create / update / delete`.

See `api/routes/events/POST-products.ts` for the whole route.

## Try it

The easiest way to follow along is to fork this app on Gadget using the button above. That gives you a copy of the app, the models, the route, and a starting `shopify.app.development.toml`. Then:

1. Open your forked app in the Gadget editor.
2. Connect it to your Shopify Partner account and install on a dev store.
3. Set the `SHOPIFY_API_SECRET` environment variable in the Gadget editor (Settings, then Environment Variables). The value is your app's client secret, which you can find in the Shopify Partner dashboard under your app's API credentials. The HMAC check in the route reads from this variable.
4. In `shopify.app.development.toml`, unsubscribe from the old product webhooks so the Events subscriptions are the only thing handling product changes. Open the `[[webhooks.subscriptions]]` block and remove `products/create`, `products/update`, and `products/delete` from the `topics` array. After the edit, the line should look like this:

   ```toml
   topics = ["shop/update", "app/uninstalled"]
   ```
5. In the Gadget editor, click on `shopify.app.development.toml` in the file tree, then click the "Release new version" button at the bottom. This deploys your updated TOML so the Events subscriptions and webhook changes take effect.
6. Create or edit a product in your dev store. The event will land in the Gadget logs.

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
}
"""

[[events.subscription]]
handle = "product_delete_events"
topic = "Product"
actions = ["delete"]
uri = "https://YOUR-APP-URL/events/products"
```

The delete subscription has no `query` block because the product is already gone by the time Shopify fires the event. The route reads the product ID from the `shopify-resource-id` header instead.

## HMAC verification

Shopify signs every Events delivery with HMAC-SHA256 over the raw request body, using your app's client secret. The signature arrives in the `shopify-hmac-sha256` header (base64). Gadget exposes the client secret on the route context as `config.SHOPIFY_API_SECRET`.

One catch: Gadget routes use Fastify, which parses the JSON body before your handler runs, so the raw bytes are normally gone. The route uses a `preParsing` hook to buffer the bytes into `request.rawBody` first, then re-emits them so the JSON parser still works.
