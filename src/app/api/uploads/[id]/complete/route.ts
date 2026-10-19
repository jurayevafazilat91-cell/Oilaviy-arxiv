import { apiUser, assertSameOrigin, handleApiError, HttpError } from "@/lib/http";
import { completeUpload, getUpload, publicUpload } from "@/lib/media/uploads";

export async function POST(req: Request, ctx: RouteContext<"/api/uploads/[id]/complete">) {
  try {
    assertSameOrigin(req);
    const user = await apiUser();
    const { id } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "Yuklash topilmadi");
    return Response.json(publicUpload(await completeUpload(await getUpload(user, id))));
  } catch (err) {
    return handleApiError(err);
  }
}
