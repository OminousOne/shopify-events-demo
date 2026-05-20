// api/routes/events/POST-products.ts
import type { RouteHandler } from "gadget-server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";

const route: RouteHandler = async ({ request, reply, logger, api, config }) => {
  // 1. Verify the request really came from Shopify
  const signature = request.headers["shopify-hmac-sha256"] as string;
  const rawBody = (request as any).rawBody as Buffer;
  const expected = createHmac("sha256", config.SHOPIFY_API_SECRET!).update(rawBody).digest();
  const provided = Buffer.from(signature, "base64");

  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return reply.code(401).send();
  }

  // 2. Read the event details
  const body = request.body as any;
  const id = (request.headers["shopify-resource-id"] as string).split("/").pop()!;
  const product = body.data?.product;

  logger.info({ action: body.action, id, body }, "event received");

  // 3. Upsert the product (skip if the event has no product snapshot, e.g. nested change with empty query result)
  if (!product) {
    logger.warn({ id, fieldsChanged: body.fields_changed }, "event missing product data, skipping upsert");
    return reply.code(200).send();
  }

  const shopId = body.data?.shop?.id?.split("/").pop();
  await api.shopifyProduct.upsert({
    id,
    title: product.title,
    handle: product.handle,
    body: product.descriptionHtml,
    status: product.status,
    vendor: product.vendor,
    productType: product.productType,
    ...(shopId ? { shop: { _link: shopId } } : {}),
    on: ["id"],
  });

  return reply.code(200).send();
};

// Capture the raw request bytes so the HMAC check above can read them.
// Fastify throws them away after parsing JSON, so we tee the stream here.
route.options = {
  preParsing: async (request, _reply, payload) => {
    const chunks: Buffer[] = [];
    for await (const chunk of payload) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    (request as any).rawBody = raw;
    return Readable.from([raw]);
  },
};

export default route;
