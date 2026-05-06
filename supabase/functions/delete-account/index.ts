import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? serviceRoleKey
    const authHeader = req.headers.get("Authorization") ?? ""

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return json({ error: "Missing Supabase environment variables" }, 500)
    }

    const body = await req.json().catch(() => ({}))
    if (body?.confirm !== true) {
      return json({ error: "Confirmation required" }, 400)
    }

    const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""

    if (!accessToken) {
      return json({ error: "Missing access token" }, 401)
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })

    const {
      data: { user },
      error: userError
    } = await userClient.auth.getUser(accessToken)

    if (userError || !user) {
      return json({ error: userError?.message ?? "Unauthorized" }, 401)
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })

    const userId = user.id
    const tables = ["right_memos", "windows", "plans"]

    for (const table of tables) {
      const { error } = await adminClient.from(table).delete().eq("user_id", userId)
      if (error) throw error
    }

    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(userId)
    if (deleteUserError) throw deleteUserError

    return json({ ok: true })
  } catch (error) {
    console.error("delete-account failed", error)
    return json({ error: String(error?.message ?? error ?? "Account deletion failed") }, 500)
  }
})
