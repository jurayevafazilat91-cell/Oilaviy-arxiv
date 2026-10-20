import { z } from "zod";
import { apiUser, assertSameOrigin, handleApiError, HttpError } from "@/lib/http";
import { getUpload, partUploadUrl } from "@/lib/media/uploads";

const body = z.object({ part: z.number().int().positive() });

/** Hands out a short-lived signed URL; the browser PUTs that part straight to the bucket. */
export async function POST(req: Request, ctx: RouteContext<"/api/uploads/[id]/parts">) {
  try {
    assertSameOrigin(req);
    const user = await apiUser();
    const { id } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "Yuklash topilmadi");
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Notoʻgʻri soʻrov");
    return Response.json({ url: await partUploadUrl(await getUpload(user, id), parsed.data.part) });
  } catch (err) {
    return handleApiError(err);
  }
}
