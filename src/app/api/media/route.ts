import { apiUser, handleApiError } from "@/lib/http";
import { listMedia } from "@/lib/media/queries";
import { filtersFromParams } from "@/lib/media/filters";

export async function GET(req: Request) {
  try {
    const user = await apiUser();
    const params = new URL(req.url).searchParams;
    return Response.json(await listMedia(user, { ...filtersFromParams(params), cursor: params.get("cursor") ?? undefined }));
  } catch (err) {
    return handleApiError(err);
  }
}
