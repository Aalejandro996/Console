const DAY_NAMES = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

/* Calcula, para cada combinación día-de-semana + hora, cuántas sesiones
   estaban activas en ese bloque (ocupación simultánea aproximada). */
function computeOverlapHistogram(records) {
  const buckets = {}; // key "dow-hour" -> count
  for (const r of records) {
    const start = new Date(r.start_time);
    const end = new Date(r.end_time);
    if (isNaN(start) || isNaN(end) || end <= start) continue;
    // recorre hora a hora entre inicio y fin
    let cursor = new Date(start);
    cursor.setMinutes(0, 0, 0);
    while (cursor < end) {
      const dow = cursor.getDay();
      const hour = cursor.getHours();
      const key = `${dow}-${hour}`;
      buckets[key] = (buckets[key] || 0) + 1;
      cursor = new Date(cursor.getTime() + 60 * 60 * 1000);
    }
  }
  const rows = Object.entries(buckets).map(([key, count]) => {
    const [dow, hour] = key.split('-').map(Number);
    return { day: DAY_NAMES[dow], hour, count };
  });
  rows.sort((a, b) => b.count - a.count);
  return rows;
}

function buildPrompt(records, histogram) {
  const topSlots = histogram.slice(0, 8)
    .map(r => `${r.day} ${String(r.hour).padStart(2,'0')}:00–${String(r.hour+1).padStart(2,'0')}:00 → ${r.count} consola(s) simultáneas (aprox.)`)
    .join('\n');

  const sample = records.slice(0, 400).map(r =>
    `${r.console_name} | ${r.date} | ${r.start_time} | ${r.end_time}`
  ).join('\n');

  return `Eres un analista de datos para "Argame Paseo Mirandino", un negocio de alquiler de consolas por hora (PS4, PS5, Xbox Series S/X, Nintendo Switch).

Tienes el registro de uso de los últimos 7 días (consola, fecha, hora de inicio, hora de fin de cada sesión):

${sample}

Además, ya se calculó un resumen de ocupación simultánea aproximada por franja horaria (día de la semana + hora), de mayor a menor:
${topSlots || '(sin datos suficientes para calcular franjas)'}

Con base ÚNICAMENTE en estos datos, responde en español:
1. "busiest_slot": el día y franja horaria de mayor actividad, con una breve explicación de por qué (1-2 frases).
2. "tournament_suggestion": una fecha/día de la semana y horario ESPECÍFICO recomendado para organizar un torneo, justificado en que ahí hay más consolas en uso simultáneo.
3. "loyalty_idea": UNA idea simple y concreta de fidelización (sistema de puntos o membresía), basada en los patrones de uso que observas (por ejemplo, consolas o días más fuertes, horas valle que se podrían incentivar, etc.).

Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin markdown, con exactamente estas claves (valores en español, cada uno de 1 a 3 frases):
{"busiest_slot": "...", "tournament_suggestion": "...", "loyalty_idea": "..."}`;
}

function extractJson(text) {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('La IA no devolvió un JSON válido');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function callAnthropic(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Falta configurar ANTHROPIC_API_KEY en el servidor.');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic API respondió ${res.status}: ${errText.slice(0,300)}`);
  }
  const data = await res.json();
  const text = (data.content || []).map(b => b.text || '').join('\n');
  return extractJson(text);
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Falta configurar GEMINI_API_KEY en el servidor.');
  const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 700 }
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API respondió ${res.status}: ${errText.slice(0,300)}`);
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('\n');
  return extractJson(text);
}

async function generateInsights(records) {
  const histogram = computeOverlapHistogram(records);
  const prompt = buildPrompt(records, histogram);
  const provider = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
  const result = provider === 'gemini' ? await callGemini(prompt) : await callAnthropic(prompt);
  return {
    busiest_slot: String(result.busiest_slot || '').slice(0, 600),
    tournament_suggestion: String(result.tournament_suggestion || '').slice(0, 600),
    loyalty_idea: String(result.loyalty_idea || '').slice(0, 600)
  };
}

module.exports = { generateInsights, computeOverlapHistogram };
