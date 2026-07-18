module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { name } = req.body || {};
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'Missing "name" in request body' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Add it in Vercel → Project → Settings → Environment Variables.' });
    return;
  }

  const prompt = `Identify this political figure: "${name}". Respond with ONLY a raw JSON object, no markdown fences, no preamble, no explanation outside the object:
{"name": "full name", "country": "country", "dates": "years/role in power, e.g. 2010–2018, Prime Minister, or 'Not currently in office' if never held office", "x": number from -10 (far economic left) to 10 (far economic right), "y": number from -10 (highly authoritarian) to 10 (highly libertarian, respects civil liberties/pluralism), "blurb": "one sentence under 18 words justifying the placement"}
If the name is ambiguous or not a real recognizable political figure, still respond with your best-guess JSON, setting "name" to your best interpretation.`;

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: data?.error?.message || `Anthropic API error (${upstream.status})` });
      return;
    }

    const textBlock = (data.content || []).find((b) => b.type === 'text');
    if (!textBlock) {
      res.status(502).json({ error: 'No text content in model response' });
      return;
    }

    let raw = textBlock.text.trim().replace(/```json/gi, '').replace(/```/g, '').trim();
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first === -1 || last === -1 || last < first) {
      res.status(502).json({ error: 'No JSON object found in model reply', raw: raw.slice(0, 200) });
      return;
    }
    raw = raw.slice(first, last + 1);

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      res.status(502).json({ error: 'Failed to parse model JSON', detail: parseErr.message, raw: raw.slice(0, 200) });
      return;
    }

    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') {
      res.status(502).json({ error: 'Model reply missing numeric x/y', parsed });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
