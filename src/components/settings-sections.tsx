"use client";

import { useActionState, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Link2, Send, Sparkles } from "lucide-react";
import {
  changePasswordAction, createInviteAction, createResetLinkAction, revokeInviteAction, updateMemberAction, updateProfileAction,
} from "@/actions/auth";
import { backfillAiAction, createTelegramCodeAction, renameFamilyAction, setAiEnabledAction, unlinkTelegramAction } from "@/actions/settings";
import { formatDate, ROLE_LABELS } from "@/lib/format";
import { Badge, Button, Card, Field, Input, Notice, Select } from "./ui";

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <label className="sr-only" htmlFor={`copy-${label}`}>{label}</label>
      <Input id={`copy-${label}`} readOnly value={value} onFocus={(e) => e.target.select()} className="font-mono text-sm" />
      <Button size="sm" className="min-h-11" onClick={async () => {
        await navigator.clipboard.writeText(value).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}>
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        <span aria-live="polite">{copied ? "Nusxalandi" : "Nusxalash"}</span>
      </Button>
    </div>
  );
}

export function ProfileSection({ name }: { name: string }) {
  const [profile, profileAction, p1] = useActionState(updateProfileAction, undefined);
  const [pw, pwAction, p2] = useActionState(changePasswordAction, undefined);
  return (
    <Card>
      <h2 className="mb-4 font-display text-xl font-medium uppercase">Profil</h2>
      <div className="grid gap-8 md:grid-cols-2">
        <form action={profileAction} className="space-y-3">
          <Field label="Ism">{(id) => <Input id={id} name="name" defaultValue={name} required maxLength={80} />}</Field>
          <Notice>{profile?.error}</Notice>
          {profile?.ok && <Notice tone="ok">Saqlandi</Notice>}
          <Button type="submit" size="sm" loading={p1}>Saqlash</Button>
        </form>
        <form action={pwAction} className="space-y-3">
          <Field label="Joriy parol">{(id) => <Input id={id} name="current" type="password" autoComplete="current-password" required />}</Field>
          <Field label="Yangi parol" hint="Kamida 10 belgi. Boshqa qurilmalardan chiqariladi.">
            {(id, h) => <Input id={id} name="next" type="password" autoComplete="new-password" minLength={10} required aria-describedby={h} />}
          </Field>
          <Notice>{pw?.error}</Notice>
          {pw?.ok && <Notice tone="ok">Parol yangilandi</Notice>}
          <Button type="submit" size="sm" loading={p2}>Parolni almashtirish</Button>
        </form>
      </div>
    </Card>
  );
}

