import { membersOf } from "@/lib/control";
import { inProject } from "@/lib/db";
import { readInbound } from "@/lib/mail";
import { act, providerMessageId, replyToken } from "@/lib/visit";

export async function POST(request: Request) {
  const inbound = await readInbound(request);
  if (!inbound.ok) return new Response(null, { status: inbound.status });
  // An unknown project stops here. inProject would create a database file for any id.
  const members = await membersOf(inbound.projectId);
  if (members.length === 0) return new Response(null, { status: 404 });
  const result = await inProject(inbound.projectId, () =>
    act({
      type: "ingest",
      token: replyToken(inbound.token),
      providerMessageId: providerMessageId(inbound.providerMessageId),
      text: inbound.text,
      inReplyTo: inbound.inReplyTo,
    }),
  );
  if (!result.ok && result.reason === "no_case") return new Response(null, { status: 404 });
  if (!result.ok) return new Response(null, { status: 500 });
  return new Response(null, { status: 200 });
}
