import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/** Twilio's signed form parameters, validated against the exact public callback URL. */
export async function verifyTwilioFormWebhook(request: NextRequest, expectedUrl: string, token: string):
  Promise<{ ok: true; params: URLSearchParams } | { ok: false; status: number }> {
  if (!expectedUrl || !token) return { ok: false, status: 503 };
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
      "application/x-www-form-urlencoded") return { ok: false, status: 403 };
  const signature = request.headers.get("x-twilio-signature") ?? "";
  if (!signature) return { ok: false, status: 403 };
  const body = await request.text();
  if (body.length > 10000) return { ok: false, status: 413 };
  const params = new URLSearchParams(body);
  const names = [...new Set(params.keys())].sort();
  if (names.some(name => params.getAll(name).length !== 1)) return { ok: false, status: 403 };
  const payload = expectedUrl + names.map(name => name + (params.get(name) ?? "")).join("");
  const expected = Buffer.from(createHmac("sha1", token).update(payload).digest("base64"));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return { ok: false, status: 403 };
  return { ok: true, params };
}
