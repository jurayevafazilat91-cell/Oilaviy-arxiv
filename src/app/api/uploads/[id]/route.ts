import { apiUser, assertSameOrigin, handleApiError, HttpError } from "@/lib/http";
import { cancelUpload, getUpload, MAX_CHUNK_BYTES, publicUpload, writeChunk } from "@/lib/media/uploads";

const isUuid = (id: string) => /^[0-9a-f-]{36}$/.test(id);

export async function GET(_req: Request, ctx: RouteContext<"/api/uploads/[id]">) {
  try {
    const user = await apiUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw new HttpError(404, "Yuklash topilmadi");
    return Response.json(publicUpload(await getUpload(user, id)));
  } catch (err) {
    return handleApiError(err);
  }
}

/** Reads the body with a hard cap so a client cannot stream an unbounded chunk into memory. */
async function readCapped(req: Request, cap: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > cap) throw new HttpError(413, "Boʻlak juda katta");
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      throw new HttpError(413, "Boʻlak juda katta");
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

export async function PUT(req: Request, ctx: RouteContext<"/api/uploads/[id]">) {
  try {
    assertSameOrigin(req);
    const user = await apiUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw new HttpError(404, "Yuklash topilmadi");
    const offset = Number(new URL(req.url).searchParams.get("offset"));
    const upload = await getUpload(user, id);
    const chunk = await readCapped(req, MAX_CHUNK_BYTES);
    return Response.json(publicUpload(await writeChunk(upload, offset, chunk)));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/uploads/[id]">) {
  try {
    assertSameOrigin(req);
    const user = await apiUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw new HttpError(404, "Yuklash topilmadi");
    await cancelUpload(await getUpload(user, id));
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleApiError(err);
  }
}
