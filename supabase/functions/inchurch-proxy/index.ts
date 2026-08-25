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

    // --- Build body for inChurch API ---
    const inChurchBody = {
      full_name: payload.full_name,
      email: payload.email,
      phone: payload.phone,
      church_id: payload.church_id ?? 36014,
    };

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
