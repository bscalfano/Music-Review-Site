"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Ctx = { editing: boolean; setEditing: (v: boolean) => void };
export const EditContext = createContext<Ctx>({ editing: false, setEditing: () => {} });

/** Shared "is the owner editing their profile header" state, so the button and the details can live apart. */
export function ProfileEditProvider({ children }: { children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  return <EditContext value={{ editing, setEditing }}>{children}</EditContext>;
}

/** The owner's Edit profile / Done toggle. Nothing navigates; the header changes in place. */
export function EditProfileButton() {
  const { editing, setEditing } = useContext(EditContext);
  return (
    <Button
      type="button"
      variant={editing ? "default" : "outline"}
      size="sm"
      aria-expanded={editing}
      onClick={() => setEditing(!editing)}
    >
      {editing ? "Done" : "Edit profile"}
    </Button>
  );
}

/** Shows the normal profile details, or the editor in their place while the owner is editing. */
export function ProfileInfoSwitch({ view, edit }: { view: ReactNode; edit: ReactNode }) {
  const { editing } = useContext(EditContext);
  return <>{editing ? edit : view}</>;
}
