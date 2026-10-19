import { Suspense } from "react";
import { AiSection, FamilySection, ProfileSection, TelegramSection } from "@/components/settings-sections";
import { PageTitle, Spinner } from "@/components/ui";
import { canUpload, isAdmin, requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";

export const metadata = { title: "Sozlamalar" };

export default function SettingsPage() {
  return (
    <>
      <PageTitle>Sozlamalar</PageTitle>
      <Suspense fallback={<Spinner />}>
        <Settings />
      </Suspense>
    </>
  );
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

async function Settings() {
  const user = await requireUser();
  const e = env();
  const [link] = await sql<{ linkedAt: Date }[]>`select linked_at from telegram_links where user_id = ${user.id}`;
  const [family] = await sql<{ aiEnabled: boolean; aiConsentAt: Date | null }[]>`
    select ai_enabled, ai_consent_at from families where id = ${user.familyId}`;
  const admin = isAdmin(user);
  const members = admin
    ? await sql<{ id: string; name: string; email: string; role: string; isTreeEditor: boolean; disabledAt: Date | null; telegram: boolean }[]>`
        select u.id, u.name, u.email, u.role, u.is_tree_editor, u.disabled_at, exists (select 1 from telegram_links t where t.user_id = u.id) as telegram
        from users u where u.family_id = ${user.familyId}
        order by array_position(array['owner','admin','member','viewer'], u.role), u.name`
    : [];
  const invites = admin
    ? await sql<{ id: string; role: string; expiresAt: Date }[]>`
        select id, role, expires_at from invites
        where family_id = ${user.familyId} and kind = 'invite' and used_at is null and expires_at > now() order by created_at desc`
    : [];

  return (
    <div className="max-w-4xl space-y-6">
      <ProfileSection name={user.name} />
      <TelegramSection
        linked={Boolean(link)}
        linkedAt={iso(link?.linkedAt ?? null)}
        botConfigured={Boolean(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_BOT_USERNAME)}
        canUpload={canUpload(user)}
        maxMb={e.TELEGRAM_MAX_DOWNLOAD_MB}
      />
      <AiSection
        isOwner={user.role === "owner"}
        enabled={family.aiEnabled}
        consentAt={iso(family.aiConsentAt)}
        keyConfigured={Boolean(e.GEMINI_API_KEY)}
        model={e.GEMINI_MODEL}
      />
      {admin && (
        <FamilySection
          familyName={user.familyName}
          members={members.map((m) => ({ ...m, disabledAt: iso(m.disabledAt) }))}
          invites={invites.map((i) => ({ ...i, expiresAt: iso(i.expiresAt)! }))}
          me={user.id}
          myRole={user.role}
        />
      )}
    </div>
  );
}
