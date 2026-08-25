/// <reference lib="deno.window" />

Deno.serve(async (req) => {
  // --- CORS Preflight ---
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  try {
    // --- Parse request ---
    const payload = await req.json();
    console.log('[inChurch Proxy] Recebido:', JSON.stringify(payload));

    const apiKey = Deno.env.get('INCHURCH_API_KEY');
    const apiSecret = Deno.env.get('INCHURCH_API_SECRET');

    if (!apiKey || !apiSecret) {
      console.error('[inChurch Proxy] Credenciais ausentes!');
      return new Response(
        JSON.stringify({ error: 'Missing API credentials' }),
        { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // --- Build body for inChurch API (filtrar null/undefined) ---
    const inChurchBody: Record<string, any> = {
      full_name: payload.full_name,
      email: payload.email,
      phone: payload.phone ?? null,
      mobile_phone: payload.mobile_phone ?? null,
      has_whatsapp: payload.has_whatsapp ?? false,
      church_id: payload.church_id ?? 36014,
      status: payload.status ?? 'pending',
      church_profile: payload.church_profile ?? 'visitor',
      birthday: payload.birthday ?? null,
      marital_status: payload.marital_status ?? null,
      gender: payload.gender ?? null,
      occupation: payload.occupation ?? null,
      education_level: payload.education_level ?? null,
      is_active: payload.is_active ?? true,
      first_visit_date: payload.first_visit_date ?? null,
      accepted_jesus: payload.accepted_jesus ?? false,
      decision_date: payload.decision_date ?? null,
    };

    // Remover campos null/undefined
    Object.keys(inChurchBody).forEach(key => {
      if (inChurchBody[key] === null || inChurchBody[key] === undefined) {
        delete inChurchBody[key];
      }
    });

    console.log('[inChurch Proxy] Enviando para API:', JSON.stringify(inChurchBody));

    // --- Basic Auth ---
    const credentials = `${apiKey}:${apiSecret}`;
    const encodedCredentials = btoa(credentials);

    // --- Call inChurch API ---
    const response = await fetch('https://inradar.com.br/public/v1/people/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${encodedCredentials}`,
      },
      body: JSON.stringify(inChurchBody),
    });

    const responseData = await response.json();
    console.log('[inChurch Proxy] Resposta:', response.status, JSON.stringify(responseData));

    return new Response(JSON.stringify(responseData), {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('[inChurch Proxy] Erro:', error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
});
