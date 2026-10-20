"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { assert, canEditTree, requireUser } from "@/lib/auth";
import {
  addRelationship, addSampleRelatives, deletePerson, linkPersonToUser, personInput, relationshipInput, removeRelationship, savePerson,
  setPersonAvatar,
} from "@/lib/tree";
import { run } from "./result";

async function editor() {
  const user = await requireUser();
  assert(canEditTree(user), "Oila daraxtini tahrirlash huquqingiz yoʻq");
  return user;
}

export async function savePersonAction(input: unknown, id?: string) {
  return run(async () => {
    const user = await editor();
    const personId = await savePerson(user, personInput.parse(input), id ? z.uuid().parse(id) : undefined);
    refresh();
    return { id: personId };
  });
}

export async function deletePersonAction(id: string) {
  return run(async () => {
    const user = await editor();
    await deletePerson(user, z.uuid().parse(id));
    refresh();
    return null;
  });
}

export async function setAvatarAction(personId: string, mediaId: string) {
  return run(async () => {
    const user = await editor();
    await setPersonAvatar(user, z.uuid().parse(personId), z.uuid().parse(mediaId));
    refresh();
    return null;
  });
}

export async function addSampleRelativesAction(personId: string) {
  return run(async () => {
    const user = await editor();
    await addSampleRelatives(user, z.uuid().parse(personId));
    refresh();
    return null;
  });
}

export async function addRelationshipAction(input: unknown) {
  return run(async () => {
    const user = await editor();
    const id = await addRelationship(user, relationshipInput.parse(input));
    refresh();
    return { id };
  });
}

export async function removeRelationshipAction(id: string) {
  return run(async () => {
    const user = await editor();
    await removeRelationship(user, z.uuid().parse(id));
    refresh();
    return null;
  });
}

export async function linkPersonUserAction(personId: string, userId: string | null) {
  return run(async () => {
    const user = await editor();
    await linkPersonToUser(user, z.uuid().parse(personId), userId ? z.uuid().parse(userId) : null);
    refresh();
    return null;
  });
}
