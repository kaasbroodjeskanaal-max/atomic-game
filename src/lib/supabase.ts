import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
const supabaseKey = (import.meta as any).env.VITE_SUPABASE_PUBLISHABLE_KEY;

let supabaseClient: any = null;

export const getSupabase = () => {
  if (!supabaseUrl || !supabaseKey) {
    console.warn("Supabase credentials missing. Persistence will be disabled.");
    return null;
  }
  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseKey);
  }
  return supabaseClient;
};

export const saveDefenses = async (defenses: any[], missionId: number) => {
  const supabase = getSupabase();
  if (!supabase) return;

  // 1. Safer filtering: keep everything EXCEPT mission-static obstacles (id < 0)
  // This ensures we don't drop legitimate items that might be missing an ID locally
  const toSave = defenses
    .filter(d => !(typeof d.id === 'number' && d.id < 0))
    .map(d => ({
      mission_id: missionId,
      type: d.type,
      x: d.x,
      y: d.y,
      w: d.w,
      h: d.h,
      radius: d.radius || 0
    }));

  try {
    // 2. Clear old defenses
    const { error: deleteError } = await supabase
      .from("defenses")
      .delete()
      .eq("mission_id", missionId);

    if (deleteError) {
      console.error("Failed to clear old defenses:", deleteError);
      return;
    }

    if (toSave.length === 0) return;

    // 3. Insert fresh set
    const { data: insertData, error: insertError } = await supabase
      .from("defenses")
      .insert(toSave)
      .select();

    if (insertError) {
      console.error("Error inserting defenses:", insertError);
    } else if (insertData && insertData.length !== toSave.length) {
      console.warn(`Sync mismatch: expected ${toSave.length} records, inserted ${insertData.length}`);
    }
  } catch (err) {
    console.error("Critical error in saveDefenses sync loop:", err);
  }
};

export const loadDefenses = async (missionId: number) => {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("defenses")
    .select("*")
    .eq("mission_id", missionId);

  if (error) {
    console.error("Error loading defenses:", error);
    return [];
  }
  return data || [];
};

export const clearAllDefenses = async (missionId: number) => {
  const supabase = getSupabase();
  if (!supabase) return;

  const { error } = await supabase
    .from("defenses")
    .delete()
    .eq("mission_id", missionId);

  if (error) console.error("Error clearing defenses:", error);
};

export const savePlayerProfile = async (uid: string, profile: {
  name: string;
  scrap: number;
  upgrades: any;
  bases: any[];
  ownedWeapons: string[];
  highScore: number;
}) => {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from("player_profiles")
      .upsert({
        id: uid,
        name: profile.name,
        scrap: profile.scrap,
        upgrades: profile.upgrades,
        bases: profile.bases,
        owned_weapons: profile.ownedWeapons,
        high_score: profile.highScore,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

    if (error) {
      console.error("Error saving player profile:", error);
    }
  } catch (err) {
    console.error("Critical error in savePlayerProfile:", err);
  }
};

export const loadPlayerProfile = async (uid: string) => {
  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from("player_profiles")
      .select("*")
      .eq("id", uid)
      .single();

    if (error) {
      if (error.code !== "PGRST116") { // Not found error code for single()
        console.error("Error loading player profile:", error);
      }
      return null;
    }
    return data;
  } catch (err) {
    console.error("Critical error in loadPlayerProfile:", err);
    return null;
  }
};
