// Vercel Serverless Function: GET /api/discord-members
// Returns the current member count of the ONGXREPS Discord server from the official Discord API.
//
// Source, in order of preference:
//   1. Bot API  – GET /guilds/{DISCORD_GUILD_ID}?with_counts=true  (needs DISCORD_BOT_TOKEN + DISCORD_GUILD_ID)
//   2. Invite API – GET /invites/{DISCORD_INVITE_CODE}?with_counts=true (public, no secret needed)
//
// The bot token is only read from server-side environment variables and is never sent to the browser.
// No value is ever invented: if Discord cannot be reached, the endpoint answers 502 and the page shows "—".

const API = 'https://discord.com/api/v10';
const DEFAULT_INVITE = '9yaAhBdBDy';

async function discordGet(path, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(API + path, {
      headers: { Accept: 'application/json', 'User-Agent': 'ONGXREPS-Website (member-count, 1.0)', ...headers },
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`Discord API ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fromBot(token, guildId) {
  const g = await discordGet(`/guilds/${encodeURIComponent(guildId)}?with_counts=true`, { Authorization: `Bot ${token}` });
  if (typeof g.approximate_member_count !== 'number') throw new Error('No member count in guild response');
  return { members: g.approximate_member_count, online: g.approximate_presence_count ?? null, source: 'bot' };
}

async function fromInvite(code) {
  const inv = await discordGet(`/invites/${encodeURIComponent(code)}?with_counts=true`);
  if (typeof inv.approximate_member_count !== 'number') throw new Error('No member count in invite response');
  return { members: inv.approximate_member_count, online: inv.approximate_presence_count ?? null, source: 'invite' };
}

module.exports = async function handler(req, res) {
  const send = (status, body, cache) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', cache);
    res.end(JSON.stringify(body));
  };

  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return send(405, { error: 'Method not allowed' }, 'no-store');
  }

  const token = (process.env.DISCORD_BOT_TOKEN || '').trim();
  const guildId = (process.env.DISCORD_GUILD_ID || '').trim();
  const invite = (process.env.DISCORD_INVITE_CODE || DEFAULT_INVITE).trim();

  let data = null;
  if (token && guildId) {
    try { data = await fromBot(token, guildId); } catch (e) { data = null; }
  }
  if (!data) {
    try { data = await fromInvite(invite); } catch (e) { data = null; }
  }

  if (!data) {
    return send(502, { error: 'Discord member count unavailable' }, 'public, s-maxage=30');
  }
  // Cached at Vercel's edge for 5 minutes, refreshed in the background afterwards
  return send(200, { ...data, updatedAt: new Date().toISOString() }, 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
};
