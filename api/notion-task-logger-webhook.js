const FIELD_EMOJI = {
  'Status':      '🔄',
  'Priority':    '🎯',
  'Assignee':    '👤',
  'Due date':    '📅',
  'Start Date':  '📅',
  'Tags':        '🏷️',
  'Description': '📝',
  'Tracking ID': '🔢',
  'Parent-task': '🔗',
  'Sub-tasks':   '📌',
};

async function notionFetch(path, method = 'GET', body = null, token) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return res.json();
}

async function redisGet(key) {
  const url = `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function redisSet(key, value) {
  const url = `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`;
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(JSON.stringify(value))
  });
}

function extractValue(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'status':       return prop.status?.name;
    case 'select':       return prop.select?.name;
    case 'multi_select': return prop.multi_select?.map(t => t.name).join(', ') || null;
    case 'people':       return prop.people?.map(u => u.name).join(', ') || null;
    case 'date':         return prop.date?.start;
    case 'rich_text':    return prop.rich_text?.[0]?.plain_text;
    case 'title':        return prop.title?.[0]?.plain_text;
    case 'number':       return prop.number?.toString();
    case 'checkbox':     return prop.checkbox ? 'Bəli' : 'Xeyr';
    case 'url':          return prop.url;
    case 'email':        return prop.email;
    case 'phone_number': return prop.phone_number;
    case 'relation':     return prop.relation?.length ? `${prop.relation.length} əlaqə` : null;
    default:             return null;
  }
}

function formatBakuTime() {
  return new Date().toLocaleString('az-AZ', {
    timeZone: 'Asia/Baku',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: 'NOTION_TOKEN yoxdur' });

  try {
    const payload = req.body;
    const pageId = payload?.data?.id || payload?.entity?.id;
    if (!pageId) return res.status(400).json({ error: 'Page ID tapılmadı' });

    // Webhook-dan gələn bütün field-lər (taskın cari vəziyyəti)
    const incomingProps = payload?.data?.properties || {};

    // Cari vəziyyəti çıxart — yalnız izlədiyimiz field-lər
    const currentState = {};
    for (const [fieldName, propData] of Object.entries(incomingProps)) {

      const val = extractValue(propData);
      if (val) currentState[fieldName] = val;
    }

    // Redis-dən əvvəlki vəziyyəti oxu
    const redisKey = `task:${pageId}`;
    const previousState = await redisGet(redisKey) || {};

    // Fərqli olanları tap
    const logLines = [];
    for (const [fieldName, currentVal] of Object.entries(currentState)) {
      const prevVal = previousState[fieldName];
      if (prevVal === undefined) continue; // ilk dəfədir, log yoxdur
      if (prevVal === currentVal) continue; // dəyişməyib
      const emoji = FIELD_EMOJI[fieldName] || '✏️';
      logLines.push(`${emoji} ${fieldName}: ${prevVal} → ${currentVal}`);
    }

    // Cari vəziyyəti Redis-ə yaz (növbəti dəfə üçün)
    await redisSet(redisKey, currentState);

    if (logLines.length === 0) {
      return res.status(200).json({ success: true, logsWritten: 0, logs: [] });
    }

    const now = formatBakuTime();

    // Başlıq + loglar + divider
    const blocks = [
      {
        object: 'block',
        type: 'divider',
        divider: {}
      },
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: `📋 ${now}` },
            annotations: { bold: true }
          }]
        }
      },
      ...logLines.map(line => ({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: line },
            annotations: { color: 'gray' }
          }]
        }
      })),
      {
        object: 'block',
        type: 'divider',
        divider: {}
      }
    ];

    await notionFetch(`/blocks/${pageId}/children`, 'PATCH', { children: blocks }, token);

    return res.status(200).json({
      success: true,
      pageId,
      logsWritten: logLines.length,
      logs: logLines
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
