import { z } from "zod";
import { canUpload } from "@/lib/auth";
import { apiUser, assertSameOrigin, handleApiError, HttpError } from "@/lib/http";
import { createUpload, publicUpload } from "@/lib/media/uploads";
import { rateLimit } from "@/lib/rate-limit";

const body = z.object({
  fileName: z.string().min(1).max(255),
  size: z.number().int().positive(),
  lastModified: z.number().int().nonnegative(),
  albumId: z.uuid().nullable().optional(),
});

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await apiUser();
    if (!canUpload(user)) throw new HttpError(403, "Sizda yuklash huquqi yoʻq");
    if (!rateLimit(`upload:${user.id}`, 600, 60 * 60_000)) throw new HttpError(429, "Juda koʻp yuklash. Birozdan keyin urinib koʻring.");
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Notoʻgʻri soʻrov");
    const { fileName, size, lastModified, albumId } = parsed.data;
    const upload = await createUpload(user, {
      fileName,
      size,
      albumId: albumId ?? null,
      clientKey: `${fileName}:${size}:${lastModified}`,
    });
    return Response.json(publicUpload(upload));
  } catch (err) {
    return handleApiError(err);
  }
}