export function TelegramSection({ linked, linkedAt, botConfigured, canUpload, maxMb }: {
  linked: boolean; linkedAt: string | null; botConfigured: boolean; canUpload: boolean; maxMb: number;
}) {
  const [code, setCode] = useState<{ code: string; deepLink: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (!code) return;
    const tick = () => setLeft(Math.max(0, Math.round((new Date(code.expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [code]);

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-xl font-medium uppercase"><Send className="size-5 text-accent" aria-hidden />Telegram</h2>
        {linked ? <Badge tone="ok">Ulangan · {formatDate(linkedAt)}</Badge> : <Badge>Ulanmagan</Badge>}
      </div>
      <ul className="mb-5 list-disc space-y-1 pl-5 text-sm text-dim">
        <li>Botga yuborilgan rasm va videolar avtomatik arxivga tushadi (“Telegram” albomi yoki izohdagi <code>#albom-nomi</code>).</li>
        <li>“Rasm” sifatida yuborilsa Telegram siqadi; asl sifat uchun “Fayl” sifatida yuboring.</li>
        <li>Bot {maxMb} MB gacha faylni qabul qiladi; kattaroq videolarni sayt orqali yuklang.</li>
      </ul>
      {!botConfigured ? (
        <Notice tone="neutral">Telegram bot serverda hali sozlanmagan (TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME).</Notice>
      ) : !canUpload ? (
        <Notice tone="neutral">Koʻruvchi rolida Telegram orqali yuklab boʻlmaydi.</Notice>
      ) : (
        <div className="space-y-4">
          {code && left > 0 && (
            <div className="space-y-3 bg-surface-2 p-4">
              <p className="text-sm">Botni ochib “Start” tugmasini bosing yoki botga quyidagini yuboring:</p>
              <CopyField value={`/start ${code.code}`} label="Ulanish buyrugʻi" />
              <div className="flex flex-wrap items-center gap-3">
                <a href={code.deepLink} target="_blank" rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 bg-accent px-5 font-medium text-accent-ink transition-[filter] hover:brightness-105">
                  <ExternalLink className="size-4" aria-hidden />Telegram’da ochish
                </a>
                <span className="text-sm text-dim" aria-live="polite">Kod {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} amal qiladi, bir marta ishlatiladi</span>
              </div>
            </div>
          )}
          <Notice>{error}</Notice>
          <div className="flex flex-wrap gap-2">
            <Button variant={linked ? "secondary" : "primary"} loading={busy} onClick={async () => {
              setBusy(true);
              const r = await createTelegramCodeAction();
              setBusy(false);
              if (r.ok) { setCode(r.data); setError(null); } else setError(r.error);
            }}>
              <Link2 className="size-4" aria-hidden />{linked ? "Boshqa akkauntni ulash" : "Ulanish kodini olish"}
            </Button>
            {linked && (
              <Button variant="ghost" onClick={async () => {
                if (!confirm("Telegram ulanishi uzilsinmi?")) return;
                const r = await unlinkTelegramAction();
                if (!r.ok) setError(r.error);
              }}>Uzish</Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export function AiSection({ isOwner, enabled, consentAt, keyConfigured, model }: {
  isOwner: boolean; enabled: boolean; consentAt: string | null; keyConfigured: boolean; model: string;
}) {
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (name: string, fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, ok: (d: unknown) => string) => {
    setBusy(name);
    const r = await fn();
    setBusy(null);
    setMsg(r.ok ? { tone: "ok", text: ok(r.data) } : { tone: "danger", text: r.error });
  };
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-xl font-medium uppercase"><Sparkles className="size-5 text-accent" aria-hidden />AI yordamchi</h2>
        {enabled ? <Badge tone="ok">Yoqilgan · {formatDate(consentAt)}</Badge> : <Badge>Oʻchiq</Badge>}
      </div>
      <p className="mb-3 text-[15px]">Yoqilsa, yangi rasmlar uchun oʻzbekcha tavsif va teglar yaratiladi, “AI qidiruv” tabiiy tildagi soʻrovni tushunadi. Arxivning qolgan qismi AIʼsiz ham toʻliq ishlaydi.</p>
      <div className="mb-4 space-y-2 border border-line bg-surface-2 p-4 text-sm">
        <p className="font-medium">Nima yuboriladi va qayerga</p>
        <ul className="list-disc space-y-1 pl-5 text-dim">
          <li>Google Gemini API’ga (model: <code>{model}</code>) rasmning kichiklashtirilgan nusxasi (≤1024px), EXIF/GPS’siz. Asl fayl va videolar yuborilmaydi.</li>
          <li>AI qidiruvda yozgan soʻrovingiz matni ham yuboriladi.</li>
          <li><strong className="text-ink">Muhim:</strong> Google AI Studio’ning bepul tarifida yuborilgan maʼlumotlar Google mahsulotlarini yaxshilash uchun ishlatilishi va odamlar tomonidan koʻrib chiqilishi mumkin. Toʻlovli (billing yoqilgan) tarifda bunday ishlatilmaydi.</li>
          <li>AI odamlarni tanimaydi, ism, yosh, millat yoki qarindoshlikni taxmin qilmaydi. Natijalar “AI” belgisi bilan koʻrsatiladi va tahrirlanadi.</li>
        </ul>
      </div>
      {!keyConfigured && <Notice tone="neutral">Serverda GEMINI_API_KEY sozlanmagan.</Notice>}
      {msg && <div className="mb-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {isOwner ? (
        enabled ? (
          <div className="flex flex-wrap gap-2">
            <Button loading={busy === "backfill"} onClick={() => run("backfill", backfillAiAction, (d) => `${(d as { queued: number }).queued} ta rasm navbatga qoʻyildi`)}>
              Mavjud rasmlarni tahlil qilish
            </Button>
            <Button variant="ghost" loading={busy === "off"} onClick={() => run("off", () => setAiEnabledAction(false, false), () => "AI oʻchirildi")}>Oʻchirish</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="flex cursor-pointer items-start gap-3 text-[15px]">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-5 shrink-0 accent-[var(--accent)]" />
              Yuqoridagilarni oʻqidim va oila rasmlarining kichik nusxalarini Google Gemini’ga yuborishga roziman.
            </label>
            <Button variant="primary" disabled={!consent || !keyConfigured} loading={busy === "on"}
              onClick={() => run("on", () => setAiEnabledAction(true, consent), () => "AI yoqildi")}>AI ni yoqish</Button>
          </div>
        )
      ) : (
        <p className="text-sm text-dim">Bu sozlamani faqat oila egasi oʻzgartiradi.</p>
      )}
    </Card>
  );
}

type Member = { id: string; name: string; email: string; role: string; isTreeEditor: boolean; disabledAt: string | null; telegram: boolean };
type Invite = { id: string; role: string; expiresAt: string };

export function FamilySection({ familyName, members, invites, me, myRole }: {
  familyName: string; members: Member[]; invites: Invite[]; me: string; myRole: string;
}) {
  const [link, setLink] = useState<{ url: string; label: string } | null>(null);
  const [role, setRole] = useState<"member" | "viewer" | "admin">("member");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const isOwner = myRole === "owner";
  const check = (r: { ok: boolean; error?: string }) => setError(r.ok ? null : (r.error ?? "Xato"));

  return (
    <Card>
      <h2 className="mb-4 font-display text-xl font-medium uppercase">Oila va aʼzolar</h2>
      <form className="mb-6 flex max-w-md items-end gap-2" onSubmit={async (e) => {
        e.preventDefault();
        const r = await renameFamilyAction(String(new FormData(e.currentTarget).get("family")));
        check(r);
        setSaved(r.ok);
      }}>
        <div className="flex-1"><Field label="Oila nomi">{(id) => <Input id={id} name="family" defaultValue={familyName} required maxLength={80} />}</Field></div>
        <Button type="submit" className="min-h-11">{saved ? "Saqlandi" : "Saqlash"}</Button>
      </form>

      <div className="mb-6 space-y-3 bg-surface-2 p-4">
        <h3 className="font-medium">Taklif havolasi</h3>
        <p className="text-sm text-dim">Havola 7 kun amal qiladi va faqat bir marta ishlatiladi. Uni ishonchli kanal orqali yuboring.</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-48">
            <Field label="Rol">
              {(id) => (
                <Select id={id} value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                  <option value="member">Aʼzo (yuklaydi)</option>
                  <option value="viewer">Koʻruvchi</option>
                  {isOwner && <option value="admin">Admin</option>}
                </Select>
              )}
            </Field>
          </div>
          <Button variant="primary" className="min-h-11" onClick={async () => {
            const r = await createInviteAction(role);
            check(r);
            if (r.ok) setLink({ url: r.data.url, label: "Taklif havolasi" });
          }}>Havola yaratish</Button>
        </div>
        {link && <CopyField value={link.url} label={link.label} />}
      </div>

      <Notice>{error}</Notice>

      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">Oila aʼzolari</caption>
          <thead className="text-dim">
            <tr className="border-b border-line">
              <th className="py-2 pr-3 font-medium">Aʼzo</th>
              <th className="py-2 pr-3 font-medium">Rol</th>
              <th className="py-2 pr-3 font-medium">Daraxt</th>
              <th className="py-2 pr-3 font-medium">Holat</th>
              <th className="py-2 font-medium"><span className="sr-only">Amallar</span></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const locked = m.role === "owner" || m.id === me || (!isOwner && m.role === "admin");
              return (
                <tr key={m.id} className="border-b border-line/60 align-middle">
                  <td className="py-3 pr-3">
                    <p className="font-medium">{m.name}{m.id === me && " (siz)"}</p>
                    <p className="text-dim">{m.email}{m.telegram && " · Telegram"}</p>
                  </td>
                  <td className="py-3 pr-3">
                    {locked ? ROLE_LABELS[m.role] : (
                      <>
                        <label className="sr-only" htmlFor={`role-${m.id}`}>{m.name} roli</label>
                        <Select id={`role-${m.id}`} defaultValue={m.role} className="min-h-9 w-36 py-1.5"
                          onChange={async (e) => check(await updateMemberAction(m.id, { role: e.target.value as "member" }))}>
                          {isOwner && <option value="admin">Admin</option>}
                          <option value="member">Aʼzo</option>
                          <option value="viewer">Koʻruvchi</option>
                        </Select>
                      </>
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    {m.role === "owner" || m.role === "admin" ? "Ha" : m.role === "viewer" ? "—" : (
                      <label className="flex cursor-pointer items-center gap-2">
                        <input type="checkbox" defaultChecked={m.isTreeEditor} className="size-5 accent-[var(--accent)]"
                          onChange={async (e) => check(await updateMemberAction(m.id, { isTreeEditor: e.target.checked }))} />
                        <span className="sr-only">{m.name} daraxtni tahrirlay oladi</span>Tahrirlaydi
                      </label>
                    )}
                  </td>
                  <td className="py-3 pr-3">{m.disabledAt ? <Badge tone="danger">Bloklangan</Badge> : <Badge tone="ok">Faol</Badge>}</td>
                  <td className="py-3 text-right whitespace-nowrap">
                    {!locked && (
                      <Button size="sm" variant="ghost" onClick={async () => check(await updateMemberAction(m.id, { disabled: !m.disabledAt }))}>
                        {m.disabledAt ? "Faollashtirish" : "Bloklash"}
                      </Button>
                    )}
                    {(m.role !== "owner" || isOwner) && m.id !== me && (
                      <Button size="sm" variant="ghost" onClick={async () => {
                        const r = await createResetLinkAction(m.id);
                        check(r);
                        if (r.ok) setLink({ url: r.data.url, label: `${m.name}: parol tiklash (24 soat)` });
                      }}>Parol tiklash</Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {invites.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 font-medium">Faol takliflar</h3>
          <ul className="space-y-1 text-sm">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3">
                <span>{ROLE_LABELS[i.role]} · {formatDate(i.expiresAt)} gacha</span>
                <Button size="sm" variant="ghost" onClick={async () => check(await revokeInviteAction(i.id))}>Bekor qilish</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
