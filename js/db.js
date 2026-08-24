// ── Family Grocery List — db.js ───────────────────────────────────────────
// All Supabase operations. Imported by app.js.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

if (SUPABASE_URL.includes('YOUR_PROJECT_REF')) {
  throw new Error(
    'Supabase is not configured. Edit js/config.js with your project URL and anon key.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Auth ──────────────────────────────────────────────────────────────────

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUp(email, password, displayName) {
  return supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function updatePassword(newPassword) {
  return supabase.auth.updateUser({ password: newPassword });
}

// ── Profile ───────────────────────────────────────────────────────────────

export async function getProfile(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  return data;
}

// ── Family ────────────────────────────────────────────────────────────────

/** Returns { family_id, role, families: { id, name, join_code } } or null */
export async function getUserFamily() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('family_members')
    .select('family_id, role, families(id, name, join_code)')
    .eq('user_id', user.id)
    .maybeSingle();
  return data;
}

export async function createFamily(name) {
  return supabase.rpc('create_family', { p_family_name: name });
}

export async function joinFamily(joinCode) {
  return supabase.rpc('join_family_with_code', { p_join_code: joinCode.toUpperCase().trim() });
}

export async function updateFamilyName(familyId, name) {
  return supabase.from('families').update({ name }).eq('id', familyId);
}

export async function getFamilyMembers(familyId) {
  const { data } = await supabase
    .from('family_members')
    .select('role, user_id, profiles(display_name)')
    .eq('family_id', familyId);
  return data || [];
}

// ── Grocery Items ─────────────────────────────────────────────────────────

export async function loadItems(familyId) {
  return supabase
    .from('grocery_items')
    .select('*')
    .eq('family_id', familyId)
    .eq('deleted', false)
    .order('created_at', { ascending: false });
}

export async function insertItem(familyId, item) {
  return supabase
    .from('grocery_items')
    .insert({
      family_id: familyId,
      name:      item.name,
      quantity:  item.quantity  || null,
      category:  item.category  || null,
      notes:     item.notes     || null,
    })
    .select()
    .single();
}

export async function updateItem(id, changes) {
  return supabase
    .from('grocery_items')
    .update(changes)
    .eq('id', id)
    .select()
    .single();
}

export async function softDeleteItem(id) {
  return supabase
    .from('grocery_items')
    .update({ deleted: true })
    .eq('id', id);
}

export async function softDeletePurchased(familyId) {
  return supabase
    .from('grocery_items')
    .update({ deleted: true })
    .eq('family_id', familyId)
    .eq('purchased', true)
    .eq('deleted', false);
}

export async function softDeleteAll(familyId) {
  return supabase
    .from('grocery_items')
    .update({ deleted: true })
    .eq('family_id', familyId)
    .eq('deleted', false);
}

/** Subscribe to all changes on grocery_items for a family. Returns the channel. */
export function subscribeToItems(familyId, onChange) {
  return supabase
    .channel(`items:${familyId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'grocery_items', filter: `family_id=eq.${familyId}` },
      onChange
    )
    .subscribe();
}

// ── Activity Log ──────────────────────────────────────────────────────────

export async function loadActivity(familyId) {
  const { data } = await supabase
    .from('activity_log')
    .select('*')
    .eq('family_id', familyId)
    .order('created_at', { ascending: false })
    .limit(100);
  return data || [];
}

export async function insertActivity(familyId, icon, text) {
  // Fire-and-forget; don't block the UI on activity writes
  supabase.from('activity_log').insert({ family_id: familyId, icon, text }).then(() => {});
}
