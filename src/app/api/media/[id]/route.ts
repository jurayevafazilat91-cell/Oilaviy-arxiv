import { apiUser, handleApiError, HttpError } from "@/lib/http";
import { getMediaDetail } from "@/lib/media/queries";

export async function GET(_req: Request, ctx: RouteContext<"/api/media/[id]">) {
  try {
    const user = await apiUser();
    const detail = await getMediaDetail(user, (await ctx.params).id);
    if (!detail) throw new HttpError(404, "Topilmadi");
    return Response.json(detail);
  } catch (err) {
    return handleApiError(err);
  }
}
