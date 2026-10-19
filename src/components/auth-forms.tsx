"use client";

import { useActionState } from "react";
import { acceptInviteAction, loginAction, setupAction, type FormState } from "@/actions/auth";
import { Button, Field, Input, Notice } from "./ui";

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

function AuthForm({ action, submit, children }: { action: Action; submit: string; children: (f: Record<string, string>) => React.ReactNode }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="space-y-4">
      {children(state?.fields ?? {})}
      <Notice>{state?.error}</Notice>
      <Button type="submit" variant="primary" loading={pending} className="w-full">{submit}</Button>
    </form>
  );
}

const EmailField = ({ value }: { value?: string }) => (
  <Field label="Email">{(id) => <Input id={id} name="email" type="email" autoComplete="email" required inputMode="email" defaultValue={value} />}</Field>
);
const NewPassword = ({ name = "password" }: { name?: string }) => (
  <Field label="Parol" hint="Kamida 10 belgi">
    {(id, d) => <Input id={id} name={name} type="password" autoComplete="new-password" minLength={10} required aria-describedby={d} />}
  </Field>
);
const NameField = ({ value }: { value?: string }) => (
  <Field label="Ismingiz">{(id) => <Input id={id} name="name" autoComplete="name" required maxLength={80} defaultValue={value} />}</Field>
);

export function LoginForm() {
  return (
    <AuthForm action={loginAction} submit="Kirish">
      {(f) => (
        <>
          <EmailField value={f.email} />
          <Field label="Parol">{(id) => <Input id={id} name="password" type="password" autoComplete="current-password" required />}</Field>
        </>
      )}
    </AuthForm>
  );
}

export function SetupForm() {
  return (
    <AuthForm action={setupAction} submit="Arxivni yaratish">
      {(f) => (
        <>
          <Field label="Oila nomi" hint="Masalan: Karimovlar oilasi">
            {(id, d) => <Input id={id} name="familyName" required maxLength={80} aria-describedby={d} defaultValue={f.familyName} />}
          </Field>
          <NameField value={f.name} />
          <EmailField value={f.email} />
          <NewPassword />
        </>
      )}
    </AuthForm>
  );
}

export function InviteForm({ token, kind }: { token: string; kind: "invite" | "reset" }) {
  return (
    <AuthForm action={acceptInviteAction} submit={kind === "reset" ? "Parolni saqlash" : "Roʻyxatdan oʻtish"}>
      {(f) => (
        <>
          <input type="hidden" name="token" value={token} />
          {kind === "invite" && (<><NameField value={f.name} /><EmailField value={f.email} /></>)}
          <NewPassword />
        </>
      )}
    </AuthForm>
  );
}
