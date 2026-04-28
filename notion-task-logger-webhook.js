const DB_ID = '1df0b457c8b48086b007e96a116faf27';

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

function extractValue(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'status':      return prop.status?.name;
    case 'select':      return prop.select?.name;
    case 'multi_select':return prop.multi_select?.map(t => t.name).join(', ') || null;
    case 'people':      return prop.people?.map(u => u.name).join(', ') || null;
    case 'date':        return prop.date?.start;
    case 'rich_text':   return prop.rich_text?.[0]?.plain_text;
    case 'title':       return prop.title?.[0]?.plain_text;
    case 'number':      return prop.number?.toString();
    case 'checkbox':    return prop.checkbox ? 'Bəli' : 'Xeyr';
    case 'url':         return prop.url;
    case 'email':       return prop.email;
    case 'phone_number':return prop.phone_number;
    case 'relation':    return prop.relation?.length ? `${prop.relation.length} əlaqə` : null;
    default:            return null;
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

async function appendLog(pageId, logLine, token) {
  await notionFetch(`/blocks/${pageId}/children`, 'PATCH', {
    children: [{
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: logLine },
          annotations: { color: 'gray' }
        }]
      }
    }]
  }, token);
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

    // Notion webhook payload-dan page ID-ni al
    const pageId = payload?.data?.id || payload?.entity?.id;
    if (!pageId) {
      return res.status(400).json({ error: 'Page ID tapılmadı' });
    }

    // Dəyişən propertyləri al
    const changedProps = payload?.data?.properties || {};
    const now = formatBakuTime();
    const logLines = [];

    for (const [fieldName, propData] of Object.entries(changedProps)) {
      // System fieldlərini keç
      if (['Task name', 'Updated at', 'Done subtask bar', 'In progress subtask bar', 'To do subtask bar', 'Past due'].includes(fieldName)) continue;

      const newValue = extractValue(propData);
      if (newValue === null || newValue === undefined) continue;

      const emoji = FIELD_EMOJI[fieldName] || '✏️';
      const logLine = `${emoji} ${fieldName}: ${newValue} | ${now}`;
      logLines.push(logLine);
    }

    // Logları taska yaz
    for (const line of logLines) {
      await appendLog(pageId, line, token);
    }

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
