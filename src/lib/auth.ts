import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
}

/**
 * Who is signed in, and are they on the events team?
 *
 * Being authenticated is NOT the same as being an admin. Supabase Auth will
 * happily create an account for anyone; membership of `admin_users` is the
 * actual authorisation check, and it is the same table the database's RLS
 * policies consult.
 */
export async function getCurrentAdmin(): Promise<AdminUser | null> {
  const supabase = await createSupabaseServerClient();

  // getUser() re-validates the JWT with Supabase. getSession() only reads the
  // cookie, which a client could have tampered with — never use it for authz.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("admin_users")
    .select("id,email,full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id as string,
    email: data.email as string,
    fullName: (data.full_name as string) || (data.email as string),
  };
}

/** Use at the top of every admin page and every admin mutation. */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}
